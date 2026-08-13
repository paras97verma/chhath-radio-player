#!/usr/bin/env python3
"""
download-sketchfab-assets.py
────────────────────────────
Downloads Sketchfab GLB models for the Chhath Radio ghat scene and places
them in frontend/public/chhath/models/ with the exact filenames expected by
assetManifest.ts.

USAGE
─────
1. Get a free Sketchfab API token:
   https://sketchfab.com/settings/password  →  "API Token" section

2. Set the token as an environment variable (never hard-code it):
       export SKETCHFAB_TOKEN="your_token_here"

3. Run:
       python3 scripts/download-sketchfab-assets.py

   Or to download only specific assets:
       python3 scripts/download-sketchfab-assets.py --only diya basket boat

   Or to do a dry-run (shows what would be downloaded without downloading):
       python3 scripts/download-sketchfab-assets.py --dry-run

REQUIREMENTS
────────────
    pip install requests tqdm

NOTES
─────
- Sketchfab's download API requires a (free) account and API token.
- Models marked "NoAI" (e.g. Indian Boat) are included here for scene use
  only. Do NOT feed them into generative AI pipelines — respect the creator's
  NoAI restriction.
- The script downloads the GLB/GLTF format when available, otherwise ZIP.
  ZIP archives are extracted and the first .glb/.gltf file found is used.
- Already-downloaded files are skipped unless --force is passed.
"""

import argparse
import os
import sys
import time
import zipfile
import tempfile
import shutil
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests tqdm")

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

# ─── Configuration ────────────────────────────────────────────────────────────

# Output directory (relative to repo root, matching assetManifest.ts paths)
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "chhath" / "models"

SKETCHFAB_API = "https://api.sketchfab.com/v3"

# ─── Asset Map ────────────────────────────────────────────────────────────────
# Maps the target filename (from assetManifest.ts) to the Sketchfab model UID.
# The UID is the last path segment of the Sketchfab URL.
#
# Format:
#   "output_filename.glb": {
#       "uid":   "<sketchfab-model-uid>",
#       "name":  "<human-readable name for logging>",
#       "note":  "<optional note about license / usage>",
#   }

ASSETS = {
    # ── Characters ──────────────────────────────────────────────────────────
    "woman_arghya.glb": {
        "uid":  "895a6682c82245058f408da36a80cb75",
        "name": "Indian woman in traditional saree outfit",
        "note": "CC Attribution — 170.9k triangles",
    },
    "woman_soop.glb": {
        "uid":  "b5965a93b03440dea65160f7cbac1fc7",
        "name": "Indian Woman in Saree",
        "note": "Free Standard license",
    },
    # man.glb — no direct Sketchfab match provided; placeholder kept
    # ── Diyas ───────────────────────────────────────────────────────────────
    "diya.glb": {
        "uid":  "a75900fa1cc641d0add7ffbb74bf96a2",
        "name": "Diya Lamp",
        "note": "Free Standard — 2.1k triangles (lightweight, good for instancing)",
    },
    # ── Baskets / Soop ──────────────────────────────────────────────────────
    "basket.glb": {
        "uid":  "6c7e1244d46c457fb6f3d6194663073b",
        "name": "Bamboo Basket",
        "note": "CC Attribution — 1.1k triangles (ultra-lightweight, ideal for instancing multiple baskets)",
    },
    # ── Sugarcane ───────────────────────────────────────────────────────────
    "sugarcane.glb": {
        "uid":  "eedad43efd0f420cacae29251232265b",
        "name": "Sugar Cane",
        "note": "CC Attribution — 564 triangles (ultra-lightweight for instancing)",
    },
    # ── Boat ────────────────────────────────────────────────────────────────
    "boat.glb": {
        "uid":  "ae612c0dfeb04c559803bc8c1de12084",
        "name": "Indian Boat",
        "note": "NoAI restriction — 35.7k triangles. Do NOT use as AI training data.",
    },
    # ── Man ─────────────────────────────────────────────────────────────────
    "man.glb": {
        "uid":  "54b9e050d0d6424b848a04bec02a85d0",
        "name": "Indian Man In Dhoti",
        "note": "CC Attribution — 21.6k triangles, rigged",
    },
    # ── Coconut ─────────────────────────────────────────────────────────────
    "coconut.glb": {
        "uid":  "222cbb6fec764c319be88ca67b7a4e70",
        "name": "Indian Coconut",
        "note": "CC Attribution — 760 triangles (ultra-lightweight)",
    },
    # ── Banana ──────────────────────────────────────────────────────────────
    "banana.glb": {
        "uid":  "ac3998e6b0364ef393aaf0b8c281a2d2",
        "name": "Banana (photorealistic, GLB/glTF 2.0 ready)",
        "note": "CC Attribution — 2.8k triangles, PBR, Three.js optimized",
    },
    # ── Marigold ────────────────────────────────────────────────────────────
    "marigold.glb": {
        "uid":  "8285d71edcaf47ac9b54b5619704f8db",
        "name": "Low-poly Flower (marigold stand-in)",
        "note": "CC Attribution — 16 triangles, extremely efficient for instancing",
    },
    # ── Kalash ──────────────────────────────────────────────────────────────
    "kalash.glb": {
        "uid":  "bc30d3fd235248fb81ddb156fa78774e",
        "name": "Kalash (puja pot/pitcher)",
        "note": "CC Attribution — 16.1k triangles",
    },
    # ── Banana Plant ────────────────────────────────────────────────────────
    "banana_plant.glb": {
        "uid":  "85695b82c7ba4b3497a663616cc3bf25",
        "name": "Banana Plant",
        "note": "CC Attribution — 4.4k triangles (lightweight for background use)",
    },
    # ── Temple ──────────────────────────────────────────────────────────────
    "temple.glb": {
        "uid":  "12b72dbe488f4800a080d352c724247f",
        "name": "Indian Temples",
        "note": "321k triangles — full temple complex",
    },
}

