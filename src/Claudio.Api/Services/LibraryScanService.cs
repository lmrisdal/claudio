using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Api.Data;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class LibraryScanService(IServiceScopeFactory scopeFactory, ClaudioConfig config, IHttpClientFactory httpClientFactory, CompressionService compressionService, IgdbService igdbService, ILogger<LibraryScanService> logger)
{
    private readonly Lock _statusLock = new();
    private SteamGridDbScanStatus _sgdbStatus = new(false, null, 0, 0, 0);

    public SteamGridDbScanStatus GetSteamGridDbStatus()
    {
        lock (_statusLock) { return _sgdbStatus; }
    }

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

                // Scan subdirectories (folder-based games)
                foreach (var gameDir in Directory.GetDirectories(platformDir))
                {
                    var folderName = Path.GetFileName(gameDir);
                    if (Endpoints.GameEndpoints.HiddenNames.Contains(folderName))
                        continue;
                    foundPaths.Add($"{platform}/{folderName}");

                    var existing = await db.Games
                        .FirstOrDefaultAsync(g => g.Platform == platform && g.FolderName == folderName);

                    // Clean up leftover compression temp files
                    CleanupTempFiles(gameDir);

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

                // Scan standalone archive files directly in the platform directory
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

                    var title = Path.GetFileNameWithoutExtension(fileName);
                    var game = new Game
                    {
                        Title = title,
                        Platform = platform,
                        FolderName = fileName,
                        FolderPath = archiveFile,
                        InstallType = InstallType.Portable,
                        SizeBytes = new FileInfo(archiveFile).Length,
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

        logger.LogInformation("Scan complete: {Found} found, {Added} added, {Missing} missing",
            gamesFound, gamesAdded, gamesMissing);

        // Kick off IGDB matching in the background
        if (gamesAdded > 0 && !string.IsNullOrEmpty(config.Igdb.ClientId))
        {
            try { igdbService.StartScanInBackground(); }
            catch (InvalidOperationException) { /* already running */ }
        }

        // Kick off SteamGridDB hero fetch in the background
        if (!string.IsNullOrEmpty(config.Steamgriddb.ApiKey))
        {
            lock (_statusLock)
            {
                _sgdbStatus = new SteamGridDbScanStatus(true, null, 0, 0, 0);
            }

            _ = Task.Run(async () =>
            {
                try
                {
                    using var bgScope = scopeFactory.CreateScope();
                    var bgDb = bgScope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await FetchSteamGridDbHeroesStreamingAsync(bgDb);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "SteamGridDB hero fetch failed");
                    lock (_statusLock)
                    {
                        _sgdbStatus = new SteamGridDbScanStatus(false, null, 0, 0, 0);
                    }
                }
            });
        }

        return new ScanResult(gamesFound, gamesAdded, gamesMissing);
    }

    private void CleanupTempFiles(string gameDir)
    {
        try
        {
            foreach (var tmpFile in Directory.GetFiles(gameDir, ".claudio-compress-*.zip.tmp"))
            {
                // Extract game ID from filename pattern: .claudio-compress-{id}.zip.tmp
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

    /// Processes games as they get IGDB-matched, without waiting for the full IGDB scan to finish.
    private async Task FetchSteamGridDbHeroesStreamingAsync(AppDbContext db)
    {
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var processed = new HashSet<int>();
        var matched = 0;
        var totalProcessed = 0;

        try
        {
            while (true)
            {
                // Find games that have an IGDB match but no hero, excluding already-processed ones
                var candidates = await db.Games
                    .Where(g => g.IgdbId != null && g.HeroUrl == null && !g.IsMissing)
                    .ToListAsync();

                var batch = candidates.Where(g => !processed.Contains(g.Id)).ToList();

                if (batch.Count == 0)
                {
                    // If IGDB is still running, wait for more matches
                    if (igdbService.GetScanStatus().IsRunning)
                    {
                        await Task.Delay(2000);
                        continue;
                    }
                    // One final check after IGDB finished
                    candidates = await db.Games
                        .Where(g => g.IgdbId != null && g.HeroUrl == null && !g.IsMissing)
                        .ToListAsync();
                    batch = candidates.Where(g => !processed.Contains(g.Id)).ToList();
                    if (batch.Count == 0) break;
                }

                lock (_statusLock)
                {
                    _sgdbStatus = new SteamGridDbScanStatus(true, null, totalProcessed + batch.Count, totalProcessed, matched);
                }

                foreach (var game in batch)
                {
                    lock (_statusLock)
                    {
                        _sgdbStatus = _sgdbStatus with { CurrentGame = game.Title };
                    }

                    processed.Add(game.Id);
                    try
                    {
                        var searchRes = await client.GetAsync(
                            $"https://www.steamgriddb.com/api/v2/search/autocomplete/{Uri.EscapeDataString(game.Title)}");
                        if (!searchRes.IsSuccessStatusCode) { totalProcessed++; continue; }

                        var searchJson = await searchRes.Content.ReadAsStringAsync();
                        var searchResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbGame>>>(searchJson);
                        var sgdbGame = searchResult?.Data?.FirstOrDefault();
                        if (sgdbGame is null) { totalProcessed++; continue; }

                        var heroesRes = await client.GetAsync(
                            $"https://www.steamgriddb.com/api/v2/heroes/game/{sgdbGame.Id}");
                        if (!heroesRes.IsSuccessStatusCode) { totalProcessed++; continue; }

                        var heroesJson = await heroesRes.Content.ReadAsStringAsync();
                        var heroesResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbImage>>>(heroesJson);
                        var heroUrl = heroesResult?.Data?.FirstOrDefault()?.Url;
                        if (heroUrl is null) { totalProcessed++; continue; }

                        game.HeroUrl = heroUrl;
                        matched++;
                        totalProcessed++;
                        await db.SaveChangesAsync();
                        logger.LogInformation("SteamGridDB hero: {Title} -> {Url}", game.Title, heroUrl);

                        lock (_statusLock)
                        {
                            _sgdbStatus = _sgdbStatus with { Matched = matched, Processed = totalProcessed };
                        }

                        await Task.Delay(250);
                    }
                    catch (Exception ex)
                    {
                        totalProcessed++;
                        logger.LogWarning(ex, "SteamGridDB hero fetch failed for: {Title}", game.Title);
                        lock (_statusLock)
                        {
                            _sgdbStatus = _sgdbStatus with { Processed = totalProcessed };
                        }
                    }
                }
            }

            if (matched > 0)
                logger.LogInformation("SteamGridDB: added hero images for {Count} games", matched);
        }
        finally
        {
            lock (_statusLock)
            {
                _sgdbStatus = new SteamGridDbScanStatus(false, null, 0, 0, 0);
            }
        }
    }

    private async Task<int> FetchSteamGridDbHeroesAsync(AppDbContext db)
    {
        var games = await db.Games
            .Where(g => g.HeroUrl == null && !g.IsMissing)
            .ToListAsync();

        if (games.Count == 0)
        {
            lock (_statusLock) { _sgdbStatus = new SteamGridDbScanStatus(false, null, 0, 0, 0); }
            return 0;
        }

        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var count = 0;
        var processed = 0;

        lock (_statusLock)
        {
            _sgdbStatus = new SteamGridDbScanStatus(true, null, games.Count, 0, 0);
        }

        try
        {
            foreach (var game in games)
            {
                lock (_statusLock)
                {
                    _sgdbStatus = _sgdbStatus with { CurrentGame = game.Title };
                }

                try
                {
                    // Search for the game on SteamGridDB
                    var searchRes = await client.GetAsync(
                        $"https://www.steamgriddb.com/api/v2/search/autocomplete/{Uri.EscapeDataString(game.Title)}");
                    if (!searchRes.IsSuccessStatusCode) { processed++; continue; }

                    var searchJson = await searchRes.Content.ReadAsStringAsync();
                    var searchResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbGame>>>(searchJson);
                    var sgdbGame = searchResult?.Data?.FirstOrDefault();
                    if (sgdbGame is null) { processed++; continue; }

                    // Fetch heroes for the game
                    var heroesRes = await client.GetAsync(
                        $"https://www.steamgriddb.com/api/v2/heroes/game/{sgdbGame.Id}");
                    if (!heroesRes.IsSuccessStatusCode) { processed++; continue; }

                    var heroesJson = await heroesRes.Content.ReadAsStringAsync();
                    var heroesResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbImage>>>(heroesJson);
                    var heroUrl = heroesResult?.Data?.FirstOrDefault()?.Url;
                    if (heroUrl is null) { processed++; continue; }

                    game.HeroUrl = heroUrl;
                    count++;
                    processed++;
                    await db.SaveChangesAsync();
                    logger.LogInformation("SteamGridDB hero: {Title} -> {Url}", game.Title, heroUrl);

                    lock (_statusLock)
                    {
                        _sgdbStatus = _sgdbStatus with { Matched = count, Processed = processed };
                    }

                    // Rate limit
                    await Task.Delay(250);
                }
                catch (Exception ex)
                {
                    processed++;
                    logger.LogWarning(ex, "SteamGridDB hero fetch failed for: {Title}", game.Title);

                    lock (_statusLock)
                    {
                        _sgdbStatus = _sgdbStatus with { Processed = processed };
                    }
                }
            }
        }
        finally
        {
            lock (_statusLock)
            {
                _sgdbStatus = new SteamGridDbScanStatus(false, null, 0, 0, 0);
            }
        }

        return count;
    }

    private class SgdbResponse<T>
    {
        [JsonPropertyName("data")]
        public T? Data { get; set; }
    }

    private class SgdbGame
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }
    }

    private class SgdbImage
    {
        [JsonPropertyName("url")]
        public string? Url { get; set; }
    }

    public record ScanResult(int GamesFound, int GamesAdded, int GamesMissing);
    public record SteamGridDbScanStatus(bool IsRunning, string? CurrentGame, int Total, int Processed, int Matched);
}
