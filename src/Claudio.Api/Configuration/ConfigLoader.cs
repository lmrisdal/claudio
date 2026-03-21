using System.Security.Cryptography;
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

        // Environment variable overrides
        if (Environment.GetEnvironmentVariable("CLAUDIO_LIBRARY_PATHS") is { Length: > 0 } libPaths)
            config.Library.LibraryPaths = libPaths.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID") is { Length: > 0 } igdbId)
            config.Igdb.ClientId = igdbId;

        if (Environment.GetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET") is { Length: > 0 } igdbSecret)
            config.Igdb.ClientSecret = igdbSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_JWT_SECRET") is { Length: > 0 } jwtSecret)
            config.Auth.JwtSecret = jwtSecret;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_PROVIDER") is { Length: > 0 } dbProvider)
            config.Database.Provider = dbProvider;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_SQLITE_PATH") is { Length: > 0 } sqlitePath)
            config.Database.SqlitePath = sqlitePath;

        if (Environment.GetEnvironmentVariable("CLAUDIO_DB_POSTGRES") is { Length: > 0 } pgConn)
            config.Database.PostgresConnection = pgConn;

        if (Environment.GetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_API_KEY") is { Length: > 0 } sgdbKey)
            config.Steamgriddb.ApiKey = sgdbKey;

        // Auto-generate JWT secret if not configured
        if (string.IsNullOrEmpty(config.Auth.JwtSecret))
            config.Auth.JwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

        return config;
    }
}
