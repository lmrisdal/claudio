using Claudio.Api.Data;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class LibraryScanService(IServiceScopeFactory scopeFactory, ClaudioConfig config, ILogger<LibraryScanService> logger)
{
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
                var platform = Path.GetFileName(platformDir);
                if (Endpoints.GameEndpoints.HiddenNames.Contains(platform))
                    continue;

                foreach (var gameDir in Directory.GetDirectories(platformDir))
                {
                    var folderName = Path.GetFileName(gameDir);
                    if (Endpoints.GameEndpoints.HiddenNames.Contains(folderName))
                        continue;
                    foundPaths.Add($"{platform}/{folderName}");

                    var existing = await db.Games
                        .FirstOrDefaultAsync(g => g.Platform == platform && g.FolderName == folderName);

                    if (existing is not null)
                    {
                        existing.SizeBytes = GetDirectorySize(gameDir);
                        existing.FolderPath = gameDir;
                        existing.IsMissing = false;
                        gamesFound++;
                        continue;
                    }

                    var game = new Game
                    {
                        Title = folderName,
                        Platform = platform,
                        FolderName = folderName,
                        FolderPath = gameDir,
                        InstallType = DetectInstallType(gameDir),
                        SizeBytes = GetDirectorySize(gameDir),
                        IsMissing = false,
                    };

                    db.Games.Add(game);
                    gamesFound++;
                    gamesAdded++;
                }
            }
        }

        // Mark games not found on disk as missing
        var allGames = await db.Games.ToListAsync();
        foreach (var game in allGames)
        {
            var key = $"{game.Platform}/{game.FolderName}";
            if (!foundPaths.Contains(key))
            {
                if (!game.IsMissing)
                    logger.LogWarning("Game missing from disk: {Platform}/{FolderName}", game.Platform, game.FolderName);
                game.IsMissing = true;
                gamesMissing++;
            }
        }

        await db.SaveChangesAsync();

        // Auto-match new games against IGDB
        if (gamesAdded > 0 && !string.IsNullOrEmpty(config.Igdb.ClientId))
        {
            try
            {
                var igdbService = scope.ServiceProvider.GetRequiredService<IgdbService>();
                var igdbResult = await igdbService.ScanAsync();
                logger.LogInformation("IGDB auto-match: {Matched} matched, {Skipped} skipped",
                    igdbResult.Matched, igdbResult.Skipped);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "IGDB auto-match failed");
            }
        }

        logger.LogInformation("Scan complete: {Found} found, {Added} added, {Missing} missing",
            gamesFound, gamesAdded, gamesMissing);

        return new ScanResult(gamesFound, gamesAdded, gamesMissing);
    }

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
                return name.Equals("setup", StringComparison.OrdinalIgnoreCase) ||
                       name.Equals("install", StringComparison.OrdinalIgnoreCase);
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
