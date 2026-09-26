namespace MHBuilder.Catalog;

/// <summary>
/// Virtual skill ids for pure set-bonus effects (Good Luck, Sizzling Gift, …).
/// Ids are assigned at catalog load: Base + index.
/// </summary>
public static class SetEffectIds
{
    public const int Base = 2_000_000;

    public static bool IsVirtual(int id) => id >= Base;

    public static int EncodeIndex(int index)
    {
        if (index < 0) throw new ArgumentOutOfRangeException(nameof(index));
        return Base + index;
    }

    public static bool TryDecodeIndex(int id, out int index)
    {
        index = 0;
        if (id < Base) return false;
        index = id - Base;
        return true;
    }
}
