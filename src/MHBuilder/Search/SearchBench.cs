using System.Diagnostics;
using System.Text.Json;
using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Search;

/// <summary>
/// Fixed search cases for timing and regression checks:
/// <c>MHBuilder cli bench [--save file] [--compare file] [--time ms] [--only name] [--threads n]</c>.
/// Every result is re-validated (skills reached, jewels fit, owned counts, kept-free slots).
/// </summary>
public static class SearchBench
{
    private sealed record Case(string Name, (string Skill, int Level)[] Skills, Func<SearchRequest, SearchRequest>? Tweak = null);

    private sealed record ResultKey(int Defense, int Free, string Armor, string Charm);

    private static readonly int[] WeaponSlots = [4, 2, 1];

    private static readonly Case[] Cases =
    [
        new("light", [("Attack Boost", 3)]),
        new("typical", [("Weakness Exploit", 3), ("Critical Eye", 3), ("Attack Boost", 4), ("Critical Boost", 3)]),
        new("heavy", [("Weakness Exploit", 3), ("Critical Eye", 7), ("Attack Boost", 7), ("Critical Boost", 3),
            ("Health Boost", 3), ("Evade Window", 3), ("Divine Blessing", 3), ("Handicraft", 3)]),
        new("heavy no wpn", [("Weakness Exploit", 3), ("Critical Eye", 7), ("Attack Boost", 7), ("Critical Boost", 3),
            ("Health Boost", 3), ("Evade Window", 3), ("Divine Blessing", 3), ("Handicraft", 3)],
            r => r with { WeaponSlots = [] }),
        new("set effect", [("Master's Touch", 1), ("Critical Eye", 7), ("Weakness Exploit", 3), ("Critical Boost", 3), ("Handicraft", 3)]),
        new("secret", [("Agitator", 7), ("Weakness Exploit", 3), ("Critical Eye", 5), ("Attack Boost", 4)]),
        new("defensive", [("Health Boost", 3), ("Divine Blessing", 3), ("Earplugs", 5), ("Windproof", 5), ("Tremor Resistance", 3), ("Stun Resistance", 3)]),
        new("owned jewels", [("Weakness Exploit", 3), ("Critical Eye", 5), ("Attack Boost", 5), ("Critical Boost", 3)],
            r => r with { OwnedDecorations = SyntheticOwned() }),
        new("free slots", [("Weakness Exploit", 3), ("Critical Eye", 3), ("Attack Boost", 4), ("Critical Boost", 3)],
            r => r with { MinFreeSlots = [0, 0, 0, 2] }),
        new("floors", [("Weakness Exploit", 3), ("Critical Eye", 3), ("Attack Boost", 4), ("Critical Boost", 3)],
            r => r with { Minimums = new StatMinimums(null, 10, null, null, null, null) }),
        new("very heavy", [("Weakness Exploit", 3), ("Critical Eye", 7), ("Attack Boost", 7), ("Critical Boost", 3),
            ("Health Boost", 3), ("Evade Window", 5), ("Divine Blessing", 3), ("Handicraft", 5), ("Agitator", 5), ("Maximum Might", 3)]),
    ];

    private static GameCatalog? _catalog;

    /// <summary>Every jewel id owned (id % 3) times: a fixed partial collection so the owned-jewel path gets exercised.</summary>
    private static Dictionary<int, int> SyntheticOwned() =>
        _catalog!.Decorations.Where(d => d.Id % 3 > 0).ToDictionary(d => d.Id, d => d.Id % 3);

