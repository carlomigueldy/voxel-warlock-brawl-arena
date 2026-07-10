"""Shared compatibility shim for the Blender/bpy asset pipeline.

Every pipeline script (build.py and friends) imports this module first. It
smooths over the two supported ways to run bpy code in this repo:

  1. Standalone: `scripts/blender/.venv/bin/python scripts/blender/build.py --what test`
     (the pip-installed `bpy` wheel, no Blender process wrapping it).
  2. Fallback:   `blender --background --python scripts/blender/build.py -- --what test`
     (Blender's own bundled Python; args after `--` are ours, everything
     before it belongs to Blender).

Both cases `import bpy` successfully — the difference that matters is how
argv is shaped, and what the current working directory is (Blender may be
invoked from any directory, so paths must resolve relative to the repo root,
never relative to CWD).
"""

import sys
import os

import bpy  # noqa: F401  (import validated here so callers fail fast with a clear error)


def running_under_blender_binary() -> bool:
    """True when invoked as `blender --background --python script.py -- ...`.

    Blender's launcher always includes `--` as the separator between its own
    args and the script's args, and `bpy.app.background` is only meaningful
    inside the real Blender binary (the standalone `bpy` wheel has no
    background-mode concept the same way).
    """
    return "--" in sys.argv and hasattr(bpy.app, "binary_path") and bool(bpy.app.binary_path)


def get_args():
    """Return this pipeline's own CLI args, normalized across both runners.

    - Under `blender --background --python build.py -- --what test`, argv is
      [blender, ..., --python, build.py, --, --what, test] — we want
      everything after the first `--`.
    - Under the standalone venv (`python build.py --what test`), argv is
      [build.py, --what, test] — we want everything after argv[0].
    """
    argv = sys.argv
    if "--" in argv:
        idx = argv.index("--")
        return argv[idx + 1 :]
    return argv[1:]


def _find_repo_root(start: str) -> str:
    """Walk upward from `start` until a directory containing package.json
    (this repo's root marker) is found. Falls back to three levels up from
    this file (scripts/blender/_compat.py -> repo root) if the marker is
    somehow missing, so OUTPUT_ROOT is never wrong just because the runner's
    CWD is unrelated to the repo (Blender may be launched from anywhere).
    """
    current = os.path.abspath(start)
    while True:
        if os.path.isfile(os.path.join(current, "package.json")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        current = parent


REPO_ROOT = _find_repo_root(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_ROOT = os.path.join(REPO_ROOT, "scripts", "blender", "out")


def reset_scene():
    """Reset to a clean, empty scene regardless of runner.

    Safe to call at the start of every build script so accumulated state from
    a previous invocation (when running inside a long-lived interactive
    Blender session) never leaks into a new export.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ensure_output_dir():
    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    return OUTPUT_ROOT
