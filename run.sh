#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  DoodleLab — one-command launcher (macOS; Linux likely works but is untested)
#
#    ./run.sh            production build + start (smoothest for demos)
#    ./run.sh --dev      Next.js dev server with hot reload
#    PORT=3020 ./run.sh  choose a port (default 3015; the next free one is used if busy)
#    DOODLELAB_NO_OPEN=1 don't open the browser automatically
#
#  Drawing, recognition of your sketches and physics need NO model. Ollama is only used
#  for the copilot's broader requests, explanations and optional photo role hints.
#  This script never downloads a model without asking first.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

MODE="prod"
[[ "${1:-}" == "--dev" ]] && MODE="dev"
OLLAMA_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
[[ "$OLLAMA_URL" != http* ]] && OLLAMA_URL="http://$OLLAMA_URL"
PORT="${PORT:-$(grep -Eo 'port:[[:space:]]*[0-9]+' app.config.ts | grep -Eo '[0-9]+' | head -1)}"
PORT="${PORT:-3015}"
TEXT_MODEL="${MODEL:-$(grep -Eo 'defaultModel:[[:space:]]*"[^"]+"' app.config.ts | grep -Eo '"[^"]+"' | tr -d '"')}"
VISION_MODEL="$(grep -Eo 'suggestedVisionModel:[[:space:]]*"[^"]+"' app.config.ts | grep -Eo '"[^"]+"' | tr -d '"')"
RUN_DIR=".doodlelab-run"
DIST="${NEXT_DIST_DIR:-.next}"
mkdir -p "$RUN_DIR"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
info() { printf "\033[36m›\033[0m %s\n" "$1"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "\033[33m!\033[0m %s\n" "$1"; }
err()  { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; }
ask()  { # ask "question" → returns 0 for yes. Non-interactive shells always answer no.
  [[ -t 0 ]] || return 1
  local a; read -r -p "$(printf "\033[35m?\033[0m %s [y/N] " "$1")" a || return 1
  [[ "$a" =~ ^[Yy] ]]
}

bold "DoodleLab — Draw it. Bring it to life."
echo  "The Sunday Builds — Solving Real Problems using Free AI, every Sunday."
echo

# 1) Node.js ------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Install the LTS version (20.9 or newer) from https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 9) )); then
  err "Node.js $(node --version) is too old. Next.js 16 needs 20.9 or newer."
  exit 1
fi
ok "Node.js $(node --version)"

# 2) Dependencies -------------------------------------------------------------
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  info "Installing dependencies (first run needs internet)…"
  npm install --no-fund --no-audit
fi
ok "Dependencies installed"

# 3) Ollama (optional) --------------------------------------------------------
ollama_up() { curl -fsS --max-time 2 "$OLLAMA_URL/api/version" >/dev/null 2>&1; }
if ollama_up; then
  ok "Ollama is already running at $OLLAMA_URL (reusing it)"
elif command -v ollama >/dev/null 2>&1; then
  info "Starting 'ollama serve' in the background (log: $RUN_DIR/ollama.log)…"
  nohup ollama serve >"$RUN_DIR/ollama.log" 2>&1 &
  for _ in $(seq 1 20); do ollama_up && break; sleep 0.5; done
  if ollama_up; then ok "Ollama started"; else warn "Ollama did not start — AI features will be unavailable (drawing + physics still work)."; fi
else
  warn "Ollama is not installed — AI features are optional. Install from https://ollama.com/download"
fi

if ollama_up; then
  TAGS="$(curl -fsS --max-time 4 "$OLLAMA_URL/api/tags" || echo '{}')"
  has_model() { printf "%s" "$TAGS" | grep -q "\"name\":\"$1\""; }
  if [[ -n "$TEXT_MODEL" ]] && ! has_model "$TEXT_MODEL"; then
    warn "Text model '$TEXT_MODEL' is not installed (used by the copilot and explanations)."
    if ask "Download $TEXT_MODEL now? (≈2.5 GB, one-time, needs internet)"; then
      ollama pull "$TEXT_MODEL"
    else
      info "Skipped. Later: ollama pull $TEXT_MODEL"
    fi
  elif [[ -n "$TEXT_MODEL" ]]; then
    ok "Text model '$TEXT_MODEL' is installed"
  fi
  if [[ -n "$VISION_MODEL" ]] && ! has_model "$VISION_MODEL"; then
    info "Optional vision model '$VISION_MODEL' is not installed (only adds role hints for photos)."
    if ask "Download $VISION_MODEL too? (≈3.2 GB, optional)"; then
      ollama pull "$VISION_MODEL"
    fi
  fi
fi

# 4) Port ---------------------------------------------------------------------
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
is_doodlelab() { curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q '"matter"'; }
if port_busy "$PORT"; then
  if is_doodlelab "$PORT"; then
    ok "DoodleLab is already running → http://localhost:$PORT"
    [[ -z "${DOODLELAB_NO_OPEN:-}" ]] && command -v open >/dev/null 2>&1 && open "http://localhost:$PORT"
    exit 0
  fi
  warn "Port $PORT is in use by another app."
  for p in $(seq $((PORT + 1)) $((PORT + 20))); do
    if ! port_busy "$p"; then PORT="$p"; break; fi
  done
  info "Using port $PORT instead."
fi
export PORT

# 5) Launch -------------------------------------------------------------------
open_when_ready() {
  for _ in $(seq 1 120); do
    if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      [[ -z "${DOODLELAB_NO_OPEN:-}" ]] && command -v open >/dev/null 2>&1 && open "http://localhost:$PORT"
      return
    fi
    sleep 0.5
  done
}
echo
if [[ "$MODE" == "dev" ]]; then
  bold "Starting dev server → http://localhost:$PORT"
  open_when_ready &
  exec npx next dev -p "$PORT"
else
  if [[ ! -f "$DIST/BUILD_ID" ]] || [[ -n "$(find app components lib public app.config.ts -newer "$DIST/BUILD_ID" -print -quit 2>/dev/null)" ]]; then
    info "Building the app (first run, ~30 s)…"
    npx next build
  fi
  bold "Starting DoodleLab → http://localhost:$PORT"
  open_when_ready &
  exec npx next start -p "$PORT"
fi
