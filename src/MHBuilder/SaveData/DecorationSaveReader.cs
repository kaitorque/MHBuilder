using System.Text;
using MHBuilder.Catalog;

namespace MHBuilder.SaveData;

/// <summary>Decorations one character owns: item-box stock plus jewels slotted in gear and mantles.</summary>
public sealed record SaveSlotDecorations(
    int Slot,
    string Name,
    int HunterRank,
    int MasterRank,
    int PlaytimeSeconds,
    IReadOnlyDictionary<int, int> Decorations,
    int InBox,
    int Slotted,
    int Unknown);

/// <summary>
/// Reads decoration counts from a decrypted Iceborne save. Offsets follow MHWSaveUtils' DecorationsReader
/// (https://github.com/TanukiSharp/MHWSaveUtils); see THIRD-PARTY-NOTICES.md.
/// </summary>
public static class DecorationSaveReader
{
    private const uint Section3Signature = 0xAD35B985;
    private const int HunterAppearanceSize = 168;
    private const int PalicoAppearanceSize = 44;
    private const int MaxMonsterCount = 96;
    private const int GuildCardSize =
        171 + HunterAppearanceSize + 212 + 64 + 4 + 194 + 14 * 2 * 5 + 4 + 256 + 256 + 5454
        + MaxMonsterCount * 2 * 4 + MaxMonsterCount;
    private const int DecorationBoxEntries = 500;
    private const int EquipmentEntries = 2500;
    private const int EquipmentEntrySize = 126;
    private const int MantleEntries = 128;
    private const uint EmptySlot = uint.MaxValue;

    public static IReadOnlyList<SaveSlotDecorations> Read(byte[] decrypted, GameCatalog catalog)
    {
        var byEquipmentId = catalog.Decorations
            .Where(d => d.EquipmentId is not null)
            .ToDictionary(d => (uint)d.EquipmentId!.Value, d => d.Id);

        using var reader = new BinaryReader(new MemoryStream(decrypted, writable: false), Encoding.ASCII);
        reader.BaseStream.Position = 64 + 8 * 3;
        long section3 = reader.ReadInt64();
        if (section3 <= 0 || section3 >= decrypted.Length)
            throw new FormatException("Couldn't find the character data in this save.");
        reader.BaseStream.Position = section3;
        if (reader.ReadUInt32() != Section3Signature)
            throw new FormatException("Couldn't decrypt this save. Is it an Iceborne PC save (SAVEDATA1000)?");
        Skip(reader, 4 + 8);

        var slots = new List<SaveSlotDecorations>();
        for (int slot = 1; slot <= 3; slot++)
        {
            var s = ReadSlot(reader, slot, catalog, byEquipmentId);
            if (s is not null) slots.Add(s);
        }
        return slots;
    }

    private static SaveSlotDecorations? ReadSlot(BinaryReader reader, int slot, GameCatalog catalog, Dictionary<uint, int> byEquipmentId)
    {
        Skip(reader, 4);
        string name = Encoding.UTF8.GetString(reader.ReadBytes(64)).TrimEnd('\0');
        int hr = (int)reader.ReadUInt32();
        int mr = (int)reader.ReadUInt32();
        Skip(reader, 4 + 4 + 8); // zeni, research points, unknown
        int playtime = (int)reader.ReadUInt32();

        Skip(reader, HunterAppearanceSize + 382 + PalicoAppearanceSize);
        Skip(reader, (long)GuildCardSize * 101); // own card + 100 collected
        Skip(reader, 209447);
        Skip(reader, 142200); // item loadouts
        Skip(reader, 24 * 8 + 16 * 8 + 256 + 7 * 8); // item pouch
        Skip(reader, 200 * 8 + 200 * 8 + 1250 * 8); // item box: items, ammo, materials

        var counts = new Dictionary<int, int>();
        int inBox = 0, slotted = 0, unknown = 0;
        bool layoutOk = true;

        for (int i = 0; i < DecorationBoxEntries; i++)
        {
            uint id = reader.ReadUInt32();
            uint qty = reader.ReadUInt32();
            if (id == 0 || qty == 0) continue;
            if (!catalog.DecorationsById.ContainsKey((int)id) || qty > 9999)
            {
                layoutOk = false;
                continue;
            }
            Add(counts, (int)id, (int)qty);
            inBox += (int)qty;
        }

        void AddSlotted(uint equipmentId)
        {
            if (equipmentId == EmptySlot) return;
            if (byEquipmentId.TryGetValue(equipmentId, out int itemId))
            {
                Add(counts, itemId, 1);
                slotted++;
            }
            else
            {
                unknown++;
            }
        }

        for (int i = 0; i < EquipmentEntries; i++)
        {
            long start = reader.BaseStream.Position;
            Skip(reader, 4); // sort index
            uint type = reader.ReadUInt32();
            Skip(reader, 4 + 4 + 4 + 4); // type argument, class id, upgrade level, upgrade points
            bool armorOrWeapon = type is 0 or 1;
            for (int d = 0; d < 3; d++)
            {
                uint deco = reader.ReadUInt32();
                if (armorOrWeapon) AddSlotted(deco);
            }
            reader.BaseStream.Position = start + EquipmentEntrySize;
        }

        Skip(reader, 0x4AD29);
        for (int i = 0; i < MantleEntries; i++)
        {
            Skip(reader, 4); // id
            if (reader.ReadUInt32() == 0)
            {
                Skip(reader, 118);
                continue;
            }
            Skip(reader, 4);
            for (int d = 0; d < 3; d++) AddSlotted(reader.ReadUInt32());
            Skip(reader, 102);
        }
        Skip(reader, 0x539EF);

        if (playtime == 0)
            return null;
        if (!layoutOk)
            throw new FormatException("This save's layout isn't one MHBuilder recognizes (it may be from a different game version).");

        return new SaveSlotDecorations(slot, name, hr, mr, playtime, counts, inBox, slotted, unknown);
    }

    private static void Add(Dictionary<int, int> counts, int id, int qty) =>
        counts[id] = counts.GetValueOrDefault(id) + qty;

    private static void Skip(BinaryReader reader, long count) =>
        reader.BaseStream.Seek(count, SeekOrigin.Current);
}
