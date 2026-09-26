using MHBuilder.Models;

namespace MHBuilder.Search;

/// <summary>Fitting decorations into a set's slots: greedy first, exact search when greedy fails.</summary>
public sealed partial class SetSearcher
{
    /// <summary>
    /// Sets aside the smallest slot that satisfies each required free slot (largest requirement first), so
    /// decorations only use the rest. False when the slots can't cover the requirement.
    /// </summary>
    private static bool ReserveFreeSlots(
        List<(string Location, int Size)> slots,
        int[]? minFree,
        out List<(string Location, int Size)> usable,
        out List<int> reserved)
    {
        usable = slots;
        reserved = [];
        if (minFree is null || minFree.All(n => n <= 0))
            return true;
        usable = slots.OrderBy(s => s.Size).ToList();
        for (int level = minFree.Length; level >= 1; level--)
        {
            for (int n = 0; n < minFree[level - 1]; n++)
            {
                int i = usable.FindIndex(s => s.Size >= level);
                if (i < 0) return false;
                reserved.Add(usable[i].Size);
                usable.RemoveAt(i);
            }
        }
        return true;
    }

    private bool TryFillDecorationsKeepingFree(
        int[] skillAcc,
        Dictionary<int, int> need,
        Dictionary<int, int> caps,
        List<(string Location, int Size)> slots,
        int[]? minFree,
        IReadOnlyDictionary<int, int>? owned,
        IReadOnlySet<int> excludedSkills,
        out List<DecorationPlacement> placements,
        out int[] remainingSlots)
    {
        if (!ReserveFreeSlots(slots, minFree, out var usable, out var reserved))
        {
            placements = [];
            remainingSlots = [];
            return false;
        }
        if (!TryFillDecorations(skillAcc, need, caps, usable, owned, excludedSkills, out placements, out remainingSlots))
            return false;
        if (reserved.Count > 0)
            remainingSlots = remainingSlots.Concat(reserved).OrderByDescending(x => x).ToArray();
        return true;
    }

    /// <summary>Greedy jewel fill (fast, usually right); when it fails, an exact search over jewel choices.</summary>
    private bool TryFillDecorations(
        int[] skillAcc,
        Dictionary<int, int> need,
        Dictionary<int, int> caps,
        List<(string Location, int Size)> slots,
        IReadOnlyDictionary<int, int>? owned,
        IReadOnlySet<int> excludedSkills,
        out List<DecorationPlacement> placements,
        out int[] remainingSlots)
    {
        var needLeft = new Dictionary<int, int>();
        foreach (var (id, lvl) in need)
        {
            // Cap current contribution — overcap does not reduce need further.
            int have = Math.Min(caps[id], Math.Max(0, skillAcc[id]));
            int miss = lvl - have;
            if (miss > 0)
                needLeft[id] = miss;
        }

        if (needLeft.Count == 0)
        {
            placements = [];
            remainingSlots = slots.Select(s => s.Size).OrderByDescending(x => x).ToArray();
            return true;
        }

        return TryFillGreedy(new Dictionary<int, int>(needLeft), caps, slots, owned, excludedSkills, out placements, out remainingSlots)
            || TryFillExact(needLeft, slots, owned, excludedSkills, out placements, out remainingSlots);
    }

