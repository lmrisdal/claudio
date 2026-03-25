using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Claudio.Shared.Models;

namespace Claudio.Api.Services;

public class GoogleOAuthService(IHttpClientFactory httpClientFactory)
{
    public async Task<GoogleUserInfo> ExchangeCodeAsync(string code, ClaudioConfig config, CancellationToken cancellationToken)
    {
        var httpClient = httpClientFactory.CreateClient();

        using var tokenResponse = await httpClient.PostAsync(
            "https://oauth2.googleapis.com/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = config.Auth.Google.ClientId,
                ["client_secret"] = config.Auth.Google.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = config.Auth.Google.RedirectUri,
                ["grant_type"] = "authorization_code",
            }),
            cancellationToken);
        tokenResponse.EnsureSuccessStatusCode();

        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<GoogleTokenResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Google token response was empty.");

        if (string.IsNullOrWhiteSpace(tokenPayload.AccessToken))
            throw new InvalidOperationException("Google did not return an access token.");

        using var userRequest = new HttpRequestMessage(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo");
        userRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tokenPayload.AccessToken);

        using var userResponse = await httpClient.SendAsync(userRequest, cancellationToken);
        userResponse.EnsureSuccessStatusCode();

        var user = await userResponse.Content.ReadFromJsonAsync<GoogleUserResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Google user response was empty.");

        if (string.IsNullOrWhiteSpace(user.Sub) || string.IsNullOrWhiteSpace(user.Email))
            throw new InvalidOperationException("Google user response was missing required fields.");

        return new GoogleUserInfo(
            user.Sub,
            user.Email,
            user.Name,
            user.EmailVerified);
    }

    public record GoogleUserInfo(
        string ProviderKey,
        string Email,
        string? Name,
        bool EmailVerified);

    private sealed class GoogleTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;
    }

    private sealed class GoogleUserResponse
    {
        public string Sub { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;

        [JsonPropertyName("email_verified")]
        public bool EmailVerified { get; set; }

        public string? Name { get; set; }
    }
}
