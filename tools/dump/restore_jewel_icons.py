"""Copy MHOTOMO jewel/slot/gear icons into wwwroot/icons/mh unmodified (tinting happens in CSS)."""
import re
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
APK = Path(__file__).resolve().parent / "mhotomo" / "mhotomo.zip"
OUT = ROOT / "src" / "MHBuilder" / "wwwroot" / "icons" / "mh"
PREFIX = "assets/flutter_assets/assets/3.0x/"
WANTED = re.compile(
    r"^(icon_slot\d(_filled\d)?|icon_jewel_filled\d|item_jewel\d"
    r"|icon_(head|chest|arm|waist|leg|charm|defense)"
    r"|icon_(great_sword|long_sword|sword_shield|dual_blades|hammer|hunting_horn|lance|gunlance"
    r"|switch_axe|charge_blade|insect_glaive|bow|light_bowgun|heavy_bowgun))\.png$"
)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(APK) as z:
        for path in z.namelist():
            if not path.startswith(PREFIX):
                continue
            name = path[len(PREFIX):]
            if WANTED.match(name):
                (OUT / name).write_bytes(z.read(path))
                print(name)
    print("done ->", OUT)


if __name__ == "__main__":
    main()
