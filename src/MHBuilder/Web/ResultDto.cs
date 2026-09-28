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

        // The skill a set effect adds to the wanted list when clicked: the granted skill, or the capped skill at its raised max.
        (int? SkillId, int Level, string Label) EffectSkill(SetBonusThreshold? th, string effect)
        {
            if (th?.GrantsSkillId is int gid && gid > 0 && cat.SkillsById.TryGetValue(gid, out var granted))
            {
                int level = Math.Max(1, th.GrantsLevel);
                string skill = granted.MaxLevel > 1 ? $"{granted.Name} {level}" : granted.Name;
                string label = th.EffectName is { Length: > 0 } en && !en.Equals(granted.Name, StringComparison.OrdinalIgnoreCase)
                    ? $"{en} ({skill})"
                    : skill;
                return (gid, level, label);
            }
            if (th?.RaisesCapForSkillId is int capId && capId > 0 && cat.SkillsById.TryGetValue(capId, out var capped))
                return (capId, capped.MaxLevel, effect);
            return (null, 0, effect);
        }

        return new
        {
            defense = r.Defense,
            resistances = Resists(r.Resistances),
            armorDefense = r.ArmorDefense,
            armorResistances = Resists(r.ArmorResistances ?? r.Resistances),
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
            head = Piece(r.Head, cat),
            chest = Piece(r.Chest, cat),
            gloves = Piece(r.Gloves, cat),
            waist = Piece(r.Waist, cat),
            legs = Piece(r.Legs, cat),
            charm = r.Charm.Name,
            charmInfo = new { id = r.Charm.CharmId, r.Charm.Level, r.Charm.Name, r.Charm.Rarity, skills = CatalogEndpoints.SkillList(cat, r.Charm.Skills) },
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
                iconColor = p.Decoration.IconColor,
                skills = CatalogEndpoints.SkillList(cat, p.Decoration.Skills)
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
                            var (skillId, level, label) = EffectSkill(th, x.Effect);
                            return new { parts = x.RequiredParts, effect = label, skillId, level, wanted = wantedFx, extra = !wantedFx };
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

    private static object Piece(ArmorPiece p, GameCatalog cat) => new
    {
        p.Id,
        p.Name,
        slots = p.Slots,
        skills = CatalogEndpoints.SkillList(cat, p.Skills),
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
