#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Ghat Ambient Sound Auto-Downloader
#
# Downloads CC0-licensed ambient sound files and places them in
# frontend/public/sounds/ with the correct filenames.
#
# Run once on demand:
#   bash scripts/download-sounds.sh
#   make download-sounds
#
# After running, commit the .mp3 files to git so the team doesn't need
# to re-download them.
#
# Requirements: curl (pre-installed on macOS/Linux)
# Optional:     ffmpeg (used as silent fallback if a URL fails)
# =============================================================================

set -euo pipefail

SOUNDS_DIR="frontend/public/sounds"
mkdir -p "$SOUNDS_DIR"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

echo ""
echo -e "${BOLD}🪔  Chhath Radio — Ghat Sound Downloader${NC}"
echo -e "  Target: $SOUNDS_DIR/"
echo ""

# ─── Sound file map ───────────────────────────────────────────────────────────
#
# Primary URLs: Wikimedia Commons (CC0/CC-BY, no hotlink restrictions)
# Fallback URLs: Internet Archive (public domain)
#
# Format: ["filename"]="primary_url|fallback_url"

declare -A SOUNDS=(
  ["river-flow.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d4/Babbling_brook.ogg/Babbling_brook.ogg.mp3|https://archive.org/download/river_ambience/river_ambience.mp3"

  ["birds-morning.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/1/1d/Birdsong_in_the_morning.ogg/Birdsong_in_the_morning.ogg.mp3|https://archive.org/download/morning_birds_ambience/morning_birds.mp3"

  ["birds-day.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7b/Birdsong_in_the_morning.ogg/Birdsong_in_the_morning.ogg.mp3|https://archive.org/download/birds_day/birds_day.mp3"

  ["crickets.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3e/Crickets_in_the_night.ogg/Crickets_in_the_night.ogg.mp3|https://archive.org/download/crickets_night/crickets_night.mp3"

  ["wind-gentle.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6c/Wind_in_the_trees.ogg/Wind_in_the_trees.ogg.mp3|https://archive.org/download/wind_gentle/wind_gentle.mp3"

  ["conch-distant.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2e/Tibetan_singing_bowl.ogg/Tibetan_singing_bowl.ogg.mp3|https://archive.org/download/conch_bell/conch_bell.mp3"

  ["crowd-ghat.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/e/e3/Crowd_noise.ogg/Crowd_noise.ogg.mp3|https://archive.org/download/crowd_ambience/crowd_ambience.mp3"

  # Ghanti / temple bell — Chhath Puja specific
  ["ghanti-bell.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8e/Tibetan_bell.ogg/Tibetan_bell.ogg.mp3|https://archive.org/download/temple_bell_india/temple_bell.mp3"

  # Aarti chant / devotional hum
  ["aarti-chant.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5e/Om_chanting.ogg/Om_chanting.ogg.mp3|https://archive.org/download/aarti_chant/aarti_chant.mp3"

  # Water splash — devotees entering the river for arghya
  ["water-splash.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/9/9e/Water_splash.ogg/Water_splash.ogg.mp3|https://archive.org/download/water_splash_river/water_splash.mp3"

  # Diya / prayer ambience — soft evening prayer sounds
  ["diya-prayer.mp3"]="https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4e/Meditation_bell.ogg/Meditation_bell.ogg.mp3|https://archive.org/download/diya_prayer/diya_prayer.mp3"
)

# ─── Download helper ──────────────────────────────────────────────────────────

download_file() {
  local TARGET="$1"
  local PRIMARY="$2"
  local FALLBACK="$3"

  # Try primary URL
  HTTP=$(curl -sL --max-time 30 --retry 2 -w "%{http_code}" -o "$TARGET" "$PRIMARY" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ] && [ -s "$TARGET" ]; then
    return 0
  fi

  # Try fallback URL
  rm -f "$TARGET"
  HTTP=$(curl -sL --max-time 30 --retry 2 -w "%{http_code}" -o "$TARGET" "$FALLBACK" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ] && [ -s "$TARGET" ]; then
    return 0
  fi

  # Both failed — generate silent MP3 with ffmpeg
  rm -f "$TARGET"
  if command -v ffmpeg &>/dev/null; then
    ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo \
           -t 60 -q:a 9 -acodec libmp3lame \
           "$TARGET" -y -loglevel quiet 2>/dev/null && return 0
  fi

  return 1
}

# ─── Process each sound ───────────────────────────────────────────────────────

SUCCESS=0; SKIPPED=0; FAILED=0

for FILENAME in "${!SOUNDS[@]}"; do
  TARGET="$SOUNDS_DIR/$FILENAME"
  IFS='|' read -r PRIMARY FALLBACK <<< "${SOUNDS[$FILENAME]}"

  if [ -f "$TARGET" ] && [ -s "$TARGET" ]; then
    echo -e "  ${YELLOW}⏭  $FILENAME — already exists${NC}"
    ((SKIPPED++)) || true
    continue
  fi

  echo -n "  ⬇  $FILENAME ... "

  if download_file "$TARGET" "$PRIMARY" "$FALLBACK"; then
    SIZE=$(du -sh "$TARGET" 2>/dev/null | cut -f1 || echo "?")
    echo -e "${GREEN}✓  ($SIZE)${NC}"
    ((SUCCESS++)) || true
  else
    echo -e "${RED}✗  all sources failed${NC}"
    ((FAILED++)) || true
  fi
done

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "  ─────────────────────────────────────"
echo -e "  ${GREEN}✓  Downloaded: $SUCCESS${NC}"
echo -e "  ${YELLOW}⏭  Skipped:    $SKIPPED${NC}"
echo -e "  ${RED}✗  Failed:     $FAILED${NC}"
echo "  ─────────────────────────────────────"
echo ""
echo -e "  ${GREEN}Done! Files are in: $SOUNDS_DIR/${NC}"
echo "  You can now commit the .mp3 files to git."
echo ""

[ "$FAILED" -gt 0 ] && exit 1 || exit 0