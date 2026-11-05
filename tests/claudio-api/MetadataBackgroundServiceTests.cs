using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Claudio.Api.Data;
using Claudio.Api.Models;
using Claudio.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Claudio.Api.Tests;

public class MetadataBackgroundServiceTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"claudio-metadata-test-{Guid.NewGuid():N}");
    private readonly ServiceProvider _serviceProvider;
    private readonly ClaudioConfig _config;

    public MetadataBackgroundServiceTests()
    {
        Directory.CreateDirectory(_tempDir);

        _config = new ClaudioConfig
        {
            Database = new DatabaseConfig
            {
                SqlitePath = Path.Combine(_tempDir, "test.db"),
            },
            Igdb = new IgdbConfig
            {
                ClientId = "client-id",
                ClientSecret = "client-secret",
                TimeoutSecs = 1,
            },
            Steamgriddb = new SteamGridDbConfig
            {
                ApiKey = "steamgriddb-key",
                TimeoutSecs = 1,
            },
        };

        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlite($"Data Source={_config.Database.SqlitePath}"));
        _serviceProvider = services.BuildServiceProvider();

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();
    }

    [Test]
    public void QueueScan_DeduplicatesQueuedRequests()
    {
        var service = CreateIgdbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)))));

        service.QueueScan().Should().BeTrue();
        service.QueueScan().Should().BeFalse();
        service.GetScanStatus().IsQueued.Should().BeTrue();
    }

    [Test]
    public async Task ProcessQueueAsync_TimesOutHungIgdbRequests()
    {
        await SeedGameAsync(new Game { Title = "Doom", FolderName = "Doom", Platform = "win", FolderPath = "/games/Doom" });

        var service = CreateIgdbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler(async (request, cancellationToken) =>
        {
            if (request.RequestUri!.Host == "id.twitch.tv")
                return JsonResponse(new { access_token = "token", expires_in = 3600 });

            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("Unreachable");
        })));

        service.QueueScan().Should().BeTrue();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var processingTask = service.ProcessQueueAsync(cts.Token);

        await WaitForAsync(() => service.GetScanStatus().LastError is not null, TimeSpan.FromSeconds(4));

        var status = service.GetScanStatus();
        status.IsRunning.Should().BeFalse();
        status.LastError.Should().Contain("Timed out");

        await cts.CancelAsync();
        await AwaitCancellationAsync(processingTask);
    }

    [Test]
    public async Task ProcessQueueAsync_TimesOutHungSteamGridDbRequests()
    {
        await SeedGameAsync(new Game
        {
            Title = "Doom",
            FolderName = "Doom",
            Platform = "win",
            FolderPath = "/games/Doom",
            IgdbId = 123,
        });

        var service = CreateSteamGridDbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("Unreachable");
        })));

        service.QueueMissingHeroSweep().Should().BeTrue();
        service.QueueMissingHeroSweep().Should().BeFalse();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var processingTask = service.ProcessQueueAsync(cts.Token);

        await WaitForAsync(() => service.GetStatus().LastError is not null, TimeSpan.FromSeconds(4));

        var status = service.GetStatus();
        status.IsRunning.Should().BeFalse();
        status.LastError.Should().Contain("Timed out");

        await cts.CancelAsync();
        await AwaitCancellationAsync(processingTask);
    }

    [Test]
    public async Task SearchCandidatesAsync_SendsIgdbSearchQueryWithoutEscapedOuterQuotes()
    {
        string? requestBody = null;
        var service = CreateIgdbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler(async (request, _) =>
        {
            if (request.RequestUri!.Host == "id.twitch.tv")
                return JsonResponse(new { access_token = "token", expires_in = 3600 });

            requestBody = await request.Content!.ReadAsStringAsync();
            return JsonResponse(Array.Empty<object>());
        })));

        await service.SearchCandidatesAsync("Bob's \"Game\"");

        requestBody.Should().NotBeNull();
        requestBody.Should().StartWith("search \"Bob's \\\"Game\\\"\";");
        requestBody.Should().NotContain("search \\\"Bob");
    }

    [Test]
    public async Task ScanAsync_DoesNotRetryUnmatchedGamesUntilRetryIntervalPasses()
    {
        var gameId = await SeedGameAsync(new Game { Title = "Obscure", FolderName = "Obscure", Platform = "n64", FolderPath = "/games/Obscure" });
        var gameSearches = 0;
        var service = CreateIgdbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler((request, _) =>
        {
            if (request.RequestUri!.Host == "id.twitch.tv")
                return Task.FromResult(JsonResponse(new { access_token = "token", expires_in = 3600 }));

            Interlocked.Increment(ref gameSearches);
            return Task.FromResult(JsonResponse(Array.Empty<object>()));
        })));

        (await service.ScanAsync()).Total.Should().Be(1);
        (await GetGameAsync(gameId)).IgdbAttemptedAt.Should().NotBeNull();

        (await service.ScanAsync()).Total.Should().Be(0);
        gameSearches.Should().Be(1);

        await UpdateGameAsync(gameId, g => g.IgdbAttemptedAt = DateTime.UtcNow - MetadataRetryPolicy.RetryAfter - TimeSpan.FromHours(1));
        (await service.ScanAsync()).Total.Should().Be(1);
        gameSearches.Should().Be(2);
    }

    [Test]
    public async Task ScanAsync_ForceRetriesRecentlyFailedGames()
    {
        await SeedGameAsync(new Game
        {
            Title = "Obscure",
            FolderName = "Obscure",
            Platform = "n64",
            FolderPath = "/games/Obscure",
            IgdbAttemptedAt = DateTime.UtcNow,
        });
        var service = CreateIgdbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler((request, _) =>
            Task.FromResult(request.RequestUri!.Host == "id.twitch.tv"
                ? JsonResponse(new { access_token = "token", expires_in = 3600 })
                : JsonResponse(Array.Empty<object>())))));

        (await service.ScanAsync()).Total.Should().Be(0);
        (await service.ScanAsync(force: true)).Total.Should().Be(1);
    }

    [Test]
    public async Task MissingHeroSweep_DoesNotRetryGamesWithoutHeroUntilRetryIntervalPasses()
    {
        var gameId = await SeedGameAsync(new Game
        {
            Title = "Obscure",
            FolderName = "Obscure",
            Platform = "n64",
            FolderPath = "/games/Obscure",
            IgdbId = 123,
        });
        var requests = 0;
        var service = CreateSteamGridDbService(new StubHttpClientFactory(new AsyncStubHttpMessageHandler((_, _) =>
        {
            Interlocked.Increment(ref requests);
            return Task.FromResult(JsonResponse(new { data = Array.Empty<object>() }));
        })));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var processingTask = service.ProcessQueueAsync(cts.Token);

        service.QueueMissingHeroSweep().Should().BeTrue();
        await WaitForAsync(() => GetGameAsync(gameId).Result.HeroAttemptedAt is not null, TimeSpan.FromSeconds(5));
        await WaitForAsync(() => !service.GetStatus().IsRunning && !service.GetStatus().IsQueued, TimeSpan.FromSeconds(5));
        var requestsAfterFirstSweep = requests;

        service.QueueMissingHeroSweep().Should().BeTrue();
        await WaitForAsync(() => !service.GetStatus().IsQueued, TimeSpan.FromSeconds(5));
        await WaitForAsync(() => !service.GetStatus().IsRunning, TimeSpan.FromSeconds(5));
        await Task.Delay(300);

        requests.Should().Be(requestsAfterFirstSweep);
        (await GetGameAsync(gameId)).HeroUrl.Should().BeNull();

        await cts.CancelAsync();
        await AwaitCancellationAsync(processingTask);
    }

    private IgdbService CreateIgdbService(IHttpClientFactory httpClientFactory)
    {
        var steamGridDbService = CreateSteamGridDbService(httpClientFactory);
        return new IgdbService(
            _serviceProvider.GetRequiredService<IServiceScopeFactory>(),
            _config,
            httpClientFactory,
            steamGridDbService,
            NullLogger<IgdbService>.Instance);
    }

    private SteamGridDbService CreateSteamGridDbService(IHttpClientFactory httpClientFactory)
    {
        return new SteamGridDbService(
            _serviceProvider.GetRequiredService<IServiceScopeFactory>(),
            _config,
            httpClientFactory,
            NullLogger<SteamGridDbService>.Instance);
    }

    private async Task<int> SeedGameAsync(Game game)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Games.Add(game);
        await db.SaveChangesAsync();
        return game.Id;
    }

    private async Task<Game> GetGameAsync(int id)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Games.AsNoTracking().SingleAsync(g => g.Id == id);
    }

    private async Task UpdateGameAsync(int id, Action<Game> update)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = await db.Games.SingleAsync(g => g.Id == id);
        update(game);
        await db.SaveChangesAsync();
    }

    private static async Task WaitForAsync(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
                return;

            await Task.Delay(50);
        }

        throw new TimeoutException("Condition was not met before timeout.");
    }

    private static HttpResponseMessage JsonResponse<T>(T payload)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(payload),
        };
    }

    private static async Task AwaitCancellationAsync(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
        }
    }

    public void Dispose()
    {
        _serviceProvider.Dispose();
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class AsyncStubHttpMessageHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            responder(request, cancellationToken);
    }
}
