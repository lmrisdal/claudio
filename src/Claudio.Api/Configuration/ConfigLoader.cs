using Claudio.Shared.Models;
using Tomlyn;

namespace Claudio.Api.Configuration;

public static class ConfigLoader
{
    public static ClaudioConfig Load(string path)
    {
        ClaudioConfig config;

        if (File.Exists(path))
        {
            var toml = File.ReadAllText(path);
            config = Toml.ToModel<ClaudioConfig>(toml);
        }
        else
        {
            config = new ClaudioConfig();
        }

        foreach (var provider in config.Auth.OidcProviders)
        {
            if (string.IsNullOrWhiteSpace(provider.DiscoveryUrl) && !string.IsNullOrWhiteSpace(provider.Authority))
                provider.DiscoveryUrl = provider.Authority;
        }

        // Environment variable overrides
        if (Environment.GetEnvironmentVariable("CLAUDIO_LIBRARY_PATHS") is { Length: > 0 } libPaths)
            config.Library.LibraryPaths = libPaths.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID") is { Length: > 0 } igdbId)
            config.Igdb.ClientId = igdbId;

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET") is { Length: > 0 } igdbSecret)
            config.Igdb.ClientSecret = igdbSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DISABLE_AUTH") is { Length: > 0 } disableAuth)
            config.Auth.DisableAuth = disableAuth.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (Environment.GetEnvironmentVariable("CLAUDIO_DISABLE_LOCAL_LOGIN") is { Length: > 0 } disableLocalLogin)
            config.Auth.DisableLocalLogin = disableLocalLogin.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (Environment.GetEnvironmentVariable("CLAUDIO_DISABLE_USER_CREATION") is { Length: > 0 } disableUserCreation)
            config.Auth.DisableUserCreation = disableUserCreation.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_PROVIDER") is { Length: > 0 } dbProvider)
            config.Database.Provider = dbProvider;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_SQLITE_PATH") is { Length: > 0 } sqlitePath)
            config.Database.SqlitePath = sqlitePath;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_POSTGRES") is { Length: > 0 } pgConn)
            config.Database.PostgresConnection = pgConn;

        if (Environment.GetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_API_KEY") is { Length: > 0 } sgdbKey)
            config.Steamgriddb.ApiKey = sgdbKey;

        if (Environment.GetEnvironmentVariable("CLAUDIO_PROXY_AUTH_HEADER") is { Length: > 0 } proxyHeader)
            config.Auth.ProxyAuthHeader = proxyHeader;

        if (Environment.GetEnvironmentVariable("CLAUDIO_PROXY_AUTH_AUTO_CREATE") is { Length: > 0 } proxyAutoCreate)
            config.Auth.ProxyAuthAutoCreate = proxyAutoCreate.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (Environment.GetEnvironmentVariable("CLAUDIO_GITHUB_CLIENT_ID") is { Length: > 0 } githubClientId)
            config.Auth.Github.ClientId = githubClientId;

        if (Environment.GetEnvironmentVariable("CLAUDIO_GITHUB_CLIENT_SECRET") is { Length: > 0 } githubClientSecret)
            config.Auth.Github.ClientSecret = githubClientSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_GITHUB_REDIRECT_URI") is { Length: > 0 } githubRedirectUri)
            config.Auth.Github.RedirectUri = githubRedirectUri;

        if (Environment.GetEnvironmentVariable("CLAUDIO_GOOGLE_CLIENT_ID") is { Length: > 0 } googleClientId)
            config.Auth.Google.ClientId = googleClientId;

        if (Environment.GetEnvironmentVariable("CLAUDIO_GOOGLE_CLIENT_SECRET") is { Length: > 0 } googleClientSecret)
            config.Auth.Google.ClientSecret = googleClientSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_GOOGLE_REDIRECT_URI") is { Length: > 0 } googleRedirectUri)
            config.Auth.Google.RedirectUri = googleRedirectUri;

        return config;
    }
}
