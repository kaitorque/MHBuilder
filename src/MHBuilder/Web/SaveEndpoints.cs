using MHBuilder.Catalog;
using MHBuilder.SaveData;

namespace MHBuilder.Web;

/// <summary>Owned decorations from an Iceborne save: an uploaded file, or a save found on the machine running the app.</summary>
public static class SaveEndpoints
{
    public const long MaxSaveBytes = 16L * 1024 * 1024;

    public static void MapSaveEndpoints(this WebApplication app)
    {
        app.MapGet("/api/save/local", () =>
            Results.Json(LocalSaves.Find().Select(s => new { s.UserId, modified = s.Modified })));

        app.MapPost("/api/save/local/{userId}/decorations", (string userId, GameCatalog cat) =>
        {
            var save = LocalSaves.Find().FirstOrDefault(s => s.UserId == userId);
            if (save is null)
                return Results.NotFound(new { error = "That save file is no longer on this PC." });
            return ReadDecorations(LocalSaves.ReadAllBytes(save.Path), cat);
        });

        app.MapPost("/api/save/decorations", async (HttpRequest request, GameCatalog cat) =>
        {
            if (request.ContentLength > MaxSaveBytes)
                return TooBig();
            using var buffer = new MemoryStream();
            await request.Body.CopyToAsync(buffer);
            if (buffer.Length > MaxSaveBytes)
                return TooBig();
            return ReadDecorations(buffer.ToArray(), cat);
        });
    }

    private static IResult TooBig() => Results.BadRequest(new { error = "That file is too big to be an Iceborne save." });

    /// <summary>Decrypts a SAVEDATA1000 and lists each character's decorations.</summary>
    private static IResult ReadDecorations(byte[] data, GameCatalog cat)
    {
        try
        {
            SaveDecryptor.Decrypt(data);
            var slots = DecorationSaveReader.Read(data, cat);
            if (slots.Count == 0)
                return Results.BadRequest(new { error = "This save has no characters yet." });
            return Results.Json(new
            {
                slots = slots.Select(s => new
                {
                    s.Slot,
                    s.Name,
                    s.HunterRank,
                    s.MasterRank,
                    playtime = s.PlaytimeSeconds,
                    s.InBox,
                    s.Slotted,
                    s.Unknown,
                    decorations = s.Decorations.Select(kv => new { id = kv.Key, count = kv.Value })
                })
            });
        }
        catch (Exception ex) when (ex is FormatException or EndOfStreamException or IOException or ArgumentException)
        {
            return Results.BadRequest(new { error = ex is FormatException ? ex.Message : "Couldn't read this file as an Iceborne save." });
        }
    }
}
