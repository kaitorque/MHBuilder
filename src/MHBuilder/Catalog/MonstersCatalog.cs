using System.Text.Json;

namespace MHBuilder.Catalog;

/// <summary>
/// Large monster weaknesses, roar / wind / tremor and ailments from data/monsters.json (tools/dump/build_monsters.py).
/// The client reads the file as-is, so it is kept as raw JSON.
/// </summary>
public sealed class MonstersCatalog
{
    public byte[] Json { get; }
    public int Count { get; }

    private MonstersCatalog(byte[] json, int count)
    {
        Json = json;
        Count = count;
    }

    public static MonstersCatalog Load(string dataDirectory)
    {
        string path = Path.Combine(dataDirectory, "monsters.json");
        if (!File.Exists(path))
            return new MonstersCatalog("""{"monsters":[]}"""u8.ToArray(), 0);
        byte[] json = File.ReadAllBytes(path);
        using var doc = JsonDocument.Parse(json);
        return new MonstersCatalog(json, doc.RootElement.GetProperty("monsters").GetArrayLength());
    }
}
