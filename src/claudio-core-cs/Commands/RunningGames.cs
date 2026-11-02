using System.Diagnostics;
using Claudio.Core.Linux;

namespace Claudio.Core.Commands;

internal sealed class RunningGames
{
    private readonly Lock gate = new();
    private readonly Dictionary<int, RunningGameInfo> games = new();

    public List<RunningGameInfo> ListActive()
    {
        lock (gate)
        {
            foreach (var id in games.Where(pair => !IsProcessRunning(pair.Value.Pid)).Select(pair => pair.Key).ToList())
            {
                games.Remove(id);
            }

            return games.Values.ToList();
        }
    }

    public void EnsureNotRunning(int gameId)
    {
        lock (gate)
        {
            if (games.TryGetValue(gameId, out var game) && IsProcessRunning(game.Pid))
            {
                throw new CommandException("This game is already running.");
            }

            games.Remove(gameId);
        }
    }

    public void Launch(int remoteGameId)
    {
        EnsureNotRunning(remoteGameId);
        var game = Games.RequireInstalled(remoteGameId);
        var arguments = OperatingSystem.IsWindows() ? [] : LaunchArguments.Parse(game.LaunchOptions.Parameters);
        var exe = game.GameExe ?? throw new CommandException("No executable is set for this game.");
        if (game.WinePrefix is not null && OperatingSystem.IsLinux())
        {
            LaunchInPrefix(game, exe, arguments);
            return;
        }

        var workingDirectory = Path.GetDirectoryName(exe);
        var directory = string.IsNullOrEmpty(workingDirectory) ? "." : workingDirectory;
        var pid = OperatingSystem.IsWindowsVersionAtLeast(6, 1)
            ? DetachedProcess.StartWindows(exe, game.LaunchOptions.Parameters, directory, game.LaunchOptions.RunAsAdministrator)
            : DetachedProcess.Start(exe, arguments, directory);
        Upsert(new RunningGameInfo
        {
            GameId = remoteGameId,
            Pid = (uint)pid,
            ExePath = exe,
            StartedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(),
        });
    }

    [System.Runtime.Versioning.SupportedOSPlatform("linux")]
    private void LaunchInPrefix(InstalledGame game, string exe, List<string> arguments)
    {
        var child = UmuCommand.SpawnPrefixCommand(
            game.WinePrefix!,
            game.ProtonPath ?? "UMU-Latest",
            exe,
            arguments,
            game.LaunchOptions.UmuGameId,
            null);
        Upsert(new RunningGameInfo
        {
            GameId = game.RemoteGameId,
            Pid = (uint)child.Process.Id,
            ExePath = exe,
            StartedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(),
        });
    }

    public void Upsert(RunningGameInfo game)
    {
        lock (gate)
        {
            games[game.GameId] = game;
        }
    }

    public void Stop(int remoteGameId)
    {
        RunningGameInfo running;
        lock (gate)
        {
            if (!games.Remove(remoteGameId, out running!))
            {
                throw new CommandException("This game is not running.");
            }
        }

        KillProcessTree(running.Pid);
    }

    private static void KillProcessTree(uint pid)
    {
        if (OperatingSystem.IsWindows())
        {
            if (RunQuiet("taskkill", "/PID", pid.ToString(), "/T", "/F") is not 0)
            {
                throw new CommandException($"Failed to stop game process (PID {pid}).");
            }

            return;
        }

        RunQuiet("pkill", "-TERM", "-P", pid.ToString());
        if (RunQuiet("kill", "-TERM", pid.ToString()) is not 0)
        {
            throw new CommandException($"Failed to stop game process (PID {pid}).");
        }

        if (WaitForExit(pid))
        {
            return;
        }

        RunQuiet("pkill", "-KILL", "-P", pid.ToString());
        RunQuiet("kill", "-KILL", pid.ToString());
        if (!WaitForExit(pid))
        {
            throw new CommandException($"Failed to stop game process (PID {pid}).");
        }
    }

    private static bool WaitForExit(uint pid)
    {
        for (var attempt = 0; attempt < 12; attempt++)
        {
            if (!IsProcessRunning(pid))
            {
                return true;
            }

            Thread.Sleep(100);
        }

        return false;
    }

    private static int? RunQuiet(string command, params string[] arguments)
    {
        var info = new ProcessStartInfo(command)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        try
        {
            using var process = Process.Start(info);
            if (process is null)
            {
                return null;
            }

            process.StandardInput.Close();
            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            Logging.Log.Warn("claudio_core", $"{command} failed to start: {error.Message}");
            return null;
        }
    }

    internal static bool IsProcessRunning(uint pid)
    {
        if (OperatingSystem.IsLinux())
        {
            try
            {
                var stat = File.ReadAllText($"/proc/{pid}/stat");
                var state = stat[(stat.LastIndexOf(')') + 2)..].TrimStart();
                return state.Length > 0 && state[0] != 'Z';
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentOutOfRangeException)
            {
                return false;
            }
        }

        try
        {
            using var process = Process.GetProcessById((int)pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
