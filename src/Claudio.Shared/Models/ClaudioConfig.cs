namespace Claudio.Shared.Models;

public class ClaudioConfig
{
    public ServerConfig Server { get; set; } = new();
    public DatabaseConfig Database { get; set; } = new();
    public AuthConfig Auth { get; set; } = new();
    public IgdbConfig Igdb { get; set; } = new();
    public SteamGridDbConfig Steamgriddb { get; set; } = new();
    public LibraryConfig Library { get; set; } = new();
}

public class ServerConfig
{
    public int Port { get; set; } = 8080;
}

public class DatabaseConfig
{
    public string Provider { get; set; } = "sqlite";
    public string SqlitePath { get; set; } = "/config/claudio.db";
    public string? PostgresConnection { get; set; }
}

public class AuthConfig
{
    public bool DisableAuth { get; set; } = false;
    public bool DisableLocalLogin { get; set; } = false;
    public bool DisableUserCreation { get; set; } = false;
    public string ProxyAuthHeader { get; set; } = string.Empty;
    public bool ProxyAuthAutoCreate { get; set; } = false;
    public GitHubOAuthConfig Github { get; set; } = new();
    public GoogleOAuthConfig Google { get; set; } = new();
    public List<OidcProviderConfig> OidcProviders { get; set; } = [];
}

public class GitHubOAuthConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) &&
        !string.IsNullOrWhiteSpace(RedirectUri);
}

public class GoogleOAuthConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) &&
        !string.IsNullOrWhiteSpace(RedirectUri);
}

public class OidcProviderConfig
{
    public string Slug { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? LogoUrl { get; set; }
    public string DiscoveryUrl { get; set; } = string.Empty;
    public string Authority { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;
    public string Scope { get; set; } = "openid profile email";
    public string UserIdClaim { get; set; } = "sub";
    public string UsernameClaim { get; set; } = "preferred_username";
    public string NameClaim { get; set; } = "name";
    public string EmailClaim { get; set; } = "email";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Slug) &&
        !string.IsNullOrWhiteSpace(DisplayName) &&
        !string.IsNullOrWhiteSpace(DiscoveryUrl) &&
        !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) &&
        !string.IsNullOrWhiteSpace(RedirectUri);
}

public class IgdbConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
}

public class SteamGridDbConfig
{
    public string ApiKey { get; set; } = string.Empty;
}

public class LibraryConfig
{
    public string[] LibraryPaths { get; set; } = ["/games"];
    public string[] ExcludePlatforms { get; set; } = [];
}
