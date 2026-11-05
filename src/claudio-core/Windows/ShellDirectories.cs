namespace Claudio.Core.Windows;

internal static class ShellDirectories
{
    public const string StartMenuOverrideEnv = "CLAUDIO_START_MENU_DIR";
    public const string DesktopOverrideEnv = "CLAUDIO_DESKTOP_DIR";

    public static string StartMenuShortcutPath(string title)
    {
        var directory = Environment.GetEnvironmentVariable(StartMenuOverrideEnv);
        if (string.IsNullOrEmpty(directory))
        {
            var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(roaming))
            {
                roaming = @"C:\Users\Default\AppData\Roaming";
            }

            directory = Path.Combine(roaming, @"Microsoft\Windows\Start Menu\Programs");
        }

        return Path.Combine(directory, $"{title}.lnk");
    }

    public static string DesktopShortcutPath(string title)
    {
        var directory = Environment.GetEnvironmentVariable(DesktopOverrideEnv);
        if (string.IsNullOrEmpty(directory))
        {
            directory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (string.IsNullOrEmpty(directory))
            {
                directory = @"C:\Users\Default\Desktop";
            }
        }

        return Path.Combine(directory, $"{title}.lnk");
    }
}
