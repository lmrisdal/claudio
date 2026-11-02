namespace Claudio.Core.Install;

internal static class InstallPaths
{
    public static string ResolveInstallPath(string gameTitle) =>
        Path.Combine(SettingsStore.DefaultInstallRoot(SettingsStore.Load()), FileOps.SanitizeSegment(gameTitle));

    public static string ResolveDefaultDownloadRoot() => SettingsStore.DefaultDownloadRoot(SettingsStore.Load());

    public static string ResolveDownloadPath(string gameTitle) =>
        Path.Combine(SettingsStore.DefaultDownloadRoot(SettingsStore.Load()), FileOps.SanitizeSegment(gameTitle));

    public static string DownloadWorkspaceRoot(string downloadRoot, int gameId, string gameTitle) =>
        Path.Combine(downloadRoot, $"{FileOps.SanitizeSegment(gameTitle)}-{gameId}");

    public static string InstallerStagingDir(string baseDir) =>
        Path.Combine(baseDir, $"installer-staging-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");

    public static void ValidateInstallTarget(string targetPath)
    {
        var trimmed = targetPath.Trim();
        if (trimmed.Length == 0)
        {
            throw new CommandException("Please choose an install location.");
        }

        ValidateInstallTargetPath(trimmed);
    }

    public static string? ResolveInstallBrowseRoot(string targetPath)
    {
        var trimmed = targetPath.Trim();
        return trimmed.Length == 0 ? null : BrowseRoot(trimmed);
    }

    private static string? BrowseRoot(string targetDir)
    {
        var current = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(targetDir)) ?? targetDir;
        while (true)
        {
            if (Directory.Exists(current) && CanList(current))
            {
                return current;
            }

            var parent = Path.GetDirectoryName(current);
            if (parent is null)
            {
                return null;
            }

            current = parent;
        }
    }

    private static bool CanList(string directory)
    {
        try
        {
            using var entries = Directory.EnumerateFileSystemEntries(directory).GetEnumerator();
            entries.MoveNext();
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    internal static void ValidateInstallTargetPath(string targetDir)
    {
        if (Directory.Exists(targetDir) || File.Exists(targetDir))
        {
            throw new CommandException($"Install target already exists: {targetDir}");
        }

        var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(targetDir));
        if (string.IsNullOrEmpty(parent))
        {
            parent = Path.GetFullPath(".");
        }

        try
        {
            Directory.CreateDirectory(parent);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create install target parent directory", parent, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the install folder", parent, error));
        }

        var probeDir = Path.Combine(parent, $".claudio-install-probe-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
        try
        {
            Directory.CreateDirectory(probeDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create install permission probe directory", probeDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the install folder", probeDir, error));
        }

        CommandException? validation = null;
        var probeFile = Path.Combine(probeDir, ".write-test");
        try
        {
            using var stream = new FileStream(probeFile, FileMode.Create, FileAccess.Write);
            stream.Write("claudio"u8);
            stream.Flush(true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("write install permission probe file", probeFile, error);
            validation = new CommandException(FileOps.FormatInstallIoError("write to the install folder", probeFile, error));
        }

        try
        {
            FileOps.DeleteTree(probeDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("remove install permission probe directory", probeDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("finish checking the install folder", probeDir, error));
        }

        if (validation is not null)
        {
            throw validation;
        }
    }
}
