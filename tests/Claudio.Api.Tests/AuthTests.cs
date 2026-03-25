using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AwesomeAssertions;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(AuthTests))]
public class AuthTests : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly ClaudioWebApplicationFactory _factory = new();

    private HttpClient CreateClient() => _factory.CreateClient();

    private async Task<string> RegisterAndGetTokenAsync(HttpClient client, string username = "testuser", string password = "password123")
    {
        await client.PostAsJsonAsync("/api/auth/register", new { username, password });
        return await GetTokenAsync(client, username, password);
    }

    private async Task<string> GetTokenAsync(HttpClient client, string username, string password)
    {
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
        return tokenJson.GetProperty("access_token").GetString()!;
    }

    // --- Registration ---

    [Test]
    public async Task Register_FirstUser_GetsAdminRole()
    {
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "admin", password = "password123" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var user = await response.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
        user!.Role.Should().Be(UserRole.Admin);
    }

    [Test]
    public async Task Register_SecondUser_GetsUserRole()
    {
        var client = CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "admin", password = "password123" });

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "user2", password = "password123" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var user = await response.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
        user!.Role.Should().Be(UserRole.User);
    }

    [Test]
    public async Task Register_DuplicateUsername_Returns409()
    {
        var client = CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "dupe", password = "password123" });

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "dupe", password = "password456" });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Test]
    public async Task Register_ShortPassword_Returns400()
    {
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "user", password = "short" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Register_EmptyFields_Returns400()
    {
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "", password = "" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task Register_DisabledLocalLogin_Returns404()
    {
        _factory.TestConfig.Auth.DisableLocalLogin = true;
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "user", password = "password123" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Register_DisabledUserCreation_Returns404()
    {
        _factory.TestConfig.Auth.DisableUserCreation = true;
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new { username = "user", password = "password123" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // --- Login (Token) ---

    [Test]
    public async Task Login_ValidCredentials_ReturnsToken()
    {
        var client = CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "user", password = "password123" });

        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = "user",
            ["password"] = "password123",
            ["client_id"] = "claudio-spa",
            ["scope"] = "openid profile offline_access roles",
        });

        var response = await client.PostAsync("/connect/token", tokenRequest);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
        json.GetProperty("refresh_token").GetString().Should().NotBeNullOrEmpty();
    }

    [Test]
    public async Task Login_WrongPassword_ReturnsError()
    {
        var client = CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "user", password = "password123" });

        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = "user",
            ["password"] = "wrongpassword",
            ["client_id"] = "claudio-spa",
        });

        var response = await client.PostAsync("/connect/token", tokenRequest);

        response.IsSuccessStatusCode.Should().BeFalse();
    }

    [Test]
    public async Task Login_NonexistentUser_ReturnsError()
    {
        var client = CreateClient();

        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = "nobody",
            ["password"] = "password123",
            ["client_id"] = "claudio-spa",
        });

        var response = await client.PostAsync("/connect/token", tokenRequest);

        response.IsSuccessStatusCode.Should().BeFalse();
    }

    // --- GetMe ---

    [Test]
    public async Task GetMe_WithValidToken_ReturnsUser()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client, "meuser", "password123");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/auth/me");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var user = await response.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
        user!.Username.Should().Be("meuser");
    }

    [Test]
    public async Task GetMe_WithoutToken_Returns401()
    {
        var client = CreateClient();

        var response = await client.GetAsync("/api/auth/me");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- ChangePassword ---

    [Test]
    public async Task ChangePassword_ValidRequest_Returns204()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client, "cpuser", "oldpassword1");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "oldpassword1", newPassword = "newpassword1" });

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify new password works
        var newToken = await GetTokenAsync(client, "cpuser", "newpassword1");
        newToken.Should().NotBeNullOrEmpty();
    }

    [Test]
    public async Task ChangePassword_WrongCurrentPassword_Returns400()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client, "cpuser2", "password123");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "wrongpassword", newPassword = "newpassword1" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Test]
    public async Task ChangePassword_ShortNewPassword_Returns400()
    {
        var client = CreateClient();
        var token = await RegisterAndGetTokenAsync(client, "cpuser3", "password123");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "password123", newPassword = "short" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // --- GetProviders ---

    [Test]
    public async Task GetProviders_Default_ReturnsLocalLoginEnabled()
    {
        var client = CreateClient();

        var response = await client.GetAsync("/api/auth/providers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("localLoginEnabled").GetBoolean().Should().BeTrue();
        json.GetProperty("userCreationEnabled").GetBoolean().Should().BeTrue();
        json.GetProperty("providers").GetArrayLength().Should().Be(0);
    }

    [Test]
    public async Task GetProviders_WithGitHub_IncludesGitHubProvider()
    {
        _factory.TestConfig.Auth.Github = new GitHubOAuthConfig
        {
            ClientId = "test-id",
            ClientSecret = "test-secret",
            RedirectUri = "http://localhost/callback",
        };
        var client = CreateClient();

        var response = await client.GetAsync("/api/auth/providers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("providers").GetArrayLength().Should().Be(1);
        json.GetProperty("providers")[0].GetProperty("slug").GetString().Should().Be("github");
    }

    [Test]
    public async Task GetProviders_DisabledLocalLogin_ReturnsFalse()
    {
        _factory.TestConfig.Auth.DisableLocalLogin = true;
        var client = CreateClient();

        var response = await client.GetAsync("/api/auth/providers");

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("localLoginEnabled").GetBoolean().Should().BeFalse();
    }

    // --- Admin authorization ---

    [Test]
    public async Task AdminEndpoint_WithAdminToken_Returns200()
    {
        var client = CreateClient();
        // First user is admin
        var token = await RegisterAndGetTokenAsync(client, "admin", "password123");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/admin/users");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Test]
    public async Task AdminEndpoint_WithUserToken_Returns403()
    {
        var client = CreateClient();
        // First user (admin)
        await RegisterAndGetTokenAsync(client, "admin", "password123");
        // Second user (regular)
        var userToken = await RegisterAndGetTokenAsync(client, "regular", "password123");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userToken);

        var response = await client.GetAsync("/api/admin/users");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Test]
    public async Task AdminEndpoint_WithoutToken_Returns401()
    {
        var client = CreateClient();

        var response = await client.GetAsync("/api/admin/users");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // --- Refresh token ---

    [Test]
    public async Task RefreshToken_ValidToken_ReturnsNewAccessToken()
    {
        var client = CreateClient();
        await client.PostAsJsonAsync("/api/auth/register", new { username = "refreshuser", password = "password123" });

        // Get initial tokens
        var tokenRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["username"] = "refreshuser",
            ["password"] = "password123",
            ["client_id"] = "claudio-spa",
            ["scope"] = "openid profile offline_access roles",
        });
        var tokenResponse = await client.PostAsync("/connect/token", tokenRequest);
        var tokenJson = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = tokenJson.GetProperty("refresh_token").GetString()!;

        // Use refresh token
        var refreshRequest = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["client_id"] = "claudio-spa",
        });
        var refreshResponse = await client.PostAsync("/connect/token", refreshRequest);

        refreshResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var refreshJson = await refreshResponse.Content.ReadFromJsonAsync<JsonElement>();
        refreshJson.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
    }

    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
    }
}
