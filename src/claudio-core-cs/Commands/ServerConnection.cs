using System.Net.Http.Headers;
using Claudio.Core.Rpc;

namespace Claudio.Core.Commands;

internal static class ServerConnection
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);

    public static async Task<ServerConnectionResult> CheckAsync(ConnectionArgs args)
    {
        var settings = SettingsStore.Load();
        var origin = FirstNonEmpty(args.ServerUrl, settings.ServerUrl)
            ?? throw new CommandException("Desktop server URL is not configured.");
        var headers = args.CustomHeaders is null ? settings.CustomHeaders : SettingsStore.SanitizeHeaders(args.CustomHeaders);
        var path = NormalizePath(args.Path ?? "/health");

        using var handler = new SocketsHttpHandler { ConnectTimeout = ConnectTimeout };
        using var client = new HttpClient(handler) { Timeout = RequestTimeout };
        var url = origin + path;
        Tls.EnsureAvailable(url);
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (name, value) in headers)
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

        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            return new ServerConnectionResult
            {
                Ok = response.IsSuccessStatusCode && !IsHtml(response.Content.Headers.ContentType),
                Status = (ushort)response.StatusCode,
            };
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or UriFormatException)
        {
            throw new CommandException($"error sending request for url ({url})");
        }
    }

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            var trimmed = value?.Trim();
            if (!string.IsNullOrEmpty(trimmed))
            {
                return trimmed.TrimEnd('/');
            }
        }

        return null;
    }

    private static bool IsHtml(MediaTypeHeaderValue? contentType) =>
        contentType?.ToString().Contains("text/html", StringComparison.OrdinalIgnoreCase) ?? false;

    internal static string NormalizePath(string path)
    {
        var trimmed = path.Trim();
        if (trimmed.Length == 0)
        {
            throw new CommandException("Connection test path is required.");
        }

        if (!trimmed.StartsWith('/'))
        {
            throw new CommandException("Connection test path must start with '/'.");
        }

        return trimmed;
    }
}
