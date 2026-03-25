using AwesomeAssertions;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Claudio.Api.Tests;

public class LibraryScanServiceTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"claudio-test-{Guid.NewGuid():N}");
    private readonly ServiceProvider _serviceProvider;
    private readonly ClaudioConfig _config;

    public LibraryScanServiceTests()
    {
        Directory.CreateDirectory(_tempDir);

        _config = new ClaudioConfig
        {
            Library = new LibraryConfig { LibraryPaths = [_tempDir] }
        };

        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlite($"Data Source={Path.Combine(_tempDir, "test.db")}"));
        services.AddSingleton(_config);
        services.AddHttpClient();
        _serviceProvider = services.BuildServiceProvider();

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();
    }

    private LibraryScanService CreateService()
    {
        return new LibraryScanService(
            _serviceProvider.GetRequiredService<IServiceScopeFactory>(),
            _config,
            _serviceProvider.GetRequiredService<IHttpClientFactory>(),
            new CompressionService(
                _serviceProvider.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<CompressionService>.Instance),
            new IgdbService(
                _serviceProvider.GetRequiredService<IServiceScopeFactory>(),
                _config,
                _serviceProvider.GetRequiredService<IHttpClientFactory>(),
                NullLogger<IgdbService>.Instance),
            NullLogger<LibraryScanService>.Instance);
    }

    private string CreatePlatformWithGames(string platform, params string[] games)
    {
        var platformDir = Path.Combine(_tempDir, platform);
        Directory.CreateDirectory(platformDir);
        foreach (var game in games)
        {
            var gameDir = Path.Combine(platformDir, game);
            Directory.CreateDirectory(gameDir);
            File.WriteAllText(Path.Combine(gameDir, "game.exe"), "dummy");
        }
        return platformDir;
    }

    [Test]
    public async Task Scan_FindsGamesAcrossPlatforms()
    {
        CreatePlatformWithGames("pc", "Doom", "Quake");
        CreatePlatformWithGames("ps2", "FFX");

        var service = CreateService();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(3);
        result.GamesAdded.Should().Be(3);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var games = await db.Games.ToListAsync();
        games.Should().HaveCount(3);
        games.Select(g => g.Platform).Distinct().Should().BeEquivalentTo(["pc", "ps2"]);
    }

    [Test]
    public async Task Scan_ExcludesPlatforms()
    {
        CreatePlatformWithGames("pc", "Doom");
        CreatePlatformWithGames("gba", "Pokemon");
        CreatePlatformWithGames("ps", "Crash");

        _config.Library.ExcludePlatforms = ["gba", "ps"];

        var service = CreateService();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(1);
        result.GamesAdded.Should().Be(1);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var games = await db.Games.ToListAsync();
        games.Should().ContainSingle().Which.Platform.Should().Be("pc");
    }

    [Test]
    public async Task Scan_ExcludePlatformsIsCaseInsensitive()
    {
        CreatePlatformWithGames("GBA", "Pokemon");
        CreatePlatformWithGames("pc", "Doom");

        _config.Library.ExcludePlatforms = ["gba"];

        var service = CreateService();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(1);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var games = await db.Games.ToListAsync();
        games.Should().ContainSingle().Which.Platform.Should().Be("pc");
    }

    [Test]
    public async Task Scan_NonexistentPath_ReturnsZero()
    {
        _config.Library.LibraryPaths = ["/nonexistent/path"];

        var service = CreateService();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(0);
        result.GamesAdded.Should().Be(0);
    }

    [Test]
    public async Task Scan_SkipsHiddenDirectories()
    {
        CreatePlatformWithGames("pc", "Doom", "__MACOSX", ".DS_Store");

        var service = CreateService();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(1);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var games = await db.Games.ToListAsync();
        games.Should().ContainSingle().Which.Title.Should().Be("Doom");
    }

    [Test]
    public async Task Scan_MarksMissingGames()
    {
        CreatePlatformWithGames("pc", "Doom");

        var service = CreateService();
        await service.ScanAsync();

        // Delete the game directory and re-scan
        Directory.Delete(Path.Combine(_tempDir, "pc", "Doom"), true);

        var result = await service.ScanAsync();
        result.GamesMissing.Should().Be(1);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var doom = await db.Games.FirstAsync(g => g.Title == "Doom");
        doom.IsMissing.Should().BeTrue();
    }

    [Test]
    public async Task Scan_RescanDoesNotDuplicate()
    {
        CreatePlatformWithGames("pc", "Doom");

        var service = CreateService();
        await service.ScanAsync();
        var result = await service.ScanAsync();

        result.GamesFound.Should().Be(1);
        result.GamesAdded.Should().Be(0);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var games = await db.Games.ToListAsync();
        games.Should().ContainSingle();
    }

    [Test]
    public async Task Scan_MultiplePaths()
    {
        var secondDir = Path.Combine(Path.GetTempPath(), $"claudio-test2-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(secondDir);
            var secondPlatformDir = Path.Combine(secondDir, "snes");
            Directory.CreateDirectory(secondPlatformDir);
            var gameDir = Path.Combine(secondPlatformDir, "Zelda");
            Directory.CreateDirectory(gameDir);
            File.WriteAllText(Path.Combine(gameDir, "rom.sfc"), "dummy");

            CreatePlatformWithGames("pc", "Doom");
            _config.Library.LibraryPaths = [_tempDir, secondDir];

            var service = CreateService();
            var result = await service.ScanAsync();

            result.GamesFound.Should().Be(2);
            result.GamesAdded.Should().Be(2);
        }
        finally
        {
            Directory.Delete(secondDir, true);
        }
    }

    [Test]
    public async Task Scan_ExcludedPlatformGamesMarkedMissing()
    {
        CreatePlatformWithGames("gba", "Pokemon");

        var service = CreateService();
        // First scan without exclusion
        await service.ScanAsync();

        // Now exclude gba and re-scan
        _config.Library.ExcludePlatforms = ["gba"];
        var result = await service.ScanAsync();

        result.GamesMissing.Should().Be(1);

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var pokemon = await db.Games.FirstAsync(g => g.Title == "Pokemon");
        pokemon.IsMissing.Should().BeTrue();
    }

    public void Dispose()
    {
        _serviceProvider.Dispose();
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }
}
