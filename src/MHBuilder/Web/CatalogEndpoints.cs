using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Web;

/// <summary>Read-only catalog lookups: skills, armor, weapons, charms and decorations.</summary>
public static class CatalogEndpoints
{
    public static void MapCatalogEndpoints(this WebApplication app)
    {
        var catalog = app.Services.GetRequiredService<GameCatalog>();
        // The catalog never changes while running, so the skill list is built once.
        var skillRows = BuildSkillRows(catalog);

        app.MapGet("/api/meta", (GameCatalog cat) => Results.Json(new
        {
            skills = cat.Skills.Count,
            armor = cat.Armor.Count,
            charms = cat.Charms.Count,
            decorations = cat.Decorations.Count,
            weapons = cat.Weapons.Count
        }));

        app.MapGet("/api/skills", () => Results.Json(skillRows));

        app.MapGet("/api/skill-categories", () => Results.Json(SkillCategories.Order));

        app.MapGet("/api/decorations", (GameCatalog cat) =>
            Results.Json(cat.Decorations
                .OrderBy(d => d.SlotSize).ThenBy(d => d.Name)
                .Select(d =>
                {
                    var skillNames = d.Skills.Select(s => SkillName(cat, s.SkillId)).ToArray();
                    bool seriesSpecific = skillNames.Any(SkillCategories.IsSetSkill)
                        || d.Skills.Any(s => cat.SetBonusesGrantingSkill.ContainsKey(s.SkillId));
                    return new
                    {
                        d.Id,
                        d.Name,
                        d.SlotSize,
                        d.Rarity,
                        iconColor = d.IconColor,
                        seriesSpecific,
                        skills = SkillList(cat, d.Skills)
                    };
                })));

        app.MapGet("/api/armor", (GameCatalog cat, string? q, string? slot, int limit = 80) =>
        {
            IEnumerable<ArmorPiece> list = cat.Armor;
            if (!string.IsNullOrWhiteSpace(slot) && Enum.TryParse<ArmorSlot>(slot, true, out var parsed))
                list = list.Where(a => a.Slot == parsed);
            if (!string.IsNullOrWhiteSpace(q))
                list = list.Where(a => a.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
            return Results.Json(list
                .OrderByDescending(a => a.Rarity).ThenBy(a => a.Name)
                .Take(Math.Clamp(limit, 1, 1000))
                .Select(a => new
                {
                    a.Id,
                    a.Name,
                    slot = a.Slot.ToString().ToLowerInvariant(),
                    a.Rank,
                    a.Rarity,
                    a.DefenseMax,
                    gender = a.Gender,
                    resistances = ResultDto.Resists(a.Resistances),
                    slots = a.Slots,
                    set = a.ArmorSetName,
                    skills = SkillList(cat, a.Skills)
                }));
        });

        app.MapGet("/api/weapons", (GameCatalog cat, string? q, string? type, int limit = 80) =>
        {
            IEnumerable<WeaponInfo> list = cat.Weapons;
            if (!string.IsNullOrWhiteSpace(type))
                list = list.Where(w => w.Type.Equals(type, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(q))
                list = list.Where(w => w.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
            return Results.Json(list
                .OrderByDescending(w => w.Rarity).ThenBy(w => w.Name)
                .Take(Math.Clamp(limit, 1, 5000))
                .Select(w => new { w.Id, w.Name, w.Type, w.Rarity, slots = w.Slots, w.Damage, w.Affinity }));
        });

        app.MapGet("/api/weapon-types", (GameCatalog cat) =>
            Results.Json(cat.Weapons.Select(w => w.Type).Distinct().OrderBy(x => x)));

        app.MapGet("/api/charms", (GameCatalog cat) =>
            Results.Json(cat.Charms
                .OrderByDescending(c => c.Rarity).ThenBy(c => c.Name)
                .Select(c => new { id = c.CharmId, c.Name, c.Level, c.Rarity, skills = SkillList(cat, c.Skills) })));
    }

    private static string SkillName(GameCatalog cat, int skillId) =>
        cat.SkillsById.TryGetValue(skillId, out var sk) ? sk.Name : $"#{skillId}";

    private static IEnumerable<object> SkillList(GameCatalog cat, IEnumerable<SkillPoint> skills) =>
        skills.Select(s => new { s.SkillId, name = SkillName(cat, s.SkillId), s.Level });

    /// <summary>
    /// Every pickable skill (plus set effects as pseudo-skills) with where it comes from: jewels, charms, armor and
    /// set bonuses, and the text the skill picker searches.
    /// </summary>
    private static List<object> BuildSkillRows(GameCatalog cat)
    {
        var jewelsBySkill = cat.Decorations
            .SelectMany(d => d.Skills.Select(s => (s.SkillId, d)))
            .GroupBy(x => x.SkillId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.d).DistinctBy(d => d.Id)
                    .OrderBy(d => d.SlotSize).ThenBy(d => d.Name)
                    .Select(d => new { d.Id, d.Name, slotSize = d.SlotSize, d.Rarity, iconColor = d.IconColor })
                    .ToList());

        var charmsBySkill = cat.Charms
            .SelectMany(c => c.Skills.Select(s => (s.SkillId, c)))
            .GroupBy(x => x.SkillId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.c).DistinctBy(c => c.CharmId)
                    .OrderByDescending(c => c.Rarity).ThenByDescending(c => c.Level)
                    .Select(c => new { id = c.CharmId, c.Name, c.Level, c.Rarity })
                    .ToList());

        var armorBySkill = cat.Armor
            .SelectMany(a => a.Skills.Select(s => (s.SkillId, a)))
            .GroupBy(x => x.SkillId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.a).DistinctBy(a => a.Id)
                    .OrderByDescending(a => a.Rarity)
                    .ThenBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(a => new { a.Id, a.Name, slot = a.Slot.ToString().ToLowerInvariant(), a.Rarity })
                    .ToList());

        var setBonusRarity = cat.Armor
            .SelectMany(a => a.SetSkillIds.Select(id => (id, a.Rarity)))
            .GroupBy(x => x.id)
            .ToDictionary(g => g.Key, g => g.Max(x => x.Rarity));
        int SetRarity(int setBonusId) => setBonusRarity.GetValueOrDefault(setBonusId, 1);

        var setsBySkill = new Dictionary<int, List<(int Id, string Name, int Parts, string? Effect, string Kind)>>();
        void AddSet(int skillId, int setId, string setName, int parts, string? effect, string kind)
        {
            if (!setsBySkill.TryGetValue(skillId, out var list))
                setsBySkill[skillId] = list = [];
            list.Add((setId, setName, parts, effect, kind));
        }

        foreach (var bonus in cat.SetBonuses)
        {
            foreach (var th in bonus.Thresholds)
            {
                if (th.GrantsSkillId is int gid && gid > 0)
                {
                    string? effect = string.IsNullOrEmpty(th.EffectName)
                        ? cat.SkillsById.TryGetValue(gid, out var sk) ? sk.Name : null
                        : th.EffectName;
                    AddSet(gid, bonus.Id, bonus.Name, th.RequiredParts, effect, "grant");
                }
                if (th.RaisesCapForSkillId is int capId && capId > 0)
                    AddSet(capId, bonus.Id, bonus.Name, th.RequiredParts, th.EffectName ?? "Secret", "cap");
            }
        }

        static string SearchText(IEnumerable<string?> bits) =>
            string.Join(' ', bits.Where(b => !string.IsNullOrEmpty(b)).Distinct(StringComparer.OrdinalIgnoreCase));

        var rows = new List<(string SortName, object Row)>();
        foreach (var s in cat.Skills.Where(s => !s.IsSetBonus && s.MaxLevel > 0))
        {
            setsBySkill.TryGetValue(s.Id, out var sets);
            jewelsBySkill.TryGetValue(s.Id, out var jewels);
            charmsBySkill.TryGetValue(s.Id, out var charms);
            armorBySkill.TryGetValue(s.Id, out var armor);
            bool isSetSkill = SkillCategories.IsSetSkill(s.Name);
            bool fromSet = sets is { Count: > 0 } || isSetSkill;
            bool seriesOnly = isSetSkill && (jewels is null || jewels.Count == 0);
            var categories = SkillCategories.ClassifyAll(s.Name, includeSetTab: fromSet);
            var setDtos = (sets ?? [])
                .Select(x => new { id = x.Id, name = x.Name, parts = x.Parts, effect = x.Effect, kind = x.Kind, rarity = SetRarity(x.Id) })
                .ToList();
            var searchBits = new List<string?> { s.Name };
            foreach (var x in setDtos) searchBits.AddRange([x.name, x.effect]);
            searchBits.AddRange((charms ?? []).Select(c => c.Name));
            searchBits.AddRange((armor ?? []).Select(a => a.Name));
            rows.Add((s.Name, new
            {
                s.Id,
                s.Name,
                s.Description,
                levelDescriptions = s.LevelDescriptions ?? [],
                s.MaxLevel,
                s.BaseMaxLevel,
                category = categories[0],
                categories,
                setSkill = seriesOnly || (fromSet && isSetSkill),
                setEffect = false,
                sets = setDtos,
                jewels = jewels ?? [],
                charms = charms ?? [],
                armor = armor ?? [],
                searchText = SearchText(searchBits)
            }));
        }

        foreach (var effect in cat.SetEffects)
        {
            var setDtos = effect.Sources
                .Select(s => new
                {
                    id = s.SetBonusId,
                    name = s.SetName,
                    parts = s.RequiredParts,
                    effect = effect.Name,
                    kind = "effect",
                    rarity = SetRarity(s.SetBonusId)
                })
                .ToList();
            rows.Add((effect.Name, new
            {
                Id = effect.VirtualId,
                Name = effect.Name,
                Description = effect.Description,
                levelDescriptions = Array.Empty<string?>(),
                MaxLevel = 1,
                BaseMaxLevel = 1,
                category = "Set",
                categories = new[] { "Set" },
                setSkill = true,
                setEffect = true,
                sets = setDtos,
                jewels = Array.Empty<object>(),
                charms = Array.Empty<object>(),
                armor = Array.Empty<object>(),
                searchText = SearchText(effect.Sources.Select(s => s.SetName).Prepend(effect.Name))
            }));
        }

        return rows
            .OrderBy(r => r.SortName, StringComparer.OrdinalIgnoreCase)
            .Select(r => r.Row)
            .ToList();
    }
}
