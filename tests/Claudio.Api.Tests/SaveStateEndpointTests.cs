using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Claudio.Api.Data;
using Claudio.Shared.Enums;
using Microsoft.Extensions.DependencyInjection;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(SaveStateEndpointTests))]
public class SaveStateEndpointTests : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly ClaudioWebApplicationFactory _factory = new();

    private async Task<HttpClient> CreateAuthenticatedClientAsync(string username = "testuser", string password = "password123")
    {
        var client = _factory.CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username, password });
        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = username,
            ["password"] = password,
            ["client_id"] = "claudio-spa",
            ["scope"] = "openid profile offline_access roles",
        });
        var tokenResponse = await client.PostAsync("/connect/token", tokenRequest);
        var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenJson.GetProperty("access_token").GetString()!);
        return client;
    }

    private async Task<int> SeedGameAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = new Game
        {
            Title = "Test Game",
            Platform = "gba",
            FolderName = "TestGame",
            FolderPath = "/nonexistent/gba/TestGame",
            InstallType = InstallType.Portable,
            SizeBytes = 1024,
        };
        db.Games.Add(game);
        await db.SaveChangesAsync();
        return game.Id;
    }

    private async Task<int> SeedSaveStateAsync(int gameId, int userId, byte[] stateData, byte[]? screenshotData = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var save = new SaveState
        {
            GameId = gameId,
            UserId = userId,
            StateData = stateData,
            ScreenshotData = screenshotData ?? [],
            CreatedAt = DateTime.UtcNow,
        };
        db.SaveStates.Add(save);
        await db.SaveChangesAsync();
        return save.Id;
    }

    private async Task<int> GetUserIdAsync(string username)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return db.Users.First(u => u.UserName == username).Id;
    }

    private static MultipartFormDataContent BuildSaveStateForm(byte[]? stateData = null, byte[]? screenshotData = null)
    {
        var form = new MultipartFormDataContent();
        var state = new ByteArrayContent(stateData ?? [1, 2, 3, 4, 5]);
        state.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(state, "state", "state.bin");
        if (screenshotData is not null)
        {
            var screenshot = new ByteArrayContent(screenshotData);
            screenshot.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(screenshot, "screenshot", "screenshot.png");
        }
        return form;
    }

    // --- List ---

    [Test]
    public async Task List_ReturnsSaveStates()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        await SeedSaveStateAsync(gameId, userId, [1, 2, 3]);
        await SeedSaveStateAsync(gameId, userId, [4, 5, 6]);

        var response = await client.GetAsync($"/api/games/{gameId}/save-states");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var saves = await response.Content.ReadFromJsonAsync<JsonElement[]>(JsonOptions);
        saves!.Length.Should().Be(2);
    }

    [Test]
    public async Task List_ReturnsOnlyCurrentUsersStates()
    {
        var gameId = await SeedGameAsync();
        var client1 = await CreateAuthenticatedClientAsync("user1");
        var client2 = await CreateAuthenticatedClientAsync("user2");
        var userId1 = await GetUserIdAsync("user1");
        var userId2 = await GetUserIdAsync("user2");
        await SeedSaveStateAsync(gameId, userId1, [1, 2, 3]);
        await SeedSaveStateAsync(gameId, userId2, [4, 5, 6]);

        var response = await client1.GetAsync($"/api/games/{gameId}/save-states");

        var saves = await response.Content.ReadFromJsonAsync<JsonElement[]>(JsonOptions);
        saves!.Length.Should().Be(1);
    }

    [Test]
    public async Task List_WithoutAuth_Returns401()
    {
        var gameId = await SeedGameAsync();

        var response = await _factory.CreateClient().GetAsync($"/api/games/{gameId}/save-states");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- Create ---

    [Test]
    public async Task Create_WithStateFile_ReturnsCreated()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.PostAsync($"/api/games/{gameId}/save-states", BuildSaveStateForm());

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var save = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        save.GetProperty("gameId").GetInt32().Should().Be(gameId);
        save.GetProperty("screenshotUrl").GetString().Should().NotBeNullOrEmpty();
    }

    [Test]
    public async Task Create_MissingStateFile_ReturnsBadRequest()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.PostAsync($"/api/games/{gameId}/save-states", new MultipartFormDataContent());

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Create_WithoutAuth_Returns401()
    {
        var gameId = await SeedGameAsync();

        var response = await _factory.CreateClient().PostAsync($"/api/games/{gameId}/save-states", BuildSaveStateForm());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Create_EnforcesMaxSaveStatesLimit()
    {
        _factory.TestConfig.Emulation.MaxSaveStatesPerGame = 2;
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();

        await client.PostAsync($"/api/games/{gameId}/save-states", BuildSaveStateForm([1]));
        await client.PostAsync($"/api/games/{gameId}/save-states", BuildSaveStateForm([2]));
        await client.PostAsync($"/api/games/{gameId}/save-states", BuildSaveStateForm([3]));

        var response = await client.GetAsync($"/api/games/{gameId}/save-states");
        var saves = await response.Content.ReadFromJsonAsync<JsonElement[]>(JsonOptions);
        saves!.Length.Should().Be(2);
    }

    // --- Update ---

    [Test]
    public async Task Update_ExistingState_ReturnsOk()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        var saveId = await SeedSaveStateAsync(gameId, userId, [1, 2, 3]);

        var response = await client.PutAsync($"/api/games/{gameId}/save-states/{saveId}", BuildSaveStateForm([9, 8, 7]));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Test]
    public async Task Update_OtherUsersState_Returns404()
    {
        var gameId = await SeedGameAsync();
        await CreateAuthenticatedClientAsync("owner");
        var client2 = await CreateAuthenticatedClientAsync("other");
        var ownerId = await GetUserIdAsync("owner");
        var saveId = await SeedSaveStateAsync(gameId, ownerId, [1, 2, 3]);

        var response = await client2.PutAsync($"/api/games/{gameId}/save-states/{saveId}", BuildSaveStateForm([9, 8, 7]));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Update_WithoutAuth_Returns401()
    {
        var gameId = await SeedGameAsync();

        var response = await _factory.CreateClient().PutAsync($"/api/games/{gameId}/save-states/1", BuildSaveStateForm());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- GetStateData ---

    [Test]
    public async Task GetStateData_ReturnsStateBytes()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        var stateBytes = new byte[] { 10, 20, 30, 40, 50 };
        var saveId = await SeedSaveStateAsync(gameId, userId, stateBytes);

        var response = await client.GetAsync($"/api/games/{gameId}/save-states/{saveId}/state");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await response.Content.ReadAsByteArrayAsync();
        data.Should().Equal(stateBytes);
    }

    [Test]
    public async Task GetStateData_OtherUsersState_Returns404()
    {
        var gameId = await SeedGameAsync();
        await CreateAuthenticatedClientAsync("owner2");
        var client2 = await CreateAuthenticatedClientAsync("other2");
        var ownerId = await GetUserIdAsync("owner2");
        var saveId = await SeedSaveStateAsync(gameId, ownerId, [1, 2, 3]);

        var response = await client2.GetAsync($"/api/games/{gameId}/save-states/{saveId}/state");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task GetStateData_WithoutAuth_Returns401()
    {
        var gameId = await SeedGameAsync();

        var response = await _factory.CreateClient().GetAsync($"/api/games/{gameId}/save-states/1/state");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- GetScreenshot ---

    [Test]
    public async Task GetScreenshot_WithData_ReturnsImageAnonymously()
    {
        var gameId = await SeedGameAsync();
        await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        // PNG magic bytes as minimal screenshot data
        var saveId = await SeedSaveStateAsync(gameId, userId, [1], screenshotData: [137, 80, 78, 71]);

        var response = await _factory.CreateClient().GetAsync($"/api/games/{gameId}/save-states/{saveId}/screenshot");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Test]
    public async Task GetScreenshot_EmptyScreenshotData_Returns404()
    {
        var gameId = await SeedGameAsync();
        await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        var saveId = await SeedSaveStateAsync(gameId, userId, [1], screenshotData: []);

        var response = await _factory.CreateClient().GetAsync($"/api/games/{gameId}/save-states/{saveId}/screenshot");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // --- Delete ---

    [Test]
    public async Task Delete_ExistingState_Returns204()
    {
        var gameId = await SeedGameAsync();
        var client = await CreateAuthenticatedClientAsync();
        var userId = await GetUserIdAsync("testuser");
        var saveId = await SeedSaveStateAsync(gameId, userId, [1, 2, 3]);

        var response = await client.DeleteAsync($"/api/games/{gameId}/save-states/{saveId}");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Test]
    public async Task Delete_OtherUsersState_Returns404()
    {
        var gameId = await SeedGameAsync();
        await CreateAuthenticatedClientAsync("delowner");
        var client2 = await CreateAuthenticatedClientAsync("delother");
        var ownerId = await GetUserIdAsync("delowner");
        var saveId = await SeedSaveStateAsync(gameId, ownerId, [1, 2, 3]);

        var response = await client2.DeleteAsync($"/api/games/{gameId}/save-states/{saveId}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Delete_WithoutAuth_Returns401()
    {
        var gameId = await SeedGameAsync();

        var response = await _factory.CreateClient().DeleteAsync($"/api/games/{gameId}/save-states/1");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
    }
}
