using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Web;

public sealed class SearchApiRequest
{
    public const int MaxTimeLimitMs = 60_000;

    public List<SkillLevelDto>? Skills { get; set; }
    public int[]? WeaponSlots { get; set; }
    public int? WeaponId { get; set; }
    public List<int>? ExcludeArmorIds { get; set; }
    public List<OwnedDecoDto>? OwnedDecorations { get; set; }
    public bool? UnlimitedDecorations { get; set; } = true;
    public string? MinRank { get; set; } = "master";
    public string? Gender { get; set; }
    public List<int>? ArmorRarities { get; set; }
    public List<int>? ExcludedSkillIds { get; set; }
    public Dictionary<string, int>? PinnedArmor { get; set; }
    public CharmRefDto? PinnedCharm { get; set; }
    public List<CharmRefDto>? ExcludedCharms { get; set; }
    public StatMinimumsDto? Minimums { get; set; }
    public List<int>? MinFreeSlots { get; set; }
    public int MaxResults { get; set; } = 100;
    public int MaxCandidatesPerSlot { get; set; } = 50;
    public int TimeLimitMs { get; set; } = 15_000;

    public SearchRequest ToSearchRequest(GameCatalog? catalog = null)
    {
        var wanted = new Dictionary<int, int>();
        foreach (var s in Skills ?? [])
        {
            if (s.Level < 1) continue;
            wanted[s.Id] = s.Level;
        }

        // Limited with an empty list means no jewels at all, not unlimited.
        Dictionary<int, int>? owned = null;
        if (UnlimitedDecorations != true)
            owned = (OwnedDecorations ?? []).Where(x => x.Count > 0)
                .GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.Sum(x => x.Count));

        return new SearchRequest(
            wanted,
            WeaponSlots ?? [],
            MinRank ?? "master",
            MaxResults <= 0 ? 100 : Math.Min(MaxResults, 100),
            MaxCandidatesPerSlot <= 0 ? 50 : Math.Min(MaxCandidatesPerSlot, 100),
            TimeLimitMs <= 0 ? 15_000 : Math.Min(TimeLimitMs, MaxTimeLimitMs),
            ExcludeArmorIds is { Count: > 0 } ? ExcludeArmorIds.Select(id => catalog?.CanonicalArmorId(id) ?? id).ToHashSet() : null,
            owned,
            WeaponId,
            null,
            Gender,
            ArmorRarities is { Count: > 0 } ? ArmorRarities.ToHashSet() : null,
            ExcludedSkillIds is { Count: > 0 } ? ExcludedSkillIds.ToHashSet() : null,
            ArmorSlots.Parse(PinnedArmor) is { Count: > 0 } pinned ? pinned : null,
            PinnedCharm is { } pc ? (pc.Id, pc.Level) : null,
            ExcludedCharms is { Count: > 0 } ? ExcludedCharms.Select(c => (c.Id, c.Level)).ToHashSet() : null,
            Minimums is { } m && new StatMinimums(m.Defense, m.Fire, m.Water, m.Thunder, m.Ice, m.Dragon) is { Any: true } mins ? mins : null,
            ParseMinFreeSlots(MinFreeSlots));
    }

    /// <summary>[Lv1..Lv4] free-slot counts, clamped to 0..20; null when none are asked for.</summary>
    private static int[]? ParseMinFreeSlots(List<int>? raw)
    {
        if (raw is null) return null;
        var counts = Enumerable.Range(0, 4).Select(i => i < raw.Count ? Math.Clamp(raw[i], 0, 20) : 0).ToArray();
        return counts.Any(n => n > 0) ? counts : null;
    }
}

public sealed class MaterialsApiRequest
{
    public List<int>? ArmorIds { get; set; }
    public int? CharmId { get; set; }
    public int? CharmLevel { get; set; }
    public int? WeaponId { get; set; }
}

public sealed class BuildEvaluateRequest
{
    public List<SkillLevelDto>? Skills { get; set; }
    public int[]? WeaponSlots { get; set; }
    public Dictionary<string, int>? Armor { get; set; }
    public CharmRefDto? Charm { get; set; }
    public List<int>? DecorationIds { get; set; }
}

public sealed class StatMinimumsDto
{
    public int? Defense { get; set; }
    public int? Fire { get; set; }
    public int? Water { get; set; }
    public int? Thunder { get; set; }
    public int? Ice { get; set; }
    public int? Dragon { get; set; }
}

public sealed class CharmRefDto
{
    public int Id { get; set; }
    public int Level { get; set; }
}

public sealed class SkillLevelDto
{
    public int Id { get; set; }
    public int Level { get; set; }
}

public sealed class OwnedDecoDto
{
    public int Id { get; set; }
    public int Count { get; set; }
}

public static class ArmorSlots
{
    /// <summary>{"head": id, ...} from the client, keyed by slot; unknown slots and ids ≤ 0 are dropped.</summary>
    public static Dictionary<ArmorSlot, int> Parse(Dictionary<string, int>? bySlot)
    {
        var parsed = new Dictionary<ArmorSlot, int>();
        foreach (var (key, id) in bySlot ?? [])
        {
            if (id > 0 && Enum.TryParse<ArmorSlot>(key, true, out var slot))
                parsed[slot] = id;
        }
        return parsed;
    }
}
