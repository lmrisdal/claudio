using System.Runtime.Versioning;
using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Core.Json;
using Claudio.Core.Logging;
using Microsoft.Win32;

namespace Claudio.Core.Windows;

internal sealed class UninstallConfig
{
    public string DesktopShortcutPath { get; set; } = "";
    public string GameTitle { get; set; } = "";
    public string InstallPath { get; set; } = "";
    public string RegistryKeyName { get; set; } = "";
    public string ShortcutPath { get; set; } = "";
}

[SupportedOSPlatform("windows6.1")]
internal static class Registration
{
    public const string UninstallRoot = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    public static string RegistryKeyName(int remoteGameId) => $"Claudio-{remoteGameId}";

    public static void Register(string resourceDir, InstalledGame game, bool desktopShortcut)
    {
        if (game.InstallType != InstallType.Portable)
        {
            return;
        }

        var keyName = RegistryKeyName(game.RemoteGameId);
        var shortcutPath = ShellDirectories.StartMenuShortcutPath(game.Title);
        Try($"Could not deploy uninstaller for '{game.Title}':", () => DeployUninstaller(resourceDir, game, keyName, shortcutPath));

        if (game.GameExe is { } exe)
        {
            Try($"Could not create Start Menu shortcut for '{game.Title}':", () => CreateShortcut(exe, shortcutPath));
            if (desktopShortcut)
            {
                Try($"Could not create desktop shortcut for '{game.Title}':", () => CreateShortcut(exe, ShellDirectories.DesktopShortcutPath(game.Title)));
            }
        }

        Try($"Could not write Windows registry entry for '{game.Title}':", () => WriteRegistry(game, keyName, Path.Combine(game.InstallPath, "uninstall.exe")));
    }

    private static void Try(string prefix, Action action)
    {
        try
        {
            action();
        }
        catch (Exception error)
        {
            Log.Warn("claudio_core", $"{prefix} {error.Message}");
        }
    }

    public static void Deregister(InstalledGame game)
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree($@"{UninstallRoot}\{RegistryKeyName(game.RemoteGameId)}", throwOnMissingSubKey: false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            Log.Warn("claudio_core", $"Could not remove registry entry for '{game.Title}': {error.Message}");
        }

        TryDelete(ShellDirectories.StartMenuShortcutPath(game.Title));
        TryDelete(ShellDirectories.DesktopShortcutPath(game.Title));
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static void DeployUninstaller(string resourceDir, InstalledGame game, string keyName, string shortcutPath)
    {
        var source = Path.Combine(resourceDir, "claudio-game-uninstaller.exe");
        if (!File.Exists(source))
        {
            throw new CommandException("Bundled claudio-game-uninstaller.exe not found in resources");
        }

        try
        {
            File.Copy(source, Path.Combine(game.InstallPath, "uninstall.exe"), overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to copy uninstall.exe: {error.Message}");
        }

        var config = new UninstallConfig
        {
            DesktopShortcutPath = ShellDirectories.DesktopShortcutPath(game.Title),
            GameTitle = game.Title,
            InstallPath = game.InstallPath,
            RegistryKeyName = keyName,
            ShortcutPath = shortcutPath,
        };
        try
        {
            File.WriteAllText(Path.Combine(game.InstallPath, "uninstall-config.json"), CoreJsonContext.SerializePretty(config));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to write uninstall-config.json: {error.Message}");
        }
    }

    private static void CreateShortcut(string exePath, string shortcutPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath)!);
        ShellLinkWriter.Create(exePath, shortcutPath);
    }

    private static void WriteRegistry(InstalledGame game, string keyName, string uninstallExe)
    {
        using var key = Registry.CurrentUser.CreateSubKey($@"{UninstallRoot}\{keyName}", writable: true);
        key.SetValue("DisplayName", game.Title, RegistryValueKind.String);
        key.SetValue("UninstallString", uninstallExe, RegistryValueKind.String);
        key.SetValue("QuietUninstallString", uninstallExe, RegistryValueKind.String);
        key.SetValue("InstallLocation", game.InstallPath, RegistryValueKind.String);
        key.SetValue("Publisher", "Claudio", RegistryValueKind.String);
        key.SetValue("InstallDate", DateTime.UtcNow.ToString("yyyyMMdd"), RegistryValueKind.String);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        if (game.GameExe is { } exe)
        {
            key.SetValue("DisplayIcon", exe, RegistryValueKind.String);
        }

        key.SetValue("EstimatedSize", (int)Math.Min(DirectorySizeKb(game.InstallPath), int.MaxValue), RegistryValueKind.DWord);
    }

    private static long DirectorySizeKb(string path)
    {
        long total = 0;
        try
        {
            foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            {
                try
                {
                    total += new FileInfo(file).Length;
                }
                catch (IOException)
                {
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }

        return total / 1024;
    }
}
