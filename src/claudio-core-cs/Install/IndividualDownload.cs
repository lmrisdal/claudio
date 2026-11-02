using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Channels;

namespace Claudio.Core.Install;

internal static class IndividualDownload
{
    private const int Concurrency = 2;
    private const int MaxFileAttempts = 5;
    private const int WriterQueueChunks = 16;
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(200);

    private enum AttemptKind
    {
        Cancelled,
        Fatal,
        Retryable,
    }

    private sealed class AttemptException(AttemptKind kind, string message) : Exception(message)
    {
        public AttemptKind Kind { get; } = kind;
    }

    public static async Task<DownloadInfo> RunAsync(
        HttpClient client,
        DownloadOptions options,
        int gameId,
        string gameTitle,
        string tempRoot,
        InstallControl control,
        Action<InstallProgress> onProgress,
        List<JsonElement> files)
    {
        var staging = Path.Combine(tempRoot, "files");
        Directory.CreateDirectory(staging);

        ulong totalBytes = 0;
        foreach (var file in files)
        {
            if (file.ValueKind == JsonValueKind.Object
                && file.TryGetProperty("size", out var size)
                && size.ValueKind == JsonValueKind.Number
                && size.TryGetUInt64(out var value))
            {
                totalBytes += value;
            }
        }

        var shared = new DownloadShared { SpeedLimit = (long)(DownloadHttp.BytesPerSecondLimit(options.SpeedLimitKbs) ?? 0) };
        using var stop = new CancellationTokenSource();
        var limitRefresh = RefreshLimitAsync(shared, stop.Token);

        InstallProgress Snapshot() => new()
        {
            GameId = gameId,
            Status = "downloading",
            Percent = totalBytes > 0
                ? Interlocked.Read(ref shared.Downloaded) / (double)totalBytes * options.ProgressScale
                : files.Count > 0 ? shared.Completed / (double)files.Count * options.ProgressScale : null,
            Detail = $"Downloading {gameTitle}",
            BytesDownloaded = (ulong)Interlocked.Read(ref shared.Downloaded),
            TotalBytes = totalBytes,
        };

        onProgress(new InstallProgress
        {
            GameId = gameId,
            Status = "downloading",
            Percent = 0,
            Detail = $"Downloading {gameTitle}",
            BytesDownloaded = 0,
            TotalBytes = totalBytes,
        });

        void MaybeEmit()
        {
            lock (shared.ProgressGate)
            {
                if (shared.LastEmit.Elapsed < ProgressInterval)
                {
                    return;
                }

                shared.LastEmit.Restart();
                onProgress(Snapshot());
            }
        }

        string? firstError = null;
        using var failure = new CancellationTokenSource();
        try
        {
            await Parallel.ForEachAsync(
                files,
                new ParallelOptions { MaxDegreeOfParallelism = Concurrency, CancellationToken = failure.Token },
                async (file, token) =>
                {
                    var relPath = file.ValueKind == JsonValueKind.Object
                        && file.TryGetProperty("path", out var path)
                        && path.ValueKind == JsonValueKind.String
                            ? path.GetString()!
                            : "";
                    var url = $"{options.ServerUrl}/api/games/{gameId}/download-files?path={DownloadHttp.UrlEncode(relPath)}";
                    var destination = Path.Combine(
                        staging,
                        relPath.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar));
                    try
                    {
                        await DownloadOneFileAsync(client, options, url, destination, relPath, control, shared, MaybeEmit, token);
                        Interlocked.Increment(ref shared.Completed);
                    }
                    catch (CommandException error)
                    {
                        Interlocked.CompareExchange(ref firstError, error.Message, null);
                        failure.Cancel();
                    }
                });
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            stop.Cancel();
            await limitRefresh;
        }

        if (control.IsCancelled)
        {
            throw new CommandException("Install cancelled.");
        }

        if (firstError is not null)
        {
            throw new CommandException(firstError);
        }

