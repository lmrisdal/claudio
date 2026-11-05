using System.Text;

namespace Claudio.Core.Linux;

internal abstract record VdfValue;

internal sealed record VdfObject : VdfValue
{
    public SortedDictionary<string, VdfValue> Items { get; } = new(StringComparer.Ordinal);

    public override string ToString() => $"VdfObject({Items.Count})";

    public bool Equals(VdfObject? other) =>
        other is not null && Items.Count == other.Items.Count
            && Items.All(pair => other.Items.TryGetValue(pair.Key, out var value) && Equals(pair.Value, value));

    public override int GetHashCode() => Items.Count;
}

internal sealed record VdfString(string Value) : VdfValue;

internal sealed record VdfInt32(byte Tag, int Value) : VdfValue;

internal static class BinaryVdf
{
    public const byte None = 0x00;
    public const byte String = 0x01;
    public const byte Int32 = 0x02;
    public const byte Pointer = 0x04;
    public const byte Color = 0x06;
    public const byte End = 0x08;

    public static VdfObject Parse(byte[] bytes)
    {
        var offset = 0;
        return ReadObject(bytes, ref offset);
    }

    private static VdfObject ReadObject(byte[] bytes, ref int offset)
    {
        var result = new VdfObject();
        while (true)
        {
            if (offset >= bytes.Length)
            {
                throw new FormatException("Unexpected end of binary VDF");
            }

            var type = bytes[offset++];
            if (type == End)
            {
                return result;
            }

            var key = ReadCString(bytes, ref offset);
            result.Items[key] = type switch
            {
                None => ReadObject(bytes, ref offset),
                String => new VdfString(ReadCString(bytes, ref offset)),
                Int32 or Pointer or Color => new VdfInt32(type, ReadInt32(bytes, ref offset)),
                _ => throw new FormatException($"Unknown binary VDF type byte 0x{type:x2}"),
            };
        }
    }

    private static string ReadCString(byte[] bytes, ref int offset)
    {
        var end = Array.IndexOf(bytes, (byte)0, offset);
        if (end < 0)
        {
            throw new FormatException("Unterminated binary VDF string");
        }

        var value = Encoding.UTF8.GetString(bytes, offset, end - offset);
        offset = end + 1;
        return value;
    }

    private static int ReadInt32(byte[] bytes, ref int offset)
    {
        if (offset + 4 > bytes.Length)
        {
            throw new FormatException("Unexpected end of binary VDF");
        }

        var value = BitConverter.ToInt32(bytes, offset);
        offset += 4;
        return value;
    }

    public static byte[] Dump(VdfObject root)
    {
        using var output = new MemoryStream();
        WriteObject(output, root);
        return output.ToArray();
    }

    private static void WriteObject(Stream output, VdfObject value)
    {
        foreach (var (key, child) in value.Items)
        {
            WriteValue(output, key, child);
        }

        output.WriteByte(End);
    }

    private static void WriteValue(Stream output, string key, VdfValue value)
    {
        switch (value)
        {
            case VdfObject obj:
                output.WriteByte(None);
                WriteCString(output, key);
                WriteObject(output, obj);
                break;
            case VdfString text:
                output.WriteByte(String);
                WriteCString(output, key);
                WriteCString(output, text.Value);
                break;
            case VdfInt32 number:
                output.WriteByte(number.Tag);
                WriteCString(output, key);
                output.Write(BitConverter.GetBytes(number.Value));
                break;
        }
    }

    private static void WriteCString(Stream output, string value)
    {
        output.Write(Encoding.UTF8.GetBytes(value));
        output.WriteByte(0);
    }
}
