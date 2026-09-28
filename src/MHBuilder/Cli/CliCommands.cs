using System.Diagnostics;
using MHBuilder.Catalog;
using MHBuilder.Models;
using MHBuilder.Search;

namespace MHBuilder.Cli;

/// <summary>Command-line entry points: <c>search</c>, <c>bench</c> and <c>health</c>.</summary>
public static class CliCommands
{
    public static int Run(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        if (args.Length == 0 || args[0] is "-h" or "--help")
        {
            PrintUsage();
            return 0;
        }

        string command = args[0].ToLowerInvariant();
        var rest = args.Skip(1).ToArray();
        if (command == "health")
            return Health(rest);
        if (command is not ("search" or "bench"))
        {
            Console.Error.WriteLine($"Unknown command '{args[0]}'.");
            PrintUsage();
            return 1;
        }

        var catalog = GameCatalog.Load(CatalogPaths.FindDataDir());
        Console.WriteLine($"Loaded {catalog.Skills.Count} skills, {catalog.Armor.Count} armor, {catalog.Weapons.Count} weapons, {catalog.Decorations.Count} decorations");
        try
        {
            return command == "bench" ? SearchBench.Run(catalog, rest) : Search(catalog, rest);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("Usage:");
        Console.WriteLine("  MHBuilder                         start the web UI");
        Console.WriteLine("  MHBuilder search \"Skill:Level\" ... [--weapon 4,2,1] [--weapon-id N] [--max 20] [--time ms] [--rank master]");
        Console.WriteLine("  MHBuilder cli bench [--save file] [--compare file] [--time ms] [--only name] [--threads n]");
        Console.WriteLine("  MHBuilder cli health [url]        exit 0 when the web UI answers /healthz");
    }

    private static int Search(GameCatalog catalog, string[] args)
    {
        var wanted = new Dictionary<int, int>();
        int[] weaponSlots = [4, 2, 1];
        int? weaponId = null;
        int maxResults = 20;
        int timeMs = 15_000;
        string minRank = "master";

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a is "--weapon" or "-w")
                weaponSlots = args[++i].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(int.Parse).OrderByDescending(x => x).ToArray();
            else if (a is "--weapon-id")
                weaponId = int.Parse(args[++i]);
            else if (a is "--max" or "-n")
                maxResults = int.Parse(args[++i]);
            else if (a is "--time")
                timeMs = int.Parse(args[++i]);
            else if (a is "--rank")
                minRank = args[++i];
            else if (a.StartsWith('-'))
                throw new ArgumentException($"Unknown flag {a}");
            else
            {
                var parts = a.Split(':', 2);
                if (parts.Length != 2)
                    throw new ArgumentException($"Skill must be 'Name:Level', got '{a}'");
                if (!catalog.SkillsByName.TryGetValue(parts[0].Trim(), out var skill))
                    throw new ArgumentException($"Unknown skill '{parts[0]}'");
                wanted[skill.Id] = int.Parse(parts[1].Trim());
            }
        }

        var searcher = new SetSearcher(catalog);
        var sw = Stopwatch.StartNew();
        var results = searcher.Search(new SearchRequest(wanted, weaponSlots, minRank, maxResults, 50, timeMs, null, null, weaponId));
        sw.Stop();
        Console.WriteLine($"Found {results.Count} set(s) in {sw.ElapsedMilliseconds} ms");
        int n = 1;
        foreach (var r in results)
        {
            Console.WriteLine($"=== #{n++} def={r.Defense} (armor {r.ArmorDefense})  " +
                $"F{r.Resistances.Fire}/W{r.Resistances.Water}/T{r.Resistances.Thunder}/I{r.Resistances.Ice}/D{r.Resistances.Dragon}  " +
                $"weapon={r.WeaponName ?? string.Join('-', r.WeaponSlots ?? [])} ===");
            Console.WriteLine($"  {r.Head.Name} / {r.Chest.Name} / {r.Gloves.Name} / {r.Waist.Name} / {r.Legs.Name}");
            Console.WriteLine($"  Charm {r.Charm.Name}");
            if (r.SetBonuses is { Count: > 0 })
                Console.WriteLine("  Set: " + string.Join(" | ", r.SetBonuses.Select(s => $"{s.Name}({s.RequiredParts}) {s.Effect}")));
            if (r.Decorations.Count > 0)
                Console.WriteLine("  " + string.Join(", ", r.Decorations.GroupBy(d => d.Name).Select(g => g.Count() == 1 ? g.Key : $"{g.Key} x{g.Count()}")));
        }
        return 0;
    }

    /// <summary>Container health check: GET /healthz on the configured port (ASPNETCORE_HTTP_PORTS, else 5188).</summary>
    private static int Health(string[] args)
    {
        string url = args.Length > 0 ? args[0] : DefaultHealthUrl();
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            using var response = http.GetAsync(url).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Console.Error.WriteLine($"{url}: {ex.Message}");
            return 1;
        }
    }

    private static string DefaultHealthUrl()
    {
        string? ports = Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS");
        string port = ports?.Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? "5188";
        return $"http://127.0.0.1:{port}/healthz";
    }
}
