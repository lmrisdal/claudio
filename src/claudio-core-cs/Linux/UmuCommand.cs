using System.Diagnostics;
using Claudio.Core.Logging;

namespace Claudio.Core.Linux;

[System.Runtime.Versioning.SupportedOSPlatform("linux")]
internal static class UmuCommand
{
    public static LoggedChild SpawnPrefixCommand(
        string prefix,
        string protonPath,
        string exe,
        IReadOnlyList<string> extraArgs,
        string? gameId,
        string? store)
    {
        var umuRun = Umu.ResolveRun();
        var runtimePrefix = HostPaths.NestedRuntimePath(prefix);
        var runtimeExe = HostPaths.NestedRuntimePath(exe);
        var info = PrefixCommand(umuRun, runtimeExe, extraArgs);
        info.WorkingDirectory = Path.GetDirectoryName(exe) is { Length: > 0 } parent ? parent : ".";
        SetEnvironment(info, runtimePrefix, protonPath, gameId ?? "umu-default", store ?? "none");
        Log.Info("claudio_core", $"[umu] starting {runtimeExe} with prefix {runtimePrefix} and Proton {protonPath}");
        try
        {
            return ProcessLog.Spawn(info, "umu");
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new CommandException($"Failed to start UMU for {runtimeExe} with prefix {runtimePrefix}: {error.Message}");
        }
    }

    internal static ProcessStartInfo PrefixCommand(string umuRun, string exe, IReadOnlyList<string> extraArgs)
    {
        var info = new ProcessStartInfo(umuRun);
        if (exe.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
        {
            info.ArgumentList.Add("msiexec");
            info.ArgumentList.Add("/i");
        }

        info.ArgumentList.Add(exe);
        foreach (var argument in extraArgs)
        {
            info.ArgumentList.Add(argument);
        }

        return info;
    }

    private static void SetEnvironment(ProcessStartInfo info, string prefix, string protonPath, string gameId, string store)
    {
        info.Environment["WINEPREFIX"] = prefix;
        info.Environment["PROTONPATH"] = protonPath;
        info.Environment["GAMEID"] = gameId;
        info.Environment["STORE"] = store;
        info.Environment["UMU_LOG"] = "debug";
    }

    public static void PreparePrefix(string prefix, string protonPath, Func<bool> cancelled)
    {
        try
        {
            Directory.CreateDirectory(prefix);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to create Wine prefix {prefix}: {error.Message}");
        }

        var umuRun = Umu.ResolveRun();
        var runtimePrefix = HostPaths.NestedRuntimePath(prefix);
        var info = new ProcessStartInfo(umuRun) { WorkingDirectory = prefix };
        info.ArgumentList.Add("");
        SetEnvironment(info, runtimePrefix, protonPath, "umu-default", "none");
        Log.Info("claudio_core", $"[umu] preparing prefix {runtimePrefix} with Proton {protonPath}");
        LoggedChild child;
        try
        {
            child = ProcessLog.Spawn(info, "umu");
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new CommandException($"Failed to prepare UMU prefix {runtimePrefix} with Proton {protonPath}: {error.Message}");
        }

        using (child.Process)
        {
            WaitFor(child, cancelled, $"preparing prefix {runtimePrefix}");
        }
    }

    public static void RunWait(string prefix, string protonPath, string exe, IReadOnlyList<string> extraArgs, Func<bool> cancelled)
    {
        var child = SpawnPrefixCommand(prefix, protonPath, exe, extraArgs, null, null);
        using (child.Process)
        {
            WaitFor(child, cancelled, $"running {exe}");
        }
    }

    private static void WaitFor(LoggedChild child, Func<bool> cancelled, string activity)
    {
        while (true)
        {
            if (cancelled())
            {
                child.Process.Kill(entireProcessTree: true);
                child.Process.WaitForExit();
                throw new CommandException("Install cancelled.");
            }

            if (child.Process.WaitForExit(250))
            {
                break;
            }
        }

        child.Process.WaitForExit();
        if (child.Process.ExitCode != 0)
        {
            throw new CommandException(
                $"UMU exited with status exit status: {child.Process.ExitCode} while {activity}.\n{child.Tail.Format("UMU")}");
        }
    }
}
