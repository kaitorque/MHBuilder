using System.Collections.Concurrent;
using MHBuilder.Catalog;
using MHBuilder.Models;

namespace MHBuilder.Search;

public sealed partial class SetSearcher
{
    /// <summary>
    /// One search: bounds precomputed from the request, a shared result list, and depth-first workers.
    /// Best-results searches split the first two armor slots across threads; every worker prunes against the
    /// shared worst result, so later threads skip whatever can no longer make the list.
    /// </summary>
    private sealed class SearchRun
    {
        private readonly SetSearcher _s;
        private readonly GameCatalog _catalog;
        private readonly SearchRequest _request;
        private readonly CancellationToken _ct;
        private readonly long _deadline;
        private volatile bool _stopped;
        private volatile bool _timedOut;

        private readonly int[] _weaponSlots;
        private readonly string? _weaponName;
        private readonly string? _weaponType;
        private readonly int? _weaponRarity;
        private readonly Dictionary<int, int> _wantedSkills;
        private readonly List<SetEffectInfo> _wantedSetEffects = new();
        private readonly Dictionary<int, int> _wantedSetBonusParts = new();
        private readonly HashSet<int> _excludedSkills;
        private readonly bool _findBest;
        private readonly (ArmorSlot Slot, List<ArmorPiece> List)[] _order;
        private readonly List<CharmRank> _charms;
        private readonly bool _impossible;

        // Wanted skills by index, with the most each remaining depth / the charm / a set bonus can add.
        private readonly int[] _needIds;
        private readonly int[] _needLevels;
        private readonly int[] _optCaps;
        private readonly int[,] _skillRemaining;
        private readonly int[] _charmBest;
        private readonly int[] _grantBest;
        // Joint bound: every wanted level comes from armor, charm, a set bonus or a jewel, counted once.
        private readonly int _needTotal;
        private readonly int[] _valueRemaining = new int[6];
        private readonly int _charmBestTotal;
        private readonly int _grantTotal;
        // [k, size]: most levels of wanted skill k one slot of that size can hold.
        private readonly int[,] _skillCapBySize;
        // Fewest slot points one level of wanted skill k can cost (a jewel's size over the wanted levels it adds).
        private readonly double[] _costPerLevel;

        // Most wanted levels one slot of each size can hold, and per-depth best armor totals.
        private readonly int[] _capBySize = new int[5];
        private readonly int[] _capacityRemaining = new int[6];
        private readonly int[] _slotPointsRemaining = new int[6];
        private readonly int _weaponCapacity;
        private readonly int _weaponSlotPoints;
        private readonly int _minFreePoints;
        private readonly int _minFreeCapacity;
        private readonly int[] _needAtLeast = new int[5];
        private readonly int[,] _bestAtLeast = new int[6, 5];
        private readonly int[] _weaponAtLeast = new int[5];
        private readonly int?[] _floors;
        private readonly bool _anyFloor;
        private readonly int[,] _bestRemaining = new int[6, StatMinimums.Count];
        // Defense Boost / resistance skills: most levels each remaining depth (plus charm and set bonuses) can add,
        // and each cap. Open ones can come from jewels placed for wanted skills, so they bound at the cap.
        private readonly int[] _bonusIds;
        private readonly int[,] _bonusRemaining = new int[6, StatBonuses.Count];
        private readonly int[] _bonusCap = new int[StatBonuses.Count];
        private readonly bool[] _bonusOpen = new bool[StatBonuses.Count];
        private readonly Dictionary<int, int> _trackedIndex = new();
        private readonly int[][] _setSlotsLeft;

        private readonly object _lock = new();
        private readonly List<SearchResult> _results = new();
        private readonly List<string> _groupKeys = new();
        private readonly List<SearchResult> _overflow = new();
        private readonly int _perGroup;
        private int _worstIndex = -1;
        private volatile bool _full;
        // Worst listed result as (defense << 32 | free slot points), read without the lock.
        private long _worstPacked;

