using MHBuilder.Models;

namespace MHBuilder.Catalog;

/// <summary>
/// Passive defense / resistance bonuses from Defense Boost and the five elemental resistance skills. Levels are
/// passed in <see cref="SkillIds"/> order: Defense Boost, then fire, water, thunder, ice, dragon resistance.
/// </summary>
public sealed class StatBonuses
{
    public const int Count = 6;

    private static readonly int[] BoostPercent = [0, 0, 0, 5, 5, 8, 8, 10];
    private static readonly int[] BoostFlat = [0, 5, 10, 10, 20, 20, 35, 35];
    private static readonly int[] BoostResist = [0, 0, 0, 0, 3, 3, 5, 5];
    private static readonly int[] ElementResist = [0, 6, 12, 20];
    private const int ElementMaxDefense = 10;

    private static readonly string[] Names =
        ["Defense Boost", "Fire Resistance", "Water Resistance", "Thunder Resistance", "Ice Resistance", "Dragon Resistance"];

    /// <summary>Skill ids in level order; -1 when the catalog lacks the skill.</summary>
    public int[] SkillIds { get; }

    /// <summary>Highest level each table covers.</summary>
    public static ReadOnlySpan<int> MaxLevels => [7, 3, 3, 3, 3, 3];

    public StatBonuses(IReadOnlyDictionary<string, SkillInfo> skillsByName) =>
        SkillIds = Names.Select(n => skillsByName.TryGetValue(n, out var s) ? s.Id : -1).ToArray();

    private static int Level(ReadOnlySpan<int> levels, int i) => Math.Clamp(levels[i], 0, MaxLevels[i]);

    /// <summary>Defense Boost's percentage, and the flat defense from every bonus skill.</summary>
    public static (int Percent, int Flat) DefenseTerms(ReadOnlySpan<int> levels)
    {
        int boost = Level(levels, 0);
        int flat = BoostFlat[boost];
        for (int i = 1; i < Count; i++)
            if (Level(levels, i) >= ElementResist.Length - 1) flat += ElementMaxDefense;
        return (BoostPercent[boost], flat);
    }

    public static int Defense(int armor, (int Percent, int Flat) terms) => armor * (100 + terms.Percent) / 100 + terms.Flat;

    /// <summary>Resistance added to one element (0 = fire … 4 = dragon).</summary>
    public static int ResistBonus(ReadOnlySpan<int> levels, int element) =>
        BoostResist[Level(levels, 0)] + ElementResist[Level(levels, element + 1)];

    public static (int Defense, ElementalResists Resistances) Apply(int armor, ElementalResists resists, ReadOnlySpan<int> levels) =>
        (Defense(armor, DefenseTerms(levels)),
            resists.Add(new ElementalResists(
                ResistBonus(levels, 0), ResistBonus(levels, 1), ResistBonus(levels, 2), ResistBonus(levels, 3), ResistBonus(levels, 4))));

    /// <summary>Armor totals plus the bonuses at these final (already capped) skill levels.</summary>
    public (int Defense, ElementalResists Resistances) Apply(int armor, ElementalResists resists, IReadOnlyDictionary<int, int> skills)
    {
        Span<int> levels = stackalloc int[Count];
        for (int i = 0; i < Count; i++)
            levels[i] = SkillIds[i] < 0 ? 0 : skills.GetValueOrDefault(SkillIds[i]);
        return Apply(armor, resists, levels);
    }
}
