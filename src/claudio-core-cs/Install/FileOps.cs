using Claudio.Core.Logging;

namespace Claudio.Core.Install;

internal static class FileOps
{
    public static string SanitizeSegment(string value)
    {
        var chars = value.Select(ch => ch switch
        {
            ':' => ' ',
            '/' or '\\' or '*' or '?' or '"' or '<' or '>' or '|' => '_',
            _ => ch,
        });
        var words = new string(chars.ToArray()).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var joined = string.Join(' ', words);
        return joined.Length == 0 ? "game" : joined;
    }

    public static void TryDeleteTree(string path)
    {
        try
        {
            DeleteTree(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log.Warn("claudio_core", $"Could not remove {path}: {error.Message}");
        }
    }

    public static void DeleteTree(string path)
    {
        if (IsLink(path))
        {
            DeleteLink(path);
        }
        else if (Directory.Exists(path))
        {
            ClearReadOnly(new DirectoryInfo(path));
            Directory.Delete(path, recursive: true);
        }
        else if (File.Exists(path))
        {
            ClearReadOnly(new FileInfo(path));
            File.Delete(path);
        }
    }

    private static bool IsLink(string path) => new FileInfo(path).LinkTarget is not null;

    private static void DeleteLink(string path)
    {
        if (Directory.Exists(path))
        {
            Directory.Delete(path);
        }
        else
        {
            File.Delete(path);
        }
    }

    private static void ClearReadOnly(FileSystemInfo entry)
    {
        if (!OperatingSystem.IsWindows() || entry.LinkTarget is not null)
        {
            return;
        }

        if ((entry.Attributes & FileAttributes.ReadOnly) != 0)
        {
            entry.Attributes &= ~FileAttributes.ReadOnly;
        }

        if (entry is DirectoryInfo directory)
        {
            foreach (var child in directory.EnumerateFileSystemInfos())
            {
                ClearReadOnly(child);
            }
        }
    }

    public static void LogIoFailure(string operation, string path, Exception error) =>
        Log.Error("claudio_core", $"[installer] {operation} failed for {path}: {error.Message} (raw_os_error={RawOsError(error)})");

    public static int? RawOsError(Exception error) =>
        error is IOException io ? (OperatingSystem.IsWindows() ? io.HResult & 0xFFFF : null) : null;

    public static string FormatInstallIoError(string operation, string path, Exception error)
    {
        if (RawOsError(error) == 740)
        {
            return $"Windows requires administrator privileges to {operation} at {path}. Run Claudio as administrator or choose a different install folder.";
        }

        if (error is UnauthorizedAccessException || RawOsError(error) == 5)
        {
            return OperatingSystem.IsWindows()
                ? $"Claudio couldn't write to {path} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator."
                : $"Claudio couldn't write to {path} while trying to {operation}. Choose a folder your user can write to or change the folder ownership/permissions.";
        }

        return error.Message;
    }

    public static void LogIoFailurePair(string operation, string source, string destination, Exception error) =>
        Log.Error("claudio_core", $"[installer] {operation} failed from {source} to {destination}: {error.Message} (raw_os_error={RawOsError(error)})");

    public static string FormatInstallIoErrorPair(string operation, string source, string destination, Exception error)
    {
        if (RawOsError(error) == 740)
        {
            return $"Windows requires administrator privileges to {operation} at {destination}. Run Claudio as administrator or choose a different install folder.";
        }

        if (error is UnauthorizedAccessException || RawOsError(error) == 5)
        {
            return OperatingSystem.IsWindows()
                ? $"Claudio couldn't move files from {source} to {destination} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator."
                : $"Claudio couldn't move files from {source} to {destination} while trying to {operation}. Choose a folder your user can write to or change the destination folder ownership/permissions.";
        }

        return error.Message;
    }

    public static List<string> VisibleEntries(string root)
    {
        try
        {
            return Directory.EnumerateFileSystemEntries(root)
                .Where(path => Path.GetFileName(path) is not ("__MACOSX" or ".DS_Store"))
                .ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            LogIoFailure("read directory entries", root, error);
            throw new CommandException(FormatInstallIoError("read the directory entries", root, error));
        }
    }

    public static void ClearExistingPath(string path)
    {
        if (!Directory.Exists(path) && !File.Exists(path))
        {
            return;
        }

        try
        {
            DeleteTree(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            var kind = Directory.Exists(path) ? "directory" : "file";
            LogIoFailure($"remove existing {kind} before replacement", path, error);
            throw new CommandException(FormatInstallIoError($"remove the existing destination {kind}", path, error));
        }
    }

    private static void MoveEntry(string entry, string target)
    {
        if (Directory.Exists(entry))
        {
            Directory.Move(entry, target);
        }
        else
        {
            File.Move(entry, target);
        }
    }

    public static List<string> MoveVisibleEntriesIntoDir(string sourceRoot, string destinationDir)
    {
        var entries = VisibleEntries(sourceRoot);
        var moveSource = entries.Count == 1 && Directory.Exists(entries[0]) ? entries[0] : sourceRoot;
        var moved = new List<string>();
        foreach (var entry in VisibleEntries(moveSource))
        {
            var target = Path.Combine(destinationDir, Path.GetFileName(entry));
            ClearExistingPath(target);
            try
            {
                MoveEntry(entry, target);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                LogIoFailurePair("move extracted entry into destination directory", entry, target, error);
                throw new CommandException(FormatInstallIoErrorPair("move the extracted entry into the destination directory", entry, target, error));
            }

            moved.Add(target);
        }

        return moved;
    }

    public static void CopyDirContents(string source, string destination)
    {
        foreach (var entry in Directory.EnumerateFileSystemEntries(source))
        {
            var target = Path.Combine(destination, Path.GetFileName(entry));
            try
            {
                if (Directory.Exists(entry))
                {
                    Directory.CreateDirectory(target);
                    CopyDirContents(entry, target);
                }
                else
                {
                    File.Copy(entry, target, overwrite: true);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                LogIoFailurePair("copy file into destination directory", entry, target, error);
                throw new CommandException(FormatInstallIoErrorPair("copy extracted files", entry, target, error));
            }
        }
    }
}
