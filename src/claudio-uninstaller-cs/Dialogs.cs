using Windows.Win32;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Claudio.Uninstaller;

internal static class Dialogs
{
    private const uint YesNoQuestionDefaultNo = 0x0124;
    private const uint IconError = 0x0010;
    private const uint IconInformation = 0x0040;

    public static bool Confirm(string message) =>
        !OperatingSystem.IsWindowsVersionAtLeast(6, 1) || Show(message, "Uninstall Game", YesNoQuestionDefaultNo) == MESSAGEBOX_RESULT.IDYES;

    public static void Error(string message)
    {
        if (OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            Show(message, "Uninstall Error", IconError);
        }
        else
        {
            Console.Error.WriteLine($"Error: {message}");
        }
    }

    public static void Info(string message)
    {
        if (OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            Show(message, "Uninstall Complete", IconInformation);
        }
        else
        {
            Console.WriteLine(message);
        }
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows6.1")]
    private static MESSAGEBOX_RESULT Show(string text, string caption, uint style) =>
        PInvoke.MessageBox(default, text, caption, (MESSAGEBOX_STYLE)style);
}
