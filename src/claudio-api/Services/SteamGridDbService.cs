using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Claudio.Api.Data;
using Claudio.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class SteamGridDbService(
    IServiceScopeFactory scopeFactory,
    ClaudioConfig config,
    IHttpClientFactory httpClientFactory,
    ILogger<SteamGridDbService> logger)
{
    private readonly Channel<SteamGridDbWorkItem> _channel = Channel.CreateUnbounded<SteamGridDbWorkItem>();
    private readonly Lock _queueLock = new();
    private readonly HashSet<int> _scheduledGameIds = [];
    private bool _sweepQueued;
    private readonly Lock _statusLock = new();
    private SteamGridDbScanStatus _status = new(false, false, null, 0, 0, 0, null);

    public SteamGridDbScanStatus GetStatus()
    {
        lock (_statusLock)
        {
            return _status;
        }
    }

    public bool QueueGameHeroFetch(int gameId)
    {
        if (string.IsNullOrWhiteSpace(config.Steamgriddb.ApiKey))
            return false;

        lock (_queueLock)
        {
            if (!_scheduledGameIds.Add(gameId))
                return false;

            if (!_channel.Writer.TryWrite(new SteamGridDbWorkItem(GameId: gameId)))
            {
                _scheduledGameIds.Remove(gameId);
                return false;
            }

            UpdateQueuedFlagUnsafe();
            return true;
        }
    }

    public bool QueueMissingHeroSweep()
    {
        if (string.IsNullOrWhiteSpace(config.Steamgriddb.ApiKey))
            return false;

        lock (_queueLock)
        {
            if (_sweepQueued)
                return false;

            _sweepQueued = true;
            if (!_channel.Writer.TryWrite(new SteamGridDbWorkItem(RunSweep: true)))
            {
                _sweepQueued = false;
                return false;
            }

            UpdateQueuedFlagUnsafe();
            return true;
        }
    }

    public async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        await foreach (var workItem in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            if (workItem.RunSweep)
            {
                lock (_queueLock)
                {
                    _sweepQueued = false;
                    UpdateQueuedFlagUnsafe();
                }

                await ProcessSweepAsync(stoppingToken);
                continue;
            }

            try
            {
                await ProcessSingleGameAsync(workItem.GameId!.Value, stoppingToken);
            }
            finally
            {
                lock (_queueLock)
                {
                    _scheduledGameIds.Remove(workItem.GameId!.Value);
                    UpdateQueuedFlagUnsafe();
                }
            }
        }
    }

    private async Task ProcessSweepAsync(CancellationToken stoppingToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, config.Steamgriddb.TimeoutSecs)));

        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var gameIds = await db.Games
                .AsNoTracking()
                .Where(g => g.IgdbId != null && g.HeroUrl == null && !g.IsMissing)
                .OrderBy(g => g.Title)
                .Select(g => g.Id)
                .ToListAsync(timeoutCts.Token);

            UpdateStatus(new SteamGridDbScanStatus(true, GetQueuedFlag(), null, gameIds.Count, 0, 0, null));
            if (gameIds.Count == 0)
            {
                UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, null));
                return;
            }

            var client = CreateClient();
            var matched = 0;
            var processed = 0;

            foreach (var gameId in gameIds)
            {
                timeoutCts.Token.ThrowIfCancellationRequested();
                var result = await TryFetchHeroAsync(gameId, client, timeoutCts.Token);
                processed++;
                if (result.Matched)
                    matched++;

                UpdateStatus(new SteamGridDbScanStatus(true, GetQueuedFlag(), result.Title, gameIds.Count, processed, matched, null));
                await Task.Delay(250, timeoutCts.Token);
            }

            if (matched > 0)
                logger.LogInformation("SteamGridDB: added hero images for {Count} games", matched);

            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, null));
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            var message = $"Timed out after {Math.Max(1, config.Steamgriddb.TimeoutSecs)} seconds.";
            logger.LogWarning("SteamGridDB job timed out after {TimeoutSeconds} seconds", Math.Max(1, config.Steamgriddb.TimeoutSecs));
            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, message));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "SteamGridDB hero fetch failed");
            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, ex.Message));
        }
    }

    private async Task ProcessSingleGameAsync(int gameId, CancellationToken stoppingToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, config.Steamgriddb.TimeoutSecs)));

        try
        {
            UpdateStatus(new SteamGridDbScanStatus(true, GetQueuedFlag(), null, 1, 0, 0, null));
            var result = await TryFetchHeroAsync(gameId, CreateClient(), timeoutCts.Token);
            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, null));

            if (result.Matched)
                logger.LogInformation("SteamGridDB: added hero image for {Title}", result.Title);
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            var message = $"Timed out after {Math.Max(1, config.Steamgriddb.TimeoutSecs)} seconds.";
            logger.LogWarning("SteamGridDB job timed out after {TimeoutSeconds} seconds", Math.Max(1, config.Steamgriddb.TimeoutSecs));
            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, message));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "SteamGridDB hero fetch failed for game {GameId}", gameId);
            UpdateStatus(new SteamGridDbScanStatus(false, GetQueuedFlag(), null, 0, 0, 0, ex.Message));
        }
    }

    private async Task<SteamGridDbResult> TryFetchHeroAsync(int gameId, HttpClient client, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = await db.Games.FirstOrDefaultAsync(g => g.Id == gameId, cancellationToken);
        if (game is null || game.IgdbId is null || game.IsMissing || game.HeroUrl is not null)
            return new SteamGridDbResult(game?.Title, false);

        UpdateStatus(GetStatus() with { CurrentGame = game.Title, Processed = 0, Matched = 0, LastError = null });

        var searchRes = await client.GetAsync(
            $"https://www.steamgriddb.com/api/v2/search/autocomplete/{Uri.EscapeDataString(game.Title)}",
            cancellationToken);
        if (!searchRes.IsSuccessStatusCode)
            return new SteamGridDbResult(game.Title, false);

        var searchJson = await searchRes.Content.ReadAsStringAsync(cancellationToken);
        var searchResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbGame>>>(searchJson);
        var sgdbGame = searchResult?.Data?.FirstOrDefault();
        if (sgdbGame is null)
            return new SteamGridDbResult(game.Title, false);

        var heroesRes = await client.GetAsync(
            $"https://www.steamgriddb.com/api/v2/heroes/game/{sgdbGame.Id}",
            cancellationToken);
        if (!heroesRes.IsSuccessStatusCode)
            return new SteamGridDbResult(game.Title, false);

        var heroesJson = await heroesRes.Content.ReadAsStringAsync(cancellationToken);
        var heroesResult = JsonSerializer.Deserialize<SgdbResponse<List<SgdbImage>>>(heroesJson);
        var heroUrl = heroesResult?.Data?.FirstOrDefault()?.Url;
        if (heroUrl is null)
            return new SteamGridDbResult(game.Title, false);

        game.HeroUrl = heroUrl;
        await db.SaveChangesAsync(cancellationToken);
        logger.LogInformation("SteamGridDB hero: {Title} -> {Url}", game.Title, heroUrl);
        return new SteamGridDbResult(game.Title, true);
    }

    private HttpClient CreateClient()
    {
        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);
        return client;
    }

    private bool GetQueuedFlag()
    {
        lock (_queueLock)
        {
            return _sweepQueued || _scheduledGameIds.Count > 0;
        }
    }

    private void UpdateQueuedFlagUnsafe()
    {
        lock (_statusLock)
        {
            _status = _status with { IsQueued = _sweepQueued || _scheduledGameIds.Count > 0 };
        }
    }

    private void UpdateStatus(SteamGridDbScanStatus status)
    {
        lock (_statusLock)
        {
            _status = status;
        }
    }

    private sealed record SteamGridDbWorkItem(int? GameId = null, bool RunSweep = false);
    private sealed record SteamGridDbResult(string? Title, bool Matched);

    private sealed class SgdbResponse<T>
    {
        [JsonPropertyName("data")]
        public T? Data { get; set; }
    }

    private sealed class SgdbGame
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }
    }

    private sealed class SgdbImage
    {
        [JsonPropertyName("url")]
        public string? Url { get; set; }
    }
}

public record SteamGridDbScanStatus(bool IsRunning, bool IsQueued, string? CurrentGame, int Total, int Processed, int Matched, string? LastError);

public class SteamGridDbBackgroundService(SteamGridDbService steamGridDbService) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        steamGridDbService.QueueMissingHeroSweep();
        await steamGridDbService.ProcessQueueAsync(stoppingToken);
    }
}
