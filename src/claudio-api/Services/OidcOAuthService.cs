using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Api.Models;

namespace Claudio.Api.Services;

public class OidcOAuthService(IHttpClientFactory httpClientFactory)
{
    public async Task<string> GetAuthorizationEndpointAsync(
        OidcProviderConfig provider,
        CancellationToken cancellationToken)
    {
        var httpClient = httpClientFactory.CreateClient();
        var discovery = await GetDiscoveryDocumentAsync(httpClient, provider.DiscoveryUrl, cancellationToken);
        if (string.IsNullOrWhiteSpace(discovery.AuthorizationEndpoint))
            throw new InvalidOperationException("OIDC provider discovery document did not include an authorization endpoint.");

        return discovery.AuthorizationEndpoint;
    }

    public async Task<OidcUserInfo> ExchangeCodeAsync(
        OidcProviderConfig provider,
        string code,
        CancellationToken cancellationToken)
    {
        var httpClient = httpClientFactory.CreateClient();
        var discovery = await GetDiscoveryDocumentAsync(httpClient, provider.DiscoveryUrl, cancellationToken);

        using var tokenResponse = await httpClient.PostAsync(
            discovery.TokenEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = provider.ClientId,
                ["client_secret"] = provider.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = provider.RedirectUri,
                ["grant_type"] = "authorization_code",
            }),
            cancellationToken);
        tokenResponse.EnsureSuccessStatusCode();

        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<OidcTokenResponse>(cancellationToken)
            ?? throw new InvalidOperationException("OIDC token response was empty.");

        if (string.IsNullOrWhiteSpace(tokenPayload.AccessToken))
            throw new InvalidOperationException("OIDC provider did not return an access token.");

        if (string.IsNullOrWhiteSpace(discovery.UserInfoEndpoint))
            throw new InvalidOperationException("OIDC provider discovery document did not include a userinfo endpoint.");

        using var userRequest = new HttpRequestMessage(HttpMethod.Get, discovery.UserInfoEndpoint);
        userRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenPayload.AccessToken);
        userRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var userResponse = await httpClient.SendAsync(userRequest, cancellationToken);
        userResponse.EnsureSuccessStatusCode();

        using var userDocument = await userResponse.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken)
            ?? throw new InvalidOperationException("OIDC user response was empty.");

        var root = userDocument.RootElement;
        var providerKey = GetClaim(root, provider.UserIdClaim, "sub");
        var email = GetClaim(root, provider.EmailClaim, "email");
        var username = GetClaim(root, provider.UsernameClaim, "preferred_username", "nickname", "name", "email");
        var displayName = GetClaim(root, provider.NameClaim, "name", "preferred_username", "nickname", "email");

        if (string.IsNullOrWhiteSpace(providerKey))
            throw new InvalidOperationException("OIDC user response was missing the user identifier claim.");

        if (string.IsNullOrWhiteSpace(username) && string.IsNullOrWhiteSpace(email))
            throw new InvalidOperationException("OIDC user response was missing both username and email claims.");

        return new OidcUserInfo(
            providerKey,
            username ?? email!,
            displayName,
            email,
            GetBoolClaim(root, "email_verified"));
    }

    private static async Task<OidcDiscoveryDocument> GetDiscoveryDocumentAsync(
        HttpClient httpClient,
        string discoveryUrl,
        CancellationToken cancellationToken)
    {
        var trimmedDiscoveryUrl = discoveryUrl.Trim();
        if (string.IsNullOrWhiteSpace(trimmedDiscoveryUrl))
            throw new InvalidOperationException("OIDC discovery URL is not configured.");

        if (!trimmedDiscoveryUrl.Contains("/.well-known/openid-configuration", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("OIDC discovery URL must be the full /.well-known/openid-configuration URL.");

        using var request = new HttpRequestMessage(HttpMethod.Get, trimmedDiscoveryUrl);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var contentType = response.Content.Headers.ContentType?.MediaType;
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(responseBody))
            throw new InvalidOperationException($"OIDC discovery document was empty for '{trimmedDiscoveryUrl}'.");

        try
        {
            var discovery = JsonSerializer.Deserialize<OidcDiscoveryDocument>(responseBody);
            return discovery ?? throw new InvalidOperationException($"OIDC discovery document was empty for '{trimmedDiscoveryUrl}'.");
        }
        catch (JsonException)
        {
            var preview = responseBody.Length <= 160 ? responseBody : $"{responseBody[..160]}...";
            throw new InvalidOperationException(
                $"OIDC discovery at '{trimmedDiscoveryUrl}' did not return JSON. Content-Type was '{contentType ?? "unknown"}'. Response started with: {preview}");
        }
    }

    private static string? GetClaim(JsonElement root, params string[] claimNames)
    {
        foreach (var claimName in claimNames)
        {
            if (string.IsNullOrWhiteSpace(claimName))
                continue;

            if (root.TryGetProperty(claimName, out var value) && value.ValueKind == JsonValueKind.String)
            {
                var claimValue = value.GetString();
                if (!string.IsNullOrWhiteSpace(claimValue))
                    return claimValue;
            }
        }

        return null;
    }

    private static bool GetBoolClaim(JsonElement root, string claimName)
    {
        if (!root.TryGetProperty(claimName, out var value))
            return false;

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => false,
        };
    }

    public record OidcUserInfo(
        string ProviderKey,
        string Username,
        string? DisplayName,
        string? Email,
        bool EmailVerified);

    private sealed class OidcDiscoveryDocument
    {
        [JsonPropertyName("authorization_endpoint")]
        public string? AuthorizationEndpoint { get; set; }

        [JsonPropertyName("token_endpoint")]
        public string TokenEndpoint { get; set; } = string.Empty;

        [JsonPropertyName("userinfo_endpoint")]
        public string? UserInfoEndpoint { get; set; }
    }

    private sealed class OidcTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;
    }
}
