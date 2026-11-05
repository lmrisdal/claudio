using System.Text;

namespace Claudio.Core.Install;

internal enum InstallerType
{
    Msi,
    GogInnoSetup,
    InnoSetup,
    Nsis,
    Unknown,
}

internal static class InstallerDetect
{
    private const int ScanBytes = 2 * 1024 * 1024;

    private static readonly string[] ExactNames =
        ["setup", "install", "installer", "setup64", "install64", "setup32", "install32"];

    public static string ResolveInstallerPath(string root, string? installerHint)
    {
        if (installerHint is not null)
        {
            var hinted = Path.Combine(root, installerHint);
            if (File.Exists(hinted))
            {
                return hinted;
            }
        }

        return Detect(root) ?? throw new CommandException("Could not find an installer executable in the extracted files.");
    }

    public static string? Detect(string root)
    {
        var candidates = new List<string>();
        PayloadOps.CollectMatching(root, candidates, path =>
        {
            var extension = Path.GetExtension(path);
            return (extension.Equals(".exe", StringComparison.OrdinalIgnoreCase)
                    || extension.Equals(".msi", StringComparison.OrdinalIgnoreCase))
                && NameRank(path) is not null;
        });

        return candidates
            .OrderBy(path => NameRank(path)!.Value)
            .ThenBy(path => Path.GetRelativePath(root, path).Split(Path.DirectorySeparatorChar).Length)
            .ThenBy(path => path.ToLowerInvariant(), StringComparer.Ordinal)
            .ThenBy(path => path, StringComparer.Ordinal)
            .FirstOrDefault();
    }

    private static int? NameRank(string path)
    {
        var stem = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
        if (ExactNames.Contains(stem))
        {
            return 0;
        }

        return !stem.Contains("uninstall", StringComparison.Ordinal)
            && (stem.Contains("setup", StringComparison.Ordinal) || stem.Contains("install", StringComparison.Ordinal))
                ? 1
                : null;
    }

    public static InstallerType DetectType(string path)
    {
        if (Path.GetExtension(path).Equals(".msi", StringComparison.OrdinalIgnoreCase))
        {
            return InstallerType.Msi;
        }

        byte[] buffer;
        try
        {
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var block = new byte[ScanBytes];
            var read = file.Read(block, 0, block.Length);
            buffer = block.AsSpan(0, read).ToArray();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return InstallerType.Unknown;
        }

        var isInno = Contains(buffer, "Inno Setup"u8);
        var isGog = Contains(buffer, "GOG.com"u8) || Contains(buffer, Encoding.Unicode.GetBytes("GOG.com"));
        if (isInno && isGog)
        {
            return InstallerType.GogInnoSetup;
        }

        if (isInno)
        {
            return InstallerType.InnoSetup;
        }

        return Contains(buffer, "Nullsoft"u8) ? InstallerType.Nsis : InstallerType.Unknown;
    }

    private static bool Contains(byte[] haystack, ReadOnlySpan<byte> needle) => haystack.AsSpan().IndexOf(needle) >= 0;

    public static bool StreamRequestsElevation(Stream stream)
    {
        var patterns = new[]
        {
            "requireAdministrator"u8.ToArray(),
            "highestAvailable"u8.ToArray(),
            Encoding.Unicode.GetBytes("requireAdministrator"),
            Encoding.Unicode.GetBytes("highestAvailable"),
        };
        var overlap = patterns.Max(pattern => pattern.Length);
        var buffer = new byte[8192 + overlap];
        var carried = 0;
        while (true)
        {
            var read = stream.Read(buffer, carried, buffer.Length - carried);
            if (read == 0)
            {
                return false;
            }

            var total = carried + read;
            if (patterns.Any(pattern => buffer.AsSpan(0, total).IndexOf(pattern) >= 0))
            {
                return true;
            }

            carried = Math.Min(overlap, total);
            if (carried > 0)
            {
                Buffer.BlockCopy(buffer, total - carried, buffer, 0, carried);
            }
        }
    }
}
