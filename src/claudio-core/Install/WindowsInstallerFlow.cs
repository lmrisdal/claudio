using System.Runtime.Versioning;
using Claudio.Core.Logging;
using Claudio.Core.Rpc;
using Claudio.Core.Windows;

namespace Claudio.Core.Install;

[SupportedOSPlatform("windows6.1")]
internal static class WindowsInstallerFlow
{
    public static async Task<InstalledGame> RunAsync(
        RpcHost host,
        RemoteGame game,
        string targetDir,
        string packagePath,
        InstallControl control)
    {
        Progress.Emit(host, game.Id, "extracting", 60, "Extracting game");
        var stagingRoot = Path.GetDirectoryName(packagePath) is { Length: > 0 } parent ? parent : targetDir;
        var stagingDir = InstallPaths.InstallerStagingDir(stagingRoot);

        var gameExe = await Task.Factory.StartNew(
            () => ExtractAndInstall(host, game, packagePath, stagingDir, targetDir, control),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);

        return new InstalledGame
        {
            RemoteGameId = game.Id,
            Title = game.Title,
            Platform = game.Platform,
            InstallType = game.InstallType,
            InstallPath = targetDir,
            GameExe = gameExe,
            InstalledAt = Progress.CurrentTimestamp(),
            Summary = game.Summary,
            Genre = game.Genre,
            ReleaseYear = game.ReleaseYear,
            CoverUrl = game.CoverUrl,
            HeroUrl = game.HeroUrl,
            Developer = game.Developer,
            Publisher = game.Publisher,
            GameMode = game.GameMode,
            Series = game.Series,
            Franchise = game.Franchise,
            GameEngine = game.GameEngine,
        };
    }

    private static string? ExtractAndInstall(
        RpcHost host,
        RemoteGame game,
        string packagePath,
        string stagingDir,
        string targetDir,
        InstallControl control)
    {
        if (Directory.Exists(stagingDir))
        {
            try
            {
                InstallerCleanup.CleanupDirectory(stagingDir, "installer staging directory");
            }
            catch (CommandException error)
            {
                Log.Warn("claudio_core", $"[installer {game.Id}] failed to clean stale staging directory {stagingDir}: {error.Message}");
            }
        }

        try
        {
            Directory.CreateDirectory(stagingDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create installer staging directory", stagingDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the installer staging folder", stagingDir, error));
        }

        try
        {
            return Install(host, game, packagePath, stagingDir, targetDir, control);
        }
        catch (CommandException installError)
        {
            try
            {
                InstallerCleanup.CleanupDirectory(targetDir, "partial install directory");
            }
            catch (CommandException cleanupError)
            {
                throw new CommandException($"{installError.Message} Cleanup also failed: {cleanupError.Message}");
            }

            throw;
        }
    }

    private static string? Install(
        RpcHost host,
        RemoteGame game,
        string packagePath,
        string stagingDir,
        string targetDir,
        InstallControl control)
    {
        Extract.ArchiveOrCopy(
            packagePath,
            stagingDir,
            control,
            host.ResourceDir,
            ratio => Progress.Emit(host, game.Id, "extracting", 60.0 + ratio * 25.0, "Extracting game…"));
        Progress.Emit(host, game.Id, "extracting", 86, "Extracting game…");

        var installer = InstallerDetect.ResolveInstallerPath(stagingDir, game.InstallerExe);
        var requestsElevation = Path.GetExtension(installer).Equals(".exe", StringComparison.OrdinalIgnoreCase)
            && FileRequestsElevation(installer);
        if (requestsElevation)
        {
            Log.Info("claudio_core", $"[installer {game.Id}] detected embedded elevation request in {installer}");
        }

        var initial = InstallerAttemptConfig.Create(game.ForceInteractive ?? false, game.RunAsAdministrator ?? false, requestsElevation);
        if (initial.ForceRunAsInvoker)
        {
            Log.Info("claudio_core", $"[installer {game.Id}] trying non-admin launch with RunAsInvoker for {installer}");
        }

        Log.Info("claudio_core", $"[installer {game.Id}] starting {(initial.ForceInteractive ? "interactive" : "silent")} installer from {installer}");

        InstallerRetry.Run(
            initial,
            attempt =>
            {
                var detail = attempt.ForceInteractive
                    ? "Installing… The installer may ask for administrator permission."
                    : "Installing… The installer may ask for administrator permission. This may take a while…";
                Progress.EmitIndeterminate(host, game.Id, attempt.ForceInteractive ? "installing-interactive" : "installing", 87, detail, true);
                InstallerRun.Run(installer, targetDir, attempt.ForceInteractive, attempt.RunAsAdministrator, attempt.ForceRunAsInvoker, control);
            },
            () =>
            {
                Log.Info("claudio_core", $"[installer {game.Id}] restarting interactively after forced stop");
                InstallerCleanup.CleanupDirectory(targetDir, "partial install directory");
                Progress.EmitIndeterminate(host, game.Id, "stopping", 87, "Restarting installer in interactive mode…", true);
            },
            () =>
            {
                Log.Warn("claudio_core", $"[installer {game.Id}] installer still required administrator privileges after non-admin attempt");
                var confirmed = host.ConfirmAsync(
                    "Administrator Privileges Required",
                    "This installer requires administrator privileges. Continue?",
                    "Continue",
                    "Cancel").GetAwaiter().GetResult();
                if (confirmed)
                {
                    Log.Info("claudio_core", $"[installer {game.Id}] retrying installer launch as administrator after fallback prompt");
                    Progress.EmitIndeterminate(host, game.Id, "stopping", 87, "Restarting installer as administrator…", true);
                }
                else
                {
                    Log.Info("claudio_core", $"[installer {game.Id}] user declined administrator prompt after non-admin attempt");
                }

                return confirmed;
            });

        Progress.EmitIndeterminate(host, game.Id, "installing", 97, "Applying patches…", false);
        SceneOverrides.Apply(Path.GetDirectoryName(installer) ?? stagingDir, targetDir);
        try
        {
            InstallerCleanup.CleanupDirectory(stagingDir, "installer staging directory");
        }
        catch (CommandException)
        {
        }

        if (game.GameExe is { } entry)
        {
            var candidate = Path.Combine(targetDir, entry);
            if (File.Exists(candidate) || Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static bool FileRequestsElevation(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return InstallerDetect.StreamRequestsElevation(stream);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException(error.Message);
        }
    }
}
