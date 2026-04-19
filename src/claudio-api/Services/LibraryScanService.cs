using Claudio.Api.Data;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class LibraryScanService(
    IServiceScopeFactory scopeFactory,
    ClaudioConfig config,
    CompressionService compressionService,
    IgdbService igdbService,
    SteamGridDbService steamGridDbService,
    ILogger<LibraryScanService> logger)
{
    public SteamGridDbScanStatus GetSteamGridDbStatus() => steamGridDbService.GetStatus();

    public async Task<ScanResult> ScanAsync()
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var foundPaths = new HashSet<string>();
        var gamesFound = 0;
        var gamesAdded = 0;
        var gamesMissing = 0;

        foreach (var scanPath in config.Library.LibraryPaths)
        {
            if (!Directory.Exists(scanPath))
            {
                logger.LogWarning("Scan path does not exist: {Path}", scanPath);
                continue;
            }

            foreach (var platformDir in Directory.GetDirectories(scanPath))
            {
                var platform = NormalizePlatform(Path.GetFileName(platformDir));
                if (Endpoints.GameEndpoints.HiddenNames.Contains(platform))
                    continue;
                if (config.Library.ExcludePlatforms.Contains(platform, StringComparer.OrdinalIgnoreCase))
                    continue;

                foreach (var gameDir in Directory.GetDirectories(platformDir))
                {
                    var folderName = Path.GetFileName(gameDir);
                    if (Endpoints.GameEndpoints.HiddenNames.Contains(folderName))
                        continue;

                    foundPaths.Add($"{platform}/{folderName}");

                    var existing = await db.Games
                        .FirstOrDefaultAsync(g => g.Platform == platform && g.FolderName == folderName);

                    CleanupTempFiles(gameDir);

                    if (existing is not null)
                    {
                        existing.SizeBytes = GetDirectorySize(gameDir);
                        existing.FolderPath = gameDir;
                        existing.IsMissing = false;
                        gamesFound++;
                        continue;
                    }

                    db.Games.Add(new Game
                    {
                        Title = folderName,
                        Platform = platform,
                        FolderName = folderName,
                        FolderPath = gameDir,
                        InstallType = DetectInstallType(gameDir),
                        SizeBytes = GetDirectorySize(gameDir),
                        IsMissing = false,
                    });

                    gamesFound++;
                    gamesAdded++;
                }

                foreach (var archiveFile in Directory.GetFiles(platformDir))
                {
                    var fileName = Path.GetFileName(archiveFile);
                    if (Endpoints.GameEndpoints.HiddenNames.Contains(fileName))
                        continue;
                    if (!Endpoints.GameEndpoints.IsArchiveFile(fileName))
                        continue;

                    foundPaths.Add($"{platform}/{fileName}");

                    var existing = await db.Games
                        .FirstOrDefaultAsync(g => g.Platform == platform && g.FolderName == fileName);

                    if (existing is not null)
                    {
                        existing.SizeBytes = new FileInfo(archiveFile).Length;
                        existing.FolderPath = archiveFile;
                        existing.IsMissing = false;
                        gamesFound++;
                        continue;
                    }

                    db.Games.Add(new Game
                    {
                        Title = Path.GetFileNameWithoutExtension(fileName),
                        Platform = platform,
                        FolderName = fileName,
                        FolderPath = archiveFile,
                        InstallType = InstallType.Portable,
                        SizeBytes = new FileInfo(archiveFile).Length,
                        IsMissing = false,
                    });

                    gamesFound++;
                    gamesAdded++;
                }
            }
        }

        var allGames = await db.Games.ToListAsync();
        foreach (var game in allGames)
        {
            var key = $"{game.Platform}/{game.FolderName}";
            if (foundPaths.Contains(key))
                continue;

            if (!game.IsMissing)
                logger.LogWarning("Game missing from disk: {Platform}/{FolderName}", game.Platform, game.FolderName);

            game.IsMissing = true;
            gamesMissing++;
        }

        await db.SaveChangesAsync();

        logger.LogInformation(
            "Scan complete: {Found} found, {Added} added, {Missing} missing",
            gamesFound,
            gamesAdded,
            gamesMissing);

        var hasUnmatchedGames = await db.Games
            .AsNoTracking()
            .AnyAsync(g => g.IgdbId == null && !g.IsMissing);

        if (hasUnmatchedGames && !string.IsNullOrWhiteSpace(config.Igdb.ClientId) && !string.IsNullOrWhiteSpace(config.Igdb.ClientSecret))
            igdbService.QueueScan();

        if (!string.IsNullOrWhiteSpace(config.Steamgriddb.ApiKey))
            steamGridDbService.QueueMissingHeroSweep();

        return new ScanResult(gamesFound, gamesAdded, gamesMissing);
    }

    private void CleanupTempFiles(string gameDir)
    {
        try
        {
            foreach (var tmpFile in Directory.GetFiles(gameDir, ".claudio-compress-*.zip.tmp"))
            {
                var fileName = Path.GetFileName(tmpFile);
                var idStr = fileName.Replace(".claudio-compress-", "").Replace(".zip.tmp", "");
                if (int.TryParse(idStr, out var gameId) && compressionService.IsGameActive(gameId))
                    continue;

                logger.LogInformation("Cleaning up stale compression temp file: {Path}", tmpFile);
                File.Delete(tmpFile);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to clean up temp files in {Dir}", gameDir);
        }
    }

    private static string NormalizePlatform(string folderName) =>
        string.Equals(folderName, "pc", StringComparison.OrdinalIgnoreCase) ? "win" : folderName;

    private static InstallType DetectInstallType(string directory)
    {
        var fileNames = new List<string>();

        var singleArchive = Endpoints.GameEndpoints.FindSingleArchive(directory);
        if (singleArchive is not null)
        {
            fileNames.AddRange(Endpoints.GameEndpoints.ReadArchiveEntries(singleArchive)
                .Select(e => e.Name.Replace('\\', '/').Split('/').Last()));
        }
        else
        {
            fileNames.AddRange(Directory.GetFiles(directory, "*", SearchOption.AllDirectories)
                .Select(Path.GetFileName)!);
        }

        var hasInstaller = fileNames.Any(f =>
        {
            var name = Path.GetFileNameWithoutExtension(f);
            var ext = Path.GetExtension(f);
            if (ext.Equals(".iso", StringComparison.OrdinalIgnoreCase))
                return true;
            if (ext.Equals(".exe", StringComparison.OrdinalIgnoreCase) || ext.Equals(".msi", StringComparison.OrdinalIgnoreCase))
            {
                return name.Equals("setup", StringComparison.OrdinalIgnoreCase) ||
                       name.Equals("install", StringComparison.OrdinalIgnoreCase);
            }

            return false;
        });

        return hasInstaller ? InstallType.Installer : InstallType.Portable;
    }

    private static long GetDirectorySize(string directory)
    {
        return new DirectoryInfo(directory)
            .EnumerateFiles("*", SearchOption.AllDirectories)
            .Sum(f => f.Length);
    }

    public record ScanResult(int GamesFound, int GamesAdded, int GamesMissing);
}
