using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Core.Json;

namespace Claudio.Core;

public sealed class DesktopSettings
{
    public string? ServerUrl { get; set; }
    public string LogLevel { get; set; } = "info";
    [JsonRequired] public double WindowWidth { get; set; } = 1280;
    [JsonRequired] public double WindowHeight { get; set; } = 800;
    public double? WindowX { get; set; }
    public double? WindowY { get; set; }
    public string? DefaultInstallPath { get; set; }
    public string? DefaultDownloadPath { get; set; }
    public string? DefaultProtonPath { get; set; }
    public bool CloseToTray { get; set; }
    public Dictionary<string, string> CustomHeaders { get; set; } = new();
    public double? DownloadSpeedLimitKbs { get; set; }

    public static DesktopSettings CreateDefault() => new() { DefaultProtonPath = SettingsStore.DefaultProtonPath };
}

internal static class SettingsStore
{
    public const string DefaultProtonPath = "UMU-Latest";

    private static readonly HashSet<string> ForbiddenHeaders = new(StringComparer.Ordinal)
    {
        "host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive", "proxy-connection",
    };

    public static string XdgDataHome()
    {
        var xdg = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
        return !string.IsNullOrEmpty(xdg) && Path.IsPathRooted(xdg)
            ? xdg
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
    }

    public static string ToolsDir()
    {
        var dir = Path.Combine(DataDir(), "tools");
        Directory.CreateDirectory(dir);
        return dir;
    }

    internal static string? DataDirOverride { get; set; }

    public static string DataDir()
    {
        var dir = DataDirOverride ?? DefaultDataDir();
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static string SettingsPath() => Path.Combine(DataDir(), "settings.json");

    public static string RegistryPath() => Path.Combine(DataDir(), "installed-games.json");

    private static string DefaultDataDir()
    {
        var explicitDir = Environment.GetEnvironmentVariable("CLAUDIO_DATA_DIR");
        if (!string.IsNullOrEmpty(explicitDir) && Path.IsPathRooted(explicitDir))
        {
            return explicitDir;
        }

        if (OperatingSystem.IsWindows())
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Claudio");
        }

        return Path.Combine(XdgDataHome(), "claudio");
    }

    public static string DefaultGamesDir() =>
        OperatingSystem.IsWindows()
            ? @"C:\Games"
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Games");

    public static bool IsForbiddenHeader(string name) => ForbiddenHeaders.Contains(name.Trim().ToLowerInvariant());

    public static Dictionary<string, string> SanitizeHeaders(Dictionary<string, string> headers) =>
        headers.Where(pair => !IsForbiddenHeader(pair.Key)).ToDictionary(pair => pair.Key, pair => pair.Value);

    public static string NormalizeLogLevel(string value) =>
        value.Trim().ToLowerInvariant() switch
        {
            "error" => "error",
            "warn" or "warning" => "warn",
            "debug" => "debug",
            "trace" => "trace",
            _ => "info",
        };

    private static void Sanitize(DesktopSettings settings)
    {
        settings.LogLevel = NormalizeLogLevel(settings.LogLevel);
        settings.CustomHeaders = SanitizeHeaders(settings.CustomHeaders);
    }

    public static DesktopSettings Load()
    {
        DesktopSettings settings;
        try
        {
            var contents = File.ReadAllText(SettingsPath());
            settings = ParseOrDefault(contents);
        }
        catch (IOException)
        {
            return DesktopSettings.CreateDefault();
        }
        catch (UnauthorizedAccessException)
        {
            return DesktopSettings.CreateDefault();
        }

        Sanitize(settings);
        return settings;
    }

    private static DesktopSettings ParseOrDefault(string contents)
    {
        try
        {
            return JsonSerializer.Deserialize(contents, CoreJsonContext.Default.DesktopSettings)
                ?? DesktopSettings.CreateDefault();
        }
        catch (JsonException)
        {
            return DesktopSettings.CreateDefault();
        }
    }

    public static void Save(DesktopSettings settings)
    {
        Sanitize(settings);
        var json = CoreJsonContext.SerializePretty(settings);
        File.WriteAllText(SettingsPath(), json);
    }

    public static string DefaultDownloadRoot(DesktopSettings settings) =>
        settings.DefaultDownloadPath ?? Path.Combine(DataDir(), "downloads");

    public static string DefaultInstallRoot(DesktopSettings settings) =>
        settings.DefaultInstallPath ?? DefaultGamesDir();

    public static string ResolveDownloadRoot(DesktopSettings settings)
    {
        var path = DefaultDownloadRoot(settings);
        Directory.CreateDirectory(path);
        return path;
    }

    public static string ResolveProtonPath(DesktopSettings settings) =>
        string.IsNullOrWhiteSpace(settings.DefaultProtonPath) ? DefaultProtonPath : settings.DefaultProtonPath;
}
