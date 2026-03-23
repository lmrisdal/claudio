using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Claudio.Api.Data;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class IgdbService(
    IServiceScopeFactory scopeFactory,
    ClaudioConfig config,
    IHttpClientFactory httpClientFactory,
    ILogger<IgdbService> logger)
{
    private string? _accessToken;
    private DateTime _tokenExpiry;
    private readonly Lock _statusLock = new();
    private IgdbScanStatus _scanStatus = new(false, null, 0, 0, 0);

    public IgdbScanStatus GetScanStatus()
    {
        lock (_statusLock) { return _scanStatus; }
    }

    public void StartScanInBackground()
    {
        lock (_statusLock)
        {
            if (_scanStatus.IsRunning)
                throw new InvalidOperationException("IGDB scan is already running.");
            _scanStatus = new IgdbScanStatus(true, null, 0, 0, 0);
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await ScanAsync();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Background IGDB scan failed");
                lock (_statusLock)
                {
                    _scanStatus = _scanStatus with { IsRunning = false };
                }
            }
        });
    }

    public async Task<IgdbScanResult> ScanAsync()
    {
        if (string.IsNullOrEmpty(config.Igdb.ClientId) || string.IsNullOrEmpty(config.Igdb.ClientSecret))
            throw new InvalidOperationException("IGDB client_id and client_secret must be configured.");

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var games = await db.Games
            .Where(g => g.IgdbId == null && !g.IsMissing)
            .ToListAsync();

        var matched = 0;
        var skipped = 0;

        lock (_statusLock)
        {
            _scanStatus = new IgdbScanStatus(true, null, games.Count, 0, 0);
        }

        foreach (var game in games)
        {
            lock (_statusLock)
            {
                _scanStatus = _scanStatus with { CurrentGame = game.Title };
            }

            try
            {
                var (cleanedTitle, year, igdbId) = ParseFolderName(game.FolderName);

                IgdbCandidate? result;
                if (igdbId.HasValue)
                {
                    result = await FetchByIdAsync(igdbId.Value);
                    if (result is null)
                    {
                        logger.LogInformation("IGDB ID {IgdbId} not found for: {Title}", igdbId.Value, game.Title);
                        skipped++;
                        continue;
                    }
                }
                else
                {
                    var candidates = await SearchIgdbAsync(cleanedTitle, year);
                    if (candidates.Count == 0)
                    {
                        logger.LogInformation("No IGDB match for: {Title} ({Platform})", game.Title, game.Platform);
                        skipped++;
                        continue;
                    }

                    result = SelectBestCandidate(candidates, cleanedTitle, game.Platform);
                }

                logger.LogInformation("Matched: {Title} -> {IgdbName} (IGDB #{IgdbId})", game.Title, result.Name, result.IgdbId);
                game.Title = result.Name;
                if (ShouldReplaceCover(game, result.IgdbId))
                    game.CoverUrl = result.CoverUrl;
                game.IgdbId = result.IgdbId;
                game.IgdbSlug = result.Slug;
                game.Summary = result.Summary;
                game.Genre = result.Genre;
                game.ReleaseYear = result.ReleaseYear;
                game.Developer = result.Developer;
                game.Publisher = result.Publisher;
                game.GameMode = result.GameMode;
                game.Series = result.Series;
                game.Franchise = result.Franchise;
                game.GameEngine = result.GameEngine;
                matched++;
                await db.SaveChangesAsync();

                lock (_statusLock)
                {
                    _scanStatus = _scanStatus with { Matched = matched, Processed = matched + skipped };
                }

                // Rate limit: IGDB allows 4 requests/second
                await Task.Delay(300);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to fetch IGDB data for: {Title}", game.Title);
                skipped++;

                lock (_statusLock)
                {
                    _scanStatus = _scanStatus with { Processed = matched + skipped };
                }
            }
        }

        lock (_statusLock)
        {
            _scanStatus = new IgdbScanStatus(false, null, 0, 0, 0);
        }

        logger.LogInformation("IGDB scan complete: {Matched} matched, {Skipped} skipped out of {Total}",
            matched, skipped, games.Count);

        return new IgdbScanResult(games.Count, matched, skipped);
    }

    public async Task<List<IgdbCandidate>> SearchCandidatesAsync(string query)
    {
        EnsureConfigured();
        var (title, year, _) = ParseFolderName(query);
        return await SearchIgdbAsync(title, year);
    }

    private static (string Title, int? Year, long? IgdbId) ParseFolderName(string title)
    {
        long? igdbId = null;
        int? year = null;

        // Strip file extension for standalone archives
        var ext = Path.GetExtension(title);
        if (Endpoints.GameEndpoints.IsArchiveFile(title))
            title = Path.GetFileNameWithoutExtension(title);

        // Extract igdb-NNNNN tag (with or without parentheses)
        var igdbMatch = Regex.Match(title, @"\(?igdb-(\d+)\)?");
        if (igdbMatch.Success)
        {
            igdbId = long.Parse(igdbMatch.Groups[1].Value);
            title = title.Remove(igdbMatch.Index, igdbMatch.Length).Trim();
        }

        // Extract (YYYY) year — keep it for search filtering
        var yearMatch = Regex.Match(title, @"\((\d{4})\)");
        if (yearMatch.Success)
        {
            year = int.Parse(yearMatch.Groups[1].Value);
            title = title.Remove(yearMatch.Index, yearMatch.Length).Trim();
        }

        // Strip all remaining parenthesized parts (e.g. region, language, enhancement tags)
        title = Regex.Replace(title, @"\([^)]*\)", "").Trim();

        // Replace periods and dashes with spaces
        var cleaned = title.Replace('.', ' ').Replace('-', ' ').Trim();

        return (cleaned, year, igdbId);
    }

    private static IgdbCandidate SelectBestCandidate(
        List<IgdbCandidate> candidates,
        string cleanedTitle,
        string platform)
    {
        var expectedPlatformSlug = NormalizePlatformSlug(platform);

        return candidates
            .OrderByDescending(c => CandidateHasPlatformSlug(c, expectedPlatformSlug))
            .ThenByDescending(c => string.Equals(c.Name, cleanedTitle, StringComparison.OrdinalIgnoreCase))
            .First();
    }

    private static bool CandidateHasPlatformSlug(IgdbCandidate candidate, string expectedPlatformSlug)
    {
        if (string.IsNullOrWhiteSpace(expectedPlatformSlug) || string.IsNullOrWhiteSpace(candidate.PlatformSlug))
            return false;

        return candidate.PlatformSlug
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Any(slug => string.Equals(slug, expectedPlatformSlug, StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizePlatformSlug(string platform) =>
        string.Equals(platform, "pc", StringComparison.OrdinalIgnoreCase)
            ? "win"
            : platform.Trim().ToLowerInvariant();

    public async Task ApplyMatchAsync(int gameId, long igdbId)
    {
        EnsureConfigured();

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var game = await db.Games.FindAsync(gameId)
            ?? throw new InvalidOperationException("Game not found.");

        // Fetch the specific IGDB game by ID
        var candidate = await FetchByIdAsync(igdbId)
            ?? throw new InvalidOperationException("IGDB game not found.");

        game.Title = candidate.Name;
        if (ShouldReplaceCover(game, candidate.IgdbId))
            game.CoverUrl = candidate.CoverUrl;
        game.IgdbId = candidate.IgdbId;
        game.IgdbSlug = candidate.Slug;
        game.Summary = candidate.Summary;
        game.Genre = candidate.Genre;
        game.ReleaseYear = candidate.ReleaseYear;
        game.Developer = candidate.Developer;
        game.Publisher = candidate.Publisher;
        game.GameMode = candidate.GameMode;
        game.Series = candidate.Series;
        game.Franchise = candidate.Franchise;
        game.GameEngine = candidate.GameEngine;
        await db.SaveChangesAsync();

        logger.LogInformation("Matched: {Title} -> IGDB #{IgdbId}", game.Title, igdbId);
    }

    /// Replace cover if: no existing cover, existing cover is from IGDB, or the IGDB ID changed.
    private static bool ShouldReplaceCover(Game game, long newIgdbId)
    {
        if (string.IsNullOrEmpty(game.CoverUrl)) return true;
        if (game.IgdbId != newIgdbId) return true;
        return game.CoverUrl.StartsWith("https://images.igdb.com", StringComparison.OrdinalIgnoreCase);
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrEmpty(config.Igdb.ClientId) || string.IsNullOrEmpty(config.Igdb.ClientSecret))
            throw new InvalidOperationException("IGDB client_id and client_secret must be configured.");
    }

    private async Task<IgdbCandidate?> FetchByIdAsync(long igdbId)
    {
        var token = await GetAccessTokenAsync();
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("Client-ID", config.Igdb.ClientId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var query = $"where id = {igdbId}; fields name,slug,summary,genres.name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,game_modes.name,collection.name,franchises.name,game_engines.name,platforms.name,platforms.slug; limit 1;";
        var response = await client.PostAsync("https://api.igdb.com/v4/games", new StringContent(query));
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var results = JsonSerializer.Deserialize<List<IgdbGame>>(json);

        if (results is null || results.Count == 0) return null;
        return ToCandidate(results[0]);
    }

    private async Task<List<IgdbCandidate>> SearchIgdbAsync(string title, int? year = null)
    {
        var token = await GetAccessTokenAsync();
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("Client-ID", config.Igdb.ClientId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var searchTitle = title.Replace("\"", "\\\"");
        var whereClause = "";
        if (year.HasValue)
        {
            var start = new DateTimeOffset(year.Value, 1, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();
            var end = new DateTimeOffset(year.Value, 12, 31, 23, 59, 59, TimeSpan.Zero).ToUnixTimeSeconds();
            whereClause = $" where first_release_date >= {start} & first_release_date <= {end};";
        }
        var query = $"""search "{searchTitle}"; fields name,slug,summary,genres.name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,game_modes.name,collection.name,franchises.name,game_engines.name,platforms.name,platforms.slug;{whereClause} limit 20;""";

        var response = await client.PostAsync(
            "https://api.igdb.com/v4/games",
            new StringContent(query));
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var results = JsonSerializer.Deserialize<List<IgdbGame>>(json);

        if (results is null || results.Count == 0)
            return [];

        return results.Select(ToCandidate).ToList();
    }

    private static IgdbCandidate ToCandidate(IgdbGame match)
    {
        string? coverUrl = null;
        if (match.Cover?.ImageId is not null)
            coverUrl = $"https://images.igdb.com/igdb/image/upload/t_cover_big/{match.Cover.ImageId}.jpg";

        string? genre = null;
        if (match.Genres is { Count: > 0 })
            genre = string.Join(", ", match.Genres.Select(g => g.Name));

        int? releaseYear = null;
        if (match.FirstReleaseDate > 0)
            releaseYear = DateTimeOffset.FromUnixTimeSeconds(match.FirstReleaseDate).Year;

        string? developer = null;
        string? publisher = null;
        if (match.InvolvedCompanies is { Count: > 0 })
        {
            developer = string.Join(", ", match.InvolvedCompanies
                .Where(c => c.Developer && c.Company?.Name is not null)
                .Select(c => c.Company!.Name));
            publisher = string.Join(", ", match.InvolvedCompanies
                .Where(c => c.Publisher && c.Company?.Name is not null)
                .Select(c => c.Company!.Name));
            if (string.IsNullOrEmpty(developer)) developer = null;
            if (string.IsNullOrEmpty(publisher)) publisher = null;
        }

        string? gameMode = null;
        if (match.GameModes is { Count: > 0 })
            gameMode = string.Join(", ", match.GameModes.Select(m => m.Name));

        var series = match.Collection?.Name;

        string? franchise = null;
        if (match.Franchises is { Count: > 0 })
            franchise = string.Join(", ", match.Franchises.Select(f => f.Name));

        string? gameEngine = null;
        if (match.GameEngines is { Count: > 0 })
            gameEngine = string.Join(", ", match.GameEngines.Select(e => e.Name));

        string? platform = null;
        if (match.Platforms is { Count: > 0 })
            platform = string.Join(", ", match.Platforms.Select(p => p.Name));

        string? platformSlug = null;
        if (match.Platforms is { Count: > 0 })
            platformSlug = string.Join(", ", match.Platforms.Select(p => p.Slug));

        return new IgdbCandidate(match.Id, match.Name ?? "", match.Slug, match.Summary, genre, releaseYear, coverUrl,
            developer, publisher, gameMode, series, franchise, gameEngine, platform, platformSlug);
    }

    private async Task<string> GetAccessTokenAsync()
    {
        if (_accessToken is not null && DateTime.UtcNow < _tokenExpiry)
            return _accessToken;

        var client = httpClientFactory.CreateClient();
        var response = await client.PostAsync(
            $"https://id.twitch.tv/oauth2/token?client_id={config.Igdb.ClientId}&client_secret={config.Igdb.ClientSecret}&grant_type=client_credentials",
            null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var token = JsonSerializer.Deserialize<TwitchTokenResponse>(json)!;

        _accessToken = token.AccessToken;
        _tokenExpiry = DateTime.UtcNow.AddSeconds(token.ExpiresIn - 60);

        return _accessToken;
    }

    public record IgdbScanResult(int Total, int Matched, int Skipped);
    public record IgdbScanStatus(bool IsRunning, string? CurrentGame, int Total, int Processed, int Matched);
    public record IgdbCandidate(
        long IgdbId, string Name, string? Slug, string? Summary, string? Genre, int? ReleaseYear, string? CoverUrl,
        string? Developer, string? Publisher, string? GameMode, string? Series, string? Franchise, string? GameEngine,
        string? Platform, string? PlatformSlug);

    private class TwitchTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }
    }

    private class IgdbGame
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("slug")]
        public string? Slug { get; set; }

        [JsonPropertyName("summary")]
        public string? Summary { get; set; }

        [JsonPropertyName("genres")]
        public List<IgdbNamedEntity>? Genres { get; set; }

        [JsonPropertyName("first_release_date")]
        public long FirstReleaseDate { get; set; }

        [JsonPropertyName("cover")]
        public IgdbCover? Cover { get; set; }

        [JsonPropertyName("involved_companies")]
        public List<IgdbInvolvedCompany>? InvolvedCompanies { get; set; }

        [JsonPropertyName("game_modes")]
        public List<IgdbNamedEntity>? GameModes { get; set; }

        [JsonPropertyName("collection")]
        public IgdbNamedEntity? Collection { get; set; }

        [JsonPropertyName("franchises")]
        public List<IgdbNamedEntity>? Franchises { get; set; }

        [JsonPropertyName("game_engines")]
        public List<IgdbNamedEntity>? GameEngines { get; set; }

        [JsonPropertyName("platforms")]
        public List<IgdbNamedEntity>? Platforms { get; set; }

        [JsonPropertyName("platform_slugs")]
        public List<IgdbNamedEntity>? PlatformSlugs { get; set; }
    }

    private class IgdbNamedEntity
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;
        [JsonPropertyName("slug")]
        public string? Slug { get; set; }
    }

    private class IgdbCover
    {
        [JsonPropertyName("image_id")]
        public string? ImageId { get; set; }
    }

    private class IgdbInvolvedCompany
    {
        [JsonPropertyName("company")]
        public IgdbNamedEntity? Company { get; set; }

        [JsonPropertyName("developer")]
        public bool Developer { get; set; }

        [JsonPropertyName("publisher")]
        public bool Publisher { get; set; }
    }
}
