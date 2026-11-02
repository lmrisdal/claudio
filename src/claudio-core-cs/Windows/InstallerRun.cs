using System.Runtime.Versioning;
using Claudio.Core.Install;
using Claudio.Core.Logging;

namespace Claudio.Core.Windows;

[SupportedOSPlatform("windows6.1")]
internal static class InstallerRun
{
    private const string RunAsInvokerLayer = "RunAsInvoker";
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(120);

    public static void Run(
        string path,
        string targetDir,
        bool forceInteractive,
        bool runAsAdministrator,
        bool forceRunAsInvoker,
        InstallControl control)
    {
        var installerType = InstallerDetect.DetectType(path);
        Log.Info("claudio_core", $"Detected installer type: {installerType} for {path}");

        if (!forceInteractive && installerType == InstallerType.GogInnoSetup)
        {
            try
            {
                InnoExtract.Run(path, targetDir);
                return;
            }
            catch (CommandException error)
            {
                Log.Warn("claudio_core", $"innoextract failed ({error.Message}), falling back to silent InnoSetup install");
                FileOps.TryDeleteTree(targetDir);
            }
        }

        var args = InstallerArguments.Build(installerType, targetDir, forceInteractive);
        string program;
        if (installerType == InstallerType.Msi)
        {
            args.InsertRange(0, ["/i", path]);
            program = "msiexec";
        }
        else
        {
            program = path;
        }

        var argumentLine = InstallerArguments.WindowsArgumentLine(installerType, args);
        var invoker = installerType != InstallerType.Msi && forceRunAsInvoker;
        Log.Info("claudio_core", $"[installer] launching {program} {argumentLine}");
        SpawnAndWait(program, argumentLine, Path.GetDirectoryName(path) ?? ".", runAsAdministrator, invoker, control);
    }

    private static void SpawnAndWait(
        string program,
        string argumentLine,
        string workingDirectory,
        bool runAsAdministrator,
        bool forceRunAsInvoker,
        InstallControl control)
    {
        var exeName = Path.GetFileName(program);
        if (runAsAdministrator)
        {
            Log.Info("claudio_core", $"[installer] launching {program} with administrator privileges");
            NativeProcess elevated;
            try
            {
                elevated = ElevatedProcess.Launch(program, argumentLine, Path.GetDirectoryName(program));
            }
            catch (CommandException error)
            {
                throw new RunInstallerException(RunInstallerOutcome.Failed, error.Message);
            }

            using (elevated)
            {
                Log.Info("claudio_core", $"[installer] launched elevated installer {program} with PID {elevated.Pid}");
                WaitFor(elevated, exeName, control, elevated: true);
            }

            return;
        }

        NativeProcess process;
        try
        {
            var environment = forceRunAsInvoker
                ? new Dictionary<string, string> { ["__COMPAT_LAYER"] = RunAsInvokerLayer }
                : null;
            process = NativeProcess.Start(program, argumentLine, workingDirectory, environment);
        }
        catch (RequiresAdministratorException)
        {
            Log.Warn("claudio_core", $"[installer] Windows reported elevation required (error 740) for {program}");
            throw new RunInstallerException(RunInstallerOutcome.RequiresAdministrator);
        }
        catch (CommandException error)
        {
            throw new RunInstallerException(RunInstallerOutcome.Failed, error.Message);
        }

        using (process)
        {
            if (forceRunAsInvoker)
            {
                Log.Info("claudio_core", $"[installer] non-admin launch started successfully for {program}; any later UAC prompt is coming from the installer, not Claudio fallback");
            }

            Log.Info("claudio_core", $"[installer] launched installer {program} with PID {process.Pid}");
            WaitFor(process, exeName, control, elevated: false);
        }
    }

    private static void WaitFor(NativeProcess process, string exeName, InstallControl control, bool elevated)
    {
        control.SetInstallerProcess(process.Pid, exeName);
        while (true)
        {
            control.RefreshTrackedProcesses();
            if (control.TakeRestartInteractiveRequest())
            {
                Log.Info("claudio_core", "[installer] stopping installer to relaunch interactively");
                Stop(process, control, elevated);
                control.SetCancelled(false);
                throw new RunInstallerException(RunInstallerOutcome.RestartInteractiveRequested);
            }

            if (control.IsCancelled)
            {
                Log.Info("claudio_core", "[installer] stopping installer after cancel request");
                Stop(process, control, elevated);
                throw new RunInstallerException(RunInstallerOutcome.Cancelled);
            }

            if (process.TryWaitForExit() is { } code)
            {
                control.ClearInstallerProcesses();
                if (code == 0)
                {
                    return;
                }

                throw new RunInstallerException(
                    RunInstallerOutcome.Failed,
                    elevated ? $"Installer exited with status code {code}." : $"Installer exited with status exit code: {code}.");
            }

            Thread.Sleep(PollInterval);
        }
    }

    private static void Stop(NativeProcess process, InstallControl control, bool elevated)
    {
        if (elevated)
        {
            process.Terminate();
        }

        control.TerminateExternalInstaller();
        control.ClearInstallerProcesses();
    }
}
