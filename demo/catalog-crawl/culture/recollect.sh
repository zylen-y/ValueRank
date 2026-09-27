#!/usr/bin/env bash
# Replays bounded, unauthenticated browser collection. Run from the repository root.
# Stop immediately if a source changes to a login, consent, CAPTCHA, or denial page.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="catalog-culture"
ab() { npx --yes agent-browser --session "$SESSION" "$@"; }
capture_music() {
 local name="$1" url="$2"
 ab open "$url"
 ab snapshot -i > "$ROOT/evidence/$name.snapshot.txt"
 ab eval --stdin < "$ROOT/apple-dom.js" > "$ROOT/raw/$name.browser.json"
}
capture_youtube() {
 local name="$1" url="$2"
 ab open "$url"
 ab snapshot -i > "$ROOT/evidence/$name.snapshot.txt"
 for step in $(seq 1 20); do ab scroll down 750 > /dev/null; done
 ab eval --stdin < "$ROOT/youtube-dom.js" > "$ROOT/raw/$name.browser.json"
}
MODE="${1:-all}"
if [[ "$MODE" == "music" || "$MODE" == "all" ]]; then
 capture_music apple-global 'https://music.apple.com/us/playlist/top-100-global/pl.d25f5d1181894928af76c85c967f8f31'
 capture_music apple-korea 'https://music.apple.com/us/playlist/top-100-south-korea/pl.d3d10c32fbc540b38e266367dc8cb00c'
fi
if [[ "$MODE" == "youtube" || "$MODE" == "all" ]]; then
 capture_youtube youtube-fireship 'https://www.youtube.com/@Fireship/videos'
 capture_youtube youtube-3blue1brown 'https://www.youtube.com/@3blue1brown/videos'
 capture_youtube youtube-freecodecamp 'https://www.youtube.com/@freecodecamp/videos'
 capture_youtube youtube-figma 'https://www.youtube.com/@Figma/videos'
fi
node "$ROOT/normalize.mjs"
ab close
