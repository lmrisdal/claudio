using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Claudio.Core.Rpc;

internal sealed class RpcHost(ChannelWriter<byte[]> output, string resourceDir)
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> pending = new();
    private long nextConfirmId;

    public string ResourceDir { get; } = resourceDir;

    public void Emit(string name, ResultWriter payload) => output.TryWrite(Messages.Event(name, payload));

    public async Task<bool> ConfirmAsync(string title, string message, string okLabel, string cancelLabel)
    {
        var id = $"c{Interlocked.Increment(ref nextConfirmId)}";
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        if (!output.TryWrite(Messages.ConfirmRequest(id, title, message, okLabel, cancelLabel)))
        {
            pending.TryRemove(id, out _);
            return false;
        }

        return await completion.Task;
    }

    public void ResolveConfirm(string id, bool answer)
    {
        if (pending.TryRemove(id, out var completion))
        {
            completion.TrySetResult(answer);
        }
    }

    public void CancelPendingConfirms()
    {
        foreach (var id in pending.Keys)
        {
            if (pending.TryRemove(id, out var completion))
            {
                completion.TrySetResult(false);
            }
        }
    }
}
