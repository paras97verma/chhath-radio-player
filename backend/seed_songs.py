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

from sqlalchemy import create_engine, func
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


def resolve_songs_file(custom_path: str | None = None) -> str:
    """
    Find the songs file in order of priority:
    1. Explicit custom path (if it exists)
    2. backend/data/songs.txt (production packaged file)
    3. backend/app/data/songs.txt (app data directory)
    4. scripts/songs.txt (repository root scripts directory)
    5. /scripts/songs.txt (Docker volume mount in local compose)
    """
    if custom_path and os.path.exists(custom_path):
        return custom_path

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "data", "songs.txt"),
        os.path.join(base_dir, "app", "data", "songs.txt"),
        os.path.join(base_dir, "..", "scripts", "songs.txt"),
        "/scripts/songs.txt",
        "data/songs.txt",
        "app/data/songs.txt",
        "scripts/songs.txt",
        "songs.txt",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p

    return custom_path or candidates[0]


# ── Seeder ────────────────────────────────────────────────────────────────────

def seed(songs_file: str | None = None, clear: bool = False, fetch_meta: bool = True) -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)

    resolved_file = resolve_songs_file(songs_file)
    if not os.path.exists(resolved_file):
        raise FileNotFoundError(f"Songs file not found. Checked candidate path: {resolved_file}")

    urls = load_urls(resolved_file)
    print(f"📄  Loaded {len(urls)} URLs from {resolved_file}")
    if fetch_meta:
        print("🌐  Will fetch YouTube metadata for each song (oEmbed, no API key)…")

    with Session(engine) as session:
        if clear:
            deleted = session.query(Song).delete()
            session.commit()
            print(f"🗑  Cleared {deleted} existing songs.")

        # Determine next sort_order to maintain clean sequential order without collisions
        max_order = session.query(func.max(Song.sort_order)).scalar() or 0
        current_order = 0 if clear else max_order

        inserted = 0
        skipped_existing = 0
        skipped_duplicate_in_file = 0
        updated = 0
        skipped_bad = 0
        seen_in_batch = set()

        for i, url in enumerate(urls, start=1):
            yt_id = extract_video_id(url)
            if not yt_id:
                print(f"  ⚠  Line {i}: cannot parse video ID from: {url!r}")
                skipped_bad += 1
                continue

            # Idempotency check 1: De-duplicate within the file itself
            if yt_id in seen_in_batch:
                print(f"  ⏭  [{i:>3}] Skip (duplicate in file): {yt_id}")
                skipped_duplicate_in_file += 1
                continue
            seen_in_batch.add(yt_id)

            # Idempotency check 2: Check if song already exists in the database
            existing = session.query(Song).filter_by(youtube_video_id=yt_id).first()
            if existing:
                # If existing record has placeholder text, upgrade it with real metadata if available
                if existing.title.startswith("Chhath Geet (") or existing.title.startswith("Chhath Geet #"):
                    if fetch_meta:
                        meta = fetch_yt_metadata(yt_id)
                        existing.title = meta["title"]
                        existing.artist = meta["artist"]
                        updated += 1
                        print(f"  🔄  [{i:>3}] Updated placeholder: {existing.title[:60]}")
                        time.sleep(FETCH_DELAY)
                else:
                    skipped_existing += 1
                    print(f"  ⏭  [{i:>3}] Skip (already exists): {existing.title[:60]}")
                continue

            # New song: Fetch metadata and insert
            if fetch_meta:
                meta = fetch_yt_metadata(yt_id)
                time.sleep(FETCH_DELAY)
            else:
                meta = {"title": f"Chhath Geet #{current_order + 1}", "artist": "Unknown"}

            title = meta["title"]
            artist = meta["artist"]

            current_order += 1
            song = Song(
                id=uuid.uuid4(),
                title=title,
                artist=artist,
                youtube_video_id=yt_id,
                youtube_url=f"https://www.youtube.com/watch?v={yt_id}",
                category="chhath",
                enabled=True,
                sort_order=current_order,
            )
            session.add(song)
            inserted += 1
            print(f"  ✅  [{i:>3}] Added:   {title[:60]} — {artist}")

        session.commit()
        total = session.query(Song).count()

    # Invalidate Redis queue cache so newly seeded/updated songs appear immediately
    try:
        from app.core.redis import get_redis_client
        redis_client = get_redis_client()
        if redis_client:
            redis_client.delete("chhath:queue")
            print("🧹  Invalidated Redis queue cache ('chhath:queue').")
    except Exception as exc:
        print(f"ℹ  Note: Could not invalidate Redis cache (may be offline): {exc}")

    print()
    print(f"✅  Inserted {inserted} new songs.")
    if skipped_existing:
        print(f"⏭   Skipped  {skipped_existing} existing songs (already in database).")
    if skipped_duplicate_in_file:
        print(f"⏭   Skipped  {skipped_duplicate_in_file} duplicates within the file.")
    if updated:
        print(f"🔄  Updated  {updated} placeholder songs.")
    if skipped_bad:
        print(f"❌  Skipped  {skipped_bad} lines with unparseable URLs.")
    print(f"📀  Total songs in DB: {total}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Seed Chhath Radio songs from a YouTube URL list with real metadata"
    )
    parser.add_argument(
        "--file", "-f",
        default=None,
        help="Path to text file with one YouTube URL per line (default: auto-detected)",
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

    target_file = resolve_songs_file(args.file)
    if not os.path.exists(target_file):
        print(f"❌  Songs file not found: {target_file}", file=sys.stderr)
        sys.exit(1)

    seed(songs_file=target_file, clear=args.clear, fetch_meta=not args.no_fetch)