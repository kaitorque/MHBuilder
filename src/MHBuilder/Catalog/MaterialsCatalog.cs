using System.Text.Json;

namespace MHBuilder.Catalog;

/// <summary>
/// Crafting recipes and material sources from data/materials.json (tools/dump/build_materials.py).
/// Item details are passed through to the client as-is.
/// </summary>
public sealed class MaterialsCatalog
{
    public sealed record Recipe(int Zenny, IReadOnlyList<(int ItemId, int Quantity)> Items);

    /// <summary>ForgeItems: crafted from scratch. UpgradeItems: upgrade from Parent. Source: "Kulve" / "Safi" siege reward.</summary>
    public sealed record WeaponNode(
        int Zenny,
        IReadOnlyList<(int ItemId, int Quantity)>? ForgeItems,
        IReadOnlyList<(int ItemId, int Quantity)>? UpgradeItems,
        int? Parent,
        string? Source);

    /// <summary>One step of a weapon path: forge WeaponId from scratch, or upgrade into it.</summary>
    public sealed record WeaponStep(int WeaponId, bool Forge, Recipe Recipe);

    /// <summary>An item a monster drops at one rank; Drops is the raw [[condition, percent, quantity], ...] list.</summary>
    public sealed record MonsterDrop(int ItemId, string Rank, JsonElement Drops);

    private readonly Dictionary<int, Recipe> _armor = new();
    private readonly Dictionary<string, Recipe> _charms = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, WeaponNode> _weapons = new();
    private readonly Dictionary<int, JsonElement> _items = new();
    private readonly Dictionary<string, List<MonsterDrop>> _dropsByMonster = new(StringComparer.OrdinalIgnoreCase);

    public bool Loaded { get; }

    private MaterialsCatalog(JsonDocument? doc)
    {
        if (doc is null) return;
        var root = doc.RootElement;
        foreach (var p in root.GetProperty("armor").EnumerateObject())
            _armor[int.Parse(p.Name)] = ReadRecipe(p.Value);
        foreach (var p in root.GetProperty("charms").EnumerateObject())
            _charms[p.Name] = ReadRecipe(p.Value);
        if (root.TryGetProperty("weapons", out var weapons))
        {
            foreach (var p in weapons.EnumerateObject())
            {
                var e = p.Value;
                _weapons[int.Parse(p.Name)] = new WeaponNode(
                    e.GetProperty("zenny").GetInt32(),
                    e.TryGetProperty("forgeItems", out var f) ? ReadItems(f) : null,
                    e.TryGetProperty("items", out var u) ? ReadItems(u) : null,
                    e.TryGetProperty("parent", out var parent) ? parent.GetInt32() : null,
                    e.TryGetProperty("source", out var s) ? s.GetString() : null);
            }
        }
        foreach (var p in root.GetProperty("items").EnumerateObject())
            _items[int.Parse(p.Name)] = p.Value.Clone();
        foreach (var (id, item) in _items)
        {
            if (!item.TryGetProperty("sources", out var sources) || sources.ValueKind != JsonValueKind.Object
                || !sources.TryGetProperty("monsters", out var monsters))
                continue;
            foreach (var m in monsters.EnumerateArray())
            {
                string? name = m.GetProperty("monster").GetString();
                if (string.IsNullOrEmpty(name)) continue;
                if (!_dropsByMonster.TryGetValue(name, out var list))
                    _dropsByMonster[name] = list = [];
                list.Add(new MonsterDrop(id, m.GetProperty("rank").GetString() ?? "", m.GetProperty("drops")));
            }
        }
        Loaded = true;
    }

    public static MaterialsCatalog Load(string dataDirectory)
    {
        string path = Path.Combine(dataDirectory, "materials.json");
        if (!File.Exists(path))
            return new MaterialsCatalog(null);
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        return new MaterialsCatalog(doc);
    }

    public Recipe? ArmorRecipe(int armorId) => _armor.GetValueOrDefault(armorId);

    public Recipe? CharmRecipe(string rankName) => _charms.GetValueOrDefault(rankName);

    public JsonElement? Item(int itemId) => _items.TryGetValue(itemId, out var e) ? e : null;

    public WeaponNode? Weapon(int weaponId) => _weapons.GetValueOrDefault(weaponId);

    public IReadOnlyList<MonsterDrop> MonsterDrops(string monster) => _dropsByMonster.GetValueOrDefault(monster) ?? [];

    /// <summary>
    /// Cheapest way to get a weapon from nothing: forge the nearest forgeable ancestor, then upgrade down to it.
    /// Complete is false when the tree ends without a forge recipe (siege rewards, missing data).
    /// </summary>
    public (IReadOnlyList<WeaponStep> Steps, bool Complete) WeaponPath(int weaponId)
    {
        var steps = new List<WeaponStep>();
        var seen = new HashSet<int>();
        int? id = weaponId;
        while (id is int current && seen.Add(current) && _weapons.TryGetValue(current, out var node))
        {
            if (node.ForgeItems is not null)
            {
                steps.Add(new WeaponStep(current, true, new Recipe(node.Zenny, node.ForgeItems)));
                steps.Reverse();
                return (steps, true);
            }
            if (node.UpgradeItems is null) break;
            steps.Add(new WeaponStep(current, false, new Recipe(node.Zenny, node.UpgradeItems)));
            id = node.Parent;
        }
        steps.Reverse();
        return (steps, false);
    }

    private static Recipe ReadRecipe(JsonElement e) => new(e.GetProperty("zenny").GetInt32(), ReadItems(e.GetProperty("items")));

    private static List<(int ItemId, int Quantity)> ReadItems(JsonElement items) =>
        items.EnumerateArray().Select(x => (x[0].GetInt32(), x[1].GetInt32())).ToList();
}
