using System.Net.Http.Headers;
using System.Text.Json;

namespace Claudio.Core.Install;

internal sealed class DownloadOptions
{
    public required string ServerUrl { get; init; }
    public required Dictionary<string, string> CustomHeaders { get; init; }
    public double? SpeedLimitKbs { get; init; }
    public double ProgressScale { get; init; }
}

internal sealed record DownloadInfo(string FilePath, bool IsIndividual);

internal static class DownloadHttp
{
    public static HttpClient CreateClient() => new() { Timeout = Timeout.InfiniteTimeSpan };

    public static HttpRequestMessage Request(HttpMethod method, string url, Dictionary<string, string> customHeaders)
    {
        Tls.EnsureAvailable(url);
        var request = new HttpRequestMessage(method, url);
        foreach (var (name, value) in customHeaders)
        {
            if (SettingsStore.IsForbiddenHeader(name))
            {
                continue;
            }

            try
            {
                request.Headers.Add(name, value);
            }
            catch (Exception error) when (error is FormatException or InvalidOperationException)
            {
                throw new CommandException(error.Message);
            }
        }

        return request;
    }

    public static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpRequestMessage request, CancellationToken token = default)
    {
        try
        {
            return await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        }
        catch (HttpRequestException)
        {
            throw new CommandException($"error sending request for url ({request.RequestUri})");
        }
    }

    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var document = await JsonDocument.ParseAsync(stream);
            return document.RootElement.Clone();
        }
        catch (Exception error) when (error is JsonException or HttpRequestException)
        {
            throw new CommandException(error.Message);
        }
    }

    public static string? InferFilename(HttpContentHeaders headers)
    {
        if (!headers.TryGetValues("Content-Disposition", out var values))
        {
            return null;
        }

        foreach (var part in values.First().Split(';').Select(part => part.Trim()))
        {
            if (part.StartsWith("filename*=UTF-8''", StringComparison.Ordinal))
            {
                return part["filename*=UTF-8''".Length..];
            }

            if (part.StartsWith("filename=", StringComparison.Ordinal))
            {
                return part["filename=".Length..].Trim('"');
            }
        }

        return null;
    }

    public static string UrlEncode(string input)
    {
        var encoded = new System.Text.StringBuilder(input.Length);
        foreach (var value in System.Text.Encoding.UTF8.GetBytes(input))
        {
            var ch = (char)value;
            if (ch is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_' or '.' or '~' or '/')
            {
                encoded.Append(ch);
            }
            else
            {
                encoded.Append('%').Append(value.ToString("X2"));
            }
        }

        return encoded.ToString();
    }

    public static ulong? BytesPerSecondLimit(double? kbs) => kbs is > 0 ? (ulong)(kbs.Value * 1024.0) : null;
}