        public SearchRun(SetSearcher searcher, SearchRequest request, CancellationToken ct)
        {
            _s = searcher;
            _catalog = searcher._catalog;
            _request = request;
            _ct = ct;
            _deadline = Environment.TickCount64 + request.TimeLimitMs;
            _findBest = !request.StopAtFirstResults;
            _perGroup = Math.Max(3, request.MaxResults / 10);

            _weaponSlots = searcher.ResolveWeaponSlots(request, out _weaponName, out _weaponType, out _weaponRarity);
            _wantedSkills = new Dictionary<int, int>();
            foreach (var (id, level) in request.WantedSkills)
            {
                if (_catalog.SetEffectsById.TryGetValue(id, out var effect))
                    _wantedSetEffects.Add(effect);
                else if (_catalog.SkillsById.TryGetValue(id, out var sk) && sk.IsSetBonus)
                    _wantedSetBonusParts[id] = Math.Max(_wantedSetBonusParts.GetValueOrDefault(id), level);
                else
                    _wantedSkills[id] = level;
            }
            _impossible = _wantedSetBonusParts.Values.Any(p => p > 5)
                || _wantedSetEffects.Any(e => e.Sources.Min(s => s.RequiredParts) > 5);

            var wantedForScore = new Dictionary<int, int>(_wantedSkills);
            foreach (var (setId, parts) in _wantedSetBonusParts)
                wantedForScore[setId] = Math.Max(wantedForScore.GetValueOrDefault(setId), parts);
            foreach (var effect in _wantedSetEffects)
                foreach (var src in effect.Sources)
                    wantedForScore[src.SetBonusId] = Math.Max(wantedForScore.GetValueOrDefault(src.SetBonusId), src.RequiredParts);

            var exclude = request.ExcludeArmorIds ?? new HashSet<int>();
            string? gender = NormalizeGender(request.Gender);
            _excludedSkills = (request.ExcludedSkillIds ?? new HashSet<int>())
                .Where(id => !request.WantedSkills.ContainsKey(id))
                .ToHashSet();

            _order = Enum.GetValues<ArmorSlot>()
                .Select(slot => (slot, searcher.Candidates(slot, wantedForScore, request, exclude, gender, _excludedSkills)))
                .OrderBy(x => x.Item2.Count)
                .ToArray();
            // Best-results mode is branch and bound on (defense, free slots): highest defense first,
            // so once the list is full every later piece in a slot is no better and the loop can stop.
            if (_findBest)
                for (int d = 0; d < 5; d++)
                    _order[d] = (_order[d].Slot, _order[d].List.OrderByDescending(p => p.DefenseMax).ToList());
            _charms = searcher.PinnedCharm(request) is { } pinnedCharm
                ? [pinnedCharm]
                : searcher.CharmCandidates(_wantedSkills, request.MaxCandidatesPerSlot, _excludedSkills, request.ExcludedCharms);

            // Skill bounds. Levels above the soft cap need a Secret / Inheritance, so bound with the hard cap then.
            _needIds = _wantedSkills.Keys.ToArray();
            _needLevels = _needIds.Select(id => _wantedSkills[id]).ToArray();
            _optCaps = _needIds.Select(id =>
            {
                int soft = _catalog.BaseMaxLevel(id);
                int hard = _catalog.SkillsById.TryGetValue(id, out var sk) ? sk.MaxLevel : soft;
                return _wantedSkills[id] > soft ? Math.Max(soft, hard) : soft;
            }).ToArray();
            int n = _needIds.Length;
            _skillRemaining = new int[6, n];
            for (int d = 4; d >= 0; d--)
                for (int k = 0; k < n; k++)
                {
                    int id = _needIds[k], best = 0;
                    foreach (var p in _order[d].List)
                        foreach (var s in p.Skills)
                            if (s.SkillId == id) best = Math.Max(best, s.Level);
                    _skillRemaining[d, k] = _skillRemaining[d + 1, k] + best;
                }
            _charmBest = _needIds.Select(id => _charms.Count == 0 ? 0 : _charms.Max(c => c.Skills.Where(s => s.SkillId == id).Sum(s => s.Level))).ToArray();
            _grantBest = _needIds.Select(id => _catalog.SetBonusesGrantingSkill.TryGetValue(id, out var src) ? src.Max(x => x.GrantsLevel) : 0).ToArray();

            // A slot of size s holds one jewel of size <= s; count the wanted levels the best such jewel adds.
            var owned = request.OwnedDecorations;
            _skillCapBySize = new int[n, 5];
            _costPerLevel = Enumerable.Repeat(double.MaxValue, n).ToArray();
            foreach (var deco in _catalog.Decorations)
            {
                if (owned is not null && owned.GetValueOrDefault(deco.Id) <= 0) continue;
                if (deco.Skills.Any(s => _excludedSkills.Contains(s.SkillId))) continue;
                int useful = deco.Skills.Sum(s => _wantedSkills.TryGetValue(s.SkillId, out var need) ? Math.Min(s.Level, need) : 0);
                if (useful > 0)
                    for (int k = 0; k < n; k++)
                        if (deco.Skills.Any(s => s.SkillId == _needIds[k]))
                            _costPerLevel[k] = Math.Min(_costPerLevel[k], Math.Max(1, deco.SlotSize) / (double)useful);
                for (int size = Math.Max(1, deco.SlotSize); size <= 4; size++)
                {
                    _capBySize[size] = Math.Max(_capBySize[size], useful);
                    for (int k = 0; k < n; k++)
                        foreach (var s in deco.Skills)
                            if (s.SkillId == _needIds[k])
                                _skillCapBySize[k, size] = Math.Max(_skillCapBySize[k, size], Math.Min(s.Level, _needLevels[k]));
                }
            }
            int Capacity(int[] slots) => slots.Sum(s => s is >= 1 and <= 4 ? _capBySize[s] : 0);
            int UsefulCapped(SkillPoint[] skills)
            {
                int sum = 0;
                for (int k = 0; k < n; k++)
                {
                    int lv = 0;
                    foreach (var s in skills)
                        if (s.SkillId == _needIds[k]) lv += s.Level;
                    sum += Math.Min(lv, _needLevels[k]);
                }
                return sum;
            }
            _weaponCapacity = Capacity(_weaponSlots);
            _weaponSlotPoints = _weaponSlots.Sum();
            for (int d = 4; d >= 0; d--)
            {
                var list = _order[d].List;
                _capacityRemaining[d] = _capacityRemaining[d + 1] + (list.Count == 0 ? 0 : list.Max(p => Capacity(p.Slots)));
                _slotPointsRemaining[d] = _slotPointsRemaining[d + 1] + (list.Count == 0 ? 0 : list.Max(p => p.Slots.Sum()));
                _valueRemaining[d] = _valueRemaining[d + 1] + (list.Count == 0 ? 0 : list.Max(p => UsefulCapped(p.Skills) + Capacity(p.Slots)));
            }
            _needTotal = _needLevels.Sum();
            _charmBestTotal = _charms.Count == 0 ? 0 : _charms.Max(c => UsefulCapped(c.Skills));
            _grantTotal = _needIds.Select((id, k) => Math.Min(_grantBest[k], _needLevels[k])).Sum();

            // Each kept-free slot of level L uses at least L slot points (and one slot's capacity) that jewels can't have.
            var minFree = request.MinFreeSlots;
            _minFreePoints = minFree?.Select((c, i) => Math.Max(0, c) * (i + 1)).Sum() ?? 0;
            _minFreeCapacity = minFree?.Select((c, i) => Math.Max(0, c) * _capBySize[Math.Min(4, i + 1)]).Sum() ?? 0;
            if (_minFreePoints > 0)
            {
                for (int lv = 1; lv <= 4; lv++)
                {
                    for (int i = lv - 1; i < 4 && i < minFree!.Length; i++)
                        _needAtLeast[lv] += Math.Max(0, minFree[i]);
                    int size = lv;
                    _weaponAtLeast[lv] = _weaponSlots.Count(s => s >= size);
                    for (int d = 4; d >= 0; d--)
                        _bestAtLeast[d, lv] = _bestAtLeast[d + 1, lv]
                            + (_order[d].List.Count == 0 ? 0 : _order[d].List.Max(p => p.Slots.Count(s => s >= size)));
                }
            }

            _floors = request.Minimums?.ToArray() ?? new int?[StatMinimums.Count];
            _anyFloor = _floors.Any(f => f is not null);
            for (int d = 4; d >= 0; d--)
                for (int k = 0; k < StatMinimums.Count; k++)
                {
                    int stat = k;
                    _bestRemaining[d, k] = _bestRemaining[d + 1, k]
                        + (_order[d].List.Count == 0 ? 0 : _order[d].List.Max(p => StatMinimums.Stat(p, stat)));
                }

            _bonusIds = _catalog.StatBonuses.SkillIds;
            for (int i = 0; i < StatBonuses.Count; i++)
            {
                int id = _bonusIds[i];
                if (id < 0 || _excludedSkills.Contains(id) || !_catalog.SkillsById.TryGetValue(id, out var bonusSkill))
                    continue;
                _bonusCap[i] = bonusSkill.MaxLevel;
                _bonusOpen[i] = _wantedSkills.ContainsKey(id)
                    || (searcher._decosBySkill.TryGetValue(id, out var decos) && decos.Any(deco =>
                        (owned is null || owned.GetValueOrDefault(deco.Id) > 0)
                        && !deco.Skills.Any(s => _excludedSkills.Contains(s.SkillId))
                        && deco.Skills.Any(s => _wantedSkills.ContainsKey(s.SkillId))));
                int LevelOf(SkillPoint[] skills) => skills.Where(s => s.SkillId == id).Sum(s => s.Level);
                _bonusRemaining[5, i] = (_charms.Count == 0 ? 0 : _charms.Max(c => LevelOf(c.Skills)))
                    + (_catalog.SetBonusesGrantingSkill.TryGetValue(id, out var grants) ? grants.Sum(g => g.GrantsLevel) : 0);
                for (int d = 4; d >= 0; d--)
                    _bonusRemaining[d, i] = _bonusRemaining[d + 1, i]
                        + (_order[d].List.Count == 0 ? 0 : _order[d].List.Max(p => LevelOf(p.Skills)));
            }

            // Wanted set bonuses: prune when the remaining slots can't complete any qualifying set.
            foreach (var id in _wantedSetEffects.SelectMany(e => e.Sources.Select(s => s.SetBonusId)).Concat(_wantedSetBonusParts.Keys))
                _trackedIndex.TryAdd(id, _trackedIndex.Count);
            _setSlotsLeft = new int[_trackedIndex.Count][];
            foreach (var (id, idx) in _trackedIndex)
            {
                var left = new int[6];
                for (int d = 4; d >= 0; d--)
                    left[d] = left[d + 1] + (_order[d].List.Any(p => p.SetSkillIds.Contains(id)) ? 1 : 0);
                _setSlotsLeft[idx] = left;
            }
        }

