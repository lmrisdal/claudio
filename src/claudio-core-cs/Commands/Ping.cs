using System.Reflection;

namespace Claudio.Core.Commands;

internal static class Ping
{
    private const string CommitShaEnv = "CLAUDIO_COMMIT_SHA";
    private const int ShortShaLength = 7;

    public static string DisplayVersion()
    {
        var sha = Environment.GetEnvironmentVariable(CommitShaEnv)?.Trim();
        if (!string.IsNullOrEmpty(sha))
        {
            return sha.Length <= ShortShaLength ? sha : sha[..ShortShaLength];
        }

        return PackageVersion();
    }

    public static string PackageVersion() =>
        typeof(Ping).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "0.0.0";

    public static string PlatformName() => OperatingSystem.IsWindows() ? "windows" : "linux";

    public static PingResponse Run() => new() { Version = DisplayVersion(), Platform = PlatformName() };
}
