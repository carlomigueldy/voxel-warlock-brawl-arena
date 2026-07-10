"""Shared voxel mesh builder for the Blender/bpy asset pipeline.

Convention (see scripts/blender/README.md): 1 grid unit = 0.1 world units.
VoxelGrid stores integer cell coordinates; build_mesh() applies the `unit`
scale factor when placing vertices, so a grid built at (0,0,0)-(9,9,9)
occupies a 1x1x1 world-unit cube by default — matching a small prop's
footprint against the game's coarse CFG.VOXEL=1 world grid.
"""

import bmesh
import bpy

import palette

DEFAULT_UNIT = 0.1

# Six cube faces as (outward normal) -> 4 corner offsets (0/1 cube-local),
# each list wound CCW as seen from outside the cube (verified via the
# right-hand cross-product rule so calculated face normals point outward).
_FACES = {
    (1, 0, 0):  [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    (-1, 0, 0): [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    (0, 1, 0):  [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    (0, -1, 0): [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    (0, 0, 1):  [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
    (0, 0, -1): [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
}


class VoxelGrid:
    """A sparse integer voxel grid: {(x, y, z): color_name}.

    Any randomness used while populating a grid MUST be driven by a caller-
    supplied `random.Random(seed)` instance — never the unseeded `random`
    module — so builds stay reproducible byte-for-byte in mesh content.
    """

    def __init__(self):
        self.cells = {}

    def set(self, x, y, z, color_name):
        self.cells[(int(x), int(y), int(z))] = color_name

    def get(self, x, y, z):
        return self.cells.get((int(x), int(y), int(z)))

    def is_occupied(self, x, y, z):
        return (int(x), int(y), int(z)) in self.cells

    def box(self, x0, y0, z0, x1, y1, z1, color_name):
        """Fill the inclusive axis-aligned box between (x0,y0,z0) and (x1,y1,z1)."""
        xa, xb = sorted((int(x0), int(x1)))
        ya, yb = sorted((int(y0), int(y1)))
        za, zb = sorted((int(z0), int(z1)))
        for x in range(xa, xb + 1):
            for y in range(ya, yb + 1):
                for z in range(za, zb + 1):
                    self.set(x, y, z, color_name)

    def line(self, p0, p1, color_name):
        """Fill a 3D line of voxels between two integer points (inclusive)."""
        x0, y0, z0 = (int(v) for v in p0)
        x1, y1, z1 = (int(v) for v in p1)
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        steps = max(abs(dx), abs(dy), abs(dz), 1)
        for i in range(steps + 1):
            t = i / steps
            x = round(x0 + dx * t)
            y = round(y0 + dy * t)
            z = round(z0 + dz * t)
            self.set(x, y, z, color_name)

    def sphere(self, cx, cy, cz, radius, color_name):
        """Fill all voxels whose center lies within `radius` of (cx, cy, cz)."""
        r = int(radius)
        cx, cy, cz = int(cx), int(cy), int(cz)
        for x in range(cx - r, cx + r + 1):
            for y in range(cy - r, cy + r + 1):
                for z in range(cz - r, cz + r + 1):
                    if (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= radius * radius:
                        self.set(x, y, z, color_name)

    def mirror_x(self):
        """Mirror every existing cell across the x=0 plane, adding the
        mirrored cells (originals are kept, nothing is overwritten)."""
        for (x, y, z), color_name in list(self.cells.items()):
            self.set(-x, y, z, color_name)

    def bounds(self):
        """Return (min_x, min_y, min_z, max_x, max_y, max_z), all zero if empty."""
        if not self.cells:
            return (0, 0, 0, 0, 0, 0)
        xs = [c[0] for c in self.cells]
        ys = [c[1] for c in self.cells]
        zs = [c[2] for c in self.cells]
        return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def build_mesh(grid, name, unit=DEFAULT_UNIT):
    """Turn a VoxelGrid into a single merged Blender mesh object.

    One cube per occupied cell; a face shared between two occupied cells is
    skipped (no interior geometry). Flat-shaded. Per-face color comes from
    each cell's palette color name, written into a "Col" FLOAT_COLOR
    attribute on the CORNER domain — three.js's GLTFLoader reads this as
    COLOR_0 after export.
    """
    bm = bmesh.new()
    face_colors = []  # parallel to bm.faces, in creation order

    for (x, y, z), color_name in grid.cells.items():
        rgba = palette.color_rgba(color_name)
        for normal, corners in _FACES.items():
            neighbor = (x + normal[0], y + normal[1], z + normal[2])
            if grid.is_occupied(*neighbor):
                continue  # interior face between two occupied cells
            verts = [
                bm.verts.new(((x + cx) * unit, (y + cy) * unit, (z + cz) * unit))
                for cx, cy, cz in corners
            ]
            bm.faces.new(verts)
            face_colors.append(rgba)

    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    bm.normal_update()

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    color_attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    for poly, rgba in zip(mesh.polygons, face_colors):
        poly.use_smooth = False  # flat shading
        for loop_index in poly.loop_indices:
            color_attr.data[loop_index].color = rgba

    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    _assign_vertex_color_material(obj)
    return obj


def _assign_vertex_color_material(obj):
    """Attach one shared Principled BSDF material driven by the "Col"
    vertex-color attribute, so exported GLBs carry no external textures
    (keeps file size minimal) while still round-tripping vertex colors."""
    mat_name = "VoxelVertexColor"
    mat = bpy.data.materials.get(mat_name)
    if mat is None:
        mat = bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        color_node = nodes.new("ShaderNodeVertexColor")
        color_node.layer_name = "Col"
        links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
        bsdf.inputs["Roughness"].default_value = 0.7
        color_node.location = (-300, 0)
        bsdf.location = (0, 0)
        output.location = (300, 0)

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def export_glb(obj_or_objs, path):
    """Export one or more mesh objects to a minimal GLB: vertex colors from
    the "Col" attribute, no Draco, no textures, no extras/lights/cameras."""
    objs = list(obj_or_objs) if isinstance(obj_or_objs, (list, tuple)) else [obj_or_objs]

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="NAME",
        export_vertex_color_name="Col",
        export_all_vertex_colors=True,
        export_draco_mesh_compression_enable=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    return path
