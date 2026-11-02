using System.Runtime.InteropServices;

namespace Claudio.Core.Install;

internal static class Tls
{
    private static readonly string[] OpenSslLibraries =
        ["libssl.so.3", "libssl.so.1.1", "libssl.so.1.0.0", "libssl.so.10", "libssl.so.1.0.2", "libssl.so"];

    private static readonly Lazy<bool> OpenSslPresent = new(ProbeOpenSsl);

    public static void EnsureAvailable(string? url)
    {
#if STATIC_OPENSSL
        _ = url;
        return;
#else
        if (!OperatingSystem.IsLinux()
            || (url is not null && !url.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
            || OpenSslPresent.Value)
        {
            return;
        }

        throw new CommandException(
            "HTTPS is not available because OpenSSL (libssl) was not found on this system. "
            + "Install OpenSSL 3 (for example the libssl3 or openssl package) and try again.");
#endif
    }

    private static bool ProbeOpenSsl()
    {
        foreach (var name in OpenSslLibraries)
        {
            if (NativeLibrary.TryLoad(name, out var handle))
            {
                NativeLibrary.Free(handle);
                return true;
            }
        }

        return false;
    }
}
