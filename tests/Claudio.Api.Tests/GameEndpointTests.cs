using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AwesomeAssertions;
using Claudio.Api.Data;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Microsoft.Extensions.DependencyInjection;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(GameEndpointTests))]
public class GameEndpointTests : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly ClaudioWebApplicationFactory _factory = new();
    private readonly string _gamesDir;

    public GameEndpointTests()
    {
        _gamesDir = Path.Combine(Path.GetTempPath(), $"claudio-games-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_gamesDir);
    }

    private async Task<HttpClient> CreateAuthenticatedClientAsync()
    {
        var client = _factory.CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "testuser", password = "password123" });
        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = "testuser",
            ["password"] = "password123",
            ["client_id"] = "claudio-spa",
            ["scope"] = "openid profile offline_access roles",
        });
        var tokenResponse = await client.PostAsync("/connect/token", tokenRequest);
        var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenJson.GetProperty("access_token").GetString()!);
        return client;
    }

    private async Task SeedGameAsync(string title, string platform, string folderName, string? folderPath = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Games.Add(new Game
        {
            Title = title,
            Platform = platform,
            FolderName = folderName,
            FolderPath = folderPath ?? Path.Combine(_gamesDir, platform, folderName),
            InstallType = InstallType.Portable,
            SizeBytes = 1024,
        });
        await db.SaveChangesAsync();
    }

    // --- GetAll ---

    [Test]
    public async Task GetAll_ReturnsAllGames()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        await SeedGameAsync("Quake", "pc", "Quake");
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var games = await response.Content.ReadFromJsonAsync<List<GameDto>>(JsonOptions);
        games!.Count.Should().Be(2);
    }

    [Test]
    public async Task GetAll_FilterByPlatform()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        await SeedGameAsync("Pokemon", "gba", "Pokemon");
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games?platform=pc");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var games = await response.Content.ReadFromJsonAsync<List<GameDto>>(JsonOptions);
        games!.Should().ContainSingle().Which.Platform.Should().Be("pc");
    }

    [Test]
    public async Task GetAll_SearchByTitle()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        await SeedGameAsync("Quake", "pc", "Quake");
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games?search=oom");

        var games = await response.Content.ReadFromJsonAsync<List<GameDto>>(JsonOptions);
        games!.Should().ContainSingle().Which.Title.Should().Be("Doom");
    }

    [Test]
    public async Task GetAll_ReturnsOrderedByTitle()
    {
        await SeedGameAsync("Zelda", "snes", "Zelda");
        await SeedGameAsync("Aladdin", "genesis", "Aladdin");
        await SeedGameAsync("Mario", "nes", "Mario");
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games");

        var games = await response.Content.ReadFromJsonAsync<List<GameDto>>(JsonOptions);
        games!.Select(g => g.Title).Should().BeInAscendingOrder();
    }

    [Test]
    public async Task GetAll_WithoutAuth_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/games");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- GetById ---

    [Test]
    public async Task GetById_ExistingGame_ReturnsGame()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var game = await response.Content.ReadFromJsonAsync<GameDto>(JsonOptions);
        game!.Title.Should().Be("Doom");
        game.Platform.Should().Be("pc");
    }

    [Test]
    public async Task GetById_NonexistentGame_Returns404()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/999");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // --- BrowseGameFiles ---

    [Test]
    public async Task BrowseGameFiles_ListsDirectoryContents()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "dummy");
        File.WriteAllText(Path.Combine(gameDir, "readme.txt"), "info");
        Directory.CreateDirectory(Path.Combine(gameDir, "data"));

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/browse");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        var entries = result.GetProperty("entries");
        entries.GetArrayLength().Should().BeGreaterThanOrEqualTo(3);
    }

    [Test]
    public async Task BrowseGameFiles_FiltersHiddenFiles()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "CleanGame");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "dummy");
        Directory.CreateDirectory(Path.Combine(gameDir, "__MACOSX"));
        File.WriteAllText(Path.Combine(gameDir, ".DS_Store"), "");

        await SeedGameAsync("CleanGame", "pc", "CleanGame", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/browse");

        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        var entries = result.GetProperty("entries");
        var names = Enumerable.Range(0, entries.GetArrayLength())
            .Select(i => entries[i].GetProperty("name").GetString())
            .ToList();

        names.Should().NotContain("__MACOSX");
        names.Should().NotContain(".DS_Store");
        names.Should().Contain("game.exe");
    }

    [Test]
    public async Task BrowseGameFiles_PathTraversal_ReturnsBadRequest()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "TraversalGame");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "dummy");

        await SeedGameAsync("TraversalGame", "pc", "TraversalGame", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/browse?path=../../etc");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task BrowseGameFiles_NonexistentGame_Returns404()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/999/browse");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // --- Emulation ---

    [Test]
    public async Task GetEmulationInfo_SupportedPlatform_ReturnsSupported()
    {
        var gameDir = Path.Combine(_gamesDir, "gba", "Pokemon");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "pokemon.gba"), "rom-data");

        await SeedGameAsync("Pokemon", "gba", "Pokemon", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/emulation");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var info = await response.Content.ReadFromJsonAsync<JsonElement>();
        info.GetProperty("supported").GetBoolean().Should().BeTrue();
        info.GetProperty("core").GetString().Should().Be("gba");
    }

    [Test]
    public async Task GetEmulationInfo_UnsupportedPlatform_ReturnsNotSupported()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "doom.exe"), "exe");

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/emulation");

        var info = await response.Content.ReadFromJsonAsync<JsonElement>();
        info.GetProperty("supported").GetBoolean().Should().BeFalse();
    }

    [Test]
    public async Task GetEmulationInfo_NoRomFiles_ReturnsNotSupported()
    {
        var gameDir = Path.Combine(_gamesDir, "gba", "EmptyGame");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "readme.txt"), "no rom here");

        await SeedGameAsync("EmptyGame", "gba", "EmptyGame", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/emulation");

        var info = await response.Content.ReadFromJsonAsync<JsonElement>();
        info.GetProperty("supported").GetBoolean().Should().BeFalse();
    }

    // --- Download ticket ---

    [Test]
    public async Task Download_WithoutAuthOrTicket_Returns401()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/games/1/download");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task DownloadTicket_LooseFolder_IncludesFileManifest()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "exe");
        File.WriteAllText(Path.Combine(gameDir, "readme.txt"), "info");

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/games/1/download-ticket", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("ticket", out _).Should().BeTrue();
        json.TryGetProperty("files", out var files).Should().BeTrue();
        files.ValueKind.Should().Be(JsonValueKind.Array);
        files.GetArrayLength().Should().Be(2);
        var paths = Enumerable.Range(0, files.GetArrayLength())
            .Select(i => files[i].GetProperty("path").GetString())
            .ToList();
        paths.Should().Contain("game.exe");
        paths.Should().Contain("readme.txt");
    }

    [Test]
    public async Task DownloadTicket_StandaloneArchive_OmitsFileManifest()
    {
        var archivePath = Path.Combine(_gamesDir, "pc", "game.zip");
        Directory.CreateDirectory(Path.GetDirectoryName(archivePath)!);
        File.WriteAllText(archivePath, "fake-zip");

        await SeedGameAsync("ZipGame", "pc", "game.zip", archivePath);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/games/1/download-ticket", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("ticket", out _).Should().BeTrue();
        json.TryGetProperty("files", out var files).Should().BeTrue();
        files.ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Test]
    public async Task DownloadFile_WithAuth_ReturnsFile()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "binary-content");

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/download-files?path=game.exe");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadAsStringAsync();
        content.Should().Be("binary-content");
    }

    [Test]
    public async Task DownloadFile_WithoutAuth_Returns401()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/games/1/download-files?path=game.exe");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task DownloadFile_PathTraversal_ReturnsBadRequest()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "binary-content");

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/download-files?path=../../etc/passwd");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task DownloadFile_MissingFile_Returns404()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "Doom");
        Directory.CreateDirectory(gameDir);

        await SeedGameAsync("Doom", "pc", "Doom", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/download-files?path=nonexistent.exe");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task DownloadFilesManifest_LooseFolder_WithAuth_ReturnsFiles()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "ManifestGame");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "binary-content");
        File.WriteAllText(Path.Combine(gameDir, "readme.txt"), "hello");

        await SeedGameAsync("ManifestGame", "pc", "ManifestGame", gameDir);
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/games/1/download-files-manifest");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("files", out var files).Should().BeTrue();
        files.ValueKind.Should().Be(JsonValueKind.Array);
        files.GetArrayLength().Should().Be(2);
    }

    [Test]
    public async Task DownloadFilesManifest_WithoutAuth_Returns401()
    {
        await SeedGameAsync("Doom", "pc", "Doom");
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/games/1/download-files-manifest");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
        if (Directory.Exists(_gamesDir))
            Directory.Delete(_gamesDir, true);
    }
}
