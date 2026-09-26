namespace MHBuilder.Catalog;

public static class CatalogPaths
{
    /// <summary>Environment variable that points at the catalog folder (the one holding skills.json).</summary>
    public const string DataDirVariable = "MHBUILDER_DATA";

    /// <summary>
    /// The catalog folder: <see cref="DataDirVariable"/> when set, else <c>data/</c> next to the app, in the working
    /// directory, or at the repository root (when running from <c>bin/</c>).
    /// </summary>
    public static string FindDataDir()
    {
        if (Environment.GetEnvironmentVariable(DataDirVariable) is { Length: > 0 } configured)
        {
            if (File.Exists(Path.Combine(configured, "skills.json")))
                return Path.GetFullPath(configured);
            throw new DirectoryNotFoundException($"{DataDirVariable} is set to '{configured}', which has no skills.json.");
        }

        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "data"),
            Path.Combine(Environment.CurrentDirectory, "data"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data"),
        };
        foreach (var c in candidates)
        {
            if (File.Exists(Path.Combine(c, "skills.json")))
                return Path.GetFullPath(c);
        }
        throw new DirectoryNotFoundException($"Could not find a data/ folder with skills.json. Set {DataDirVariable} to its path.");
    }
}
