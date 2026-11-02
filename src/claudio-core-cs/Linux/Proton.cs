using Claudio.Core.Logging;

namespace Claudio.Core.Linux;

internal static class Proton
{
    private static readonly HashSet<string> BuiltinOptions = new(StringComparer.Ordinal)
    {
        "UMU-Latest", "umu-scout", "umu-soldier", "umu-sniper", "umu-steamrt4", "umu-steamrt4-arm64",
    };

    public static List<ProtonVersionOption> ListVersions()
    {
        var versions = new List<ProtonVersionOption>
        {
            new() { Label = "UMU Latest", Value = "UMU-Latest" },
            new() { Label = "UMU Sniper", Value = "umu-sniper" },
        };

        foreach (var directory in CompatibilityToolDirs().Where(Directory.Exists))
        {
            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFileSystemEntries(directory).ToList();
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            foreach (var path in entries)
            {
                var name = Path.GetFileName(path);
                if (!IsCompatibleTool(path) || versions.Any(version => version.Value == path || version.Label == name))
                {
                    continue;
                }

                versions.Add(new ProtonVersionOption { Label = name, Value = path });
            }
        }

        return versions;
    }

    public static string SelectedPath(string? requested)
    {
        var chosen = string.IsNullOrWhiteSpace(requested?.Trim())
            ? SettingsStore.ResolveProtonPath(SettingsStore.Load())
            : requested.Trim();
        if (BuiltinOptions.Contains(chosen) || IsCompatibleTool(chosen))
        {
            return chosen;
        }

        Log.Warn("claudio_core", $"[umu] ignoring incompatible Proton selection '{chosen}', falling back to UMU-Latest");
        return SettingsStore.DefaultProtonPath;
    }

    private static bool IsCompatibleTool(string path)
    {
        if (!Directory.Exists(path))
        {
            return false;
        }

        var manifest = ReadOrNull(Path.Combine(path, "toolmanifest.vdf"));
        if (manifest is null
            || !(manifest.Contains("\"compatmanager_layer_name\"") && manifest.Contains("\"proton\"")
                && manifest.Contains("\"commandline\"") && manifest.Contains("/proton")))
        {
            return false;
        }

        var tool = ReadOrNull(Path.Combine(path, "compatibilitytool.vdf"));
        return tool is not null
            && tool.Contains("\"from_oslist\"") && tool.Contains("\"windows\"")
            && tool.Contains("\"to_oslist\"") && tool.Contains("\"linux\"");
    }

    private static string? ReadOrNull(string path)
    {
        try
        {
            return File.ReadAllText(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static List<string> CompatibilityToolDirs()
    {
        var data = SettingsStore.XdgDataHome();
        return [Path.Combine(data, "Steam", "compatibilitytools.d"), Path.Combine(data, "umu", "compatibilitytools")];
    }
}
