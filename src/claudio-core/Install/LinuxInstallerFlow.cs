using System.Runtime.Versioning;
using Claudio.Core.Linux;
using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

[SupportedOSPlatform("linux")]
internal static class LinuxInstallerFlow
{
    public static async Task<InstalledGame> RunAsync(
        RpcHost host,
        RemoteGame game,
        string targetDir,
        string packagePath,
        InstallControl control)
    {
        Progress.Emit(host, game.Id, "extracting", 60, "Extracting installer");

        var stagingRoot = Path.GetDirectoryName(packagePath) is { Length: > 0 } parent ? parent : targetDir;
        var stagingDir = InstallPaths.InstallerStagingDir(stagingRoot);
        var installDirectory = PayloadOps.PrefixInstallDirectory(game.Title);
        var protonPath = Proton.SelectedPath(game.ProtonPath);

        var gameExe = await Task.Factory.StartNew(
            () => ExtractAndRun(host, game, packagePath, stagingDir, targetDir, installDirectory, protonPath, control),
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
            WinePrefix = targetDir,
            ProtonPath = protonPath,
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

    private static string? ExtractAndRun(
        RpcHost host,
        RemoteGame game,
        string packagePath,
        string stagingDir,
        string prefix,
        string installDirectory,
        string protonPath,
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

        Extract.ArchiveOrCopy(
            packagePath,
            stagingDir,
            control,
            host.ResourceDir,
            ratio => Progress.Emit(host, game.Id, "extracting", 60.0 + ratio * 25.0, "Extracting installer..."));

        var installer = InstallerDetect.ResolveInstallerPath(stagingDir, game.InstallerExe);
        Progress.EmitIndeterminate(host, game.Id, "installing-interactive", 88, "Running installer through Proton...", true);

        var args = InstallerArguments.Build(InstallerDetect.DetectType(installer), installDirectory, interactive: true);
        Log.Info("claudio_core", $"[installer {game.Id}] running {installer} with arguments [{string.Join(", ", args.Select(arg => $"\"{arg}\""))}]");
        UmuCommand.RunWait(prefix, protonPath, installer, args, () => control.IsCancelled);

        var driveC = Path.Combine(prefix, "pfx", "drive_c");
        try
        {
            InstallerCleanup.CleanupDirectory(stagingDir, "installer staging directory");
        }
        catch (CommandException)
        {
        }

        return ResolveGameExeHint(driveC, installDirectory, game.GameExe);
    }

    internal static string? ResolveGameExeHint(string driveC, string installDirectory, string? hint)
    {
        if (hint is null || !installDirectory.StartsWith(@"C:\", StringComparison.Ordinal))
        {
            return null;
        }

        var normalizedHint = hint.Replace('\\', '/');
        var destination = installDirectory[3..].Replace('\\', '/');
        return new[] { Path.Combine(driveC, normalizedHint), Path.Combine(driveC, destination, normalizedHint) }
            .FirstOrDefault(File.Exists);
    }
}
