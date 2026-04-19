using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Claudio.Api.Models;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(PreferencesEndpointTests))]
public class PreferencesEndpointTests : IAsyncDisposable
{
    private readonly ClaudioWebApplicationFactory _factory = new();

    private HttpClient CreateClient() => _factory.CreateClient();

    private async Task<string> RegisterAndGetTokenAsync(
        HttpClient client,
        string username = "prefs-user",
        string password = "password123")
    {
        await client.PostAsJsonAsync("/api/auth/register", new { username, password });

        var tokenResponse = await client.PostAsJsonAsync("/api/auth/token/login", new
        {
            username,
            password,
        });
        var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        return tokenJson.GetProperty("access_token").GetString()!;
    }

    [Test]
    public async Task GetPreferences_WithoutSavedPreferences_ReturnsDefaults()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/preferences");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preferences = await response.Content.ReadFromJsonAsync<UserPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().BeEmpty();
    }

    [Test]
    public async Task PutPreferences_PersistsPlatformOrder()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var updateResponse = await client.PutAsJsonAsync("/api/preferences", new UserPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = ["pc", "n64", "gba"],
            },
        });

        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var getResponse = await client.GetAsync("/api/preferences");
        var preferences = await getResponse.Content.ReadFromJsonAsync<UserPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().Equal(["pc", "n64", "gba"]);
    }

    [Test]
    public async Task PutPreferences_NormalizesDuplicateAndBlankPlatforms()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/api/preferences", new UserPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = ["pc", " ", "PC", " n64 "],
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preferences = await response.Content.ReadFromJsonAsync<UserPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().Equal(["pc", "n64"]);
    }

    [Test]
    public async Task Preferences_RequireAuthentication()
    {
        var client = CreateClient();

        var response = await client.GetAsync("/api/preferences");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public ValueTask DisposeAsync()
    {
        _factory.Dispose();
        return ValueTask.CompletedTask;
    }
}
