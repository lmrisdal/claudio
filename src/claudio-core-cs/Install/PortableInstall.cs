using Claudio.Core.Linux;
using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class PortableInstall
{
    public static async Task<InstalledGame> RunAsync(
        RpcHost host,
        RemoteGame game,
        string targetDir,
        string packagePath,
        InstallControl control)
    {
        Progress.Emit(host, game.Id, "extracting", 60, "Extracting game");

        string payloadDir = targetDir;
        string? winePrefix = null;
        string? protonPath = null;
        if (OperatingSystem.IsLinux())
        {
            (payloadDir, protonPath) = await PrepareUmuRuntimeAsync(host, game, targetDir, control);
            winePrefix = targetDir;
        }

        var extractRoot = Path.ChangeExtension(targetDir, "extracting");
        var gameExe = await Task.Factory.StartNew(
            () => ExtractAndFinalize(host, game, packagePath, extractRoot, payloadDir, control),
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
            WinePrefix = winePrefix,
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

    private static string? ExtractAndFinalize(
        RpcHost host,
        RemoteGame game,
        string packagePath,
        string extractRoot,
        string payloadDir,
        InstallControl control)
    {
        try
        {
            if (Directory.Exists(extractRoot))
            {
                FileOps.DeleteTree(extractRoot);
            }

            Directory.CreateDirectory(extractRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("prepare extract staging directory", extractRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the extract staging directory", extractRoot, error));
        }

        Extract.ArchiveOrCopy(
            packagePath,
            extractRoot,
            control,
            host.ResourceDir,
            ratio => Progress.Emit(host, game.Id, "extracting", 60.0 + ratio * 35.0, "Extracting game…"));
        Progress.Emit(host, game.Id, "extracting", 96, "Moving files…");
        return PayloadOps.FinalizePortablePayload(extractRoot, payloadDir, game.GameExe);
    }

    [System.Runtime.Versioning.SupportedOSPlatform("linux")]
    private static async Task<(string PayloadDir, string ProtonPath)> PrepareUmuRuntimeAsync(
        RpcHost host,
        RemoteGame game,
        string targetDir,
        InstallControl control)
    {
        var protonPath = Proton.SelectedPath(game.ProtonPath);
        Progress.EmitIndeterminate(host, game.Id, "preparing-prefix", 60, "Preparing Proton prefix...", true);
        await Task.Factory.StartNew(
            () => UmuCommand.PreparePrefix(targetDir, protonPath, () => control.IsCancelled),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);

        var payloadDir = PayloadOps.PrefixPayloadDirectory(targetDir, game.Title);
        try
        {
            Directory.CreateDirectory(payloadDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create portable game directory in UMU prefix", payloadDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the portable game folder", payloadDir, error));
        }

        return (payloadDir, protonPath);
    }
}
