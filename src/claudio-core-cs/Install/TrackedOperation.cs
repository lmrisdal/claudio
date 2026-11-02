using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class TrackedOperation
{
    public static async Task<T> RunAsync<T>(
        InstallState state,
        int gameId,
        string cancelledMessage,
        Func<InstallControl, Task<T>> work,
        Action<string> onFailure,
        Action<InstallControl>? afterFinish = null)
    {
        var control = state.Start(gameId);
        T? result = default;
        CommandException? failure = null;
        try
        {
            result = await work(control);
        }
        catch (CommandException error)
        {
            failure = error;
        }
        catch (Exception error)
        {
            Log.Error("claudio_core", $"Unexpected failure in operation for game {gameId}: {error}");
            failure = new CommandException(error.Message);
        }
        finally
        {
            if (failure is not null && !control.IsCancelled)
            {
                onFailure(failure.Message);
            }

            state.Finish(gameId);
        }

        afterFinish?.Invoke(control);
        if (control.IsCancelled)
        {
            throw new CommandException(cancelledMessage);
        }

        return failure is null ? result! : throw failure;
    }
}