        onProgress(Snapshot());
        return new DownloadInfo(staging, true);
    }

    private static async Task RefreshLimitAsync(DownloadShared shared, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), token);
                var limit = DownloadHttp.BytesPerSecondLimit(SettingsStore.Load().DownloadSpeedLimitKbs) ?? 0;
                Interlocked.Exchange(ref shared.SpeedLimit, (long)limit);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private static async Task DownloadOneFileAsync(
        HttpClient client,
        DownloadOptions options,
        string url,
        string destination,
        string relPath,
        InstallControl control,
        DownloadShared shared,
        Action progress,
        CancellationToken token)
    {
        var attempt = 0;
        while (true)
        {
            attempt++;
            if (control.IsCancelled || token.IsCancellationRequested)
            {
                throw new CommandException("Install cancelled.");
            }

            var resumeFrom = File.Exists(destination) ? (ulong)new FileInfo(destination).Length : 0;
            try
            {
                await StreamAttemptAsync(client, options, url, destination, relPath, resumeFrom, control, shared, progress, token);
                return;
            }
            catch (AttemptException error) when (error.Kind == AttemptKind.Cancelled)
            {
                throw new CommandException("Install cancelled.");
            }
            catch (AttemptException error) when (error.Kind == AttemptKind.Fatal)
            {
                throw new CommandException($"Failed to download {relPath}: {error.Message}");
            }
            catch (AttemptException error)
            {
                if (attempt >= MaxFileAttempts)
                {
                    throw new CommandException($"Failed to download {relPath} after {attempt} attempts: {error.Message}");
                }

                var backoff = TimeSpan.FromMilliseconds(Math.Min(500.0 * (1 << (attempt - 1)), 10_000));
                try
                {
                    await Task.Delay(backoff, token);
                }
                catch (OperationCanceledException)
                {
                    throw new CommandException("Install cancelled.");
                }
            }
        }
    }

    private static async Task StreamAttemptAsync(
        HttpClient client,
        DownloadOptions options,
        string url,
        string destination,
        string relPath,
        ulong resumeFrom,
        InstallControl control,
        DownloadShared shared,
        Action progress,
        CancellationToken token)
    {
        using var request = DownloadHttp.Request(HttpMethod.Get, url, options.CustomHeaders);
        if (resumeFrom > 0)
        {
            request.Headers.Range = new RangeHeaderValue((long)resumeFrom, null);
        }

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        }
        catch (HttpRequestException error)
        {
            throw new AttemptException(AttemptKind.Retryable, $"request failed: {error.Message}");
        }
        catch (OperationCanceledException)
        {
            throw new AttemptException(AttemptKind.Cancelled, "cancelled");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var text = $"HTTP {PackageDownload.StatusText(response)}";
                var code = (int)response.StatusCode;
                throw new AttemptException(code is >= 500 and < 600 or 429 ? AttemptKind.Retryable : AttemptKind.Fatal, text);
            }

            var append = resumeFrom > 0 && response.StatusCode == HttpStatusCode.PartialContent;
            if (!append && resumeFrom > 0)
            {
                var previous = Interlocked.Read(ref shared.Downloaded);
                Interlocked.Add(ref shared.Downloaded, -Math.Min((long)resumeFrom, previous));
            }

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new AttemptException(AttemptKind.Fatal, $"failed to create directory: {error.Message}");
            }

            await WriteBodyAsync(response, destination, relPath, append, control, shared, progress, token);
        }
    }

    private static async Task WriteBodyAsync(
        HttpResponseMessage response,
        string destination,
        string relPath,
        bool append,
        InstallControl control,
        DownloadShared shared,
        Action progress,
        CancellationToken token)
    {
        var chunks = Channel.CreateBounded<byte[]>(WriterQueueChunks);
        var writer = Task.Run(async () =>
        {
            try
            {
                await using var file = new FileStream(destination, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None);
                await foreach (var chunk in chunks.Reader.ReadAllAsync())
                {
                    await file.WriteAsync(chunk);
                }

                await file.FlushAsync();
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                chunks.Writer.TryComplete(error);
                throw new AttemptException(AttemptKind.Retryable, $"{relPath}: failed to write file: {error.Message}");
            }
        });

        AttemptException? readError = null;
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            var buffer = new byte[81920];
            while (true)
            {
                int read;
                try
                {
                    read = await stream.ReadAsync(buffer, token);
                }
                catch (Exception error) when (error is IOException or HttpRequestException)
                {
                    readError = new AttemptException(AttemptKind.Retryable, $"read failed: {error.Message}");
                    break;
                }

                if (read == 0)
                {
                    break;
                }

                if (control.IsCancelled)
                {
                    readError = new AttemptException(AttemptKind.Cancelled, "cancelled");
                    break;
                }

                await shared.ThrottleAsync((ulong)read);
                try
                {
                    await chunks.Writer.WriteAsync(buffer.AsSpan(0, read).ToArray(), token);
                }
                catch (ChannelClosedException)
                {
                    readError = new AttemptException(AttemptKind.Retryable, "writer task ended");
                    break;
                }

                Interlocked.Add(ref shared.Downloaded, read);
                progress();
            }
        }
        catch (OperationCanceledException)
        {
            readError = new AttemptException(AttemptKind.Cancelled, "cancelled");
        }

        chunks.Writer.TryComplete();
        try
        {
            await writer;
        }
        catch (AttemptException) when (readError is not null)
        {
        }

        if (readError is not null)
        {
            throw readError;
        }
    }
}
