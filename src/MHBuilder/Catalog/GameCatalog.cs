using System.Text.Json;
using MHBuilder.Models;

namespace MHBuilder.Catalog;

public sealed class GameCatalog
{
    public IReadOnlyList<SkillInfo> Skills { get; }
    public IReadOnlyDictionary<int, SkillInfo> SkillsById { get; }
    public IReadOnlyDictionary<string, SkillInfo> SkillsByName { get; }
    public IReadOnlyList<SetBonusInfo> SetBonuses { get; }
    public IReadOnlyDictionary<int, SetBonusInfo> SetBonusesById { get; }
    /// <summary>Pure set effects grouped by effect name (Good Luck, Sizzling Gift, …).</summary>
    public IReadOnlyList<SetEffectInfo> SetEffects { get; }
    public IReadOnlyDictionary<int, SetEffectInfo> SetEffectsById { get; }
    /// <summary>Regular skill id → set bonuses that can grant it.</summary>
    public IReadOnlyDictionary<int, IReadOnlyList<(int SetBonusId, int RequiredParts, int GrantsLevel)>> SetBonusesGrantingSkill { get; }
    /// <summary>Skill id → set bonuses that raise its soft cap (e.g. Divine Blessing Secret).</summary>
    public IReadOnlyDictionary<int, IReadOnlyList<(int SetBonusId, int RequiredParts, string EffectName)>> CapRaisersForSkill { get; }
    /// <summary>Set bonuses that raise all soft caps (Fatalis Inheritance).</summary>
    public IReadOnlyList<(int SetBonusId, int RequiredParts, string EffectName)> CapRaisersAll { get; }
    public IReadOnlyList<ArmorPiece> Armor { get; }
    /// <summary>Also resolves ids of pieces folded into an identical set (see <see cref="MergeIdenticalSets"/>).</summary>
    public IReadOnlyDictionary<int, ArmorPiece> ArmorById { get; }
    public IReadOnlyList<CharmRank> Charms { get; }
    /// <summary>Every rank of each charm (lowest first); <see cref="Charms"/> keeps only the top rank.</summary>
    public IReadOnlyDictionary<int, IReadOnlyList<CharmRank>> CharmRanksById { get; }
    public IReadOnlyList<Decoration> Decorations { get; }
    public IReadOnlyDictionary<int, Decoration> DecorationsById { get; }
    public IReadOnlyList<WeaponInfo> Weapons { get; }
    public IReadOnlyDictionary<int, WeaponInfo> WeaponsById { get; }