        public SearchOutcome Execute()
        {
            int threads = 1;
            if (!_impossible)
            {
                int maxThreads = MaxThreads;
                long count = 0;
                var prefixes = _findBest && maxThreads > 1 ? Prefixes(out count) : null;
                if (prefixes is not null && count >= 32)
                {
                    threads = maxThreads;
                    try
                    {
                        Parallel.ForEach(
                            Partitioner.Create(prefixes, EnumerablePartitionerOptions.NoBuffering),
                            new ParallelOptions { MaxDegreeOfParallelism = threads, CancellationToken = _ct },
                            () => new Worker(this),
                            (prefix, loop, worker) =>
                            {
                                if (_stopped) loop.Stop();
                                else worker.RunPrefix(prefix);
                                return worker;
                            },
                            _ => { });
                    }
                    catch (AggregateException ex) when (ex.InnerExceptions.All(e => e is OperationCanceledException))
                    {
                        throw new OperationCanceledException(_ct);
                    }
                }
                else
                {
                    new Worker(this).Dfs(0);
                }
            }

            var results = _results.ToList();
            if (results.Count < _request.MaxResults)
                results.AddRange(_overflow.OrderByDescending(r => r, ResultOrder).Take(_request.MaxResults - results.Count));
            return new SearchOutcome(results.OrderByDescending(r => r, ResultOrder).ToList(), _timedOut, threads);
        }

