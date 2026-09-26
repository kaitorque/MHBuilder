using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Web;

/// <summary>JSON shape of a set (search result or evaluated build) for the web UI.</summary>
public static class ResultDto
{
    public static object From(SearchResult r, GameCatalog cat, IReadOnlyDictionary<int, int> wanted)
    {
        var wantedSkills = wanted
            .Where(kv => !SetEffectIds.IsVirtual(kv.Key)
                && cat.SkillsById.TryGetValue(kv.Key, out var sk)
                && !sk.IsSetBonus)
            .ToDictionary(kv => kv.Key, kv => kv.Value);

        // (set bonus id, parts) pairs that satisfy a wanted set effect.
        var wantedEffectKeys = new HashSet<(int SetId, int Parts)>();
        foreach (var id in wanted.Keys)
        {
            if (!cat.SetEffectsById.TryGetValue(id, out var effect)) continue;
            foreach (var src in effect.Sources)
                wantedEffectKeys.Add((src.SetBonusId, src.RequiredParts));
        }

        bool EffectWanted(int setBonusId, SetBonusThreshold th)
        {
            if (wantedEffectKeys.Contains((setBonusId, th.RequiredParts)))
                return true;
            if (th.GrantsSkillId is int gid && wantedSkills.ContainsKey(gid))
                return true;
            if (th.RaisesCapForSkillId is int capId
                && wantedSkills.TryGetValue(capId, out var need)
                && need > cat.BaseMaxLevel(capId))
                return true;
            return th.RaisesAllCaps && wantedSkills.Any(kv => kv.Value > cat.BaseMaxLevel(kv.Key));
        }

        return new
        {
            defense = r.Defense,
            resistances = Resists(r.Resistances),
            weapon = r.WeaponName,
            weaponId = r.WeaponId,
            weaponType = r.WeaponType,
            weaponRarity = r.WeaponRarity,
            weaponSlots = r.WeaponSlots,
            remainingSlots = r.RemainingSlots,
            freeSlots = r.RemainingSlots
                .Where(s => s > 0)
                .GroupBy(s => s)
                .OrderByDescending(g => g.Key)
                .Select(g => new { slotSize = g.Key, count = g.Count() }),
            head = Piece(r.Head),
            chest = Piece(r.Chest),
            gloves = Piece(r.Gloves),
            waist = Piece(r.Waist),
            legs = Piece(r.Legs),
            charm = r.Charm.Name,
            charmInfo = new { id = r.Charm.CharmId, r.Charm.Level, r.Charm.Name, r.Charm.Rarity },
            decorations = r.Decorations
                .GroupBy(d => d.Id)
                .Select(g =>
                {
                    var d = g.First();
                    return new { d.Id, d.Name, count = g.Count(), slotSize = d.SlotSize, d.Rarity, iconColor = d.IconColor };
                }),
            decorationPlacements = r.DecorationPlacements.Select(p => new
            {
                location = p.Location,
                slotSize = p.SlotSize,
                id = p.Decoration.Id,
                name = p.Decoration.Name,
                decoSlotSize = p.Decoration.SlotSize,
                rarity = p.Decoration.Rarity,
                iconColor = p.Decoration.IconColor
            }),
            setBonuses = (r.SetBonuses ?? [])
                .GroupBy(s => s.Id)
                .Select(g =>
                {
                    var first = g.First();
                    cat.SetBonusesById.TryGetValue(first.Id, out var bonusInfo);
                    var effects = g
                        .OrderBy(x => x.RequiredParts)
                        .Select(x =>
                        {
                            var th = bonusInfo?.Thresholds.FirstOrDefault(t => t.RequiredParts == x.RequiredParts);
                            bool wantedFx = th is not null && EffectWanted(first.Id, th);
                            return new { parts = x.RequiredParts, effect = x.Effect, wanted = wantedFx, extra = !wantedFx };
                        })
                        .ToList();
                    return new
                    {
                        id = first.Id,
                        name = first.Name,
                        pieces = g.Max(x => x.Pieces),
                        wanted = effects.Any(e => e.wanted),
                        effects
                    };
                })
                .OrderByDescending(s => s.wanted)
                .ThenBy(s => s.name),
            skills = r.FinalSkills
                .Where(kv => kv.Value > 0)
                .Select(kv =>
                {
                    bool isWanted = wantedSkills.TryGetValue(kv.Key, out var wantLvl);
                    int level = kv.Value;
                    var skill = cat.SkillsById.GetValueOrDefault(kv.Key);
                    return new
                    {
                        id = kv.Key,
                        name = skill?.Name ?? $"#{kv.Key}",
                        level,
                        maxLevel = skill?.MaxLevel ?? level,
                        baseMaxLevel = skill?.BaseMaxLevel ?? level,
                        wanted = isWanted,
                        wantedLevel = isWanted ? wantLvl : (int?)null,
                        bonusLevel = isWanted ? Math.Max(0, level - wantLvl) : 0,
                        extra = !isWanted
                    };
                })
                .OrderByDescending(s => s.wanted)
                .ThenByDescending(s => s.level)
                .ThenBy(s => s.name)
        };
    }

    private static object Piece(ArmorPiece p) => new
    {
        p.Id,
        p.Name,
        slots = p.Slots,
        p.DefenseMax,
        p.Rarity,
        gender = p.Gender,
        resistances = Resists(p.Resistances),
        set = p.ArmorSetName
    };

    public static object Resists(ElementalResists r) => new
    {
        fire = r.Fire,
        water = r.Water,
        thunder = r.Thunder,
        ice = r.Ice,
        dragon = r.Dragon
    };
}
