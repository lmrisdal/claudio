using System.Text.Encodings.Web;
using System.Text.Json;

namespace Claudio.Core.Rpc;

internal delegate void ResultWriter(Utf8JsonWriter writer);

internal abstract record Incoming;

internal sealed record IncomingRequest(JsonElement Id, string Method, JsonElement Params) : Incoming;

internal sealed record IncomingResponse(JsonElement Id, JsonElement Result) : Incoming;

internal static class Messages
{
    private static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static Incoming Parse(string line)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(line).RootElement.Clone();
        }
        catch (JsonException error)
        {
            throw new CommandException($"Malformed message: {error.Message}");
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new CommandException("Malformed message: expected a JSON object");
        }

        if (!root.TryGetProperty("id", out var id) || id.ValueKind == JsonValueKind.Null)
        {
            throw new CommandException("Message is missing an id.");
        }

        if (root.TryGetProperty("method", out var method) && method.ValueKind != JsonValueKind.Null)
        {
            if (method.ValueKind != JsonValueKind.String)
            {
                throw new CommandException("Malformed message: method must be a string");
            }

            root.TryGetProperty("params", out var parameters);
            return new IncomingRequest(id, method.GetString()!, parameters);
        }

        root.TryGetProperty("result", out var result);
        return new IncomingResponse(id, result);
    }

    public static byte[] Result(JsonElement id, ResultWriter result) =>
        Build(writer =>
        {
            writer.WritePropertyName("id");
            id.WriteTo(writer);
            writer.WritePropertyName("result");
            result(writer);
        });

    public static byte[] Error(JsonElement id, string message) =>
        Build(writer =>
        {
            writer.WritePropertyName("id");
            id.WriteTo(writer);
            writer.WriteString("error", message);
        });

    public static byte[] Event(string name, ResultWriter payload) =>
        Build(writer =>
        {
            writer.WriteString("event", name);
            writer.WritePropertyName("payload");
            payload(writer);
        });

    public static byte[] ConfirmRequest(string id, string title, string message, string okLabel, string cancelLabel) =>
        Build(writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("request", "confirm");
            writer.WriteStartObject("params");
            writer.WriteString("title", title);
            writer.WriteString("message", message);
            writer.WriteString("okLabel", okLabel);
            writer.WriteString("cancelLabel", cancelLabel);
            writer.WriteEndObject();
        });

    private static byte[] Build(Action<Utf8JsonWriter> body)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            body(writer);
            writer.WriteEndObject();
        }

        buffer.WriteByte((byte)'\n');
        return buffer.ToArray();
    }
}
