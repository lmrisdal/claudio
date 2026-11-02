using System.Text.Json;
using Claudio.Core.Json;
using Claudio.Core.Linux;
using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class GameInstaller
{
    private const string MarkerName = ".claudio-download-complete.json";

    public static Task<InstalledGame> InstallAsync(RpcHost host, InstallState state, RemoteGame game) =>
        RunAsync(host, state, game, reuseCachedPackage: false, failurePrefix: "Install failed for");

    public static Task<InstalledGame> RetryCachedAsync(RpcHost host, InstallState state, RemoteGame game) =>
        RunAsync(host, state, game, reuseCachedPackage: true, failurePrefix: "Retry failed for");

    private static async Task<InstalledGame> RunAsync(
        RpcHost host,
        InstallState state,
        RemoteGame game,
        bool reuseCachedPackage,
        string failurePrefix)
    {
        var control = state.Start(game.Id);
        InstalledGame? installed = null;
        CommandException? failure = null;
        try
        {
            installed = await InnerAsync(host, game, control, reuseCachedPackage);
        }
        catch (CommandException error)
        {
            failure = error;
            if (!control.IsCancelled)
            {
                Progress.Emit(host, game.Id, "failed", null, $"{failurePrefix} {game.Title}: {error.Message}");
            }
        }

        state.Finish(game.Id);
        if (control.IsCancelled)
        {
            throw new CommandException("Install cancelled.");
        }

        return failure is null ? installed! : throw failure;
    }

    private static async Task<InstalledGame> InnerAsync(RpcHost host, RemoteGame game, InstallControl control, bool reuseCachedPackage)
    {
        Log.Info("claudio_core", $"Starting install for '{game.Title}' (id={game.Id}, install_type={game.InstallType}, reuse_cached_package={reuseCachedPackage})");
        Progress.Emit(host, game.Id, "starting", 0, "Preparing install");

        var settings = SettingsStore.Load();
        string targetDir;
        if (game.InstallPath is not null)
        {
            targetDir = game.InstallPath;
        }
        else
        {
            var installRoot = ResolveInstallRoot(settings);
            targetDir = Path.Combine(installRoot, FileOps.SanitizeSegment(game.Title));
        }

        Log.Info("claudio_core", $"Install target: {targetDir}");
        PrepareTarget(game, targetDir, reuseCachedPackage);

        var downloadsRoot = SettingsStore.ResolveDownloadRoot(settings);
        var tempRoot = InstallPaths.DownloadWorkspaceRoot(downloadsRoot, game.Id, game.Title);
        DownloadInfo downloadInfo;
        if (reuseCachedPackage)
        {
            Progress.Emit(host, game.Id, "starting", 0, "Reusing downloaded package");
            downloadInfo = ReadMarker(tempRoot);
        }
        else
        {
            downloadInfo = await DownloadAsync(host, game, settings, tempRoot, control);
        }

        InstalledGame installed;
        try
        {
            installed = await InstallPackageAsync(host, game, targetDir, downloadInfo, control);
        }
        catch (CommandException error)
        {
            Log.Error("claudio_core", $"Install failed for '{game.Title}': {error.Message}");
            throw;
        }

        installed = InstalledGamesRegistry.Upsert(installed);
        if (OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            Windows.Registration.Register(host.ResourceDir, installed, game.DesktopShortcut ?? false);
        }

        if (OperatingSystem.IsLinux())
        {
            Umu.SyncShortcuts(
                installed,
                game.DesktopShortcut ?? false,
                game.AppMenuShortcut ?? false,
                game.SteamShortcut ?? false);
        }

        FileOps.TryDeleteTree(tempRoot);
        Log.Info("claudio_core", $"Install complete for '{game.Title}': {installed.InstallPath}");
        Progress.Emit(host, game.Id, "completed", 100, "Install complete");
        return installed;
    }

    private static Task<InstalledGame> InstallPackageAsync(
        RpcHost host,
        RemoteGame game,
        string targetDir,
        DownloadInfo downloadInfo,
        InstallControl control)
    {
        if (game.InstallType == InstallType.Portable)
        {
            return PortableInstall.RunAsync(host, game, targetDir, downloadInfo.FilePath, control);
        }

        if (OperatingSystem.IsLinux())
        {
            return LinuxInstallerFlow.RunAsync(host, game, targetDir, downloadInfo.FilePath, control);
        }

        if (OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            return WindowsInstallerFlow.RunAsync(host, game, targetDir, downloadInfo.FilePath, control);
        }

        throw new CommandException("Installer based installs are not implemented for this platform in the C# core yet.");
    }

    private static string ResolveInstallRoot(DesktopSettings settings)
    {
        var path = SettingsStore.DefaultInstallRoot(settings);
        try
        {
            Directory.CreateDirectory(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException(error.Message);
        }

        return path;
    }

    private static void PrepareTarget(RemoteGame game, string targetDir, bool reuseCachedPackage)
    {
        var exists = Directory.Exists(targetDir) || File.Exists(targetDir);
        if (exists)
        {
            if (reuseCachedPackage && game.InstallType == InstallType.Portable)
            {
                try
                {
                    FileOps.DeleteTree(targetDir);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    FileOps.LogIoFailure("remove failed portable install target", targetDir, error);
                    throw new CommandException(FileOps.FormatInstallIoError("clean the failed install target", targetDir, error));
                }
            }
            else if (!reuseCachedPackage)
            {
                throw new CommandException($"Install target already exists: {targetDir}");
            }
        }

        if (!Directory.Exists(targetDir) && !File.Exists(targetDir))
        {
            InstallPaths.ValidateInstallTargetPath(targetDir);
        }
    }

    private static async Task<DownloadInfo> DownloadAsync(
        RpcHost host,
        RemoteGame game,
        DesktopSettings settings,
        string tempRoot,
        InstallControl control)
    {
        try
        {
            if (Directory.Exists(tempRoot))
            {
                FileOps.DeleteTree(tempRoot);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("remove stale install download directory", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("clean the temporary download directory", tempRoot, error));
        }

        try
        {
            Directory.CreateDirectory(tempRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create install download directory", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the temporary download directory", tempRoot, error));
        }

        var serverUrl = settings.ServerUrl ?? throw new CommandException("Desktop server URL is not configured.");
        var info = await PackageDownload.RunAsync(
            host,
            new DownloadOptions
            {
                ServerUrl = serverUrl,
                CustomHeaders = settings.CustomHeaders,
                SpeedLimitKbs = settings.DownloadSpeedLimitKbs,
                ProgressScale = 60.0,
            },
            game.Id,
            game.Title,
            tempRoot,
            control);
        WriteMarker(tempRoot, info);
        Log.Info("claudio_core", $"Download complete: {info.FilePath}");
        return info;
    }

    private static void WriteMarker(string tempRoot, DownloadInfo info)
    {
        var marker = new CachedDownloadInfo { FilePath = info.FilePath, IsIndividual = info.IsIndividual };
        try
        {
            File.WriteAllText(Path.Combine(tempRoot, MarkerName), CoreJsonContext.SerializePretty(marker));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("write cached install download marker", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("remember the completed download for retry", tempRoot, error));
        }
    }

    internal static DownloadInfo ReadMarker(string tempRoot)
    {
        var markerPath = Path.Combine(tempRoot, MarkerName);
        string contents;
        try
        {
            contents = File.ReadAllText(markerPath);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            throw new CommandException("The downloaded package is no longer available. Start the install again to download it.");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to read cached download marker {markerPath}: {error.Message}");
        }

        CachedDownloadInfo marker;
        try
        {
            marker = JsonSerializer.Deserialize(contents, CoreJsonContext.Default.CachedDownloadInfo)
                ?? throw new JsonException("marker is null");
        }
        catch (JsonException error)
        {
            throw new CommandException($"Cached download marker {markerPath} is invalid: {error.Message}");
        }

        if (!File.Exists(marker.FilePath) && !Directory.Exists(marker.FilePath))
        {
            throw new CommandException(
                $"The downloaded package is no longer available at {marker.FilePath}. Start the install again to download it.");
        }

        return new DownloadInfo(marker.FilePath, marker.IsIndividual);
    }
}
