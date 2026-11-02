namespace Claudio.Core.Commands;

internal static class SteamShortcutCommand
{
    public static void Add(int remoteGameId)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new CommandException("Steam shortcuts are only supported on Linux.");
        }

        var installed = Games.RequireInstalled(remoteGameId);
        Linux.Umu.AddSteamShortcut(installed);
    }
}
