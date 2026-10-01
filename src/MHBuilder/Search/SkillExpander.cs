using System.Collections.Concurrent;
using System.Diagnostics;
using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Search;

/// <summary>
/// Highest level a skill can reach while every wanted skill stays satisfied, and the armor ids (by slot) of a set
/// that reaches it, so a search with the skill added can start from that set.
/// </summary>
public sealed record AdditionalSkill(int Id, string Name, int Level, int MaxLevel, bool MaybeMore, IReadOnlyDictionary<ArmorSlot, int>? Armor = null);

public sealed record AdditionalSkillsResult(
    IReadOnlyList<AdditionalSkill> Skills,
    int Checked,
    int Candidates,
    bool BudgetExhausted,
    long ElapsedMs);

/// <summary>
/// "What else fits?" — for every other skill, find the highest level that can be added on top of the request.
/// Lower bounds come cheaply from the baseline sets (charm swaps, single armor swaps, re-fitted jewels);
/// each skill is then raised one level at a time with first-hit searches until one fails.
/// Levels are per skill: two listed skills may not both fit at their max at once.
/// </summary>
public sealed class SkillExpander
{
    private const int SwapSets = 10;
    private readonly GameCatalog _catalog;
    private readonly SetSearcher _searcher;
    private readonly HashSet<int> _obtainable;

    public SkillExpander(GameCatalog catalog, SetSearcher searcher)
    {
        _catalog = catalog;
        _searcher = searcher;
        _obtainable = catalog.Decorations.SelectMany(d => d.Skills)
            .Concat(catalog.Charms.SelectMany(c => c.Skills))
            .Concat(catalog.Armor.SelectMany(a => a.Skills))
            .Select(s => s.SkillId)
            .Concat(catalog.SetBonusesGrantingSkill.Keys)
            .ToHashSet();
    }

    public AdditionalSkillsResult Find(
        SearchRequest request,
        IReadOnlyList<SearchResult>? baseline = null,
        int budgetMs = 25_000,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        baseline ??= _searcher.Search(request with { MaxResults = Math.Max(request.MaxResults, 30) }, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (baseline.Count == 0)
            return new AdditionalSkillsResult([], 0, 0, false, sw.ElapsedMilliseconds);

        var excluded = request.ExcludedSkillIds ?? new HashSet<int>();
        var candidates = _catalog.Skills
            .Where(s => !s.IsSetBonus && s.MaxLevel > 0
                && !request.WantedSkills.ContainsKey(s.Id)
                && !excluded.Contains(s.Id)
                && _obtainable.Contains(s.Id))
            .ToList();

        var lowerBound = new ConcurrentDictionary<int, int>();
        var reached = new ConcurrentDictionary<int, ArmorPiece[]>();
        static ArmorPiece[] ArmorOf(SearchResult r) => [r.Head, r.Chest, r.Gloves, r.Waist, r.Legs];
        IReadOnlyDictionary<ArmorSlot, int>? Armor(int skillId) =>
            reached.TryGetValue(skillId, out var pieces) ? pieces.ToDictionary(p => p.Slot, p => p.Id) : null;

        int remainingMs = Math.Max(1_000, budgetMs - (int)sw.ElapsedMilliseconds);
        // Roughly one failing check per skill spread over all cores, with headroom for the passing ones.
        int checkMs = Math.Clamp(remainingMs * Environment.ProcessorCount / Math.Max(1, candidates.Count * 2), 300, 2_000);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(remainingMs);
        var found = new ConcurrentBag<AdditionalSkill>();
        int checkedCount = 0;
        bool exhausted = false;

        try
        {
            Parallel.ForEach(
                candidates,
                new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = cts.Token },
                skill =>
                {
                    int level = 0;
                    bool maybeMore = false;
                    try
                    {
                        var pool = _searcher.SwapPool(request, skill.Id);
                        for (int i = 0; i < baseline.Count && level < skill.MaxLevel; i++)
                        {
                            cts.Token.ThrowIfCancellationRequested();
                            var set = baseline[i];
                            int has = set.FinalSkills.GetValueOrDefault(skill.Id);
                            if (has > level)
                            {
                                level = has;
                                reached[skill.Id] = ArmorOf(set);
                            }
                            level = _searcher.BestLevelNear(set, request, skill.Id, out var near, i < SwapSets ? pool : null, level);
                            if (near is not null) reached[skill.Id] = near;
                            lowerBound[skill.Id] = level;
                        }
                        level = Math.Min(level, skill.MaxLevel);

                        while (level < skill.MaxLevel)
                        {
                            int target = level + 1;
                            var wanted = new Dictionary<int, int>(request.WantedSkills) { [skill.Id] = target };
                            var t0 = Stopwatch.GetTimestamp();
                            var hit = _searcher.Search(request with
                            {
                                WantedSkills = wanted,
                                MaxResults = 1,
                                TimeLimitMs = checkMs,
                                StopAtFirstResults = true,
                            }, cts.Token);
                            if (hit.Count == 0)
                            {
                                maybeMore = Stopwatch.GetElapsedTime(t0).TotalMilliseconds >= checkMs * 0.9;
                                break;
                            }
                            level = Math.Max(target, Math.Min(skill.MaxLevel, hit[0].FinalSkills.GetValueOrDefault(skill.Id)));
                            reached[skill.Id] = ArmorOf(hit[0]);
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        maybeMore = level < skill.MaxLevel;
                    }
                    Interlocked.Increment(ref checkedCount);
                    if (level > 0)
                        found.Add(new AdditionalSkill(skill.Id, skill.Name, level, skill.MaxLevel, maybeMore, Armor(skill.Id)));
                });
        }
        catch (OperationCanceledException)
        {
            exhausted = true;
        }
        cancellationToken.ThrowIfCancellationRequested();

        if (exhausted)
        {
            var done = found.Select(s => s.Id).ToHashSet();
            foreach (var skill in candidates)
            {
                int lb = Math.Min(skill.MaxLevel, lowerBound.GetValueOrDefault(skill.Id));
                if (lb > 0 && !done.Contains(skill.Id))
                    found.Add(new AdditionalSkill(skill.Id, skill.Name, lb, skill.MaxLevel, lb < skill.MaxLevel, Armor(skill.Id)));
            }
        }

        return new AdditionalSkillsResult(
            found.OrderBy(s => s.Name).ToList(),
            checkedCount,
            candidates.Count,
            exhausted,
            sw.ElapsedMilliseconds);
    }
}
