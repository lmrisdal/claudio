using System.Diagnostics;
using Claudio.Core.Linux;
using Claudio.Core.Logging;

namespace Claudio.Core.Install;

internal static class GameExecutables
{
    public static List<string> List(int remoteGameId)
    {
        var game = Games.RequireInstalled(remoteGameId);
        var exes = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var root in SearchRoots(game))
        {
            var matches = new List<string>();
            PayloadOps.CollectMatching(root, matches, IsWindowsExecutable);
            foreach (var path in matches)
            {
                exes.Add(Path.GetRelativePath(root, path));
            }
        }

        return exes.ToList();
    }

    public static InstalledGame SetExe(int remoteGameId, string gameExe)
    {
        var game = Games.RequireInstalled(remoteGameId);
        game.GameExe = ResolvePath(game, gameExe);
        return InstalledGamesRegistry.Upsert(game);
    }

    public static InstalledGame UpdateLaunchSettings(int remoteGameId, string? gameExe, string? protonPath, GameLaunchOptions options)
    {
        if (!OperatingSystem.IsWindows())
        {
            LaunchArguments.Parse(options.Parameters);
        }

        var game = Games.RequireInstalled(remoteGameId);
        game.GameExe = string.IsNullOrWhiteSpace(gameExe) ? null : ResolvePath(game, gameExe);
        options.UmuGameId = string.IsNullOrWhiteSpace(options.UmuGameId) ? null : options.UmuGameId;
        game.ProtonPath = string.IsNullOrWhiteSpace(protonPath) ? null : protonPath;
        game.LaunchOptions = options;
        return InstalledGamesRegistry.Upsert(game);
    }

    public static string ResolvePath(InstalledGame game, string gameExe)
    {
        if (Path.IsPathRooted(gameExe))
        {
            return Validate(gameExe);
        }

        foreach (var root in SearchRoots(game))
        {
            var candidate = Path.Combine(root, gameExe);
            if (File.Exists(candidate) || Directory.Exists(candidate))
            {
                return Validate(candidate);
            }
        }

        throw new CommandException("Selected executable no longer exists.");
    }

    private static string Validate(string path)
    {
        if (!File.Exists(path))
        {
            throw new CommandException("Selected executable no longer exists.");
        }

        return IsWindowsExecutable(path) ? path : throw new CommandException("Selected file is not a Windows executable.");
    }

    private static List<string> SearchRoots(InstalledGame game)
    {
        var roots = new List<string> { game.InstallPath };
        if (OperatingSystem.IsLinux() && game.WinePrefix is { } prefix)
        {
            var driveC = Path.Combine(prefix, "pfx", "drive_c");
            if (prefix == game.InstallPath)
            {
                roots.Clear();
                roots.Add(driveC);
            }
            else if (!driveC.StartsWith(game.InstallPath, StringComparison.Ordinal) && !roots.Contains(driveC))
            {
                roots.Add(driveC);
            }
        }

        return roots;
    }

    private static bool IsWindowsExecutable(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) || extension.Equals(".bat", StringComparison.OrdinalIgnoreCase);
    }

    public static void OpenInstallFolder(int remoteGameId)
    {
        var installed = Games.RequireInstalled(remoteGameId);
        if (!Directory.Exists(installed.InstallPath) && !File.Exists(installed.InstallPath))
        {
            throw new CommandException("Installed path no longer exists.");
        }

        var path = OperatingSystem.IsLinux() ? HostPaths.NestedRuntimePath(installed.InstallPath) : installed.InstallPath;
        Log.Info("claudio_core", $"[open-folder] opening install folder {path}");
        var info = OperatingSystem.IsWindows() ? WindowsOpenCommand() : LinuxOpenCommand(path);
        info.ArgumentList.Add(path);
        try
        {
            using var process = Process.Start(info);
            if (info.RedirectStandardInput)
            {
                process?.StandardInput.Close();
            }
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            Log.Error("claudio_core", $"[open-folder] failed to open {path}: {error.Message}");
            throw new CommandException($"Could not open {path}: {error.Message}");
        }
    }

    private static ProcessStartInfo WindowsOpenCommand() => new("explorer")
    {
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
    };

    // xdg-open often execs the file manager, which would inherit redirected pipes and die of SIGPIPE
    // once they are closed, so it gets /dev/null like a launched game.
    private static ProcessStartInfo LinuxOpenCommand(string path)
    {
        var xdgOpen = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(directory => Path.Combine(directory, "xdg-open"))
            .FirstOrDefault(File.Exists)
            ?? throw new CommandException($"Could not open {path}: No such file or directory (os error 2)");
        var info = new ProcessStartInfo("/bin/sh") { UseShellExecute = false };
        info.ArgumentList.Add("-c");
        info.ArgumentList.Add(Runtime.DetachedProcess.ShellScript);
        info.ArgumentList.Add(xdgOpen);
        return info;
    }
}
