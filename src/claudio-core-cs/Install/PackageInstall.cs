using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class PackageInstall
{
    public static async Task<string> DownloadAsync(RpcHost host, InstallState state, DownloadPackageInput input)
    {
        var control = state.Start(input.Id);
        var targetDir = input.TargetDir;
        var targetExisted = Directory.Exists(targetDir);
        string? result = null;
        CommandException? failure = null;
        try
        {
            result = await DownloadInnerAsync(host, input, control);
        }
        catch (CommandException error)
        {
            failure = error;
            if (!control.IsCancelled)
            {
                Progress.Emit(host, input.Id, "failed", null, $"Download failed for {input.Title}: {error.Message}");
            }
        }

        state.Finish(input.Id);
        try
        {
            var downloadRoot = SettingsStore.ResolveDownloadRoot(SettingsStore.Load());
            FileOps.TryDeleteTree(InstallPaths.DownloadWorkspaceRoot(downloadRoot, input.Id, input.Title));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log.Warn("claudio_core", $"Could not clean the download workspace: {error.Message}");
        }

        if (control.IsCancelled)
        {
            if (!targetExisted)
            {
                TryRemoveEmptyDirectory(targetDir);
            }

            throw new CommandException("Download cancelled.");
        }

        return failure is null ? result! : throw failure;
    }

    private static void TryRemoveEmptyDirectory(string path)
    {
        try
        {
            Directory.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static async Task<string> DownloadInnerAsync(RpcHost host, DownloadPackageInput input, InstallControl control)
    {
        Log.Info("claudio_core", $"Starting package download for '{input.Title}' (id={input.Id}, target_dir={input.TargetDir}, extract={input.Extract})");
        Progress.Emit(host, input.Id, "starting", 0, "Preparing download");

        var settings = SettingsStore.Load();
        var serverUrl = settings.ServerUrl ?? throw new CommandException("Desktop server URL is not configured.");
        var targetDir = input.TargetDir;
        try
        {
            Directory.CreateDirectory(targetDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create target folder for package download", targetDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the target folder", targetDir, error));
        }

        var tempRoot = PrepareWorkspace(settings, input);
        var downloadInfo = await PackageDownload.RunAsync(
            host,
            new DownloadOptions
            {
                ServerUrl = serverUrl,
                CustomHeaders = settings.CustomHeaders,
                SpeedLimitKbs = settings.DownloadSpeedLimitKbs,
                ProgressScale = 100.0,
            },
            input.Id,
            input.Title,
            tempRoot,
            control);

        var finalPath = input.Extract
            ? await ExtractIntoTargetAsync(host, input, control, tempRoot, downloadInfo, targetDir)
            : SavePackage(host, input, downloadInfo, targetDir);

        FileOps.TryDeleteTree(tempRoot);
        Progress.Emit(host, input.Id, "completed", 100, "Download complete");
        Log.Info("claudio_core", $"Package download complete for '{input.Title}': {finalPath}");
        return finalPath;
    }

    private static string PrepareWorkspace(DesktopSettings settings, DownloadPackageInput input)
    {
        var downloadsRoot = SettingsStore.ResolveDownloadRoot(settings);
        var tempRoot = InstallPaths.DownloadWorkspaceRoot(downloadsRoot, input.Id, input.Title);
        try
        {
            if (Directory.Exists(tempRoot))
            {
                FileOps.DeleteTree(tempRoot);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("remove stale package download workspace", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("clean the package download workspace", tempRoot, error));
        }

        try
        {
            Directory.CreateDirectory(tempRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create package download workspace", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the package download workspace", tempRoot, error));
        }

        return tempRoot;
    }

    private static async Task<string> ExtractIntoTargetAsync(
        RpcHost host,
        DownloadPackageInput input,
        InstallControl control,
        string tempRoot,
        DownloadInfo downloadInfo,
        string targetDir)
    {
        string staging;
        if (downloadInfo.IsIndividual)
        {
            Progress.Emit(host, input.Id, "extracting", null, "Moving files…");
            staging = downloadInfo.FilePath;
        }
        else
        {
            Progress.Emit(host, input.Id, "extracting", null, "Extracting archive…");
            staging = Path.Combine(tempRoot, "extract");
            FileOps.ClearExistingPath(staging);
            try
            {
                Directory.CreateDirectory(staging);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                FileOps.LogIoFailure("create package extraction staging directory", staging, error);
                throw new CommandException(FileOps.FormatInstallIoError("create the package extraction staging directory", staging, error));
            }

            await Task.Factory.StartNew(
                () => Extract.ArchiveOrCopy(
                    downloadInfo.FilePath,
                    staging,
                    control,
                    host.ResourceDir,
                    _ => Progress.Emit(host, input.Id, "extracting", null, "Extracting archive…")),
                CancellationToken.None,
                TaskCreationOptions.LongRunning,
                TaskScheduler.Default);
        }

        var moved = await Task.Run(() => FileOps.MoveVisibleEntriesIntoDir(staging, targetDir));
        if (control.IsCancelled)
        {
            foreach (var path in moved)
            {
                FileOps.TryDeleteTree(path);
            }

            throw new CommandException("Install cancelled.");
        }

        return targetDir;
    }

    private static string SavePackage(RpcHost host, DownloadPackageInput input, DownloadInfo downloadInfo, string targetDir)
    {
        Progress.Emit(host, input.Id, "extracting", null, "Saving archive…");
        var destination = Path.Combine(targetDir, Path.GetFileName(downloadInfo.FilePath));
        FileOps.ClearExistingPath(destination);
        try
        {
            File.Move(downloadInfo.FilePath, destination);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            try
            {
                File.Copy(downloadInfo.FilePath, destination, overwrite: true);
            }
            catch (Exception copyError) when (copyError is IOException or UnauthorizedAccessException)
            {
                FileOps.LogIoFailurePair("copy downloaded package into target directory", downloadInfo.FilePath, destination, copyError);
                throw new CommandException(FileOps.FormatInstallIoErrorPair(
                    "copy the downloaded package into the target directory",
                    downloadInfo.FilePath,
                    destination,
                    copyError));
            }
        }

        return destination;
    }
}
