using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Search;

public sealed partial class SetSearcher
{
    private readonly GameCatalog _catalog;
    private readonly Dictionary<int, List<Decoration>> _decosBySkill;
    private const int StatCandidatesPerFloor = 12;

    /// <summary>Threads a best-results search may use.</summary>
    internal static int MaxThreads { get; set; } = Environment.ProcessorCount;

    public SetSearcher(GameCatalog catalog)
    {
        _catalog = catalog;
        _decosBySkill = catalog.Decorations
            .SelectMany(d => d.Skills.Select(s => (s.SkillId, d)))
            .GroupBy(x => x.SkillId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.d).DistinctBy(d => d.Id)
                .OrderByDescending(d => d.Skills.Sum(s => s.Level) * 10 - d.SlotSize)
                .ToList());
    }

    public IReadOnlyList<SearchResult> Search(SearchRequest request, CancellationToken ct = default) =>
        SearchDetailed(request, ct).Results;

    /// <summary>Search plus whether it stopped at the time limit (results may then not be the best possible).</summary>
    public SearchOutcome SearchDetailed(SearchRequest request, CancellationToken ct = default)
    {
        Validate(request);
        return new SearchRun(this, request, ct).Execute();
    }

    /// <summary>Which set-bonus thresholds a result reaches, e.g. "222:2|222:4" for 4+ Fatalis pieces.</summary>
    private static string SetBonusGroupKey(SearchResult r) =>
        r.SetBonuses is { Count: > 0 } bonuses
            ? string.Join('|', bonuses.Select(b => $"{b.Id}:{b.RequiredParts}").Order(StringComparer.Ordinal))
            : "";

    /// <summary>
    /// Result order (positive = a ranks higher): higher defense, more free slot points, fewer jewels to craft, then
    /// armor and charm ids so the order never depends on which thread found a set first.
    /// </summary>
    private static int Ranks(SearchResult a, SearchResult b)
    {
        int c = a.Defense.CompareTo(b.Defense);
        if (c == 0) c = a.RemainingSlots.Sum().CompareTo(b.RemainingSlots.Sum());
        if (c == 0) c = b.Decorations.Count.CompareTo(a.Decorations.Count);
        if (c == 0) c = b.Head.Id.CompareTo(a.Head.Id);
        if (c == 0) c = b.Chest.Id.CompareTo(a.Chest.Id);
        if (c == 0) c = b.Gloves.Id.CompareTo(a.Gloves.Id);
        if (c == 0) c = b.Waist.Id.CompareTo(a.Waist.Id);
        if (c == 0) c = b.Legs.Id.CompareTo(a.Legs.Id);
        if (c == 0) c = b.Charm.CharmId.CompareTo(a.Charm.CharmId);
        if (c == 0) c = b.Charm.Level.CompareTo(a.Charm.Level);
        return c;
    }

    private static readonly IComparer<SearchResult> ResultOrder = Comparer<SearchResult>.Create(Ranks);

    /// <summary>Per-slot armor worth swapping in when chasing <paramref name="skillId"/> on top of the request.</summary>
    public IReadOnlyDictionary<ArmorSlot, List<ArmorPiece>> SwapPool(SearchRequest request, int skillId)
    {
        int skillMax = _catalog.SkillsById.TryGetValue(skillId, out var sk) ? sk.MaxLevel : 1;
        var scoreWanted = new Dictionary<int, int>(request.WantedSkills) { [skillId] = skillMax };
        var excludeArmor = request.ExcludeArmorIds ?? new HashSet<int>();
        var excludedSkills = request.ExcludedSkillIds ?? new HashSet<int>();
        string? gender = NormalizeGender(request.Gender);
        return Enum.GetValues<ArmorSlot>().ToDictionary(
            slot => slot,
            slot => Candidates(slot, scoreWanted, request, excludeArmor, gender, excludedSkills));
    }

    /// <summary>
    /// Highest level of <paramref name="skillId"/> reachable near a found set: its exact armor, then (with a
    /// swap pool) every single-piece swap to armor carrying the skill or better slots. Each variant tries any
    /// charm with the skill and re-fits all decorations. Every level returned is backed by a valid set; the
    /// decoration fill is greedy, so it is a lower bound.
    /// </summary>
    public int BestLevelNear(
        SearchResult set,
        SearchRequest request,
        int skillId,
        IReadOnlyDictionary<ArmorSlot, List<ArmorPiece>>? swapPool = null,
        int atLeast = 0)
    {
        if (!_catalog.SkillsById.TryGetValue(skillId, out var target) || target.MaxLevel <= 0)
            return atLeast;
        var excludedSkills = request.ExcludedSkillIds ?? new HashSet<int>();

        var need = new Dictionary<int, int>();
        var setEffects = new List<SetEffectInfo>();
        var setParts = new Dictionary<int, int>();
        foreach (var (id, lvl) in request.WantedSkills)
        {
            if (_catalog.SetEffectsById.TryGetValue(id, out var effect))
                setEffects.Add(effect);
            else if (_catalog.SkillsById.TryGetValue(id, out var sk))
            {
                if (sk.IsSetBonus) setParts[id] = lvl;
                else need[id] = lvl;
            }
        }

        var charms = request.PinnedCharm is not null
            ? [set.Charm]
            : _catalog.Charms
                .Where(c => c.Skills.Any(s => s.SkillId == skillId)
                    && !c.Skills.Any(s => excludedSkills.Contains(s.SkillId))
                    && request.ExcludedCharms?.Contains((c.CharmId, c.Level)) != true)
                .Prepend(set.Charm)
                .DistinctBy(c => (c.CharmId, c.Level))
                .ToList();
        int[] weaponSlots = set.WeaponSlots ?? [];

        var original = new[] { set.Head, set.Chest, set.Gloves, set.Waist, set.Legs };
        int best = BestLevelForPieces(original, weaponSlots, charms, request, need, setEffects, setParts, excludedSkills, skillId, atLeast);
        if (swapPool is null || best >= target.MaxLevel)
            return best;

        for (int i = 0; i < original.Length; i++)
        {
            var current = original[i];
            int currentSlots = SlotScore(current.Slots);
            var swaps = swapPool[current.Slot]
                .Where(p => p.Id != current.Id
                    && (p.Skills.Any(s => s.SkillId == skillId) || SlotScore(p.Slots) > currentSlots))
                .Take(12);
            foreach (var piece in swaps)
            {
                var pieces = (ArmorPiece[])original.Clone();
                pieces[i] = piece;
                best = BestLevelForPieces(pieces, weaponSlots, charms, request, need, setEffects, setParts, excludedSkills, skillId, best);
                if (best >= target.MaxLevel)
                    return best;
            }
        }
        return best;
    }

    private int BestLevelForPieces(
        ArmorPiece[] pieces,
        int[] weaponSlots,
        List<CharmRank> charms,
        SearchRequest request,
        Dictionary<int, int> need,
        List<SetEffectInfo> setEffects,
        Dictionary<int, int> setParts,
        IReadOnlySet<int> excludedSkills,
        int skillId,
        int best)
    {
        if (!MeetsWantedSetRequirements(pieces, setEffects, setParts))
            return best;
        var minimums = request.Minimums;
        if (minimums is not null)
        {
            var (armor, resists) = ArmorTotals(pieces);
            var (defense, maxResists) = StatBonuses.Apply(armor, resists, StatBonuses.MaxLevels);
            if (!minimums.MetBy(defense, maxResists))
                return best;
        }
        var granted = EvaluateSetBonuses(pieces, out var active);
        if (granted.Any(g => excludedSkills.Contains(g.SkillId)) || active.Any(b => excludedSkills.Contains(b.Id)))
            return best;

        _catalog.ResolveRaisedCaps(pieces, out var raisedSkills, out var raisesAllCaps);
        int Cap(int id) => _catalog.EffectiveMaxLevel(id, raisesAllCaps || raisedSkills.Contains(id));
        foreach (var (id, lvl) in need)
            if (lvl > Cap(id)) return best;
        int maxLevel = Cap(skillId);
        if (maxLevel <= best)
            return best;
        var caps = need.Keys.Append(skillId).Distinct().ToDictionary(id => id, Cap);

        var slots = new List<(string Location, int Size)>(16);
        foreach (var p in pieces)
            foreach (var s in p.Slots)
                if (s > 0) slots.Add((p.Slot.ToString(), s));
        foreach (var s in weaponSlots)
            if (s > 0) slots.Add(("Weapon", s));

        var acc = new int[1024];
        foreach (var p in pieces) ApplySkills(acc, p.Skills, +1);
        ApplySkills(acc, granted, +1);

        var trial = new Dictionary<int, int>(need);
        foreach (var charm in charms)
        {
            ApplySkills(acc, charm.Skills, +1);
            for (int level = best + 1; level <= maxLevel; level++)
            {
                trial[skillId] = level;
                if (!TryFillDecorationsKeepingFree(acc, trial, caps, slots, request.MinFreeSlots, request.OwnedDecorations, excludedSkills, out var placed, out _)
                    || (minimums is not null && !MeetsMinimums(minimums, pieces, acc, placed, raisedSkills, raisesAllCaps)))
                    break;
                best = level;
            }
            ApplySkills(acc, charm.Skills, -1);
            if (best >= maxLevel) break;
        }
        return best;
    }

    private CharmRank? PinnedCharm(SearchRequest request) =>
        request.PinnedCharm is { } pin
            ? _catalog.Charms.FirstOrDefault(c => c.CharmId == pin.CharmId && c.Level == pin.Level)
            : null;

    /// <summary>
    /// Totals for a hand-made build (any slot may be empty). Empty slots come back as blank placeholder pieces.
    /// </summary>
    public SearchResult EvaluateBuild(
        IReadOnlyDictionary<ArmorSlot, ArmorPiece> pieces,
        CharmRank? charm,
        IReadOnlyList<Decoration> decorations,
        int[] weaponSlots)
    {
        var worn = pieces.Values.ToArray();
        var granted = EvaluateSetBonuses(worn, out var active);
        _catalog.ResolveRaisedCaps(worn, out var raisedSkills, out var raisesAllCaps);

        var final = new Dictionary<int, int>();
        foreach (var p in worn) Accumulate(final, p.Skills);
        Accumulate(final, granted);
        if (charm is not null) Accumulate(final, charm.Skills);
        foreach (var d in decorations) Accumulate(final, d.Skills);
        foreach (var id in final.Keys.ToList())
            final[id] = _catalog.CapSkill(id, final[id], raisesAllCaps || raisedSkills.Contains(id));
        foreach (var id in final.Keys.Where(k => final[k] <= 0).ToList())
            final.Remove(id);

        var (armorDefense, armorResists) = ArmorTotals(worn);
        var (defense, resists) = _catalog.StatBonuses.Apply(armorDefense, armorResists, final);
        ArmorPiece Slot(ArmorSlot s) => pieces.TryGetValue(s, out var p)
            ? p
            : new ArmorPiece(0, "", s, "", 0, 0, ElementalResists.Zero, [], [], null, null, []);

        return new SearchResult(
            Slot(ArmorSlot.Head), Slot(ArmorSlot.Chest), Slot(ArmorSlot.Gloves), Slot(ArmorSlot.Waist), Slot(ArmorSlot.Legs),
            charm ?? new CharmRank(0, "", 0, 0, []),
            decorations,
            [],
            final,
            defense,
            resists,
            [],
            null,
            weaponSlots,
            null,
            null,
            active,
            ArmorDefense: armorDefense,
            ArmorResistances: armorResists);
    }

    private static (int Defense, ElementalResists Resists) ArmorTotals(IEnumerable<ArmorPiece> pieces)
    {
        int defense = 0;
        var resists = ElementalResists.Zero;
        foreach (var p in pieces)
        {
            defense += p.DefenseMax;
            resists = resists.Add(p.Resistances);
        }
        return (defense, resists);
    }

    /// <summary>
    /// Whether the set meets the stat floors: its armor plus the bonus skills at the levels from
    /// <paramref name="skillAcc"/> (armor, set bonuses, charm) and the placed jewels, capped.
    /// </summary>
    private bool MeetsMinimums(
        StatMinimums minimums,
        ArmorPiece[] pieces,
        int[] skillAcc,
        List<DecorationPlacement> placements,
        HashSet<int> raisedSkills,
        bool raisesAllCaps)
    {
        var ids = _catalog.StatBonuses.SkillIds;
        Span<int> levels = stackalloc int[StatBonuses.Count];
        for (int i = 0; i < StatBonuses.Count; i++)
        {
            int id = ids[i];
            if (id < 0) continue;
            int level = skillAcc[id];
            foreach (var p in placements)
                foreach (var s in p.Decoration.Skills)
                    if (s.SkillId == id) level += s.Level;
            levels[i] = _catalog.CapSkill(id, level, raisesAllCaps || raisedSkills.Contains(id));
        }
        var (armor, resists) = ArmorTotals(pieces);
        var (defense, total) = StatBonuses.Apply(armor, resists, levels);
        return minimums.MetBy(defense, total);
    }

    private static int SlotScore(int[] slots) =>
        slots.Sum(s => s switch { 4 => 9, 3 => 5, 2 => 3, 1 => 1, _ => 0 });

    private SkillPoint[] EvaluateSetBonuses(ArmorPiece[] pieces, out List<ActiveSetBonus> active)
    {
        active = new List<ActiveSetBonus>();
        var grants = new Dictionary<int, int>();

        var counts = new Dictionary<int, int>();
        foreach (var piece in pieces)
        {
            foreach (var sid in piece.SetSkillIds)
                counts[sid] = counts.GetValueOrDefault(sid) + 1;
        }

        foreach (var (setBonusId, pieceCount) in counts)
        {
            if (!_catalog.SetBonusesById.TryGetValue(setBonusId, out var bonus))
                continue;

            foreach (var th in bonus.Thresholds)
            {
                if (pieceCount < th.RequiredParts)
                    continue;

                string effect;
                if (th.GrantsSkillId is int gid && gid > 0)
                {
                    int level = Math.Max(1, th.GrantsLevel);
                    grants[gid] = grants.GetValueOrDefault(gid) + level;
                    string skillName = _catalog.SkillsById.TryGetValue(gid, out var sk) ? sk.Name : $"#{gid}";
                    effect = th.EffectName is { Length: > 0 } en && !en.Equals(skillName, StringComparison.OrdinalIgnoreCase)
                        ? $"{en} (+{skillName} {level})"
                        : $"+{skillName} {level}";
                }
                else if (th.RaisesCapForSkillId is int capId && capId > 0)
                {
                    string skillName = _catalog.SkillsById.TryGetValue(capId, out var sk) ? sk.Name : $"#{capId}";
                    effect = th.EffectName is { Length: > 0 } en
                        ? $"{en} (raises {skillName} cap)"
                        : $"raises {skillName} cap";
                }
                else if (th.RaisesAllCaps)
                {
                    effect = th.EffectName is { Length: > 0 } en ? en : "raises all skill caps";
                }
                else
                {
                    effect = th.EffectName is { Length: > 0 } en
                        ? en
                        : $"{th.RequiredParts}-piece effect";
                }

                active.Add(new ActiveSetBonus(bonus.Id, bonus.Name, pieceCount, th.RequiredParts, effect));
            }
        }

        return grants.Select(kv => new SkillPoint(kv.Key, kv.Value)).ToArray();
    }

    private int[] ResolveWeaponSlots(
        SearchRequest request,
        out string? weaponName,
        out string? weaponType,
        out int? weaponRarity)
    {
        weaponName = request.WeaponName;
        weaponType = null;
        weaponRarity = null;
        if (request.WeaponId is int wid && _catalog.WeaponsById.TryGetValue(wid, out var weapon))
        {
            weaponName = weapon.Name;
            weaponType = weapon.Type;
            weaponRarity = weapon.Rarity;
            return weapon.Slots.OrderByDescending(x => x).ToArray();
        }

        return (request.WeaponSlots ?? Array.Empty<int>()).OrderByDescending(x => x).ToArray();
    }

    private void Validate(SearchRequest request)
    {
        if (request.WantedSkills.Count == 0)
            throw new ArgumentException("Pick at least one skill.");
        foreach (var (id, level) in request.WantedSkills)
        {
            if (_catalog.SetEffectsById.ContainsKey(id))
            {
                if (level < 1)
                    throw new ArgumentException("Set effect level must be at least 1.");
                continue;
            }
            if (SetEffectIds.IsVirtual(id))
                throw new ArgumentException($"Unknown set effect id {id}");

            if (!_catalog.SkillsById.TryGetValue(id, out var skill))
                throw new ArgumentException($"Unknown skill id {id}");
            if (skill.IsSetBonus)
                throw new ArgumentException($"{skill.Name} is a set name — pick the skill/effect it grants (e.g. Sizzling Gift, Master's Touch).");
            if (skill.MaxLevel < 1)
                throw new ArgumentException($"{skill.Name} has no usable levels.");
            if (level < 1 || level > skill.MaxLevel)
                throw new ArgumentException($"{skill.Name} level must be 1–{skill.MaxLevel} (levels above the cap do nothing).");
            if (level > skill.BaseMaxLevel && skill.BaseMaxLevel < skill.MaxLevel)
            {
                // Allowed — search must include the matching Secret / Inheritance set bonus.
            }
        }
    }

    private static string? NormalizeGender(string? gender)
    {
        if (string.IsNullOrWhiteSpace(gender)) return null;
        string g = gender.Trim().ToLowerInvariant();
        return g is "male" or "female" ? g : null;
    }

    private static bool GenderOk(ArmorPiece piece, string? gender)
    {
        if (gender is null) return true;
        if (piece.Gender is null) return true;
        return piece.Gender.Equals(gender, StringComparison.OrdinalIgnoreCase);
    }

    private List<ArmorPiece> Candidates(
        ArmorSlot slot,
        IReadOnlyDictionary<int, int> wanted,
        SearchRequest request,
        IReadOnlySet<int> exclude,
        string? gender,
        IReadOnlySet<int> excludedSkills)
    {
        if (request.PinnedArmor is not null
            && request.PinnedArmor.TryGetValue(slot, out var pinnedId)
            && _catalog.ArmorById.TryGetValue(pinnedId, out var pinned))
            return [pinned];

        bool RankOk(string rank) => request.MinRank switch
        {
            "low" => true,
            "high" => rank is "high" or "master",
            _ => rank == "master",
        };
        bool TierOk(ArmorPiece a) => request.ArmorRarities is { Count: > 0 } rarities
            ? rarities.Contains(a.Rarity)
            : RankOk(a.Rank);

        var scored = _catalog.Armor
            .Where(a => a.Slot == slot && TierOk(a) && !exclude.Contains(a.Id) && GenderOk(a, gender)
                && !a.Skills.Any(s => excludedSkills.Contains(s.SkillId)))
            .Select(a => (piece: a, score: ScorePiece(a, wanted)))
            .OrderByDescending(x => x.score)
            .ThenByDescending(x => x.piece.DefenseMax)
            .ToList();

        var picked = scored
            .Where(x => x.score > 0 || x.piece.Slots.Sum() >= 3 || x.piece.Slots.Any(s => s >= 4))
            .Take(request.MaxCandidatesPerSlot)
            .Select(x => x.piece)
            .ToList();

        if (picked.Count == 0)
            picked = scored.Take(Math.Min(20, scored.Count)).Select(x => x.piece).ToList();

        // Skill-ranked lists can miss the pieces a stat floor needs; add the best few for each floored stat.
        if (request.Minimums is { Any: true } minimums)
        {
            var floors = minimums.ToArray();
            var have = picked.Select(p => p.Id).ToHashSet();
            for (int k = 0; k < StatMinimums.Count; k++)
            {
                if (floors[k] is null) continue;
                int stat = k;
                foreach (var x in scored.OrderByDescending(x => StatMinimums.Stat(x.piece, stat)).ThenByDescending(x => x.score).Take(StatCandidatesPerFloor))
                    if (have.Add(x.piece.Id))
                        picked.Add(x.piece);
            }
        }

        return picked;
    }

    private List<CharmRank> CharmCandidates(
        IReadOnlyDictionary<int, int> wanted,
        int max,
        IReadOnlySet<int> excludedSkills,
        IReadOnlySet<(int CharmId, int Level)>? excludedCharms)
    {
        var scored = _catalog.Charms
            .Where(c => !c.Skills.Any(s => excludedSkills.Contains(s.SkillId))
                && excludedCharms?.Contains((c.CharmId, c.Level)) != true)
            .Select(c => (charm: c, score: c.Skills.Where(s => wanted.ContainsKey(s.SkillId)).Sum(s => s.Level * 10)))
            .OrderByDescending(x => x.score)
            .ThenByDescending(x => x.charm.Rarity)
            .ToList();

        var useful = scored.Where(x => x.score > 0).Take(max).Select(x => x.charm).ToList();
        if (useful.Count > 0)
            return useful;

        return scored.Take(1).Select(x => x.charm).ToList();
    }

    private int ScorePiece(ArmorPiece a, IReadOnlyDictionary<int, int> wanted)
    {
        int skillScore = a.Skills.Where(s => wanted.ContainsKey(s.SkillId)).Sum(s => s.Level * 12);
        int slotScore = a.Slots.Sum(s => s switch { 4 => 9, 3 => 5, 2 => 3, 1 => 1, _ => 0 });

        // Prefer pieces that progress set bonuses granting a wanted skill (e.g. Critical Element)
        // or raising a soft cap when the request needs levels above the base max.
        int setScore = 0;
        foreach (var setSkillId in a.SetSkillIds)
        {
            if (wanted.TryGetValue(setSkillId, out var needParts)
                && _catalog.SkillsById.TryGetValue(setSkillId, out var setSk)
                && setSk.IsSetBonus)
            {
                setScore += 55 + Math.Max(0, 6 - needParts) * 4;
            }

            if (!_catalog.SetBonusesById.TryGetValue(setSkillId, out var bonus))
                continue;
            foreach (var th in bonus.Thresholds)
            {
                if (th.GrantsSkillId is int gid && wanted.ContainsKey(gid))
                    setScore += 25 + Math.Max(0, 6 - th.RequiredParts) * 3;
                if (th.RaisesCapForSkillId is int capId
                    && wanted.TryGetValue(capId, out var need)
                    && need > _catalog.BaseMaxLevel(capId))
                    setScore += 40 + Math.Max(0, 6 - th.RequiredParts) * 4;
                if (th.RaisesAllCaps
                    && wanted.Any(kv =>
                        (!_catalog.SkillsById.TryGetValue(kv.Key, out var wsk) || !wsk.IsSetBonus)
                        && kv.Value > _catalog.BaseMaxLevel(kv.Key)))
                    setScore += 35;
            }
        }

        return skillScore + slotScore + setScore;
    }

    private static void ApplySkills(int[] acc, SkillPoint[] skills, int sign)
    {
        foreach (var s in skills)
        {
            if (s.SkillId >= 0 && s.SkillId < acc.Length)
                acc[s.SkillId] += sign * s.Level;
        }
    }

    private static void Accumulate(Dictionary<int, int> map, SkillPoint[] skills)
    {
        foreach (var s in skills)
            map[s.SkillId] = map.GetValueOrDefault(s.SkillId) + s.Level;
    }

    private static bool MeetsWantedSetRequirements(
        ArmorPiece[] pieces,
        IReadOnlyList<SetEffectInfo> wantedSetEffects,
        IReadOnlyDictionary<int, int> wantedSetBonusParts)
    {
        if (wantedSetEffects.Count == 0 && wantedSetBonusParts.Count == 0)
            return true;

        var counts = new Dictionary<int, int>();
        foreach (var piece in pieces)
        {
            foreach (var sid in piece.SetSkillIds)
                counts[sid] = counts.GetValueOrDefault(sid) + 1;
        }

        foreach (var (id, needParts) in wantedSetBonusParts)
        {
            if (counts.GetValueOrDefault(id) < needParts)
                return false;
        }

        foreach (var effect in wantedSetEffects)
        {
            bool any = effect.Sources.Any(src => counts.GetValueOrDefault(src.SetBonusId) >= src.RequiredParts);
            if (!any) return false;
        }

        return true;
    }
}