        /// <summary>
        /// Work items for the threads: combinations of the first three armor slots (four when the lists are short, e.g.
        /// pinned armor), since a single pair can hold most of a search's work. Pairs go highest combined defense first
        /// so the shared bound tightens early; the rest follow each list's own defense order, generated lazily.
        /// </summary>
        private IEnumerable<ArmorPiece[]> Prefixes(out long count)
        {
            int depth = 3;
            count = _order[0].List.Count * _order[1].List.Count * (long)_order[2].List.Count;
            if (count < 4096)
            {
                depth = 4;
                count *= _order[3].List.Count;
            }
            var pairs = _order[0].List.SelectMany(a => _order[1].List.Select(b => (a, b)))
                .OrderByDescending(x => x.a.DefenseMax + x.b.DefenseMax)
                .ToList();
            return Expand(pairs, depth);
        }

        private IEnumerable<ArmorPiece[]> Expand(List<(ArmorPiece A, ArmorPiece B)> pairs, int depth)
        {
            foreach (var (a, b) in pairs)
                foreach (var c in _order[2].List)
                {
                    if (depth == 3)
                        yield return [a, b, c];
                    else
                        foreach (var d in _order[3].List)
                            yield return [a, b, c, d];
                }
        }

        private bool Full => _full;

        /// <summary>Whether a set with at most this defense / free slot points could still make the list.</summary>
        private bool CouldPlace(int defense, int slotPoints)
        {
            if (!_full) return true;
            long worst = Volatile.Read(ref _worstPacked);
            int worstDef = (int)(worst >> 32), worstSlots = (int)(worst & 0xFFFFFFFF);
            return defense > worstDef || (defense == worstDef && slotPoints > worstSlots);
        }

        private int WorstDefense => _full ? (int)(Volatile.Read(ref _worstPacked) >> 32) : int.MinValue;

