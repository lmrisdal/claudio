namespace Claudio.Core.Install;

internal static class PayloadOps
{
    public static string? DetectWindowsExecutable(string root)
    {
        var candidates = new List<string>();
        CollectMatching(root, candidates, path => string.Equals(Path.GetExtension(path), ".exe", StringComparison.OrdinalIgnoreCase));
        candidates.Sort(ComparePaths);
        return candidates.FirstOrDefault();
    }

    private static int ComparePaths(string left, string right)
    {
        var a = left.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var b = right.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        for (var index = 0; index < Math.Min(a.Length, b.Length); index++)
        {
            var result = string.CompareOrdinal(a[index], b[index]);
            if (result != 0)
            {
                return result;
            }
        }

        return a.Length.CompareTo(b.Length);
    }

    internal static void CollectMatching(string root, List<string> matches, Func<string, bool> predicate)
    {
        IEnumerable<string> entries;
        try
        {
            entries = Directory.EnumerateFileSystemEntries(root).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return;
        }

        foreach (var path in entries)
        {
            if (Directory.Exists(path))
            {
                CollectMatching(path, matches, predicate);
            }
            else if (predicate(path))
            {
                matches.Add(path);
            }
        }
    }

    public static void NormalizeIntoFinalDir(string stagingRoot, string finalDir)
    {
        var entries = FileOps.VisibleEntries(stagingRoot);
        if (entries.Count == 1 && Directory.Exists(entries[0]))
        {
            try
            {
                Directory.Move(entries[0], finalDir);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                FileOps.LogIoFailurePair("move extracted root directory", entries[0], finalDir, error);
                throw new CommandException(FileOps.FormatInstallIoErrorPair("move extracted files", entries[0], finalDir, error));
            }

            RemoveStaging(stagingRoot);
            return;
        }

        try
        {
            Directory.CreateDirectory(finalDir);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create final install directory", finalDir, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the install folder", finalDir, error));
        }

        foreach (var entry in entries)
        {
            var target = Path.Combine(finalDir, Path.GetFileName(entry));
            try
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
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                FileOps.LogIoFailurePair("move extracted entry into final directory", entry, target, error);
                throw new CommandException(FileOps.FormatInstallIoErrorPair("move extracted files", entry, target, error));
            }
        }

        RemoveStaging(stagingRoot);
    }

    private static void RemoveStaging(string stagingRoot)
    {
        try
        {
            FileOps.DeleteTree(stagingRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("remove extraction staging root", stagingRoot, error);
            throw new CommandException(FileOps.FormatInstallIoError("clean the extraction staging folder", stagingRoot, error));
        }
    }

    public static string? FinalizePortablePayload(string extractRoot, string payloadDir, string? gameExeHint)
    {
        if (Directory.Exists(payloadDir))
        {
            FileOps.MoveVisibleEntriesIntoDir(extractRoot, payloadDir);
            RemoveStaging(extractRoot);
        }
        else
        {
            NormalizeIntoFinalDir(extractRoot, payloadDir);
        }

        if (gameExeHint is not null)
        {
            var candidate = Path.Combine(payloadDir, gameExeHint);
            if (File.Exists(candidate) || Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        return DetectWindowsExecutable(payloadDir);
    }

    private static string GameDirectoryName(string title)
    {
        var name = FileOps.SanitizeSegment(title).Trim('.').Trim();
        return name.Length == 0 ? "game" : name;
    }

    public static string PrefixPayloadDirectory(string prefix, string title) =>
        Path.Combine(prefix, "pfx", "drive_c", "Games", GameDirectoryName(title));

    public static string PrefixInstallDirectory(string title) => $@"C:\Games\{GameDirectoryName(title)}";
}
