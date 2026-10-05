using MHBuilder.Catalog;

namespace MHBuilder.Web;

/// <summary>Monster reference data for the Monsters view.</summary>
public static class MonsterEndpoints
{
    public static void MapMonsterEndpoints(this WebApplication app)
    {
        app.MapGet("/api/monsters", (MonstersCatalog monsters) => Results.Bytes(monsters.Json, "application/json"));
    }
}
