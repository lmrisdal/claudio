using Claudio.Api.Models;
using Tomlyn;
using Tomlyn.Model;

namespace Claudio.Api.Services;

public class ConfigFileService(string configFilePath, ClaudioConfig config)
{
    /// <summary>
    /// Updates IGDB and SteamGridDB credentials in-memory and persists to the TOML config file.
    /// Only touches the [igdb] and [steamgriddb] sections — all other config is left untouched.
    /// </summary>
    public void UpdateApiCredentials(string? igdbClientId, string? igdbClientSecret, string? steamGridDbApiKey)
    {
        // Update in-memory config
        if (igdbClientId is not null)
            config.Igdb.ClientId = igdbClientId;
        if (igdbClientSecret is not null)
            config.Igdb.ClientSecret = igdbClientSecret;
        if (steamGridDbApiKey is not null)
            config.Steamgriddb.ApiKey = steamGridDbApiKey;

        // Read existing TOML or start fresh
        TomlTable doc;
        if (File.Exists(configFilePath))
        {
            var existing = File.ReadAllText(configFilePath);
            doc = Toml.ToModel(existing);
        }
        else
        {
            doc = [];
        }

        // Update [igdb] table
        if (!doc.TryGetValue("igdb", out var igdbObj) || igdbObj is not TomlTable igdbTable)
        {
            igdbTable = [];
            doc["igdb"] = igdbTable;
        }
        igdbTable["client_id"] = config.Igdb.ClientId;
        igdbTable["client_secret"] = config.Igdb.ClientSecret;

        // Update [steamgriddb] table
        if (!doc.TryGetValue("steamgriddb", out var sgdbObj) || sgdbObj is not TomlTable sgdbTable)
        {
            sgdbTable = [];
            doc["steamgriddb"] = sgdbTable;
        }
        sgdbTable["api_key"] = config.Steamgriddb.ApiKey;

        // Write back
        Directory.CreateDirectory(Path.GetDirectoryName(configFilePath)!);
        File.WriteAllText(configFilePath, Toml.FromModel(doc));
    }
}
