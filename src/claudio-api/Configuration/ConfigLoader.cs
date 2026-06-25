using Claudio.Api.Models;
using Tomlyn;

namespace Claudio.Api.Configuration;

public static class ConfigLoader
{
    public static ClaudioConfig Load(string path)
    {
        var config = File.Exists(path)
            ? Toml.ToModel<ClaudioConfig>(File.ReadAllText(path))
            : new ClaudioConfig();

        ApplyEnvironmentOverrides(config);
        Normalize(config);

        return config;
    }

    private static void Normalize(ClaudioConfig config)
    {
        _ = config;
    }

    private static void ApplyEnvironmentOverrides(ClaudioConfig config)
    {
        if (Environment.GetEnvironmentVariable("CLAUDIO_PORT") is { Length: > 0 } port &&
            int.TryParse(port, out var parsedPort))
        {
            config.Server.Port = parsedPort;
        }

        if (Environment.GetEnvironmentVariable("CLAUDIO_LOG_LEVEL") is { Length: > 0 } logLevel)
            config.Server.LogLevel = logLevel;

        if (Environment.GetEnvironmentVariable("CLAUDIO_LIBRARY_PATHS") is { Length: > 0 } libPaths)
            config.Library.LibraryPaths = libPaths.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (Environment.GetEnvironmentVariable("CLAUDIO_EXCLUDE_PLATFORMS") is { Length: > 0 } excludePlatforms)
            config.Library.ExcludePlatforms = excludePlatforms.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (Environment.GetEnvironmentVariable("CLAUDIO_SCAN_INTERVAL") is { Length: > 0 } scanInterval &&
            int.TryParse(scanInterval, out var parsedScanInterval))
        {
            config.Library.ScanIntervalSecs = parsedScanInterval;
        }

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID") is { Length: > 0 } igdbId)
            config.Igdb.ClientId = igdbId;

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET") is { Length: > 0 } igdbSecret)
            config.Igdb.ClientSecret = igdbSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_TIMEOUT_SECS") is { Length: > 0 } igdbTimeout &&
            int.TryParse(igdbTimeout, out var parsedIgdbTimeout))
        {
            config.Igdb.TimeoutSecs = parsedIgdbTimeout;
        }

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_PROVIDER") is { Length: > 0 } dbProvider)
            config.Database.Provider = dbProvider;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_SQLITE_PATH") is { Length: > 0 } sqlitePath)
            config.Database.SqlitePath = sqlitePath;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_POSTGRES") is { Length: > 0 } pgConn)
            config.Database.PostgresConnection = pgConn;

        if (Environment.GetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_API_KEY") is { Length: > 0 } sgdbKey)
            config.Steamgriddb.ApiKey = sgdbKey;

        if (Environment.GetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_TIMEOUT_SECS") is { Length: > 0 } sgdbTimeout &&
            int.TryParse(sgdbTimeout, out var parsedSgdbTimeout))
        {
            config.Steamgriddb.TimeoutSecs = parsedSgdbTimeout;
        }

    }
}
