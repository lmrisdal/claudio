using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Api.Data;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class LibraryScanService(IServiceScopeFactory scopeFactory, ClaudioConfig config, IHttpClientFactory httpClientFactory, ILogger<LibraryScanService> logger)
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

        // Auto-fetch hero images from SteamGridDB
        if (!string.IsNullOrEmpty(config.Steamgriddb.ApiKey))
        {
            try
            {
                var heroCount = await FetchSteamGridDbHeroesAsync(db);
                if (heroCount > 0)
                    logger.LogInformation("SteamGridDB: added hero images for {Count} games", heroCount);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "SteamGridDB hero fetch failed");
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

    private async Task<int> FetchSteamGridDbHeroesAsync(AppDbContext db)
    {
        var games = await db.Games
            .Where(g => g.HeroUrl == null && !g.IsMissing)
            .ToListAsync();

        if (games.Count == 0) return 0;

        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var count = 0;
        foreach (var game in games)
        {
            try
            {
                // Search for the game on SteamGridDB
                var searchRes = await client.GetAsync(
                    $"https://www.steamgriddb.com/api/v2/search/autocomplete/{Uri.EscapeDataString(game.Title)}");
                if (!searchRes.IsSuccessStatusCode) continue;

                var searchJson = await searchRes.Content.ReadAsStringAsync();
                var searchResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbGame>>>(searchJson);
                var sgdbGame = searchResult?.Data?.FirstOrDefault();
                if (sgdbGame is null) continue;

                // Fetch heroes for the game
                var heroesRes = await client.GetAsync(
                    $"https://www.steamgriddb.com/api/v2/heroes/game/{sgdbGame.Id}");
                if (!heroesRes.IsSuccessStatusCode) continue;

                var heroesJson = await heroesRes.Content.ReadAsStringAsync();
                var heroesResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbImage>>>(heroesJson);
                var heroUrl = heroesResult?.Data?.FirstOrDefault()?.Url;
                if (heroUrl is null) continue;

                game.HeroUrl = heroUrl;
                count++;
                logger.LogInformation("SteamGridDB hero: {Title} -> {Url}", game.Title, heroUrl);

                // Rate limit
                await Task.Delay(250);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "SteamGridDB hero fetch failed for: {Title}", game.Title);
            }
        }

        if (count > 0) await db.SaveChangesAsync();
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
}
