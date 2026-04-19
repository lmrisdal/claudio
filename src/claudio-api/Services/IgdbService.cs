using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Claudio.Api.Data;
using Claudio.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class IgdbService(
    IServiceScopeFactory scopeFactory,
    ClaudioConfig config,
    IHttpClientFactory httpClientFactory,
    SteamGridDbService steamGridDbService,
    ILogger<IgdbService> logger)
{
    private string? _accessToken;
    private DateTime _tokenExpiry;
    private readonly Channel<bool> _channel = Channel.CreateUnbounded<bool>();
    private readonly Lock _queueLock = new();
    private bool _scanQueued;
    private readonly Lock _statusLock = new();
    private IgdbScanStatus _scanStatus = new(false, false, null, 0, 0, 0, null);

    public IgdbScanStatus GetScanStatus()
    {
        lock (_statusLock)
        {
            return _scanStatus;
        }
    }

    public bool QueueScan()
    {
        EnsureConfigured();

        lock (_queueLock)
        {
            if (_scanQueued || GetScanStatus().IsRunning)
                return false;

            _scanQueued = true;
            if (!_channel.Writer.TryWrite(true))
            {
                _scanQueued = false;
                return false;
            }

            UpdateStatus(GetScanStatus() with { IsQueued = true, LastError = null });
            return true;
        }
    }

    public async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        await foreach (var _ in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            lock (_queueLock)
            {
                _scanQueued = false;
            }

            UpdateStatus(GetScanStatus() with { IsQueued = false });

            try
            {
                await RunQueuedScanAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                UpdateStatus(new IgdbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, null));
                break;
            }
        }
    }

    public async Task<IgdbScanResult> ScanAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        return await RunScanAsync(cancellationToken);
    }

    public async Task<List<IgdbCandidate>> SearchCandidatesAsync(string query, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var (title, year, _) = ParseFolderName(query);
        return await SearchIgdbAsync(title, year, cancellationToken);
    }

    public async Task ApplyMatchAsync(int gameId, long igdbId, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var game = await db.Games.FindAsync([gameId], cancellationToken)
            ?? throw new InvalidOperationException("Game not found.");

        var candidate = await FetchByIdAsync(igdbId, cancellationToken)
            ?? throw new InvalidOperationException("IGDB game not found.");

        ApplyCandidate(game, candidate);
        await db.SaveChangesAsync(cancellationToken);

        steamGridDbService.QueueGameHeroFetch(game.Id);
        logger.LogInformation("Matched: {Title} -> IGDB #{IgdbId}", game.Title, igdbId);
    }

    private async Task RunQueuedScanAsync(CancellationToken stoppingToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, config.Igdb.TimeoutSecs)));

        try
        {
            await RunScanAsync(timeoutCts.Token);
            UpdateStatus(new IgdbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, null));
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            var message = $"Timed out after {Math.Max(1, config.Igdb.TimeoutSecs)} seconds.";
            logger.LogWarning("IGDB scan timed out after {TimeoutSeconds} seconds", Math.Max(1, config.Igdb.TimeoutSecs));
            UpdateStatus(new IgdbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, message));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Background IGDB scan failed");
            UpdateStatus(new IgdbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, ex.Message));
        }
    }

    private async Task<IgdbScanResult> RunScanAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var gameIds = await db.Games
            .AsNoTracking()
            .Where(g => g.IgdbId == null && !g.IsMissing)
            .OrderBy(g => g.Title)
            .Select(g => g.Id)
            .ToListAsync(cancellationToken);

        var matched = 0;
        var skipped = 0;
        UpdateStatus(new IgdbScanStatus(true, GetQueuedFlag(), null, gameIds.Count, 0, 0, null));

        foreach (var gameId in gameIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            using var gameScope = scopeFactory.CreateScope();
            var gameDb = gameScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var game = await gameDb.Games.FirstOrDefaultAsync(g => g.Id == gameId && g.IgdbId == null && !g.IsMissing, cancellationToken);
            if (game is null)
            {
                skipped++;
                UpdateStatus(GetScanStatus() with { Processed = matched + skipped });
                continue;
            }

            UpdateStatus(GetScanStatus() with { CurrentGame = game.Title, LastError = null });

            try
            {
                var candidate = await FindCandidateAsync(game, cancellationToken);
                if (candidate is null)
                {
                    logger.LogInformation("No IGDB match for: {Title} ({Platform})", game.Title, game.Platform);
                    skipped++;
                    UpdateStatus(GetScanStatus() with { Processed = matched + skipped });
                    continue;
                }

                logger.LogInformation("Matched: {Title} -> {IgdbName} (IGDB #{IgdbId})", game.Title, candidate.Name, candidate.IgdbId);
                ApplyCandidate(game, candidate);
                await gameDb.SaveChangesAsync(cancellationToken);
                steamGridDbService.QueueGameHeroFetch(game.Id);

                matched++;
                UpdateStatus(GetScanStatus() with { Matched = matched, Processed = matched + skipped });
                await Task.Delay(300, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to fetch IGDB data for: {Title}", game.Title);
                skipped++;
                UpdateStatus(GetScanStatus() with { Processed = matched + skipped });
            }
        }

        logger.LogInformation(
            "IGDB scan complete: {Matched} matched, {Skipped} skipped out of {Total}",
            matched,
            skipped,
            gameIds.Count);

        return new IgdbScanResult(gameIds.Count, matched, skipped);
    }

    private async Task<IgdbCandidate?> FindCandidateAsync(Game game, CancellationToken cancellationToken)
    {
        var (cleanedTitle, year, igdbId) = ParseFolderName(game.FolderName);

        if (igdbId.HasValue)
        {
            var byId = await FetchByIdAsync(igdbId.Value, cancellationToken);
            if (byId is null)
                logger.LogInformation("IGDB ID {IgdbId} not found for: {Title}", igdbId.Value, game.Title);
            return byId;
        }

        var candidates = await SearchIgdbAsync(cleanedTitle, year, cancellationToken);
        if (candidates.Count == 0)
            return null;

        return SelectBestCandidate(candidates, cleanedTitle, game.Platform);
    }

    private static void ApplyCandidate(Game game, IgdbCandidate candidate)
    {
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
    }

    private bool GetQueuedFlag()
    {
        lock (_queueLock)
        {
            return _scanQueued;
        }
    }

    private void UpdateStatus(IgdbScanStatus status)
    {
        lock (_statusLock)
        {
            _scanStatus = status;
        }
    }

    private static (string Title, int? Year, long? IgdbId) ParseFolderName(string title)
    {
        long? igdbId = null;
        int? year = null;

        if (Endpoints.GameEndpoints.IsArchiveFile(title))
            title = Path.GetFileNameWithoutExtension(title);

        var igdbMatch = Regex.Match(title, @"\(?igdb-(\d+)\)?");
        if (igdbMatch.Success)
        {
            igdbId = long.Parse(igdbMatch.Groups[1].Value);
            title = title.Remove(igdbMatch.Index, igdbMatch.Length).Trim();
        }

        var yearMatch = Regex.Match(title, @"\((\d{4})\)");
        if (yearMatch.Success)
        {
            year = int.Parse(yearMatch.Groups[1].Value);
            title = title.Remove(yearMatch.Index, yearMatch.Length).Trim();
        }

        title = Regex.Replace(title, @"\([^)]*\)", "").Trim();
        var cleaned = title.Replace('.', ' ').Replace('-', ' ').Trim();
        return (cleaned, year, igdbId);
    }

    private static IgdbCandidate SelectBestCandidate(List<IgdbCandidate> candidates, string cleanedTitle, string platform)
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

    private static bool ShouldReplaceCover(Game game, long newIgdbId)
    {
        if (string.IsNullOrEmpty(game.CoverUrl))
            return true;
        if (game.IgdbId != newIgdbId)
            return true;
        return game.CoverUrl.StartsWith("https://images.igdb.com", StringComparison.OrdinalIgnoreCase);
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(config.Igdb.ClientId) || string.IsNullOrWhiteSpace(config.Igdb.ClientSecret))
            throw new InvalidOperationException("IGDB client_id and client_secret must be configured.");
    }

    private async Task<IgdbCandidate?> FetchByIdAsync(long igdbId, CancellationToken cancellationToken)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("Client-ID", config.Igdb.ClientId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var query = $"where id = {igdbId}; fields name,slug,summary,genres.name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,game_modes.name,collection.name,franchises.name,game_engines.name,platforms.name,platforms.slug; limit 1;";
        var response = await client.PostAsync("https://api.igdb.com/v4/games", new StringContent(query), cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        var results = JsonSerializer.Deserialize<List<IgdbGame>>(json);
        if (results is null || results.Count == 0)
            return null;

        return ToCandidate(results[0]);
    }

    private async Task<List<IgdbCandidate>> SearchIgdbAsync(string title, int? year, CancellationToken cancellationToken)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
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

        var response = await client.PostAsync("https://api.igdb.com/v4/games", new StringContent(query), cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
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
            if (string.IsNullOrEmpty(developer))
                developer = null;
            if (string.IsNullOrEmpty(publisher))
                publisher = null;
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

        return new IgdbCandidate(
            match.Id,
            match.Name ?? "",
            match.Slug,
            match.Summary,
            genre,
            releaseYear,
            coverUrl,
            developer,
            publisher,
            gameMode,
            series,
            franchise,
            gameEngine,
            platform,
            platformSlug);
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (_accessToken is not null && DateTime.UtcNow < _tokenExpiry)
            return _accessToken;

        var client = httpClientFactory.CreateClient();
        var response = await client.PostAsync(
            $"https://id.twitch.tv/oauth2/token?client_id={config.Igdb.ClientId}&client_secret={config.Igdb.ClientSecret}&grant_type=client_credentials",
            null,
            cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        var token = JsonSerializer.Deserialize<TwitchTokenResponse>(json)!;

        _accessToken = token.AccessToken;
        _tokenExpiry = DateTime.UtcNow.AddSeconds(token.ExpiresIn - 60);
        return _accessToken;
    }

    public record IgdbScanResult(int Total, int Matched, int Skipped);
    public record IgdbScanStatus(bool IsRunning, bool IsQueued, string? CurrentGame, int Total, int Processed, int Matched, string? LastError);
    public record IgdbCandidate(
        long IgdbId,
        string Name,
        string? Slug,
        string? Summary,
        string? Genre,
        int? ReleaseYear,
        string? CoverUrl,
        string? Developer,
        string? Publisher,
        string? GameMode,
        string? Series,
        string? Franchise,
        string? GameEngine,
        string? Platform,
        string? PlatformSlug);

    private sealed class TwitchTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }
    }

    private sealed class IgdbGame
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
    }

    private sealed class IgdbNamedEntity
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("slug")]
        public string? Slug { get; set; }
    }

    private sealed class IgdbCover
    {
        [JsonPropertyName("image_id")]
        public string? ImageId { get; set; }
    }

    private sealed class IgdbInvolvedCompany
    {
        [JsonPropertyName("company")]
        public IgdbNamedEntity? Company { get; set; }

        [JsonPropertyName("developer")]
        public bool Developer { get; set; }

        [JsonPropertyName("publisher")]
        public bool Publisher { get; set; }
    }
}

public class IgdbBackgroundService(IgdbService igdbService) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await igdbService.ProcessQueueAsync(stoppingToken);
    }
}
