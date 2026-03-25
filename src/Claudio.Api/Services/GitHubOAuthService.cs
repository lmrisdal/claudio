using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Claudio.Shared.Models;

namespace Claudio.Api.Services;

public class GitHubOAuthService(IHttpClientFactory httpClientFactory)
{
    public async Task<GitHubUserInfo> ExchangeCodeAsync(string code, ClaudioConfig config, CancellationToken cancellationToken)
    {
        var httpClient = httpClientFactory.CreateClient();

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = config.Auth.Github.ClientId,
                ["client_secret"] = config.Auth.Github.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = config.Auth.Github.RedirectUri,
            }),
        };
        tokenRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        tokenRequest.Headers.UserAgent.Add(new ProductInfoHeaderValue("Claudio", "1.0"));

        using var tokenResponse = await httpClient.SendAsync(tokenRequest, cancellationToken);
        tokenResponse.EnsureSuccessStatusCode();

        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<GitHubTokenResponse>(cancellationToken)
            ?? throw new InvalidOperationException("GitHub token response was empty.");

        if (string.IsNullOrWhiteSpace(tokenPayload.AccessToken))
            throw new InvalidOperationException("GitHub did not return an access token.");

        using var userRequest = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user");
        userRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenPayload.AccessToken);
        userRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        userRequest.Headers.UserAgent.Add(new ProductInfoHeaderValue("Claudio", "1.0"));

        using var userResponse = await httpClient.SendAsync(userRequest, cancellationToken);
        userResponse.EnsureSuccessStatusCode();

        var user = await userResponse.Content.ReadFromJsonAsync<GitHubUserResponse>(cancellationToken)
            ?? throw new InvalidOperationException("GitHub user response was empty.");

        if (user.Id <= 0 || string.IsNullOrWhiteSpace(user.Login))
            throw new InvalidOperationException("GitHub user response was missing required fields.");

        string? email = null;
        var emailVerified = false;

        // Always fetch from /user/emails to get verified status — the profile
        // email from /user has no verification info.
        using var emailRequest = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user/emails");
        emailRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenPayload.AccessToken);
        emailRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        emailRequest.Headers.UserAgent.Add(new ProductInfoHeaderValue("Claudio", "1.0"));

        using var emailResponse = await httpClient.SendAsync(emailRequest, cancellationToken);
        if (emailResponse.IsSuccessStatusCode)
        {
            var emails = await emailResponse.Content.ReadFromJsonAsync<List<GitHubEmailResponse>>(cancellationToken) ?? [];
            var picked = emails.FirstOrDefault(x => x.Primary && x.Verified)
                ?? emails.FirstOrDefault(x => x.Verified);
            if (picked is not null)
            {
                email = picked.Email;
                emailVerified = picked.Verified;
            }
        }

        // Fall back to the profile email if /user/emails didn't yield one.
        email ??= user.Email;

        return new GitHubUserInfo(
            user.Id.ToString(),
            user.Login,
            user.Name,
            email,
            emailVerified);
    }

    public record GitHubUserInfo(
        string ProviderKey,
        string Login,
        string? Name,
        string? Email,
        bool EmailVerified);

    private sealed class GitHubTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;
    }

    private sealed class GitHubUserResponse
    {
        public long Id { get; set; }
        public string Login { get; set; } = string.Empty;
        public string? Name { get; set; }
        public string? Email { get; set; }
    }

    private sealed class GitHubEmailResponse
    {
        public string Email { get; set; } = string.Empty;
        public bool Primary { get; set; }
        public bool Verified { get; set; }
    }
}