    private bool TryFillGreedy(
        Dictionary<int, int> needLeft,
        Dictionary<int, int> caps,
        List<(string Location, int Size)> slots,
        IReadOnlyDictionary<int, int>? owned,
        IReadOnlySet<int> excludedSkills,
        out List<DecorationPlacement> placements,
        out int[] remainingSlots)
    {
        placements = new List<DecorationPlacement>();
        remainingSlots = [];
        Dictionary<int, int>? used = owned is null ? null : new Dictionary<int, int>();
        var free = slots.ToList();
        // Free slots per size, and how many of those are on armor (preferred over the weapon).
        Span<int> bySize = stackalloc int[5], armorBySize = stackalloc int[5];
        foreach (var (loc, size) in free)
            if (size is >= 1 and <= 4)
            {
                bySize[size]++;
                if (loc != "Weapon") armorBySize[size]++;
            }
        while (needLeft.Count > 0)
        {
            if (free.Count == 0)
                return false;

            int targetSkill = 0, most = int.MinValue;
            foreach (var (id, miss) in needLeft)
                if (miss > most) (targetSkill, most) = (id, miss);
            if (!_decosBySkill.TryGetValue(targetSkill, out var options))
                return false;

            Decoration? best = null;
            int bestSize = 0;
            bool bestOnArmor = false;
            int bestScore = int.MinValue;

            foreach (var deco in options)
            {
                if (owned is not null && owned.GetValueOrDefault(deco.Id) - used!.GetValueOrDefault(deco.Id) <= 0)
                    continue;
                if (HasExcludedSkill(deco, excludedSkills))
                    continue;

                int progress = 0;
                foreach (var s in deco.Skills)
                {
                    if (!needLeft.TryGetValue(s.SkillId, out var miss)) continue;
                    int cap = caps.GetValueOrDefault(s.SkillId, s.Level);
                    // Only count progress up to remaining need (and skill cap).
                    progress += Math.Min(miss, Math.Min(s.Level, cap));
                }
                if (progress <= 0) continue;

                // Prefer exact fits, then smaller waste; slight preference for armor over weapon.
                int size = Math.Max(1, deco.SlotSize);
                while (size <= 4 && bySize[size] == 0) size++;
                if (size > 4) continue;
                bool onArmor = armorBySize[size] > 0;
                int score = progress * 100 - (size - deco.SlotSize) * 10 - deco.SlotSize - (onArmor ? 0 : 1);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = deco;
                    bestSize = size;
                    bestOnArmor = onArmor;
                }
            }

            if (best is null)
                return false;

            int hostIndex = 0;
            while (free[hostIndex].Size != bestSize || (free[hostIndex].Location != "Weapon") != bestOnArmor) hostIndex++;
            var host = free[hostIndex];
            placements.Add(new DecorationPlacement(best, host.Location, host.Size));
            free.RemoveAt(hostIndex);
            bySize[bestSize]--;
            if (bestOnArmor) armorBySize[bestSize]--;
            if (used is not null)
                used[best.Id] = used.GetValueOrDefault(best.Id) + 1;

            foreach (var s in best.Skills)
            {
                if (!needLeft.TryGetValue(s.SkillId, out var miss)) continue;
                miss -= s.Level;
                if (miss <= 0) needLeft.Remove(s.SkillId);
                else needLeft[s.SkillId] = miss;
            }
        }

