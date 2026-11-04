using System.Formats.Tar;
using Claudio.Core.Logging;

namespace Claudio.Core.Linux;

[System.Runtime.Versioning.SupportedOSPlatform("linux")]
internal static class Umu
{
    public const string ManagedVersion = "1.4.4";
    private const string ArchiveMember = "umu/umu-run";

    public static string ManagedDir() => Path.Combine(SettingsStore.ToolsDir(), "umu-launcher", ManagedVersion);

    public static string ManagedRunPath() => Path.Combine(ManagedDir(), "umu-run");

    private static string ManagedVersionPath() => Path.Combine(ManagedDir(), "VERSION");

    public static string DownloadUrl() =>
        $"https://github.com/Open-Wine-Components/umu-launcher/releases/download/{ManagedVersion}/umu-launcher-{ManagedVersion}-zipapp.tar";

    public static void AddSteamShortcut(InstalledGame installed) => SteamShortcuts.Write(installed, ResolveRun());

    public static string ResolveRun()
    {
        if (CachedManagedRun() is { } cached)
        {
            return cached;
        }

        string managedError;
        try
        {
            return InstallManagedRun();
        }
        catch (CommandException error)
        {
            managedError = error.Message;
        }

        foreach (var candidate in BinaryCandidates("umu-run").Where(File.Exists))
        {
            return candidate;
        }

        throw new CommandException(
            $"umu-run was not found and Claudio could not install UMU Launcher {ManagedVersion}: {managedError}");
    }

    private static string? CachedManagedRun()
    {
        var target = ManagedRunPath();
        try
        {
            return File.Exists(target) && File.ReadAllText(ManagedVersionPath()).Trim() == ManagedVersion ? target : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string InstallManagedRun()
    {
        var target = ManagedRunPath();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to create UMU tools folder {Path.GetDirectoryName(target)}: {error.Message}");
        }

        byte[] bytes;
        try
        {
            Tls.EnsureAvailable(DownloadUrl());
            using var client = new HttpClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Claudio/1.0");
            using var response = client.GetAsync(DownloadUrl()).GetAwaiter().GetResult();
            response.EnsureSuccessStatusCode();
            bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or CommandException)
        {
            throw new CommandException($"Failed to download UMU Launcher: {error.Message}");
        }

        try
        {
            return ExtractManagedRun(bytes, target);
        }
        catch (Exception error) when (error is InvalidDataException or EndOfStreamException or FormatException)
        {
            throw new CommandException($"Failed to read UMU Launcher archive: {error.Message}");
        }
    }

    private static string ExtractManagedRun(byte[] bytes, string target)
    {
        using var reader = new TarReader(new MemoryStream(bytes));
        while (reader.GetNextEntry() is { } entry)
        {
            if (entry.Name.TrimStart('.', '/') != ArchiveMember || entry.DataStream is null)
            {
                continue;
            }

            var temp = Path.ChangeExtension(target, "download");
            try
            {
                using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write))
                {
                    entry.DataStream.CopyTo(output);
                }

                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
                File.Move(temp, target, overwrite: true);
                File.WriteAllText(ManagedVersionPath(), $"{ManagedVersion}\n");
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new CommandException($"Failed to install UMU Launcher from {temp} to {target}: {error.Message}");
            }

            return target;
        }

