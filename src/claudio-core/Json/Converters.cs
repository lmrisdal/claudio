using System.Text.Json;
using System.Text.Json.Serialization;

namespace Claudio.Core.Json;

public sealed class RustFloatConverter : JsonConverter<double>
{
    public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.GetDouble();

    public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
    {
        if (double.IsFinite(value) && value == Math.Floor(value) && Math.Abs(value) < 1e15)
        {
            writer.WriteRawValue(value.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture));
        }
        else
        {
            writer.WriteNumberValue(value);
        }
    }
}
