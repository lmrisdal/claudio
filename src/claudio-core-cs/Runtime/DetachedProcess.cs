using System.Diagnostics;

namespace Claudio.Core.Runtime;

internal static class DetachedProcess
{
    internal const string ShellScript = "exec \"$0\" \"$@\" </dev/null >/dev/null 2>&1";

    [System.Runtime.Versioning.SupportedOSPlatform("windows6.1")]
    public static int StartWindows(string exe, string rawParameters, string workingDirectory, bool elevated)
    {
        try
        {
            if (elevated)
            {
                using var process = Windows.ElevatedProcess.Launch(exe, rawParameters, workingDirectory);
                return (int)process.Pid;
            }

            using var started = Windows.NativeProcess.Start(exe, rawParameters, workingDirectory);
            return (int)started.Pid;
        }
        catch (Windows.RequiresAdministratorException)
        {
            throw new CommandException("Failed to launch game: The requested operation requires elevation. (os error 740)");
        }
        catch (CommandException error)
        {
            throw new CommandException($"Failed to launch game: {error.Message}");
        }
    }

    public static int Start(string exe, IEnumerable<string> arguments, string workingDirectory)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new CommandException("Launching games is not supported on this platform.");
        }

        if (!File.Exists(exe))
        {
            throw new CommandException("Failed to launch game: No such file or directory (os error 2)");
        }

        if ((File.GetUnixFileMode(exe) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) == 0)
        {
            throw new CommandException("Failed to launch game: Permission denied (os error 13)");
        }

        var info = new ProcessStartInfo("/bin/sh") { WorkingDirectory = workingDirectory, UseShellExecute = false };
        info.ArgumentList.Add("-c");
        info.ArgumentList.Add(ShellScript);
        info.ArgumentList.Add(exe);
        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        try
        {
            using var process = Process.Start(info) ?? throw new CommandException("Failed to launch game: process did not start");
            return process.Id;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new CommandException($"Failed to launch game: {error.Message}");
        }
    }
}