        remainingSlots = free.Select(s => s.Size).OrderByDescending(x => x).ToArray();
        return true;
    }

    private const int ExactFillBudget = 4_000;

    /// <summary>
    /// Backtracking over jewel choices for the most-needed skill, each jewel going into the smallest free slot it
    /// fits (a bigger slot can hold anything a smaller one can, so that never loses a solution). Catches sets the
    /// greedy fill rejects; gives up (false) after <see cref="ExactFillBudget"/> steps.
    /// </summary>
    private bool TryFillExact(
        Dictionary<int, int> needLeft,
        List<(string Location, int Size)> slots,
        IReadOnlyDictionary<int, int>? owned,
        IReadOnlySet<int> excludedSkills,
        out List<DecorationPlacement> placements,
        out int[] remainingSlots)
    {
        placements = [];
        remainingSlots = [];
        var ids = needLeft.Keys.ToArray();
        int n = ids.Length;
        var need = ids.Select(id => needLeft[id]).ToArray();
        var count = new int[5];
        foreach (var (_, size) in slots)
            if (size is >= 1 and <= 4) count[size]++;

        // Usable jewels and the wanted levels each adds (per wanted-skill index).
        var candidates = new List<(Decoration Deco, int[] Gain)>();
        var seen = new HashSet<int>();
        foreach (var id in ids)
        {
            if (!_decosBySkill.TryGetValue(id, out var options)) continue;
            foreach (var deco in options)
            {
                if (deco.SlotSize > 4 || !seen.Add(deco.Id)) continue;
                if (owned is not null && owned.GetValueOrDefault(deco.Id) <= 0) continue;
                if (HasExcludedSkill(deco, excludedSkills)) continue;
                var gain = new int[n];
                foreach (var s in deco.Skills)
                {
                    int k = Array.IndexOf(ids, s.SkillId);
                    if (k >= 0) gain[k] += s.Level;
                }
                candidates.Add((deco, gain));
            }
        }

        // With unlimited jewels, drop any jewel another one beats: no bigger, and at least as many of every needed level.
        if (owned is null)
        {
            var capped = candidates.Select(c => c.Gain.Select((g, k) => Math.Min(g, need[k])).ToArray()).ToList();
            bool Beats(int y, int x)
            {
                if (candidates[y].Deco.SlotSize > candidates[x].Deco.SlotSize) return false;
                bool strictly = candidates[y].Deco.SlotSize < candidates[x].Deco.SlotSize;
                for (int k = 0; k < n; k++)
                {
                    if (capped[y][k] < capped[x][k]) return false;
                    if (capped[y][k] > capped[x][k]) strictly = true;
                }
                return strictly || y < x;
            }
            var keep = Enumerable.Range(0, candidates.Count)
                .Where(x => capped[x].Any(g => g > 0) && !Enumerable.Range(0, candidates.Count).Any(y => y != x && Beats(y, x)))
                .ToList();
            candidates = keep.Select(i => (candidates[i].Deco, capped[i])).ToList();
        }

        // Quick rejects: per skill, and in total, the free slots can't hold enough levels even ignoring each other.
        var capBySize = new int[5];
        var skillBySize = new int[n][];
        for (int k = 0; k < n; k++)
        {
            var best = skillBySize[k] = new int[5];
            foreach (var (deco, gain) in candidates)
                for (int size = Math.Max(1, deco.SlotSize); size <= 4; size++)
                    best[size] = Math.Max(best[size], Math.Min(gain[k], need[k]));
            if (count[1] * best[1] + count[2] * best[2] + count[3] * best[3] + count[4] * best[4] < need[k])
                return false;
        }
        foreach (var (deco, gain) in candidates)
        {
            int useful = 0;
            for (int k = 0; k < n; k++) useful += Math.Min(gain[k], need[k]);
            for (int size = Math.Max(1, deco.SlotSize); size <= 4; size++)
                capBySize[size] = Math.Max(capBySize[size], useful);
        }

        var bySkill = new List<int>[n];
        for (int k = 0; k < n; k++)
        {
            int skill = k;
            bySkill[k] = Enumerable.Range(0, candidates.Count)
                .Where(i => candidates[i].Gain[skill] > 0)
                .OrderByDescending(i => candidates[i].Gain.Sum())
                .ThenBy(i => candidates[i].Deco.SlotSize)
                .ToList();
        }

        var used = new int[candidates.Count];
        var chosen = new List<(int Candidate, int Size)>();
        int budget = ExactFillBudget;
        // Failed states (remaining need + free slot counts) when jewel counts don't matter.
        HashSet<(long, long)>? failed = owned is null && n <= 12 ? new() : null;

        bool Search()
        {
            int target = -1, missing = 0;
            for (int k = 0; k < n; k++)
            {
                if (need[k] <= 0) continue;
                missing += need[k];
                var room = skillBySize[k];
                if (count[1] * room[1] + count[2] * room[2] + count[3] * room[3] + count[4] * room[4] < need[k])
                    return false;
                if (target < 0 || need[k] > need[target]) target = k;
            }
            if (target < 0) return true;
            if (--budget < 0) return false;
            if (count[1] * capBySize[1] + count[2] * capBySize[2] + count[3] * capBySize[3] + count[4] * capBySize[4] < missing)
                return false;

            (long, long) key = default;
            if (failed is not null)
            {
                long needKey = 0;
                for (int k = 0; k < n; k++) needKey = needKey * 16 + Math.Clamp(need[k], 0, 15);
                key = (needKey, (long)count[1] | (long)count[2] << 16 | (long)count[3] << 32 | (long)count[4] << 48);
                if (failed.Contains(key)) return false;
            }

            foreach (int i in bySkill[target])
            {
                var (deco, gain) = candidates[i];
                if (owned is not null && used[i] >= owned.GetValueOrDefault(deco.Id)) continue;
                int size = Math.Max(1, deco.SlotSize);
                while (size <= 4 && count[size] == 0) size++;
                if (size > 4) continue;

                count[size]--;
                used[i]++;
                for (int k = 0; k < n; k++) need[k] -= gain[k];
                chosen.Add((i, size));
                if (Search()) return true;
                chosen.RemoveAt(chosen.Count - 1);
                for (int k = 0; k < n; k++) need[k] += gain[k];
                used[i]--;
                count[size]++;
                if (budget < 0) return false;
            }
            failed?.Add(key);
            return false;
        }

        if (!Search())
            return false;

        var free = slots.ToList();
        var result = new List<DecorationPlacement>(chosen.Count);
        foreach (var (i, size) in chosen)
        {
            int at = free.FindIndex(s => s.Size == size && s.Location != "Weapon");
            if (at < 0) at = free.FindIndex(s => s.Size == size);
            result.Add(new DecorationPlacement(candidates[i].Deco, free[at].Location, size));
            free.RemoveAt(at);
        }
        placements = result;
        remainingSlots = free.Select(s => s.Size).OrderByDescending(x => x).ToArray();
        return true;
    }

    private static bool HasExcludedSkill(Decoration deco, IReadOnlySet<int> excludedSkills)
    {
        if (excludedSkills.Count == 0) return false;
        foreach (var s in deco.Skills)
            if (excludedSkills.Contains(s.SkillId)) return true;
        return false;
    }
}
