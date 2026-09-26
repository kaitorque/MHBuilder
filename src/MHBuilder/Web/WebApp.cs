using MHBuilder.Catalog;
using MHBuilder.Search;

namespace MHBuilder.Web;

public static class WebApp
{
    /// <summary>Address used when nothing is configured (ASPNETCORE_URLS, ASPNETCORE_HTTP_PORTS or --urls).</summary>
    public const string DefaultUrl = "http://127.0.0.1:5188";

    public static WebApplication Build(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var config = builder.Configuration;
        if (string.IsNullOrEmpty(config["urls"]) && string.IsNullOrEmpty(config["http_ports"]) && string.IsNullOrEmpty(config["https_ports"]))
            builder.WebHost.UseUrls(DefaultUrl);

        string dataDir = CatalogPaths.FindDataDir();
        builder.Services.AddSingleton(GameCatalog.Load(dataDir));
        builder.Services.AddSingleton(MaterialsCatalog.Load(dataDir));
        builder.Services.AddSingleton<SetSearcher>();
        builder.Services.AddSingleton<SkillExpander>();

        var app = builder.Build();
        app.UseDefaultFiles();
        app.UseStaticFiles();

        app.MapGet("/healthz", () => Results.Text("ok"));
        app.MapCatalogEndpoints();
        app.MapSearchEndpoints();
        app.MapMaterialsEndpoints();
        app.MapSaveEndpoints();

        var catalog = app.Services.GetRequiredService<GameCatalog>();
        app.Logger.LogInformation("Catalog {DataDir}: {Armor} armor, {Weapons} weapons, {Decorations} decorations",
            dataDir, catalog.Armor.Count, catalog.Weapons.Count, catalog.Decorations.Count);
        return app;
    }
}