# Assets not yet mapped to a Sketchfab model (will be skipped with a warning)
UNMAPPED = [
    "thekua.glb",   # No authentic model found — recommend custom geometry
    "ghats.glb",    # Recommend building from modular stair/wall assets
]

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_token() -> str:
    token = os.environ.get("SKETCHFAB_TOKEN", "").strip()
    if not token:
        sys.exit(
            "\n[ERROR] SKETCHFAB_TOKEN environment variable is not set.\n"
            "  Get your token at: https://sketchfab.com/settings/password\n"
            "  Then run:  export SKETCHFAB_TOKEN='your_token_here'\n"
        )
    return token


def sketchfab_headers(token: str) -> dict:
    return {"Authorization": f"Token {token}"}


def get_download_url(uid: str, token: str) -> tuple[str, str]:
    """
    Returns (download_url, format_label) for the best available format.
    Prefers glb > gltf > source (zip).
    Raises RuntimeError if no downloadable format is found.
    """
    url = f"{SKETCHFAB_API}/models/{uid}/download"
    resp = requests.get(url, headers=sketchfab_headers(token), timeout=30)

    if resp.status_code == 401:
        sys.exit("[ERROR] Invalid or expired SKETCHFAB_TOKEN.")
    if resp.status_code == 403:
        raise RuntimeError(
            f"Model {uid}: download not permitted (model may require purchase or "
            "is not downloadable under your account tier)."
        )
    if resp.status_code == 404:
        raise RuntimeError(f"Model {uid}: not found on Sketchfab.")

    resp.raise_for_status()
    data = resp.json()

    # Priority: glb → gltf → source
    for fmt in ("glb", "gltf", "source"):
        if fmt in data and data[fmt].get("url"):
            return data[fmt]["url"], fmt

    raise RuntimeError(f"Model {uid}: no downloadable format available in API response.")


def download_file(url: str, dest: Path, label: str = "") -> None:
    """Stream-download url → dest, showing a tqdm progress bar if available."""
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    chunk_size = 1024 * 64  # 64 KB

    with open(dest, "wb") as fh:
        if HAS_TQDM and total:
            with tqdm(
                total=total,
                unit="B",
                unit_scale=True,
                desc=label or dest.name,
                leave=False,
            ) as bar:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    fh.write(chunk)
                    bar.update(len(chunk))
        else:
            downloaded = 0
            for chunk in resp.iter_content(chunk_size=chunk_size):
                fh.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r  {label or dest.name}: {pct:.1f}%", end="", flush=True)
            print()


def extract_glb_from_zip(zip_path: Path, dest: Path) -> bool:
    """
    Extract the first .glb or .gltf file found in zip_path and save it to dest.
    Returns True on success.
    """
    with zipfile.ZipFile(zip_path, "r") as zf:
        candidates = [
            n for n in zf.namelist()
            if n.lower().endswith(".glb") or n.lower().endswith(".gltf")
        ]
        if not candidates:
            return False
        # Prefer .glb over .gltf
        candidates.sort(key=lambda n: (0 if n.lower().endswith(".glb") else 1, n))
        chosen = candidates[0]
        with zf.open(chosen) as src, open(dest, "wb") as dst:
            shutil.copyfileobj(src, dst)
    return True


