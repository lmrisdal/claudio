using Claudio.Core.Rpc;

namespace Claudio.Core.Commands;

internal sealed class InstallState
{
    private readonly Lock gate = new();
    private readonly Dictionary<int, InstallControl> installs = new();

    public bool HasActiveOperations
    {
        get
        {
            lock (gate)
            {
                return installs.Count > 0;
            }
        }
    }

    public InstallControl Start(int gameId)
    {
        lock (gate)
        {
            if (installs.ContainsKey(gameId))
            {
                throw new CommandException("This game is already being installed.");
            }

            if (installs.Count == 0 && OperatingSystem.IsWindowsVersionAtLeast(6, 1))
            {
                Windows.SleepPrevention.Acquire();
            }

            var control = new InstallControl();
            installs[gameId] = control;
            return control;
        }
    }

    public void Finish(int gameId)
    {
        lock (gate)
        {
            if (installs.Remove(gameId) && installs.Count == 0 && OperatingSystem.IsWindowsVersionAtLeast(6, 1))
            {
                Windows.SleepPrevention.Release();
            }
        }
    }

    public void Cancel(RpcHost host, int gameId)
    {
        var control = Require(gameId);
        Logging.Log.Info("claudio_core", $"[installer {gameId}] stop requested");
        control.SetCancelled(true);
        Progress.EmitIndeterminate(host, gameId, "stopping", null, "Stopping installation...", true);
        control.TerminateExternalInstaller();
    }

    public void RestartInteractive(RpcHost host, int gameId)
    {
        var control = Require(gameId);
        Logging.Log.Info("claudio_core", $"[installer {gameId}] restart interactive requested");
        control.RequestRestartInteractive();
        Progress.EmitIndeterminate(host, gameId, "stopping", null, "Stopping installation to restart interactively...", true);
        control.TerminateExternalInstaller();
    }

    private InstallControl Require(int gameId)
    {
        lock (gate)
        {
            return installs.TryGetValue(gameId, out var control)
                ? control
                : throw new CommandException("No active install for this game.");
        }
    }
}
