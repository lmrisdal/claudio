using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace Claudio.Core.Rpc;

internal static class Params
{
    public static T Parse<T>(string method, JsonElement parameters, JsonTypeInfo<T> typeInfo)
    {
        var json = parameters.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "{}"
            : parameters.GetRawText();
        try
        {
            return JsonSerializer.Deserialize(json, typeInfo)
                ?? throw new CommandException($"invalid args for command `{method}`: invalid type: null");
        }
        catch (JsonException error)
        {
            throw new CommandException($"invalid args for command `{method}`: {error.Message}");
        }
    }
}
