using System.Formats.Tar;
using System.IO.Compression;

namespace Claudio.Core.Install;

// TarFile.ExtractToDirectory aborts on `..` entries and on absolute symlinks, which are common in Linux game tarballs.
internal static class TarExtract
{
    private const string CancelledMessage = "Install cancelled.";
    private const UnixFileMode PermissionBits = (UnixFileMode)0x1FF;

    public static void Run(string source, string destination, InstallControl control, Action<double> progress, bool gzip)
    {
        var label = gzip ? "tar.gz" : "tar";
        try
        {
            Directory.CreateDirectory(destination);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure($"create {label} extraction destination", destination, error);
            throw new CommandException(FileOps.FormatInstallIoError($"create the {label} extraction destination", destination, error));
        }

        FileStream file;
        try
        {
            file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure($"open {label} archive", source, error);
            throw new CommandException(FileOps.FormatInstallIoError($"open the {label} archive", source, error));
        }

        try
        {
            using var counted = new ProgressStream(file, control, progress);
            if (gzip)
            {
                using var decoder = new GZipStream(counted, CompressionMode.Decompress);
                Unpack(decoder, destination);
                decoder.CopyTo(Stream.Null);
            }
            else
            {
                Unpack(counted, destination);
            }
        }
        catch (Exception error) when (error is OperationCanceledException || control.IsCancelled)
        {
            throw new CommandException(CancelledMessage);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or FormatException)
        {
            Logging.Log.Error("claudio_core", $"[installer] unpack {label} archive failed for {source} into {destination}: {error.Message}");
            throw new CommandException(FileOps.FormatInstallIoErrorPair($"unpack the {label} archive", source, destination, error));
        }

        progress(1.0);
    }

    private static void Unpack(Stream stream, string destination)
    {
        var root = Canonical(destination);
        var directories = new List<(string Name, string Path, UnixFileMode Mode)>();
        using var reader = new TarReader(stream, leaveOpen: true);
        while (reader.GetNextEntry() is { } entry)
        {
            if (entry.EntryType is TarEntryType.GlobalExtendedAttributes or TarEntryType.ExtendedAttributes
                or TarEntryType.LongPath or TarEntryType.LongLink)
            {
                continue;
            }

            if (RelativePath(entry.Name) is not { } relative)
            {
                continue;
            }

            var target = Path.Combine(root, relative);
            if (entry.EntryType == TarEntryType.Directory)
            {
                directories.Add((entry.Name, target, entry.Mode));
                continue;
            }

            var parent = Path.GetDirectoryName(target)!;
            Directory.CreateDirectory(parent);
            EnsureInside(root, parent);
            UnpackEntry(entry, root, target);
        }

        directories.Sort((a, b) => string.CompareOrdinal(b.Name, a.Name));
        foreach (var (_, path, mode) in directories)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            EnsureInside(root, Path.GetDirectoryName(path)!);
            Directory.CreateDirectory(path);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(path, mode & PermissionBits);
            }
        }
    }

    private static void UnpackEntry(TarEntry entry, string root, string target)
    {
        switch (entry.EntryType)
        {
            case TarEntryType.SymbolicLink:
                RequireLinkName(entry);
                DeleteExisting(target);
                File.CreateSymbolicLink(target, entry.LinkName);
                break;
            case TarEntryType.HardLink:
                RequireLinkName(entry);
                var linkSource = Path.Combine(root, entry.LinkName);
                EnsureInside(root, linkSource);
                DeleteExisting(target);
                File.Copy(linkSource, target);
                break;
            case TarEntryType.RegularFile or TarEntryType.V7RegularFile or TarEntryType.ContiguousFile:
                DeleteExisting(target);
                entry.ExtractToFile(target, overwrite: false);
                break;
            default:
                DeleteExisting(target);
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write))
                {
                    entry.DataStream?.CopyTo(output);
                }

                break;
        }
    }

    private static void RequireLinkName(TarEntry entry)
    {
        if (string.IsNullOrEmpty(entry.LinkName))
        {
            throw new IOException($"link destination for {entry.Name} is empty");
        }
    }

    private static void DeleteExisting(string path)
    {
        if (File.Exists(path) || new FileInfo(path).LinkTarget is not null)
        {
            File.Delete(path);
        }
    }

    private static void EnsureInside(string root, string path)
    {
        var canonical = Canonical(path);
        if (canonical != root && !canonical.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new IOException($"trying to unpack outside of destination path: {root}");
        }
    }

    internal static string? RelativePath(string name)
    {
        var parts = new List<string>();
        var normalized = OperatingSystem.IsWindows() ? name.Replace('\\', '/') : name;
        foreach (var part in normalized.Split('/'))
        {
            if (part is "" or "." || (OperatingSystem.IsWindows() && parts.Count == 0 && part.EndsWith(':')))
            {
                continue;
            }

            if (part == "..")
            {
                return null;
            }

            parts.Add(part);
        }

        return parts.Count == 0 ? null : Path.Combine([.. parts]);
    }

    internal static string Canonical(string path)
    {
        var full = Path.GetFullPath(path);
        var current = Path.GetPathRoot(full)!;
        foreach (var part in full[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            var next = Path.Combine(current, part);
            if (new FileInfo(next).LinkTarget is not null
                && new FileInfo(next).ResolveLinkTarget(returnFinalTarget: true) is { } resolved)
            {
                next = Canonical(resolved.FullName);
            }

            current = next;
        }

        return current;
    }
}
