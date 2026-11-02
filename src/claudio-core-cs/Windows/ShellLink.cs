using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.System.Com;
using Windows.Win32.UI.Shell;

namespace Claudio.Core.Windows;

[SupportedOSPlatform("windows6.1")]
internal static unsafe class ShellLinkWriter
{
    public static void Create(string exePath, string linkPath)
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                Write(exePath, linkPath);
            }
            catch (Exception error)
            {
                failure = error;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (failure is not null)
        {
            throw new CommandException(failure.Message);
        }
    }

    private static void Write(string exePath, string linkPath)
    {
        IShellLinkW* link = null;
        IPersistFile* file = null;
        try
        {
            var clsid = typeof(ShellLink).GUID;
            PInvoke.CoCreateInstance(in clsid, null, CLSCTX.CLSCTX_INPROC_SERVER, out link).ThrowOnFailure();
            fixed (char* path = exePath)
            {
                link->SetPath(path);
            }

            fixed (char* directory = Path.GetDirectoryName(exePath))
            {
                link->SetWorkingDirectory(directory);
            }

            link->QueryInterface(out file).ThrowOnFailure();
            fixed (char* target = linkPath)
            {
                file->Save(target, true);
            }
        }
        finally
        {
            if (file is not null)
            {
                file->Release();
            }

            if (link is not null)
            {
                link->Release();
            }
        }
    }
}
