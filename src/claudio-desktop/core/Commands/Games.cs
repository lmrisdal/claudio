namespace Claudio.Core.Commands;

internal static class Games
{
    public static InstalledGame RequireInstalled(int remoteGameId) =>
        InstalledGamesRegistry.Get(remoteGameId) ?? throw new CommandException("Game is not installed.");

    public static void CleanupFailedInstall(RemoteGame game)
    {
        var downloadsRoot = SettingsStore.ResolveDownloadRoot(SettingsStore.Load());
        var tempRoot = InstallPaths.DownloadWorkspaceRoot(downloadsRoot, game.Id, game.Title);
        if (!Directory.Exists(tempRoot) && !File.Exists(tempRoot))
        {
            return;
        }

        try
        {
            FileOps.DeleteTree(tempRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("remove failed install workspace", tempRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("clean the failed install workspace", tempRoot, error));
        }
    }

    public static void UninstallGame(int remoteGameId, bool deleteFiles)
    {
        var installed = InstalledGamesRegistry.Get(remoteGameId);
        if (deleteFiles && installed is not null)
        {
            DeleteInstallArtifacts(installed);
        }

        if (installed is not null && OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            Windows.Registration.Deregister(installed);
        }

        InstalledGamesRegistry.Remove(remoteGameId);
    }

    private static void DeleteInstallArtifacts(InstalledGame installed)
    {
        var paths = new List<string>();
        if (installed.WinePrefix is not null || !IsWinePrefixRoot(installed.InstallPath))
        {
            paths.Add(installed.InstallPath);
        }

        if (installed.WinePrefix is not null)
        {
            paths.Add(installed.WinePrefix);
        }

        foreach (var path in paths.Where(path => Directory.Exists(path) || File.Exists(path)))
        {
            var kind = Directory.Exists(path) ? "folder" : "file";
            try
            {
                FileOps.DeleteTree(path);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new CommandException($"Failed to delete install {kind} {path}: {error.Message}");
            }
        }
    }

    private static bool IsWinePrefixRoot(string path) =>
        Directory.Exists(Path.Combine(path, "drive_c")) && Path.Exists(Path.Combine(path, "dosdevices"));
}
