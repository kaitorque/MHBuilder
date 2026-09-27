using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using MHBuilder.Catalog;
using MHBuilder.Models;
using MHBuilder.Search;

namespace MHBuilder.Web;

/// <summary>Set search, "more skills" on top of the last results, and evaluating a hand-made build.</summary>
public static class SearchEndpoints
{
    /// <summary>
    /// Last few result lists by request body, so "more skills" can start from the sets the user is looking at
    /// instead of searching again.
    /// </summary>
    private static readonly ConcurrentDictionary<string, IReadOnlyList<SearchResult>> RecentResults = new();
    private const int RecentResultsKept = 16;

    public static void MapSearchEndpoints(this WebApplication app)
    {
        app.MapPost("/api/search", (SearchApiRequest body, SetSearcher searcher, GameCatalog cat, HttpContext http) =>
        {
            try
            {
                var req = body.ToSearchRequest(cat);
                var sw = Stopwatch.StartNew();
                var outcome = searcher.SearchDetailed(req, http.RequestAborted);
                sw.Stop();
                Remember(body, outcome.Results);

                return Results.Json(new
                {
                    elapsedMs = sw.ElapsedMilliseconds,
                    timedOut = outcome.TimedOut,
                    threads = outcome.Threads,
                    count = outcome.Results.Count,
                    results = outcome.Results.Select(r => ResultDto.From(r, cat, req.WantedSkills))
                });
            }
            catch (OperationCanceledException)
            {
                return Results.StatusCode(499);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPost("/api/search/more", (SearchApiRequest body, SkillExpander expander, GameCatalog cat) =>
        {
            try
            {
                var result = expander.Find(body.ToSearchRequest(cat), Recall(body));
                return Results.Json(new
                {
                    elapsedMs = result.ElapsedMs,
                    result.Checked,
                    result.Candidates,
                    result.BudgetExhausted,
                    skills = result.Skills.Select(s => new { s.Id, s.Name, s.Level, s.MaxLevel, s.MaybeMore })
                });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPost("/api/build/evaluate", (BuildEvaluateRequest body, SetSearcher searcher, GameCatalog cat) =>
        {
            var pieces = new Dictionary<ArmorSlot, ArmorPiece>();
            foreach (var (slot, id) in ArmorSlots.Parse(body.Armor))
            {
                if (cat.ArmorById.TryGetValue(id, out var piece))
                    pieces[slot] = piece;
            }
            var charm = body.Charm is { } c
                ? cat.Charms.FirstOrDefault(x => x.CharmId == c.Id && x.Level == c.Level)
                : null;
            var decos = (body.DecorationIds ?? [])
                .Select(id => cat.DecorationsById.GetValueOrDefault(id))
                .OfType<Decoration>()
                .ToList();
            var wanted = (body.Skills ?? []).Where(s => s.Level > 0).ToDictionary(s => s.Id, s => s.Level);
            var result = searcher.EvaluateBuild(pieces, charm, decos, body.WeaponSlots ?? []);
            return Results.Json(ResultDto.From(result, cat, wanted));
        });
    }

    private static void Remember(SearchApiRequest body, IReadOnlyList<SearchResult> results)
    {
        if (RecentResults.Count >= RecentResultsKept) RecentResults.Clear();
        RecentResults[JsonSerializer.Serialize(body)] = results;
    }

    private static IReadOnlyList<SearchResult>? Recall(SearchApiRequest body) =>
        RecentResults.TryGetValue(JsonSerializer.Serialize(body), out var results) && results.Count > 0 ? results : null;
}
