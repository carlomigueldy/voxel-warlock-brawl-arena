#!/usr/bin/env bash
# Single entrypoint for the Blender/bpy asset pipeline. Picks the venv's
# Python if a working `bpy` import lives there (from scripts/blender/env.sh),
# else falls back to `blender --background --python build.py -- <args>`,
# which is a fully supported execution mode, not an error path.
#
# Usage: scripts/blender/run.sh --what {test,props,icons,all}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="$SCRIPT_DIR/.venv/bin/python"
BUILD_PY="$SCRIPT_DIR/build.py"
BLENDER_BIN="${BLENDER_BIN:-$HOME/.local/bin/blender}"

if [ -x "$VENV_PY" ] && "$VENV_PY" -c "import bpy" >/dev/null 2>&1; then
  exec "$VENV_PY" "$BUILD_PY" "$@"
fi

if [ ! -x "$BLENDER_BIN" ] && ! command -v "$BLENDER_BIN" >/dev/null 2>&1; then
  echo "[blender/run] no venv bpy and no Blender binary at '$BLENDER_BIN'." >&2
  echo "[blender/run] run 'bash scripts/blender/env.sh' first, or set BLENDER_BIN." >&2
  exit 1
fi

exec "$BLENDER_BIN" --background --python "$BUILD_PY" -- "$@"
