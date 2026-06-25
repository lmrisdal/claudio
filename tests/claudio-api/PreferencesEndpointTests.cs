using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Claudio.Api.Models;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(PreferencesEndpointTests))]
public class PreferencesEndpointTests : IAsyncDisposable
{
    private readonly ClaudioWebApplicationFactory _factory = new();

    private HttpClient CreateClient() => _factory.CreateClient();

    [Test]
    public async Task GetPreferences_WithoutSavedPreferences_ReturnsDefaults()
    {
        var client = CreateClient();

        var response = await client.GetAsync("/api/preferences");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preferences = await response.Content.ReadFromJsonAsync<AppPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().BeEmpty();
    }

    [Test]
    public async Task PutPreferences_PersistsPlatformOrder()
    {
        var client = CreateClient();

        var updateResponse = await client.PutAsJsonAsync("/api/preferences", new AppPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = ["pc", "n64", "gba"],
            },
        });

        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var getResponse = await client.GetAsync("/api/preferences");
        var preferences = await getResponse.Content.ReadFromJsonAsync<AppPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().Equal(["pc", "n64", "gba"]);
    }

    [Test]
    public async Task PutPreferences_NormalizesDuplicateAndBlankPlatforms()
    {
        var client = CreateClient();

        var response = await client.PutAsJsonAsync("/api/preferences", new AppPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = ["pc", " ", "PC", " n64 "],
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preferences = await response.Content.ReadFromJsonAsync<AppPreferencesDto>();
        preferences.Should().NotBeNull();
        preferences!.Library.PlatformOrder.Should().Equal(["pc", "n64"]);
    }

    public ValueTask DisposeAsync()
    {
        _factory.Dispose();
        return ValueTask.CompletedTask;
    }
}
