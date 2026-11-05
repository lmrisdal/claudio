namespace Claudio.Core.Linux;

internal static class HostPaths
{
    private const string HostRoot = "/run/host";

    public static string NestedRuntimePath(string path)
    {
        if (path == HostRoot)
        {
            return "/";
        }

        return path.StartsWith(HostRoot + "/", StringComparison.Ordinal) ? path[HostRoot.Length..] : path;
    }
}
