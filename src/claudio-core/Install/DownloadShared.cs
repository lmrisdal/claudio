using System.Diagnostics;

namespace Claudio.Core.Install;

internal sealed class DownloadShared
{
    public readonly Lock WindowGate = new();
    public readonly Stopwatch Window = Stopwatch.StartNew();
    public ulong WindowBytes;
    public long Downloaded;
    public long SpeedLimit;
    public readonly Lock ProgressGate = new();
    public readonly Stopwatch LastEmit = Stopwatch.StartNew();
    public int Completed;

    public async Task ThrottleAsync(ulong chunkLength)
    {
        if (Interlocked.Read(ref SpeedLimit) == 0)
        {
            return;
        }

        lock (WindowGate)
        {
            if (Window.Elapsed >= TimeSpan.FromSeconds(1))
            {
                Window.Restart();
                WindowBytes = 0;
            }

            WindowBytes += chunkLength;
        }

        while (true)
        {
            TimeSpan? delay;
            lock (WindowGate)
            {
                var limit = Interlocked.Read(ref SpeedLimit);
                if (Window.Elapsed >= TimeSpan.FromSeconds(1) || limit == 0)
                {
                    return;
                }

                var expected = TimeSpan.FromSeconds(WindowBytes / (double)limit);
                delay = expected > Window.Elapsed ? expected - Window.Elapsed : null;
            }

            if (delay is not { } wait)
            {
                return;
            }

            await Task.Delay(wait < TimeSpan.FromMilliseconds(200) ? wait : TimeSpan.FromMilliseconds(200));
        }
    }
}
