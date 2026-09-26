using MHBuilder.Models;
using MHBuilder.Search;

namespace MHBuilder.Tests;

[Collection(CatalogCollection.Name)]
public sealed class SetSearcherTests(CatalogFixture fixture)
{
    private static readonly (string, int)[] Typical =
        [("Weakness Exploit", 3), ("Critical Eye", 5), ("Attack Boost", 4), ("Critical Boost", 3)];

    private void AssertAllValid(SearchRequest request, IReadOnlyList<SearchResult> results)
    {
        Assert.All(results, r => Assert.Null(SearchBench.Validate(fixture.Catalog, request, r)));
    }

    [Fact]
    public void Typical_request_finds_valid_sets_best_first()
    {
        var request = fixture.Request(Typical);
        var results = fixture.Searcher.Search(request);

        Assert.Equal(request.MaxResults, results.Count);
        AssertAllValid(request, results);
        var order = results.Select(r => (r.Defense, Free: r.RemainingSlots.Sum())).ToList();
        Assert.Equal(order.OrderByDescending(x => x.Defense).ThenByDescending(x => x.Free), order);
    }

    [Fact]
    public void Set_effect_request_wears_enough_pieces_of_a_qualifying_set()
    {
        var request = fixture.Request(("Master's Touch", 1), ("Critical Eye", 7), ("Weakness Exploit", 3));
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        AssertAllValid(request, results);
    }

    [Fact]
    public void Levels_above_the_soft_cap_come_with_a_secret_set_bonus()
    {
        var request = fixture.Request(("Agitator", 7), ("Weakness Exploit", 3));
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        AssertAllValid(request, results);
        int agitator = fixture.SkillId("Agitator");
        Assert.All(results, r => Assert.Equal(7, r.FinalSkills[agitator]));
    }

    [Fact]
    public void Owned_decorations_are_never_overused()
    {
        var owned = fixture.Catalog.Decorations.ToDictionary(d => d.Id, d => d.Id % 2);
        var request = fixture.Request(Typical) with { OwnedDecorations = owned };
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        AssertAllValid(request, results);
    }

    [Fact]
    public void Excluded_and_pinned_armor_are_respected()
    {
        var first = fixture.Searcher.Search(fixture.Request(Typical));
        int excluded = first[0].Chest.Id;
        int pinnedHead = first[0].Head.Id;

        var request = fixture.Request(Typical) with
        {
            ExcludeArmorIds = new HashSet<int> { excluded },
            PinnedArmor = new Dictionary<ArmorSlot, int> { [ArmorSlot.Head] = pinnedHead },
        };
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        Assert.All(results, r =>
        {
            Assert.NotEqual(excluded, r.Chest.Id);
            Assert.Equal(pinnedHead, r.Head.Id);
        });
    }

    [Fact]
    public void Excluded_skills_never_show_up()
    {
        int excluded = fixture.SkillId("Critical Draw");
        var request = fixture.Request(Typical) with { ExcludedSkillIds = new HashSet<int> { excluded } };
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        Assert.All(results, r => Assert.False(r.FinalSkills.ContainsKey(excluded)));
    }

    [Fact]
    public void Free_slots_and_stat_floors_are_kept()
    {
        var request = fixture.Request(Typical) with
        {
            MinFreeSlots = [0, 0, 0, 1],
            Minimums = new StatMinimums(null, 5, null, null, null, null),
        };
        var results = fixture.Searcher.Search(request);

        Assert.NotEmpty(results);
        AssertAllValid(request, results);
    }

    [Fact]
    public void Impossible_request_returns_nothing_without_timing_out()
    {
        var request = fixture.Request(
            ("Critical Eye", 7), ("Attack Boost", 7), ("Weakness Exploit", 3), ("Critical Boost", 3), ("Agitator", 5),
            ("Health Boost", 3), ("Divine Blessing", 3), ("Evade Window", 5), ("Handicraft", 5), ("Earplugs", 5))
            with { WeaponSlots = [], ArmorRarities = new HashSet<int> { 1 } };
        var outcome = fixture.Searcher.SearchDetailed(request);

        Assert.Empty(outcome.Results);
        Assert.False(outcome.TimedOut);
    }

    [Fact]
    public void Tiny_time_limit_still_returns_valid_sets()
    {
        var request = fixture.Request(Typical) with { TimeLimitMs = 1 };
        var outcome = fixture.Searcher.SearchDetailed(request);

        AssertAllValid(request, outcome.Results);
    }

    [Fact]
    public void Cancellation_stops_the_search()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(() => fixture.Searcher.Search(fixture.Request(Typical), cts.Token));
    }

    [Theory]
    [InlineData(new string[0], new int[0])]
    [InlineData(new[] { "Critical Eye" }, new[] { 8 })]
    [InlineData(new[] { "Critical Eye" }, new[] { 0 })]
    public void Invalid_requests_are_rejected(string[] skills, int[] levels)
    {
        var request = new SearchRequest(
            skills.Zip(levels).ToDictionary(x => fixture.SkillId(x.First), x => x.Second), [4, 2, 1]);
        Assert.Throws<ArgumentException>(() => fixture.Searcher.Search(request));
    }

    [Fact]
    public void Evaluated_build_totals_its_skills()
    {
        var best = fixture.Searcher.Search(fixture.Request(Typical))[0];
        var pieces = new Dictionary<ArmorSlot, ArmorPiece>
        {
            [ArmorSlot.Head] = best.Head,
            [ArmorSlot.Chest] = best.Chest,
            [ArmorSlot.Gloves] = best.Gloves,
            [ArmorSlot.Waist] = best.Waist,
            [ArmorSlot.Legs] = best.Legs,
        };
        var evaluated = fixture.Searcher.EvaluateBuild(pieces, best.Charm, best.Decorations, [4, 2, 1]);

        Assert.Equal(best.Defense, evaluated.Defense);
        Assert.Equal(best.FinalSkills.OrderBy(kv => kv.Key), evaluated.FinalSkills.OrderBy(kv => kv.Key));
    }
}

[Collection(SerialCollection.Name)]
public sealed class ParallelSearchTests(CatalogFixture fixture)
{
    [Fact]
    public void Threads_do_not_change_the_best_sets()
    {
        var request = fixture.Request(("Weakness Exploit", 3), ("Critical Eye", 7), ("Attack Boost", 5), ("Critical Boost", 3));
        int saved = SetSearcher.MaxThreads;
        try
        {
            SetSearcher.MaxThreads = 1;
            var single = fixture.Searcher.SearchDetailed(request);
            SetSearcher.MaxThreads = Math.Max(4, Environment.ProcessorCount);
            var parallel = fixture.Searcher.SearchDetailed(request);

            Assert.Equal(1, single.Threads);
            static List<(int, int)> Scores(SearchOutcome o) => o.Results.Select(r => (r.Defense, r.RemainingSlots.Sum())).ToList();
            Assert.Equal(Scores(single), Scores(parallel));
        }
        finally
        {
            SetSearcher.MaxThreads = saved;
        }
    }
}