        private void Offer(SearchResult r)
        {
            // Strictly below the worst listed set on (defense, free slots) can't get in; ties go on to the full order.
            if (_findBest && !CouldPlace(r.Defense, r.RemainingSlots.Sum() + 1))
                return;
            string key = _findBest ? SetBonusGroupKey(r) : "";
            lock (_lock)
            {
                if (!_findBest)
                {
                    if (_results.Count < _request.MaxResults) _results.Add(r);
                    if (_results.Count >= _request.MaxResults) _full = true;
                    return;
                }
                // Variety: at most 1 in 10 results share the same active set bonuses (otherwise the
                // highest-defense armor's variants fill the list). Sets bumped by the cap wait in overflow and
                // top the list up when there aren't enough distinct groups.
                int inGroup = 0, groupWorst = -1;
                for (int i = 0; i < _results.Count; i++)
                {
                    if (_groupKeys[i] != key) continue;
                    inGroup++;
                    if (groupWorst < 0 || Ranks(_results[i], _results[groupWorst]) < 0) groupWorst = i;
                }
                bool full = _results.Count >= _request.MaxResults;
                if (inGroup >= _perGroup)
                {
                    if (Ranks(r, _results[groupWorst]) > 0)
                    {
                        ToOverflow(_results[groupWorst]);
                        _results[groupWorst] = r;
                        if (full) FindWorst();
                    }
                    else if (!full)
                        ToOverflow(r);
                }
                else if (!full)
                {
                    _results.Add(r);
                    _groupKeys.Add(key);
                    if (_results.Count >= _request.MaxResults) FindWorst();
                }
                else if (Ranks(r, _results[_worstIndex]) > 0)
                {
                    _results[_worstIndex] = r;
                    _groupKeys[_worstIndex] = key;
                    FindWorst();
                }
            }
        }

        private void FindWorst()
        {
            _worstIndex = 0;
            for (int i = 1; i < _results.Count; i++)
                if (Ranks(_results[i], _results[_worstIndex]) < 0)
                    _worstIndex = i;
            var w = _results[_worstIndex];
            Volatile.Write(ref _worstPacked, ((long)w.Defense << 32) | (uint)w.RemainingSlots.Sum());
            _full = true;
        }

        private void ToOverflow(SearchResult r)
        {
            _overflow.Add(r);
            if (_overflow.Count > _request.MaxResults)
            {
                int w = 0;
                for (int i = 1; i < _overflow.Count; i++)
                    if (Ranks(_overflow[i], _overflow[w]) < 0) w = i;
                _overflow.RemoveAt(w);
            }
        }

        /// <summary>Per-thread search state: the armor picked so far and running totals.</summary>
        private sealed class Worker
        {
            private readonly SearchRun R;
            private readonly ArmorPiece?[] _picked = new ArmorPiece?[5];
            private readonly int[] _skillAcc = new int[1024];
            private readonly int[] _slotCount = new int[5];
            private readonly int[] _statAcc = new int[StatMinimums.Count];
            private readonly int[] _setCounts;
            private int _defAcc, _slotPointsAcc, _capacityAcc;
            private int _nodes;

            public Worker(SearchRun run)
            {
                R = run;
                _setCounts = new int[run._trackedIndex.Count];
            }

            /// <summary>Searches every set starting with these pieces for the first armor slots.</summary>
            public void RunPrefix(ArmorPiece[] prefix)
            {
                int depth = prefix.Length;
                if (R.Full)
                {
                    int defBound = R._bestRemaining[depth, 0], slotBound = R._slotPointsRemaining[depth] + R._weaponSlotPoints;
                    foreach (var p in prefix)
                    {
                        defBound += p.DefenseMax;
                        slotBound += p.Slots.Sum();
                    }
                    Span<int> levels = stackalloc int[StatBonuses.Count];
                    BonusLevelBound(0, levels);
                    if (!R.CouldPlace(StatBonuses.Defense(defBound, StatBonuses.DefenseTerms(levels)), slotBound)) return;
                }
                int entered = 0;
                bool reachable = true;
                while (reachable && entered < depth)
                {
                    reachable = Enter(entered, prefix[entered]);
                    entered++;
                }
                if (reachable) Dfs(depth);
                while (entered > 0)
                {
                    entered--;
                    Leave(entered, prefix[entered]);
                }
            }

