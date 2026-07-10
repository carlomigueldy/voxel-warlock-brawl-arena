"""Asset-diet pass for a single rigged GLB (WS-I): shrink a Meshy-generated
character/mob GLB to fit a target file-size budget while preserving its
armature, skin weights, and animation clip(s).

Reality check that shapes this script's approach: profiling the source GLBs
(assets/characters/*.glb, assets/mobs/*.glb) showed the mesh geometry itself
is small (~1-1.5MB of buffer data for ~25k verts) — the actual weight is a
single baked 2048x2048 PNG diffuse/emissive texture that alone accounts for
85-95% of file size (e.g. archmage-rigged.glb: 7.6MB total, 6.1MB is one PNG).
Polygon decimation alone cannot hit a 2.5MB target on files shaped like that,
so this script does two independent things and both matter:

  1. Mesh decimation (Decimate modifier, COLLAPSE mode, placed BEFORE the
     Armature modifier in the stack so vertex groups/skin weights survive the
     apply) + a merge-by-distance pass to clean up collapse-introduced doubles.
  2. Texture recompression: downscale the embedded image to --texture-max on
     its longest side and re-encode as JPEG at --jpeg-quality (no alpha
     channel is used by any of these materials — verified via glTF JSON
     inspection — so JPEG's lack of alpha support is not a regression).

Usage (via the pipeline entrypoint):
    scripts/blender/run.sh --what decimate --in <path> [--out <path>]
        [--ratio 0.65] [--texture-max 1024] [--jpeg-quality 90]
        [--merge-distance 0.0001] [--verify]

`--verify` re-imports the just-written GLB into a fresh scene and prints mesh/
action counts so the caller can diff them against the pre-decimate counts
printed earlier in the same run, without trusting the export blindly.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import _compat


def _reset():
    _compat.reset_scene()


def _import(path):
    bpy.ops.import_scene.gltf(filepath=path)


def _mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def _report_counts(label):
    meshes = _mesh_objects()
    verts = sum(len(o.data.vertices) for o in meshes)
    polys = sum(len(o.data.polygons) for o in meshes)
    actions = [a.name for a in bpy.data.actions]
    images = list(bpy.data.images)
    img_info = [(im.name, im.size[0], im.size[1]) for im in images if im.size[0]]
    print(f"[decimate_glb] {label}: meshes={len(meshes)} verts={verts} polys={polys} "
          f"actions={actions} images={img_info}")
    return {"meshes": len(meshes), "verts": verts, "polys": polys, "actions": set(actions)}


def _has_armature_modifier(obj):
    return any(m.type == "ARMATURE" for m in obj.modifiers)


def _decimate_mesh(obj, ratio, merge_distance):
    """Add a Decimate (COLLAPSE) modifier ahead of any Armature modifier so
    applying it never disturbs the armature deform, then apply it. Follows
    with an edit-mode merge-by-distance pass to clean up collapse seams.
    Skips objects with shape keys (Decimate + shape keys is unsupported by
    Blender and would silently corrupt morph data) — caller should check
    `obj.data.shape_keys` first and report a skip instead of calling this.
    """
    dec = obj.modifiers.new(name="AssetDietDecimate", type="DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = ratio
    # Move the new modifier to the front of the stack (index 0) so it's
    # evaluated before the Armature deform — applying an out-of-order
    # modifier in Blender folds in every modifier ahead of it too, which
    # would incorrectly bake the armature's bind-pose deform into the mesh.
    with bpy.context.temp_override(object=obj):
        bpy.ops.object.modifier_move_to_index(modifier=dec.name, index=0)
        bpy.ops.object.modifier_apply(modifier=dec.name)

    # Merge-by-distance: clean up any coincident verts the collapse left
    # behind. Vertex groups (skin weights) follow Blender's standard
    # edit-mode merge behavior (weighted average of merged verts).
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=merge_distance)
    bpy.ops.object.mode_set(mode="OBJECT")


def _recompress_textures(texture_max, jpeg_quality):
    """Downscale every embedded image above `texture_max` on its longest
    side. The actual re-encode to JPEG happens at export time via
    export_image_format/export_jpeg_quality — this only resizes pixel data
    in-memory so the smaller export inherits the smaller resolution too.
    """
    for img in bpy.data.images:
        w, h = img.size[0], img.size[1]
        if w <= 0 or h <= 0:
            continue
        longest = max(w, h)
        if longest <= texture_max:
            continue
        scale = texture_max / float(longest)
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img.scale(new_w, new_h)
        print(f"[decimate_glb] resized image '{img.name}' {w}x{h} -> {new_w}x{new_h}")


def _export(path, jpeg_quality):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_animations=True,
        export_skins=True,
        export_morph_animation=True,
        export_image_format="JPEG",
        export_jpeg_quality=jpeg_quality,
        export_optimize_animation_size=True,
    )


def run(in_path, out_path, ratio, texture_max, jpeg_quality, merge_distance, verify):
    _reset()
    _import(in_path)
    before = _report_counts("before")

    skipped = []
    for obj in _mesh_objects():
        if not _has_armature_modifier(obj):
            continue  # non-skinned prop mesh (e.g. a stray Icosphere) — leave untouched
        if obj.data.shape_keys:
            skipped.append(obj.name)
            continue
        _decimate_mesh(obj, ratio, merge_distance)

    _recompress_textures(texture_max, jpeg_quality)

    after = _report_counts("after (pre-export)")
    if skipped:
        print(f"[decimate_glb] SKIPPED decimation on shape-keyed mesh(es): {skipped}")

    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    _export(out_path, jpeg_quality)

    size_before = os.path.getsize(in_path) if os.path.exists(in_path) else -1
    size_after = os.path.getsize(out_path)
    print(f"[decimate_glb] {in_path} -> {out_path}: "
          f"{size_before/1e6:.2f}MB -> {size_after/1e6:.2f}MB")

    if verify:
        _reset()
        _import(out_path)
        reimported = _report_counts("reimport-verify")
        ok = (
            reimported["meshes"] == after["meshes"]
            and reimported["actions"] == before["actions"]
        )
        print(f"[decimate_glb] verify: actions-preserved={reimported['actions'] == before['actions']} "
              f"mesh-count-match={reimported['meshes'] == after['meshes']} -> {'OK' if ok else 'MISMATCH'}")
        if not ok:
            print("[decimate_glb] WARNING: verification mismatch — inspect output before trusting it.")

    return size_before, size_after


def main(argv=None):
    """`argv`, when given, is used instead of _compat.get_args() — lets
    build.py's `--what decimate` branch hand this its own leftover CLI args
    without going through the process's real argv twice."""
    parser = argparse.ArgumentParser(description="Decimate + recompress a rigged GLB (WS-I asset diet)")
    parser.add_argument("--in", dest="in_path", required=True)
    parser.add_argument("--out", dest="out_path", default=None, help="defaults to overwriting --in")
    parser.add_argument("--ratio", type=float, default=0.65, help="Decimate COLLAPSE ratio (fraction of faces kept)")
    parser.add_argument("--texture-max", type=int, default=1024, help="max texture side in px before re-encode")
    parser.add_argument("--jpeg-quality", type=int, default=90)
    parser.add_argument("--merge-distance", type=float, default=1e-4)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv if argv is not None else _compat.get_args())

    out_path = args.out_path or args.in_path
    run(args.in_path, out_path, args.ratio, args.texture_max, args.jpeg_quality,
        args.merge_distance, args.verify)


if __name__ == "__main__":
    main()
