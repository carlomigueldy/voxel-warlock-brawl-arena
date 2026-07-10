#!/usr/bin/env bash
# Idempotent bootstrap for the Blender/bpy procedural asset pipeline.
#
# Tries, in order:
#   1. Reuse an existing venv that already has a working `bpy` import.
#   2. Create scripts/blender/.venv with python3.11 and `pip install bpy==5.1.2`.
#   3. Fall back to the newest `bpy` wheel compatible with the interpreter.
#   4. If no wheel installs at all, that is NOT an error: scripts/blender/run.sh
#      transparently falls back to `blender --background --python ...`, which
#      is a fully supported execution mode. This script always exits 0 in that
#      case so CI/npm scripts don't fail just because no bpy wheel exists yet
#      for the local interpreter.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PREFERRED_BPY_VERSION="5.1.2"

log() { printf '[blender/env] %s\n' "$1"; }

if "$VENV_DIR/bin/python" -c "import bpy" >/dev/null 2>&1; then
  installed="$("$VENV_DIR/bin/python" -c "import bpy; print(getattr(bpy.app, 'version_string', 'unknown'))" 2>/dev/null)"
  log "bpy already installed in venv (Blender ${installed:-unknown}) — nothing to do."
  exit 0
fi

if ! command -v python3.11 >/dev/null 2>&1; then
  log "python3.11 not found on PATH."
  log "No bpy wheel can be installed; falling back to 'blender --background' at run time. This is fully supported."
  exit 0
fi

if [ ! -d "$VENV_DIR" ]; then
  log "Creating venv at $VENV_DIR with python3.11..."
  python3.11 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null 2>&1

log "Attempting: pip install bpy==${PREFERRED_BPY_VERSION}"
if "$VENV_DIR/bin/pip" install "bpy==${PREFERRED_BPY_VERSION}" >/tmp/blender-env-pip.log 2>&1; then
  log "Installed bpy==${PREFERRED_BPY_VERSION}."
  exit 0
fi

log "bpy==${PREFERRED_BPY_VERSION} not available for this interpreter; trying newest compatible 'bpy' wheel..."
if "$VENV_DIR/bin/pip" install "bpy" >/tmp/blender-env-pip.log 2>&1; then
  version="$("$VENV_DIR/bin/python" -c "import bpy; print(bpy.app.version_string)" 2>/dev/null || echo unknown)"
  log "Installed bpy (Blender ${version})."
  exit 0
fi

log "No bpy wheel could be installed for this interpreter (see /tmp/blender-env-pip.log)."
log "Falling back to 'blender --background --python scripts/blender/build.py -- <args>' — this is fully supported, not an error."
exit 0
