using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.System.Power;

namespace Claudio.Core.Windows;

[SupportedOSPlatform("windows6.1")]
internal static class SleepPrevention
{
    private static readonly Lock Gate = new();
    private static Thread? holder;
    private static ManualResetEventSlim? release;

    public static void Acquire()
    {
        lock (Gate)
        {
            if (holder is not null)
            {
                return;
            }

            var started = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
            var stop = new ManualResetEventSlim(false);
            var thread = new Thread(() => Hold(started, stop)) { IsBackground = true, Name = "sleep-prevention" };
            thread.Start();
            if (started.Task.GetAwaiter().GetResult() is { } error)
            {
                throw new CommandException(error);
            }

            holder = thread;
            release = stop;
        }
    }

    public static void Release()
    {
        Thread? thread;
        lock (Gate)
        {
            thread = holder;
            release?.Set();
            holder = null;
            release = null;
        }

        thread?.Join();
    }

    private static void Hold(TaskCompletionSource<string?> started, ManualResetEventSlim stop)
    {
        var previous = PInvoke.SetThreadExecutionState(EXECUTION_STATE.ES_CONTINUOUS | EXECUTION_STATE.ES_SYSTEM_REQUIRED);
        if (previous == 0)
        {
            started.SetResult("Windows refused to enable sleep prevention for an active install.");
            return;
        }

        started.SetResult(null);
        stop.Wait();
        if (PInvoke.SetThreadExecutionState(EXECUTION_STATE.ES_CONTINUOUS) == 0)
        {
            Logging.Log.Warn("claudio_core", "[installer] failed to clear Windows sleep prevention");
        }
    }
}
