using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

namespace Claudio.Uninstaller;

internal static class Program
{
    private const string UninstallRoot = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    private static void Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--do-delete")
        {
            DoDelete(args[1], args.Length >= 3 ? args[2] : "Game");
            ScheduleSelfDelete(Environment.ProcessPath ?? "");
            return;
        }

        RunPhaseOne();
    }

    private static void RunPhaseOne()
    {
        var exePath = Environment.ProcessPath;
        if (exePath is null)
        {
            Dialogs.Error("Could not determine uninstaller path.");
            return;
        }

        UninstallConfig config;
        try
        {
            var configPath = Path.Combine(Path.GetDirectoryName(exePath) ?? ".", "uninstall-config.json");
            config = JsonSerializer.Deserialize(File.ReadAllText(configPath), UninstallJsonContext.Default.UninstallConfig)
                ?? throw new JsonException("configuration is empty");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            Dialogs.Error($"Could not read uninstall configuration: {error.Message}");
            return;
        }

        if (!Dialogs.Confirm($"Are you sure you want to uninstall {config.GameTitle}?\n\nThis will permanently delete all game files."))
        {
            return;
        }

        DeleteRegistryKey(config.RegistryKeyName);
        TryDelete(config.ShortcutPath);
        TryDelete(config.DesktopShortcutPath);

        var tempExe = Path.Combine(Path.GetTempPath(), $"claudio-uninstall-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.exe");
        try
        {
            File.Copy(exePath, tempExe, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Dialogs.Error($"Could not prepare uninstaller: {error.Message}\n\nPlease delete the game folder manually:\n{config.InstallPath}");
            return;
        }

        var info = new ProcessStartInfo(tempExe) { UseShellExecute = false, CreateNoWindow = true };
        info.ArgumentList.Add("--do-delete");
        info.ArgumentList.Add(config.InstallPath);
        info.ArgumentList.Add(config.GameTitle);
        try
        {
            Process.Start(info)?.Dispose();
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }

    private static void DoDelete(string installPath, string gameTitle)
    {
        Thread.Sleep(500);
        if (Directory.Exists(installPath))
        {
            try
            {
                ClearReadOnly(new DirectoryInfo(installPath));
                Directory.Delete(installPath, recursive: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                Dialogs.Error($"Failed to delete game files: {error.Message}\n\nPlease delete the folder manually:\n{installPath}");
                return;
            }
        }

        Dialogs.Info($"{gameTitle} has been successfully uninstalled.");
    }

    private static void ClearReadOnly(DirectoryInfo directory)
    {
        if (directory.LinkTarget is not null)
        {
            return;
        }

        foreach (var child in directory.EnumerateFileSystemInfos())
        {
            if (child.LinkTarget is not null)
            {
                continue;
            }

            if ((child.Attributes & FileAttributes.ReadOnly) != 0)
            {
                child.Attributes &= ~FileAttributes.ReadOnly;
            }

            if (child is DirectoryInfo subdirectory)
            {
                ClearReadOnly(subdirectory);
            }
        }
    }

    private static void ScheduleSelfDelete(string exePath)
    {
        if (!OperatingSystem.IsWindows() || exePath.Length == 0)
        {
            return;
        }

        var info = new ProcessStartInfo("cmd") { UseShellExecute = false, CreateNoWindow = true };
        info.ArgumentList.Add("/c");
        info.ArgumentList.Add($"ping 127.0.0.1 -n 3 > nul & del /f /q \"{exePath}\"");
        try
        {
            Process.Start(info)?.Dispose();
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }

    private static void DeleteRegistryKey(string keyName)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            return;
        }

        try
        {
            Registry.CurrentUser.DeleteSubKeyTree($@"{UninstallRoot}\{keyName}", throwOnMissingSubKey: false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
        }
    }

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return;
        }

        try
        {
            File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }
}
