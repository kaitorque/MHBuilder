using System.Text.Json;
using MHBuilder.Catalog;

namespace MHBuilder.Tests;

[Collection(CatalogCollection.Name)]
public sealed class CatalogTests(CatalogFixture fixture)
{
    private readonly GameCatalog _catalog = fixture.Catalog;

    [Fact]
    public void Counts_match_the_recorded_export()
    {
        using var source = JsonDocument.Parse(File.ReadAllText(Path.Combine(CatalogPaths.FindDataDir(), "SOURCE.json")));
        var counts = source.RootElement.GetProperty("counts");

        Assert.Equal(counts.GetProperty("skills").GetInt32(), _catalog.Skills.Count);
        Assert.Equal(counts.GetProperty("armor").GetInt32(), _catalog.Armor.Count);
        Assert.Equal(counts.GetProperty("decorations").GetInt32(), _catalog.Decorations.Count);
        Assert.Equal(counts.GetProperty("weapons").GetInt32(), _catalog.Weapons.Count);
    }

    [Fact]
    public void Every_skill_reference_resolves()
    {
        var skillIds = _catalog.SkillsById.Keys.ToHashSet();
        Assert.All(_catalog.Armor.SelectMany(a => a.Skills), s => Assert.Contains(s.SkillId, skillIds));
        Assert.All(_catalog.Decorations.SelectMany(d => d.Skills), s => Assert.Contains(s.SkillId, skillIds));
        Assert.All(_catalog.Charms.SelectMany(c => c.Skills), s => Assert.Contains(s.SkillId, skillIds));
    }

    [Fact]
    public void Armor_and_decorations_have_sane_values()
    {
        Assert.All(_catalog.Armor, a =>
        {
            Assert.InRange(a.Rarity, 1, 12);
            Assert.True(a.DefenseMax > 0, $"{a.Name} has no defense");
            Assert.All(a.Slots, s => Assert.InRange(s, 0, 4));
        });
        Assert.All(_catalog.Decorations, d => Assert.InRange(d.SlotSize, 1, 4));
        Assert.All(_catalog.Weapons, w => Assert.All(w.Slots, s => Assert.InRange(s, 0, 4)));
    }

    [Fact]
    public void Skill_caps_are_consistent()
    {
        Assert.All(_catalog.Skills.Where(s => !s.IsSetBonus), s =>
            Assert.True(s.BaseMaxLevel <= s.MaxLevel, $"{s.Name}: base cap {s.BaseMaxLevel} above max {s.MaxLevel}"));
    }

    [Fact]
    public void Materials_catalog_loads_with_recipes()
    {
        var materials = MaterialsCatalog.Load(CatalogPaths.FindDataDir());
        Assert.True(materials.Loaded);
        int withRecipe = _catalog.Armor.Count(a => materials.ArmorRecipe(a.Id) is not null);
        Assert.True(withRecipe > _catalog.Armor.Count * 9 / 10, $"only {withRecipe} armor pieces have a recipe");
    }
}
