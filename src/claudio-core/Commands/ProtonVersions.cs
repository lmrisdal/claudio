namespace Claudio.Core.Commands;

internal static class ProtonVersions
{
    public static List<ProtonVersionOption> List()
    {
        if (!OperatingSystem.IsLinux())
        {
            return [];
        }

        return Linux.Proton.ListVersions();
    }
}