    private GameCatalog(
        List<SkillInfo> skills,
        List<SetBonusInfo> setBonuses,
        List<SetEffectInfo> setEffects,
        List<ArmorPiece> armor,
        IReadOnlyDictionary<int, ArmorPiece> armorAliases,
        List<CharmRank> charms,
        List<CharmRank> allCharmRanks,
        List<Decoration> decorations,
        List<WeaponInfo> weapons)
    {
        Skills = skills;
        SkillsById = skills.ToDictionary(s => s.Id);
        SkillsByName = skills.ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
        SetBonuses = setBonuses;
        SetBonusesById = setBonuses.ToDictionary(s => s.Id);
        SetEffects = setEffects;
        SetEffectsById = setEffects.ToDictionary(e => e.VirtualId);
        SetBonusesGrantingSkill = setBonuses
            .SelectMany(sb => sb.Thresholds
                .Where(t => t.GrantsSkillId is > 0)
                .Select(t => (SkillId: t.GrantsSkillId!.Value, sb.Id, t.RequiredParts, t.GrantsLevel)))
            .GroupBy(x => x.SkillId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<(int, int, int)>)g.Select(x => (x.Id, x.RequiredParts, x.GrantsLevel)).ToList());
        CapRaisersForSkill = setBonuses
            .SelectMany(sb => sb.Thresholds
                .Where(t => t.RaisesCapForSkillId is > 0)
                .Select(t => (
                    SkillId: t.RaisesCapForSkillId!.Value,
                    sb.Id,
                    t.RequiredParts,
                    t.EffectName ?? "Secret")))
            .GroupBy(x => x.SkillId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<(int, int, string)>)g
                    .Select(x => (x.Id, x.RequiredParts, x.Item4)).ToList());
        CapRaisersAll = setBonuses
            .SelectMany(sb => sb.Thresholds
                .Where(t => t.RaisesAllCaps)
                .Select(t => (sb.Id, t.RequiredParts, t.EffectName ?? "Inheritance")))
            .ToList();
        Armor = armor;
        var armorById = armor.ToDictionary(a => a.Id);
        foreach (var (id, piece) in armorAliases)
            armorById.TryAdd(id, piece);
        ArmorById = armorById;
        Charms = charms;
        CharmRanksById = allCharmRanks
            .GroupBy(c => c.CharmId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<CharmRank>)g.OrderBy(c => c.Level).ToList());
        Decorations = decorations;
        DecorationsById = decorations.ToDictionary(d => d.Id);
        Weapons = weapons;
        WeaponsById = weapons.GroupBy(w => w.Id).ToDictionary(g => g.Key, g => g.First());
    }

    public int BaseMaxLevel(int skillId)
    {
        if (SkillsById.TryGetValue(skillId, out var info) && info.BaseMaxLevel > 0)
            return info.BaseMaxLevel;
        return SkillsById.TryGetValue(skillId, out var s) ? s.MaxLevel : 0;
    }

    public int EffectiveMaxLevel(int skillId, bool raisedCap)
    {
        if (!SkillsById.TryGetValue(skillId, out var info) || info.MaxLevel <= 0)
            return 0;
        if (raisedCap || info.BaseMaxLevel >= info.MaxLevel)
            return info.MaxLevel;
        return info.BaseMaxLevel;
    }

    public int CapSkill(int skillId, int level, bool raisedCap = false)
    {
        int cap = EffectiveMaxLevel(skillId, raisedCap);
        if (cap > 0)
            return Math.Clamp(level, 0, cap);
        return Math.Max(0, level);
    }

    /// <summary>Which skill soft-caps are raised by the equipped armor set bonuses.</summary>
    public void ResolveRaisedCaps(
        IEnumerable<ArmorPiece> pieces,
        out HashSet<int> raisedSkillIds,
        out bool raisesAllCaps)
    {
        raisedSkillIds = new HashSet<int>();
        raisesAllCaps = false;

        var counts = new Dictionary<int, int>();
        foreach (var piece in pieces)
        {
            foreach (var sid in piece.SetSkillIds)
                counts[sid] = counts.GetValueOrDefault(sid) + 1;
        }

        foreach (var (setBonusId, pieceCount) in counts)
        {
            if (!SetBonusesById.TryGetValue(setBonusId, out var bonus))
                continue;
            foreach (var th in bonus.Thresholds)
            {
                if (pieceCount < th.RequiredParts)
                    continue;
                if (th.RaisesAllCaps)
                    raisesAllCaps = true;
                if (th.RaisesCapForSkillId is int sid && sid > 0)
                    raisedSkillIds.Add(sid);
            }
        }
    }

    public static GameCatalog Load(string dataDirectory)
    {
        var skillsRaw = ReadArray(Path.Combine(dataDirectory, "skills.json"));
        var armorRaw = ReadArray(Path.Combine(dataDirectory, "armor.json"));
        var charmsRaw = ReadArray(Path.Combine(dataDirectory, "charms.json"));
        var decoRaw = ReadArray(Path.Combine(dataDirectory, "decorations.json"));

        var skills = new List<SkillInfo>();
        var setBonuses = new List<SetBonusInfo>();
        foreach (var s in skillsRaw.EnumerateArray())
        {
            int id = s.GetProperty("id").GetInt32();
            string name = s.GetProperty("name").GetString() ?? $"Skill {id}";
            bool isSetBonus = s.TryGetProperty("isSetBonus", out var sb) && sb.ValueKind == JsonValueKind.True;

            if (isSetBonus)
            {
                var thresholds = new List<SetBonusThreshold>();
                if (s.TryGetProperty("ranks", out var ranks))
                {
                    foreach (var r in ranks.EnumerateArray())
                    {
                        int parts = r.TryGetProperty("requiredParts", out var rp)
                            ? rp.GetInt32()
                            : r.GetProperty("level").GetInt32();
                        int? grantId = null;
                        int grantLevel = 1;
                        if (r.TryGetProperty("grantsSkill", out var gs) && gs.ValueKind == JsonValueKind.Number)
                        {
                            grantId = gs.GetInt32();
                            grantLevel = r.TryGetProperty("grantsLevel", out var gl) ? gl.GetInt32() : 1;
                        }
                        int? raisesCap = null;
                        if (r.TryGetProperty("raisesCapFor", out var rc) && rc.ValueKind == JsonValueKind.Number)
                            raisesCap = rc.GetInt32();
                        bool raisesAll = r.TryGetProperty("raisesAllCaps", out var ra)
                            && ra.ValueKind == JsonValueKind.True;
                        string? effectName = r.TryGetProperty("effectName", out var en)
                            ? en.GetString()
                            : null;
                        thresholds.Add(new SetBonusThreshold(
                            parts, grantId, grantLevel, raisesCap, raisesAll, effectName, ReadDescription(r)));
                    }
                }
                thresholds = thresholds.OrderBy(t => t.RequiredParts).ToList();
                int maxParts = thresholds.Count == 0 ? 1 : thresholds.Max(t => t.RequiredParts);
                setBonuses.Add(new SetBonusInfo(id, name, thresholds));
                skills.Add(new SkillInfo(id, name, maxParts, maxParts, true));
                continue;
            }

            int max = 0;
            if (s.TryGetProperty("maxLevel", out var maxEl) && maxEl.ValueKind == JsonValueKind.Number)
                max = maxEl.GetInt32();
            var levelDescs = new SortedDictionary<int, string?>();
            if (s.TryGetProperty("ranks", out var ranks2))
            {
                foreach (var r in ranks2.EnumerateArray())
                {
                    int level = r.GetProperty("level").GetInt32();
                    max = Math.Max(max, level);
                    levelDescs[level] = ReadDescription(r);
                }
            }
            int baseMax = max;
            if (s.TryGetProperty("baseMaxLevel", out var baseEl) && baseEl.ValueKind == JsonValueKind.Number)
                baseMax = baseEl.GetInt32();
            if (baseMax <= 0) baseMax = max;
            if (baseMax > max) baseMax = max;
            var levelDescriptions = Enumerable.Range(1, Math.Max(0, max))
                .Select(lv => levelDescs.GetValueOrDefault(lv))
                .ToList();
            skills.Add(new SkillInfo(id, name, max, baseMax, false, ReadDescription(s), levelDescriptions));
        }

        var armor = new List<ArmorPiece>();
        foreach (var a in armorRaw.EnumerateArray())
        {
            string type = a.GetProperty("type").GetString() ?? "";
            if (!TryParseSlot(type, out var slot))
                continue;

            var slots = a.TryGetProperty("slots", out var slotsEl)
                ? slotsEl.EnumerateArray().Select(x => x.GetProperty("rank").GetInt32()).OrderByDescending(x => x).ToArray()
                : Array.Empty<int>();

            var pieceSkills = ParseSkills(a.GetProperty("skills"));
            int defMax = a.GetProperty("defense").GetProperty("max").GetInt32();
            var resists = ElementalResists.Zero;
            if (a.TryGetProperty("resistances", out var resEl) && resEl.ValueKind == JsonValueKind.Object)
            {
                resists = new ElementalResists(
                    ReadResist(resEl, "fire"),
                    ReadResist(resEl, "water"),
                    ReadResist(resEl, "thunder"),
                    ReadResist(resEl, "ice"),
                    ReadResist(resEl, "dragon"));
            }
            int? setId = null;
            string? setName = null;
            if (a.TryGetProperty("armorSet", out var set) && set.ValueKind == JsonValueKind.Object)
            {
                setId = set.TryGetProperty("id", out var sid) && sid.ValueKind != JsonValueKind.Null
                    ? sid.GetInt32()
                    : null;
                setName = set.TryGetProperty("name", out var sn) ? sn.GetString() : null;
            }

            var setSkillIds = a.TryGetProperty("setSkills", out var ss) && ss.ValueKind == JsonValueKind.Array
                ? ss.EnumerateArray().Select(x => x.GetInt32()).ToArray()
                : Array.Empty<int>();

            string? gender = null;
            if (a.TryGetProperty("gender", out var genEl) && genEl.ValueKind == JsonValueKind.String)
            {
                gender = genEl.GetString()?.Trim().ToLowerInvariant();
                if (gender is not ("male" or "female"))
                    gender = null;
            }

            armor.Add(new ArmorPiece(
                a.GetProperty("id").GetInt32(),
                a.GetProperty("name").GetString() ?? "",
                slot,
                a.GetProperty("rank").GetString() ?? "",
                a.GetProperty("rarity").GetInt32(),
                defMax,
                resists,
                slots,
                pieceSkills,
                setId,
                setName,
                setSkillIds,
                gender));
        }
        var armorAliases = new Dictionary<int, ArmorPiece>();
        armor = MergeIdenticalSets(armor, armorAliases);

        // Group set effects that aren't a real skill (Good Luck, Inheritance…) by effect name,
        // so Good Luck from many sets → one pickable skill.
        var effectSources = new Dictionary<string, List<SetEffectSource>>(StringComparer.OrdinalIgnoreCase);
        var effectDescriptions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var bonus in setBonuses)
        {
            foreach (var th in bonus.Thresholds)
            {
                if (th.GrantsSkillId is > 0) continue;
                if (th.RaisesCapForSkillId is > 0) continue;
                string effectName = th.EffectName?.Trim() ?? "";
                if (effectName.Length == 0) continue;
                if (!string.IsNullOrEmpty(th.Description))
                    effectDescriptions.TryAdd(effectName, th.Description);
                if (!effectSources.TryGetValue(effectName, out var list))
                {
                    list = new List<SetEffectSource>();
                    effectSources[effectName] = list;
                }
                list.Add(new SetEffectSource(bonus.Id, bonus.Name, th.RequiredParts));
            }
        }

        var setEffects = effectSources
            .OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
            .Select((kv, i) => new SetEffectInfo(
                SetEffectIds.EncodeIndex(i),
                kv.Key,
                kv.Value
                    .OrderBy(s => s.RequiredParts)
                    .ThenBy(s => s.SetName, StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                effectDescriptions.GetValueOrDefault(kv.Key)))
            .ToList();

        var charms = new List<CharmRank>();
        foreach (var c in charmsRaw.EnumerateArray())
        {
            int charmId = c.GetProperty("id").GetInt32();
            foreach (var r in c.GetProperty("ranks").EnumerateArray())
            {
                charms.Add(new CharmRank(
                    charmId,
                    r.GetProperty("name").GetString() ?? "",
                    r.GetProperty("level").GetInt32(),
                    r.GetProperty("rarity").GetInt32(),
                    ParseSkills(r.GetProperty("skills"))));
            }
        }

        var allCharmRanks = charms;
        charms = charms
            .GroupBy(x => x.CharmId)
            .Select(g => g.OrderByDescending(x => x.Level).First())
            .ToList();

        var decorations = new List<Decoration>();
        foreach (var d in decoRaw.EnumerateArray())
        {
            int rarity = d.TryGetProperty("rarity", out var rareEl) && rareEl.ValueKind == JsonValueKind.Number
                ? rareEl.GetInt32()
                : 0;
            string iconColor = d.TryGetProperty("iconColor", out var icEl)
                ? icEl.GetString() ?? "Gray"
                : "Gray";
            decorations.Add(new Decoration(
                d.GetProperty("id").GetInt32(),
                d.GetProperty("name").GetString() ?? "",
                d.GetProperty("slot").GetInt32(),
                rarity,
                iconColor,
                ParseSkills(d.GetProperty("skills")),
                d.TryGetProperty("equipmentId", out var eqEl) && eqEl.ValueKind == JsonValueKind.Number ? eqEl.GetInt32() : null));
        }

        var weapons = new List<WeaponInfo>();
        string weaponsPath = Path.Combine(dataDirectory, "weapons.json");
        if (File.Exists(weaponsPath))
        {
            foreach (var w in ReadArray(weaponsPath).EnumerateArray())
            {
                var slots = w.TryGetProperty("slots", out var slotsEl)
                    ? slotsEl.EnumerateArray().Select(x => x.GetProperty("rank").GetInt32()).OrderByDescending(x => x).ToArray()
                    : Array.Empty<int>();
                weapons.Add(new WeaponInfo(
                    w.GetProperty("id").GetInt32(),
                    w.GetProperty("name").GetString() ?? "",
                    w.GetProperty("type").GetString() ?? "",
                    w.GetProperty("rarity").GetInt32(),
                    slots,
                    w.TryGetProperty("damage", out var dmg) ? dmg.GetInt32() : 0,
                    w.TryGetProperty("affinity", out var aff) ? aff.GetInt32() : 0));
            }
        }

        return new GameCatalog(skills, setBonuses, setEffects, armor, armorAliases, charms, allCharmRanks, decorations, weapons);
    }

    /// <summary>The armor id a request should use: ids of pieces folded into an identical set map to the kept piece.</summary>
    public int CanonicalArmorId(int id) => ArmorById.TryGetValue(id, out var piece) ? piece.Id : id;

    /// <summary>
    /// Sets that exist under two names with identical pieces (Defender α and Guardian α+) become one set named
    /// after both, keeping the lower set id. Sets that differ only by gender stay separate.
    /// </summary>
    private static List<ArmorPiece> MergeIdenticalSets(List<ArmorPiece> armor, Dictionary<int, ArmorPiece> aliases)
    {
        static string PieceKey(ArmorPiece p) => string.Join("|",
            p.Slot, p.Rank, p.Rarity, p.DefenseMax, p.Resistances, string.Join("-", p.Slots),
            string.Join(",", p.Skills.OrderBy(s => s.SkillId).Select(s => $"{s.SkillId}:{s.Level}")),
            string.Join(",", p.SetSkillIds.Order()), p.Gender);

        var duplicates = armor
            .Where(a => a.ArmorSetId is not null)
            .GroupBy(a => a.ArmorSetId!.Value)
            .Select(g => (SetId: g.Key, Pieces: g.OrderBy(p => p.Slot).ToList()))
            .GroupBy(s => string.Join("\n", s.Pieces.Select(PieceKey)))
            .Where(g => g.Count() > 1)
            .Select(g => g.OrderBy(s => s.SetId).ToList())
            .ToList();
        if (duplicates.Count == 0) return armor;

        var replaced = new Dictionary<int, ArmorPiece?>();
        foreach (var sets in duplicates)
        {
            string name = string.Join(" / ", sets.Select(s => s.Pieces[0].ArmorSetName).Distinct());
            var kept = sets[0].Pieces.ToDictionary(PieceKey, p => p with { ArmorSetName = name });
            foreach (var p in sets[0].Pieces)
                replaced[p.Id] = kept[PieceKey(p)];
            foreach (var p in sets.Skip(1).SelectMany(s => s.Pieces))
            {
                replaced[p.Id] = null;
                aliases[p.Id] = kept[PieceKey(p)];
            }
        }
        return armor
            .Select(a => replaced.TryGetValue(a.Id, out var r) ? r : a)
            .OfType<ArmorPiece>()
            .ToList();
    }

    private static string? ReadDescription(JsonElement e) =>
        e.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String && d.GetString() is { Length: > 0 } text
            ? text
            : null;

    private static JsonElement ReadArray(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException($"Missing data file: {path}");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }

    private static SkillPoint[] ParseSkills(JsonElement skills)
    {
        var list = new List<SkillPoint>();
        foreach (var s in skills.EnumerateArray())
        {
            int skillId = s.GetProperty("skill").GetInt32();
            int level = s.GetProperty("level").GetInt32();
            list.Add(new SkillPoint(skillId, level));
        }
        return list.ToArray();
    }

    private static int ReadResist(JsonElement res, string key)
        => res.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt32()
            : 0;

    private static bool TryParseSlot(string type, out ArmorSlot slot)
    {
        switch (type)
        {
            case "head": slot = ArmorSlot.Head; return true;
            case "chest": slot = ArmorSlot.Chest; return true;
            case "gloves": slot = ArmorSlot.Gloves; return true;
            case "waist": slot = ArmorSlot.Waist; return true;
            case "legs": slot = ArmorSlot.Legs; return true;
            default: slot = default; return false;
        }
    }
}
