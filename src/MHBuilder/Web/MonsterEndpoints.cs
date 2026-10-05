using System.Text.Json;
using MHBuilder.Catalog;

namespace MHBuilder.Web;

/// <summary>Monster reference data for the Monsters view.</summary>
public static class MonsterEndpoints
{
    private static readonly string[] RankOrder = ["LR", "HR", "MR"];

    public static void MapMonsterEndpoints(this WebApplication app)
    {
        app.MapGet("/api/monsters", (MonstersCatalog monsters) => Results.Bytes(monsters.Json, "application/json"));

        app.MapGet("/api/monsters/drops", (string name, MaterialsCatalog mats) =>
        {
            static string? Text(JsonElement e, string key) => e.TryGetProperty(key, out var v) ? v.GetString() : null;
            static int BestChance(JsonElement drops) => drops.EnumerateArray().Max(d => d[1].GetInt32());

            var ranks = mats.MonsterDrops(name)
                .Where(d => mats.Item(d.ItemId) is not null)
                .GroupBy(d => d.Rank)
                .OrderBy(g => Array.IndexOf(RankOrder, g.Key) is var i and >= 0 ? i : RankOrder.Length)
                .Select(g => new
                {
                    rank = g.Key,
                    items = g
                        .Select(d => (d, item: mats.Item(d.ItemId)!.Value))
                        .OrderByDescending(x => BestChance(x.d.Drops))
                        .ThenBy(x => x.item.TryGetProperty("rarity", out var r) ? r.GetInt32() : 0)
                        .Select(x => new
                        {
                            id = x.d.ItemId,
                            name = Text(x.item, "name"),
                            rarity = x.item.TryGetProperty("rarity", out var r) ? r.GetInt32() : 0,
                            icon = Text(x.item, "icon"),
                            color = Text(x.item, "color"),
                            drops = x.d.Drops
                        })
                        .ToList()
                })
                .ToList();
            return Results.Json(new { ranks });
        });
    }
}
