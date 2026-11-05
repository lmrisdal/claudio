using System.Runtime.Versioning;
using Claudio.Core.Logging;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Diagnostics.ToolHelp;
using Windows.Win32.System.Threading;

namespace Claudio.Core.Windows;

internal static class ProcessTree
{
    public static List<uint> Expand(IReadOnlyList<(uint Pid, uint Parent)> entries, IEnumerable<uint> roots)
    {
        var tree = roots.Where(pid => pid != 0).ToList();
        while (true)
        {
            var before = tree.Count;
            foreach (var (pid, parent) in entries)
            {
                if (tree.Contains(parent) && !tree.Contains(pid))
                {
                    tree.Add(pid);
                }
            }

            if (tree.Count == before)
            {
                return tree;
            }
        }
    }

    public static bool IsInstallerLeftover(string exeName) => exeName.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase);
}

[SupportedOSPlatform("windows6.1")]
internal static class ProcessTracking
{
    public static List<uint> Collect(IEnumerable<uint> seedPids, string? exeName)
    {
        var snapshot = Snapshot();
        var tracked = ProcessTree.Expand(snapshot.Select(entry => (entry.Pid, entry.Parent)).ToList(), seedPids);
        foreach (var entry in snapshot)
        {
            var matches = (exeName is not null && entry.Exe.Equals(exeName, StringComparison.OrdinalIgnoreCase))
                || ProcessTree.IsInstallerLeftover(entry.Exe);
            if (matches && !tracked.Contains(entry.Pid))
            {
                tracked.Add(entry.Pid);
            }
        }

        tracked.Sort();
        return tracked.Distinct().ToList();
    }

    public static void Terminate(IEnumerable<uint> seedPids, string? exeName)
    {
        var targets = Collect(seedPids, exeName);
        Log.Info("claudio_core", $"[installer] terminating tracked processes [{string.Join(", ", targets)}] (exe_name={exeName})");
        for (var round = 0; round < 3; round++)
        {
            foreach (var pid in targets)
            {
                TerminateOne(pid);
            }

            Thread.Sleep(120);
            targets = Collect(targets, exeName);
            if (targets.Count == 0)
            {
                break;
            }
        }
    }

    private static void TerminateOne(uint pid)
    {
        var handle = PInvoke.OpenProcess(
            PROCESS_ACCESS_RIGHTS.PROCESS_TERMINATE | PROCESS_ACCESS_RIGHTS.PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_ACCESS_RIGHTS.PROCESS_SYNCHRONIZE,
            false,
            pid);
        if (handle.IsNull)
        {
            return;
        }

        PInvoke.TerminateProcess(handle, 1);
        PInvoke.WaitForSingleObject(handle, 2000);
        PInvoke.CloseHandle(handle);
        Log.Info("claudio_core", $"[installer] terminate requested for PID {pid}");
    }

    private static List<(uint Pid, uint Parent, string Exe)> Snapshot()
    {
        var entries = new List<(uint, uint, string)>();
        var snapshot = PInvoke.CreateToolhelp32Snapshot(CREATE_TOOLHELP_SNAPSHOT_FLAGS.TH32CS_SNAPPROCESS, 0);
        if (snapshot.IsNull)
        {
            return entries;
        }

        try
        {
            unsafe
            {
                var entry = new PROCESSENTRY32W { dwSize = (uint)sizeof(PROCESSENTRY32W) };
                if (!PInvoke.Process32FirstW(snapshot, &entry))
                {
                    return entries;
                }

                do
                {
                    entries.Add((entry.th32ProcessID, entry.th32ParentProcessID, entry.szExeFile.ToString()));
                }
                while (PInvoke.Process32NextW(snapshot, &entry));
            }
        }
        finally
        {
            PInvoke.CloseHandle(snapshot);
        }

        return entries;
    }
}
