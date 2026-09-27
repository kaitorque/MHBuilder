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
        Assert.Equal(counts.GetProperty("armor").GetInt32(), _catalog.ArmorById.Count);
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
    public void Identical_sets_are_merged_under_both_names()
    {
        var defender = _catalog.Armor.Where(a => a.ArmorSetName == "Defender α / Guardian α+").ToList();
        Assert.Equal(5, defender.Count);
        Assert.DoesNotContain(_catalog.Armor, a => a.Name.StartsWith("Guardian"));

        var guardianHelm = _catalog.ArmorById[442];
        Assert.Equal("Defender Helm α / Guardian Helm α+", guardianHelm.Name);
        Assert.Contains(guardianHelm, defender);
        Assert.Equal(guardianHelm.Id, _catalog.CanonicalArmorId(442));
    }

    [Fact]
    public void No_two_sets_are_identical_except_by_gender()
    {
        string Key(IEnumerable<Models.ArmorPiece> pieces, bool withGender) => string.Join("\n", pieces
            .OrderBy(p => p.Slot)
            .Select(p => $"{p.Slot}|{p.Rank}|{p.Rarity}|{p.DefenseMax}|{p.Resistances}|{string.Join("-", p.Slots)}|" +
                         $"{string.Join(",", p.Skills.OrderBy(s => s.SkillId).Select(s => $"{s.SkillId}:{s.Level}"))}|" +
                         $"{string.Join(",", p.SetSkillIds.Order())}|{(withGender ? p.Gender : "")}"));
        var sets = _catalog.Armor.Where(a => a.ArmorSetId is not null).GroupBy(a => a.ArmorSetId).ToList();

        Assert.Equal(sets.Count, sets.Select(s => Key(s, withGender: true)).Distinct().Count());
        Assert.True(sets.Select(s => Key(s, withGender: false)).Distinct().Count() < sets.Count,
            "King Beetle and Butterfly should stay separate sets");
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
