using System.Diagnostics;
using System.Text.Json;
using System.Threading.Channels;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class PackageDownload
{
    private const int IndividualFileThreshold = 100;
    private const int WriterQueueChunks = 32;
    private const int WriterBufferBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(200);

    public static async Task<DownloadInfo> RunAsync(
        RpcHost host,
        DownloadOptions options,
        int gameId,
        string gameTitle,
        string tempRoot,
        InstallControl control)
    {
        Action<InstallProgress> onProgress = progress => Progress.Emit(host, progress);
        return await RunAsync(options, gameId, gameTitle, tempRoot, control, onProgress);
    }

    public static async Task<DownloadInfo> RunAsync(
        DownloadOptions options,
        int gameId,
        string gameTitle,
        string tempRoot,
        InstallControl control,
        Action<InstallProgress> onProgress)
    {
        using var client = DownloadHttp.CreateClient();
        onProgress(new InstallProgress
        {
            GameId = gameId,
            Status = "requestingManifest",
            Percent = 0,
            Detail = "Preparing download",
        });

        var serverUrl = options.ServerUrl;
        var headers = options.CustomHeaders;
        using var manifestResponse = await DownloadHttp.SendAsync(
            client,
            DownloadHttp.Request(HttpMethod.Get, $"{serverUrl}/api/games/{gameId}/download-files-manifest", headers));
        var manifestMissing = manifestResponse.StatusCode == System.Net.HttpStatusCode.NotFound;
        List<JsonElement>? files = null;
        if (!manifestMissing)
        {
            if (!manifestResponse.IsSuccessStatusCode)
            {
                throw new CommandException($"Failed to load download file manifest: {StatusText(manifestResponse)}");
            }

            var manifest = await DownloadHttp.ReadJsonAsync(manifestResponse);
            if (manifest.ValueKind == JsonValueKind.Object
                && manifest.TryGetProperty("files", out var array)
                && array.ValueKind == JsonValueKind.Array)
            {
                files = array.EnumerateArray().ToList();
            }
        }

        if (files is { Count: < IndividualFileThreshold })
        {
            return await IndividualDownload.RunAsync(client, options, gameId, gameTitle, tempRoot, control, onProgress, files);
        }

        var response = manifestMissing
            ? await RequestWithTicketAsync(client, options, gameId)
            : await DownloadHttp.SendAsync(client, DownloadHttp.Request(HttpMethod.Get, $"{serverUrl}/api/games/{gameId}/download", headers));

        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                response.Dispose();
                response = await RequestWithTicketAsync(client, options, gameId);
            }

            if (!response.IsSuccessStatusCode)
            {
                var text = StatusText(response);
                response.Dispose();
                throw new CommandException($"Failed to download game package: {text}");
            }
        }

        using (response)
        {
            return await StreamPackageAsync(response, options, gameId, gameTitle, tempRoot, control, onProgress);
        }
    }

    private static async Task<HttpResponseMessage> RequestWithTicketAsync(HttpClient client, DownloadOptions options, int gameId)
    {
        var serverUrl = options.ServerUrl;
        using var ticketResponse = await DownloadHttp.SendAsync(
            client,
            DownloadHttp.Request(HttpMethod.Post, $"{serverUrl}/api/games/{gameId}/download-ticket", options.CustomHeaders));
        if (!ticketResponse.IsSuccessStatusCode)
        {
            throw new CommandException($"Failed to create download ticket: {StatusText(ticketResponse)}");
        }

        var json = await DownloadHttp.ReadJsonAsync(ticketResponse);
        var ticket = json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("ticket", out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()!
                : throw new CommandException("Download ticket response was missing the ticket.");
        return await DownloadHttp.SendAsync(
            client,
            DownloadHttp.Request(HttpMethod.Get, $"{serverUrl}/api/games/{gameId}/download?ticket={ticket}", options.CustomHeaders));
    }

    public static string StatusText(HttpResponseMessage response)
    {
        var code = (int)response.StatusCode;
        return string.IsNullOrEmpty(response.ReasonPhrase) ? code.ToString() : $"{code} {response.ReasonPhrase}";
    }

    private static async Task<DownloadInfo> StreamPackageAsync(
        HttpResponseMessage response,
        DownloadOptions options,
        int gameId,
        string gameTitle,
        string tempRoot,
        InstallControl control,
        Action<InstallProgress> onProgress)
    {
        var filename = DownloadHttp.InferFilename(response.Content.Headers) ?? $"game-{gameId}.tar";
        var downloadPath = Path.Combine(tempRoot, filename);
        var totalBytes = response.Content.Headers.ContentLength is { } length ? (ulong)length : (ulong?)null;
        ulong downloaded = 0;
        var limit = DownloadHttp.BytesPerSecondLimit(options.SpeedLimitKbs);
        var windowStart = Stopwatch.StartNew();
        ulong windowBytes = 0;
        var lastEmit = Stopwatch.StartNew();
        var firstEmit = true;

        var chunks = Channel.CreateBounded<byte[]>(WriterQueueChunks);
        var writer = Task.Run(async () =>
        {
            try
            {
                await using var file = new FileStream(downloadPath, FileMode.Create, FileAccess.Write, FileShare.None, WriterBufferBytes);
                await foreach (var chunk in chunks.Reader.ReadAllAsync())
                {
                    await file.WriteAsync(chunk);
                }

                await file.FlushAsync();
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                chunks.Writer.TryComplete(error);
                throw new CommandException($"Failed to write download chunk: {error.Message}");
            }
        });

        await using var stream = await response.Content.ReadAsStreamAsync();
        var buffer = new byte[81920];
        try
        {
            while (true)
            {
                int read;
                try
                {
                    read = await stream.ReadAsync(buffer);
                }
                catch (Exception error) when (error is IOException or HttpRequestException)
                {
                    throw new CommandException(error.Message);
                }

                if (read == 0)
                {
                    break;
                }

                if (control.IsCancelled)
                {
                    chunks.Writer.TryComplete();
                    await Task.WhenAny(writer);
                    FileOps.TryDeleteTree(tempRoot);
                    throw new CommandException("Install cancelled.");
                }

                try
                {
                    await chunks.Writer.WriteAsync(buffer.AsSpan(0, read).ToArray());
                }
                catch (ChannelClosedException)
                {
                    throw new CommandException("Writer thread died unexpectedly.");
                }

                downloaded += (ulong)read;
                windowBytes += (ulong)read;

                if (windowStart.Elapsed >= TimeSpan.FromSeconds(1))
                {
                    limit = DownloadHttp.BytesPerSecondLimit(SettingsStore.Load().DownloadSpeedLimitKbs);
                    windowStart.Restart();
                    windowBytes = 0;
                }

                if (limit is { } bytesPerSecond)
                {
                    var expected = TimeSpan.FromSeconds(windowBytes / (double)bytesPerSecond);
                    if (expected > windowStart.Elapsed)
                    {
                        await Task.Delay(expected - windowStart.Elapsed);
                    }
                }

                if (firstEmit || lastEmit.Elapsed >= ProgressInterval)
                {
                    firstEmit = false;
                    lastEmit.Restart();
                    onProgress(new InstallProgress
                    {
                        GameId = gameId,
                        Status = "downloading",
                        Percent = totalBytes is > 0 ? downloaded / (double)totalBytes * options.ProgressScale : null,
                        Detail = $"Downloading {gameTitle}",
                        BytesDownloaded = downloaded,
                        TotalBytes = totalBytes,
                    });
                }
            }
        }
        catch
        {
            chunks.Writer.TryComplete();
            try
            {
                await writer;
            }
            catch (CommandException)
            {
            }

            throw;
        }

        chunks.Writer.TryComplete();
        await writer;
        return new DownloadInfo(downloadPath, false);
    }
}