        throw new CommandException($"{ArchiveMember} was not found in UMU Launcher archive");
    }

    private static List<string> BinaryCandidates(string binary)
    {
        var candidates = new List<string>();
        AddUnique(candidates, Path.Combine(SettingsStore.ToolsDir(), binary));
        foreach (var directory in BinarySearchDirs(Environment.GetEnvironmentVariable("PATH")))
        {
            AddUnique(candidates, Path.Combine(directory, binary));
        }

        return candidates;
    }

    internal static List<string> BinarySearchDirs(string? pathEnv)
    {
        var directories = new List<string>();
        foreach (var entry in (pathEnv ?? "").Split(':', StringSplitOptions.RemoveEmptyEntries))
        {
            AddUnique(directories, entry);
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrEmpty(home))
        {
            AddUnique(directories, Path.Combine(home, ".local/bin"));
            AddUnique(directories, Path.Combine(home, "bin"));
        }

        foreach (var fixedPath in new[]
        {
            "/usr/local/bin", "/usr/bin", "/bin", "/var/lib/flatpak/exports/bin",
            "/run/host/usr/local/bin", "/run/host/usr/bin", "/run/host/bin", "/run/host/var/lib/flatpak/exports/bin",
        })
        {
            AddUnique(directories, fixedPath);
        }

        return directories;
    }

    private static void AddUnique(List<string> list, string value)
    {
        if (!list.Contains(value))
        {
            list.Add(value);
        }
    }

    public static void SyncShortcuts(InstalledGame installed, bool desktop, bool appMenu, bool steam)
    {
        TryWrite(desktop, installed, DesktopDir(), "desktop");
        TryWrite(appMenu, installed, ApplicationsDir(), "app menu");
        if (steam)
        {
            try
            {
                SteamShortcuts.Write(installed, ResolveRun());
            }
            catch (Exception error) when (IsShortcutFailure(error))
            {
                Log.Warn("claudio_core", $"[linux shortcut] failed to write Steam shortcut: {error.Message}");
            }
        }
    }

    private static void TryWrite(bool enabled, InstalledGame installed, string directory, string label)
    {
        if (!enabled)
        {
            return;
        }

        try
        {
            WriteDesktopShortcut(installed, directory);
        }
        catch (Exception error) when (IsShortcutFailure(error))
        {
            Log.Warn("claudio_core", $"[linux shortcut] failed to write {label} shortcut: {error.Message}");
        }
    }

    private static bool IsShortcutFailure(Exception error) =>
        error is CommandException or IOException or UnauthorizedAccessException;

    private static string DesktopDir()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        return string.IsNullOrEmpty(desktop) ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : desktop;
    }

    private static string ApplicationsDir() => Path.Combine(SettingsStore.XdgDataHome(), "applications");

    private static void WriteDesktopShortcut(InstalledGame installed, string targetDir)
    {
        var exe = installed.GameExe ?? throw new CommandException("No game executable is set.");
        var prefix = installed.WinePrefix ?? throw new CommandException("No Wine prefix is set.");
        var proton = installed.ProtonPath ?? "UMU-Latest";
        try
        {
            Directory.CreateDirectory(targetDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to create shortcut directory {targetDir}: {error.Message}");
        }

        var shortcutPath = Path.Combine(targetDir, $"claudio-{installed.RemoteGameId}-{SanitizeSegment(installed.Title)}.desktop");
        var umuRun = ResolveRun();
        var startDir = Path.GetDirectoryName(exe) is { Length: > 0 } parent ? parent : ".";
        var exec = $"env WINEPREFIX={DesktopQuote(prefix)} PROTONPATH={DesktopQuote(proton)} GAMEID=umu-default STORE=none {DesktopQuote(umuRun)} {DesktopQuote(exe)}";
        var contents = $"[Desktop Entry]\nName={installed.Title}\nExec={exec}\nType=Application\nCategories=Game;\nPath={startDir}\nTerminal=false\n";
        try
        {
            File.WriteAllText(shortcutPath, contents);
            File.SetUnixFileMode(shortcutPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to write shortcut {shortcutPath}: {error.Message}");
        }
    }

    internal static string DesktopQuote(string value) =>
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '/' or '.' or '-' or '_' or ':')
            ? value
            : $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";

    internal static string SanitizeSegment(string input)
    {
        var sanitized = new string(input.Trim().Select(ch => ch switch
        {
            '/' or '\\' or ':' or '*' or '?' or '"' or '<' or '>' or '|' => '_',
            _ when char.IsControl(ch) => '_',
            _ => ch,
        }).ToArray());
        return sanitized.Length == 0 ? "game" : sanitized;
    }
}
