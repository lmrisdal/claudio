namespace Claudio.Core.Install;

internal enum RunInstallerOutcome
{
    Cancelled,
    RestartInteractiveRequested,
    RequiresAdministrator,
    Failed,
}

internal sealed class RunInstallerException(RunInstallerOutcome outcome, string message = "") : Exception(message)
{
    public RunInstallerOutcome Outcome { get; } = outcome;
}

internal sealed record InstallerAttemptConfig(bool ForceInteractive, bool RunAsAdministrator, bool ForceRunAsInvoker)
{
    public static InstallerAttemptConfig Create(bool forceInteractive, bool runAsAdministrator, bool requestsElevation) =>
        new(forceInteractive, runAsAdministrator, requestsElevation && !runAsAdministrator);
}

internal static class InstallerRetry
{
    public static void Run(
        InstallerAttemptConfig attempt,
        Action<InstallerAttemptConfig> runOnce,
        Action onRestartInteractive,
        Func<bool> confirmElevation)
    {
        while (true)
        {
            try
            {
                runOnce(attempt);
                return;
            }
            catch (RunInstallerException error) when (error.Outcome == RunInstallerOutcome.RestartInteractiveRequested)
            {
                onRestartInteractive();
                attempt = attempt with { ForceInteractive = true };
            }
            catch (RunInstallerException error) when (error.Outcome == RunInstallerOutcome.Cancelled)
            {
                throw new CommandException("Install cancelled.");
            }
            catch (RunInstallerException error) when (error.Outcome == RunInstallerOutcome.RequiresAdministrator)
            {
                if (!confirmElevation())
                {
                    throw new CommandException("Install cancelled.");
                }

                attempt = attempt with { RunAsAdministrator = true, ForceRunAsInvoker = false };
            }
            catch (RunInstallerException error)
            {
                if (attempt.ForceInteractive)
                {
                    throw new CommandException(error.Message);
                }

                onRestartInteractive();
                attempt = attempt with { ForceInteractive = true };
            }
        }
    }
}