def download_asset(
    filename: str,
    info: dict,
    token: str,
    output_dir: Path,
    force: bool = False,
    dry_run: bool = False,
) -> bool:
    """
    Download a single asset. Returns True on success (or skip), False on error.
    """
    dest = output_dir / filename
    uid = info["uid"]
    name = info["name"]
    note = info.get("note", "")

    print(f"\n{'─'*60}")
    print(f"  Asset : {filename}")
    print(f"  Model : {name}")
    if note:
        print(f"  Note  : {note}")
    print(f"  UID   : {uid}")

    if dest.exists() and not force:
        size_kb = dest.stat().st_size / 1024
        print(f"  ✓ Already exists ({size_kb:.1f} KB) — skipping. Use --force to re-download.")
        return True

    if dry_run:
        print("  [DRY RUN] Would download this asset.")
        return True

    try:
        dl_url, fmt = get_download_url(uid, token)
        print(f"  Format: {fmt}")
    except RuntimeError as exc:
        print(f"  ✗ {exc}")
        return False

    # Sketchfab sometimes returns a redirect; requests follows it automatically.
    # For "source" format the download is a ZIP archive.
    if fmt == "source":
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            print(f"  Downloading ZIP archive …")
            download_file(dl_url, tmp_path, label=filename)
            print(f"  Extracting GLB from ZIP …")
            ok = extract_glb_from_zip(tmp_path, dest)
            if not ok:
                print(f"  ✗ No .glb/.gltf found inside the ZIP archive.")
                return False
        finally:
            tmp_path.unlink(missing_ok=True)
    else:
        print(f"  Downloading …")
        download_file(dl_url, dest, label=filename)

    size_kb = dest.stat().st_size / 1024
    print(f"  ✓ Saved → {dest.relative_to(Path.cwd())}  ({size_kb:.1f} KB)")
    return True


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download Sketchfab GLB assets for the Chhath Radio ghat scene.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="ASSET",
        help=(
            "Download only these assets (by output filename without .glb, "
            "e.g. --only diya basket boat)"
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the file already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be downloaded without actually downloading.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all mapped assets and exit.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.list:
        print("\nMapped assets (will be downloaded):")
        for fname, info in ASSETS.items():
            print(f"  {fname:30s}  {info['name']}")
        print("\nUnmapped assets (no Sketchfab source yet — placeholders kept):")
        for fname in UNMAPPED:
            print(f"  {fname}")
        return

    token = get_token()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Filter assets if --only was specified
    if args.only:
        # Accept names with or without .glb extension
        requested = {n if n.endswith(".glb") else f"{n}.glb" for n in args.only}
        unknown = requested - set(ASSETS.keys())
        if unknown:
            print(f"[WARNING] Unknown asset names: {', '.join(sorted(unknown))}")
        assets_to_download = {k: v for k, v in ASSETS.items() if k in requested}
    else:
        assets_to_download = ASSETS

    if not assets_to_download:
        sys.exit("[ERROR] No assets to download after filtering.")

    print(f"\nChhath Radio — Sketchfab Asset Downloader")
    print(f"Output directory : {OUTPUT_DIR}")
    print(f"Assets to process: {len(assets_to_download)}")
    if args.dry_run:
        print("Mode             : DRY RUN (no files will be written)")
    if args.force:
        print("Mode             : FORCE (existing files will be overwritten)")

    successes, failures = [], []

    for filename, info in assets_to_download.items():
        ok = download_asset(
            filename=filename,
            info=info,
            token=token,
            output_dir=OUTPUT_DIR,
            force=args.force,
            dry_run=args.dry_run,
        )
        (successes if ok else failures).append(filename)
        # Be polite to the Sketchfab API
        time.sleep(0.5)

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  Done. {len(successes)} succeeded, {len(failures)} failed.")

    if UNMAPPED:
        print(f"\n  Unmapped assets (no Sketchfab source — placeholders kept):")
        for fname in UNMAPPED:
            placeholder = OUTPUT_DIR / fname
            status = "✓ placeholder exists" if placeholder.exists() else "✗ missing"
            print(f"    {fname:30s}  {status}")

    if failures:
        print(f"\n  Failed assets:")
        for fname in failures:
            print(f"    ✗ {fname}")
        sys.exit(1)

    print(f"\n  All assets are in: {OUTPUT_DIR}")
    print(f"  Next step: verify models load correctly in the Three.js scene.")


if __name__ == "__main__":
    main()