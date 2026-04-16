using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(HealthEndpointTests))]
public class HealthEndpointTests : IAsyncDisposable
{
    private readonly ClaudioWebApplicationFactory _factory = new();

    [Test]
    public async Task Health_ReturnsOk()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("status").GetString().Should().Be("ok");
    }

    public ValueTask DisposeAsync()
    {
        _factory.Dispose();
        return ValueTask.CompletedTask;
    }
}
