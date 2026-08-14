#!/usr/bin/env python3
"""
seed_songs.py — Direct DB fixture for Chhath Radio songs.

Reads YouTube URLs from scripts/songs.txt (one URL per line), fetches
real metadata (title, author/artist) from YouTube's free oEmbed API
(no API key required), then inserts directly into the database via
SQLAlchemy — no admin auth, no API calls to the app.

Usage (inside the backend container or with DATABASE_URL set):
    python seed_songs.py
    python seed_songs.py --clear          # wipe existing songs first
    python seed_songs.py --file /path/to/songs.txt
    python seed_songs.py --no-fetch       # skip metadata fetch, use placeholders

Usage via Makefile:
    make seed-songs
    make seed-songs-clear
"""

import os
import re
import sys
import uuid
import time
import argparse
import urllib.request
import urllib.error
import json

# ── Bootstrap path so app imports work ───────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.db.database import Base
from app.models.song import Song

# ── Constants ─────────────────────────────────────────────────────────────────

YT_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)
OEMBED_URL = "https://www.youtube.com/oembed?url={url}&format=json"
FETCH_DELAY = 0.4   # seconds between oEmbed requests (be polite)
FETCH_TIMEOUT = 8   # seconds per request


# ── Helpers ───────────────────────────────────────────────────────────────────

def extract_video_id(url: str) -> str | None:
    m = YT_ID_RE.search(url.strip())
    return m.group(1) if m else None


def load_urls(filepath: str) -> list[str]:
    with open(filepath, encoding="utf-8") as f:
        return [
            line.strip()
            for line in f
            if line.strip() and not line.strip().startswith("#")
        ]


def fetch_yt_metadata(yt_id: str) -> dict:
    """
    Fetch title and author_name from YouTube oEmbed (no API key needed).
    Returns dict with keys: title, artist.
    Falls back to placeholders on any error.
    """
    url = f"https://www.youtube.com/watch?v={yt_id}"
    oembed = OEMBED_URL.format(url=urllib.request.quote(url, safe=":/=?&"))
    try:
        req = urllib.request.Request(
            oembed,
            headers={"User-Agent": "ChhathRadioSeeder/1.0"},
        )
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        title  = data.get("title", "").strip() or f"Chhath Geet ({yt_id})"
        artist = data.get("author_name", "").strip() or "Unknown"
        return {"title": title, "artist": artist}
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, Exception) as e:
        return {"title": f"Chhath Geet ({yt_id})", "artist": "Unknown"}


def get_engine():
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://chhath:chhath@localhost:5432/chhath_radio",
    )
    return create_engine(db_url, echo=False)


# ── Seeder ────────────────────────────────────────────────────────────────────

def seed(songs_file: str, clear: bool = False, fetch_meta: bool = True) -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)

    urls = load_urls(songs_file)
    print(f"📄  Loaded {len(urls)} URLs from {songs_file}")
    if fetch_meta:
        print("🌐  Will fetch YouTube metadata for each song (oEmbed, no API key)…")

    with Session(engine) as session:
        if clear:
            deleted = session.query(Song).delete()
            session.commit()
            print(f"🗑  Cleared {deleted} existing songs.")

        inserted = 0
        updated  = 0
        skipped_bad = 0

        for i, url in enumerate(urls, start=1):
            yt_id = extract_video_id(url)
            if not yt_id:
                print(f"  ⚠  Line {i}: cannot parse video ID from: {url!r}")
                skipped_bad += 1
                continue

            # Fetch metadata
            if fetch_meta:
                meta = fetch_yt_metadata(yt_id)
                time.sleep(FETCH_DELAY)
            else:
                meta = {"title": f"Chhath Geet #{i}", "artist": "Unknown"}

            title  = meta["title"]
            artist = meta["artist"]

            existing = session.query(Song).filter_by(youtube_video_id=yt_id).first()
            if existing:
                # Update metadata if it was a placeholder
                if existing.title.startswith("Chhath Geet (") or existing.title.startswith("Chhath Geet #"):
                    existing.title  = title
                    existing.artist = artist
                    updated += 1
                    print(f"  🔄  [{i:>3}] Updated: {title[:60]}")
                else:
                    print(f"  ⏭  [{i:>3}] Skip (exists): {existing.title[:60]}")
                continue

            song = Song(
                id=uuid.uuid4(),
                title=title,
                artist=artist,
                youtube_video_id=yt_id,
                youtube_url=f"https://www.youtube.com/watch?v={yt_id}",
                category="chhath",
                enabled=True,
                sort_order=i,
            )
            session.add(song)
            inserted += 1
            print(f"  ✅  [{i:>3}] Added:   {title[:60]} — {artist}")

        session.commit()
        total = session.query(Song).count()

    print()
    print(f"✅  Inserted {inserted} new songs.")
    if updated:
        print(f"🔄  Updated  {updated} existing placeholder songs.")
    if skipped_bad:
        print(f"❌  Skipped  {skipped_bad} lines with unparseable URLs.")
    print(f"📀  Total songs in DB: {total}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    default_file = os.path.join(
        os.path.dirname(__file__), "..", "scripts", "songs.txt"
    )
    if not os.path.exists(default_file):
        default_file = "scripts/songs.txt"

    parser = argparse.ArgumentParser(
        description="Seed Chhath Radio songs from a YouTube URL list with real metadata"
    )
    parser.add_argument(
        "--file", "-f",
        default=default_file,
        help="Path to text file with one YouTube URL per line (default: scripts/songs.txt)",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Delete all existing songs before seeding",
    )
    parser.add_argument(
        "--no-fetch",
        action="store_true",
        help="Skip YouTube metadata fetch; use placeholder title/artist",
    )
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"❌  Songs file not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    seed(songs_file=args.file, clear=args.clear, fetch_meta=not args.no_fetch)