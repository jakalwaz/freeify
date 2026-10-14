#!/usr/bin/env bash
# One-time setup (safe to re-run; re-run it when TikTok/Instagram scraping breaks,
# it upgrades yt-dlp). Installs everything into reelscope's own folder:
# $REELSCOPE_HOME, else the plugin data dir, else ~/.reelscope.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${REELSCOPE_HOME:-${CLAUDE_PLUGIN_DATA:-$HOME/.reelscope}}"
fail() { echo "reelscope setup: $*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail "needs an Apple Silicon Mac (local Whisper runs on MLX)."
command -v ffmpeg >/dev/null || fail "ffmpeg missing. Install it: brew install ffmpeg"
command -v node >/dev/null || fail "Node.js missing. Install it: brew install node"
[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]] || fail "Node.js 24+ needed (have $(node -v)). Run: brew upgrade node"
PY="$(command -v python3 || true)"
[[ -n "$PY" ]] && "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))' || fail "Python 3.10+ missing. Install it: brew install python"

mkdir -p "$HOME_DIR"
echo "reelscope: installing into $HOME_DIR"
[[ -x "$HOME_DIR/.venv/bin/python" ]] || "$PY" -m venv "$HOME_DIR/.venv"
"$HOME_DIR/.venv/bin/pip" install -q --upgrade pip
"$HOME_DIR/.venv/bin/pip" install -q --upgrade -r "$ROOT/requirements.txt"

# Headless browser for Instagram profile pages (Instagram needs a real browser logged out).
npm install --silent --no-audit --no-fund --prefix "$HOME_DIR" playwright-core@1.63.0
node "$HOME_DIR/node_modules/playwright-core/cli.js" install chromium-headless-shell

echo "reelscope: ready. The first transcription downloads the Whisper model (~1.6 GB) once."
