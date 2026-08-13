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
        "uid":  "44890fbf4cb44f7fb07b6807a948f4c3",
        "name": "Bamboo Basket",
        "note": "CC Attribution — 5.3k triangles",
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
    # ── Temple ──────────────────────────────────────────────────────────────
    "temple.glb": {
        "uid":  "d7dfdd1f6efc412d968120f81b191dae",
        "name": "Indian Temple",
        "note": "52.1k triangles — preferred over the 321k variant for web use",
    },
}

# Assets not yet mapped to a Sketchfab model (will be skipped with a warning)
UNMAPPED = [
    "man.glb",
    "coconut.glb",
    "banana.glb",
    "thekua.glb",
    "marigold.glb",
    "kalash.glb",
    "ghats.glb",
    "banana_plant.glb",
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
