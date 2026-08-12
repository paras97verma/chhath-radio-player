#!/usr/bin/env python3
"""
Chhath Radio — Bulk YouTube Song Importer
==========================================

Reads a list of YouTube video URLs (one per line) from a text file or stdin,
fetches each video's title and channel name via the YouTube oEmbed API
(no API key required), and POSTs each song to the Chhath Radio admin API.

Usage
-----
  # From a file:
  python scripts/import_songs.py --file urls.txt --token <JWT>

  # From stdin (pipe):
  cat urls.txt | python scripts/import_songs.py --token <JWT>

  # Dry-run (parse + fetch metadata, but do NOT post to API):
  python scripts/import_songs.py --file urls.txt --dry-run

  # Custom API base URL (default: http://localhost:8000):
  python scripts/import_songs.py --file urls.txt --token <JWT> --api http://localhost:8000

  # Provide artist name manually (skips oEmbed lookup):
  python scripts/import_songs.py --file urls.txt --token <JWT> --artist "Sharda Sinha"

  # Set a starting sort_order (increments per song):
  python scripts/import_songs.py --file urls.txt --token <JWT> --start-order 10

  # Set a category for all imported songs:
  python scripts/import_songs.py --file urls.txt --token <JWT> --category "Chhath Geet"

File format (urls.txt)
----------------------
  One YouTube URL per line. Blank lines and lines starting with # are ignored.

  https://www.youtube.com/watch?v=dQw4w9WgXcQ
  https://youtu.be/abc123defgh
  # This is a comment — ignored
  https://www.youtube.com/shorts/xyz789uvwxy

Requirements
------------
  pip install requests  (already in backend/requirements.txt)
"""

import argparse
import json
import re
import sys
import time
from typing import Optional
from urllib.parse import urlparse, parse_qs

try:
    import requests
except ImportError:
    print("ERROR: 'requests' is not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)


# ─── YouTube URL parsing ──────────────────────────────────────────────────────

YOUTUBE_VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_video_id(url: str) -> Optional[str]:
    """Extract the 11-character YouTube video ID from any URL format."""
    match = YOUTUBE_VIDEO_ID_RE.search(url)
    if match:
        return match.group(1)
    # Accept a bare 11-char ID
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url.strip()):
        return url.strip()
    return None


# ─── oEmbed metadata fetch ────────────────────────────────────────────────────

OEMBED_URL = "https://www.youtube.com/oembed"


