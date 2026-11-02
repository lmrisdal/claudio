namespace Claudio.Core.Install;

internal sealed class InstallControl
{
    private volatile bool cancelled;
    private volatile bool restartInteractive;
    private CancellationTokenSource tokenSource = new();

    public bool IsCancelled => cancelled;

    public CancellationToken Token => tokenSource.Token;

    public void SetCancelled(bool value)
    {
        cancelled = value;
        if (value)
        {
            tokenSource.Cancel();
        }
        else if (tokenSource.IsCancellationRequested)
        {
            tokenSource = new CancellationTokenSource();
        }
    }

    public void RequestRestartInteractive()
    {
        restartInteractive = true;
        SetCancelled(true);
    }

    public bool TakeRestartInteractiveRequest()
    {
        var requested = restartInteractive;
        restartInteractive = false;
        return requested;
    }

    private readonly Lock trackedGate = new();
    private readonly SortedSet<uint> trackedPids = new();
    private string? trackedExeName;

    public void SetInstallerProcess(uint pid, string? exeName)
    {
        lock (trackedGate)
        {
            trackedPids.Clear();
            if (pid != 0)
            {
                trackedPids.Add(pid);
            }

            trackedExeName = exeName;
        }
    }

    public void ClearInstallerProcesses()
    {
        lock (trackedGate)
        {
            trackedPids.Clear();
            trackedExeName = null;
        }
    }

    public (List<uint> Pids, string? ExeName) InstallerSnapshot()
    {
        lock (trackedGate)
        {
            return (trackedPids.ToList(), trackedExeName);
        }
    }

    public void RefreshTrackedProcesses()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            return;
        }

        var (pids, exeName) = InstallerSnapshot();
        var refreshed = Windows.ProcessTracking.Collect(pids, exeName);
        lock (trackedGate)
        {
            trackedPids.Clear();
            foreach (var pid in refreshed)
            {
                trackedPids.Add(pid);
            }
        }
    }

    public void TerminateExternalInstaller()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            return;
        }

        RefreshTrackedProcesses();
        var (pids, exeName) = InstallerSnapshot();
        Logging.Log.Info("claudio_core", $"[installer] force terminating tracked processes [{string.Join(", ", pids)}] (exe_name={exeName})");
        Windows.ProcessTracking.Terminate(pids, exeName);
    }
}
