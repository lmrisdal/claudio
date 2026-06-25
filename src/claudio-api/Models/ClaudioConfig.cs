namespace Claudio.Api.Models;

public class ClaudioConfig
{
    public ServerConfig Server { get; set; } = new();
    public DatabaseConfig Database { get; set; } = new();
    public IgdbConfig Igdb { get; set; } = new();
    public SteamGridDbConfig Steamgriddb { get; set; } = new();
    public LibraryConfig Library { get; set; } = new();
}

public class ServerConfig
{
    public int Port { get; set; } = 8080;
    public string LogLevel { get; set; } = "warn";
}

public class DatabaseConfig
{
    public string Provider { get; set; } = "sqlite";
    public string SqlitePath { get; set; } = "/config/claudio.db";
    public string? PostgresConnection { get; set; }
}

public class IgdbConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public int TimeoutSecs { get; set; } = 600;
}

public class SteamGridDbConfig
{
    public string ApiKey { get; set; } = string.Empty;
    public int TimeoutSecs { get; set; } = 900;
}

public class LibraryConfig
{
    public string[] LibraryPaths { get; set; } = ["/games"];
    public string[] ExcludePlatforms { get; set; } = [];
    public int ScanIntervalSecs { get; set; } = 120;
}