            public void Dfs(int depth)
            {
                if (R._stopped || (!R._findBest && R.Full)) return;
                if ((++_nodes & 255) == 0)
                {
                    R._ct.ThrowIfCancellationRequested();
                    if (Environment.TickCount64 >= R._deadline)
                    {
                        R._timedOut = true;
                        R._stopped = true;
                        return;
                    }
                }
                if (depth == 5)
                {
                    Leaf();
                    return;
                }

                Span<int> levels = stackalloc int[StatBonuses.Count];
                BonusLevelBound(depth, levels);
                var terms = StatBonuses.DefenseTerms(levels);
                foreach (var piece in R._order[depth].List)
                {
                    if (R._stopped || (!R._findBest && R.Full)) break;
                    if (R._findBest && R.Full)
                    {
                        int defBound = StatBonuses.Defense(_defAcc + piece.DefenseMax + R._bestRemaining[depth + 1, 0], terms);
                        if (defBound < R.WorstDefense) break;
                        int slotBound = _slotPointsAcc + piece.Slots.Sum() + R._slotPointsRemaining[depth + 1] + R._weaponSlotPoints;
                        if (!R.CouldPlace(defBound, slotBound)) continue;
                    }
                    if (Enter(depth, piece))
                        Dfs(depth + 1);
                    Leave(depth, piece);
                }
            }

            /// <summary>Adds the piece; false when the partial set can no longer meet the request. Always pair with Leave.</summary>
            private bool Enter(int depth, ArmorPiece piece)
            {
                _picked[depth] = piece;
                if (R._anyFloor)
                    for (int k = 0; k < StatMinimums.Count; k++) _statAcc[k] += StatMinimums.Stat(piece, k);
                ApplySkills(_skillAcc, piece.Skills, +1);
                foreach (var s in piece.Slots)
                    if (s is >= 1 and <= 4)
                    {
                        _slotCount[s]++;
                        _slotPointsAcc += s;
                        _capacityAcc += R._capBySize[s];
                    }
                _defAcc += piece.DefenseMax;
                foreach (var id in piece.SetSkillIds)
                    if (R._trackedIndex.TryGetValue(id, out var idx)) _setCounts[idx]++;

                int next = depth + 1;
                return (!R._anyFloor || FloorsReachable(next))
                    && (R._minFreePoints == 0 || FreeSlotsReachable(next))
                    && (_setCounts.Length == 0 || SetsReachable(next))
                    && SkillsReachable(next);
            }

            private void Leave(int depth, ArmorPiece piece)
            {
                foreach (var id in piece.SetSkillIds)
                    if (R._trackedIndex.TryGetValue(id, out var idx)) _setCounts[idx]--;
                _defAcc -= piece.DefenseMax;
                foreach (var s in piece.Slots)
                    if (s is >= 1 and <= 4)
                    {
                        _slotCount[s]--;
                        _slotPointsAcc -= s;
                        _capacityAcc -= R._capBySize[s];
                    }
                ApplySkills(_skillAcc, piece.Skills, -1);
                if (R._anyFloor)
                    for (int k = 0; k < StatMinimums.Count; k++) _statAcc[k] -= StatMinimums.Stat(piece, k);
                _picked[depth] = null;
            }

            private bool FloorsReachable(int next)
            {
                Span<int> levels = stackalloc int[StatBonuses.Count];
                BonusLevelBound(next, levels);
                for (int k = 0; k < StatMinimums.Count; k++)
                {
                    if (R._floors[k] is not int min) continue;
                    int best = _statAcc[k] + R._bestRemaining[next, k];
                    best = k == 0
                        ? StatBonuses.Defense(best, StatBonuses.DefenseTerms(levels))
                        : best + StatBonuses.ResistBonus(levels, k - 1);
                    if (best < min) return false;
                }
                return true;
            }

            /// <summary>Most levels each bonus skill can reach from the armor picked so far plus depths from <paramref name="next"/> on.</summary>
            private void BonusLevelBound(int next, Span<int> levels)
            {
                for (int i = 0; i < StatBonuses.Count; i++)
                {
                    int id = R._bonusIds[i];
                    levels[i] = id < 0 || R._bonusOpen[i]
                        ? R._bonusCap[i]
                        : Math.Min(R._bonusCap[i], Math.Max(0, _skillAcc[id]) + R._bonusRemaining[next, i]);
                }
            }

            private bool FreeSlotsReachable(int next)
            {
                int atLeast = 0;
                for (int lv = 4; lv >= 1; lv--)
                {
                    atLeast += _slotCount[lv];
                    if (R._needAtLeast[lv] > 0 && atLeast + R._weaponAtLeast[lv] + R._bestAtLeast[next, lv] < R._needAtLeast[lv])
                        return false;
                }
                return true;
            }

            private bool SetsReachable(int next)
            {
                int Reach(int id) => _setCounts[R._trackedIndex[id]] + R._setSlotsLeft[R._trackedIndex[id]][next];
                foreach (var (id, parts) in R._wantedSetBonusParts)
                    if (Reach(id) < parts) return false;
                foreach (var effect in R._wantedSetEffects)
                {
                    bool any = false;
                    foreach (var s in effect.Sources)
                        if (Reach(s.SetBonusId) >= s.RequiredParts) { any = true; break; }
                    if (!any) return false;
                }
                return true;
            }

