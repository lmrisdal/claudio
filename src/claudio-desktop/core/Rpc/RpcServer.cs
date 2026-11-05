using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Claudio.Core.Logging;

namespace Claudio.Core.Rpc;

internal static class RpcServer
{
    private static readonly TimeSpan ShutdownGrace = TimeSpan.FromMilliseconds(500);

    public static async Task ServeAsync(Stream input, Stream output, string resourceDir)
    {
        var lines = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleReader = true });
        var writerTask = Task.Run(async () =>
        {
            await foreach (var line in lines.Reader.ReadAllAsync())
            {
                try
                {
                    await output.WriteAsync(line);
                    await output.FlushAsync();
                }
                catch (IOException)
                {
                    return;
                }
            }
        });

        var host = new RpcHost(lines.Writer, resourceDir);
        var dispatcher = new Dispatcher(host);
        var inFlight = new List<Task>();

        using var reader = new StreamReader(input, new UTF8Encoding(false));
        try
        {
            while (await reader.ReadLineAsync() is { } line)
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                var task = HandleLine(line, host, dispatcher, lines.Writer);
                if (task is not null)
                {
                    inFlight.Add(task);
                    inFlight.RemoveAll(done => done.IsCompleted);
                }
            }
        }
        catch (IOException error)
        {
            Log.Error("claudio_core", $"Failed to read from the shell: {error.Message}");
        }

        host.CancelPendingConfirms();
        await Task.WhenAny(Task.WhenAll(inFlight), Task.Delay(ShutdownGrace));
        lines.Writer.TryComplete();
        await Task.WhenAny(writerTask, Task.Delay(ShutdownGrace));
    }

    private static Task? HandleLine(string line, RpcHost host, Dispatcher dispatcher, ChannelWriter<byte[]> output)
    {
        Incoming message;
        try
        {
            message = Messages.Parse(line);
        }
        catch (CommandException error)
        {
            Log.Warn("claudio_core", error.Message);
            return null;
        }

        switch (message)
        {
            case IncomingRequest request:
                return Task.Run(() => RunRequest(request, dispatcher, output));
            case IncomingResponse { Id.ValueKind: JsonValueKind.String } response:
                host.ResolveConfirm(response.Id.GetString()!, response.Result.ValueKind == JsonValueKind.True);
                return null;
            default:
                return null;
        }
    }

    private static async Task RunRequest(IncomingRequest request, Dispatcher dispatcher, ChannelWriter<byte[]> output)
    {
        byte[] reply;
        try
        {
            var result = await dispatcher.DispatchAsync(request.Method, request.Params);
            reply = Messages.Result(request.Id, result);
        }
        catch (CommandException error)
        {
            Log.Debug("claudio_core", $"command {request.Method} failed: {error.Message}");
            reply = Messages.Error(request.Id, error.Message);
        }
        catch (Exception error)
        {
            Log.Error("claudio_core", $"command {request.Method} crashed: {error}");
            reply = Messages.Error(request.Id, error.Message);
        }

        output.TryWrite(reply);
    }
}
