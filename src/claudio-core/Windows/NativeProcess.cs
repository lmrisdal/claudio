using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Security;
using Windows.Win32.Storage.FileSystem;
using Windows.Win32.System.Console;
using Windows.Win32.System.Threading;

namespace Claudio.Core.Windows;

[SupportedOSPlatform("windows6.1")]
internal sealed class NativeProcess : IDisposable
{
    private const int ElevationRequiredError = 740;
    private const uint StillActive = 259;
    private const nuint HandleListAttribute = 0x20002;
    private static unsafe HANDLE InvalidHandle => new((void*)-1);

    private HANDLE handle;

    private NativeProcess(HANDLE handle, uint pid)
    {
        this.handle = handle;
        Pid = pid;
    }

    public uint Pid { get; }

    public static NativeProcess FromHandle(HANDLE handle, uint pid) => new(handle, pid);

    public uint? TryWaitForExit()
    {
        if (PInvoke.WaitForSingleObject(handle, 0) == WAIT_EVENT.WAIT_TIMEOUT)
        {
            return null;
        }

        unsafe
        {
            uint code;
            return PInvoke.GetExitCodeProcess(handle, &code) ? code : throw new CommandException("Could not read the process exit code.");
        }
    }

    public bool IsRunning() => TryWaitForExit() is null;

    public void Terminate()
    {
        PInvoke.TerminateProcess(handle, 1);
        PInvoke.WaitForSingleObject(handle, 2000);
    }

    public void Dispose()
    {
        if (!handle.IsNull)
        {
            PInvoke.CloseHandle(handle);
            handle = default;
        }
    }

    public static bool IsStillActive(uint exitCode) => exitCode == StillActive;

    public static bool IsPidRunning(uint pid)
    {
        var process = PInvoke.OpenProcess(PROCESS_ACCESS_RIGHTS.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process.IsNull)
        {
            return false;
        }

        try
        {
            unsafe
            {
                uint code;
                return PInvoke.GetExitCodeProcess(process, &code) && code == StillActive;
            }
        }
        finally
        {
            PInvoke.CloseHandle(process);
        }
    }

    public static void DisableStandardHandleInheritance()
    {
        foreach (var id in new[] { STD_HANDLE.STD_INPUT_HANDLE, STD_HANDLE.STD_OUTPUT_HANDLE, STD_HANDLE.STD_ERROR_HANDLE })
        {
            var std = PInvoke.GetStdHandle(id);
            if (!std.IsNull && std != InvalidHandle)
            {
                PInvoke.SetHandleInformation(std, (uint)HANDLE_FLAGS.HANDLE_FLAG_INHERIT, 0);
            }
        }
    }

    public static NativeProcess Start(
        string program,
        string rawArguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string>? extraEnvironment = null)
    {
        var commandLine = rawArguments.Length == 0 ? Quote(program) : $"{Quote(program)} {rawArguments}";
        var buffer = (commandLine + "\0").ToCharArray();
        var environment = extraEnvironment is { Count: > 0 } ? BuildEnvironmentBlock(extraEnvironment) : null;
        var nul = OpenNul();
        try
        {
            var startup = new STARTUPINFOEXW
            {
                StartupInfo = new STARTUPINFOW
                {
                    cb = (uint)Marshal.SizeOf<STARTUPINFOEXW>(),
                    dwFlags = STARTUPINFOW_FLAGS.STARTF_USESTDHANDLES,
                    hStdInput = nul,
                    hStdOutput = nul,
                    hStdError = nul,
                },
            };
            var flags = PROCESS_CREATION_FLAGS.CREATE_UNICODE_ENVIRONMENT | PROCESS_CREATION_FLAGS.EXTENDED_STARTUPINFO_PRESENT;
            PROCESS_INFORMATION info;
            bool created;
            var createError = 0;
            unsafe
            {
                nuint size = 0;
                PInvoke.InitializeProcThreadAttributeList(default, 1, 0, &size);
                var attributeBuffer = new byte[(int)size];
                fixed (byte* attributePointer = attributeBuffer)
                fixed (char* commandLinePointer = buffer)
                fixed (char* directoryPointer = workingDirectory)
                fixed (char* environmentPointer = environment)
                {
                    var attributes = new LPPROC_THREAD_ATTRIBUTE_LIST(attributePointer);
                    if (!PInvoke.InitializeProcThreadAttributeList(attributes, 1, 0, &size))
                    {
                        throw new CommandException(new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
                    }

                    try
                    {
                        // Only NUL may be inherited. Without this list the child also inherits any pipe
                        // that a concurrent Process.Start (7-Zip, innoextract) has open, and that
                        // process's output then never reaches EOF while the game runs.
                        var inherited = nul;
                        if (!PInvoke.UpdateProcThreadAttribute(attributes, 0, HandleListAttribute, &inherited, (nuint)sizeof(HANDLE), null, null))
                        {
                            throw new CommandException(new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
                        }

                        startup.lpAttributeList = attributes;
                        created = PInvoke.CreateProcess(
                            default,
                            commandLinePointer,
                            null,
                            null,
                            true,
                            flags,
                            environment is null ? null : environmentPointer,
                            directoryPointer,
                            (STARTUPINFOW*)&startup,
                            &info);
                        createError = created ? 0 : Marshal.GetLastWin32Error();
                    }
                    finally
                    {
                        PInvoke.DeleteProcThreadAttributeList(attributes);
                    }
                }
            }

            if (!created)
            {
                var error = createError;
                if (error == ElevationRequiredError)
                {
                    throw new RequiresAdministratorException();
                }

                throw new CommandException(new System.ComponentModel.Win32Exception(error).Message);
            }

            PInvoke.CloseHandle(info.hThread);
            return new NativeProcess(info.hProcess, info.dwProcessId);
        }
        finally
        {
            PInvoke.CloseHandle(nul);
        }
    }

    private static string Quote(string program) => program.Contains(' ') ? $"\"{program}\"" : program;

    private static string BuildEnvironmentBlock(IReadOnlyDictionary<string, string> extra)
    {
        var merged = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            merged[(string)entry.Key] = (string?)entry.Value ?? "";
        }

        foreach (var (name, value) in extra)
        {
            merged[name] = value;
        }

        var block = new StringBuilder();
        foreach (var (name, value) in merged)
        {
            block.Append(name).Append('=').Append(value).Append('\0');
        }

        return block.Append('\0').ToString();
    }

    private static unsafe HANDLE OpenNul()
    {
        var attributes = new SECURITY_ATTRIBUTES
        {
            nLength = (uint)sizeof(SECURITY_ATTRIBUTES),
            bInheritHandle = true,
        };
        fixed (char* name = "NUL")
        {
            var nul = PInvoke.CreateFile(
                name,
                0x80000000u | 0x40000000u,
                FILE_SHARE_MODE.FILE_SHARE_READ | FILE_SHARE_MODE.FILE_SHARE_WRITE,
                &attributes,
                FILE_CREATION_DISPOSITION.OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_NORMAL,
                default);
            return nul == InvalidHandle ? throw new CommandException("Could not open NUL for the child process.") : nul;
        }
    }
}

internal sealed class RequiresAdministratorException : Exception
{
}
