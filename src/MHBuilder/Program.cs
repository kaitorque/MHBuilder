using MHBuilder.Cli;
using MHBuilder.Web;

namespace MHBuilder;

public partial class Program
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0].ToLowerInvariant() is "cli" or "search")
            return CliCommands.Run(args[0].Equals("cli", StringComparison.OrdinalIgnoreCase) ? args[1..] : args);

        await WebApp.Build(args).RunAsync();
        return 0;
    }
}
