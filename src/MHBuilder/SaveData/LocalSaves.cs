using Microsoft.Win32;

namespace MHBuilder.SaveData;

public sealed record LocalSave(string UserId, string Path, DateTime Modified);

/// <summary>
/// Finds Iceborne saves on the machine running the app (Windows only):
/// Steam\userdata\&lt;user&gt;\582010\remote\SAVEDATA1000.
/// </summary>
public static class LocalSaves
{
    private const string GameId = "582010";
    private const string FileName = "SAVEDATA1000";
    private const string DefaultSteamPath = @"C:\Program Files (x86)\Steam";

    public static IReadOnlyList<LocalSave> Find()
    {
        if (!OperatingSystem.IsWindows())
            return [];
        string steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
            ?? DefaultSteamPath;
        string userData = System.IO.Path.Combine(steam, "userdata");
        if (!Directory.Exists(userData))
            return [];

        var found = new List<LocalSave>();
        foreach (string userDir in Directory.EnumerateDirectories(userData))
        {
            string path = System.IO.Path.GetFullPath(System.IO.Path.Combine(userDir, GameId, "remote", FileName));
            if (File.Exists(path))
                found.Add(new LocalSave(System.IO.Path.GetFileName(userDir), path, File.GetLastWriteTime(path)));
        }
        return found.OrderByDescending(s => s.Modified).ToList();
    }

    public static byte[] ReadAllBytes(string path)
    {
        // The game may have the file open; share access so reading never blocks or disturbs it.
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var data = new byte[stream.Length];
        stream.ReadExactly(data);
        return data;
    }
}
