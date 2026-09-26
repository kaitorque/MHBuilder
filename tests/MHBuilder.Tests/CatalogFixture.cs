using MHBuilder.Catalog;
using MHBuilder.Models;
using MHBuilder.Search;

namespace MHBuilder.Tests;

/// <summary>The real catalog (data/*.json), loaded once for every test that needs it.</summary>
public sealed class CatalogFixture
{
    public GameCatalog Catalog { get; } = GameCatalog.Load(CatalogPaths.FindDataDir());

    public SetSearcher Searcher => new(Catalog);

    public int SkillId(string name) => SearchBench.ResolveSkill(Catalog, name);

    public SearchRequest Request(params (string Skill, int Level)[] skills) => new(
        skills.ToDictionary(s => SkillId(s.Skill), s => s.Level),
        [4, 2, 1],
        MaxResults: 20,
        TimeLimitMs: 30_000);
}

[CollectionDefinition(Name)]
public sealed class CatalogCollection : ICollectionFixture<CatalogFixture>
{
    public const string Name = "Catalog";
}

/// <summary>Tests that change process-wide settings (e.g. search thread count) run alone.</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SerialCollection : ICollectionFixture<CatalogFixture>
{
    public const string Name = "Serial";
}
