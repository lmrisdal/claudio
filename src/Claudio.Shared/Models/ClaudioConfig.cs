namespace Claudio.Shared.Models;

public class ClaudioConfig
{
    public ServerConfig Server { get; set; } = new();
    public DatabaseConfig Database { get; set; } = new();
    public AuthConfig Auth { get; set; } = new();
    public IgdbConfig Igdb { get; set; } = new();
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
    public string JwtSecret { get; set; } = string.Empty;
    public int TokenExpiryHours { get; set; } = 168;
}

public class IgdbConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
}

public class LibraryConfig
{
    public string[] LibraryPaths { get; set; } = ["/games"];
}
