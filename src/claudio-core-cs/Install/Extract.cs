using System.Diagnostics;
using System.Formats.Tar;
using System.IO.Compression;

namespace Claudio.Core.Install;

internal static class Extract
{
    private const string CancelledMessage = "Install cancelled.";

    public static void ArchiveOrCopy(string source, string destination, InstallControl control, string resourceDir, Action<double> progress)
    {
        var lower = source.ToLowerInvariant();
        if (lower.EndsWith(".zip", StringComparison.Ordinal))
        {
            Zip(source, destination, control, progress);
        }
        else if (lower.EndsWith(".7z", StringComparison.Ordinal))
        {
            SevenZipExtractor.Extract(source, destination, control, resourceDir, progress);
        }
        else if (lower.EndsWith(".tar.gz", StringComparison.Ordinal) || lower.EndsWith(".tgz", StringComparison.Ordinal))
        {
            Tar(source, destination, control, progress, gzip: true);
        }
        else if (lower.EndsWith(".tar", StringComparison.Ordinal))
        {
            Tar(source, destination, control, progress, gzip: false);
        }
        else
        {
            CopyThrough(source, destination, control, progress);
        }
    }

    private static void CopyThrough(string source, string destination, InstallControl control, Action<double> progress)
    {
        if (control.IsCancelled)
        {
            throw new CommandException(CancelledMessage);
        }

        CreateDirectory(destination, "create extraction destination", "create the extraction destination");
        if (Directory.Exists(source))
        {
            FileOps.CopyDirContents(source, destination);
        }
        else
        {
            var target = Path.Combine(destination, Path.GetFileName(source));
            try
            {
                File.Copy(source, target, overwrite: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                FileOps.LogIoFailurePair("copy package into extraction destination", source, target, error);
                throw new CommandException(FileOps.FormatInstallIoErrorPair("copy package into the extraction destination", source, target, error));
            }
        }

        progress(1.0);
    }

    private static void CreateDirectory(string path, string logOperation, string userOperation)
    {
        try
        {
            Directory.CreateDirectory(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure(logOperation, path, error);
            throw new CommandException(FileOps.FormatInstallIoError(userOperation, path, error));
        }
    }

    private static void Zip(string source, string destination, InstallControl control, Action<double> progress)
    {
        CreateDirectory(destination, "create zip extraction destination", "create the zip extraction destination");
        ZipArchive archive;
        FileStream file;
        try
        {
            file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("open zip archive", source, error);
            throw new CommandException(FileOps.FormatInstallIoError("open the zip archive", source, error));
        }

        using (file)
        {
            try
            {
                archive = new ZipArchive(file, ZipArchiveMode.Read);
            }
            catch (InvalidDataException error)
            {
                Logging.Log.Error("claudio_core", $"[installer] initialize zip archive failed for {source}: {error.Message}");
                throw new CommandException($"Failed to open zip archive {source}: {error.Message}");
            }

            using (archive)
            {
                ExtractZipEntries(archive, source, destination, control, progress);
            }
        }
    }

    private static void ExtractZipEntries(ZipArchive archive, string source, string destination, InstallControl control, Action<double> progress)
    {
        var entries = archive.Entries;
        if (entries.Count == 0)
        {
            progress(1.0);
            return;
        }

        var lastReport = Stopwatch.StartNew();
        for (var index = 0; index < entries.Count; index++)
        {
            if (control.IsCancelled)
            {
                throw new CommandException(CancelledMessage);
            }

            var entry = entries[index];
            if (EnclosedName(entry.FullName) is not { } relative)
            {
                continue;
            }

            var path = Path.Combine(destination, relative);
            if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
            {
                CreateDirectory(path, "create extracted directory", "create the extracted directory");
                continue;
            }

            CreateDirectory(Path.GetDirectoryName(path)!, "create parent directory for extracted file", "create the extracted file parent directory");
            CopyZipEntry(entry, path, source, control);

            if (lastReport.ElapsedMilliseconds > 100)
            {
                progress(index / (double)entries.Count);
                lastReport.Restart();
            }
        }

        progress(1.0);
    }

    private static void CopyZipEntry(ZipArchiveEntry entry, string path, string source, InstallControl control)
    {
        FileStream output;
        try
        {
            output = new FileStream(path, FileMode.Create, FileAccess.Write);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create extracted file", path, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the extracted file", path, error));
        }

        var crc = Crc32.Initial;
        using (output)
        {
            var buffer = new byte[64 * 1024];
            try
            {
                using var input = entry.Open();
                while (true)
                {
                    if (control.IsCancelled)
                    {
                        throw new CommandException(CancelledMessage);
                    }

                    var read = input.Read(buffer, 0, buffer.Length);
                    if (read == 0)
                    {
                        break;
                    }

                    crc = Crc32.Update(crc, buffer.AsSpan(0, read));
                    output.Write(buffer, 0, read);
                }
            }
            catch (Exception error) when (error is InvalidDataException or IOException)
            {
                throw new CommandException($"Failed to read extracted file data from {source} into {path}: {error.Message}");
            }
        }

        if (Crc32.Finish(crc) != entry.Crc32)
        {
            throw new CommandException($"Failed to read extracted file data from {source} into {path}: checksum mismatch");
        }
    }

    internal static string? EnclosedName(string name)
    {
        if (name.Contains('\0'))
        {
            return null;
        }

        var normalized = name.Replace('\\', '/');
        if (normalized.StartsWith('/') || (normalized.Length > 1 && normalized[1] == ':'))
        {
            return null;
        }

        var parts = new List<string>();
        foreach (var part in normalized.Split('/'))
        {
            if (part is "" or ".")
            {
                continue;
            }

            if (part == "..")
            {
                if (parts.Count == 0)
                {
                    return null;
                }

                parts.RemoveAt(parts.Count - 1);
                continue;
            }

            parts.Add(part);
        }

        return parts.Count == 0 ? null : string.Join(Path.DirectorySeparatorChar, parts);
    }

    private static void Tar(string source, string destination, InstallControl control, Action<double> progress, bool gzip)
    {
        var label = gzip ? "tar.gz" : "tar";
        CreateDirectory(destination, $"create {label} extraction destination", $"create the {label} extraction destination");
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
                TarFile.ExtractToDirectory(decoder, destination, overwriteFiles: true);
                decoder.CopyTo(Stream.Null);
            }
            else
            {
                TarFile.ExtractToDirectory(counted, destination, overwriteFiles: true);
            }
        }
        catch (Exception error) when (error is OperationCanceledException || control.IsCancelled)
        {
            throw new CommandException(CancelledMessage);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            Logging.Log.Error("claudio_core", $"[installer] unpack {label} archive failed for {source} into {destination}: {error.Message}");
            throw new CommandException(FileOps.FormatInstallIoErrorPair($"unpack the {label} archive", source, destination, error));
        }

        progress(1.0);
    }
}
