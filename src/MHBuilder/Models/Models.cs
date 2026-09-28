namespace MHBuilder.Models;

public enum ArmorSlot
{
    Head,
    Chest,
    Gloves,
    Waist,
    Legs
}

public sealed record SkillInfo(
    int Id,
    string Name,
    int MaxLevel,
    int BaseMaxLevel,
    bool IsSetBonus = false,
    string? Description = null,
    IReadOnlyList<string?>? LevelDescriptions = null);

public sealed record SetBonusThreshold(
    int RequiredParts,
    int? GrantsSkillId,
    int GrantsLevel,
    int? RaisesCapForSkillId = null,
    bool RaisesAllCaps = false,
    string? EffectName = null,
    string? Description = null);

public sealed record SetBonusInfo(
    int Id,
    string Name,
    IReadOnlyList<SetBonusThreshold> Thresholds);

/// <summary>Pure set effect (no regular skill id), e.g. Good Luck from several sets.</summary>
public sealed record SetEffectInfo(
    int VirtualId,
    string Name,
    IReadOnlyList<SetEffectSource> Sources,
    string? Description = null);

public sealed record SetEffectSource(
    int SetBonusId,
    string SetName,
    int RequiredParts);

public sealed record ActiveSetBonus(
    int Id,
    string Name,
    int Pieces,
    int RequiredParts,
    string Effect);

public sealed record SkillPoint(int SkillId, int Level);

public sealed record ElementalResists(int Fire, int Water, int Thunder, int Ice, int Dragon)
{
    public static ElementalResists Zero { get; } = new(0, 0, 0, 0, 0);

    public ElementalResists Add(ElementalResists other) => new(
        Fire + other.Fire,
        Water + other.Water,
        Thunder + other.Thunder,
        Ice + other.Ice,
        Dragon + other.Dragon);
}

/// <summary>
/// Search floors for the set's totals (armor plus Defense Boost / resistance skill bonuses); null means no floor.
/// Resistances may be negative.
/// </summary>
public sealed record StatMinimums(int? Defense, int? Fire, int? Water, int? Thunder, int? Ice, int? Dragon)
{
    public const int Count = 6;

    /// <summary>Floors in <see cref="Stat"/> order: defense, fire, water, thunder, ice, dragon.</summary>
    public int?[] ToArray() => [Defense, Fire, Water, Thunder, Ice, Dragon];

    public bool Any => ToArray().Any(v => v is not null);

    public static int Stat(ArmorPiece p, int k) => k switch
    {
        0 => p.DefenseMax,
        1 => p.Resistances.Fire,
        2 => p.Resistances.Water,
        3 => p.Resistances.Thunder,
        4 => p.Resistances.Ice,
        _ => p.Resistances.Dragon,
    };

    public static int Stat(int defense, ElementalResists r, int k) => k switch
    {
        0 => defense,
        1 => r.Fire,
        2 => r.Water,
        3 => r.Thunder,
        4 => r.Ice,
        _ => r.Dragon,
    };

    public bool MetBy(int defense, ElementalResists resists)
    {
        var floors = ToArray();
        for (int k = 0; k < Count; k++)
            if (floors[k] is int min && Stat(defense, resists, k) < min)
                return false;
        return true;
    }
}

public sealed record ArmorPiece(
    int Id,
    string Name,
    ArmorSlot Slot,
    string Rank,
    int Rarity,
    int DefenseMax,
    ElementalResists Resistances,
    int[] Slots,
    SkillPoint[] Skills,
    int? ArmorSetId,
    string? ArmorSetName,
    int[] SetSkillIds,
    string? Gender = null);

public sealed record CharmRank(
    int CharmId,
    string Name,
    int Level,
    int Rarity,
    SkillPoint[] Skills);

public sealed record Decoration(
    int Id,
    string Name,
    int SlotSize,
    int Rarity,
    string IconColor,
    SkillPoint[] Skills,
    // Id save data uses for a jewel slotted in gear or a mantle (the item box uses Id).
    int? EquipmentId = null);

public sealed record WeaponInfo(
    int Id,
    string Name,
    string Type,
    int Rarity,
    int[] Slots,
    int Damage,
    int Affinity);

public sealed record SearchRequest(
    IReadOnlyDictionary<int, int> WantedSkills,
    int[] WeaponSlots,
    string MinRank = "master",
    int MaxResults = 30,
    int MaxCandidatesPerSlot = 50,
    int TimeLimitMs = 15_000,
    IReadOnlySet<int>? ExcludeArmorIds = null,
    IReadOnlyDictionary<int, int>? OwnedDecorations = null,
    int? WeaponId = null,
    string? WeaponName = null,
    string? Gender = null,
    IReadOnlySet<int>? ArmorRarities = null,
    IReadOnlySet<int>? ExcludedSkillIds = null,
    IReadOnlyDictionary<ArmorSlot, int>? PinnedArmor = null,
    (int CharmId, int Level)? PinnedCharm = null,
    IReadOnlySet<(int CharmId, int Level)>? ExcludedCharms = null,
    StatMinimums? Minimums = null,
    // [Lv1, Lv2, Lv3, Lv4] counts of empty slots (of at least that size) the set must keep after decorations.
    int[]? MinFreeSlots = null,
    // False: the best MaxResults sets (defense, then free slots). True: any MaxResults sets, stopping early (feasibility probes).
    bool StopAtFirstResults = false);

/// <summary>TimedOut: the search stopped at its time limit, so better sets may exist. Threads: workers used.</summary>
public sealed record SearchOutcome(IReadOnlyList<SearchResult> Results, bool TimedOut, int Threads);

public sealed record DecorationPlacement(
    Decoration Decoration,
    string Location,
    int SlotSize);

public sealed record SearchResult(
    ArmorPiece Head,
    ArmorPiece Chest,
    ArmorPiece Gloves,
    ArmorPiece Waist,
    ArmorPiece Legs,
    CharmRank Charm,
    IReadOnlyList<Decoration> Decorations,
    IReadOnlyList<DecorationPlacement> DecorationPlacements,
    IReadOnlyDictionary<int, int> FinalSkills,
    int Defense,
    ElementalResists Resistances,
    int[] RemainingSlots,
    string? WeaponName = null,
    int[]? WeaponSlots = null,
    string? WeaponType = null,
    int? WeaponRarity = null,
    IReadOnlyList<ActiveSetBonus>? SetBonuses = null,
    int? WeaponId = null,
    // Armor alone; Defense / Resistances add the Defense Boost and resistance skill bonuses.
    int ArmorDefense = 0,
    ElementalResists? ArmorResistances = null);
