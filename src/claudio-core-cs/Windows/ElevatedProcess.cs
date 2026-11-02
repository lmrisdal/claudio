using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;

namespace Claudio.Core.Windows;

[SupportedOSPlatform("windows6.1")]
internal static class ElevatedProcess
{
    private const uint SeeMaskNoCloseProcess = 0x40;
    private const int SwShowNormal = 1;


    public static NativeProcess Launch(string path, string arguments, string? directory)
    {
        Logging.Log.Info("claudio_core", $"Installer requires elevation, requesting UAC prompt for {path}");
        var info = new SHELLEXECUTEINFOW
        {
            cbSize = (uint)Marshal.SizeOf<SHELLEXECUTEINFOW>(),
            fMask = SeeMaskNoCloseProcess,
            nShow = SwShowNormal,
        };
        unsafe
        {
            fixed (char* verb = "runas")
            fixed (char* file = path)
            fixed (char* parameters = arguments.Length == 0 ? null : arguments)
            fixed (char* workDir = directory)
            {
                info.lpVerb = verb;
                info.lpFile = file;
                info.lpParameters = arguments.Length == 0 ? default : parameters;
                info.lpDirectory = string.IsNullOrEmpty(directory) ? default : workDir;
                if (!PInvoke.ShellExecuteEx(&info))
                {
                    throw new CommandException(new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
                }
            }
        }

        if (info.hProcess.IsNull)
        {
            throw new CommandException("Elevated installer launch did not return a process handle.");
        }

        var pid = PInvoke.GetProcessId(info.hProcess);
        if (pid == 0)
        {
            PInvoke.CloseHandle(info.hProcess);
            throw new CommandException("Elevated installer launch did not return a valid PID.");
        }

        return NativeProcess.FromHandle(info.hProcess, pid);
    }
}
