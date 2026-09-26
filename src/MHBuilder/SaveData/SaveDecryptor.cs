using Org.BouncyCastle.Crypto.Engines;
using Org.BouncyCastle.Crypto.Parameters;

namespace MHBuilder.SaveData;

/// <summary>
/// Decrypts a Monster Hunter World: Iceborne PC save (SAVEDATA1000) in place: Blowfish over the whole file,
/// then the Iceborne layer over the header and each of the three character slots.
/// </summary>
public static class SaveDecryptor
{
    private static readonly byte[] BlowfishKey = "xieZjoe#P2134-3zmaghgpqoe0z8$3azeq"u8.ToArray();

    private static readonly (int Offset, int Size)[] IceborneRegions =
    [
        (0x70, 0xDA50),
        (0x3010D8, 0x2098C0),
        (0x50AB98, 0x2098C0),
        (0x714658, 0x2098C0),
    ];

    /// <summary>Each region's key salt is the 0x200 bytes right after it, so the file must reach past the last one.</summary>
    public static readonly int MinimumLength = IceborneRegions.Max(r => r.Offset + r.Size + 0x200);

    public static void Decrypt(byte[] data)
    {
        if (data.Length < MinimumLength || data.Length % 8 != 0)
            throw new FormatException("This isn't a Monster Hunter World: Iceborne PC save (SAVEDATA1000).");

        const int chunk = 1 << 16;
        Parallel.For(0, (data.Length + chunk - 1) / chunk, c =>
        {
            var engine = new BlowfishEngine();
            engine.Init(false, new KeyParameter(BlowfishKey));
            int end = Math.Min(data.Length, (c + 1) * chunk);
            for (int i = c * chunk; i < end; i += 8)
            {
                // The game's Blowfish loads each 32-bit half little-endian; BouncyCastle's loads big-endian.
                Array.Reverse(data, i, 4);
                Array.Reverse(data, i + 4, 4);
                engine.ProcessBlock(data, i, data, i);
                Array.Reverse(data, i, 4);
                Array.Reverse(data, i + 4, 4);
            }
        });

        Parallel.ForEach(IceborneRegions, r => IceborneCrypto.DecryptRegion(data, r.Offset, r.Size));
    }
}