def fetch_oembed_metadata(video_url: str) -> dict:
    """
    Fetch video title and author_name via YouTube oEmbed (no API key needed).
    Returns a dict with 'title' and 'author_name', or empty strings on failure.
    """
    try:
        resp = requests.get(
            OEMBED_URL,
            params={"url": video_url, "format": "json"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "title": data.get("title", ""),
                "author_name": data.get("author_name", ""),
            }
        else:
            return {"title": "", "author_name": ""}
    except Exception as e:
        print(f"  ⚠  oEmbed fetch failed for {video_url}: {e}", file=sys.stderr)
        return {"title": "", "author_name": ""}


# ─── API posting ──────────────────────────────────────────────────────────────

def post_song(
    api_base: str,
    token: str,
    title: str,
    artist: str,
    youtube_url: str,
    sort_order: int,
    category: Optional[str],
) -> dict:
    """POST a song to the admin API. Returns the created song dict."""
    payload = {
        "title": title,
        "artist": artist,
        "youtube_url": youtube_url,
        "sort_order": sort_order,
    }
    if category:
        payload["category"] = category

    resp = requests.post(
        f"{api_base}/api/admin/songs",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ─── Main ─────────────────────────────────────────────────────────────────────

def read_urls(file_path: Optional[str]) -> list[str]:
    """Read URLs from a file or stdin, stripping comments and blank lines."""
    if file_path:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    else:
        if sys.stdin.isatty():
            print("Reading URLs from stdin (paste URLs, then press Ctrl+D):")
        lines = sys.stdin.readlines()

    urls = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)
    return urls


def main():
    parser = argparse.ArgumentParser(
        description="Bulk-import YouTube songs into Chhath Radio.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--file", "-f",
        metavar="FILE",
        help="Path to a text file with one YouTube URL per line. Reads from stdin if omitted.",
    )
    parser.add_argument(
        "--token", "-t",
        metavar="JWT",
        help="Admin JWT token (required unless --dry-run).",
    )
    parser.add_argument(
        "--api",
        metavar="URL",
        default="http://localhost:8000",
        help="Base URL of the Chhath Radio API (default: http://localhost:8000).",
    )
    parser.add_argument(
        "--artist", "-a",
        metavar="NAME",
        default=None,
        help="Artist name to use for all songs. If omitted, uses the YouTube channel name.",
    )
    parser.add_argument(
        "--category", "-c",
        metavar="CATEGORY",
        default=None,
        help="Category to assign to all imported songs (e.g. 'Chhath Geet').",
    )
    parser.add_argument(
        "--start-order",
        metavar="N",
        type=int,
        default=0,
        help="Starting sort_order value (increments by 1 per song, default: 0).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and fetch metadata but do NOT post to the API.",
    )
    parser.add_argument(
        "--delay",
        metavar="SECONDS",
        type=float,
        default=0.5,
        help="Delay between API requests in seconds (default: 0.5).",
    )

    args = parser.parse_args()

    if not args.dry_run and not args.token:
        parser.error("--token is required unless --dry-run is specified.")

    urls = read_urls(args.file)
    if not urls:
        print("No URLs found. Nothing to import.", file=sys.stderr)
        sys.exit(0)

    print(f"\n🪔  Chhath Radio — Bulk Song Importer")
    print(f"   Found {len(urls)} URL(s) to process.\n")

    results = {"success": 0, "skipped": 0, "failed": 0}
    sort_order = args.start_order

    for i, url in enumerate(urls, start=1):
        print(f"[{i}/{len(urls)}] {url}")

        video_id = extract_video_id(url)
        if not video_id:
            print(f"  ✗  Could not extract video ID — skipping.\n")
            results["skipped"] += 1
            continue

        # Normalise to a canonical watch URL for oEmbed
        canonical_url = f"https://www.youtube.com/watch?v={video_id}"

        # Fetch metadata
        meta = fetch_oembed_metadata(canonical_url)
        title = meta["title"] or f"Video {video_id}"
        artist = args.artist or meta["author_name"] or "Unknown Artist"

        print(f"  Title:  {title}")
        print(f"  Artist: {artist}")
        print(f"  ID:     {video_id}  |  sort_order: {sort_order}")

        if args.dry_run:
            print(f"  [DRY RUN] Would POST to {args.api}/api/admin/songs\n")
            results["success"] += 1
            sort_order += 1
            continue

        try:
            created = post_song(
                api_base=args.api,
                token=args.token,
                title=title,
                artist=artist,
                youtube_url=canonical_url,
                sort_order=sort_order,
                category=args.category,
            )
            print(f"  ✓  Created song id={created.get('id', '?')}\n")
            results["success"] += 1
            sort_order += 1
        except requests.HTTPError as e:
            print(f"  ✗  API error {e.response.status_code}: {e.response.text}\n", file=sys.stderr)
            results["failed"] += 1
        except Exception as e:
            print(f"  ✗  Unexpected error: {e}\n", file=sys.stderr)
            results["failed"] += 1

        if args.delay > 0:
            time.sleep(args.delay)

    # Summary
    print("─" * 50)
    print(f"  ✓  Imported:  {results['success']}")
    print(f"  ⚠  Skipped:   {results['skipped']}")
    print(f"  ✗  Failed:    {results['failed']}")
    print("─" * 50)

    if results["failed"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()