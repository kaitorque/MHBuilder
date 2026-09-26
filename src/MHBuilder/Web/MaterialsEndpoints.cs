using MHBuilder.Catalog;

namespace MHBuilder.Web;

/// <summary>Crafting cost of a set: armor recipes, every charm rank and the weapon's forge / upgrade path.</summary>
public static class MaterialsEndpoints
{
    public static void MapMaterialsEndpoints(this WebApplication app)
    {
        app.MapPost("/api/materials", (MaterialsApiRequest body, GameCatalog cat, MaterialsCatalog mats) =>
        {
            var itemIds = new HashSet<int>();
            object? RecipeDto(MaterialsCatalog.Recipe? r)
            {
                if (r is null) return null;
                foreach (var (id, _) in r.Items) itemIds.Add(id);
                return r.Items.Select(x => new { id = x.ItemId, quantity = x.Quantity });
            }

            var pieces = (body.ArmorIds ?? [])
                .Distinct()
                .Where(cat.ArmorById.ContainsKey)
                .Select(id =>
                {
                    var a = cat.ArmorById[id];
                    var r = mats.ArmorRecipe(id);
                    return new
                    {
                        a.Id,
                        a.Name,
                        slot = a.Slot.ToString().ToLowerInvariant(),
                        set = a.ArmorSetName,
                        a.Rarity,
                        zenny = r?.Zenny ?? 0,
                        items = RecipeDto(r)
                    };
                })
                .ToList();

            object? charm = null;
            if (body.CharmId is int charmId)
            {
                var ranks = (cat.CharmRanksById.GetValueOrDefault(charmId) ?? [])
                    .Where(c => c.Level <= (body.CharmLevel ?? int.MaxValue))
                    .ToList();
                if (ranks.Count > 0)
                    charm = new
                    {
                        name = ranks[^1].Name,
                        level = ranks[^1].Level,
                        rarity = ranks[^1].Rarity,
                        ranks = ranks.Select(c =>
                        {
                            var r = mats.CharmRecipe(c.Name);
                            return new { c.Level, c.Name, c.Rarity, zenny = r?.Zenny ?? 0, items = RecipeDto(r) };
                        }).ToList()
                    };
            }

            object? weapon = null;
            if (body.WeaponId is int weaponId && cat.WeaponsById.TryGetValue(weaponId, out var w))
            {
                var (steps, complete) = mats.WeaponPath(weaponId);
                weapon = new
                {
                    w.Id,
                    w.Name,
                    w.Type,
                    w.Rarity,
                    complete,
                    source = mats.Weapon(weaponId)?.Source,
                    steps = steps.Select(s =>
                    {
                        var step = cat.WeaponsById.GetValueOrDefault(s.WeaponId);
                        return new
                        {
                            id = s.WeaponId,
                            name = step?.Name ?? $"Weapon {s.WeaponId}",
                            rarity = step?.Rarity ?? 0,
                            forge = s.Forge,
                            zenny = s.Recipe.Zenny,
                            items = RecipeDto(s.Recipe)
                        };
                    }).ToList()
                };
            }

            return Results.Json(new
            {
                available = mats.Loaded,
                pieces,
                charm,
                weapon,
                items = itemIds.Where(id => mats.Item(id) is not null)
                    .ToDictionary(id => id.ToString(), id => mats.Item(id)!.Value)
            });
        });
    }
}