    public static int Run(GameCatalog catalog, string[] args)
    {
        _catalog = catalog;
        string? save = null, compare = null, only = null;
        int timeMs = 60_000;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--save": save = args[++i]; break;
                case "--compare": compare = args[++i]; break;
                case "--time": timeMs = int.Parse(args[++i]); break;
                case "--only": only = args[++i]; break;
                case "--threads": SetSearcher.MaxThreads = int.Parse(args[++i]); break;
                default: throw new ArgumentException($"Unknown flag {args[i]}");
            }
        }

        var baseline = compare is null
            ? null
            : JsonSerializer.Deserialize<Dictionary<string, List<ResultKey>>>(File.ReadAllText(compare))!;
        var searcher = new SetSearcher(catalog);
        // Untimed warm-up so the first case isn't measured on unoptimized (tier-0) code.
        searcher.Search(new SearchRequest(new Dictionary<int, int> { [ResolveSkill(catalog, "Critical Eye")] = 7 }, WeaponSlots,
            MaxResults: 100, TimeLimitMs: 5_000, ArmorRarities: Enumerable.Range(1, 12).ToHashSet()));
        var saved = new Dictionary<string, List<ResultKey>>();
        int problems = 0;
        long totalMs = 0;

        foreach (var c in Cases)
        {
            if (only is not null && !c.Name.Contains(only, StringComparison.OrdinalIgnoreCase)) continue;
            var wanted = new Dictionary<int, int>();
            foreach (var (skill, level) in c.Skills)
                wanted[ResolveSkill(catalog, skill)] = level;
            var request = new SearchRequest(wanted, WeaponSlots, MaxResults: 100, TimeLimitMs: timeMs,
                ArmorRarities: Enumerable.Range(1, 12).ToHashSet());
            if (c.Tweak is not null) request = c.Tweak(request);

            var sw = Stopwatch.StartNew();
            var outcome = searcher.SearchDetailed(request);
            var results = outcome.Results;
            sw.Stop();
            totalMs += sw.ElapsedMilliseconds;

            var invalid = results.Select(r => Validate(catalog, request, r)).Where(e => e is not null).ToList();
            problems += invalid.Count;
            var keys = results.Select(Key).ToList();
            saved[c.Name] = keys;

            string line = $"{c.Name,-14} {sw.ElapsedMilliseconds,7} ms  {outcome.Threads,2} thr  {results.Count,3} sets  best def {(results.Count > 0 ? results[0].Defense : 0),4}";
            if (sw.ElapsedMilliseconds >= timeMs - 50) line += "  TIME LIMIT";
            if (invalid.Count > 0) line += $"  {invalid.Count} INVALID: {invalid[0]}";
            if (baseline?.GetValueOrDefault(c.Name) is { } old)
                line += "  " + CompareToBaseline(old, keys);
            Console.WriteLine(line);
        }
        Console.WriteLine($"total {totalMs} ms{(problems > 0 ? $", {problems} invalid results" : "")}");

        if (save is not null)
            File.WriteAllText(save, JsonSerializer.Serialize(saved));
        return problems > 0 ? 2 : 0;
    }

    internal static int ResolveSkill(GameCatalog catalog, string name)
    {
        if (catalog.SkillsByName.TryGetValue(name, out var skill)) return skill.Id;
        var effect = catalog.SetEffectsById.Values.FirstOrDefault(e => e.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
        return effect?.VirtualId ?? throw new ArgumentException($"Unknown skill '{name}'");
    }

    private static ResultKey Key(SearchResult r) => new(
        r.Defense,
        r.RemainingSlots.Sum(),
        string.Join(',', new[] { r.Head, r.Chest, r.Gloves, r.Waist, r.Legs }.Select(p => p.Id)),
        $"{r.Charm.CharmId}:{r.Charm.Level}");

    /// <summary>Position by position (defense, then free slot points), plus how many armor+charm sets both lists share.</summary>
    private static string CompareToBaseline(List<ResultKey> old, List<ResultKey> now)
    {
        int better = 0, worse = 0;
        for (int i = 0; i < Math.Max(old.Count, now.Count); i++)
        {
            if (i >= now.Count) { worse++; continue; }
            if (i >= old.Count) { better++; continue; }
            int cmp = (now[i].Defense, now[i].Free).CompareTo((old[i].Defense, old[i].Free));
            if (cmp > 0) better++;
            else if (cmp < 0) worse++;
        }
        var oldSets = old.Select(k => (k.Armor, k.Charm)).ToHashSet();
        int shared = now.Count(k => oldSets.Contains((k.Armor, k.Charm)));
        string verdict = worse > 0 ? "WORSE" : better > 0 ? "better" : "same quality";
        return $"vs baseline: {verdict} (+{better} / -{worse}, {shared}/{old.Count} same sets)";
    }

    /// <summary>Null when the set really delivers the request; otherwise what's wrong.</summary>
    internal static string? Validate(GameCatalog catalog, SearchRequest request, SearchResult r)
    {
        var pieces = new[] { r.Head, r.Chest, r.Gloves, r.Waist, r.Legs };
        var slotsByLocation = new Dictionary<string, List<int>>
        {
            ["Head"] = r.Head.Slots.Where(s => s > 0).ToList(),
            ["Chest"] = r.Chest.Slots.Where(s => s > 0).ToList(),
            ["Gloves"] = r.Gloves.Slots.Where(s => s > 0).ToList(),
            ["Waist"] = r.Waist.Slots.Where(s => s > 0).ToList(),
            ["Legs"] = r.Legs.Slots.Where(s => s > 0).ToList(),
            ["Weapon"] = (r.WeaponSlots ?? []).Where(s => s > 0).ToList(),
        };
        foreach (var p in r.DecorationPlacements)
        {
            var hosts = slotsByLocation[p.Location];
            int i = hosts.IndexOf(p.SlotSize);
            if (i < 0) return $"{p.Decoration.Name} placed in a missing {p.Location} Lv{p.SlotSize} slot";
            if (p.Decoration.SlotSize > p.SlotSize) return $"{p.Decoration.Name} doesn't fit Lv{p.SlotSize}";
            hosts.RemoveAt(i);
        }
        var left = slotsByLocation.Values.SelectMany(x => x).OrderByDescending(x => x).ToArray();
        if (!left.SequenceEqual(r.RemainingSlots.OrderByDescending(x => x)))
            return "remaining slots don't match the placements";

        if (request.OwnedDecorations is { } owned)
            foreach (var g in r.DecorationPlacements.GroupBy(p => p.Decoration.Id))
                if (g.Count() > owned.GetValueOrDefault(g.Key))
                    return $"uses {g.Count()}x {g.First().Decoration.Name} but only {owned.GetValueOrDefault(g.Key)} owned";

        if (request.MinFreeSlots is { } minFree)
            for (int lv = 1; lv <= 4; lv++)
            {
                int need = minFree.Skip(lv - 1).Sum();
                if (left.Count(s => s >= lv) < need) return $"needs {need} free slots of Lv{lv}+";
            }

        foreach (var (id, level) in request.WantedSkills)
        {
            if (catalog.SetEffectsById.TryGetValue(id, out var effect))
            {
                if (!effect.Sources.Any(src => pieces.Count(p => p.SetSkillIds.Contains(src.SetBonusId)) >= src.RequiredParts))
                    return $"missing set effect {effect.Name}";
                continue;
            }
            if (r.FinalSkills.GetValueOrDefault(id) < level)
                return $"{catalog.SkillsById[id].Name} {r.FinalSkills.GetValueOrDefault(id)}/{level}";
        }
        if (request.Minimums is { } mins && !mins.MetBy(pieces))
            return "stat floor not met";
        return null;
    }
}