            /// <summary>
            /// Optimistic: best remaining armor, best charm and a granting set bonus for every skill at once. What's
            /// still missing must fit in jewels: at least one slot point per level, and no more levels than the slots' capacity.
            /// </summary>
            private bool SkillsReachable(int next)
            {
                int missing = 0, useful = 0;
                for (int k = 0; k < R._needIds.Length; k++)
                {
                    int need = R._needLevels[k];
                    int cap = R._optCaps[k];
                    int acc = Math.Max(0, _skillAcc[R._needIds[k]]);
                    useful += Math.Min(need, acc);
                    int have = Math.Min(cap, acc + R._skillRemaining[next, k] + R._charmBest[k]);
                    if (have < need && R._grantBest[k] > 0)
                        have = Math.Min(cap, have + R._grantBest[k]);
                    if (have < need) missing += need - have;
                }
                // Each remaining piece counted once: its wanted levels plus what its slots can hold.
                if (useful + R._valueRemaining[next] + _capacityAcc + R._weaponCapacity + R._charmBestTotal + R._grantTotal
                    - R._minFreeCapacity < R._needTotal)
                    return false;
                if (missing == 0 && R._minFreePoints == 0) return true;
                int slotPoints = _slotPointsAcc + R._weaponSlotPoints + R._slotPointsRemaining[next];
                if (slotPoints - R._minFreePoints < missing) return false;
                int capacity = _capacityAcc + R._weaponCapacity + R._capacityRemaining[next];
                return capacity - R._minFreeCapacity >= missing;
            }

            /// <summary>Cheap reject before filling jewels: this set's slots can't hold what's still missing with this charm.</summary>
            /// <param name="minUsed">Fewest slot points the jewels still needed can take.</param>
            private bool CharmCanWork(CharmRank charm, Dictionary<int, int> caps, int[] setSlotCount, out int minUsed)
            {
                int missing = 0;
                double cost = 0;
                minUsed = 0;
                for (int k = 0; k < R._needIds.Length; k++)
                {
                    int id = R._needIds[k];
                    int lv = _skillAcc[id];
                    foreach (var s in charm.Skills)
                        if (s.SkillId == id) lv += s.Level;
                    int miss = R._needLevels[k] - Math.Min(caps[id], Math.Max(0, lv));
                    if (miss <= 0) continue;
                    missing += miss;
                    cost += miss * R._costPerLevel[k];
                    int room = 0;
                    for (int size = 1; size <= 4; size++) room += setSlotCount[size] * R._skillCapBySize[k, size];
                    if (room < miss) return false;
                }
                if (missing == 0) return true;
                minUsed = Math.Max(missing, (int)Math.Ceiling(cost - 1e-9));
                int capacity = 0, points = 0;
                for (int size = 1; size <= 4; size++)
                {
                    capacity += setSlotCount[size] * R._capBySize[size];
                    points += setSlotCount[size] * size;
                }
                return capacity - R._minFreeCapacity >= missing && points - R._minFreePoints >= missing;
            }

