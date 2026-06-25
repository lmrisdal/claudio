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

[NotInParallel(nameof(AdminEndpointTests))]
public class AdminEndpointTests : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly ClaudioWebApplicationFactory _factory = new();
    private readonly string _gamesDir;

    public AdminEndpointTests()
    {
        _gamesDir = Path.Combine(Path.GetTempPath(), $"claudio-admin-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_gamesDir);
    }

    private HttpClient CreateClient() => _factory.CreateClient();

    private async Task<int> SeedGameAsync(string title, string platform, string folderName, string? folderPath = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = new Game
        {
            Title = title,
            Platform = platform,
            FolderName = folderName,
            FolderPath = folderPath ?? Path.Combine(_gamesDir, platform, folderName),
            InstallType = InstallType.Portable,
            SizeBytes = 1024,
        };
        db.Games.Add(game);
        await db.SaveChangesAsync();
        return game.Id;
    }

    // --- Game update ---

    [Test]
    public async Task UpdateGame_ValidRequest_ReturnsUpdatedGame()
    {
        var gameId = await SeedGameAsync("Old Title", "pc", "OldTitle");
        var client = CreateClient();

        var response = await client.PutAsJsonAsync($"/api/admin/games/{gameId}", new
        {
            title = "New Title",
            summary = "A great game",
            genre = "FPS",
            releaseYear = 1993,
            coverUrl = (string?)null,
            heroUrl = (string?)null,
            installType = "portable",
            installerExe = (string?)null,
            gameExe = "doom.exe",
            developer = "id Software",
            publisher = "GT Interactive",
            gameMode = "Single-player",
            series = "Doom",
            franchise = (string?)null,
            gameEngine = "id Tech 1",
            igdbId = (long?)null,
            igdbSlug = (string?)null,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var game = await response.Content.ReadFromJsonAsync<GameDto>(JsonOptions);
        game!.Title.Should().Be("New Title");
        game.Developer.Should().Be("id Software");
        game.GameExe.Should().Be("doom.exe");
    }

    [Test]
    public async Task UpdateGame_IsProcessing_Returns409()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = new Game
        {
            Title = "Processing",
            Platform = "pc",
            FolderName = "Processing",
            FolderPath = "/tmp/processing",
            InstallType = InstallType.Portable,
            SizeBytes = 1024,
            IsProcessing = true,
        };
        db.Games.Add(game);
        await db.SaveChangesAsync();
        var gameId = game.Id;

        var client = CreateClient();

        var response = await client.PutAsJsonAsync($"/api/admin/games/{gameId}", new
        {
            title = "Updated",
            installType = "portable",
        });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task UpdateGame_NonexistentId_Returns404()
    {
        var client = CreateClient();

        var response = await client.PutAsJsonAsync("/api/admin/games/999", new
        {
            title = "Ghost",
            installType = "portable",
        });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // --- Delete game ---

    [Test]
    public async Task DeleteGame_RemovesFromDatabase()
    {
        var gameId = await SeedGameAsync("ToDelete", "pc", "ToDelete");
        var client = CreateClient();

        var response = await client.DeleteAsync($"/api/admin/games/{gameId}?deleteFiles=false");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = await db.Games.FindAsync(gameId);
        game.Should().BeNull();
    }

    [Test]
    public async Task DeleteGame_WithDeleteFiles_RemovesFromDisk()
    {
        var gameDir = Path.Combine(_gamesDir, "pc", "DiskDelete");
        Directory.CreateDirectory(gameDir);
        File.WriteAllText(Path.Combine(gameDir, "game.exe"), "dummy");
        var gameId = await SeedGameAsync("DiskDelete", "pc", "DiskDelete", gameDir);
        var client = CreateClient();

        var response = await client.DeleteAsync($"/api/admin/games/{gameId}?deleteFiles=true");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        Directory.Exists(gameDir).Should().BeFalse();
    }

    // --- Delete missing games ---

    [Test]
    public async Task DeleteMissingGames_RemovesOnlyMissing()
    {
        await SeedGameAsync("Present", "pc", "Present");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Games.Add(new Game
            {
                Title = "Gone",
                Platform = "pc",
                FolderName = "Gone",
                FolderPath = "/nonexistent",
                InstallType = InstallType.Portable,
                IsMissing = true,
            });
            await db.SaveChangesAsync();
        }

        var client = CreateClient();

        var response = await client.DeleteAsync("/api/admin/games/missing");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        result.GetProperty("removed").GetInt32().Should().Be(1);

        using var scope2 = _factory.Services.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
        var remaining = db2.Games.ToList();
        remaining.Should().ContainSingle().Which.Title.Should().Be("Present");
    }

    // --- Upload image ---

    [Test]
    public async Task UploadImage_InvalidType_Returns400()
    {
        var gameId = await SeedGameAsync("ImgGame", "pc", "ImgGame");
        var client = CreateClient();

        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[] { 0xFF, 0xD8 });
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        content.Add(fileContent, "file", "cover.jpg");

        var response = await client.PostAsync($"/api/admin/games/{gameId}/upload-image?type=banner", content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task UploadImage_NonImageContentType_Returns400()
    {
        var gameId = await SeedGameAsync("ImgGame2", "pc", "ImgGame2");
        var client = CreateClient();

        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[] { 0x00 });
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        content.Add(fileContent, "file", "cover.txt");

        var response = await client.PostAsync($"/api/admin/games/{gameId}/upload-image?type=cover", content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task UploadImage_UnsupportedExtension_Returns400()
    {
        var gameId = await SeedGameAsync("ImgGame3", "pc", "ImgGame3");
        var client = CreateClient();

        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[] { 0x00 });
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/bmp");
        content.Add(fileContent, "file", "cover.bmp");

        var response = await client.PostAsync($"/api/admin/games/{gameId}/upload-image?type=cover", content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task UploadImage_ValidCover_ReturnsUrl()
    {
        var gameId = await SeedGameAsync("ImgGame4", "pc", "ImgGame4");
        var client = CreateClient();

        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[100]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        content.Add(fileContent, "file", "cover.png");

        var response = await client.PostAsync($"/api/admin/games/{gameId}/upload-image?type=cover", content);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        result.GetProperty("url").GetString().Should().Contain("/images/");
    }

    // --- Config ---

    [Test]
    public async Task GetConfig_MasksSecrets()
    {
        _factory.TestConfig.Igdb.ClientId = "my-client-id";
        _factory.TestConfig.Igdb.ClientSecret = "my-super-secret-key";
        _factory.TestConfig.Steamgriddb.ApiKey = "abc123def456";
        var client = CreateClient();

        var response = await client.GetAsync("/api/admin/config");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var config = await response.Content.ReadFromJsonAsync<JsonElement>();

        // Should show first 3 and last 3 chars with dots in between
        var maskedSecret = config.GetProperty("igdb").GetProperty("clientSecret").GetString();
        maskedSecret.Should().StartWith("my-");
        maskedSecret.Should().EndWith("key");
        maskedSecret.Should().Contain("••••••");

        // ClientId should NOT be masked (it's not a secret)
        config.GetProperty("igdb").GetProperty("clientId").GetString().Should().Be("my-client-id");
    }

    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
        if (Directory.Exists(_gamesDir))
            Directory.Delete(_gamesDir, true);
    }
}
