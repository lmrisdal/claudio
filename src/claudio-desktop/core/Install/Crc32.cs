namespace Claudio.Core.Install;

internal static class Crc32
{
    private static readonly uint[] Table = BuildTable();

    private static uint[] BuildTable()
    {
        var table = new uint[256];
        for (uint index = 0; index < 256; index++)
        {
            var value = index;
            for (var bit = 0; bit < 8; bit++)
            {
                value = (value & 1) != 0 ? 0xEDB88320u ^ (value >> 1) : value >> 1;
            }

            table[index] = value;
        }

        return table;
    }

    public static uint Update(uint state, ReadOnlySpan<byte> data)
    {
        foreach (var value in data)
        {
            state = Table[(state ^ value) & 0xFF] ^ (state >> 8);
        }

        return state;
    }

    public const uint Initial = 0xFFFFFFFFu;

    public static uint Finish(uint state) => ~state;
}
