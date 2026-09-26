# MHBuilder

Armor set builder for **Monster Hunter World: Iceborne** (PC data, final title update). Pick the skills you want
and it searches every armor, charm and decoration combination for the best sets, with a hand builder, crafting
materials and owned-decoration import from a save file.

## Features

- **Set search**: best sets by defense, then free slots, then fewest decorations. Multi-threaded
  branch-and-bound over the full catalog, with an exact decoration fill when the quick greedy fill fails.
- **Filters**: weapon or custom weapon slots, armor rarity, gender, excluded or pinned armor, excluded skills and
  charms, minimum defense and resistances, slots to keep free.
- **Set bonuses**: set effects (e.g. Master's Touch) and Secret / Fatalis skill cap raises.
- **More skills**: which extra skills still fit on top of the current request.
- **Builder**: assemble a set by hand and see totals, skills and slots.
- **Materials**: crafting cost for armor, every charm rank and a weapon's full forge/upgrade path, with where each
  material comes from.
- **Owned decorations**: import from an Iceborne save (decoration box plus jewels slotted in gear and mantles) so
  the search only uses what you own. The save is only read, never modified.

## Running locally

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download).

```sh
dotnet run --project src/MHBuilder -c Release
```

Open <http://127.0.0.1:5188>. Use `-c Release`: searches are several times faster than a Debug build.

### Command line

```sh
dotnet run --project src/MHBuilder -c Release -- search "Critical Eye:7" "Weakness Exploit:3" --weapon 4,2,1
dotnet run --project src/MHBuilder -c Release -- cli bench [--save file] [--compare file] [--threads n]
```

`bench` runs fixed search cases, re-validates every result and can compare against a saved baseline.

### Tests

```sh
dotnet test
```

## Deploying with Docker / Portainer

The image builds from the repository, runs the tests during the build and serves the UI on port 8080.

```sh
docker compose up -d --build          # UI on http://<host>:5188
```

**Portainer:** *Stacks → Add stack → Repository*, enter the repository URL and `docker-compose.yml` as the compose
path. Set the `MHBUILDER_PORT` environment variable to publish on a port other than 5188. Enable automatic updates
(polling or webhook) to redeploy on every push.

Without compose:

```sh
docker build -t mhbuilder .                        # add --build-arg SKIP_TESTS=true to skip tests
docker run -d -p 5188:8080 --name mhbuilder mhbuilder
```

The container reports its health through `/healthz`.

### Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `ASPNETCORE_HTTP_PORTS` / `ASPNETCORE_URLS` / `--urls` | `http://127.0.0.1:5188` locally, port 8080 in the container | Listen address |
| `MHBUILDER_DATA` | `data/` next to the app or at the repository root | Catalog folder (the one containing `skills.json`) |
| `MHBUILDER_PORT` (compose only) | `5188` | Host port for the container |

## Importing decorations from a save

Iceborne PC saves live at `<Steam>\userdata\<steam user id>\582010\remote\SAVEDATA1000`.

- **Choose save file…** uploads any `SAVEDATA1000`. This works everywhere, including the Docker deployment.
- **This PC's save** finds the file automatically through the Steam install. It only works when MHBuilder runs on
  the same Windows machine as Steam, so a server deployment only offers the upload.

## Project layout

```text
src/MHBuilder/
  Catalog/     game data loading (skills, armor, charms, decorations, weapons, materials)
  Search/      set search, decoration fill, "more skills", benchmark
  SaveData/    save decryption and decoration reader
  Web/         HTTP endpoints and response shapes
  Cli/         command-line commands
  wwwroot/     web UI (plain HTML/CSS/JS)
tests/MHBuilder.Tests/   xUnit tests (catalog, search, save reader, HTTP API)
data/                    game catalog JSON used at runtime
tools/dump/              scripts that regenerate data/ from the game files (see docs/DATA.md)
```

## Data and credits

Where the catalog comes from and how to regenerate it: [docs/DATA.md](docs/DATA.md). The save decryption and
layout follow MIT-licensed community projects; see
[THIRD-PARTY-NOTICES](src/MHBuilder/SaveData/THIRD-PARTY-NOTICES.md).

Monster Hunter World: Iceborne, its data and its icons belong to Capcom. MHBuilder is a fan-made tool and is not
affiliated with or endorsed by Capcom.
