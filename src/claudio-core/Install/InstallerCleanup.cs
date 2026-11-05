using Claudio.Core.Logging;

namespace Claudio.Core.Install;

internal static class InstallerCleanup
{
    public static void CleanupDirectory(string path, string label)
    {
        if (!Directory.Exists(path) && !File.Exists(path))
        {
            return;
        }

        Log.Info("claudio_core", $"[installer] removing {label} {path}");
        string? lastError = null;
        for (var attempt = 1; attempt <= 20; attempt++)
        {
            try
            {
                FileOps.DeleteTree(path);
                return;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                if (!Directory.Exists(path) && !File.Exists(path))
                {
                    return;
                }

                lastError = $"{error.Message} (raw_os_error={FileOps.RawOsError(error)})";
                Log.Warn("claudio_core", $"[installer] {label} cleanup attempt {attempt} failed for {path}: {lastError}");
                Thread.Sleep(Math.Min(attempt * 200, 2000));
            }
        }

        throw new CommandException($"Failed to remove {label} {path}: {lastError ?? "unknown error"}");
    }
}
