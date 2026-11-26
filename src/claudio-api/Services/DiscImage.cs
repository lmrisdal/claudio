using DiscUtils;
using DiscUtils.Iso9660;
using DiscUtils.Udf;

namespace Claudio.Api.Services;

/// Reads files from ISO 9660 and UDF disc images without mounting them.
public static class DiscImage
{
    public static bool IsDiscImage(string path)
        => path.EndsWith(".iso", StringComparison.OrdinalIgnoreCase);

    public static List<(string Name, long Size)> ReadEntries(string imagePath)
    {
        using var stream = File.OpenRead(imagePath);
        using var fileSystem = Open(stream);
        var entries = new List<(string, long)>();

        foreach (var dir in fileSystem.GetDirectories("", "*", SearchOption.AllDirectories))
            entries.Add((NormalizePath(dir) + '/', 0));

        foreach (var file in fileSystem.GetFiles("", "*", SearchOption.AllDirectories))
            entries.Add((NormalizePath(file), fileSystem.GetFileLength(file)));

        return entries;
    }

    public static Stream OpenEntry(string imagePath, string relativePath)
    {
        using var stream = File.OpenRead(imagePath);
        using var fileSystem = Open(stream);

        var match = fileSystem.GetFiles("", "*", SearchOption.AllDirectories)
            .FirstOrDefault(file => string.Equals(NormalizePath(file), relativePath.Trim('/'), StringComparison.OrdinalIgnoreCase));
        if (match is null)
            return Stream.Null;

        var buffer = new MemoryStream();
        using (var source = fileSystem.OpenFile(match, FileMode.Open, FileAccess.Read))
            source.CopyTo(buffer);
        buffer.Position = 0;
        return buffer;
    }

    // Most game DVDs are UDF/ISO 9660 bridge discs. UDF keeps the full long
    // file names, so it wins when both are present.
    private static DiscFileSystem Open(Stream stream)
    {
        if (UdfReader.Detect(stream))
        {
            stream.Position = 0;
            return new UdfReader(stream);
        }

        stream.Position = 0;
        return new CDReader(stream, joliet: true);
    }

    private static string NormalizePath(string path)
    {
        var normalized = path.Replace('\\', '/').Trim('/');
        var version = normalized.LastIndexOf(';');
        return version > normalized.LastIndexOf('/') ? normalized[..version] : normalized;
    }
}
