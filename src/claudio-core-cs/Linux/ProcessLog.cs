using System.Diagnostics;
using Claudio.Core.Logging;

namespace Claudio.Core.Linux;

internal sealed class LoggedChild(Process process, LogTail tail, Task[] pumps)
{
    public Process Process { get; } = process;
    public LogTail Tail { get; } = tail;

    public void DrainOutput() => Task.WaitAll(pumps, TimeSpan.FromSeconds(2));
}

internal sealed class LogTail
{
    private const int Lines = 40;
    private readonly Lock gate = new();
    private readonly Queue<string> lines = new();

    public void Push(string label, string line)
    {
        lock (gate)
        {
            if (lines.Count == Lines)
            {
                lines.Dequeue();
            }

            lines.Enqueue($"{label}: {line}");
        }
    }

    public string Format(string processName)
    {
        lock (gate)
        {
            return lines.Count == 0
                ? $"No {processName} output was captured. Check claudio.log for earlier context."
                : $"Last {processName} output lines from claudio.log:\n{string.Join('\n', lines)}";
        }
    }
}

internal static class ProcessLog
{
    public static LoggedChild Spawn(ProcessStartInfo info, string processName)
    {
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.UseShellExecute = false;
        var process = Process.Start(info) ?? throw new System.ComponentModel.Win32Exception("process did not start");
        process.StandardInput.Close();
        var tail = new LogTail();
        var pumps = new[]
        {
            Pump(process.StandardOutput, "stdout", processName, tail),
            Pump(process.StandardError, "stderr", processName, tail),
        };
        return new LoggedChild(process, tail, pumps);
    }

    private static Task Pump(StreamReader reader, string label, string processName, LogTail tail)
    {
        return Task.Factory.StartNew(
            () =>
            {
                try
                {
                    string? line;
                    while ((line = reader.ReadLine()) is not null)
                    {
                        tail.Push(label, line);
                        if (label == "stderr")
                        {
                            Log.Warn("claudio_core", $"[{processName} stderr] {line}");
                        }
                        else
                        {
                            Log.Info("claudio_core", $"[{processName} stdout] {line}");
                        }
                    }
                }
                catch (IOException error)
                {
                    Log.Warn("claudio_core", $"[{processName} {label}] failed reading process output: {error.Message}");
                }
            },
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
    }
}