            private void Leaf()
            {
                var pieces = new ArmorPiece[5];
                for (int i = 0; i < 5; i++)
                    pieces[(int)R._order[i].Slot] = _picked[i]!;
                var catalog = R._catalog;

                var granted = R._s.EvaluateSetBonuses(pieces, out var activeSetBonuses);
                if (!MeetsWantedSetRequirements(pieces, R._wantedSetEffects, R._wantedSetBonusParts)
                    || granted.Any(g => R._excludedSkills.Contains(g.SkillId))
                    || activeSetBonuses.Any(b => R._excludedSkills.Contains(b.Id)))
                    return;

                catalog.ResolveRaisedCaps(pieces, out var raisedSkills, out var raisesAllCaps);
                var effectiveCaps = new Dictionary<int, int>(R._wantedSkills.Count);
                foreach (var (id, need) in R._wantedSkills)
                {
                    int cap = catalog.EffectiveMaxLevel(id, raisesAllCaps || raisedSkills.Contains(id));
                    // A wanted level above the cap needs a Secret this armor doesn't unlock.
                    if (need > cap) return;
                    effectiveCaps[id] = cap;
                }

                var labeledSlots = new List<(string Location, int Size)>(16);
                void AddSlots(string loc, int[] sizes)
                {
                    foreach (var s in sizes)
                        if (s > 0) labeledSlots.Add((loc, s));
                }
                AddSlots("Head", pieces[0].Slots);
                AddSlots("Chest", pieces[1].Slots);
                AddSlots("Gloves", pieces[2].Slots);
                AddSlots("Waist", pieces[3].Slots);
                AddSlots("Legs", pieces[4].Slots);
                AddSlots("Weapon", R._weaponSlots);
                var setSlotCount = new int[5];
                foreach (var (_, size) in labeledSlots)
                    if (size <= 4) setSlotCount[size]++;

                int totalPoints = labeledSlots.Sum(s => s.Size);
                Span<int> levels = stackalloc int[StatBonuses.Count];
                BonusLevelBound(5, levels);
                int defBound = StatBonuses.Defense(_defAcc, StatBonuses.DefenseTerms(levels));
                var minimums = R._request.Minimums;
                (CharmRank Charm, List<DecorationPlacement> Placements, int[] Remaining)? best = null;
                int bestFree = -1;
                ApplySkills(_skillAcc, granted, +1);
                try
                {
                    // Best-results mode keeps one entry per armor set: the charm leaving the most free slot points
                    // (then fewest jewels). The jewels a charm still needs bound what it can leave free.
                    foreach (var ch in R._charms)
                    {
                        if (!R._findBest && R.Full) break;
                        if (!CharmCanWork(ch, effectiveCaps, setSlotCount, out int minUsed)) continue;
                        if (R._findBest && (totalPoints - minUsed < bestFree || !R.CouldPlace(defBound, totalPoints - minUsed)))
                            continue;
                        ApplySkills(_skillAcc, ch.Skills, +1);
                        bool filled = R._s.TryFillDecorationsKeepingFree(_skillAcc, R._wantedSkills, effectiveCaps, labeledSlots,
                            R._request.MinFreeSlots, R._request.OwnedDecorations, R._excludedSkills, out var placements, out var remainingSlots)
                            && (minimums is null || R._s.MeetsMinimums(minimums, pieces, _skillAcc, placements, raisedSkills, raisesAllCaps));
                        ApplySkills(_skillAcc, ch.Skills, -1);
                        if (!filled) continue;

                        if (!R._findBest)
                        {
                            R.Offer(BuildResult(pieces, ch, granted, activeSetBonuses, placements, remainingSlots, raisedSkills, raisesAllCaps));
                            continue;
                        }
                        int free = remainingSlots.Sum();
                        if (best is { } b && (free < bestFree
                            || (free == bestFree && (placements.Count > b.Placements.Count
                                || (placements.Count == b.Placements.Count && (ch.CharmId, ch.Level).CompareTo((b.Charm.CharmId, b.Charm.Level)) >= 0)))))
                            continue;
                        best = (ch, placements, remainingSlots);
                        bestFree = free;
                        if (bestFree == totalPoints) break;
                    }
                }
                finally
                {
                    ApplySkills(_skillAcc, granted, -1);
                }
                if (best is { } win)
                    R.Offer(BuildResult(pieces, win.Charm, granted, activeSetBonuses, win.Placements, win.Remaining, raisedSkills, raisesAllCaps));
            }

            private SearchResult BuildResult(
                ArmorPiece[] pieces,
                CharmRank charm,
                SkillPoint[] granted,
                List<ActiveSetBonus> activeSetBonuses,
                List<DecorationPlacement> placements,
                int[] remainingSlots,
                HashSet<int> raisedSkills,
                bool raisesAllCaps)
            {
                var usedDecos = placements.Select(p => p.Decoration).ToList();
                var final = new Dictionary<int, int>();
                foreach (var p in pieces) Accumulate(final, p.Skills);
                Accumulate(final, granted);
                Accumulate(final, charm.Skills);
                foreach (var d in usedDecos) Accumulate(final, d.Skills);
                // Soft cap without Secret; hard cap with Secret / Inheritance.
                foreach (var id in final.Keys.ToList())
                    final[id] = R._catalog.CapSkill(id, final[id], raisesAllCaps || raisedSkills.Contains(id));
                foreach (var id in final.Keys.Where(k => final[k] <= 0).ToList())
                    final.Remove(id);

                var (armorDefense, armorResists) = ArmorTotals(pieces);
                var (defense, resists) = R._catalog.StatBonuses.Apply(armorDefense, armorResists, final);
                return new SearchResult(
                    pieces[0], pieces[1], pieces[2], pieces[3], pieces[4],
                    charm,
                    usedDecos,
                    placements,
                    final,
                    defense,
                    resists,
                    remainingSlots,
                    R._weaponName,
                    R._weaponSlots,
                    R._weaponType,
                    R._weaponRarity,
                    activeSetBonuses,
                    R._weaponType is null ? null : R._request.WeaponId,
                    armorDefense,
                    armorResists);
            }
        }
    }
}
