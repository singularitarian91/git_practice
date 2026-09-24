#!/usr/bin/env python3
"""
Juxtapose -- procedural 3D asset kit.

Models every prop, environment piece and enemy of the game procedurally with
bpy/bmesh (Blender 4.2 as a Python module) and exports them all to
juxtapose/assets/props.glb, then re-imports the file and checks the contract.

    python3 juxtapose/blender/build_props.py
    python3 juxtapose/blender/build_props.py --only Clock,Cloud --out /tmp/test.glb
    python3 juxtapose/blender/build_props.py --no-verify

Conventions
  * meters, Blender Z-up (the exporter converts to glTF Y-up)
  * every asset's front faces Blender -Y  (three.js +Z)
  * top-level objects: no parent, at the world origin, identity transform
  * origins are set by moving mesh data, never by moving objects
  * materials: Principled BSDF with constant inputs; surface variation comes from
    a colour attribute "Col" (exported as COLOR_0, multiplies the base colour)
  * deterministic: each asset uses its own seeded RNG
  * UVs exist only where the game needs them (Frame_Opening, Easel_Canvas, and
    the textured kit below); glTF stores v flipped (v = 0 at the top), so
    textures need flipY = false
  * alpha < 1 (FrameOpening, JarGlass) exports as alphaMode BLEND

Textured kit (Wall, Column, Rocks, Platform, DeadTree, Arch, RailPost, Door,
Drawers, Bed, Train and the fracture templates)
  * materials named TX_<name> are white placeholders: the game gives them the
    shared baked PBR set assets/tex/<name>_* (texlib.py) with repeat 1 / tile.
    No texture is embedded; render_previews.py wires the same maps in for the
    contact sheets.
  * UVs are world metres (1 UV unit = 1 m): per-face box projection, turned
    and swept parts get arc-length x circumference (oak grain along U);
    sandstone blocks are mapped inside single blocks of the texture's ashlar
  * COLOR_0 = tint x procedural grime x Cycles-baked ambient occlusion
    (bake_ao: AO to vertex colours, each asset baked alone, on a ground plane
    where it stands on one)
  * fracture templates are cut from the solid's own closed parts (Voronoi or
    hand-placed planes, clip + cap), so pieces match what was broken; cut faces
    get the inside material; chunk volumes sum to the solid's

Triangle budgets (perf pass; per root incl. children, enforced by verify via
TRI_CAPS): Pomegranate, BowlerHat, Candle 1.2k; Clock, RailPost 2k; Birdcage,
Mirror, Drawers 3k; Platform 3.5k; Bed, DeadTree, Column, Wall 6k; each Rock
1.5k; Train 8k; every fracture chunk <= 300 (decimated to CHUNK_TRIS).  Detail
comes from the textures and baked AO: fewer ring segments, collapse decimation
(decimate_bm / finish(..., decimate=N)) where a shape needs its silhouette.
"""
import bpy
import bmesh
import math
import random
import os
import sys
import json
import struct
import time
from mathutils import Vector as V, Matrix, noise
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(PROJ, 'assets', 'props.glb')
TAU = math.tau


# ----------------------------------------------------------------------------
# small maths helpers
# ----------------------------------------------------------------------------
def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smoothstep(e0, e1, x):
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def mix3(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))


def mul3(a, b):
    return (a[0] * b[0], a[1] * b[1], a[2] * b[2])


def grey(k):
    return (k, k, k)


def fbm(p, octaves=3, lac=2.03, gain=0.5):
    s, amp, f, norm = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        s += amp * noise.noise(p * f)
        norm += amp
        amp *= gain
        f *= lac
    return s / norm


def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(srgb2lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
MATS = {}


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, double=False, alpha=1.0):
    """Principled BSDF with constant values; Base Color = constant * Col attribute.
    alpha < 1 exports as glTF alphaMode BLEND."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    lin = hexcol(color)
    b.inputs['Base Color'].default_value = (*lin, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs[7].default_value = (*lin, 1.0)
    nt.links.new(vc.outputs['Color'], mix.inputs[6])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*hexcol(emit), 1.0)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    m.use_backface_culling = not double
    m.diffuse_color = (*lin, 1.0)
    m.metallic = metal
    m.roughness = rough
    MATS[name] = m
    return m


def palette():
    """The shared surrealist palette."""
    P = {}
    P['stucco'] = material('Stucco', '#f0e2c2', 0.0, 0.9)
    P['arcade'] = material('ArcadeStucco', '#e0b273', 0.0, 0.9)
    P['wallint'] = material('WallInterior', '#9a5236', 0.0, 1.0)
    P['marble'] = material('Marble', '#efe6d2', 0.0, 0.45)
    P['stoneint'] = material('StoneInterior', '#a8977b', 0.0, 1.0)
    P['wood'] = material('Wood', '#5a3320', 0.0, 0.45)
    P['darkwood'] = material('DarkWood', '#3d2416', 0.0, 0.42)
    P['woodint'] = material('WoodInterior', '#c89c64', 0.0, 0.95)
    P['brass'] = material('Brass', '#d8ae55', 1.0, 0.3)
    P['gold'] = material('Gold', '#e8b852', 1.0, 0.2)
    P['gilt'] = material('Gilt', '#cc9f45', 1.0, 0.3)
    P['ink'] = material('Ink', '#1d1916', 0.0, 0.45)
    P['sheet'] = material('Sheet', '#f3efe5', 0.0, 0.8, double=True)
    P['sand'] = material('Sand', '#dcbd86', 0.0, 1.0)
    P['sandstone'] = material('Sandstone', '#dcb27a', 0.0, 0.95)
    P['terracotta'] = material('Terracotta', '#c0643c', 0.0, 0.85)
    P['deadwood'] = material('DeadWood', '#b3a08a', 0.0, 0.9)
    return P


# ----------------------------------------------------------------------------
# bmesh primitive helpers (all return a fresh bmesh in world/assembly space)
# ----------------------------------------------------------------------------
def xform(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


def move(bm, v):
    bmesh.ops.translate(bm, vec=V(v), verts=bm.verts)
    return bm


def scale(bm, s, center=(0, 0, 0)):
    c = V(center)
    if isinstance(s, (int, float)):
        s = (s, s, s)
    for v in bm.verts:
        d = v.co - c
        v.co = c + V((d.x * s[0], d.y * s[1], d.z * s[2]))
    return bm


def rot(bm, angle, axis, center=(0, 0, 0)):
    c = V(center)
    M = Matrix.Translation(c) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-c)
    return xform(bm, M)


def set_smooth(bm, s=True):
    for f in bm.faces:
        f.smooth = s
    return bm


def bm_box(size, center=(0, 0, 0), bevel=0.0, segs=2, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET',
                        segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    move(bm, center)
    set_smooth(bm, smooth)
    return bm


def bm_box_mm(mn, mx, **kw):
    mn, mx = V(mn), V(mx)
    return bm_box(mx - mn, (mn + mx) / 2, **kw)


def bm_ico(radius=1.0, subdiv=2, center=(0, 0, 0), sc=(1, 1, 1), smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    scale(bm, sc)
    move(bm, center)
    set_smooth(bm, smooth)
    return bm


def bm_lathe(profile, segs=32, sx=1.0, sy=1.0, vfun=None, phase=0.0, cap=True, smooth=True):
    """Surface of revolution around +Z.  profile: [(r, z), ...] traversed so that
    the outside is on the right (bottom pole -> up the outside -> top pole).
    r == 0 gives a pole vertex.  vfun(theta, r, z) -> (x, y, z) overrides mapping."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if r <= 1e-7:
            co = vfun(0.0, 0.0, z) if vfun else (0.0, 0.0, z)
            rings.append([bm.verts.new(co)])
        else:
            ring = []
            for j in range(segs):
                t = phase + TAU * j / segs
                if vfun:
                    co = vfun(t, r, z)
                else:
                    co = (r * math.cos(t) * sx, r * math.sin(t) * sy, z)
                ring.append(bm.verts.new(co))
            rings.append(ring)
    n = segs
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(n):
            j2 = (j + 1) % n
            if len(a) == 1:
                vs = [a[0], b[j2], b[j]]
            elif len(b) == 1:
                vs = [a[j], a[j2], b[0]]
            else:
                vs = [a[j], a[j2], b[j2], b[j]]
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    if cap and len(profile) > 1:
        # a ring is capped only where the profile leaves it vertically (a flat
        # disc profile must not get a second, reversed face on top of itself)
        dz0 = profile[1][1] - profile[0][1]
        dz1 = profile[-1][1] - profile[-2][1]
        if len(rings[0]) > 1 and abs(dz0) > 1e-9:
            bm.faces.new(list(reversed(rings[0])) if dz0 > 0 else rings[0])
        if len(rings[-1]) > 1 and abs(dz1) > 1e-9:
            bm.faces.new(rings[-1] if dz1 > 0 else list(reversed(rings[-1])))
    set_smooth(bm, smooth)
    return bm


def bm_tube(pts, radii, sides=8, closed=False, caps=True, section=None, fixed_b=None,
            smooth=True, twist=0.0):
    """Sweep a circle (or a CCW (u, v) section polygon) along a polyline.
    radii: float or per-point list of float / (ru, rv).  radius 0 at an open end
    makes a pole.  fixed_b: constant binormal (for planar curves)."""
    pts = [V(p) for p in pts]
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    T = []
    for i in range(n):
        if closed:
            d = pts[(i + 1) % n] - pts[(i - 1) % n]
        else:
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        T.append(d.normalized())
    frames = []
    if fixed_b is not None:
        B0 = V(fixed_b).normalized()
        for t in T:
            N = B0.cross(t).normalized()
            frames.append((N, t.cross(N)))
    else:
        t0 = T[0]
        ref = V((0, 0, 1)) if abs(t0.z) < 0.9 else V((1, 0, 0))
        N = (ref - t0 * ref.dot(t0)).normalized()
        for t in T:
            N = N - t * N.dot(t)
            if N.length < 1e-9:
                N = t.orthogonal()
            N.normalize()
            frames.append((N.copy(), t.cross(N)))
        if closed:
            # distribute the holonomy so the seam closes
            Ne = frames[-1][0] - T[0] * frames[-1][0].dot(T[0])
            Ne.normalize()
            ang = math.atan2(Ne.cross(frames[0][0]).dot(T[0]), Ne.dot(frames[0][0]))
            nf = []
            for i, (N, B) in enumerate(frames):
                q = Matrix.Rotation(ang * i / n, 3, T[i])
                N2 = q @ N
                nf.append((N2, T[i].cross(N2)))
            frames = nf
    if section is None:
        section = [(math.cos(TAU * k / sides), math.sin(TAU * k / sides)) for k in range(sides)]
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        r = radii[i]
        ru, rv = (r, r) if isinstance(r, (int, float)) else r
        N, B = frames[i]
        if twist:
            q = Matrix.Rotation(twist * i / max(1, n - 1), 3, T[i])
            N, B = q @ N, q @ B
        if not closed and max(ru, rv) <= 1e-7:
            rings.append([bm.verts.new(p)])
        else:
            rings.append([bm.verts.new(p + N * (u * ru) + B * (v * rv)) for (u, v) in section])
    m = len(section)
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        for j in range(m):
            j2 = (j + 1) % m
            if len(a) == 1:
                vs = [a[0], b[j2], b[j]]
            elif len(b) == 1:
                vs = [a[j], a[j2], b[0]]
            else:
                vs = [a[j], a[j2], b[j2], b[j]]
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    if caps and not closed:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    set_smooth(bm, smooth)
    return bm


def bm_loft(sections, cap_start=True, cap_end=True, closed=False, smooth=True):
    """Loft closed sections (lists of points, equal count, CCW around the loft
    direction)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(V(p)) for p in s] for s in sections]
    m = len(sections[0])
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        for j in range(m):
            j2 = (j + 1) % m
            try:
                bm.faces.new([a[j], a[j2], b[j2], b[j]])
            except ValueError:
                pass
    if cap_start and not closed:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end and not closed:
        bm.faces.new(rings[-1])
    set_smooth(bm, smooth)
    return bm


def ccw(pts2):
    a = 0.0
    for i in range(len(pts2)):
        x0, y0 = pts2[i]
        x1, y1 = pts2[(i + 1) % len(pts2)]
        a += x0 * y1 - x1 * y0
    return pts2 if a > 0 else list(reversed(pts2))


def bm_prism(pts2, z0, z1, smooth=False):
    """Extrude a 2D polygon (x, y) from z0 to z1 (may be concave)."""
    pts2 = ccw(pts2)
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for (x, y) in pts2]
    top = [bm.verts.new((x, y, z1)) for (x, y) in pts2]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(pts2)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    set_smooth(bm, smooth)
    return bm


def rrect(cx, cy, hx, hy, r, z=0.0, n=4):
    """Rounded rectangle in the XY plane, CCW seen from +Z."""
    r = min(r, hx * 0.999, hy * 0.999)
    pts = []
    corners = [(cx + hx - r, cy - hy + r, -90), (cx + hx - r, cy + hy - r, 0),
               (cx - hx + r, cy + hy - r, 90), (cx - hx + r, cy - hy + r, 180)]
    for (x, y, a0) in corners:
        for k in range(n + 1):
            a = math.radians(a0 + 90.0 * k / n)
            pts.append(V((x + r * math.cos(a), y + r * math.sin(a), z)))
    return pts


def bm_grid(nx, ny, x0, x1, y0, y1, z=0.0):
    bm = bmesh.new()
    vs = [[bm.verts.new((lerp(x0, x1, i / nx), lerp(y0, y1, j / ny), z)) for j in range(ny + 1)]
          for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new([vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]])
    return bm


def displace(bm, fn):
    bm.normal_update()
    new = [fn(v.co.copy(), v.normal.copy()) for v in bm.verts]
    for v, c in zip(bm.verts, new):
        v.co = c
    return bm


def apply_mod(bm, mtype, setup=None, **kw):
    """Run a Blender modifier over a bmesh and return the evaluated result."""
    me = bpy.data.meshes.new('_tmp')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('_tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('m', mtype)
    for k, v in kw.items():
        setattr(md, k, v)
    if setup:
        setup(ob, md)
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    return out


def subsurf(bm, levels=1):
    return apply_mod(bm, 'SUBSURF', levels=levels, render_levels=levels)


def tri_count(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def decimate_bm(bm, target):
    """Collapse-decimate a bmesh to about `target` triangles (UVs, colours and
    face attributes ride along).  Returns a new bmesh; no-op when already under."""
    n = tri_count(bm)
    if n <= target:
        return bm
    bmesh.ops.triangulate(bm, faces=bm.faces)
    return apply_mod(bm, 'DECIMATE', decimate_type='COLLAPSE', ratio=max(0.01, target / n),
                     use_collapse_triangulate=True)


def solidify(bm, thickness, offset=-1.0):
    return apply_mod(bm, 'SOLIDIFY', thickness=thickness, offset=offset, use_even_offset=True)


def bm_volume_centroid(bm):
    """Signed-volume centroid of a closed triangle-able mesh."""
    vol = 0.0
    c = V((0, 0, 0))
    for f in bm.faces:
        vs = [v.co for v in f.verts]
        for i in range(1, len(vs) - 1):
            a, b, d = vs[0], vs[i], vs[i + 1]
            v6 = a.dot(b.cross(d))
            vol += v6
            c += (a + b + d) * v6
    if abs(vol) < 1e-12:
        return V((0, 0, 0)), 0.0
    return c / (4.0 * vol), vol / 6.0


# ----------------------------------------------------------------------------
# convex polyhedra (for fracture chunks)
# ----------------------------------------------------------------------------
class Convex:
    """Convex polyhedron as a list of [points (CCW from outside), tag]."""

    def __init__(self, faces):
        self.faces = faces

    @staticmethod
    def box(mn, mx, tag='out'):
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        P = lambda x, y, z: V((x, y, z))
        return Convex([
            [[P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)], tag],
            [[P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], tag],
            [[P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], tag],
            [[P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], tag],
            [[P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], tag],
            [[P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], tag],
        ])

    @staticmethod
    def frustum(poly_bot, poly_top, z0, z1, tag='out', cap_tag=None):
        """poly_bot/poly_top: matching CCW 2D polygons (convex)."""
        cap_tag = cap_tag or tag
        n = len(poly_bot)
        B = [V((x, y, z0)) for (x, y) in poly_bot]
        Tp = [V((x, y, z1)) for (x, y) in poly_top]
        faces = [[list(reversed(B)), cap_tag], [Tp, cap_tag]]
        for i in range(n):
            j = (i + 1) % n
            faces.append([[B[i], B[j], Tp[j], Tp[i]], tag])
        return Convex(faces)

    def clip(self, n, d, tag='in', eps=1e-7):
        """Keep the part with n.p <= d.  Returns None if empty."""
        n = V(n)
        allp = [p for pts, _ in self.faces for p in pts]
        s = [n.dot(p) - d for p in allp]
        if max(s) <= eps:
            return self
        if min(s) >= -eps:
            return None
        new_faces = []
        cut = []
        for pts, t in self.faces:
            out = []
            m = len(pts)
            for i in range(m):
                a, b = pts[i], pts[(i + 1) % m]
                sa, sb = n.dot(a) - d, n.dot(b) - d
                if sa <= eps:
                    out.append(a)
                    if sa >= -eps:
                        cut.append(a)
                if (sa < -eps and sb > eps) or (sa > eps and sb < -eps):
                    q = a.lerp(b, sa / (sa - sb))
                    out.append(q)
                    cut.append(q)
            out = _dedupe_loop(out)
            if len(out) >= 3 and _poly_area(out) > 1e-9:
                new_faces.append([out, t])
        uniq = []
        for p in cut:
            if all((p - q).length > 1e-6 for q in uniq):
                uniq.append(p)
        if len(uniq) >= 3:
            c = sum(uniq, V((0, 0, 0))) / len(uniq)
            u = n.orthogonal().normalized()
            v = n.cross(u)
            uniq.sort(key=lambda p: math.atan2((p - c).dot(v), (p - c).dot(u)))
            if _poly_area(uniq) > 1e-9:
                new_faces.append([uniq, tag])
        if len(new_faces) < 4:
            return None
        return Convex(new_faces)

    def volume_centroid(self):
        c0 = sum((p for pts, _ in self.faces for p in pts), V((0, 0, 0)))
        c0 /= sum(len(pts) for pts, _ in self.faces)
        vol = 0.0
        c = V((0, 0, 0))
        for pts, _ in self.faces:
            for i in range(1, len(pts) - 1):
                a, b, d = pts[0] - c0, pts[i] - c0, pts[i + 1] - c0
                v6 = a.dot(b.cross(d))
                vol += v6
                c += (a + b + d) * v6
        if vol <= 1e-12:
            return c0, 0.0
        return c0 + c / (4.0 * vol), vol / 6.0

    def to_bm(self, tag_mats):
        """tag_mats: dict tag -> material index (stored on faces)."""
        bm = bmesh.new()
        for pts, t in self.faces:
            vs = [bm.verts.new(p) for p in pts]
            f = bm.faces.new(vs)
            f.material_index = tag_mats.get(t, 0)
            f.smooth = False
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
        return bm


def _dedupe_loop(pts):
    out = []
    for p in pts:
        if not out or (p - out[-1]).length > 1e-7:
            out.append(p)
    while len(out) > 1 and (out[0] - out[-1]).length <= 1e-7:
        out.pop()
    return out


def _poly_area(pts):
    s = V((0, 0, 0))
    for i in range(len(pts)):
        s += pts[i].cross(pts[(i + 1) % len(pts)])
    return s.length * 0.5


# ----------------------------------------------------------------------------
# mesh builder: accumulate parts (bmesh + material + tint) into one object
# ----------------------------------------------------------------------------
class MB:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.uvl = None                 # created on demand, so UV-less meshes stay UV-less
        self.mats = []

    def midx(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def decimate(self, target):
        """Collapse-decimate everything added so far to about `target` tris."""
        if tri_count(self.bm) <= target:
            return self
        self.bm = decimate_bm(self.bm, target)
        self.col = self.bm.loops.layers.float_color.get('Col') or self.bm.loops.layers.float_color.new('Col')
        self.uvl = self.bm.loops.layers.uv.get('UVMap') if self.uvl is not None else None
        return self

    def add(self, src, mat, tint=None, smooth=None, mats=None, uv=None, vtint=None, uvf=None, ftag=None):
        """Append src (freed).  tint: rgb, or fn(co) -> rgb.  mats: list mapping
        src material_index -> material (for multi-material parts).  uv: fn(co) ->
        (u, v) (adds a UV map to this mesh).  vtint: per-vertex rgb list in
        src.verts index order.  uvf: per-face UV projection fn(co, face_normal,
        face_centre, src_face) -> (u, v), or 'src' to copy src's own UV layer
        (textured TX_ parts: UVs in metres).  ftag: int stored on every new face
        in the 'tag' face layer (part ids for fracturing), or 'src' to copy it."""
        if (uv is not None or uvf is not None) and self.uvl is None:
            self.uvl = self.bm.loops.layers.uv.new('UVMap')
        if uvf is not None or ftag is not None:
            return self._add_tx(src, mat, tint, smooth, mats, uvf, ftag)
        if vtint is not None:
            src.verts.index_update()
            vcols = {v: vtint[v.index] for v in src.verts}
        if mats:
            idxs = [self.midx(m) for m in mats]
        else:
            idxs = None
            idx = self.midx(mat)
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idxs[min(f.material_index, len(idxs) - 1)] if idxs else idx
            nf.smooth = f.smooth if smooth is None else smooth
            for lp, sv in zip(nf.loops, f.verts):
                if vtint is not None:
                    c = vcols[sv]
                elif tint is None:
                    c = (1.0, 1.0, 1.0)
                elif callable(tint):
                    c = tint(lp.vert.co)
                else:
                    c = tint
                lp[self.col] = (c[0], c[1], c[2], 1.0)
                if uv is not None:
                    lp[self.uvl].uv = uv(lp.vert.co)
        for e in src.edges:
            if not e.smooth:
                ne = self.bm.edges.get((vmap[e.verts[0]], vmap[e.verts[1]]))
                if ne:
                    ne.smooth = False
        src.free()
        return self

    def _add_tx(self, src, mat, tint, smooth, mats, uvf, ftag):
        """add() for textured parts: per-face UV projection, source UV / colour /
        tag layers carried over."""
        tagl = self.bm.faces.layers.int.get('tag') or self.bm.faces.layers.int.new('tag')
        s_uv = src.loops.layers.uv.get('UVMap')
        s_col = src.loops.layers.float_color.get('Col')
        s_tag = src.faces.layers.int.get('tag')
        src.normal_update()
        if mats:
            idxs = [self.midx(m) for m in mats]
        else:
            idxs = None
            idx = self.midx(mat)
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idxs[min(f.material_index, len(idxs) - 1)] if idxs else idx
            nf.smooth = f.smooth if smooth is None else smooth
            if ftag == 'src':
                nf[tagl] = f[s_tag] if s_tag else 0
            elif ftag is not None:
                nf[tagl] = ftag
            fn, fc = f.normal.copy(), f.calc_center_median()
            for lp, sl in zip(nf.loops, f.loops):
                co = sl.vert.co
                if tint == 'src' and s_col:
                    c = sl[s_col]
                elif tint is None:
                    c = (1.0, 1.0, 1.0)
                elif callable(tint):
                    c = tint(co)
                else:
                    c = tint
                lp[self.col] = (c[0], c[1], c[2], 1.0)
                if uvf == 'src':
                    lp[self.uvl].uv = sl[s_uv].uv if s_uv else (0.0, 0.0)
                elif uvf is not None:
                    lp[self.uvl].uv = uvf(co, fn, fc, f)
        for e in src.edges:
            if not e.smooth:
                ne = self.bm.edges.get((vmap[e.verts[0]], vmap[e.verts[1]]))
                if ne:
                    ne.smooth = False
        src.free()
        return self


PIV = {}          # world-space pivot of every object we create
COLL = None


def mark_sharp(bm, angle_deg):
    th = math.radians(angle_deg)
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2 and lf[0].smooth and lf[1].smooth:
            if lf[0].normal.angle(lf[1].normal, 0.0) > th:
                e.smooth = False


def link(ob, parent, pivot):
    COLL.objects.link(ob)
    if parent:
        ob.parent = bpy.data.objects[parent]
        ob.location = pivot - PIV[parent]
    else:
        ob.location = pivot
    PIV[ob.name] = pivot.copy()


def finish(mb, name, pivot=(0, 0, 0), parent=None, sharp=40.0, vfn=None, weighted=False, decimate=None):
    """Turn the builder into an object whose origin is `pivot` (world space).
    decimate: collapse to about that many triangles first (triangle budgets)."""
    if decimate:
        mb.decimate(decimate)
    bm = mb.bm
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    if sharp is not None:
        mark_sharp(bm, sharp)
    if vfn:
        for f in bm.faces:
            for lp in f.loops:
                c = vfn(lp.vert.co, lp.vert.normal, f)
                o = lp[mb.col]
                lp[mb.col] = (o[0] * c[0], o[1] * c[1], o[2] * c[2], 1.0)
    pivot = V(pivot)
    bmesh.ops.translate(bm, vec=-pivot, verts=bm.verts)
    me = bpy.data.meshes.new(name + '_geo')
    bm.to_mesh(me)
    bm.free()
    for m in mb.mats:
        me.materials.append(m)
    if 'Col' in me.color_attributes:
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    ob = bpy.data.objects.new(name, me)
    link(ob, parent, pivot)
    if weighted:
        md = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        md.mode = 'FACE_AREA'
        md.keep_sharp = True
        md.weight = 50
        bake_modifiers(ob)
    return ob


def bake_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True,
                                         depsgraph=dg)
    old = ob.data
    name = old.name
    mats = list(old.materials)
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = name
    if len(me.materials) == 0:
        for m in mats:
            me.materials.append(m)


def empty(name, pivot=(0, 0, 0), parent=None, size=0.3):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = size
    link(ob, parent, V(pivot))
    return ob


def ao_fn(z0=0.0, h=0.35, amt=0.3, down=0.25):
    """Generic fake AO: darken near the ground and on downward-facing normals."""
    def f(co, n, face):
        k = 1.0 - amt * (1.0 - smoothstep(z0, z0 + h, co.z))
        k *= 1.0 - down * smoothstep(0.0, -1.0, n.z)
        return (k, k, k)
    return f


# ============================================================================
# TEXTURED KIT: shared-library materials, metre-space UVs, baked AO, fracturing
# of detailed closed parts.
#
# Any material named TX_<name> gets the baked PBR set assets/tex/<name>_* at
# runtime (repeat = 1 / tile), so these materials stay plain placeholders here:
# white base colour times the Col attribute (COLOR_0), which carries Cycles-baked
# ambient occlusion, grime and any tint.  Textures are never embedded.  UVs are
# in world metres (1 UV unit = 1 m) so texel density matches everywhere: box
# projection for masonry and furniture, arc-length/circumference for turned and
# swept parts (grain runs along U for oak).
# ============================================================================
def tx(name):
    return material('TX_' + name, '#ffffff', 0.0, 0.8)


def _dom(n):
    ax = 0 if abs(n.x) >= abs(n.y) else 1
    return 2 if abs(n.z) >= abs(n[ax]) else ax


def uv_box(off=(0.0, 0.0), grain=None, M=None, org=(0, 0, 0)):
    """Per-face box projection in metres, oriented so side faces read upright
    (V = world up) and nothing is mirrored when seen from outside.  grain: 'z'
    turns U vertical on side faces (oak grain up a stile), 'y' makes U follow
    world Y on top faces.  M: 3x3 rotation into the projection frame (dipping
    strata).  off: UV offset (per-part texture variety)."""
    o = V(org)

    def f(co, n, c, face=None):
        p = co - o
        nn = n
        if M is not None:
            p = M @ p
            nn = M @ n
        ax = _dom(nn)
        if ax == 2:
            u, v = p.x, (p.y if nn.z > 0 else -p.y)
            if grain == 'y':
                u, v = p.y, -p.x if nn.z > 0 else p.x
        elif ax == 0:
            u, v = (p.y if nn.x > 0 else -p.y), p.z
        else:
            u, v = (-p.x if nn.y > 0 else p.x), p.z
        if grain == 'z' and ax != 2:
            u, v = v, -u
        return (u + off[0], v + off[1])
    return f


def uv_cyl(cx=0.0, cy=0.0, rref=None, off=(0.0, 0.0), axial_u=False, cap_box=0.75):
    """Cylindrical metres mapping about a vertical axis through (cx, cy):
    U = angle * radius (around), V = z.  axial_u swaps them (grain along the
    axis).  Faces facing mostly up/down get a planar top projection."""
    def f(co, n, c, face=None):
        if abs(n.z) > cap_box:
            return (co.x + off[0], co.y + off[1])
        ac = math.atan2(c.y - cy, c.x - cx)
        a = math.atan2(co.y - cy, co.x - cx)
        while a - ac > math.pi:
            a -= TAU
        while a - ac < -math.pi:
            a += TAU
        r = rref if rref else math.hypot(co.x - cx, co.y - cy)
        u, v = a * r, co.z
        if axial_u:
            u, v = v, -u
        return (u + off[0], v + off[1])
    return f


def bm_split_islands(bm):
    """Connected components of a bmesh -> list of new bmeshes (layers kept)."""
    bm.verts.ensure_lookup_table()
    seen = set()
    out = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack = [f0]
        comp = set()
        while stack:
            f = stack.pop()
            if f.index in comp:
                continue
            comp.add(f.index)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in comp:
                        stack.append(g)
        seen |= comp
        c = bm.copy()
        c.faces.ensure_lookup_table()
        kill = [g for g in c.faces if g.index not in comp]
        bmesh.ops.delete(c, geom=kill, context='FACES')
        out.append(c)
    return out


def bm_is_closed(bm):
    return all(len(e.link_faces) == 2 for e in bm.edges)


def clip_closed(bm, n, d, cap_mat, cap_uvf=None, cap_tint=None, cap_tag=-1, eps=1e-6):
    """Keep the part of a closed bmesh with n.p <= d and cap the cut with new
    faces (material cap_mat, tag cap_tag, UVs from cap_uvf, colour cap_tint(co)).
    Returns the list of cap faces (an empty mesh when nothing is left)."""
    n = V(n).normalized()
    if not bm.verts:
        return []
    s = [n.dot(v.co) - d for v in bm.verts]
    if max(s) <= eps:
        return []
    if min(s) >= -eps:
        bm.clear()
        return []
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                           plane_co=n * d, plane_no=n, clear_outer=True)
    bnd = [e for e in bm.edges if e.is_boundary]
    if not bnd:
        return []
    res = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=bnd, normal=n)
    caps = [f for f in res['geom'] if isinstance(f, bmesh.types.BMFace)]
    uvl = bm.loops.layers.uv.get('UVMap')
    col = bm.loops.layers.float_color.get('Col')
    tagl = bm.faces.layers.int.get('tag')
    for f in caps:
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
        f.material_index = cap_mat
        f.smooth = False
        if tagl is not None:
            f[tagl] = cap_tag
        c = f.calc_center_median()
        for lp in f.loops:
            if uvl is not None and cap_uvf is not None:
                lp[uvl].uv = cap_uvf(lp.vert.co, f.normal, c, f)
            if col is not None:
                t = cap_tint(lp.vert.co) if cap_tint else (1.0, 1.0, 1.0)
                lp[col] = (t[0], t[1], t[2], 1.0)
        for e in f.edges:
            e.smooth = False
    return caps


def part_bm(src, mat_index=0, uvf=None, tint=None, tag=0, smooth=None):
    """Give a raw bmesh the kit layers (Col, UVMap, tag) in place."""
    col = src.loops.layers.float_color.get('Col') or src.loops.layers.float_color.new('Col')
    uvl = src.loops.layers.uv.get('UVMap') or src.loops.layers.uv.new('UVMap')
    tagl = src.faces.layers.int.get('tag') or src.faces.layers.int.new('tag')
    src.normal_update()
    for f in src.faces:
        if mat_index is not None:
            f.material_index = mat_index if isinstance(mat_index, int) else mat_index(f)
        f[tagl] = tag
        if smooth is not None:
            f.smooth = smooth
        fn, fc = f.normal.copy(), f.calc_center_median()
        for lp in f.loops:
            co = lp.vert.co
            if uvf is not None:
                lp[uvl].uv = uvf(co, fn, fc, f)
            c = (tint(co) if callable(tint) else tint) if tint is not None else (1.0, 1.0, 1.0)
            lp[col] = (c[0], c[1], c[2], 1.0)
    return src


def shade_parts(parts, fn):
    """Multiply every loop colour of the parts by fn(co, face normal) -> rgb
    (normal-dependent grime: crusts under ledges, dust on tops)."""
    for p in parts:
        col = p.loops.layers.float_color['Col']
        p.normal_update()
        for f in p.faces:
            for lp in f.loops:
                k = fn(lp.vert.co, f.normal if not f.smooth else lp.vert.normal)
                c = lp[col]
                lp[col] = (c[0] * k[0], c[1] * k[1], c[2] * k[2], 1.0)
    return parts


def voronoi_cells(seeds, mn, mx):
    """Voronoi cells of seeds inside the box mn..mx -> [(Convex, [(n, d), ...])],
    the (n, d) being the bisector planes that actually bound the cell."""
    box = Convex.box(mn, mx)
    cells = []
    for i, s in enumerate(seeds):
        c = box
        planes = {}
        for j, t in enumerate(seeds):
            if i == j or c is None:
                continue
            nrm = (t - s).normalized()
            d = nrm.dot((s + t) / 2)
            c2 = c.clip(nrm, d, 'p%d' % j)
            if c2 is not c:
                planes[j] = (nrm, d)
            c = c2
        if c is None:
            continue
        used = {t for _, t in c.faces}
        pl = [planes[j] for j in planes if 'p%d' % j in used]
        cells.append((c, pl))
    return cells


def bake_ao(ob, dist=0.6, samples=96, strength=1.0, gamma=1.0, ground=None, keep=(), floor_k=0.0):
    """Cycles ambient-occlusion bake into the object's vertices, multiplied into
    its Col attribute.  Only ob (and objects in keep) occlude; ground: z of an
    optional ground plane (props that stand on something).  Returns
    [(world position, ao)] per vertex for transfer onto fracture chunks."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.seed = 7
    if sc.world is None:
        sc.world = bpy.data.worlds.new('BakeWorld')
    sc.world.light_settings.distance = dist
    hidden = {}
    for o in sc.objects:
        hidden[o.name] = o.hide_render
        o.hide_render = not (o is ob or o in keep)
    gob = None
    if ground is not None:
        gme = bpy.data.meshes.new('_bake_ground')
        s = 50.0
        gme.from_pydata([(-s, -s, ground), (s, -s, ground), (s, s, ground), (-s, s, ground)], [], [(0, 1, 2, 3)])
        gob = bpy.data.objects.new('_bake_ground', gme)
        sc.collection.objects.link(gob)
    me = ob.data
    attr = me.color_attributes.new('_ao', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    for o in sc.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    import numpy as np
    nv = len(me.vertices)
    buf = np.zeros(nv * 4, dtype=np.float32)
    me.color_attributes['_ao'].data.foreach_get('color', buf)
    ao = buf.reshape(nv, 4)[:, 0].copy()
    ao = np.clip(ao, 0.0, 1.0) ** gamma
    ao = 1.0 - strength * (1.0 - ao)
    ao = np.maximum(ao, floor_k)
    col = me.color_attributes['Col']
    nl = len(me.loops)
    cb = np.zeros(nl * 4, dtype=np.float32)
    col.data.foreach_get('color', cb)
    cb = cb.reshape(nl, 4)
    lv = np.zeros(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', lv)
    cb[:, :3] *= ao[lv][:, None]
    col.data.foreach_set('color', cb.ravel())
    me.color_attributes.remove(me.color_attributes['_ao'])
    me.color_attributes.active_color_name = 'Col'
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    if gob is not None:
        bpy.data.objects.remove(gob)
        bpy.data.meshes.remove(gme)
    for o in sc.objects:
        o.hide_render = hidden.get(o.name, False)
        o.select_set(False)
    M = ob.matrix_world
    return [(M @ v.co, float(ao[i])) for i, v in enumerate(me.vertices)]


def ao_lookup(samples):
    kd = KDTree(len(samples))
    for i, (p, a) in enumerate(samples):
        kd.insert(p, i)
    kd.balance()

    def f(co, k=4):
        hits = kd.find_n(co, k)
        wsum, s = 0.0, 0.0
        for (p, i, d) in hits:
            w = 1.0 / (d + 0.01)
            wsum += w
            s += w * samples[i][1]
        return s / wsum if wsum else 1.0
    return f


def cut_cells(parts, cells, mats, cap_mat, cap_uvf, cap_tint):
    """Cut every closed part by every convex cell (clip + cap).  parts: bmeshes
    with Col / UVMap / tag layers; cells: [(Convex, [(n, d), ...])].  Returns
    [(MB, centroid, volume)] for the non-empty cells."""
    boxes = []
    for p in parts:
        xs = [v.co for v in p.verts]
        boxes.append((V((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs))),
                      V((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))))
    chunks = []
    for (cell, planes) in cells:
        pts = [q for pts_, _ in cell.faces for q in pts_]
        cmn = V((min(q.x for q in pts), min(q.y for q in pts), min(q.z for q in pts)))
        cmx = V((max(q.x for q in pts), max(q.y for q in pts), max(q.z for q in pts)))
        mb = MB()
        got = False
        for p, (bmn, bmx) in zip(parts, boxes):
            if any(bmx[i] < cmn[i] - 1e-4 or bmn[i] > cmx[i] + 1e-4 for i in range(3)):
                continue
            c = p.copy()
            for (nrm, d) in planes:
                clip_closed(c, nrm, d, cap_mat, cap_uvf, cap_tint)
                if not c.verts:
                    break
            if c.verts and c.faces:
                got = True
                mb.add(c, None, mats=mats, tint='src', uvf='src', ftag='src')
            else:
                c.free()
        if got:
            chunks.append(mb)
    info = []
    for mb in chunks:
        cen, vol = bm_volume_centroid(mb.bm)
        info.append((mb, cen, vol))
    return info


def make_chunks(parent, prefix, info, impact, ao=None, sharp=35, max_verts=1500):
    """Finish cut cells as <prefix>_Chunk_NN children of parent, ordered from
    the impact point outwards.  ao: ao_lookup of the solid, carried onto the
    original surfaces (cut faces, tag < 0, keep their own tint)."""
    info = sorted(info, key=lambda x: (x[1] - V(impact)).length)
    total, vmax = 0.0, 0
    for k, (mb, cen, vol) in enumerate(info):
        mb.decimate(CHUNK_TRIS)
        cen, vol = bm_volume_centroid(mb.bm)
        tagl = mb.bm.faces.layers.int.get('tag')

        def vfn(co, n, f, tagl=tagl):
            if ao is None or (tagl is not None and f[tagl] < 0):
                return (1.0, 1.0, 1.0)
            a = ao(co)
            return (a, a, a)
        ob = finish(mb, '%s_Chunk_%02d' % (prefix, k), pivot=cen, parent=parent, sharp=sharp, vfn=vfn)
        nv = len(ob.data.vertices)
        assert nv <= max_verts, (ob.name, nv)
        total += vol
        vmax = max(vmax, nv)
    return len(info), total, vmax


def parts_volume(parts):
    return sum(bm_volume_centroid(p)[1] for p in parts)


def _bool_eval(bm, cutter, op='DIFFERENCE', solver='EXACT'):
    me = bpy.data.meshes.new('_bool')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('_bool', me)
    bpy.context.scene.collection.objects.link(ob)
    cm = bpy.data.meshes.new('_cut')
    cutter.to_mesh(cm)
    co = bpy.data.objects.new('_cut', cm)
    bpy.context.scene.collection.objects.link(co)
    co.hide_render = True
    md = ob.modifiers.new('b', 'BOOLEAN')
    md.operation = op
    md.solver = solver
    md.object = co
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me2)
    for o, m in ((ob, me), (co, cm)):
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(m)
    bpy.data.meshes.remove(me2)
    return out


def bm_append(dst, src):
    """Append src's geometry (positions and faces only) to dst."""
    vmap = {v: dst.verts.new(v.co) for v in src.verts}
    for f in src.faces:
        try:
            dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            pass
    return dst


def bool_diff(bm, cutters, solver='EXACT', name='part'):
    """bm minus the closed cutter bmeshes (which must not overlap each other):
    one EXACT boolean against all of them joined; if that result is not a clean
    closed solid of plausible volume, fall back to one cutter at a time,
    skipping (and reporting) any that fail.  Returns a new bmesh (layers are not
    kept)."""
    vol = bm_volume_centroid(bm)[1]
    for c in cutters:
        bmesh.ops.triangulate(c, faces=[f for f in c.faces if len(f.verts) > 4])
    vcs = [bm_volume_centroid(c)[1] for c in cutters]

    def ok(out, v0, vc):
        if not out.faces or not bm_is_closed(out):
            return False, 0.0
        v2 = bm_volume_centroid(out)[1]
        return (v0 - vc * 1.05 - 1e-6 <= v2 <= v0 + 1e-6), v2
    allc = bmesh.new()
    for c in cutters:
        bm_append(allc, c)
    out = _bool_eval(bm, allc, 'DIFFERENCE', solver)
    allc.free()
    good, v2 = ok(out, vol, sum(vcs))
    if good:
        bm.free()
        for c in cutters:
            c.free()
        return out
    out.free()
    skipped = 0
    for c, vc in zip(cutters, vcs):
        out = _bool_eval(bm, c, 'DIFFERENCE', solver)
        c.free()
        good, v2 = ok(out, vol, vc)
        if good:
            bm.free()
            bm, vol = out, v2
        else:
            out.free()
            skipped += 1
    if skipped:
        print('  %s: skipped %d of %d boolean cutters' % (name, skipped, len(cutters)))
    return bm


def prism_y(poly_xz, y0, y1):
    """Extrude an (x, z) outline along +Y from y0 to y1 (closed bmesh)."""
    bm = bm_prism([(x, z) for (x, z) in poly_xz], y0, y1)
    # bm_prism extrudes along Z: swap (x, y, z) -> (x, z, y), keeping faces outward
    xform(bm, Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def prism_x(poly_yz, x0, x1):
    bm = bm_prism([(y, z) for (y, z) in poly_yz], x0, x1)
    xform(bm, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    return bm


def rough_rock(radius, rng, sc=(1, 1, 1), subdiv=1, amp=0.25, flat=0.0, seed_off=None):
    """A small angular stone: icosphere, noise-displaced, optionally flattened
    at the bottom so it can sit on something."""
    bm = bm_ico(radius, subdiv, sc=sc, smooth=False)
    off = seed_off or V((rng.uniform(0, 90), rng.uniform(0, 90), rng.uniform(0, 90)))
    for v in bm.verts:
        d = v.co.normalized() if v.co.length > 1e-9 else V((0, 0, 1))
        g = noise.noise(v.co * (2.2 / radius) + off)
        v.co += d * radius * amp * g
        if flat and v.co.z < -radius * flat:
            v.co.z = -radius * flat
    return bm


def contour_loops(fn, x0, x1, z0, z1, step):
    """Marching squares: closed outlines [(x, z), ...] (CCW) of the regions where
    fn(x, z) > 0 over the rectangle; everything outside counts as negative, so
    regions touching the border close along it."""
    nx = int(math.ceil((x1 - x0) / step))
    nz = int(math.ceil((z1 - z0) / step))
    val = {}
    for i in range(-1, nx + 2):
        for j in range(-1, nz + 2):
            if i < 0 or j < 0 or i > nx or j > nz:
                val[i, j] = -1.0
            else:
                w = fn(x0 + i * step, z0 + j * step)
                val[i, j] = w if abs(w) > 1e-9 else 1e-9

    def P(i, j):
        return (x0 + i * step, z0 + j * step)

    def cross(a, b):
        (ia, ja), (ib, jb) = a, b
        va, vb = val[a], val[b]
        t = va / (va - vb)
        pa, pb = P(ia, ja), P(ib, jb)
        return (lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t))
    nxt = {}
    pos = {}
    for i in range(-1, nx + 1):
        for j in range(-1, nz + 1):
            A, Bq, Cq, D = (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
            s = [val[A] > 0, val[Bq] > 0, val[Cq] > 0, val[D] > 0]
            if all(s) or not any(s):
                continue
            # cell edges in counter-clockwise order (start, end corners); a
            # contour segment runs from a '+ -> -' crossing to a '- -> +' one,
            # which keeps the positive region on its left
            edges = [(('h', i, j), A, Bq), (('v', i + 1, j), Bq, Cq), (('h', i, j + 1), Cq, D), (('v', i, j), D, A)]
            ex = [e for e in edges if (val[e[1]] > 0) != (val[e[2]] > 0)]
            for (k, a, b) in ex:
                pos[k] = cross(a, b)
            out_ = {k: val[a] > 0 for (k, a, b) in ex}      # True: + -> -
            if len(ex) == 2:
                pairs = [(ex[0][0], ex[1][0])]
            else:
                cen = (val[A] + val[Bq] + val[Cq] + val[D]) / 4.0
                e0, e1, e2, e3 = [e[0] for e in edges]
                if s[0]:          # a and c positive
                    pairs = [(e0, e1), (e2, e3)] if cen > 0 else [(e3, e0), (e1, e2)]
                else:             # b and d positive
                    pairs = [(e3, e0), (e1, e2)] if cen > 0 else [(e0, e1), (e2, e3)]
            for (ka, kb) in pairs:
                if out_[ka]:
                    nxt[ka] = kb
                else:
                    nxt[kb] = ka
    loops = []
    seen = set()
    for k0 in list(nxt):
        if k0 in seen:
            continue
        loop = []
        k = k0
        while k not in seen and k in nxt:
            seen.add(k)
            loop.append(pos[k])
            k = nxt[k]
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def simplify_loop(pts, tol, max_seg=None):
    """Douglas-Peucker for a closed loop (keeps the two farthest-apart points)."""
    n = len(pts)
    if n < 4:
        return pts
    i0 = 0
    i1 = max(range(n), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)

    def dp(seq):
        if len(seq) < 3:
            return seq
        (ax, az), (bx, bz) = seq[0], seq[-1]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        best, bi = -1.0, 0
        for k in range(1, len(seq) - 1):
            px, pz = seq[k]
            if L < 1e-12:
                d = math.hypot(px - ax, pz - az)
            else:
                d = abs((px - ax) * dz - (pz - az) * dx) / L
            if d > best:
                best, bi = d, k
        if best > tol or (max_seg and L > max_seg):
            left = dp(seq[:bi + 1])
            return left[:-1] + dp(seq[bi:])
        return [seq[0], seq[-1]]
    a = dp(pts[i0:i1 + 1])
    b = dp(pts[i1:] + [pts[0]])
    return a[:-1] + b[:-1]


def poly_simple(q):
    n = len(q)

    def seg_x(p1, p2, p3, p4):
        d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
        if abs(d) < 1e-14:
            return False
        t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
        u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
        return 1e-9 < t < 1 - 1e-9 and 1e-9 < u < 1 - 1e-9
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if seg_x(q[i], q[(i + 1) % n], q[j], q[(j + 1) % n]):
                return False
    return True


def simplify_safe(pts, tol, max_seg=None):
    """simplify_loop that never returns a self-intersecting outline."""
    for t in (tol, tol * 0.5, tol * 0.25):
        q = simplify_loop(pts, t, max_seg)
        if len(q) >= 3 and poly_simple(q):
            return q
    return pts if poly_simple(pts) else None


def loop_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))


def solidity_check(bm, name):
    if not bm_is_closed(bm):
        nb = sum(1 for e in bm.edges if len(e.link_faces) != 2)
        print('  WARNING %s: %d non-manifold edges' % (name, nb))


SOLIDS = {}       # name -> (closed parts, ao lookup) for the fracture builders
CHUNK_TRIS = 290  # triangle cap per fracture chunk (debris frame budget)


# ----------------------------------------------------------------------------
# Wall: a ruined stretch of Catalan wall (collider 4 x 3 x 0.5, centred y 1.5)
# ----------------------------------------------------------------------------
def wall_mats():
    return [tx('stucco'), tx('stone')]


def wall_profile():
    """z of the rubble core top and of the render's upper edge along x."""
    rng = random.Random(4417)
    jag = [rng.uniform(-1, 1) for _ in range(64)]

    def jn(x):
        t = clamp((x + 2.0) / 4.0, 0.0, 1.0) * 63
        i = int(clamp(math.floor(t), 0, 62))
        f = t - i
        return lerp(jag[i], jag[i + 1], f)

    def core(x):
        if x > 1.02:                     # the ruined east end
            t = (x - 1.02) / 0.98
            base = 2.86 - 0.16 * math.sin(math.pi * min(1.0, t * 0.8)) ** 0.7 - 0.05 * t
            return min(2.93, base + 0.045 * jn(x) + 0.03 * math.sin(x * 23.0))
        if x < -1.78:                    # a corner stone gone at the west end
            t = (-1.78 - x) / 0.22
            return 2.86 - 0.09 * smoothstep(0.0, 0.6, t) + 0.02 * jn(x)
        return 2.86

    def render(x):
        c = core(x)
        if x > 0.98 or x < -1.74:
            return c - 0.07 - 0.1 * abs(jn(x * 1.7 + 0.3)) - 0.05 * smoothstep(1.3, 1.9, x)
        return 2.86
    return core, render


def wall_parts():
    """Closed parts of the Wall (material 0 = TX_stucco, 1 = TX_stone), each with
    Col / UVMap / tag layers.  Tags: 1 core, 2 render, 3 plinth, 4 coping,
    5 rubble."""
    rng = random.Random(1917)
    core_z, render_z = wall_profile()
    uvb = uv_box()
    parts = []
    off = V((3.7, 1.3, 8.1))

    def ruin(x):
        return max(smoothstep(0.9, 1.15, x), smoothstep(-1.66, -1.8, x))

    def damp(co):
        # rising damp: an irregular tide line ~0.7-1.1 m up, darker below
        tide = 0.9 + 0.3 * fbm(V((co.x * 0.9, 0.0, 3.3)) + off, 3)
        return smoothstep(tide, tide - 0.55, co.z)

    def streak(co):
        s_ = max(0.0, noise.noise(V((co.x * 3.1, 1.7, 0.0)) + off)) * 1.8
        s_ += 0.5 * max(0.0, noise.noise(V((co.x * 7.3, 4.1, 0.0)) + off))
        s_ *= smoothstep(1.0, 2.8, co.z)
        return min(1.0, s_)

    # ---- where the render has flaked off: marching-squares outlines of a
    # fractal mask, strongest in the rising-damp band, at the ruined top and at
    # the corners; the threshold is solved for a target coverage per face
    def mask_fn(side):
        so = V((0.0, 0.0, 17.0 * side))

        def m(x, z):
            g = fbm(V((x * 1.25, z * 1.25, 0.0)) + off + so, 4)
            g += 0.3 * noise.noise(V((x * 5.0, z * 5.0, 3.0)) + off + so)
            g += 0.12 * noise.noise(V((x * 12.0, z * 12.0, 9.0)) + off + so)
            band = 0.62 * smoothstep(1.2, 0.55, z + 0.3 * fbm(V((x * 1.1, 0.0, side)) + off, 2))
            top = 0.7 * ruin(x) * smoothstep(0.35, 0.0, render_z(x) - z)
            ends = 0.18 * smoothstep(1.75, 2.05, abs(x))
            return g + band + top + ends
        return m
    outlines = {}
    cutters = []
    for side, target in ((-1, 0.3), (1, 0.26)):
        m = mask_fn(side)
        samp = [m(x, z) for x in [-1.98 + 0.08 * i for i in range(50)] for z in [0.5 + 0.08 * j for j in range(30)]
                if z < render_z(x)]
        samp.sort()
        thr = samp[int(len(samp) * (1.0 - target))]
        for _ in range(30):
            loops = contour_loops(lambda x, z: m(x, z) - thr, -2.16, 2.16, 0.36, 3.0, 0.045)
            # a flaked region that closes around unflaked render (an island)
            # would cut the island away with it: raise the threshold until
            # only small islands remain
            if min([loop_area(q) for q in loops] + [0.0]) > -0.03:
                break
            thr += 0.02
        keep = []
        for lp_ in loops:
            if loop_area(lp_) < 0.006:           # specks, and the islands inside holes
                continue
            q = simplify_safe(lp_, 0.04, 0.24)
            if q and abs(loop_area(q)) > 0.005:
                keep.append(q)
        outlines[side] = keep
        y0, y1 = (-0.3, -0.206) if side < 0 else (0.206, 0.3)
        for q in keep:
            cutters.append(prism_y(q, y0, y1))
    edge_pts = {}
    for side, loops in outlines.items():
        pts = []
        for q in loops:
            for i in range(len(q)):
                (ax, az), (bx, bz) = q[i], q[(i + 1) % len(q)]
                k = max(1, int(math.hypot(bx - ax, bz - az) / 0.02))
                pts += [(lerp(ax, bx, t / k), lerp(az, bz, t / k)) for t in range(k)]
        kd = KDTree(max(1, len(pts)))
        for i, (x, z) in enumerate(pts):
            kd.insert((x, 0.0, z), i)
        kd.balance()
        edge_pts[side] = kd

    def edge_d(co):
        side = -1 if co.y < 0 else 1
        hit = edge_pts[side].find((co.x, 0.0, co.z))
        return hit[2] if hit[0] is not None else 9.0

    def render_tint(co):
        k = 1.0 - 0.1 * max(0.0, fbm(co * 1.1 + off, 3)) * 2.0
        k *= 1.0 - 0.06 * noise.noise(co * 4.0 + off)
        d = damp(co)
        s_ = streak(co)
        # warm lime-wash cream (the kit's old wall colour), patchy, stained
        r, g, b = 1.0, 0.9, 0.71
        r, g, b = mix3((r, g, b), (0.92, 0.79, 0.57), min(1.0, 1.1 * max(0.0, fbm(co * 0.6 + off * 2.0, 2))))
        r, g, b = mix3((r, g, b), (0.6, 0.5, 0.35), 0.72 * d)
        r, g, b = mix3((r, g, b), (0.52, 0.47, 0.4), 0.55 * s_)
        e = smoothstep(0.12, 0.0, edge_d(co)) if abs(co.y) > 0.2 else 0.0
        r, g, b = mix3((r, g, b), (0.62, 0.55, 0.45), 0.5 * e)
        return (r * k, g * k, b * k)

    def stone_tint(co):
        k = 1.0 - 0.12 * max(0.0, fbm(co * 2.0 + off * 1.3, 3)) * 2.0
        d = damp(co) * 0.7 + 0.3 * (1.0 - smoothstep(0.0, 0.3, co.z))
        c = mix3((k, k * 0.97, k * 0.93), (0.6 * k, 0.57 * k, 0.49 * k), d)
        if 0.2 < abs(co.y) < 0.26 and co.z > 0.45:
            e = smoothstep(0.12, 0.0, edge_d(co))
            c = mix3(c, (c[0] * 0.72, c[1] * 0.7, c[2] * 0.66), e)
        return c

    # ---- plinth (socol): battered rubble base with a sloped wash on top
    secs = [rrect(0, 0, 2.0, 0.285, 0.035, 0.0, n=1), rrect(0, 0, 1.998, 0.272, 0.03, 0.46, n=1),
            rrect(0, 0, 1.99, 0.246, 0.02, 0.52, n=1)]
    pl = bm_loft(secs, smooth=False)
    bmesh.ops.triangulate(pl, faces=[f for f in pl.faces if len(f.verts) > 4])
    grid_cut(pl, 0, [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5])
    grid_cut(pl, 2, [0.2])
    for v in pl.verts:
        if 0.01 < v.co.z < 0.45 and abs(v.co.y) > 0.2:
            v.co.y += math.copysign(0.008 * fbm(v.co * 3.0 + off, 2), v.co.y)
    parts.append(part_bm(pl, 1, uvb, stone_tint, tag=3, smooth=True))

    # ---- rubble core, visible where the render has flaked and at the ruined top
    xs = sorted(set([-1.978, -1.9, -1.82, -1.74, -1.4, -0.9, -0.4, 0.1, 0.6, 0.98] +
                    [round(1.06 + 0.115 * k, 4) for k in range(9)] + [1.978]))
    zrows = [0.36, 1.2, 2.0]
    cb = bmesh.new()
    Y = 0.236
    cols = []
    for x in xs:
        zt = core_z(x)
        col_ = []
        for side in (-1, 1):
            ring = []
            for z in zrows + [zt]:
                zz = min(z, zt)
                d = 0.006 * fbm(V((x * 2.5, side * 3.0, zz * 2.5)) + off, 2)
                ring.append(cb.verts.new((x, side * (Y + d), zz)))
            col_.append(ring)
        ridge = cb.verts.new((x, 0.02 * noise.noise(V((x * 4.0, 5.0, 1.0))),
                              zt + 0.03 + 0.025 * abs(noise.noise(V((x * 6.0, 2.0, 7.0))))))
        cols.append((col_, ridge))
    for i in range(len(xs) - 1):
        (fa, ra), (fb, rb_) = cols[i], cols[i + 1]
        for s_ in range(2):
            A, Bc = fa[s_], fb[s_]
            for j in range(len(A) - 1):
                q = [A[j], Bc[j], Bc[j + 1], A[j + 1]]
                cb.faces.new(q if s_ == 0 else list(reversed(q)))
        cb.faces.new([fa[0][-1], fb[0][-1], rb_, ra])
        cb.faces.new([ra, rb_, fb[1][-1], fa[1][-1]])
        cb.faces.new([fa[0][0], fa[1][0], fb[1][0], fb[0][0]])
    for (col_, ridge), sgn in ((cols[0], -1), (cols[-1], 1)):
        A, Bc = col_
        ring = A + [ridge] + list(reversed(Bc))
        cb.faces.new(ring if sgn < 0 else list(reversed(ring)))
    bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
    bmesh.ops.triangulate(cb, faces=[f for f in cb.faces if len(f.verts) > 4])
    solidity_check(cb, 'wall core')
    parts.append(part_bm(cb, 1, uvb, stone_tint, tag=1, smooth=True))

    # ---- lime render: a closed ring (front, ends, back) with chamfered corners,
    # ~2 cm thick, flaked through along the outlines above
    c = 0.035
    RX, RY, IX, IY = 2.0, 0.25, 1.972, 0.231
    loop = []                                      # (outer xy, inner xy)
    fx = sorted(set([-RX + c, -1.87, -1.74, -1.4, -0.9, -0.4, 0.1, 0.6, 0.98, 1.2, 1.4, 1.6, 1.8, RX - c]))
    for x in fx:
        loop.append(((x, -RY), (clamp(x, -IX, IX), -IY)))
    for y in (-RY + c, 0.0, RY - c):
        loop.append(((RX, y), (IX, clamp(y, -IY, IY))))
    for x in reversed(fx):
        loop.append(((x, RY), (clamp(x, -IX, IX), IY)))
    for y in (RY - c, 0.0, -RY + c):
        loop.append(((-RX, y), (-IX, clamp(y, -IY, IY))))
    rb = bmesh.new()
    NR = 4
    z0 = 0.5
    rings = []
    for (o, i_) in loop:
        zt = render_z(o[0])
        outer = []
        for j in range(NR + 1):
            z = lerp(z0, zt, (j / NR) ** 0.85)
            b = 0.006 * fbm(V((o[0] * 1.3, o[1] * 4.0, z * 1.3)) + off * 0.7, 2)
            dx = math.copysign(b, o[0]) if abs(o[0]) >= RX - 1e-6 else 0.0
            dy = math.copysign(b, o[1]) if abs(o[1]) >= RY - 1e-6 else 0.0
            outer.append(rb.verts.new((o[0] + dx, o[1] + dy, z)))
        inner = [rb.verts.new((i_[0], i_[1], z0 + 0.004)), rb.verts.new((i_[0], i_[1], zt - 0.004))]
        rings.append((outer, inner))
    n = len(rings)
    for k in range(n):
        (oa, ia), (ob_, ib) = rings[k], rings[(k + 1) % n]
        for j in range(NR):
            rb.faces.new([oa[j], ob_[j], ob_[j + 1], oa[j + 1]])
        rb.faces.new([ia[0], ia[1], ib[1], ib[0]])
        rb.faces.new([oa[NR], ob_[NR], ib[1], ia[1]])
        rb.faces.new([ia[0], ib[0], ob_[0], oa[0]])
    bmesh.ops.recalc_face_normals(rb, faces=rb.faces)
    rb.normal_update()
    if sum((f.calc_center_median() - V((0, 0, 1.5))).dot(f.normal) for f in rb.faces) < 0:
        bmesh.ops.reverse_faces(rb, faces=rb.faces)
    solidity_check(rb, 'wall render (before holes)')
    rb = bool_diff(rb, cutters, name='wall render')
    solidity_check(rb, 'wall render')
    parts.append(part_bm(rb, 0, uvb, render_tint, tag=2, smooth=True))

    # ---- coping: chamfered stone slabs over the sound part of the wall
    for i, (x0, x1) in enumerate(((-1.78, -0.73), (-0.71, 0.3), (0.32, 1.05))):
        s_ = bm_box_mm((x0, -0.3, 2.86), (x1, 0.3, 3.0), bevel=0.016, segs=1, smooth=False)
        if i == 2:                          # the last one broke off at a slant
            for v in s_.verts:
                if v.co.x > 0.9:
                    v.co.x -= 0.1 * (v.co.y + 0.3) / 0.6 + 0.02 * (v.co.z - 2.86) / 0.14
        a = math.radians(rng.uniform(-0.6, 0.6))
        rot(s_, a, 'Z', ((x0 + x1) / 2, 0, 2.93))
        for v in s_.verts:
            if v.co.z > 2.99:
                v.co.z = 3.0 - 0.006 * abs(noise.noise(v.co * 5.0 + off))
        grid_cut(s_, 0, [(x0 + x1) / 2])
        parts.append(part_bm(s_, 1, uv_box(off=(rng.uniform(0, 2), rng.uniform(0, 2))),
                             lambda co: grey(0.9 - 0.1 * max(0.0, fbm(co * 3.0 + off, 2))), tag=4))

    # ---- loose rubble on the ruined top
    for (x, sz) in ((1.3, 0.11), (1.72, 0.095), (-1.9, 0.07)):
        zt = core_z(x)
        st = rough_rock(sz, rng, sc=(1.2, 0.9, 0.62), subdiv=1, amp=0.22, flat=0.35)
        move(st, (x, rng.uniform(-0.08, 0.08), zt - 0.015))
        for v in st.verts:
            v.co.z = min(v.co.z, 2.985)
        parts.append(part_bm(st, 1, uv_box(off=(rng.uniform(0, 2), 0.0)), stone_tint, tag=5, smooth=False))
    return parts


def build_wall(P):
    mats = wall_mats()
    parts = wall_parts()
    mb = MB()
    for p in parts:
        mb.add(p.copy(), None, mats=mats, tint='src', uvf='src', ftag='src')
    ob = finish(mb, 'Wall', sharp=40)
    ao = bake_ao(ob, dist=0.7, samples=160, strength=0.85, ground=0.0)
    SOLIDS['Wall'] = (parts, ao_lookup(ao))
    print('  Wall: %d parts, volume %.4f' % (len(parts), parts_volume(parts)))


# ============================================================================
# PROPERTY-SOURCE PROPS
# ============================================================================
def build_clock(P):
    gold, ink = P['gold'], P['ink']
    face = material('ClockFace', '#f4e9cf', 0.0, 0.5)
    steel = material('BluedSteel', '#22306a', 0.7, 0.28)
    C = V((0.0, 0.0, 0.45))
    # clock-local frame: lathe axis +Z = face normal (-> world -Y), local +Y = up
    Mw = Matrix.Translation(C) @ Matrix.Rotation(math.radians(90), 4, 'X')
    Mup = Mw @ Matrix.Rotation(-math.pi / 2, 4, 'X')      # local Z -> clock "up"
    mb = MB()
    case = bm_lathe([(0, -0.042), (0.12, -0.041), (0.24, -0.037), (0.33, -0.030),
                     (0.39, -0.021), (0.425, -0.011), (0.443, 0.0), (0.45, 0.012),
                     (0.447, 0.025), (0.439, 0.035), (0.427, 0.042), (0.414, 0.045),
                     (0.404, 0.042), (0.399, 0.034), (0.398, 0.021)], segs=30, cap=False)
    mb.add(xform(case, Mw), gold)
    disc = bm_lathe([(0.405, 0.021), (0.36, 0.021), (0.27, 0.021), (0.14, 0.021), (0, 0.021)],
                    segs=30, cap=False)

    def face_tint(co):
        d = (co - C).length / 0.405
        k = 1.0 - 0.10 * smoothstep(0.55, 1.0, d) - 0.05 * max(0.0, fbm(co * 5.0 + V((3, 1, 2))))
        return (k, k * 0.985, k * 0.95)
    mb.add(xform(disc, Mw), face, tint=face_tint)
    ring = bm_lathe([(0.381, 0.0217), (0.373, 0.0217)], segs=30, cap=False)
    mb.add(xform(ring, Mw), ink)
    ring2 = bm_lathe([(0.262, 0.0217), (0.258, 0.0217)], segs=30, cap=False)
    mb.add(xform(ring2, Mw), ink)
    for k in range(60):
        a = math.pi / 2 - k * TAU / 60
        if k % 5 == 0:
            big = (k % 15 == 0)
            r0, r1, w = (0.285, 0.37, 0.032) if big else (0.305, 0.37, 0.014)
        else:
            r0, r1, w = (0.366, 0.386, 0.004)
        if k % 15 == 0:                 # quarter marks keep their thickness
            t = bm_box((r1 - r0, w, 0.0045), center=((r0 + r1) / 2, 0, 0.0237), smooth=False)
        else:                           # the rest are flat inked marks on the dial
            t = bm_grid(1, 1, r0, r1, -w / 2, w / 2, z=0.0237 + 0.00225)
        rot(t, a, 'Z')
        mb.add(xform(t, Mw), ink)
    # crown / winder with a bow ring
    stem = bm_lathe([(0, 0.425), (0.021, 0.425), (0.021, 0.47), (0.03, 0.476), (0, 0.48)], segs=10)
    mb.add(xform(stem, Mup), gold)

    def knurl(t, r, z):
        rr = r * (1.0 + 0.06 * math.cos(6 * t)) if 0.487 < z < 0.521 else r
        return (rr * math.cos(t), rr * math.sin(t), z)
    knob = bm_lathe([(0, 0.476), (0.036, 0.478), (0.044, 0.485), (0.047, 0.494), (0.047, 0.514),
                     (0.044, 0.522), (0.034, 0.528), (0, 0.531)], segs=12, vfun=knurl)
    mb.add(xform(knob, Mup), gold)
    bow = bm_tube([(0.05 * math.cos(TAU * i / 12), 0.578 + 0.05 * math.sin(TAU * i / 12), 0)
                   for i in range(12)], 0.0105, sides=5, closed=True, fixed_b=(0, 0, 1))
    mb.add(xform(bow, Mw), gold)
    finish(mb, 'Clock', sharp=50, weighted=True)

    P0 = C + V((0, -0.021, 0))       # clock-face centre (on the face plane)

    def hand(profile, h0, h1):
        pts = [(w, s) for (s, w) in profile] + [(-w, s) for (s, w) in reversed(profile) if w > 0]
        return xform(bm_prism(pts, h0, h1), Mw)
    hb = MB()
    hb.add(hand([(-0.06, 0.013), (-0.045, 0.009), (-0.02, 0.006), (0.0, 0.018), (0.02, 0.006),
                 (0.112, 0.004), (0.128, 0.016), (0.148, 0.021), (0.165, 0.012), (0.19, 0.0)],
                0.0262, 0.0292), steel)
    finish(hb, 'Clock_HandHour', pivot=P0, parent='Clock', sharp=30)
    mbm = MB()
    mbm.add(hand([(-0.075, 0.010), (-0.05, 0.006), (-0.02, 0.005), (0.0, 0.014), (0.02, 0.005),
                  (0.30, 0.0035), (0.335, 0.0)], 0.0305, 0.0335), steel)
    pin = bm_lathe([(0, 0.02), (0.011, 0.02), (0.012, 0.035), (0.009, 0.039), (0, 0.040)], segs=8)
    mbm.add(xform(pin, Mw), gold)
    finish(mbm, 'Clock_HandMinute', pivot=P0, parent='Clock', sharp=30)


def build_cloud(P):
    white = material('Cloud', '#ffffff', 0.0, 0.95)
    rng = random.Random(21)
    mbd = bpy.data.metaballs.new('CloudMB')
    mbd.resolution = 0.075
    mbd.render_resolution = 0.075
    mbd.threshold = 0.6
    ob = bpy.data.objects.new('CloudMB', mbd)
    bpy.context.scene.collection.objects.link(ob)
    balls = [(0.0, 0.0, 0.05, 0.62), (-0.55, 0.05, -0.05, 0.5), (0.6, -0.02, -0.08, 0.48),
             (0.12, 0.02, 0.42, 0.5), (-0.38, 0.1, 0.3, 0.42), (0.45, -0.05, 0.3, 0.4),
             (-0.98, 0.0, -0.15, 0.34), (1.0, 0.05, -0.17, 0.33), (0.25, -0.32, -0.02, 0.36),
             (-0.28, -0.3, -0.06, 0.34), (0.0, 0.34, 0.05, 0.4), (-0.12, -0.12, 0.62, 0.3),
             (0.68, 0.22, 0.05, 0.3), (-0.7, -0.22, 0.02, 0.3)]
    extra = []
    for k in range(16):
        x, y, z, r = balls[rng.randrange(0, 6)]
        a = rng.uniform(0, TAU)
        el = rng.uniform(0.25, 1.2)
        d = V((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el) * 0.7, math.sin(el)))
        extra.append((x + d.x * r * 0.8, y + d.y * r * 0.8, z + d.z * r * 0.8, rng.uniform(0.18, 0.27)))
    balls = balls + extra
    for (x, y, z, r) in balls:
        e = mbd.elements.new()
        e.co = (x, y, z)
        e.radius = r * (1.0 + 0.05 * rng.uniform(-1, 1))
        e.stiffness = 2.0
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mbd)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    # flatten the belly a little, then fit to 2.2 x 1.4 x 1.2
    zs = [v.co.z for v in bm.verts]
    zb = min(zs) + 0.28 * (max(zs) - min(zs))
    for v in bm.verts:
        if v.co.z < zb:
            v.co.z = zb + (v.co.z - zb) * 0.45
    bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True,
                          use_axis_z=True)
    xs, ys, zs = ([v.co[i] for v in bm.verts] for i in range(3))
    sx, sy, sz = 2.2 / (max(xs) - min(xs)), 1.4 / (max(ys) - min(ys)), 1.2 / (max(zs) - min(zs))
    for v in bm.verts:
        v.co = V((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    c, vol = bm_volume_centroid(bm)
    move(bm, -c)
    set_smooth(bm, True)
    mb = MB()
    mb.add(bm, white)
    shade = hexcol('#aebbd2')

    def vfn(co, n, f):
        t = 0.85 * smoothstep(0.25, -0.85, n.z) + 0.25 * smoothstep(0.0, -0.5, co.z)
        return mix3((1.0, 1.0, 1.0), shade, clamp(t))
    finish(mb, 'Cloud', sharp=None, vfn=vfn)


def build_mirror(P):
    gilt, wood = P['gilt'], P['darkwood']
    glassm = material('MirrorGlass', '#e2ecf5', 1.0, 0.03)
    Cz, a, b = 1.13, 0.36, 0.62
    mb = MB()
    N = 128
    path = [(a * math.cos(TAU * i / N), 0.0, Cz + b * math.sin(TAU * i / N)) for i in range(N)]
    sec = [(-0.05, -0.03), (0.036, -0.03), (0.036, 0.0), (0.031, 0.012), (0.021, 0.017),
           (0.012, 0.029), (0.0, 0.034), (-0.012, 0.03), (-0.02, 0.022), (-0.03, 0.029),
           (-0.042, 0.027), (-0.05, 0.014)]
    mb.add(bm_tube(path, 1.0, closed=True, section=sec, fixed_b=(0, -1, 0)), gilt)
    # beaded outer edge
    for i in range(48):
        t = TAU * i / 48
        p = V((a * math.cos(t), 0, Cz + b * math.sin(t)))
        nrm = V((b * math.cos(t), 0, a * math.sin(t))).normalized()
        mb.add(bm_ico(0.0115, 1, center=p + nrm * 0.053 + V((0, -0.006, 0))), gilt)
    # scallop crest
    Rc = 0.13
    crest = bmesh.new()
    rows = []
    for i in range(7):
        rho = Rc * i / 6
        row = []
        for j in range(33):
            psi = math.pi * j / 32
            rr = rho * (1 + 0.07 * math.cos(16 * psi) * (rho / Rc))
            z = 0.035 * (1 - (rho / Rc) ** 2) + 0.007 * math.cos(16 * psi) * (rho / Rc)
            row.append(crest.verts.new((rr * math.cos(psi), rr * math.sin(psi), z)))
            if i == 0:
                break
        rows.append(row)
    for i in range(1, 7):
        for j in range(32):
            if i == 1:
                crest.faces.new([rows[0][0], rows[1][j], rows[1][j + 1]])
            else:
                crest.faces.new([rows[i - 1][j], rows[i][j], rows[i][j + 1], rows[i - 1][j + 1]])
    bmesh.ops.recalc_face_normals(crest, faces=crest.faces)
    crest.normal_update()
    if sum(f.normal.z for f in crest.faces) < 0:
        bmesh.ops.reverse_faces(crest, faces=crest.faces)
    set_smooth(crest)
    crest = solidify(crest, 0.018)
    xform(crest, Matrix.Translation(V((0, -0.012, Cz + b + 0.015))) @
          Matrix.Rotation(math.radians(90), 4, 'X'))
    mb.add(crest, gilt)
    drop = bm_lathe([(0, -0.13), (0.012, -0.118), (0.024, -0.095), (0.026, -0.07),
                     (0.018, -0.05), (0.022, -0.035), (0.03, -0.02), (0, 0.0)], segs=20)
    mb.add(move(drop, (0, 0, Cz - b - 0.035)), gilt)
    # back board + glass bed
    back = bm_lathe([(1.0, 0), (0.6, 0), (0, 0)], segs=64, sx=0.372, sy=0.632)
    xform(back, Matrix.Translation(V((0, 0.018, Cz))) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    mb.add(back, wood)
    # stand: two turned uprights, arched feet, stretcher, pivot screws
    prof = [(0.0, 0.07), (0.03, 0.07), (0.033, 0.085), (0.026, 0.1), (0.022, 0.2), (0.031, 0.25),
            (0.031, 0.3), (0.02, 0.34), (0.017, 0.6), (0.021, 0.9), (0.025, 1.0), (0.02, 1.05),
            (0.017, 1.2), (0.023, 1.29), (0.017, 1.34), (0.016, 1.65), (0.025, 1.7),
            (0.025, 1.73), (0.013, 1.75), (0.03, 1.79), (0.037, 1.84), (0.031, 1.89),
            (0.014, 1.92), (0.012, 1.94), (0.021, 1.956), (0.012, 1.98), (0.0, 2.0)]
    for sgn in (-1, 1):
        x = 0.5 * sgn
        mb.add(move(bm_lathe(prof, segs=20), (x, 0, 0)), wood)
        foot = [(x, y, 0.045 + 0.045 * (1 - (y / 0.23) ** 2)) for y in
                [lerp(-0.23, 0.23, k / 12) for k in range(13)]]
        mb.add(bm_tube(foot, [0.016 + 0.008 * (1 - abs(k / 6 - 1)) for k in range(13)], sides=10),
               wood)
        for yy in (-0.23, 0.23):
            bun = bm_lathe([(0, 0), (0.024, 0), (0.03, 0.015), (0.026, 0.035), (0, 0.045)], segs=16)
            mb.add(move(bun, (x, yy, 0)), wood)
        rod = bm_tube([(sgn * (a + 0.03), 0, Cz), (sgn * 0.5, 0, Cz)], 0.012, sides=12)
        mb.add(rod, gilt)
        screw = bm_lathe([(0, 0), (0.02, 0), (0.03, 0.01), (0.03, 0.02), (0.02, 0.028), (0, 0.03)],
                         segs=20)
        rot(screw, sgn * math.pi / 2, 'Y')
        mb.add(move(screw, (sgn * 0.52, 0, Cz)), gilt)
    stretch = bm_lathe([(0, -0.5), (0.014, -0.5), (0.014, -0.08), (0.022, -0.05), (0.026, 0.0),
                        (0.022, 0.05), (0.014, 0.08), (0.014, 0.5), (0, 0.5)], segs=12)
    rot(stretch, math.pi / 2, 'Y')
    mb.add(move(stretch, (0, 0, 0.3)), wood)
    finish(mb, 'Mirror', sharp=45, vfn=ao_fn(h=0.3, amt=0.25), weighted=True, decimate=2750)
    gl = bm_lathe([(1.0, 0), (0.8, 0), (0.5, 0), (0.0, 0)], segs=24, sx=0.333, sy=0.593)
    xform(gl, Matrix.Translation(V((0, -0.004, Cz))) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    g = MB()
    g.add(gl, glassm)
    finish(g, 'Mirror_Glass', pivot=(0, -0.004, Cz), parent='Mirror', sharp=None)


def build_candle(P):
    brass = P['brass']
    wax = material('Wax', '#f3e9d0', 0.0, 0.42)
    wick = material('Wick', '#2a2018', 0.0, 0.9)
    flame = material('Flame', '#ffbe5a', 0.0, 0.5, emit='#ff8f24', strength=5.0)
    rng = random.Random(5)
    mb = MB()
    dish = bm_lathe([(0, 0.0), (0.09, 0.0), (0.115, 0.003), (0.121, 0.011), (0.124, 0.02),
                     (0.121, 0.027), (0.113, 0.024), (0.106, 0.014), (0.08, 0.011), (0.05, 0.013),
                     (0.036, 0.02), (0.03, 0.035), (0.029, 0.055), (0.035, 0.07), (0.046, 0.082),
                     (0.049, 0.094), (0.045, 0.1), (0.037, 0.096), (0.0, 0.09)], segs=48)
    mb.add(dish, brass)
    ring = bm_tube([(0.098 + 0.026 * math.cos(TAU * i / 24), 0, 0.045 + 0.026 * math.sin(TAU * i / 24))
                    for i in range(24)], 0.0055, sides=10, closed=True, fixed_b=(0, -1, 0))
    mb.add(ring, brass)
    # wax candle with a softened, melted top
    R, z0, z1 = 0.034, 0.085, 0.47

    def cand(t, r, z):
        rr = r
        zz = z
        if z > z1 - 0.001:
            zz = z + 0.006 * math.sin(3 * t + 1.0) + 0.004 * math.sin(7 * t)
        return (rr * math.cos(t), rr * math.sin(t), zz)
    body = bm_lathe([(0, z0), (R, z0), (R, z1 - 0.02), (R * 1.01, z1 - 0.006), (R * 0.93, z1),
                     (R * 0.7, z1 - 0.006), (R * 0.35, z1 - 0.012), (0, z1 - 0.013)],
                    segs=32, vfun=cand)
    mb.add(body, wax)
    for k in range(6):
        th = rng.uniform(0, TAU)
        L = rng.uniform(0.05, 0.22)
        pts, rad = [], []
        steps = 9
        for i in range(steps + 1):
            s = i / steps
            z = z1 - 0.002 - s * L
            wob = 0.004 * math.sin(s * 9 + k)
            rr = R + 0.0015
            pts.append((rr * math.cos(th + wob * 3), rr * math.sin(th + wob * 3), z))
            rad.append(0.0055 + 0.0035 * smoothstep(0.6, 1.0, s) - 0.004 * smoothstep(0.93, 1.0, s))
        rad[-1] = 0.0
        mb.add(bm_tube(pts, rad, sides=8), wax)
    pool = bm_lathe([(0, 0.094), (0.05, 0.094), (0.058, 0.098), (0.05, 0.104), (0.03, 0.106),
                     (0, 0.106)], segs=24, vfun=lambda t, r, z: (
        r * (1 + 0.12 * math.sin(3 * t)) * math.cos(t), r * (1 + 0.12 * math.sin(3 * t)) * math.sin(t), z))
    mb.add(pool, wax)
    wk = bm_tube([(0, 0, z1 - 0.014), (0, 0, z1 + 0.008), (0.002, 0, z1 + 0.016)],
                 [0.0022, 0.002, 0.0015], sides=6)
    mb.add(wk, wick)

    def vfn(co, n, f):
        k = 1.0 - 0.18 * smoothstep(0.12, 0.0, co.z) * smoothstep(0.02, 0.06, math.hypot(co.x, co.y))
        return (k, k, k)
    finish(mb, 'Candle', sharp=50, vfn=vfn, decimate=1020)
    fb = MB()
    base = V((0.002, 0, z1 + 0.012))
    fl = bm_lathe([(0, 0), (0.008, 0.004), (0.015, 0.018), (0.018, 0.034), (0.016, 0.05),
                   (0.011, 0.068), (0.005, 0.083), (0, 0.095)], segs=10, sy=0.85)
    fb.add(move(fl, base), flame)
    finish(fb, 'Candle_Flame', pivot=base, parent='Candle', sharp=None)


def build_anvil(P):
    iron = material('Iron', '#3e3f44', 0.85, 0.45)
    face = material('AnvilFace', '#8e9198', 0.9, 0.25)
    dark = material('IronDark', '#141416', 0.85, 0.6)
    mb = MB()
    yo = 0.05
    # four feet with an arched gap between them
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.add(bm_box_mm((sx * 0.175 if sx < 0 else 0.1, yo + (sy * 0.23 if sy < 0 else 0.12), 0.0),
                             (-0.1 if sx < 0 else 0.175, yo + (-0.12 if sy < 0 else 0.23), 0.06),
                             bevel=0.008), iron)
    levels = [(0.045, 0.175, 0.23), (0.07, 0.165, 0.222), (0.1, 0.132, 0.192), (0.14, 0.097, 0.16),
              (0.19, 0.073, 0.132), (0.24, 0.068, 0.127), (0.28, 0.076, 0.152), (0.305, 0.082, 0.19)]
    mb.add(bm_loft([rrect(0, yo, hx, hy, 0.022, z, n=3) for (z, hx, hy) in levels]), iron)
    mb.add(bm_box_mm((-0.076, -0.13, 0.295), (0.076, 0.375, 0.444), bevel=0.012, segs=2), iron)
    mb.add(bm_box_mm((-0.074, -0.12, 0.43), (0.074, 0.368, 0.451), bevel=0.004, segs=1), face)
    mb.add(bm_box_mm((-0.062, -0.205, 0.33), (0.062, -0.12, 0.428), bevel=0.01, segs=2), iron)
    horn, rad = [], []
    for k in range(13):
        t = k / 12
        y = lerp(-0.15, -0.375, t)
        r = 0.056 * (1 - t) ** 0.85 + 0.003 * (1 - t)
        horn.append((0, y, 0.384 + 0.036 * t ** 1.2))
        rad.append(r)
    rad[-1] = 0.0
    mb.add(bm_tube(horn, rad, sides=20), iron)
    mb.add(bm_tube([(0, -0.08, 0.27), (0, -0.16, 0.33), (0, -0.23, 0.372)], [0.05, 0.035, 0.0], sides=14),
           iron)
    mb.add(bm_box((0.026, 0.026, 0.004), center=(0, 0.3, 0.4505), smooth=False), dark)
    mb.add(move(bm_lathe([(0.009, 0.4508), (0.0, 0.4508)], segs=12), (0, 0.24, 0)), dark)

    def vfn(co, n, f):
        k = 1.0 - 0.3 * (1 - smoothstep(0.0, 0.15, co.z)) - 0.25 * smoothstep(0.0, -1.0, n.z)
        k *= 1.0 - 0.18 * max(0.0, fbm(co * 18.0, 3))
        return (k, k, k * 1.02 if k < 0.98 else k)
    finish(mb, 'Anvil', sharp=50, vfn=vfn, weighted=True)


def ridge(p):
    return (1.0 - abs(noise.noise(p))) ** 3


def cloth(nu, nv, u0, u1, v0, v1, top, hx, yf, rho, seed, amp_top=0.02, amp_hang=0.03, freq=9.0,
          hump=None, max_hang=None, foot_hang=None):
    """Cloth laid over a box top [|x| <= hx, y >= yf] at height `top`, falling
    over both sides and the foot end (-Y) round a soft edge of radius rho, then
    rumpled: ridged wrinkles on top, vertical folds that deepen toward the hem,
    an optional hump (x, y, rx, ry, h).  Single-sided grid, normals outward."""
    bm = bm_grid(nu, nv, u0, u1, v0, v1)
    ph = seed * 1.7
    so = V((seed * 3.1, seed * 1.3, seed * 0.7))
    for v in bm.verts:
        u, w = v.co.x, v.co.y
        ex = max(0.0, abs(u) - hx)
        ey = max(0.0, yf - w)
        e = math.hypot(ex, ey)
        bx, by = clamp(u, -hx, hx), max(w, yf)
        if e <= 1e-9:
            base = V((u, w, top))
            nrm = V((0, 0, 1))
            g = V((u * 2.2, w * 2.2, 0)) + so
            g2 = V((u * 5.0 + 0.6 * noise.noise(g), w * 3.0, 1.0)) + so
            d = amp_top * (0.65 * ridge(g) + 0.5 * ridge(g2) - 0.35)
            if hump:
                hx_, hy_, rx, ry, hh = hump
                q = ((u - hx_) / rx) ** 2 + ((w - hy_) / ry) ** 2
                d += hh * math.exp(-q * 1.6) * (1.0 + 0.3 * noise.noise(g * 1.5))
            # soften toward the edge so the roll-over stays continuous
            edge = smoothstep(0.0, 0.08, min(hx - abs(u), w - yf))
            v.co = base + nrm * (d * edge)
            continue
        dd = V((math.copysign(ex, u) / e, -ey / e, 0.0))
        arc = math.pi * rho / 2
        if e < arc:
            ang = e / rho
            h, dz = rho * math.sin(ang), rho * (1 - math.cos(ang))
            hang = 0.0
        else:
            h, dz = rho, rho + (e - arc)
            hang = e - arc
        lim = max_hang
        if foot_hang is not None:
            t_ = smoothstep(0.3, 0.75, ey / e)
            lim = lerp(max_hang if max_hang is not None else 9.0, foot_hang, t_)
        if lim is not None and hang > lim:
            dz -= hang - lim
            h += (hang - lim) * 0.15
            hang = lim
        s_ = w if ex >= ey else u
        k = smoothstep(0.0, 0.3, hang)
        fold = amp_hang * k * (math.sin(freq * s_ + ph + 1.5 * noise.noise(V((s_ * 2.0, hang * 2.0, seed)))) * 0.7 +
                               0.3 * math.sin(2.3 * freq * s_ + 2 * ph))
        fold += 0.008 * k * k                                  # the hem swings out a little
        v.co = V((bx, by, top - dz)) + dd * (h + fold)
    set_smooth(bm)
    return bm


def build_bed(P):
    """Four-poster: turned and reeded oak posts on square blocks with brass
    finials, moulded tester and side rails, panelled head- and footboards with
    an arched cresting rail; mattress, sheet with a turned-down cuff, a rumpled
    oxblood blanket with a woven border, and a dented pillow (Bed_Pillow,
    same pivot)."""
    rng = random.Random(1142)
    off = V((7.7, 2.1, 5.5))
    oak = tx('oak')
    sheet, brass = P['sheet'], P['brass']
    blanket = material('Blanket', '#7c2424', 0.0, 0.85, double=True)
    mats = [oak, brass, sheet, blanket]
    mb = MB()

    def wtint(co):
        g = 1.0 - 0.08 * max(0.0, fbm(co * 3.0 + off, 2)) * 2.0
        g *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.3, co.z))
        return (g, g * 0.9, g * 0.8)

    def add(bm, mi, uvf, tag=1, tnt=None, smooth=None):
        mb.add(part_bm(bm, mi, uvf, tnt or wtint, tag=tag, smooth=smooth), None, mats=mats, tint='src', uvf='src',
               ftag='src')
    # ---- posts
    NR = 6                                            # reeds on the upper post

    def reeds(t, r, z):
        rr = r
        if 1.02 < z < 1.72:
            ph = (t * NR / TAU) % 1.0
            rr = r * (1.0 - 0.1 * (1.0 - math.sin(math.pi * ph) ** 0.6) * smoothstep(1.02, 1.08, z) * smoothstep(1.72, 1.66, z))
        return (rr * math.cos(t), rr * math.sin(t), z)
    post = [(0.0, 0.45), (0.036, 0.45), (0.041, 0.462), (0.034, 0.476), (0.03, 0.5), (0.034, 0.53),
            (0.047, 0.6), (0.053, 0.66), (0.05, 0.72), (0.04, 0.78), (0.03, 0.83), (0.026, 0.86),
            (0.033, 0.875), (0.036, 0.89), (0.029, 0.905), (0.025, 0.93), (0.031, 0.95), (0.027, 0.97),
            (0.029, 1.0), (0.03, 1.02), (0.03, 1.2), (0.028, 1.4), (0.026, 1.6), (0.025, 1.72),
            (0.029, 1.735), (0.032, 1.75), (0.024, 1.77), (0.021, 1.8), (0.028, 1.83), (0.02, 1.86),
            (0.02, 1.885), (0.0, 1.885)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = 0.75 * sx, 1.05 * sy
            ft = bm_lathe([(0, 0), (0.038, 0), (0.047, 0.018), (0.044, 0.04), (0.036, 0.052), (0, 0.055)], segs=8)
            add(move(ft, (x, y, 0)), 0, uv_cyl(cx=x, cy=y, axial_u=True))
            blk = bm_box((0.09, 0.09, 0.4), center=(x, y, 0.253), bevel=0.008, segs=1, smooth=False)
            add(blk, 0, uv_box(grain='z'), smooth=False)
            pl = decimate_bm(bm_lathe(post, segs=12, vfun=reeds), 380)
            add(move(pl, (x, y, 0)), 0, uv_cyl(cx=x, cy=y, axial_u=True))
            tb = bm_box((0.07, 0.07, 0.075), center=(x, y, 1.9225), bevel=0.006, segs=1, smooth=False)
            add(tb, 0, uv_box(grain='z'), smooth=False)
            fin = bm_lathe([(0, 1.96), (0.012, 1.96), (0.012, 1.965), (0.02, 1.972), (0.024, 1.982),
                            (0.02, 1.992), (0.008, 1.997), (0, 2.0)], segs=6)
            add(move(fin, (x, y, 0)), 1, uv_box(), tnt=lambda co: (1, 1, 1))
    # ---- moulded tester rails and side rails
    def rail_x(x0, x1, y, z0, z1, d):
        prof = [(-d, z0), (d, z0), (d, z1 - 0.012), (d * 0.6, z1), (-d * 0.6, z1), (-d, z1 - 0.012)]
        r = bm_loft([[V((x0, y + py, z)) for (py, z) in prof], [V((x1, y + py, z)) for (py, z) in prof]],
                    smooth=False)
        bmesh.ops.recalc_face_normals(r, faces=r.faces)
        return r

    def rail_y(y0, y1, x, z0, z1, d):
        prof = [(-d, z0), (d, z0), (d, z1 - 0.012), (d * 0.6, z1), (-d * 0.6, z1), (-d, z1 - 0.012)]
        r = bm_loft([[V((x + px, y0, z)) for (px, z) in prof], [V((x + px, y1, z)) for (px, z) in prof]],
                    smooth=False)
        bmesh.ops.recalc_face_normals(r, faces=r.faces)
        return r
    for sx in (-1, 1):
        add(rail_y(-1.005, 1.005, 0.75 * sx, 1.885, 1.935, 0.022), 0, uv_box(grain='y'))
        add(rail_y(-1.005, 1.005, 0.73 * sx, 0.2, 0.4, 0.02), 0, uv_box(grain='y'))
    for sy in (-1, 1):
        add(rail_x(-0.705, 0.705, 1.05 * sy, 1.885, 1.935, 0.022), 0, uv_box())
    # ---- footboard (-Y): rail, two fielded panels, cap
    add(bm_box_mm((-0.705, -1.07, 0.2), (0.705, -1.03, 0.4), bevel=0.006, segs=1, smooth=False), 0, uv_box())
    add(bm_box_mm((-0.705, -1.066, 0.4), (0.705, -1.034, 0.66), bevel=0.004, segs=1, smooth=False), 0, uv_box())
    add(rail_x(-0.74, 0.74, -1.05, 0.66, 0.71, 0.027), 0, uv_box())
    # ---- headboard (+Y): two fielded panels in a frame under an arched rail
    add(bm_box_mm((-0.705, 1.03, 0.2), (0.705, 1.07, 0.4), bevel=0.006, segs=1, smooth=False), 0, uv_box())

    def arch_z(x):
        return 1.18 + 0.27 * max(0.0, math.cos(math.pi * x / 1.44)) ** 1.5
    pts = [(-0.705, 0.4), (0.705, 0.4)]
    for k in range(25):
        x = lerp(0.705, -0.705, k / 24)
        pts.append((x, arch_z(x)))
    head = bm_prism(pts, 1.035, 1.065)
    xform(head, Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    bmesh.ops.reverse_faces(head, faces=head.faces)
    add(head, 0, uv_box(), smooth=False)
    arc = [(x, 1.03, arch_z(x)) for x in [lerp(-0.73, 0.73, k / 30) for k in range(31)]]
    at = bm_tube_uv(arc[::2], 0.026, sides=6)
    mb.add(part_bm_keep(at, 0, wtint, tag=1), None, mats=mats, tint='src', uvf='src', ftag='src')
    for (xa, xb) in ((-0.62, -0.05), (0.05, 0.62)):
        for (za, zb) in ((0.5, 1.05),):
            fi = 0.05
            r0 = [(xa, za), (xb, za), (xb, zb), (xa, zb)]
            r1 = [(xa + fi, za + fi), (xb - fi, za + fi), (xb - fi, zb - fi), (xa + fi, zb - fi)]
            for sgn in (-1, 1):
                y_ = 1.05 + sgn * 0.015
                pn = bm_loft([[V((x, 1.05, z)) for (x, z) in r0], [V((x, y_ + sgn * 0.004, z)) for (x, z) in r0],
                              [V((x, y_ + sgn * 0.012, z)) for (x, z) in r1]], smooth=False)
                bmesh.ops.recalc_face_normals(pn, faces=pn.faces)
                add(pn, 0, uv_box(off=(rng.uniform(0, 1), 0)), smooth=False)
    # ---- mattress, sheet with a turned-down cuff, blanket with a woven border
    mat_ = bm_box_mm((-0.72, -1.0, 0.4), (0.72, 1.0, 0.6), bevel=0.05, segs=2)
    add(mat_, 2, uv_box(), tnt=lambda co: (0.93, 0.92, 0.9), smooth=True)

    def sheet_tint(co):
        k = 1.0 - 0.05 * max(0.0, fbm(co * 4.0 + off, 2)) * 2.0
        return (k, k * 0.99, k * 0.96)
    sh = cloth(38, 46, -0.9, 0.9, -1.1, 0.98, 0.607, 0.72, -0.96, 0.045, 1, amp_top=0.012, amp_hang=0.012,
               max_hang=0.07, foot_hang=0.05)
    add(decimate_bm(sh, 480), 2, uv_box(), tnt=sheet_tint, smooth=True)

    def blanket_tint(co):
        g = 1.0 - 0.1 * max(0.0, fbm(co * 5.0 + off, 2)) * 2.0
        # a darker woven band a hand's width in from the hem / the fold
        band = smoothstep(0.03, 0.0, abs(co.z - 0.3)) if co.z < 0.55 else 0.0
        fold = smoothstep(0.025, 0.0, abs(co.y - 0.12)) if co.z > 0.55 else 0.0
        weave = 0.04 * (math.sin(co.x * 260.0) * math.sin(co.y * 260.0 + co.z * 260.0))
        k = g * (1.0 - 0.35 * max(band, fold) + weave)
        return (k, k * 0.95, k * 0.95)
    bl = cloth(54, 44, -1.12, 1.12, -1.2, 0.3, 0.64, 0.72, -0.955, 0.05, 3, amp_top=0.04, amp_hang=0.026,
               freq=11.0, hump=(0.14, -0.3, 0.3, 0.62, 0.08), max_hang=0.28, foot_hang=0.1)
    add(decimate_bm(bl, 1250), 3, uv_box(), tnt=blanket_tint, smooth=True)
    # the sheet's cuff turned down over the blanket's head end
    cf = cloth(38, 8, -1.08, 1.08, 0.2, 0.46, 0.655, 0.72, -1.0, 0.07, 5, amp_top=0.012, amp_hang=0.015,
               max_hang=0.22)
    add(decimate_bm(cf, 170), 2, uv_box(), tnt=sheet_tint, smooth=True)

    def vfn(co, n, f):
        return (1.0, 1.0, 1.0)
    ob = finish(mb, 'Bed', sharp=45, vfn=vfn)
    # ---- pillow: plumped, pinched corners, a head-shaped dent
    pb = bmesh.new()
    bmesh.ops.create_cube(pb, size=2.0)
    bmesh.ops.subdivide_edges(pb, edges=pb.edges, cuts=4, use_grid_fill=True)
    hx, hy, hz = 0.33, 0.19, 0.08
    for v in pb.verts:
        x, y, z = v.co
        th = ((1 - abs(x) ** 2.4) * (1 - abs(y) ** 2.4)) ** 0.55
        X = x * hx * (1 + 0.05 * (1 - y * y))
        Y = y * hy * (1 + 0.07 * (1 - x * x))
        Z = z * hz * th
        if z > 0:
            Z -= 0.03 * math.exp(-((x + 0.15) ** 2 / 0.18 + (y - 0.05) ** 2 / 0.35))
            Z += 0.006 * ridge(V((x * 3.0, y * 3.0, 2.0)))
        corner = abs(x) ** 6 * abs(y) ** 6
        Z *= 1.0 - 0.5 * corner
        v.co = V((X, Y, Z))
    pb = decimate_bm(subsurf(pb, 1), 460)
    set_smooth(pb)
    zmin = min(v.co.z for v in pb.verts)
    pc = V((0, 0.76, 0.607))
    move(pb, pc - V((0, 0, zmin)))
    pmb = MB()
    pmb.add(part_bm(pb, 0, uv_box(), lambda co: grey(0.97), tag=1), None, mats=[sheet], tint='src', uvf='src',
            ftag='src')
    pob = finish(pmb, 'Bed_Pillow', pivot=pc, parent='Bed', sharp=None)
    bake_ao(ob, dist=0.35, samples=128, strength=0.85, ground=0.0, keep=(pob,))
    bake_ao(pob, dist=0.15, samples=96, strength=0.7, keep=(ob,))


def build_bowler(P):
    felt = material('Felt', '#161514', 0.0, 0.7)
    band = material('HatBand', '#0b0b0c', 0.0, 0.32)

    def vf(t, r, z):
        zz = z
        if r > 0.132:
            k = (r - 0.132) / 0.08
            zz += 0.05 * k * k * (math.cos(t) ** 2) - 0.008 * k * (math.sin(t) ** 2)
        return (r * math.cos(t) * 0.93, r * math.sin(t), zz)
    # (perf budget: a lighter profile and 28 segments instead of 26 x 72;
    #  felt and band share segments so the band never z-fights the crown)
    prof = [(0, 0.186), (0.105, 0.152), (0.121, 0.024),
            (0.13, 0.009), (0.17, 0.008), (0.2, 0.017), (0.209, 0.03), (0.2085, 0.041), (0.198, 0.044),
            (0.17, 0.029), (0.14, 0.0255), (0.1295, 0.031), (0.1275, 0.05), (0.1285, 0.09), (0.1245, 0.13),
            (0.108, 0.168), (0.07, 0.196), (0, 0.2045)]
    mb = MB()
    mb.add(bm_lathe(prof, segs=28, vfun=vf), felt)
    mb.add(bm_lathe([(0.1281, 0.028), (0.1296, 0.031), (0.1301, 0.061), (0.1283, 0.064)],
                    segs=28, vfun=vf, cap=False), band)
    for (y, zc, sc) in ((0.017, 0.047, (0.006, 0.02, 0.012)), (-0.017, 0.045, (0.006, 0.02, 0.011)),
                        (0.0, 0.046, (0.007, 0.009, 0.011))):
        mb.add(bm_ico(1.0, 1, center=(0.1215, y, zc), sc=sc), band)
    zmin = min(v.co.z for v in mb.bm.verts)
    move(mb.bm, (0, 0, -zmin))
    finish(mb, 'BowlerHat', sharp=None,
           vfn=lambda co, n, f: grey(1.0 - 0.3 * smoothstep(0.0, -1.0, n.z)))


def build_birdcage(P):
    brass = P['brass']
    perch = material('PerchWood', '#8a5a32', 0.0, 0.6)
    mb = MB()
    tray = bm_lathe([(0, 0.0), (0.2, 0.0), (0.215, 0.006), (0.205, 0.018), (0.23, 0.024),
                     (0.25, 0.034), (0.25, 0.07), (0.244, 0.075), (0.236, 0.07), (0.232, 0.04),
                     (0.0, 0.04)], segs=24)
    mb.add(tray, brass)
    nb = 24
    Rb, zt = 0.225, 0.46
    for i in range(nb):
        ph = TAU * i / nb
        pts = [(Rb, 0.05), (Rb, zt)]
        for k in range(1, 6):
            s = (math.pi / 2 - 0.12) * k / 5
            pts.append((Rb * math.cos(s), zt + 0.21 * math.sin(s)))
        p3 = [(r * math.cos(ph), r * math.sin(ph), z) for (r, z) in pts]
        mb.add(bm_tube(p3, 0.0042, sides=4), brass)
    for (z, rr, th) in ((0.075, Rb + 0.001, 0.008), (0.26, Rb + 0.001, 0.006), (zt, Rb + 0.001, 0.007)):
        mb.add(bm_tube([(rr * math.cos(TAU * k / 28), rr * math.sin(TAU * k / 28), z) for k in range(28)],
                       th, sides=4, closed=True, fixed_b=(0, 0, 1)), brass)
    zc = zt + 0.21 * math.sin(math.pi / 2 - 0.12)
    rc = Rb * math.cos(math.pi / 2 - 0.12)
    mb.add(bm_tube([(rc * math.cos(TAU * k / 16), rc * math.sin(TAU * k / 16), zc) for k in range(16)],
                   0.006, sides=4, closed=True, fixed_b=(0, 0, 1)), brass)
    mb.add(bm_lathe([(0, zc - 0.01), (0.04, zc - 0.005), (0.035, zc + 0.012), (0.018, zc + 0.025),
                     (0.012, zc + 0.045), (0.02, zc + 0.058), (0.012, zc + 0.068), (0, zc + 0.07)],
                    segs=12), brass)
    top = zc + 0.064
    mb.add(bm_tube([(0.034 * math.sin(TAU * k / 16), 0, top + 0.034 + 0.034 * -math.cos(TAU * k / 16))
                    for k in range(16)], 0.006, sides=4, closed=True, fixed_b=(0, -1, 0)), brass)
    rod = bm_lathe([(0, -0.23), (0.008, -0.23), (0.008, 0.23), (0, 0.23)], segs=6)
    rot(rod, math.pi / 2, 'Y')
    mb.add(move(rod, (0, 0.03, 0.24)), perch)
    finish(mb, 'Birdcage', sharp=50, vfn=ao_fn(h=0.2, amt=0.2))


def build_pomegranate(P):
    rind = material('Rind', '#a2262a', 0.0, 0.42)
    seedm = material('Seeds', '#b3122f', 0.0, 0.18, emit='#ff1e46', strength=2.0)
    rng = random.Random(9)
    R, H, zc = 0.2, 0.18, 0.18
    thc = -math.pi / 2
    f0, f1 = 0.3 * math.pi, 0.84 * math.pi
    WMAX = 0.72

    def crack(theta, phi):
        if not (f0 < phi < f1):
            return 0.0, 0.0, 0.0
        w = WMAX * math.sin(math.pi * (phi - f0) / (f1 - f0)) ** 0.75
        d = abs((theta - thc + math.pi) % TAU - math.pi)
        core = 1.0 - smoothstep(0.62 * w, w, d)
        lip = math.exp(-((d - w * 1.02) / 0.08) ** 2) * smoothstep(0.0, 0.2, w)
        return core, lip, w

    def rad(theta, phi):
        core, lip, _ = crack(theta, phi)
        facet = 1 + 0.024 * math.cos(6 * theta) * math.sin(phi) ** 2
        return facet * (1 - 0.3 * core + 0.1 * lip), core
    segs, rings = 80, 48
    bm = bmesh.new()
    vrows = []
    cores = {}
    for i in range(rings + 1):
        phi = math.pi * i / rings
        if i in (0, rings):
            v = bm.verts.new((0, 0, zc + H * math.cos(phi)))
            vrows.append([v])
            cores[v] = 0.0
            continue
        row = []
        for j in range(segs):
            th = TAU * j / segs
            r, core = rad(th, phi)
            v = bm.verts.new((R * r * math.sin(phi) * math.cos(th), R * r * math.sin(phi) * math.sin(th),
                              zc + H * r * math.cos(phi)))
            cores[v] = core
            row.append(v)
        vrows.append(row)
    for a_, b_ in zip(vrows, vrows[1:]):
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(a_) == 1:
                vs = [a_[0], b_[j], b_[j2]]
            elif len(b_) == 1:
                vs = [a_[j2], a_[j], b_[0]]
            else:
                vs = [a_[j2], a_[j], b_[j], b_[j2]]
            f = bm.faces.new(vs)
    bm.normal_update()
    if sum((f.calc_center_median() - V((0, 0, zc))).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    set_smooth(bm)
    bm = decimate_bm(bm, 440)
    set_smooth(bm)
    mb = MB()

    def rtint(co):
        g = fbm(co * 11.0 + V((1, 2, 3)), 3)
        k = 1.0 - 0.28 * max(0.0, g) - 0.25 * smoothstep(0.29, 0.36, co.z)
        d = co - V((0, 0, zc))
        phi = math.acos(clamp(d.z / max(1e-6, d.length)))
        th = math.atan2(d.y, d.x)
        core, lip, _ = crack(th, phi)
        k *= 1.0 - 0.7 * smoothstep(0.1, 0.6, core)
        return (k, k * (0.92 + 0.08 * max(0.0, -g)) * (1 - 0.3 * core), k * 0.9 * (1 - 0.3 * core))
    mb.add(bm, rind, tint=rtint)

    def crown_v(t, r, z):
        pk = max(0.0, math.cos(6 * t)) ** 3
        rr = r * (1 + 0.5 * pk * smoothstep(0.375, 0.405, z))
        zz = z + 0.022 * pk * smoothstep(0.375, 0.405, z)
        return (rr * math.cos(t), rr * math.sin(t), zz)
    crown = bm_lathe([(0.0, 0.33), (0.042, 0.34), (0.031, 0.365), (0.032, 0.382), (0.045, 0.4),
                      (0.053, 0.408), (0.047, 0.413), (0.034, 0.4), (0.022, 0.388), (0, 0.378)],
                     segs=12, vfun=crown_v)
    mb.add(crown, rind, tint=(0.55, 0.4, 0.34))
    finish(mb, 'Pomegranate', sharp=None,
           vfn=lambda co, n, f: grey(1.0 - 0.3 * smoothstep(0.0, -1.0, n.z)))
    # seeds packed into the split, recessed below the rind lips
    sb = MB()
    placed = []
    step = 0.02
    rows_ = int((f1 - f0) * H / step) + 2
    for i in range(rows_):
        phi = f0 + (i + 0.5) * step / H
        if phi >= f1:
            break
        core_w = crack(thc, phi)[2]
        n_th = int(2 * core_w * R * math.sin(phi) / step) + 1
        for j in range(n_th):
            off = 0.5 if i % 2 else 0.0
            th = thc + ((j + off) - n_th / 2.0) * step / max(1e-3, R * math.sin(phi))
            th += rng.uniform(-0.1, 0.1) * step / R
            core, _, _ = crack(th, phi)
            if core < 0.55:
                continue
            r, _ = rad(th, phi)
            d = V((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi)))
            base = V((R * r * d.x, R * r * d.y, zc + H * r * d.z))
            nrm = V((d.x / R, d.y / R, d.z / H)).normalized()
            p = base + nrm * (0.011 - 0.006 * (1 - core))
            if any((p - q).length < step * 0.8 for q in placed):
                continue
            placed.append(p)
            s_ = bm_lathe([(0.0, -1.0), (1.0, 0.0), (0.0, 1.0)], segs=4)   # an 8-tri aril, smooth shaded
            scale(s_, (0.0128, 0.0118, 0.0145))
            rot(s_, rng.uniform(0, TAU), 'Z')
            q = nrm.to_track_quat('Z', 'Y')
            xform(s_, Matrix.Translation(p) @ q.to_matrix().to_4x4())
            k = rng.uniform(0.8, 1.0)
            sb.add(s_, seedm, tint=(k, k, k))
    cen = sum(placed, V((0, 0, 0))) / len(placed)
    print('  Pomegranate seeds: %d' % len(placed))
    finish(sb, 'Pomegranate_Seeds', pivot=cen, parent='Pomegranate', sharp=None)


def cut_plane(n, point):
    n = V(n).normalized()
    return n, n.dot(V(point))


# ============================================================================
# ENVIRONMENT KIT
# ============================================================================


def grid_cut(bm, axis, values):
    no = [0, 0, 0]
    no[axis] = 1
    for val in values:
        co = [0, 0, 0]
        co[axis] = val
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co,
                               plane_no=no)
    return bm


def wall_seeds():
    rng = random.Random(1904)
    seeds = []
    relax = 1.0
    tries = 0
    while len(seeds) < 24:
        tries += 1
        if tries % 4000 == 0:
            relax *= 0.9
        u = rng.random() ** 1.5
        a = rng.uniform(0, TAU)
        p = V((math.cos(a) * u * 2.4, rng.uniform(-0.05, 0.05), 1.5 + math.sin(a) * u * 1.8))
        if not (-1.92 < p.x < 1.92 and 0.08 < p.z < 2.92):
            continue
        dn = math.hypot(p.x / 2.0, (p.z - 1.5) / 1.5)
        md = (0.3 + 0.62 * dn) * relax
        if any(math.hypot(p.x - q.x, p.z - q.z) < md for q in seeds):
            continue
        seeds.append(p)
    return seeds


def build_wall_fractured(P):
    """Voronoi chunks cut from the Wall's own closed parts (render, rubble core,
    plinth, coping), so the pieces show the same flaked render and stone; the
    cut faces are rubble stone."""
    if 'Wall' not in SOLIDS:
        build_wall(P)                   # (--only: build the solid for its parts, drop it)
        o = bpy.data.objects['Wall']
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    parts, ao = SOLIDS['Wall']
    empty('Wall_Fractured')
    cells = voronoi_cells(wall_seeds(), (-2.2, -0.45, -0.05), (2.2, 0.45, 3.1))
    off = V((1.1, 7.3, 2.9))

    def cap_tint(co):
        k = 0.62 + 0.14 * fbm(co * 3.0 + off, 2)
        return (k, k * 0.96, k * 0.9)
    info = cut_cells(parts, cells, wall_mats(), 1, uv_box(), cap_tint)
    n, total, vmax = make_chunks('Wall_Fractured', 'Wall', info, (0.0, 0.0, 1.5), ao=ao, sharp=40)
    print('  Wall_Fractured: %d chunks, volume %.4f (solid parts %.4f), max verts %d' % (
        n, total, parts_volume(parts), vmax))


COL_Z0, COL_Z1 = 0.37, 3.515          # fluted shaft


def column_R(z):
    """Shaft radius with entasis (swell a third of the way up, then taper)."""
    t = clamp((z - COL_Z0) / (COL_Z1 - COL_Z0))
    return 0.302 - 0.04 * t ** 1.6 + 0.007 * math.sin(math.pi * t)


def column_parts(lod=1.0):
    """Closed parts of the fluted marble Column (all TX_marble, index 0):
    plinth, Attic base, shaft, capital (astragal, necking, annulets, echinus),
    abacus.  lod < 1 thins the tessellation (for the fracture pieces).
    Tags: 1 plinth, 2 base, 3 shaft, 4 capital, 5 abacus."""
    rng = random.Random(3117)
    off = V((5.1, 2.2, 9.7))
    NF = 20
    SPF = 4 if lod >= 0.9 else 3                         # segments per flute
    SEG = 40 if lod >= 0.9 else 20                        # lathe segments of the mouldings
    ARC = 2 if lod >= 0.9 else 3                          # every ARC-th point of the moulding arcs
    parts = []
    uvc = uv_cyl()

    def tint(co):
        k = 1.0 - 0.07 * max(0.0, fbm(co * 1.6 + off, 3)) * 2.0
        th = math.atan2(co.y, co.x)
        st = max(0.0, noise.noise(V((th * 3.2, 0.0, 0.7)) + off)) * smoothstep(1.2, 3.7, co.z)
        st += 0.6 * max(0.0, noise.noise(V((th * 9.0, 2.0, 0.3)) + off)) * smoothstep(2.4, 3.8, co.z)
        base = 1.0 - smoothstep(0.0, 0.7, co.z)
        r, g, b = 1.0, 0.97, 0.92
        r, g, b = mix3((r, g, b), (0.6, 0.57, 0.52), 0.7 * min(1.0, st))
        r, g, b = mix3((r, g, b), (0.66, 0.6, 0.5), 0.55 * base)
        return (r * k, g * k, b * k)

    def chip(bm, centre, n, depth, tag_):
        """Knock a chip off an edge: a plane cut near the given point."""
        n = V(n).normalized()
        clip_closed(bm, -n, -(n.dot(V(centre)) - depth), 0, None, None, cap_tag=tag_)
        # (-n.p <= -(n.c - depth))  ==  n.p >= n.c - depth: keeps the inside
    # ---- plinth: chamfered square block, two corners chipped
    pl = bm_box_mm((-0.35, -0.35, 0.0), (0.35, 0.35, 0.14), bevel=0.012, segs=1, smooth=False)
    for (cx, cy, cz, dep) in ((0.35, -0.35, 0.14, 0.05), (-0.35, 0.35, 0.1, 0.035)):
        nrm = V((-cx, -cy, -0.6 if cz > 0.12 else 0.2))
        c_ = V((cx, cy, cz))
        n_ = nrm.normalized()
        clip_closed(pl, -n_, -(n_.dot(c_) + dep), 0, None, None, cap_tag=-2)
    parts.append(part_bm(pl, 0, uv_box(), tint, tag=1, smooth=False))

    # ---- Attic base: torus, fillet, scotia, fillet, torus, apophyge
    prof = [(0.0, 0.14), (0.318, 0.14)]
    for k in range(1, 8, ARC):                             # lower torus
        a = -math.pi / 2 + math.pi * k / 8
        prof.append((0.305 + 0.037 * math.cos(a), 0.1775 + 0.0375 * math.sin(a)))
    prof += [(0.306, 0.215), (0.306, 0.224)]
    for k in range(1, 6, ARC):                             # scotia (concave)
        t = k / 6
        prof.append((0.306 - 0.022 * math.sin(math.pi * t) ** 0.8 - 0.004 * t, 0.224 + 0.062 * t))
    prof += [(0.302, 0.286), (0.302, 0.292)]
    for k in range(1, 7, ARC):                             # upper torus
        a = -math.pi / 2 + math.pi * k / 7
        prof.append((0.3 + 0.022 * math.cos(a), 0.3145 + 0.0225 * math.sin(a)))
    prof += [(0.306, 0.337), (0.306, 0.346), (0.302, 0.352), (0.0, 0.352)]
    bs = bm_lathe(prof, segs=SEG, smooth=True)
    parts.append(part_bm(bs, 0, uvc, tint, tag=2))

    # ---- shaft: 20 Doric flutes meeting at (worn) arrises, entasis, erosion
    zs = [COL_Z0] + [lerp(COL_Z0, COL_Z1, k / 9) for k in range(1, 9)] + [COL_Z1]
    if lod < 1:
        zs = [COL_Z0] + [lerp(COL_Z0, COL_Z1, k / 6) for k in range(1, 6)] + [COL_Z1]
    D = 0.021
    bites = []
    for _ in range(7):
        fz = rng.uniform(0.6, 3.3)
        fk = rng.randrange(NF)
        bites.append((fk * TAU / NF + 0.1, fz, rng.uniform(0.025, 0.05), rng.uniform(0.006, 0.014)))

    def flute(t, r, z):
        ph = ((t - 0.1) * NF / TAU) % 1.0
        wear = 0.55 + 0.1 * noise.noise(V((t * 3.0, z * 2.0, 1.0)) + off)
        dep = D * (1.0 - abs(2.0 * ph - 1.0) ** 2) ** wear
        if z < COL_Z0 + 0.03 or z > COL_Z1 - 0.03:
            dep *= smoothstep(0.0, 0.03, min(z - COL_Z0, COL_Z1 - z))  # flutes die out in the apophyges
        ero = 0.0016 * fbm(V((math.cos(t) * 2.5, math.sin(t) * 2.5, z * 2.5)) + off, 3)
        rr = r - dep + ero
        for (bt, bz, br, bd) in bites:
            dd = math.hypot((t - bt) * r, z - bz)
            if dd < br:
                rr -= bd * (1.0 - (dd / br) ** 2)
        return (rr * math.cos(t), rr * math.sin(t), z)
    sh = bm_lathe([(0.0, COL_Z0 - 0.01)] + [(column_R(z), z) for z in zs] + [(0.0, COL_Z1 + 0.01)],
                  segs=NF * SPF, vfun=flute, phase=0.1, smooth=True)
    parts.append(part_bm(sh, 0, uv_cyl(), tint, tag=3))

    # ---- capital: astragal, fillet, necking, three annulets, echinus
    rt = column_R(COL_Z1)
    prof = [(0.0, COL_Z1 - 0.005), (rt, COL_Z1 - 0.005), (rt + 0.006, COL_Z1 + 0.004)]
    for k in range(1, 6, ARC):
        a = -math.pi / 2 + math.pi * k / 6
        prof.append((rt + 0.008 + 0.015 * math.cos(a), COL_Z1 + 0.019 + 0.015 * math.sin(a)))
    zn = COL_Z1 + 0.034
    prof += [(rt + 0.004, zn), (rt + 0.004, zn + 0.11)]
    z = zn + 0.11
    for i in range(3):
        r0 = rt + 0.01 + 0.007 * i
        prof += [(r0, z), (r0, z + 0.011)]
        z += 0.011
    for k in list(range(0, 8, ARC)) + ([7] if ARC > 1 else []):
        a = math.pi / 2 * k / 7
        prof.append((rt + 0.03 + 0.053 * math.sin(a) ** 0.85, z + 0.095 * (1 - math.cos(a)) ** 1.1 * 0.62 + 0.004 * k / 7))
    zt = prof[-1][1]
    prof += [(0.0, zt)]
    cp = bm_lathe(prof, segs=SEG, smooth=True)
    parts.append(part_bm(cp, 0, uvc, tint, tag=4))

    # ---- abacus: square slab with a projecting chamfered fillet, chipped
    ab = bm_box_mm((-0.343, -0.343, zt - 0.004), (0.343, 0.343, 3.94), bevel=0.008, segs=1, smooth=False)
    parts.append(part_bm(ab, 0, uv_box(), tint, tag=5, smooth=False))
    ab2 = bm_box_mm((-0.35, -0.35, 3.935), (0.35, 0.35, 4.0), bevel=0.012, segs=1, smooth=False)
    for (cx, cy, cz, dep) in ((-0.35, -0.35, 3.97, 0.045), (0.35, 0.35, 4.0, 0.03), (0.35, -0.35, 3.94, 0.02)):
        n_ = V((-cx, -cy, -1.0 if cz > 3.99 else (0.8 if cz < 3.95 else 0.0))).normalized()
        clip_closed(ab2, -n_, -(n_.dot(V((cx, cy, cz))) + dep), 0, None, None, cap_tag=-2)
    parts.append(part_bm(ab2, 0, uv_box(), tint, tag=5, smooth=False))
    # black crust where rain never washes: under the echinus, abacus and tori
    def crust(co, n):
        k = 1.0 - 0.38 * smoothstep(-0.2, -0.8, n.z) * (0.6 + 0.4 * smoothstep(0.5, 3.6, co.z))
        return (k, k * 0.98, k * 0.95)
    shade_parts(parts, crust)
    # fresh (unweathered) chip faces
    for p in parts:
        tagl = p.faces.layers.int['tag']
        col = p.loops.layers.float_color['Col']
        uvl = p.loops.layers.uv['UVMap']
        for f in p.faces:
            if f[tagl] == -2:
                f[tagl] = 0
                c = f.calc_center_median()
                for lp in f.loops:
                    lp[col] = (0.97, 0.96, 0.93, 1.0)
                    lp[uvl].uv = uv_box()(lp.vert.co, f.normal, c, f)
    return parts


def build_column(P):
    parts = column_parts(1.0)
    mb = MB()
    for p in parts:
        mb.add(p.copy(), None, mats=[tx('marble')], tint='src', uvf='src', ftag='src')
    ob = finish(mb, 'Column', sharp=38)
    ao = bake_ao(ob, dist=0.45, samples=160, strength=0.9, ground=0.0)
    SOLIDS['Column'] = ao_lookup(ao)
    print('  Column: %d parts, volume %.4f' % (len(parts), parts_volume(parts)))


def build_column_fractured(P):
    """Drums split by slightly tilted breaks, most drums split again into
    wedges, a base stub and a capital piece: all cut from the Column's own
    (lighter-tessellated) parts, fresh marble on the breaks."""
    if 'Column' not in SOLIDS:
        build_column(P)                 # (--only: build the solid for its parts, drop it)
        o = bpy.data.objects['Column']
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    ao = SOLIDS['Column']
    parts = column_parts(0.67)
    rng = random.Random(311)
    empty('Column_Fractured')
    zs = [0.5, 1.1, 1.72, 2.33, 2.93, 3.46]
    planes = []
    for z in zs:
        a, b = math.radians(rng.uniform(3, 8)), rng.uniform(0, TAU)
        planes.append(cut_plane((math.sin(a) * math.cos(b), math.sin(a) * math.sin(b), math.cos(a)),
                                (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z)))
    cells = [(None, [planes[0]])]
    for k in range(5):
        (na, da), (nb, db) = planes[k], planes[k + 1]
        slab = [(-na, -da), (nb, db)]
        m = [3, 2, 3, 2, 3][k]
        c = V((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
        th0 = rng.uniform(0, TAU)
        if m == 2:
            tilt = rng.uniform(-0.25, 0.25)
            n, d = cut_plane((math.cos(th0), math.sin(th0), tilt), c + V((0, 0, (zs[k] + zs[k + 1]) / 2)))
            cells += [(None, slab + [(n, d)]), (None, slab + [(-n, -d)])]
        else:
            angs = [th0, th0 + TAU / 3 + rng.uniform(-0.3, 0.3), th0 + 2 * TAU / 3 + rng.uniform(-0.3, 0.3)]
            for i in range(3):
                a0, a1 = angs[i], angs[(i + 1) % 3]
                da_ = V((math.cos(a0), math.sin(a0), 0))
                db_ = V((math.cos(a1), math.sin(a1), 0))
                n1 = V((da_.y, -da_.x, 0))
                n2 = V((-db_.y, db_.x, 0))
                cells.append((None, slab + [(n1, n1.dot(c)), (n2, n2.dot(c))]))
    n5, d5 = planes[5]
    cells.append((None, [(-n5, -d5)]))
    info = []
    fresh = lambda co: (0.98, 0.97, 0.95)
    for (_, pl) in cells:
        mb = MB()
        got = False
        for p in parts:
            c = p.copy()
            for (nrm, d) in pl:
                clip_closed(c, nrm, d, 0, uv_box(), fresh)
                if not c.verts:
                    break
            if c.verts and c.faces:
                got = True
                mb.add(c, None, mats=[tx('marble')], tint='src', uvf='src', ftag='src')
            else:
                c.free()
        if got:
            cen, vol = bm_volume_centroid(mb.bm)
            info.append((mb, cen, vol))
    # keep the bottom-up order of the old template (base first, capital last)
    info.sort(key=lambda x: x[1].z)
    total, vmax = 0.0, 0
    for k, (mb, cen, vol) in enumerate(info):
        mb.decimate(CHUNK_TRIS)
        cen, vol = bm_volume_centroid(mb.bm)
        tagl = mb.bm.faces.layers.int.get('tag')

        def vfn(co, n, f, tagl=tagl):
            if f[tagl] < 0:
                return (1.0, 1.0, 1.0)
            a = ao(co)
            return (a, a, a)
        ob = finish(mb, 'Column_Chunk_%02d' % k, pivot=cen, parent='Column_Fractured', sharp=38, vfn=vfn)
        total += vol
        vmax = max(vmax, len(ob.data.vertices))
    print('  Column_Fractured: %d chunks, volume %.4f (solid parts %.4f), max verts %d' % (
        len(info), total, parts_volume(parts), vmax))


DRAWER_Z = [(0.185, 0.455), (0.495, 0.755), (0.795, 1.035)]


def drawers_parts():
    """Closed parts of the chest of drawers (0 = TX_oak, 1 = Brass, 2 = Ink):
    moulded top, framed side panels, back, drawer rails, plinth with a cove,
    bun feet, three lipped drawers with fielded fronts (the middle one pulled
    out, its box showing), knobs, backplates, escutcheons.  Tags: 1 top,
    2 sides, 3 back, 4 rails, 5 base, 6..8 drawers, 9 hardware."""
    rng = random.Random(4471)
    off = V((1.3, 8.2, 4.4))
    parts = []

    def tint(co):
        g = 1.0 - 0.08 * max(0.0, fbm(co * 3.0 + off, 2)) * 2.0
        return (1.0 * g, 0.95 * g, 0.9 * g)

    def add(bm, mi, uvf, tag, tnt=None, smooth=False):
        parts.append(part_bm(bm, mi, uvf, tnt or tint, tag=tag, smooth=smooth))
    uh = uv_box                                   # oak grain along U: horizontal members
    uvv = lambda **k: uv_box(grain='z', **k)       # vertical members
    # moulded top (ovolo edge), overhanging to the collider's footprint
    rings = [(0.012, 1.056), (0.006, 1.061), (0.001, 1.07), (0.0, 1.08), (0.0, 1.091), (0.004, 1.098),
             (0.009, 1.1)]
    secs = [rrect(0, 0, 0.5 - i_, 0.3 - i_, 0.012, z, n=2) for (i_, z) in rings]
    top = bm_loft(secs, smooth=False)
    add(top, 0, uh(off=(0.2, 0.1)), 1)
    # side panels: stiles and rails round a recessed panel
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.462, sx * 0.5))
        for (ya, yb, za, zb, grain) in ((-0.29, -0.23, 0.16, 1.056, 'z'), (0.22, 0.28, 0.16, 1.056, 'z'),
                                        (-0.23, 0.22, 0.16, 0.24, None), (-0.23, 0.22, 0.98, 1.056, None)):
            b_ = bm_box_mm((x0, ya, za), (x1, yb, zb), bevel=0.003, segs=1, smooth=False)
            add(b_, 0, uv_box(grain=grain, off=(rng.uniform(0, 1), 0)), 2)
        xa, xb = sorted((sx * 0.466, sx * 0.49))
        pn = bm_box_mm((xa, -0.232, 0.238), (xb, 0.222, 0.982), smooth=False)
        add(pn, 0, uv_box(grain='z', off=(rng.uniform(0, 1), 0)), 2,
            tnt=lambda co: tuple(c * 0.92 for c in tint(co)))
    back = bm_box_mm((-0.463, 0.262, 0.16), (0.463, 0.29, 1.056), smooth=False)
    add(back, 0, uvv(off=(0.3, 0)), 3, tnt=lambda co: tuple(c * 0.85 for c in tint(co)))
    # drawer rails (dividers) with a bead on the front edge (front rails only,
    # so the drawer pieces stay convex-ish when the chest breaks)
    for (za, zb) in ((0.16, 0.185), (0.455, 0.495), (0.755, 0.795), (1.035, 1.058)):
        rl = bm_box_mm((-0.463, -0.285, za), (0.463, -0.215, zb), smooth=False)
        add(rl, 0, uh(off=(0, rng.uniform(0, 1))), 4)
        bd = bm_tube_uv([(-0.462, -0.285, (za + zb) / 2), (0.462, -0.285, (za + zb) / 2)], 0.008, sides=5)
        parts.append(part_bm_keep(bd, 0, tint, tag=4))
    # plinth with a cove under the carcass, and turned bun feet
    base = bm_loft([rrect(0, 0, 0.485, 0.285, 0.008, 0.075, n=1), rrect(0, 0, 0.485, 0.285, 0.008, 0.13, n=1),
                    rrect(0, 0, 0.494, 0.294, 0.008, 0.142, n=1), rrect(0, 0, 0.502, 0.297, 0.008, 0.15, n=1),
                    rrect(0, 0, 0.502, 0.297, 0.008, 0.1595, n=1)], smooth=False)
    add(base, 0, uh(off=(0.5, 0.2)), 5, tnt=lambda co: tuple(c * 0.85 for c in tint(co)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            ft = bm_lathe([(0, 0), (0.03, 0), (0.042, 0.012), (0.047, 0.03), (0.044, 0.05), (0.035, 0.064),
                           (0.03, 0.07), (0.03, 0.08), (0, 0.08)], segs=8)
            add(move(ft, (0.41 * sx, 0.21 * sy, 0)), 0, uv_cyl(cx=0.41 * sx, cy=0.21 * sy, axial_u=True), 5,
                tnt=lambda co: tuple(c * 0.75 for c in tint(co)))
    # drawers
    for i, (z0, z1) in enumerate(DRAWER_Z):
        dy = -0.09 if i == 1 else 0.0
        yf = -0.293 + dy
        zm = (z0 + z1) / 2
        tg = 6 + i
        # lipped front: thin lip proud of the carcass, the body inside
        lip = bm_box_mm((-0.458, yf, z0 - 0.004), (0.458, yf + 0.012, z1 + 0.004), bevel=0.005, segs=1,
                        smooth=False)
        add(lip, 0, uh(off=(rng.uniform(0, 1), rng.uniform(0, 1))), tg)
        body = bm_box_mm((-0.444, yf + 0.011, z0 + 0.004), (0.444, yf + 0.026, z1 - 0.004), smooth=False)
        add(body, 0, uh(off=(rng.uniform(0, 1), 0)), tg)
        # fielded panel on the front
        e, fi = 0.03, 0.058
        r0 = [(-0.458 + e, z0 + e), (0.458 - e, z0 + e), (0.458 - e, z1 - e), (-0.458 + e, z1 - e)]
        r1 = [(-0.458 + fi, z0 + fi), (0.458 - fi, z0 + fi), (0.458 - fi, z1 - fi), (-0.458 + fi, z1 - fi)]
        pn = bm_loft([[V((x, yf + 0.004, z)) for (x, z) in r0], [V((x, yf - 0.004, z)) for (x, z) in r0],
                      [V((x, yf - 0.009, z)) for (x, z) in r1]], smooth=False)
        bmesh.ops.recalc_face_normals(pn, faces=pn.faces)
        add(pn, 0, uh(off=(rng.uniform(0, 1), rng.uniform(0, 1))), tg)
        if dy:                                           # the open drawer's box
            dark = lambda co: tuple(c * 0.45 for c in tint(co))
            for sx in (-1, 1):
                x0, x1 = sorted((sx * 0.436, sx * 0.448))
                sd = bm_box_mm((x0, yf + 0.024, z0 + 0.01), (x1, yf + 0.2, z1 - 0.03), smooth=False)
                add(sd, 0, uh(off=(0, 0.3)), tg, tnt=lambda co: tuple(c * 0.8 for c in tint(co)))
            bt = bm_box_mm((-0.436, yf + 0.024, z0 + 0.01), (0.436, yf + 0.2, z0 + 0.02), smooth=False)
            add(bt, 0, uh(off=(0.2, 0.7)), tg, tnt=dark)
        for kx in (-0.24, 0.24):
            kn = bm_lathe([(0, 0), (0.012, 0), (0.009, 0.012), (0.02, 0.022), (0.025, 0.033),
                           (0.021, 0.043), (0, 0.046)], segs=8)
            rot(kn, math.pi / 2, 'X')
            add(move(kn, (kx, yf - 0.008, zm)), 1, uv_box(), 9, tnt=lambda co: (1.0, 1.0, 1.0), smooth=True)
            pl = bm_lathe([(0, 0), (0.034, 0), (0.028, 0.004), (0, 0.004)], segs=8)
            scale(pl, (1.0, 1.35, 1.0))
            rot(pl, math.pi / 2, 'X')
            add(move(pl, (kx, yf - 0.006, zm)), 1, uv_box(), 9, tnt=lambda co: (0.85, 0.82, 0.75), smooth=True)
        esc = bm_lathe([(0, 0), (0.026, 0), (0.02, 0.004), (0, 0.004)], segs=8)
        scale(esc, (0.8, 1.4, 1.0))
        rot(esc, math.pi / 2, 'X')
        add(move(esc, (0, yf - 0.006, zm)), 1, uv_box(), 9, tnt=lambda co: (0.85, 0.82, 0.75), smooth=True)
        kh = bm_prism([(-0.004, -0.016), (0.004, -0.016), (0.0025, 0.0), (0.006, 0.006), (0.0, 0.011),
                       (-0.006, 0.006), (-0.0025, 0.0)], 0.0, 0.003)
        rot(kh, math.pi / 2, 'X')
        add(move(kh, (0, yf - 0.0085, zm)), 2, uv_box(), 9, tnt=lambda co: (1.0, 1.0, 1.0))
    return parts


def drawers_mats(P):
    return [tx('oak'), P['brass'], P['ink']]


def build_drawers(P):
    parts = drawers_parts()
    mb = MB()
    for p_ in parts:
        mb.add(p_.copy(), None, mats=drawers_mats(P), tint='src', uvf='src', ftag='src')

    def vfn(co, n, f):
        k = 1.0 - 0.1 * smoothstep(0.0, -1.0, n.z)
        return (k, k, k)
    ob = finish(mb, 'Drawers', sharp=40, vfn=vfn)
    ao = bake_ao(ob, dist=0.25, samples=128, strength=0.85, ground=0.0)
    SOLIDS['Drawers'] = (parts, ao_lookup(ao))


def build_drawers_fractured(P):
    """Boards split along plausible lines (top in three, each side and the back
    in two, the open drawer in two), cut from the Drawers' own parts; fresh
    pale wood on the breaks."""
    if 'Drawers' not in SOLIDS:
        build_drawers(P)                # (--only: build the solid for its parts, drop it)
        o = bpy.data.objects['Drawers']
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    parts, ao = SOLIDS['Drawers']
    wi = P['woodint']
    mats = drawers_mats(P) + [wi]
    empty('Drawers_Fractured')
    X = V((1, 0, 0))
    Y = V((0, 1, 0))
    Z = V((0, 0, 1))

    def pl(n, pt):
        return cut_plane(n, pt)

    def neg(p_):
        return (-p_[0], -p_[1])
    top = pl(-Z, (0, 0, 1.056))                 # keep z >= 1.056
    below_top = neg(top)
    # the side panels start at |x| = 0.462: cut just inside them, so no drawer
    # piece carries a paper-thin full-depth sliver of a side
    side_l = pl(X, (-0.4615, 0, 0))             # keep x <= -0.4615
    side_r = pl(-X, (0.4615, 0, 0))
    inner_l, inner_r = neg(side_l), neg(side_r)
    backp = pl(-Y, (0, 0.262, 0))
    front = neg(backp)
    base = pl(Z, (0, 0, 0.1598))                # between the plinth (top 0.1595) and the carcass (0.16)
    above_base = neg(base)
    cells = []
    t1 = pl((1, 0.45, 0.05), (0.12, 0, 1.08))
    t2 = pl((0, -1, 0.12), (0, -0.235, 1.08))
    cells += [[top, t1, neg(t2)], [top, neg(t1)], [top, t1, t2]]
    s1 = pl((0.05, -1, 0.06), (0, -0.2, 0.6))
    cells += [[below_top, above_base, side_l, s1], [below_top, above_base, side_l, neg(s1)]]
    s2 = pl((0, 0.35, 1), (0.48, 0, 0.62))
    cells += [[below_top, above_base, side_r, s2], [below_top, above_base, side_r, neg(s2)]]
    b1 = pl((1, 0, 0.5), (-0.05, 0.28, 0.6))
    cells += [[below_top, above_base, inner_l, inner_r, backp, b1], [below_top, above_base, inner_l, inner_r, backp, neg(b1)]]
    zc = [0.1598, 0.475, 0.775, 1.056]
    for i in range(3):
        lo = pl(-Z, (0, 0, zc[i]))
        hi = pl(Z, (0, 0, zc[i + 1]))
        c = [lo, hi, inner_l, inner_r, front]
        if i == 1:
            m1 = pl((1, 0.1, -0.7), (0.1, -0.28, 0.625))
            cells += [c + [m1], c + [neg(m1)]]
        else:
            cells.append(c)
    cells.append([base])
    fresh = lambda co: (0.95, 0.9, 0.82)
    info = []
    for pls in cells:
        mb = MB()
        got = False
        for p_ in parts:
            c = p_.copy()
            for (nrm, d) in pls:
                clip_closed(c, nrm, d, 3, uv_box(), fresh)
                if not c.verts:
                    break
            if c.verts and c.faces:
                got = True
                mb.add(c, None, mats=mats, tint='src', uvf='src', ftag='src')
            else:
                c.free()
        if got:
            cen, vol = bm_volume_centroid(mb.bm)
            info.append((mb, cen, vol))
    total, vmax = 0.0, 0
    for k, (mb, cen, vol) in enumerate(info):
        mb.decimate(CHUNK_TRIS)
        cen, vol = bm_volume_centroid(mb.bm)
        tagl = mb.bm.faces.layers.int.get('tag')

        def vfn(co, n, f, tagl=tagl):
            if f[tagl] < 0:
                return (1.0, 1.0, 1.0)
            a = ao(co)
            return (a, a, a)
        ob = finish(mb, 'Drawers_Chunk_%02d' % k, pivot=cen, parent='Drawers_Fractured', sharp=40, vfn=vfn)
        total += vol
        vmax = max(vmax, len(ob.data.vertices))
    print('  Drawers_Fractured: %d chunks, volume %.4f (solid parts %.4f), max verts %d' % (
        len(info), total, parts_volume(parts), vmax))


def block_uv(blocks, rng, org, axes, margin=True):
    """A planar metre mapping that lands a stone's face inside one ashlar block of
    the sandstone texture: org = the stone's centre, axes = (u_axis, v_axis)
    world vectors for faces facing along the third axis; other faces fall back
    to box projection about the same centre, in the same block."""
    r0, r1, jo = blocks[rng.randrange(len(blocks))]
    bu = jo + rng.randrange(2) + 0.5
    bv = (r0 + r1) / 2
    ua, va = V(axes[0]), V(axes[1])
    nrm = ua.cross(va).normalized()
    o = V(org)

    def f(co, n, c, face=None):
        if abs(n.dot(nrm)) > 0.6:
            d = co - o
            return (bu + d.dot(ua), bv + d.dot(va))
        u, v = uv_box(org=o)(co, n, c, face)
        return (bu + u * 0.9, bv + v * 0.9)
    return f


def build_arch(P):
    """Piazza arcade bay: ochre plaster over the piers and spandrels (TX_plaster,
    tinted), a ring of sandstone voussoirs with a proud keystone, moulded
    imposts, a sandstone base course and a moulded cornice (rail on top)."""
    rng = random.Random(2204)
    off = V((6.1, 3.3, 0.7))
    plaster, sst = tx('plaster'), tx('sandstone')
    mats = [plaster, sst]
    blocks = sandstone_blocks()
    Rr, zs, W, D = 1.2, 2.6, 2.0, 0.5
    parts = []

    def ochre(co):
        g = 1.0 - 0.08 * max(0.0, fbm(co * 0.9 + off, 3)) * 2.0
        base = 1.0 - 0.3 * (1.0 - smoothstep(0.3, 1.4, co.z))
        st = max(0.0, noise.noise(V((co.x * 2.6, co.y * 0.5, 0.3)) + off)) * smoothstep(3.2, 4.7, co.z)
        st2 = max(0.0, noise.noise(V((co.x * 3.1, 2.0, 0.3)) + off)) * smoothstep(2.62, 2.3, co.z) * smoothstep(1.4, 2.3, co.z)
        k = g * base * (1.0 - 0.28 * st - 0.2 * st2)
        return (1.0 * k, 0.71 * k, 0.4 * k)

    def stone_tint(co):
        g = 1.0 - 0.1 * max(0.0, fbm(co * 2.2 + off, 2)) * 2.0
        base = 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.5, co.z))
        return (g * base, g * base * 0.97, g * base * 0.93)
    # ---- plaster body: a slab minus the opening (subdivided for AO / grime)
    body = bm_box_mm((-W, -D, 0.35), (W, D, 4.74), smooth=False)
    grid_cut(body, 0, [-1.6, -1.2, -0.8, -0.4, 0.0, 0.4, 0.8, 1.2, 1.6])
    grid_cut(body, 2, [1.0, 1.7, 2.45, 3.1, 3.7, 4.25])
    op = [(-Rr, -0.2), (Rr, -0.2)]
    for k in range(25):
        a = math.pi * k / 24
        op.append((Rr * math.cos(a), zs + Rr * math.sin(a)))
    op = [(x, z) for (x, z) in op]
    cutter = prism_y(op, -0.7, 0.7)
    body = bool_diff(body, [cutter], name='arch body')
    parts.append(part_bm(body, 0, uv_box(), ochre, tag=1, smooth=False))
    # ---- base course: sandstone blocks along both piers (also round the inside)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (W + 0.015), sx * (Rr - 0.015)))
        for (za, zb) in ((0.0, 0.35),):
            b_ = bm_box_mm((x0, -D - 0.035, za), (x1, D + 0.035, zb), bevel=0.012, segs=1, smooth=False)
            parts.append(part_bm(b_, 1, block_uv(blocks, rng, ((x0 + x1) / 2, 0, (za + zb) / 2), ((1, 0, 0), (0, 0, 1))),
                                 stone_tint, tag=2, smooth=False))
        # moulded impost at the springing line: fillet + cyma, proud of the pier
        prof = [(-0.0, 2.44), (0.012, 2.44), (0.012, 2.47), (0.02, 2.48), (0.032, 2.5), (0.05, 2.54),
                (0.06, 2.575), (0.062, 2.6), (0.0, 2.6)]
        xa, xb = sorted((sx * (W + 0.02), sx * (Rr - 0.06)))
        sec = []
        for (dy, z) in prof:
            sec.append((dy, z))
        # loft a closed section (y, z) along x
        yz = [(-D - dy, z) for (dy, z) in sec] + [(D + dy, z) for (dy, z) in reversed(sec)]
        imp = bm_loft([[V((xa, y, z)) for (y, z) in yz], [V((xb, y, z)) for (y, z) in yz]], smooth=False)
        bmesh.ops.recalc_face_normals(imp, faces=imp.faces)
        parts.append(part_bm(imp, 1, block_uv(blocks, rng, ((xa + xb) / 2, 0, 2.52), ((1, 0, 0), (0, 0, 1))),
                             stone_tint, tag=3, smooth=False))
    # ---- voussoirs: 12 wedges + a proud keystone, joints of 7 mm
    NV = 13
    for k in range(NV):
        a0 = math.pi * k / NV
        a1 = math.pi * (k + 1) / NV
        key = (k == NV // 2)
        j = 0.0035 / Rr
        a0 += j
        a1 -= j
        r0 = Rr - 0.006
        r1 = Rr + (0.5 if key else 0.36 + 0.03 * (k % 2))
        yb = D + (0.05 if key else 0.022)
        pts = []
        for (a, r) in ((a0, r0), (a1, r0), (a1, r1), (a0, r1)):
            pts.append((r * math.cos(a), zs + r * math.sin(a)))
        if key:                       # the keystone flares
            (x0_, z0_), (x1_, z1_), (x2_, z2_), (x3_, z3_) = pts
            pts = [(x0_, z0_), (x1_, z1_), (x2_ - 0.04, z2_ + 0.02), (x3_ + 0.04, z3_ + 0.02)]
        vb = prism_y(pts, -yb, yb)
        bmesh.ops.bevel(vb, geom=list(vb.edges), offset=0.01, offset_type='OFFSET', segments=1,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
        cx_ = sum(p_[0] for p_ in pts) / 4
        cz_ = sum(p_[1] for p_ in pts) / 4
        am = (a0 + a1) / 2
        tangent = (-math.sin(am), 0, math.cos(am))
        radial = (math.cos(am), 0, math.sin(am))
        parts.append(part_bm(vb, 1, block_uv(blocks, rng, (cx_, 0, cz_), (tangent, radial)), stone_tint, tag=4,
                             smooth=False))
    # ---- cornice: frieze band + moulded crown (the rail runs along the top)
    prof = [(0.0, 4.72), (0.018, 4.72), (0.018, 4.78), (0.03, 4.8), (0.042, 4.83), (0.042, 4.86),
            (0.05, 4.88), (0.05, 4.93), (0.045, 4.96), (0.05, 4.98), (0.05, 5.0), (0.0, 5.0)]
    yz = [(-D - dy, z) for (dy, z) in prof] + [(D + dy, z) for (dy, z) in reversed(prof)]
    cor = bm_loft([[V((-W, y, z)) for (y, z) in yz], [V((W, y, z)) for (y, z) in yz]], smooth=False)
    bmesh.ops.recalc_face_normals(cor, faces=cor.faces)
    grid_cut(cor, 0, [-1.0, 0.0, 1.0])
    parts.append(part_bm(cor, 1, uv_box(off=(0.3, 0.1)), stone_tint, tag=5, smooth=False))
    mb = MB()
    for p_ in parts:
        mb.add(p_, None, mats=mats, tint='src', uvf='src', ftag='src')

    def vfn(co, n, f):
        k = 1.0 - 0.12 * smoothstep(0.0, -1.0, n.z)
        return (k, k, k)
    ob = finish(mb, 'Arch', sharp=40, vfn=vfn)
    bake_ao(ob, dist=0.6, samples=128, strength=0.85, ground=0.0)


def bark_tube(pts, radii, sides, twist=1.6, ridges=6, depth=0.14, seed=0.0, u0=0.0, gnarl=0.0):
    """A branch: a star-ish section (bark ridges) twisting along a smoothed
    path, with metre UVs (U along the grain, V around, following the twist)."""
    pts = [V(p) for p in pts]
    n = len(pts)
    T = []
    for i in range(n):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        T.append(d.normalized() if d.length > 1e-9 else V((0, 0, 1)))
    t0 = T[0]
    ref = V((0, 0, 1)) if abs(t0.z) < 0.9 else V((1, 0, 0))
    N = (ref - t0 * ref.dot(t0)).normalized()
    frames = []
    for t in T:
        N = N - t * N.dot(t)
        if N.length < 1e-9:
            N = t.orthogonal()
        N.normalize()
        frames.append((N.copy(), t.cross(N)))
    sarc = [0.0]
    for i in range(1, n):
        sarc.append(sarc[-1] + (pts[i] - pts[i - 1]).length)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rings = []
    for i, p in enumerate(pts):
        r = radii[i]
        Nf, Bf = frames[i]
        if r <= 1e-6:
            rings.append([(bm.verts.new(p), 0.0)])
            continue
        ring = []
        for j in range(sides):
            th = TAU * j / sides
            ph = th + twist * sarc[i]
            rr = r * (1.0 + depth * math.cos(ridges * ph + seed) * (0.6 + 0.4 * math.cos(3 * ph + seed * 2)))
            rr *= 1.0 + 0.05 * noise.noise(V((math.cos(th) * 2, math.sin(th) * 2, sarc[i] * 3 + seed)))
            if gnarl:
                bump = noise.noise(V((math.cos(th) * 1.2, math.sin(th) * 1.2, sarc[i] * 2.2 + seed * 3)))
                rr *= 1.0 + gnarl * max(0.0, bump) * 1.6 - gnarl * 0.3 * max(0.0, -bump)
            ring.append((bm.verts.new(p + Nf * (rr * math.cos(th)) + Bf * (rr * math.sin(th))), th))
        rings.append(ring)
    for i in range(n - 1):
        a_, b_ = rings[i], rings[i + 1]
        for j in range(sides):
            j2 = (j + 1) % sides
            if len(b_) == 1:
                vs = [a_[j], a_[j2], b_[0]]
            elif len(a_) == 1:
                vs = [a_[0], b_[j2], b_[j]]
            else:
                vs = [a_[j], a_[j2], b_[j2], b_[j]]
            try:
                f = bm.faces.new([v for v, _ in vs])
            except ValueError:
                continue
            for lp, (v, th) in zip(f.loops, vs):
                ii = i if (v in [q for q, _ in a_]) else i + 1
                rr = max(radii[ii], 1e-3)
                jj = th
                if j2 == 0 and th == 0.0 and len(a_) > 1 and v in [a_[0][0]] + ([b_[0][0]] if len(b_) > 1 else []):
                    jj = TAU
                lp[uvl].uv = (sarc[ii] + u0, rr * (jj + twist * sarc[ii]))
    if len(rings[0]) > 1:
        f = bm.faces.new([v for v, _ in reversed(rings[0])])
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x, lp.vert.co.y)
    if len(rings[-1]) > 1:
        f = bm.faces.new([v for v, _ in rings[-1]])
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x, lp.vert.co.y)
    set_smooth(bm, True)
    return bm


def catmull(pts, k=2):
    """Subdivide a polyline k times with Catmull-Rom (keeps the end points)."""
    for _ in range(k):
        ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
        out = []
        for i in range(len(pts) - 1):
            p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
            out.append(p1)
            out.append((-p0 + 9 * p1 + 9 * p2 - p3) / 16)
        out.append(pts[-1])
        pts = out
    return pts


def build_dead_tree(P):
    """A dead Dali olive: space-colonisation crown, pipe-model radii, twisted
    ridged bark (TX_oak, grain along each branch), buttress roots, a couple of
    broken stubs, and the long horizontal branch the melting clock hangs on
    (level.js clockGrove: ~(1.7, 0, 2.15..2.25), kept clear of other wood)."""
    rng = random.Random(1931)
    off = V((4.4, 1.7, 3.3))
    wood = tx('oak')
    # ---- trunk: a leaning S with a fork at ~2 m
    trunk = [V((0, 0, -0.06)), V((0.03, 0.02, 0.35)), V((-0.05, 0.05, 0.75)), V((0.04, -0.02, 1.1)),
             V((0.1, 0.0, 1.45)), V((0.06, 0.03, 1.75)), V((0.02, 0.0, 2.02))]
    nodes = [p.copy() for p in trunk]
    parent = [-1] + list(range(len(trunk) - 1))
    # ---- the clock branch (hand placed; everything else grows around it)
    clock = [V((0.02, 0.0, 2.02)), V((0.3, -0.02, 2.13)), V((0.62, 0.03, 2.22)), V((0.98, 0.0, 2.27)),
             V((1.34, -0.04, 2.28)), V((1.7, 0.0, 2.25)), V((1.92, 0.02, 2.19)), V((2.08, 0.03, 2.12))]
    # ---- space colonisation for the rest of the crown
    att = []
    while len(att) < 420:
        p = V((rng.uniform(-1.3, 1.3), rng.uniform(-0.75, 0.75), rng.uniform(1.3, 3.3)))
        e1 = ((p.x + 0.35) / 0.95) ** 2 + (p.y / 0.62) ** 2 + ((p.z - 2.55) / 0.72) ** 2
        e2 = ((p.x - 0.35) / 0.55) ** 2 + (p.y / 0.5) ** 2 + ((p.z - 2.85) / 0.4) ** 2
        if min(e1, e2) > 1.0:
            continue
        if 1.05 < p.x and abs(p.y) < 0.7 and 1.6 < p.z < 2.9:      # the clock's room
            continue
        att.append(p)
    D, R_inf, R_kill = 0.085, 0.55, 0.13
    for it in range(80):
        if not att:
            break
        kd = KDTree(len(nodes))
        for i, p in enumerate(nodes):
            kd.insert(p, i)
        kd.balance()
        pull = {}
        for a in att:
            co, i, d = kd.find(a)
            if d < R_inf and (i >= 4):
                pull.setdefault(i, []).append((a - nodes[i]).normalized())
        if not pull:
            break
        for i, dirs in sorted(pull.items()):
            d = sum(dirs, V((0, 0, 0)))
            if d.length < 1e-6:
                continue
            d = d.normalized()
            d = (d + V((0, 0, 0.12)) + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.35).normalized()
            q = nodes[i] + d * D
            nodes.append(q)
            parent.append(i)
        kd = KDTree(len(nodes))
        for i, p in enumerate(nodes):
            kd.insert(p, i)
        kd.balance()
        att = [a for a in att if kd.find(a)[2] > R_kill]
    n = len(nodes)
    kids = [[] for _ in range(n)]
    for i, pi in enumerate(parent):
        if pi >= 0:
            kids[pi].append(i)
    # pipe model radii
    rad = [0.0] * n
    for i in reversed(range(n)):
        if not kids[i]:
            rad[i] = 0.011
        else:
            rad[i] = sum(rad[k] ** 2.4 for k in kids[i]) ** (1 / 2.4)
    for i in range(len(trunk)):
        rad[i] = max(rad[i], lerp(0.19, 0.11, i / (len(trunk) - 1)))
    # relax the colonisation zig-zag along each limb (the hand-placed trunk
    # stays put; done on the nodes so every joint stays shared)
    for _ in range(2):
        sm = [p.copy() for p in nodes]
        for i in range(len(trunk), n):
            if kids[i]:
                k = max(kids[i], key=lambda k: rad[k])
                sm[i] = (nodes[parent[i]] + nodes[i] * 2.0 + nodes[k]) * 0.25
        nodes = sm
    # chains: follow the thickest child, other children start new chains
    chains = []
    stack = [0]
    while stack:
        i = stack.pop()
        chain = [parent[i]] if parent[i] >= 0 else []
        chain.append(i)
        while kids[i]:
            ks = sorted(kids[i], key=lambda k: -rad[k])
            stack.extend(ks[1:])
            i = ks[0]
            chain.append(i)
        chains.append(chain)
    parts = []
    tris_est = 0
    cp = catmull(clock, 1)

    def in_clock_branch(p):
        # twigs that grew along the clock branch end up buried in it
        for a, b in zip(cp, cp[1:]):
            ab = b - a
            t = clamp((p - a).dot(ab) / ab.length_squared, 0.0, 1.0)
            if (a + ab * t - p).length < 0.1:
                return True
        return False
    for ci, ch in enumerate(chains):
        pts = [nodes[i] for i in ch]
        rs = [rad[i] for i in ch]
        L = sum((pts[k + 1] - pts[k]).length for k in range(len(pts) - 1))
        if L < 0.22 and rs[0] < 0.03:
            continue
        if ci and sum(in_clock_branch(p) for p in pts[1:]) * 2 >= len(pts) - 1:
            continue
        # gnarl: wobble the joints a little, pull the start into the parent
        pts = [p + V((noise.noise(p * 3.0 + off), noise.noise(p * 3.0 + off + V((5, 0, 0))),
                      noise.noise(p * 3.0 + off + V((0, 9, 0))))) * min(0.03, rs[k] * 0.5)
               if 0 < k else p for k, p in enumerate(pts)]
        # rings where they are needed: spacing grows with the branch radius
        # (the colonisation nodes are 8.5 cm apart all the way up)
        keep_p, keep_r = [pts[0]], [rs[0]]
        for q, r in zip(pts[1:-1], rs[1:-1]):
            if (q - keep_p[-1]).length >= clamp(2.6 * r, 0.1, 0.24):
                keep_p.append(q)
                keep_r.append(r)
        keep_p.append(pts[-1])
        keep_r.append(rs[-1])
        pts, rs = keep_p, keep_r
        rs = [max(0.005, r) for r in rs]
        rs[-1] *= 0.55                                      # taper the tip
        sides = 10 if rs[0] > 0.09 else (6 if rs[0] > 0.035 else 3)
        tb = bark_tube(pts, rs, sides, twist=1.4 + rng.uniform(-0.3, 0.3), ridges=5 if sides == 10 else 3,
                       depth=0.2 if sides == 10 else (0.12 if sides >= 6 else 0.0), seed=rng.uniform(0, 9),
                       u0=rng.uniform(0, 3), gnarl=0.12 if sides == 10 else 0.0)
        parts.append(tb)
        tris_est += len(tb.faces) * 2
    # ---- the clock branch
    crs = [lerp(0.1, 0.03, (k / (len(cp) - 1)) ** 0.8) for k in range(len(cp))]
    crs[-1] = 0.024
    parts.append(bark_tube(cp, crs, 7, twist=1.1, ridges=3, depth=0.12, seed=2.0))
    # a broken-off stub on the clock branch and one on the trunk
    for (p0, d, r, L) in ((V((0.8, 0.0, 2.25)), V((0.2, -0.5, 0.6)), 0.03, 0.22),
                          (V((0.07, 0.0, 1.25)), V((0.9, 0.4, 0.3)), 0.05, 0.2)):
        d = d.normalized()
        sp = [p0 - d * 0.03, p0 + d * (L * 0.5), p0 + d * L]
        parts.append(bark_tube(sp, [r, r * 0.9, r * 0.82], 5, twist=0.8, ridges=2, depth=0.1, seed=4.0))
    # ---- buttress roots, flaring into the ground
    for k in range(6):
        a = TAU * k / 6 + 0.4 + rng.uniform(-0.25, 0.25)
        L = rng.uniform(0.38, 0.62)
        c_, s_ = math.cos(a), math.sin(a)
        rp = [V((c_ * 0.04, s_ * 0.04, 0.5)), V((c_ * 0.15, s_ * 0.15, 0.2)), V((c_ * L * 0.55, s_ * L * 0.55, 0.05)),
              V((c_ * L, s_ * L, -0.06)), V((c_ * (L + 0.12), s_ * (L + 0.12), -0.2))]
        rp = catmull(rp, 1)
        rr = [0.1, 0.1, 0.09, 0.075, 0.06, 0.05, 0.042, 0.036, 0.03]
        parts.append(bark_tube(rp, rr[:len(rp)], 6, twist=0.6, ridges=3, depth=0.12, seed=k * 1.3, gnarl=0.1))
    mb = MB()

    def tint(co):
        g = 1.0 - 0.12 * max(0.0, fbm(co * 2.0 + off, 3)) * 2.0
        grey_ = 0.35 * smoothstep(1.6, 3.0, co.z)          # sun-bleached up top
        c = mix3((0.92, 0.86, 0.8), (1.0, 0.98, 0.95), grey_)
        k = g * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.5, co.z)))
        return (c[0] * k, c[1] * k, c[2] * k)
    for tb in parts:
        tb.normal_update()
        mb.add(part_bm_keep(tb, 0, tint, tag=1), None, mats=[wood], tint='src', uvf='src', ftag='src')
    ob = finish(mb, 'DeadTree', sharp=None)
    bake_ao(ob, dist=0.5, samples=128, strength=0.9, ground=0.0)
    print('  DeadTree: %d nodes, %d branches' % (n, len(parts)))


def casing_sweep(sec, xo, zt, y_back, sgn):
    """A door architrave: a closed moulding section swept up the left jamb,
    across the head and down the right jamb with mitred top corners.  sec:
    [(u, v)], u inward from the outer edge, v away from the frame face
    (sgn = -1 front, +1 back)."""
    bm = bmesh.new()
    corners = [(-xo, 0.0, 1, 0), (-xo, zt, 1, -1), (xo, zt, -1, -1), (xo, 0.0, -1, 0)]
    rings = []
    for (x, z, dx, dz) in corners:
        rings.append([bm.verts.new((x + dx * u, y_back + sgn * v, z + dz * u if dz else z)) for (u, v) in sec])
    m = len(sec)
    for i in range(3):
        a_, b_ = rings[i], rings[i + 1]
        for j in range(m):
            j2 = (j + 1) % m
            bm.faces.new([a_[j], a_[j2], b_[j2], b_[j]])
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[3])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build_door(P):
    """The exit: a freestanding door in a moulded stucco architrave (mitred
    casings on both faces, plinth blocks), a marble sill; the leaf is painted
    wood (stiles, rails and raised panels, grain following each member) on
    iron strap hinges whose knuckles sit on the Door_Leaf pivot, brass knobs
    and escutcheons.  Door_Leaf / Door_Light names and pivots are unchanged."""
    rng = random.Random(3321)
    off = V((2.7, 5.1, 3.3))
    stucco, marble, iron, paint = tx('stucco'), tx('marble'), tx('iron'), tx('wood')
    brass = P['brass']
    light = material('DoorLight', '#fff0c0', 0.0, 1.0, emit='#ffd98c', strength=4.0)

    def cream(co):
        g = 1.0 - 0.07 * max(0.0, fbm(co * 2.0 + off, 2)) * 2.0
        g *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.5, co.z))
        return (1.0 * g, 0.94 * g, 0.82 * g)
    mb = MB()
    mats = [stucco, marble, iron]
    # frame core (open at the bottom), with the door stop behind the leaf
    core = bm_prism([(-0.65, 0.0), (-0.55, 0.0), (-0.55, 2.4), (0.55, 2.4), (0.55, 0.0), (0.65, 0.0),
                     (0.65, 2.5), (-0.65, 2.5)], -0.11, 0.11)
    xform(core, Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    bmesh.ops.reverse_faces(core, faces=core.faces)
    grid_cut(core, 2, [0.6, 1.2, 1.8])
    mb.add(part_bm(core, 0, uv_box(), cream, tag=1, smooth=False), None, mats=mats, tint='src', uvf='src', ftag='src')
    for (x0, x1, z0, z1) in ((-0.55, -0.535, 0.02, 2.385), (0.535, 0.55, 0.02, 2.385), (-0.55, 0.55, 2.385, 2.4)):
        st = bm_box_mm((x0, 0.022, z0), (x1, 0.05, z1), smooth=False)
        mb.add(part_bm(st, 0, uv_box(), cream, tag=1, smooth=False), None, mats=mats, tint='src', uvf='src', ftag='src')
    # moulded architraves on both faces: fillet, ogee, bead
    sec = [(0.0, 0.0), (0.0, 0.009), (0.006, 0.012), (0.014, 0.012), (0.02, 0.015), (0.032, 0.015),
           (0.05, 0.011), (0.068, 0.008), (0.08, 0.009), (0.088, 0.012), (0.094, 0.009), (0.1, 0.004),
           (0.1, 0.0)]
    for sgn in (-1, 1):
        cs = casing_sweep(sec, 0.65, 2.5, sgn * 0.11, sgn)
        mb.add(part_bm(cs, 0, uv_box(), cream, tag=2, smooth=False), None, mats=mats, tint='src', uvf='src',
               ftag='src')
        for sx in (-1, 1):                                  # plinth blocks
            x0, x1 = sorted((sx * 0.542, sx * 0.662))
            pb = bm_box_mm((x0, -0.132, 0.0), (x1, 0.132, 0.22), bevel=0.006, segs=1, smooth=False)
            mb.add(part_bm(pb, 1, uv_box(off=(sx * 0.7, 0.3)), lambda co: (0.9, 0.89, 0.86), tag=2, smooth=False),
                   None, mats=mats, tint='src', uvf='src', ftag='src')
    # marble sill with a rounded nose
    prof = [(0.12, 0.0), (0.12, 0.022), (-0.12, 0.022), (-0.132, 0.019), (-0.138, 0.011), (-0.135, 0.004),
            (-0.13, 0.0)]
    yz = [(y, z) for (y, z) in prof]
    sill = bm_loft([[V((-0.55, y, z)) for (y, z) in yz], [V((0.55, y, z)) for (y, z) in yz]], smooth=False)
    bmesh.ops.recalc_face_normals(sill, faces=sill.faces)
    mb.add(part_bm(sill, 1, uv_box(off=(0.4, 0.2)), lambda co: (0.86, 0.85, 0.83), tag=3, smooth=False), None,
           mats=mats, tint='src', uvf='src', ftag='src')
    # iron pintles on the frame for the leaf's knuckles
    hinge = V((-0.55, -0.03, 0.0))
    ZH = (0.12, 0.8, 2.32)
    for z in ZH:
        pin = bm_lathe([(0.0, z - 0.1), (0.011, z - 0.1), (0.011, z - 0.06), (0.0, z - 0.06)], segs=10)
        mb.add(part_bm(move(pin, (hinge.x, hinge.y, 0)), 2, uv_cyl(cx=hinge.x, cy=hinge.y), (0.9, 0.9, 0.9),
                       tag=4), None, mats=mats, tint='src', uvf='src', ftag='src')
        plate = bm_box_mm((-0.585, -0.126, z - 0.1), (-0.555, -0.112, z - 0.05), bevel=0.003, segs=1, smooth=False)
        mb.add(part_bm(plate, 2, uv_box(), (0.85, 0.85, 0.85), tag=4, smooth=False), None, mats=mats, tint='src',
               uvf='src', ftag='src')
    ob = finish(mb, 'Door', sharp=40)
    bake_ao(ob, dist=0.3, samples=128, strength=0.85, ground=0.0)

    # ---- the leaf: stiles, rails, muntin, six raised panels per face
    lb = MB()
    lmats = [paint, iron, brass]
    y0, y1 = -0.03, 0.02
    Z0, Z1 = 0.023, 2.382

    def paint_tint(co):
        g = 1.0 - 0.08 * max(0.0, fbm(co * 2.5 + off, 2)) * 2.0
        g *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.45, co.z))
        hand = 0.18 * smoothstep(0.2, 0.0, math.hypot(co.x - 0.44, co.z - 1.02))
        return (g * (1 - hand), g * (1 - hand), g * (1 - hand * 1.2))
    SX = [(-0.546, -0.426), (-0.03, 0.03), (0.426, 0.546)]            # stiles + muntin
    RZ = [(0.023, 0.2), (0.72, 0.84), (1.5, 1.62), (2.26, 2.382)]      # rails
    for (xa, xb) in SX:
        za, zb = (Z0, Z1) if abs(xa) > 0.1 else (0.2, 2.26)
        st = bm_box_mm((xa, y0, za), (xb, y1, zb), bevel=0.004, segs=1, smooth=False)
        lb.add(part_bm(st, 0, uv_box(off=(rng.uniform(0, 1), 0)), paint_tint, tag=1, smooth=False), None,
               mats=lmats, tint='src', uvf='src', ftag='src')
    for (za, zb) in RZ:
        rl = bm_box_mm((-0.426, y0, za), (0.426, y1, zb), bevel=0.004, segs=1, smooth=False)
        lb.add(part_bm(rl, 0, uv_box(grain='z', off=(0, rng.uniform(0, 1))), paint_tint, tag=1, smooth=False),
               None, mats=lmats, tint='src', uvf='src', ftag='src')
    cols = [(-0.426, -0.03), (0.03, 0.426)]
    rows = [(0.2, 0.72), (0.84, 1.5), (1.62, 2.26)]
    for (xa, xb) in cols:
        for (za, zb) in rows:
            # raised field on each face: flat centre, bevel down to the recess
            for (yr, yf, sgn) in ((y0 + 0.012, y0 + 0.002, -1), (y1 - 0.012, y1 - 0.002, 1)):
                e, fi = 0.004, 0.05
                ring0 = [(xa + e, za + e), (xb - e, za + e), (xb - e, zb - e), (xa + e, zb - e)]
                ring1 = [(xa + fi, za + fi), (xb - fi, za + fi), (xb - fi, zb - fi), (xa + fi, zb - fi)]
                ym = (y0 + y1) / 2
                secs = [[V((x, ym, z)) for (x, z) in ring0], [V((x, yr, z)) for (x, z) in ring0],
                        [V((x, yf, z)) for (x, z) in ring1]]
                pn = bm_loft(secs, smooth=False)
                bmesh.ops.recalc_face_normals(pn, faces=pn.faces)
                lb.add(part_bm(pn, 0, uv_box(off=(rng.uniform(0, 1.5), 0)), paint_tint, tag=2, smooth=False),
                       None, mats=lmats, tint='src', uvf='src', ftag='src')
    # iron strap hinges on the front face, knuckles on the hinge line
    def iron_tint(co):
        return (0.9, 0.9, 0.9)
    for z in ZH:
        pts = []
        L = 0.46
        for k in range(9):
            t = k / 8
            w = lerp(0.028, 0.017, t) + (0.012 * math.sin(math.pi * (t - 0.85) / 0.15) if t > 0.85 else 0.0)
            pts.append((hinge.x + 0.012 + L * t, w))
        outline = [(x, z - w) for (x, w) in pts] + [(x, z + w) for (x, w) in reversed(pts)]
        sp = prism_y(outline, y0 - 0.005, y0 + 0.001)
        lb.add(part_bm(sp, 1, uv_box(), iron_tint, tag=3, smooth=False), None, mats=lmats, tint='src', uvf='src',
               ftag='src')
        for k in (2, 5, 7):                             # nail heads
            x = pts[k][0]
            nl = bm_ico(0.0065, 1, center=(x, y0 - 0.005, z), sc=(1, 0.55, 1))
            lb.add(part_bm(nl, 1, uv_box(), (0.8, 0.8, 0.8), tag=3, smooth=True), None, mats=lmats, tint='src',
                   uvf='src', ftag='src')
        kn = bm_lathe([(0.0, z - 0.055), (0.013, z - 0.055), (0.014, z - 0.05), (0.014, z + 0.05),
                       (0.013, z + 0.055), (0.0, z + 0.055)], segs=12)
        lb.add(part_bm(move(kn, (hinge.x, hinge.y, 0)), 1, uv_cyl(cx=hinge.x, cy=hinge.y), iron_tint, tag=3),
               None, mats=lmats, tint='src', uvf='src', ftag='src')
    # brass knobs with rosettes, escutcheons with keyholes
    for (yy, sgn) in ((y0, -1), (y1, 1)):
        kn = bm_lathe([(0, 0), (0.012, 0), (0.008, 0.015), (0.018, 0.03), (0.028, 0.045),
                       (0.025, 0.058), (0, 0.062)], segs=20)
        rot(kn, -sgn * math.pi / 2, 'X')
        lb.add(part_bm(move(kn, (0.44, yy, 1.02)), 2, uv_box(), (1.0, 1.0, 1.0), tag=4), None, mats=lmats,
               tint='src', uvf='src', ftag='src')
        ro = bm_lathe([(0, 0), (0.034, 0), (0.034, 0.003), (0.026, 0.007), (0.0, 0.008)], segs=20)
        rot(ro, -sgn * math.pi / 2, 'X')
        lb.add(part_bm(move(ro, (0.44, yy, 1.02)), 2, uv_box(), (0.9, 0.88, 0.8), tag=4), None, mats=lmats,
               tint='src', uvf='src', ftag='src')
        esc = bm_box_mm((0.425, yy - 0.004 if sgn < 0 else yy, 0.9), (0.455, yy if sgn < 0 else yy + 0.004, 0.97),
                        bevel=0.003, smooth=False)
        lb.add(part_bm(esc, 2, uv_box(), (0.85, 0.82, 0.75), tag=4, smooth=False), None, mats=lmats, tint='src',
               uvf='src', ftag='src')
        kh = bm_prism([(-0.003, -0.012), (0.003, -0.012), (0.002, 0.0), (0.005, 0.005), (0.0, 0.009),
                       (-0.005, 0.005), (-0.002, 0.0)], 0.0, 0.002)
        rot(kh, math.pi / 2, 'X')
        lb.add(part_bm(move(kh, (0.44, yy + sgn * 0.0045 - (0.002 if sgn > 0 else 0.0), 0.935)), 1, uv_box(),
                       (0.2, 0.2, 0.2), tag=4, smooth=False), None, mats=lmats, tint='src', uvf='src', ftag='src')
    lob = finish(lb, 'Door_Leaf', pivot=hinge, parent='Door', sharp=40)
    bake_ao(lob, dist=0.15, samples=96, strength=0.8)
    gl = MB()
    pl = bm_grid(1, 1, -0.549, 0.549, 0.02, 2.385)
    rot(pl, math.pi / 2, 'X')
    move(pl, (0, 0.06, 0))
    gl.add(pl, light)
    finish(gl, 'Door_Light', pivot=(0, 0.06, 1.2025), parent='Door', sharp=None)


def smooth_profile(pts, n=40):
    """Catmull-Rom resample of a (r, z) polyline to n points."""
    pts = [V((p[0], p[1], 0)) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    segs = len(pts) - 1
    out = []
    for i in range(n):
        s = i / (n - 1) * segs
        k = min(int(s), segs - 1)
        t = s - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                   (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
        out.append((max(0.0, q.x) if 0 < i < n - 1 else 0.0, q.y))
    return out


def poly_clip_line(poly, nx, ny, d):
    """Keep the part of a convex 2D polygon with nx*x + ny*y <= d."""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        sa, sb = nx * a[0] + ny * a[1] - d, nx * b[0] + ny * b[1] - d
        if sa <= 0:
            out.append(a)
        if (sa < 0 < sb) or (sb < 0 < sa):
            t = sa / (sa - sb)
            out.append((lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
    return out


def convex_hull2(pts):
    pts = sorted(set((round(x, 6), round(y, 6)) for x, y in pts))
    if len(pts) < 3:
        return pts

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p_ in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p_) <= 0:
            lo.pop()
        lo.append(p_)
    for p_ in reversed(pts):
        while len(hi) >= 2 and cr(hi[-2], hi[-1], p_) <= 0:
            hi.pop()
        hi.append(p_)
    return lo[:-1] + hi[:-1]


def slab_prism(poly_b, poly_t, z0, z1):
    """Closed prism between two matching CCW outlines (bottom at z0, top at z1)."""
    return bm_loft([[V((x, y, z0)) for (x, y) in poly_b], [V((x, y, z1)) for (x, y) in poly_t]], smooth=False)


def remesh_decimate(bm, voxel, tris, disp=None):
    """Voxel-remesh a (possibly overlapping) set of closed shells into one
    manifold mass, optionally displace it (disp(co, n) -> new co), then
    collapse-decimate to about `tris` triangles."""
    me = bpy.data.meshes.new('_rm')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('_rm', me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('rm', 'REMESH')
    md.mode = 'VOXEL'
    md.voxel_size = voxel
    md.adaptivity = 0.0
    md.use_smooth_shade = False
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.meshes.remove(me2)
    if disp:
        displace(out, disp)
    bmesh.ops.triangulate(out, faces=out.faces)
    n0 = len(out.faces)
    me = bpy.data.meshes.new('_dc')
    out.to_mesh(me)
    out.free()
    ob = bpy.data.objects.new('_dc', me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('dc', 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = min(1.0, tris / max(1, n0))
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.meshes.remove(me2)
    return out


def build_rock(P, name, prof, seed, dims, lean=0.0, dip=0.35, joints=1, nlay=(0.14, 0.34), tris=1440):
    """A boulder of Cap de Creus schist.  Strata plates (hard beds stand proud,
    soft ones are eaten back, outlines drifting smoothly bed to bed) with the
    bedding dipping into the ground, cut by joint planes: voxel-merged into one
    mass, roughened (grooves along the bedding, pitting), decimated.  UVs are
    projected in the bedding frame so the texture's foliation follows the beds.
    Scaled to dims (the old bounding box), silhouette from prof [(r, z)]."""
    rng = random.Random(seed)
    off = V((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    sm = smooth_profile(prof, 40)
    H = max(z for _, z in sm)

    def rad(z):
        best = None
        for i in range(len(sm) - 1):
            (r0, z0), (r1, z1) = sm[i], sm[i + 1]
            if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-9:
                r = lerp(r0, r1, (z - z0) / (z1 - z0))
                best = r if best is None else max(best, r)
        return best if best is not None else 0.05
    a1, a2 = rng.uniform(0, TAU), rng.uniform(0, TAU)
    dip_az = rng.uniform(0, TAU)
    Rt = Matrix.Rotation(dip, 3, V((math.cos(dip_az), math.sin(dip_az), 0.0)))
    Ln = Rt @ V((0, 0, 1))
    beds = []
    z = -0.7
    while z < H + 0.05:
        t = rng.uniform(*nlay)
        beds.append((z, min(z + t, H + 0.3), rng.random()))
        z += t
    shell = bmesh.new()
    for (za, zb, hard) in beds:
        zm = clamp((za + zb) / 2, 0.0, H)
        r = rad(zm)
        rec = 1.0 + 0.1 * (hard - 0.5) * 2.0
        R = max(0.12, r * rec)
        n = 16
        poly = []
        for i in range(n):
            th = TAU * i / n
            w = noise.noise(V((math.cos(th) * 1.3, math.sin(th) * 1.3, zm * 1.6)) + off)
            rr = R * (1 + 0.13 * math.cos(th - a1) + 0.08 * math.cos(2 * th - a2) + 0.12 * w)
            poly.append((rr * math.cos(th) + lean * zm, rr * math.sin(th)))
        poly = convex_hull2(poly)
        for _ in range(rng.choice((0, 1, 1, 2))):          # broken bed edges
            ang = rng.uniform(0, TAU)
            nx, ny = math.cos(ang), math.sin(ang)
            cx_ = sum(p_[0] for p_ in poly) / len(poly)
            cy_ = sum(p_[1] for p_ in poly) / len(poly)
            ext = max(nx * (p_[0] - cx_) + ny * (p_[1] - cy_) for p_ in poly)
            poly = poly_clip_line(poly, nx, ny, nx * cx_ + ny * cy_ + ext * rng.uniform(0.7, 0.92))
        k = rng.uniform(0.9, 0.97)
        cx_ = sum(p_[0] for p_ in poly) / len(poly)
        cy_ = sum(p_[1] for p_ in poly) / len(poly)
        top = [(cx_ + (x - cx_) * k, cy_ + (y - cy_) * k) for (x, y) in poly]
        sl = slab_prism(poly, top, za - 0.01, zb + 0.01)
        xform(sl, Rt.to_4x4())
        bm_append(shell, sl)
        sl.free()
    # joint planes: clean breaks through the whole stack, then the ground
    cx0 = lean * H * 0.5
    cuts = []
    for j in range(joints):
        ang = rng.uniform(0, TAU)
        nrm = V((math.cos(ang), math.sin(ang), rng.uniform(-0.25, 0.35))).normalized()
        dist = rad(H * 0.5) * rng.uniform(0.55, 0.75)
        cuts.append((nrm, nrm.dot(V((cx0, 0, H * 0.5))) + dist))
    cuts.append((V((0, 0, -1)), 0.02))
    isl = bm_split_islands(shell)
    shell.free()
    shell = bmesh.new()
    for c in isl:
        for (nrm, d) in cuts:
            clip_closed(c, nrm, d, 0)
        if c.verts:
            bm_append(shell, c)
        c.free()

    def rough(co, n):
        s_ = co.dot(Ln)
        lam = 0.012 * math.sin(s_ * TAU / 0.085 + 2.0 * noise.noise(co * 1.5 + off))
        pit = -0.03 * max(0.0, noise.noise(co * 3.2 + off * 0.3) - 0.25)
        g = 0.035 * fbm(co * 1.1 + off, 3)
        side = 1.0 - abs(n.dot(Ln))
        return co + n * (g + side * lam + pit)
    body = remesh_decimate(shell, 0.035, tris, disp=rough)
    # flat base on the ground
    for v in body.verts:
        if v.co.z < 0.035:
            v.co.z = 0.0
    # fit the old bounding box, centred in x/y, standing on z = 0
    xs = [v.co.x for v in body.verts]
    ys = [v.co.y for v in body.verts]
    zs = [v.co.z for v in body.verts]
    sx_ = dims[0] / (max(xs) - min(xs))
    sy_ = dims[1] / (max(ys) - min(ys))
    sz_ = dims[2] / (max(zs) - min(zs))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    for v in body.verts:
        v.co = V(((v.co.x - cx) * sx_, (v.co.y - cy) * sy_, (v.co.z - min(zs)) * sz_))
    bedk = [(za, zb, hard) for (za, zb, hard) in beds]

    def tint(co):
        # per-bed tone (hard quartz-rich beds paler, soft micaceous ones darker)
        s_ = (Rt.transposed() @ V((co.x / sx_, co.y / sy_, co.z / sz_))).z
        hard = 0.5
        for (za, zb, h_) in bedk:
            if za <= s_ < zb:
                hard = h_
                break
        g = 1.0 - 0.16 * max(0.0, fbm(co * 1.3 + off, 3)) * 2.0
        k = (0.74 + 0.26 * hard) * g
        warm = 0.5 + 0.5 * noise.noise(co * 0.6 + off * 2.0)
        return (k, k * (0.97 - 0.05 * warm), k * (0.97 - 0.12 * warm))
    uvf = uv_box(M=Rt.transposed())
    part_bm(body, 0, uvf, tint, tag=1, smooth=True)
    mb = MB()
    mb.add(body, None, mats=[tx('schist')], tint='src', uvf='src', ftag='src')

    def vfn(co, n, f):
        k = 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.5, co.z))
        k *= 1.0 - 0.12 * smoothstep(0.0, -0.8, n.z)
        return (k, k * 0.98, k * 0.95)
    ob = finish(mb, name, sharp=48, vfn=vfn)
    bake_ao(ob, dist=0.8, samples=128, strength=0.9, ground=0.0)
    print('  %s: %d beds, %d tris' % (name, len(beds), sum(len(p.vertices) - 2 for p in ob.data.polygons)))


def build_rocks(P):
    build_rock(P, 'Rock_A', [(0, 3.0), (0.7, 2.96), (1.2, 2.78), (1.38, 2.5), (1.25, 2.26), (0.85, 2.12),
                             (0.7, 1.7), (0.68, 1.1), (0.85, 0.5), (1.05, 0.15), (1.0, -0.05),
                             (0, -0.08)], seed=11, dims=(2.619, 2.349, 3.117), dip=0.3, joints=1)
    build_rock(P, 'Rock_B', [(0, 1.85), (0.9, 1.78), (1.55, 1.5), (1.95, 1.0), (2.0, 0.55), (1.85, 0.15),
                             (1.6, -0.05), (0, -0.08)], seed=23, dims=(3.910, 3.193, 2.011), dip=0.42, joints=2)
    build_rock(P, 'Rock_C', [(0, 2.45), (0.45, 2.4), (0.85, 2.1), (1.02, 1.7), (0.95, 1.3), (0.62, 0.95),
                             (0.6, 0.55), (0.82, 0.18), (0.8, -0.05), (0, -0.08)], seed=37, lean=0.28,
               dims=(2.548, 1.610, 2.613), dip=0.5, joints=1)


def bm_tube_uv(pts, radii, sides=8, twist_uv=0.0, v_off=0.0, u_off=0.0, **kw):
    """bm_tube with metre UVs: U = arc length along the path (wood grain runs
    along U), V = around the circumference (twist_uv adds a spiral)."""
    bm = bm_tube(pts, radii, sides=sides, **kw)
    pts = [V(p) for p in pts]
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    sarc = [0.0]
    for i in range(1, n):
        sarc.append(sarc[-1] + (pts[i] - pts[i - 1]).length)
    info = []
    for i in range(n):
        r = radii[i] if isinstance(radii[i], (int, float)) else max(radii[i])
        if r <= 1e-7 and not kw.get('closed'):
            info.append((i, -1))
        else:
            for j in range(sides):
                info.append((i, j))
    uvl = bm.loops.layers.uv.new('UVMap')
    bm.verts.ensure_lookup_table()
    vid = {v: info[k] if k < len(info) else (0, 0) for k, v in enumerate(bm.verts)}
    for f in bm.faces:
        js = [vid[v][1] for v in f.verts]
        wrap = (0 in js) and (sides - 1 in js)
        for lp in f.loops:
            i, j = vid[lp.vert]
            r = radii[i] if isinstance(radii[i], (int, float)) else max(radii[i])
            r = max(r, 0.004)
            if j < 0:
                j = sides / 2.0
            if wrap and j == 0:
                j = sides
            lp[uvl].uv = (sarc[i] + u_off, TAU * r * j / sides + twist_uv * sarc[i] + v_off)
    return bm


def sandstone_blocks():
    """Where the shared sandstone texture's ashlar joints fall: [(row v0, row
    v1, joint u offset)] in metres (4 courses of 0.5 m, 1 m blocks), measured
    from the albedo so irregular stones can be mapped inside single blocks."""
    rows = [(0.0, 0.5, 0.891), (0.5, 1.0, 0.549), (1.0, 1.5, 0.977), (1.5, 2.0, 0.604)]
    path = os.path.join(PROJ, 'assets', 'tex', 'sandstone_albedo.jpg')
    try:
        import numpy as np
        im = bpy.data.images.load(path, check_existing=True)
        w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3].mean(-1)
        bpy.data.images.remove(im)
        ppm = w / 2.0
        out = []
        for r in range(4):
            y0, y1 = int((r * 0.5 + 0.08) * ppm), int((r * 0.5 + 0.42) * ppm)
            band = a[y0:y1].mean(0)
            half = int(ppm)
            fold = band[:half] + band[half:2 * half]
            out.append((r * 0.5, r * 0.5 + 0.5, float(np.argmin(fold)) / ppm))
        rows = out
    except Exception as e:                  # library missing: measured defaults
        print('  sandstone joints: defaults (%s)' % e)
    return rows


def poly_offset(poly, d):
    """Inset a convex CCW polygon by d."""
    n = len(poly)
    lines = []
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        L = math.hypot(ex, ey) or 1e-9
        nx, ny = ey / L, -ex / L          # outward normal of a CCW polygon
        lines.append((nx, ny, nx * ax + ny * ay - d))
    out = []
    for i in range(n):
        (n1x, n1y, d1), (n2x, n2y, d2) = lines[i - 1], lines[i]
        det = n1x * n2y - n1y * n2x
        if abs(det) < 1e-9:
            out.append(poly[i])
            continue
        out.append(((d1 * n2y - n1y * d2) / det, (n1x * d2 - d1 * n2x) / det))
    return out


def build_platform(P):
    """A floating slab of old paving: irregular sandstone flags (each mapped
    inside one block of the texture) bedded in a band of earth over a rough
    schist underside, a hanging clump of earth, dangling roots.  The paving is
    flat at z = 0 over the 3 x 3 m collider footprint."""
    rng = random.Random(77)
    off = V((3.1, 7.2, 1.9))
    mats = [tx('sandstone'), tx('schist'), tx('oak')]
    blocks = sandstone_blocks()
    mb = MB()
    # ---- flagstones: jittered-grid Voronoi cells of the 3 x 3 m square
    N = 7
    sp = 3.0 / N
    seeds = []
    for i in range(N):
        for j in range(N):
            seeds.append((-1.5 + sp * (i + 0.5) + rng.uniform(-0.32, 0.32) * sp,
                          -1.5 + sp * (j + 0.5) + rng.uniform(-0.32, 0.32) * sp))
    square = [(-1.5, -1.5), (1.5, -1.5), (1.5, 1.5), (-1.5, 1.5)]
    missing = set()
    cracked = {rng.randrange(len(seeds)) for _ in range(4)}
    stones = []
    for i, (sx, sy) in enumerate(seeds):
        poly = square[:]
        for j, (tx_, ty_) in enumerate(seeds):
            if i == j:
                continue
            nx, ny = tx_ - sx, ty_ - sy
            L = math.hypot(nx, ny)
            nx, ny = nx / L, ny / L
            poly = poly_clip_line(poly, nx, ny, nx * (sx + tx_) / 2 + ny * (sy + ty_) / 2)
            if len(poly) < 3:
                break
        if len(poly) < 3:
            continue
        # a ragged outer edge: border stones sit a little inside the square
        for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if max(nx * x + ny * y for (x, y) in poly) > 1.499:
                poly = poly_clip_line(poly, nx, ny, 1.5 - rng.uniform(0.0, 0.022))
        if i in missing:
            continue
        if i in cracked:
            ang = rng.uniform(0, TAU)
            nx, ny = math.cos(ang), math.sin(ang)
            d = nx * sx + ny * sy + rng.uniform(-0.05, 0.05)
            stones.append(poly_clip_line(poly, nx, ny, d - 0.003))
            stones.append(poly_clip_line(poly, -nx, -ny, -d - 0.003))
        else:
            stones.append(poly)
    for k, poly in enumerate(stones):
        poly = ccw([p_ for p_ in poly])
        if len(poly) < 3 or loop_area(poly) < 0.01:
            continue
        # drop near-duplicate corners (offsetting them would spike)
        clean = []
        for p_ in poly:
            if not clean or math.hypot(p_[0] - clean[-1][0], p_[1] - clean[-1][1]) > 0.02:
                clean.append(p_)
        if len(clean) > 3 and math.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) <= 0.02:
            clean.pop()
        poly = clean
        if len(poly) < 3:
            continue
        cx = sum(p_[0] for p_ in poly) / len(poly)
        cy = sum(p_[1] for p_ in poly) / len(poly)

        def safe_inset(pl, d):
            q = poly_offset(pl, d)
            a0 = loop_area(pl)
            ok_ = loop_area(q) > 0.2 * a0 and poly_simple(q) and all(
                math.hypot(x - cx, y - cy) < max(math.hypot(u - cx, w - cy) for (u, w) in pl) for (x, y) in q)
            if ok_:
                return q
            k = max(0.5, 1.0 - 2.5 * d / math.sqrt(a0))
            return [(cx + (x - cx) * k, cy + (y - cy) * k) for (x, y) in pl]
        poly = safe_inset(poly, 0.005)                   # the joints
        inset = safe_inset(poly, 0.014)
        sink = rng.uniform(0.0, 0.006)
        zt = -sink
        th = rng.uniform(0.1, 0.13)
        bm = bm_loft([[V((x, y, -th)) for (x, y) in poly], [V((x, y, zt - 0.013)) for (x, y) in poly],
                      [V((x, y, zt)) for (x, y) in inset]], cap_start=False, smooth=False)
        # a hair of tilt, never above z = 0
        ax_ = V((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
        rot(bm, math.radians(rng.uniform(0.0, 0.5)), ax_, (cx, cy, zt))
        zmax = max(v.co.z for v in bm.verts)
        if zmax > 0.0:
            move(bm, (0, 0, -zmax))
        # principal axis -> texture block: long side along U, inside one block
        sxx = sum((x - cx) ** 2 for (x, y) in poly)
        syy = sum((y - cy) ** 2 for (x, y) in poly)
        sxy = sum((x - cx) * (y - cy) for (x, y) in poly)
        ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ca, sa = math.cos(ang), math.sin(ang)
        r0, r1, jo = blocks[rng.randrange(len(blocks))]
        bu = jo + rng.randrange(2) + 0.5
        bv = (r0 + r1) / 2

        def uvf(co, n, c, f, cx=cx, cy=cy, ca=ca, sa=sa, bu=bu, bv=bv):
            if n.z > 0.35:
                dx, dy = co.x - cx, co.y - cy
                return (bu + dx * ca + dy * sa, bv - dx * sa + dy * ca)
            # sides: box projection about the stone's own centre, in the same block
            u, v = uv_box(org=(cx, cy, -0.06))(co, n, c, f)
            return (bu + u, bv + v)
        tone = rng.uniform(0.7, 1.0)
        warm = rng.uniform(0.86, 1.0)

        def tint(co, tone=tone, warm=warm, zt=zt):
            g = 1.0 - 0.1 * max(0.0, fbm(co * 2.5 + off, 2)) * 2.0
            e = 1.0 - 0.12 * smoothstep(1.3, 1.5, max(abs(co.x), abs(co.y)))
            e *= 0.72 if co.z < zt - 0.008 else 1.0            # grime down the joints
            return (tone * g * e, tone * g * e * warm, tone * g * e * warm * 0.96)
        mb.add(part_bm(bm, 0, uvf, tint, tag=1, smooth=False), None, mats=mats, tint='src', uvf='src', ftag='src')
    # ---- earth band + schist underside, one voxel-merged mass: a main
    # hanging cone and two smaller lobes, strata plates drifting and eroded
    shell = bmesh.new()
    lobes = [((0.0, 0.0), -0.1, -1.16, 1.46, 0.0), ((-0.62, 0.55), -0.3, -0.86, 0.72, 1.0),
             ((0.7, 0.62), -0.3, -0.7, 0.62, 2.0)]
    for li, ((lx, ly), ztop, zbot, R0, ph) in enumerate(lobes):
        zb_ = [ztop]
        z = ztop
        while z > zbot + 0.02:
            z -= rng.uniform(0.07, 0.19)
            zb_.append(max(z, zbot))
        dx_, dy_ = rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2)
        for i in range(len(zb_) - 1):
            z1, z0 = zb_[i], zb_[i + 1]
            zm = (z0 + z1) / 2
            t = clamp((ztop - zm) / (ztop - zbot))
            R = R0 * (1.0 - t) ** 0.85 + 0.04
            e = lerp(5.0, 2.0, smoothstep(0.0, 0.45, t)) if li == 0 else 2.0
            hard = rng.random()
            if t > 0.1:
                R *= 1.0 + 0.16 * (hard - 0.5)
            cxl = lx + dx_ * t * t + 0.05 * noise.noise(V((zm * 3.0, 1.0, li)) + off)
            cyl = ly + dy_ * t * t + 0.05 * noise.noise(V((zm * 3.0, 2.0, li)) + off)
            poly = []
            for k in range(20):
                th = TAU * k / 20
                c_, s_ = math.cos(th), math.sin(th)
                w = noise.noise(V((c_ * 1.6, s_ * 1.6, zm * 2.4 + ph)) + off)
                rr = R * (1.0 + 0.26 * w * min(1.0, t * 3.0))
                poly.append((cxl + rr * math.copysign(abs(c_) ** (2 / e), c_),
                             cyl + rr * math.copysign(abs(s_) ** (2 / e), s_)))
            poly = convex_hull2(poly)
            if rng.random() < 0.5 and t > 0.15:            # a bed broken off along a line
                ang = rng.uniform(0, TAU)
                nx, ny = math.cos(ang), math.sin(ang)
                ext = max(nx * (p_[0] - cxl) + ny * (p_[1] - cyl) for p_ in poly)
                poly = poly_clip_line(poly, nx, ny, nx * cxl + ny * cyl + ext * rng.uniform(0.6, 0.85))
            for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                poly = poly_clip_line(poly, nx, ny, 1.47)
            k = rng.uniform(0.9, 0.97)
            pcx = sum(p_[0] for p_ in poly) / len(poly)
            pcy = sum(p_[1] for p_ in poly) / len(poly)
            sl = slab_prism(poly, [(pcx + (x - pcx) * k, pcy + (y - pcy) * k) for (x, y) in poly],
                            z0 - 0.012, z1 + 0.012)
            bm_append(shell, sl)
            sl.free()
    clump = rough_rock(0.34, rng, sc=(1.2, 1.0, 0.8), subdiv=2, amp=0.3)
    move(clump, (0.72, -0.55, -0.5))
    bm_append(shell, clump)
    clump.free()

    def rough(co, n):
        g = 0.055 * fbm(co * 1.2 + off, 3) + 0.02 * noise.noise(co * 4.0 + off)
        lam = 0.012 * math.sin(co.z * TAU / 0.07 + 2.0 * noise.noise(co * 1.5 + off)) * (1.0 - abs(n.z))
        if co.z > -0.13:
            return co
        return co + n * (g + lam) * smoothstep(-0.13, -0.25, co.z)
    body = remesh_decimate(shell, 0.035, 1100, disp=rough)
    for v in body.verts:
        if v.co.z > -0.1:
            v.co.z = min(v.co.z, -0.1)
        v.co.x = clamp(v.co.x, -1.49, 1.49)
        v.co.y = clamp(v.co.y, -1.49, 1.49)
        v.co.z = max(v.co.z, -1.18)
    cl = V((0.72, -0.55, -0.5))

    def earthy(co):
        return max(smoothstep(-0.38, -0.26, co.z), smoothstep(0.42, 0.3, (co - cl).length))

    def body_tint(co):
        g = 1.0 - 0.15 * max(0.0, fbm(co * 1.6 + off, 3)) * 2.0
        e = earthy(co)
        rock = (0.86 * g, 0.84 * g, 0.8 * g)
        soil = (0.78 * g, 0.55 * g, 0.36 * g)
        c = mix3(rock, soil, e)
        k = 1.0 - 0.3 * smoothstep(-0.5, -1.15, co.z)
        return (c[0] * k, c[1] * k, c[2] * k)
    part_bm(body, 1, uv_box(), body_tint, tag=2, smooth=True)
    mb.add(body, None, mats=mats, tint='src', uvf='src', ftag='src')
    bed = bm_box_mm((-1.485, -1.485, -0.13), (1.485, 1.485, -0.095), smooth=False)
    mb.add(part_bm(bed, 1, uv_box(), lambda co: (0.5, 0.4, 0.3), tag=2, smooth=False), None, mats=mats,
           tint='src', uvf='src', ftag='src')
    # ---- dangling roots (oak, grain along the root)
    for k in range(9):
        a = TAU * k / 9 + rng.uniform(-0.3, 0.3)
        r0 = rng.uniform(0.45, 1.35)
        x, y = math.cos(a) * r0, math.sin(a) * r0
        x, y = clamp(x, -1.38, 1.38), clamp(y, -1.38, 1.38)
        t = clamp((max(abs(x), abs(y)) - 0.1) / 1.4)
        z0 = -0.2 - 0.85 * (1.0 - t) ** 1.3 + 0.1
        L = min(rng.uniform(0.35, 0.8), 1.15 + z0)
        pts, rad = [], []
        steps = 7
        d = V((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), -1.0)).normalized()
        p_ = V((x, y, z0 + 0.06))
        for i in range(steps + 1):
            s_ = i / steps
            pts.append(p_.copy())
            rad.append(lerp(0.038, 0.003, s_ ** 0.8) * rng.uniform(0.9, 1.1) if i < steps else 0.0)
            d = (d + V((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), -0.3))).normalized()
            p_ = p_ + d * (L / steps)
            p_.z = max(p_.z, -1.15)
        tb = bm_tube_uv(pts, rad, sides=5, twist_uv=0.3)
        mb.add(part_bm_keep(tb, 2, lambda co: (0.62, 0.55, 0.5), tag=3), None, mats=mats, tint='src',
               uvf='src', ftag='src')
        if k % 2 == 0:                                  # a rootlet
            i0 = rng.randrange(2, 5)
            q = pts[i0]
            d2 = V((rng.uniform(-1, 1), rng.uniform(-1, 1), -0.6)).normalized()
            pts2 = [q + d2 * (0.09 * m) + V((0, 0, -0.045 * m * m)) for m in range(4)]
            for q2 in pts2:
                q2.z = max(q2.z, -1.15)
            tb = bm_tube_uv(pts2, [rad[i0] * 0.6 * (1 - m / 3) for m in range(4)], sides=4)
            mb.add(part_bm_keep(tb, 2, lambda co: (0.6, 0.53, 0.48), tag=3), None, mats=mats, tint='src',
                   uvf='src', ftag='src')

    def vfn(co, n, f):
        return (1.0, 1.0, 1.0)
    ob = finish(mb, 'Platform', sharp=40, vfn=vfn)
    bake_ao(ob, dist=0.5, samples=128, strength=0.85)
    print('  Platform: %d stones' % len(stones))


def part_bm_keep(src, mat_index, tint, tag=0):
    """part_bm for a bmesh that already has its UVMap: adds Col / tag only."""
    col = src.loops.layers.float_color.get('Col') or src.loops.layers.float_color.new('Col')
    tagl = src.faces.layers.int.get('tag') or src.faces.layers.int.new('tag')
    for f in src.faces:
        f.material_index = mat_index
        f[tagl] = tag
        for lp in f.loops:
            c = tint(lp.vert.co) if callable(tint) else tint
            lp[col] = (c[0], c[1], c[2], 1.0)
    return src


def build_railpost(P):
    """A Dali crutch holding up a grind rail: brass ferrule, turned oak shaft,
    a brass collar where two bowed oak uprights fork off, a turned hand grip
    with brass bolt heads, and a curved oak crosspiece with a tufted leather
    pad the rail rests on (rail centre line at z = 1.6; the game scales the
    post in z to the rail height)."""
    oak = tx('oak')
    brass = P['brass']
    leather = material('Leather', '#6e2320', 0.0, 0.6)
    mats = [oak, brass, leather]
    mb = MB()

    def wood_tint(co):
        g = 1.0 - 0.1 * max(0.0, fbm(co * 6.0 + V((1, 2, 3)), 2)) * 2.0
        grip = smoothstep(0.14, 0.02, abs(co.z - 1.08)) * 0.25
        foot = 0.25 * (1.0 - smoothstep(0.0, 0.3, co.z))
        k = g * (1.0 - grip - foot)
        return (1.0 * k, 0.9 * k, 0.78 * k)
    # brass ferrule with a worn, flattened foot
    fer = bm_lathe([(0.0, 0.0), (0.019, 0.0), (0.024, 0.006), (0.025, 0.02), (0.023, 0.05), (0.024, 0.085),
                    (0.027, 0.09), (0.027, 0.1), (0.022, 0.104), (0.0, 0.104)], segs=12)
    mb.add(fer, brass, uvf=uv_cyl(), ftag=2, tint=(1.0, 0.97, 0.9))
    for i, (z, r) in enumerate(((0.04, 0.0245), (0.07, 0.0245))):
        rv = bm_ico(0.004, 1, center=(r, 0.0, z))
        rot(rv, TAU * i / 2 + 0.4, 'Z')
        mb.add(rv, brass, uvf=uv_box(), ftag=2, tint=(0.7, 0.65, 0.55))
    # turned oak shaft
    zs = [0.095, 0.16, 0.3, 0.45, 0.56, 0.6]
    shaft = bm_tube_uv([(0, 0, z) for z in zs], [0.0195, 0.0198, 0.0205, 0.0212, 0.022, 0.022], sides=12,
                       twist_uv=0.0)
    mb.add(part_bm_keep(shaft, 0, wood_tint, tag=1), None, mats=mats, tint='src', uvf='src', ftag='src')
    # brass collar over the fork, two screws
    col_ = bm_lathe([(0.0, 0.56), (0.026, 0.56), (0.029, 0.566), (0.029, 0.63), (0.034, 0.64), (0.034, 0.655),
                     (0.028, 0.662), (0.0, 0.662)], segs=14)
    mb.add(col_, brass, uvf=uv_cyl(), ftag=2, tint=(1.0, 1.0, 1.0))
    for sgn in (-1, 1):
        sc = bm_lathe([(0, 0), (0.006, 0), (0.006, 0.003), (0.0, 0.005)], segs=8)
        rot(sc, math.pi / 2, 'X')
        move(sc, (0.0, sgn * 0.029, 0.6))
        if sgn > 0:
            rot(sc, math.pi, 'Z', (0, 0, 0.6))
        mb.add(sc, brass, uvf=uv_box(), ftag=2, tint=(0.75, 0.7, 0.6))
    # two bowed uprights forking into a Y (elliptical section)
    ztop = 1.5
    for sgn in (-1, 1):
        pts = []
        for k in range(13):
            t = k / 12
            z = lerp(0.62, ztop + 0.02, t)
            x = 0.016 + 0.07 * math.sin(math.pi * min(1.0, t * 1.05) * 0.8) ** 0.9 + 0.045 * t ** 3
            pts.append((sgn * x, 0.0, z))
        up = bm_tube_uv(pts, [(0.017, 0.0145)] * len(pts), sides=8)
        mb.add(part_bm_keep(up, 0, wood_tint, tag=1), None, mats=mats, tint='src', uvf='src', ftag='src')
        # brass bolt through the grip, and the upright's cap under the pad
        bx = sgn * (0.016 + 0.07 * math.sin(math.pi * ((1.08 - 0.62) / (ztop + 0.02 - 0.62)) * 1.05 * 0.8) ** 0.9 + 0.045 * ((1.08 - 0.62) / 0.9) ** 3)
        bolt = bm_lathe([(0, 0), (0.009, 0), (0.009, 0.004), (0.006, 0.007), (0, 0.008)], segs=10)
        rot(bolt, sgn * math.pi / 2, 'Y')
        mb.add(move(bolt, (bx + sgn * 0.014, 0, 1.08)), brass, uvf=uv_box(), ftag=2, tint=(0.9, 0.85, 0.75))
    # turned hand grip
    gp = [(-0.085 + 0.17 * k / 6, 0.0, 1.08) for k in range(7)]
    gr = [0.012, 0.016, 0.0195, 0.0205, 0.0195, 0.016, 0.012]
    grip = bm_tube_uv(gp, gr, sides=8)
    mb.add(part_bm_keep(grip, 0, lambda co: (0.7, 0.62, 0.52), tag=1), None, mats=mats, tint='src', uvf='src',
           ftag='src')
    # curved oak crosspiece (crescent) with a tufted leather pad on top: the
    # rail's centre line sits at z = 1.6 (pad top at ~1.53 in the middle)
    NX = 14
    xs = [lerp(-0.13, 0.13, k / NX) for k in range(NX + 1)]

    def crest(x):
        return 1.49 + 0.045 * (x / 0.13) ** 2
    cp = [(x, 0.0, crest(x)) for x in xs]
    cb = bm_tube_uv(cp, [(0.03, 0.016)] * len(cp), sides=8, fixed_b=(0, 1, 0))
    mb.add(part_bm_keep(cb, 0, wood_tint, tag=1), None, mats=mats, tint='src', uvf='src', ftag='src')
    pad = bmesh.new()
    rows = []
    NY = 6
    for i, x in enumerate(xs):
        row = []
        zc = crest(x) + 0.016
        for j in range(NY + 1):
            v = j / NY
            y = lerp(-0.042, 0.042, v)
            h = 0.034 * (1.0 - (2 * v - 1) ** 2) ** 0.5
            ends = smoothstep(0.13, 0.1, abs(x))
            dimple = 0.0
            for bx_ in (-0.065, 0.0, 0.065):
                dd = math.hypot(x - bx_, y)
                dimple += 0.008 * max(0.0, 1.0 - (dd / 0.025) ** 2)
            row.append(pad.verts.new((x, y, zc + (h * ends + 0.004) - dimple * ends)))
        rows.append(row)
    for i in range(NX):
        for j in range(NY):
            pad.faces.new([rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]])
    # sides and bottom close the cushion
    bot = [[pad.verts.new((x, y, crest(x) + 0.012)) for y in (-0.042, 0.042)] for x in xs]
    for i in range(NX):
        pad.faces.new([bot[i][0], bot[i + 1][0], rows[i + 1][0], rows[i][0]])
        pad.faces.new([rows[i][NY], rows[i + 1][NY], bot[i + 1][1], bot[i][1]])
        pad.faces.new([bot[i][1], bot[i + 1][1], bot[i + 1][0], bot[i][0]])
    pad.faces.new([bot[0][0], rows[0][0]] + [rows[0][j] for j in range(1, NY + 1)] + [bot[0][1]])
    pad.faces.new([bot[-1][1]] + [rows[-1][j] for j in range(NY, -1, -1)] + [bot[-1][0]])
    bmesh.ops.recalc_face_normals(pad, faces=pad.faces)
    set_smooth(pad)

    def leather_tint(co):
        k = 1.0 - 0.18 * max(0.0, fbm(co * 18.0 + V((4, 4, 4)), 2)) * 2.0
        worn = 0.2 * smoothstep(0.03, 0.0, abs(co.x)) * smoothstep(0.03, 0.0, abs(co.y))
        return (k * (1 + worn * 0.4), k * (1 - worn * 0.1), k)
    mb.add(pad, leather, uvf=uv_box(), ftag=3, tint=leather_tint)
    for bx_ in (-0.065, 0.0, 0.065):                      # buttons
        zc = crest(bx_) + 0.016 + 0.034 + 0.004 - 0.008
        bt = bm_lathe([(0.0, -0.002), (0.0055, -0.001), (0.0045, 0.002), (0.0, 0.0035)], segs=6)
        mb.add(move(bt, (bx_, 0.0, zc)), leather, uvf=uv_box(), ftag=3, tint=(0.55, 0.5, 0.45))
    # brass nails round the pad's skirt (low domes: they are a few mm across)
    for k in range(7):
        x = lerp(-0.11, 0.11, k / 6)
        for sgn in (-1, 1):
            nl = bm_lathe([(0.0, 0.0), (0.0038, 0.0), (0.0, 0.0028)], segs=5)
            rot(nl, -sgn * math.pi / 2, 'X')
            mb.add(move(nl, (x, sgn * 0.0425, crest(x) + 0.017)), brass, uvf=uv_box(), ftag=2,
                   tint=(0.85, 0.8, 0.7))
    ob = finish(mb, 'RailPost', sharp=45)
    bake_ao(ob, dist=0.15, samples=96, strength=0.85, ground=0.0)


def spoked_wheel(R, width, spokes, hub=0.1, rim=0.07, cw=True, segs=28):
    """A locomotive wheel in its own frame (axis +Y, centre at the origin):
    tyre with flange, rim, tapered spokes, hub boss, optional counterweight."""
    parts = []
    w = width / 2
    tyre = bm_lathe([(R - rim, -w), (R, -w), (R, -w + 0.02), (R - 0.035, -w + 0.035),
                     (R - 0.04, w), (R - rim, w), (R - rim, -w)], segs=segs, cap=False)
    rot(tyre, -math.pi / 2, 'X')
    parts.append(tyre)
    hb = bm_lathe([(0, -w - 0.03), (hub, -w - 0.03), (hub, w + 0.02), (hub * 0.6, w + 0.05), (0, w + 0.05)],
                  segs=8)
    rot(hb, -math.pi / 2, 'X')
    parts.append(hb)
    for k in range(spokes):
        a = TAU * k / spokes
        c_, s_ = math.cos(a), math.sin(a)
        sp = bm_tube([(c_ * hub * 0.8, 0, s_ * hub * 0.8), (c_ * (R - rim * 0.8), 0, s_ * (R - rim * 0.8))],
                     [(0.03, 0.02), (0.02, 0.016)], sides=4, fixed_b=(0, 1, 0))
        parts.append(sp)
    if cw:
        poly = []
        for k in range(6):
            a = math.radians(200 + 70 * k / 5)
            poly.append((math.cos(a) * (R - rim * 0.9), math.sin(a) * (R - rim * 0.9)))
        for k in range(4):
            a = math.radians(270 - 70 * k / 3)
            poly.append((math.cos(a) * (R * 0.45), math.sin(a) * (R * 0.45)))
        c = prism_y(poly, -w * 0.6, w * 0.6)
        parts.append(c)
    return parts


def build_train(P):
    """The 6:40 that never stops (a background piece, kept light): riveted iron
    boiler with brass bands, spoked driving wheels with counterweights, coupling
    and connecting rods, cylinders, a cab with real window openings and glass,
    curved roof, flared stack, domes, lamp, slatted cowcatcher, buffers."""
    iron = tx('iron')
    red = material('TrainRed', '#6d1f1c', 0.1, 0.55)
    brass = P['brass']
    glassm = material('TrainWindow', '#0c0f10', 0.2, 0.2)
    steel = material('TrainSteel', '#8a8d92', 0.9, 0.35)
    mats = [iron, red, brass, glassm, steel]
    mb = MB()
    body_t = lambda co: (0.5, 0.56, 0.58)

    def add(bm, mi, uvf=None, tnt=(1, 1, 1), smooth=None):
        mb.add(part_bm(bm, mi, uvf or uv_box(), tnt, tag=mi + 1, smooth=smooth), None, mats=mats, tint='src',
               uvf='src', ftag='src')
    # ---- frame, running boards, buffer beam
    add(bm_box_mm((-4.0, -0.85, 0.62), (3.55, 0.85, 0.95), bevel=0.03, segs=1, smooth=False), 1)
    for sy in (-1, 1):
        y0, y1 = sorted((sy * 0.86, sy * 1.06))
        add(bm_box_mm((-1.45, y0, 0.95), (3.3, y1, 0.99), bevel=0.01, segs=1, smooth=False), 1)
    add(bm_box_mm((3.45, -0.95, 0.72), (3.6, 0.95, 1.0), bevel=0.02, segs=1, smooth=False), 1)
    # ---- boiler (built along Z, UV'd, then laid along X)
    prof = [(0.0, -1.5), (0.78, -1.5), (0.78, 3.35), (0.8, 3.36), (0.8, 3.42), (0.72, 3.44), (0.66, 3.47),
            (0.2, 3.5), (0.0, 3.5)]
    bo = bm_lathe(prof, segs=28)
    part_bm(bo, 0, uv_cyl(), body_t, tag=1, smooth=True)
    rot(bo, math.pi / 2, 'Y')
    move(bo, (0, 0, 1.75))
    mb.add(bo, None, mats=mats, tint='src', uvf='src', ftag='src')
    for x in (-0.6, 0.9, 2.3, 3.3):                  # brass bands with rivet rows
        band = bm_lathe([(0.78, -0.045), (0.8, -0.03), (0.8, 0.03), (0.78, 0.045)], segs=20, cap=False)
        rot(band, math.pi / 2, 'Y')
        add(move(band, (x, 0, 1.75)), 2, smooth=True)
        if x > 3.0:                                   # rivets round the smokebox ring
            for k in range(16):
                a = TAU * k / 16
                rv = bm_lathe([(0.0, 0.0), (0.014, 0.0), (0.0, 0.013)], segs=4)
                rot(rv, math.pi / 2, 'Y')
                rot(rv, -a, 'X')
                add(move(rv, (x - 0.1, 0.785 * math.cos(a), 1.75 + 0.785 * math.sin(a))), 0, tnt=body_t)
    # smokebox door with a dart handle
    door = bm_lathe([(0.0, 3.5), (0.5, 3.5), (0.52, 3.52), (0.45, 3.56), (0.1, 3.58), (0.0, 3.58)], segs=24)
    rot(door, math.pi / 2, 'Y')
    move(door, (-3.5 + 3.5, 0, 0))
    door2 = door
    for v in door2.verts:
        v.co = V((v.co.x, v.co.y, v.co.z + 1.75))
    add(door2, 0, tnt=(0.55, 0.62, 0.64), smooth=True)
    for a in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        add(bm_tube([(3.58, 0.0, 1.75), (3.62, 0.18 * math.cos(a), 1.75 + 0.18 * math.sin(a))], 0.012, sides=4), 4)
    # ---- stack, domes, lamp
    stack = bm_lathe([(0, 2.3), (0.26, 2.3), (0.23, 2.4), (0.19, 2.55), (0.18, 2.7), (0.2, 2.78), (0.27, 2.9),
                      (0.33, 2.97), (0.34, 3.0), (0.3, 3.0), (0.22, 2.95), (0, 2.95)], segs=16)
    add(move(stack, (2.85, 0, 0)), 0, uv_cyl(cx=2.85), tnt=body_t, smooth=True)
    rim_ = bm_lathe([(0.33, 2.96), (0.345, 2.97), (0.345, 3.0), (0.3, 3.0)], segs=20, cap=False)
    add(move(rim_, (2.85, 0, 0)), 2, smooth=True)
    dome = bm_lathe([(0, 2.35), (0.34, 2.35), (0.32, 2.5), (0.26, 2.62), (0.14, 2.7), (0, 2.72)], segs=20)
    add(move(dome, (1.1, 0, 0)), 2, smooth=True)
    dome2 = bm_lathe([(0, 2.35), (0.24, 2.35), (0.22, 2.45), (0.12, 2.55), (0, 2.57)], segs=16)
    add(move(dome2, (0.05, 0, 0)), 0, uv_cyl(cx=0.05), tnt=body_t, smooth=True)
    lamp = bm_box_mm((3.28, -0.16, 2.3), (3.52, 0.16, 2.6), bevel=0.02, segs=1, smooth=False)
    add(lamp, 2)
    lens = bm_lathe([(0, 0), (0.11, 0), (0.1, 0.02), (0, 0.025)], segs=16)
    rot(lens, math.pi / 2, 'Y')
    add(move(lens, (3.52, 0, 2.45)), 3, smooth=True)
    # ---- cylinders + slide bars
    for sy in (-1, 1):
        cy_ = bm_lathe([(0, -0.35), (0.22, -0.35), (0.24, -0.32), (0.24, 0.32), (0.22, 0.35), (0, 0.35)], segs=16)
        rot(cy_, math.pi / 2, 'Y')
        add(move(cy_, (2.55, sy * 0.85, 0.95)), 1, smooth=True)
        add(bm_box_mm((1.4, sy * 1.0 - 0.02, 0.93), (2.2, sy * 1.0 + 0.02, 0.97)), 4)
    # ---- wheels: three coupled drivers, two leading pairs
    crank = []
    for x in (-1.75, -0.45, 0.85):
        for sy in (-1, 1):
            for p_ in spoked_wheel(0.6, 0.12, 10, hub=0.1, rim=0.07, cw=True, segs=16):
                if sy < 0:
                    rot(p_, math.pi, 'Z')
                add(move(p_, (x, sy * 0.92, 0.6)), 1, tnt=(0.9, 0.9, 0.9), smooth=True)
            crank.append(V((x, sy * 1.02, 0.6 + 0.28)))
    for x in (2.55, 3.25):
        for sy in (-1, 1):
            for p_ in spoked_wheel(0.36, 0.1, 6, hub=0.07, rim=0.05, cw=False, segs=12):
                if sy < 0:
                    rot(p_, math.pi, 'Z')
                add(move(p_, (x, sy * 0.9, 0.36)), 1, tnt=(0.9, 0.9, 0.9), smooth=True)
    for sy in (-1, 1):
        pts = [c for c in crank if c.y * sy > 0]
        pts.sort(key=lambda c: c.x)
        add(bm_box_mm((pts[0].x - 0.05, sy * 1.02 - 0.02, pts[0].z - 0.035), (pts[-1].x + 0.05, sy * 1.02 + 0.02,
                                                                                pts[0].z + 0.035), bevel=0.01, segs=1), 4)
        # connecting rod from the crosshead to the middle driver
        add(bm_tube([(2.2, sy * 1.06, 0.95), (pts[1].x, sy * 1.06, pts[1].z)], [(0.03, 0.02), (0.035, 0.02)],
                    sides=4, fixed_b=(0, 1, 0)), 4)
        for c in pts:
            add(bm_ico(0.035, 1, center=(c.x, c.y + sy * 0.04, c.z)), 2, smooth=True)
    # ---- cab: iron walls with window openings, glass, brass frames, curved roof
    cab = bm_box_mm((-3.3, -1.0, 0.95), (-1.45, 1.0, 2.62), bevel=0.03, segs=1, smooth=False)
    grid_cut(cab, 2, [1.6, 2.2])
    cutters = []
    for sy in (-1, 1):
        for (x0, x1) in ((-3.05, -2.45), (-2.25, -1.7)):
            poly = [(x0, 1.85), (x1, 1.85), (x1, 2.32), (x0 + (x1 - x0) * 0.5 + 0.12, 2.42), (x0, 2.35)]
            poly = [(x0, 1.85), (x1, 1.85), (x1, 2.4), (x0, 2.4)]
            y0, y1 = (sy * 1.1, sy * 0.9) if sy < 0 else (sy * 0.9, sy * 1.1)
            cutters.append(prism_y(poly, min(y0, y1), max(y0, y1)))
    for yc in (-0.5, 0.5):                               # round spectacle windows at the front
        poly = [(yc + 0.2 * math.cos(TAU * k / 12), 2.15 + 0.2 * math.sin(TAU * k / 12)) for k in range(12)]
        cutters.append(prism_x(poly, -1.55, -1.35))
    cab = bool_diff(cab, cutters, name='train cab')
    add(cab, 0, tnt=body_t, smooth=False)
    for sy in (-1, 1):
        for k in range(8):
            z = lerp(1.05, 2.5, k / 7)
            rv = bm_lathe([(0.0, 0.0), (0.014, 0.0), (0.0, 0.013)], segs=4)
            rot(rv, -sy * math.pi / 2, 'X')
            add(move(rv, (-1.52, sy * 1.0, z)), 0, tnt=body_t)
    for sy in (-1, 1):
        for (x0, x1) in ((-3.05, -2.45), (-2.25, -1.7)):
            add(bm_box_mm((x0, sy * 0.955 - 0.004, 1.85), (x1, sy * 0.955 + 0.004, 2.4)), 3)
            for (a0, a1, b0, b1) in ((x0 - 0.03, x0, 1.82, 2.43), (x1, x1 + 0.03, 1.82, 2.43),
                                     (x0, x1, 1.82, 1.85), (x0, x1, 2.4, 2.43)):
                y0, y1 = sorted((sy * 1.0, sy * 1.018))
                add(bm_box_mm((a0, y0, b0), (a1, y1, b1)), 2)
    for yc in (-0.5, 0.5):
        g_ = bm_lathe([(0, 0), (0.2, 0), (0.2, 0.004), (0, 0.004)], segs=12)
        rot(g_, math.pi / 2, 'Y')
        add(move(g_, (-1.5, yc, 2.15)), 3)
        rg = bm_tube([(-1.44, yc + 0.215 * math.cos(TAU * k / 16), 2.15 + 0.215 * math.sin(TAU * k / 16))
                      for k in range(16)], 0.02, sides=6, closed=True, fixed_b=(1, 0, 0))
        add(rg, 2, smooth=True)
    rpts = [(-1.1, 2.62), (1.1, 2.62)] + [(lerp(1.1, -1.1, k / 12), 2.72 + 0.12 * math.cos(math.pi * lerp(1.1, -1.1, k / 12) / 2.2))
                                        for k in range(13)]
    rf = bm_prism(rpts, -3.42, -1.35)
    xform(rf, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    add(rf, 1, smooth=False)
    # ---- slatted cowcatcher and buffers
    for k in range(9):
        t = k / 8
        y = lerp(-0.82, 0.82, t)
        tip = V((4.0, y * 0.12, 0.14))
        add(bm_tube([(3.55, y, 0.6), (lerp(3.55, 4.0, 0.6), y * 0.55, 0.3), tuple(tip)], [0.022, 0.02, 0.018],
                    sides=4, fixed_b=(0, 0, 1)), 1)
    add(bm_tube([(3.58, -0.85, 0.58), (3.58, 0.85, 0.58)], 0.03, sides=6), 1)
    add(bm_tube([(3.98, -0.1, 0.14), (3.98, 0.1, 0.14)], 0.03, sides=6), 1)
    for sy in (-1, 1):
        bf = bm_lathe([(0, 0), (0.09, 0), (0.09, 0.2), (0.12, 0.22), (0.12, 0.26), (0, 0.26)], segs=12)
        rot(bf, math.pi / 2, 'Y')
        add(move(bf, (3.6, sy * 0.65, 0.86)), 2, smooth=True)

    def vfn(co, n, f):
        k = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.8, co.z))
        k *= 1.0 - 0.25 * smoothstep(0.0, -1.0, n.z)
        return (k, k, k)
    ob = finish(mb, 'Train', sharp=40, vfn=vfn)
    bake_ao(ob, dist=0.4, samples=64, strength=0.7, ground=0.0)


def build_apple(P):
    green = material('AppleGreen', '#93c03c', 0.0, 0.35)
    leafm = material('Leaf', '#4d7d28', 0.0, 0.5, double=True)
    stemm = material('Stem', '#4b3220', 0.0, 0.8)
    mb = MB()
    prof = [(0, 0.012), (0.012, 0.006), (0.026, 0.002), (0.042, 0.004), (0.056, 0.014), (0.066, 0.034),
            (0.07, 0.058), (0.067, 0.083), (0.058, 0.106), (0.046, 0.122), (0.031, 0.128),
            (0.017, 0.124), (0.007, 0.115), (0, 0.11)]
    mb.add(bm_lathe(prof, segs=32, vfun=lambda t, r, z: (
        r * (1 + 0.025 * math.cos(5 * t)) * math.cos(t), r * (1 + 0.025 * math.cos(5 * t)) * math.sin(t), z)),
        green)
    stem_pts = [(0, 0, 0.108), (0.001, 0, 0.125), (0.004, 0, 0.14), (0.009, 0, 0.152)]
    mb.add(bm_tube(stem_pts, [0.0035, 0.003, 0.0027, 0.0025], sides=8), stemm)
    L, Wd = 0.065, 0.028
    lb = bmesh.new()
    rows = []
    for i in range(9):
        s = i / 8
        w = Wd * math.sin(math.pi * s) ** 0.8 * (1 - 0.3 * s)
        row = []
        for j in range(5):
            u = (j / 4) * 2 - 1
            x = s * L
            y = u * w / 2
            z = 0.012 * abs(u) - 0.02 * s * s
            row.append(lb.verts.new((x, y, z)))
        rows.append(row)
    for i in range(8):
        for j in range(4):
            try:
                lb.faces.new([rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]])
            except ValueError:
                pass
    bmesh.ops.remove_doubles(lb, verts=lb.verts, dist=1e-6)
    set_smooth(lb)
    rot(lb, math.radians(-25), 'Y')
    rot(lb, math.radians(-40), 'Z')
    mb.add(move(lb, (0.008, 0, 0.146)), leafm)

    def vfn(co, n, f):
        k = 1.0 - 0.25 * smoothstep(0.03, 0.0, co.z) - 0.25 * smoothstep(0.11, 0.125, co.z) * \
            smoothstep(0.03, 0.0, math.hypot(co.x, co.y))
        return (k, k, k * (0.9 + 0.1 * smoothstep(0.02, 0.1, co.z)))
    move(mb.bm, (0, 0, -min(v.co.z for v in mb.bm.verts)))
    finish(mb, 'Apple', sharp=None, vfn=vfn)


# ============================================================================
# ENEMIES
# ============================================================================
def build_sleepwalker(P):
    manq = material('Mannequin', '#e9dbc0', 0.0, 0.4)
    brass, sheet, wood = P['brass'], P['sheet'], P['wood']
    core = material('EnemyCore', '#1ad4c4', 0.0, 0.3, emit='#2ef7e4', strength=3.0)
    empty('Sleepwalker')
    joints = [V((0, 0, 1.03)), V((0.11, 0, 0.93)), V((-0.11, 0, 0.93)), V((0.11, 0, 0.51)),
              V((-0.11, 0, 0.51)), V((0.24, 0, 1.52)), V((-0.24, 0, 1.52)), V((0.24, 0, 1.2)),
              V((-0.24, 0, 1.2)), V((0, 0, 1.625))]

    def body_vfn(co, n, f):
        k = 1.0
        for j in joints:
            d = (co - j).length
            k *= 1.0 - 0.22 * math.exp(-(d / 0.06) ** 2)
        k *= 1.0 - 0.15 * smoothstep(0.0, -1.0, n.z)
        return (k, k * 0.985, k * 0.97)

    def seam(co):
        # thin painted seams of the de Chirico mannequin
        k = 1.0
        if co.y < 0 and 1.15 < co.z < 1.55:
            k *= 1.0 - 0.35 * math.exp(-(co.x / 0.008) ** 2)
        if 1.15 < co.z < 1.2:
            k *= 0.8
        return (k, k, k)
    # hips / pelvis
    hb = MB()
    hb.add(bm_lathe([(0, 0.845), (0.07, 0.85), (0.13, 0.87), (0.165, 0.915), (0.168, 0.955),
                     (0.15, 0.99), (0.11, 1.012), (0.06, 1.022), (0, 1.025)], segs=36, sy=0.66), manq)
    hb.add(bm_ico(0.052, 3, center=(0, 0, 1.03)), brass)
    finish(hb, 'SW_Hips', pivot=(0, 0, 0.95), parent='Sleepwalker', sharp=None, vfn=body_vfn)
    # torso with the chest-of-drawers
    tb = MB()
    tb.add(bm_lathe([(0, 1.0), (0.07, 1.005), (0.092, 1.05), (0.1, 1.12), (0.1, 1.17), (0, 1.2)],
                    segs=36, sy=0.75), manq, tint=seam)
    tb.add(bm_lathe([(0, 1.13), (0.09, 1.14), (0.13, 1.18), (0.158, 1.26), (0.172, 1.36), (0.176, 1.43),
                     (0.166, 1.49), (0.13, 1.535), (0.07, 1.56), (0, 1.565)], segs=48, sy=0.62), manq,
           tint=seam)
    yoke = [(x, 0, 1.5 - 0.02 * (x / 0.2) ** 2) for x in [lerp(-0.205, 0.205, k / 10) for k in range(11)]]
    tb.add(bm_tube(yoke, [0.0, 0.035, 0.047, 0.053, 0.055, 0.055, 0.055, 0.053, 0.047, 0.035, 0.0],
                   sides=16), manq)
    tb.add(bm_lathe([(0, 1.53), (0.043, 1.53), (0.039, 1.58), (0.037, 1.62), (0, 1.625)], segs=20), manq)
    wt = (0.95, 0.9, 0.85)
    tb.add(bm_box_mm((-0.09, -0.128, 1.45), (0.09, -0.03, 1.466), bevel=0.003), wood, tint=wt)
    tb.add(bm_box_mm((-0.09, -0.128, 1.24), (0.09, -0.03, 1.256), bevel=0.003), wood, tint=wt)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.077, sx * 0.09))
        tb.add(bm_box_mm((x0, -0.126, 1.256), (x1, -0.03, 1.45)), wood, tint=wt)
    tb.add(bm_box_mm((-0.077, -0.126, 1.345), (0.077, -0.03, 1.356)), wood, tint=wt)
    tb.add(bm_box_mm((-0.077, -0.124, 1.356), (0.077, -0.03, 1.45)), wood, tint=(0.8, 0.76, 0.72))
    tb.add(bm_box_mm((-0.073, -0.131, 1.36), (0.073, -0.122, 1.446), bevel=0.002), wood)
    tb.add(bm_box_mm((-0.077, -0.04, 1.256), (0.077, -0.03, 1.345)), wood, tint=(0.15, 0.13, 0.12))
    esc = bm_lathe([(0, 0), (0.03, 0), (0.03, 0.002), (0.026, 0.004), (0, 0.004)], segs=24)
    rot(esc, math.pi / 2, 'X')
    tb.add(move(esc, (0, -0.131, 1.403)), brass)
    finish(tb, 'SW_Torso', pivot=(0, 0, 1.0), parent='SW_Hips', sharp=45, vfn=body_vfn)
    # drawer (slides along -Y in code)
    db = MB()
    db.add(bm_box_mm((-0.0735, -0.132, 1.2595), (0.0735, -0.1235, 1.3415), bevel=0.002), wood)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.066, sx * 0.072))
        db.add(bm_box_mm((x0, -0.1235, 1.262), (x1, -0.042, 1.33)), wood, tint=(0.8, 0.75, 0.7))
    db.add(bm_box_mm((-0.072, -0.1235, 1.2595), (0.072, -0.042, 1.266)), wood, tint=(0.8, 0.75, 0.7))
    db.add(bm_box_mm((-0.072, -0.048, 1.262), (0.072, -0.042, 1.33)), wood, tint=(0.8, 0.75, 0.7))
    kn = bm_lathe([(0, 0), (0.006, 0), (0.005, 0.006), (0.011, 0.012), (0.012, 0.018), (0.009, 0.023),
                   (0, 0.024)], segs=16)
    rot(kn, math.pi / 2, 'X')
    db.add(move(kn, (0, -0.131, 1.3)), brass)
    finish(db, 'SW_Drawer', pivot=(0, -0.128, 1.3), parent='SW_Torso', sharp=45)
    # glowing keyhole (the weak point) on the upper drawer front
    kh = []
    ccx, ccy, cr = 0.0, 0.009, 0.0135
    a0, a1 = math.radians(-58), math.radians(238)
    for k in range(21):
        a = lerp(a0, a1, k / 20)
        kh.append((ccx + cr * math.cos(a), ccy + cr * math.sin(a)))
    kh += [(-0.0095, -0.026), (0.0095, -0.026)]
    kp = bm_prism(kh, 0.0, 0.004)
    rot(kp, math.pi / 2, 'X')
    kc = V((0, -0.1335, 1.4035))
    move(kp, kc + V((0, 0.0005, 0)))
    cb = MB()
    cb.add(kp, core)
    finish(cb, 'SW_Core', pivot=kc, parent='SW_Torso', sharp=30)
    # head: egg under a draped sheet (The Lovers)
    hd = MB()
    hd.add(bm_ico(0.043, 3, center=(0, 0, 1.625)), brass)

    ZG = 1.656                       # neck gather
    ph = [0.5, 1.3, 2.0, 0.2]

    def fold_f(t):
        return (0.55 * math.sin(8 * t + ph[0]) + 0.3 * math.sin(13 * t + ph[1]) +
                0.15 * math.sin(21 * t + ph[2]))

    def hem_z(t):
        s2 = math.sin(t) ** 2
        return 1.565 - 0.075 * s2 - 0.05 * max(0.0, math.sin(t)) + 0.01 * math.sin(3 * t + ph[3])

    def vf(t, r, zp):
        f = fold_f(t)
        if zp < ZG:                   # hanging drape: zp is a 0..1 parameter from hem to gather
            u = (zp - 1.40) / (ZG - 1.40)
            z = lerp(hem_z(t), ZG, u)
            amp = 0.05 + 0.16 * (1.0 - u) ** 1.3
            rr = r * (1 + amp * f)
            sy = 1.12
        else:
            z = zp
            amp = (0.006 + 0.13 * math.exp(-((z - ZG) / 0.016) ** 2) +
                   0.045 * smoothstep(1.79, 1.67, z) * smoothstep(ZG, 1.68, z))
            rr = r * (1 + amp * f)
            dt = (t + math.pi / 2 + math.pi) % TAU - math.pi
            rr += 0.013 * math.exp(-(dt / 0.2) ** 2) * math.exp(-((z - 1.757) / 0.026) ** 2)
            rr += 0.006 * math.exp(-(dt / 0.55) ** 2) * math.exp(-((z - 1.8) / 0.018) ** 2)
            sy = 1.08
        return (rr * math.cos(t), rr * math.sin(t) * sy, z)
    cloth_prof = [(0.128, 1.40), (0.124, 1.45), (0.114, 1.5), (0.1, 1.55), (0.084, 1.59), (0.068, 1.62),
                  (0.057, 1.642), (0.052, ZG), (0.056, 1.668), (0.068, 1.683), (0.082, 1.7),
                  (0.093, 1.72), (0.1, 1.745), (0.104, 1.775), (0.102, 1.805), (0.095, 1.84),
                  (0.082, 1.87), (0.062, 1.892), (0.036, 1.905), (0, 1.909)]
    cloth = bm_lathe(cloth_prof, segs=72, vfun=vf, cap=False)
    cloth = solidify(cloth, 0.005)
    set_smooth(cloth)

    def cloth_tint(co):
        t = math.atan2(co.y / 1.1, co.x)
        f = fold_f(t)
        drape = smoothstep(ZG + 0.005, ZG - 0.04, co.z)
        head = smoothstep(1.8, 1.68, co.z) * (1 - drape)
        k = 1.0 - (0.22 * drape + 0.12 * head) * max(0.0, -f)
        k *= 1.0 - 0.12 * math.exp(-((co.z - ZG) / 0.02) ** 2)
        return (k, k, k * 0.98)
    hd.add(cloth, sheet, tint=cloth_tint)
    for sgn in (-1, 1):
        pts = [(sgn * 0.014, 0.07, 1.655), (sgn * 0.03, 0.13, 1.59), (sgn * 0.042, 0.155, 1.51),
               (sgn * 0.05, 0.152, 1.44), (sgn * 0.056, 0.135, 1.38), (sgn * 0.062, 0.122, 1.33)]
        rad = [(0.02, 0.008), (0.026, 0.007), (0.03, 0.006), (0.033, 0.006), (0.034, 0.006), (0.03, 0.005)]
        tail = bm_tube(pts, rad, sides=10, twist=sgn * 0.6)
        hd.add(tail, sheet, tint=(0.94, 0.94, 0.93))
    finish(hd, 'SW_Head', pivot=(0, 0, 1.62), parent='SW_Torso', sharp=None)
    # arms
    for side, sx in (('L', 1), ('R', -1)):
        sh = V((0.24 * sx, 0, 1.52))
        ab = MB()
        ab.add(bm_ico(0.05, 3, center=sh), brass)
        ab.add(move(bm_lathe([(0, 1.225), (0.03, 1.23), (0.037, 1.26), (0.044, 1.35), (0.047, 1.43),
                              (0.042, 1.47), (0, 1.49)], segs=20, sx=0.95), (sh.x, 0, 0)), manq)
        finish(ab, 'SW_Arm' + side, pivot=sh, parent='SW_Torso', sharp=None, vfn=body_vfn)
        el = V((0.24 * sx, 0, 1.2))
        fb = MB()
        fb.add(bm_ico(0.036, 3, center=el), brass)
        fb.add(move(bm_lathe([(0, 0.95), (0.024, 0.955), (0.029, 0.99), (0.036, 1.08), (0.037, 1.14),
                              (0.03, 1.17), (0, 1.185)], segs=20, sx=0.95), (el.x, 0, 0)), manq)
        fb.add(bm_ico(0.022, 2, center=(el.x, 0, 0.935)), brass)
        fb.add(bm_ico(1.0, 3, center=(el.x, -0.004, 0.845), sc=(0.021, 0.044, 0.074)), manq)
        th = bm_ico(1.0, 2, center=(el.x - sx * 0.004, -0.036, 0.872), sc=(0.012, 0.012, 0.03))
        rot(th, math.radians(-20), 'X', center=(el.x, -0.036, 0.872))
        fb.add(th, manq)
        finish(fb, 'SW_Forearm' + side, pivot=el, parent='SW_Arm' + side, sharp=None, vfn=body_vfn)
    # legs
    for side, sx in (('L', 1), ('R', -1)):
        hip = V((0.11 * sx, 0, 0.93))
        lb = MB()
        lb.add(bm_ico(0.062, 3, center=hip), brass)
        lb.add(move(bm_lathe([(0, 0.54), (0.045, 0.545), (0.055, 0.58), (0.066, 0.7), (0.074, 0.82),
                              (0.07, 0.875), (0.05, 0.905), (0, 0.912)], segs=24, sy=0.95), (hip.x, 0, 0)),
               manq)
        finish(lb, 'SW_Leg' + side, pivot=hip, parent='SW_Hips', sharp=None, vfn=body_vfn)
        knee = V((0.11 * sx, 0, 0.51))
        sb = MB()
        sb.add(bm_ico(0.046, 3, center=knee), brass)
        sb.add(move(bm_lathe([(0, 0.12), (0.03, 0.125), (0.036, 0.18), (0.05, 0.33), (0.054, 0.42),
                              (0.047, 0.47), (0, 0.49)], segs=24, sy=0.92), (knee.x, 0, 0)), manq)
        sb.add(bm_ico(0.03, 2, center=(knee.x, 0, 0.1)), brass)
        foot = bm_ico(1.0, 3, center=(knee.x, -0.045, 0.036), sc=(0.047, 0.125, 0.046))
        for v in foot.verts:
            if v.co.z < 0.0:
                v.co.z = 0.0
        sb.add(foot, manq)
        finish(sb, 'SW_Shin' + side, pivot=knee, parent='SW_Leg' + side, sharp=None, vfn=body_vfn)


def build_unwatched(P):
    ew = material('EyeWhite', '#f6f1e9', 0.0, 0.15)
    irism = material('Iris', '#4a36b0', 0.0, 0.3, emit='#2a1a8c', strength=1.5)
    pupil = material('Pupil', '#050508', 0.0, 0.08)
    flesh = material('Flesh', '#ad8883', 0.0, 0.55)
    lashm = material('Lash', '#1c1411', 0.0, 0.7)
    legm = material('BossLeg', '#d9cba9', 0.0, 0.5)
    rng = random.Random(1946)
    C = V((0, 0, 6.5))
    R = 1.5
    empty('Unwatched')
    # ---- eyeball with bloodshot veins (vertex colour)
    eye = bm_ico(R, 5, center=C)
    axis = V((0, -1, 0))
    # refine the visible cap around the iris so the vein colours stay crisp
    cap_edges = set()
    for f in eye.faces:
        if (f.calc_center_median() - C).normalized().dot(axis) > math.cos(math.radians(72)):
            cap_edges.update(f.edges)
    bmesh.ops.subdivide_edges(eye, edges=list(cap_edges), cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(eye, faces=[f for f in eye.faces if len(f.verts) > 3])
    for v in eye.verts:
        v.co = C + (v.co - C).normalized() * R
    set_smooth(eye)

    def sph(beta, psi):
        # point on the eye at angle beta from the iris axis (-Y), azimuth psi
        return C + R * V((math.sin(beta) * math.cos(psi), -math.cos(beta), math.sin(beta) * math.sin(psi)))
    samples = []

    def grow(beta, psi, w, depth, stop):
        dpsi = rng.uniform(-0.3, 0.3)
        while beta > stop and w > 0.005:
            p = sph(beta, psi)
            samples.append((p, w))
            step = 0.01 / R
            beta -= step * rng.uniform(0.5, 1.1)
            dpsi = clamp(dpsi + rng.uniform(-0.45, 0.45), -1.2, 1.2)
            psi += dpsi * step / max(0.2, math.sin(beta))
            w *= 0.993
            if depth < 3 and rng.random() < 0.02:
                grow(beta, psi, w * 0.7, depth + 1, stop + math.radians(rng.uniform(4, 16)))
    for k in range(46):
        grow(math.radians(rng.uniform(62, 120)), TAU * k / 46 + rng.uniform(-0.08, 0.08),
             rng.uniform(0.024, 0.038), 0, math.radians(rng.uniform(25, 38)))
    kd = KDTree(len(samples))
    for i, (p, w) in enumerate(samples):
        kd.insert(p, i)
    kd.balance()
    vein = hexcol('#b81d24')
    vein = (vein[0] / 0.93, vein[1] / 0.9, vein[2] / 0.87)
    pinkish = (1.0, 0.8, 0.78)

    def eye_tint(co):
        d = (co - C).normalized()
        beta = math.acos(clamp(d.dot(axis), -1, 1))
        c = mix3((1, 1, 1), pinkish, smoothstep(math.radians(60), math.radians(150), beta))
        inten = 0.0
        for (p, i, dist) in kd.find_range(co, 0.07):
            w = samples[i][1]
            inten = max(inten, math.exp(-(dist / w) ** 2))
        c = mix3(c, vein, 0.95 * inten)
        k = 1.0 - 0.25 * math.exp(-((beta - math.radians(22.5)) / math.radians(3.0)) ** 2)
        return (c[0] * k, c[1] * k, c[2] * k)
    ebm = MB()
    ebm.add(eye, ew, tint=eye_tint)
    finish(ebm, 'UW_Body', pivot=C, parent='Unwatched', sharp=None)
    # ---- iris + pupil (spherical caps on the -Y side)
    Mi = Matrix.Translation(C) @ Matrix.Rotation(math.radians(90), 4, 'X')
    Ri, Rp = R + 0.008, R + 0.011
    ib = MB()
    bi, bp = math.radians(21.5), math.radians(8.5)
    iris_prof = [(Ri * math.sin(b), Ri * math.cos(b) + 0.012 * math.sin(math.pi * (b - bp) / (bi - bp)) ** 2)
                 for b in [lerp(bi, bp, k / 9) for k in range(10)]]
    spokes = [rng.uniform(0.55, 1.0) for _ in range(120)]

    def iris_tint(co):
        l = co - C
        t = math.atan2(l.z, l.x)
        s = spokes[int(round((t % TAU) / TAU * 120)) % 120]
        beta = math.acos(clamp(l.normalized().dot(axis), -1, 1))
        u = (beta - bp) / (bi - bp)
        k = s * (1.0 - 0.6 * smoothstep(0.75, 1.0, u)) * (1.0 + 0.35 * math.exp(-((u - 0.2) / 0.1) ** 2))
        k = min(1.0, k)
        return (k, k, k)
    ib.add(xform(bm_lathe(iris_prof, segs=120, cap=False), Mi), irism, tint=iris_tint)
    pup_prof = [(Rp * math.sin(b), Rp * math.cos(b)) for b in [lerp(bp + 0.004, 0.0, k / 4) for k in range(5)]]
    pup_prof[-1] = (0.0, pup_prof[-1][1])
    ib.add(xform(bm_lathe(pup_prof, segs=120, cap=False), Mi), pupil)
    finish(ib, 'UW_Iris', pivot=C, parent='UW_Body', sharp=None)
    # ---- eyelids: fleshy hemispherical shells, open in rest pose
    alpha = math.radians(20.0)

    def lid(name, Rin, Rout, theta, lashes, curl):
        Ml = Matrix.Translation(C) @ Matrix.Rotation(theta, 4, 'X')
        prof = []
        for k in range(16):
            b = math.radians(90) * k / 15
            prof.append((Rin * math.sin(b), Rin * math.cos(b)))
        prof[0] = (0.0, Rin)
        Rm, h, rho = (Rin + Rout) / 2, (Rout - Rin) / 2, 0.07
        for k in range(1, 12):
            g = math.pi * k / 12
            prof.append((Rm - h * math.cos(g) + 0.03 * math.sin(g), -rho * math.sin(g)))
        for k in range(20):
            b = math.radians(90) * (1 - k / 19)
            wr = 0.012 * math.sin(b * 22) * smoothstep(math.radians(45), math.radians(85), b)
            prof.append(((Rout + wr) * math.sin(b), (Rout + wr) * math.cos(b)))
        prof[-1] = (0.0, prof[-1][1])
        shell = bm_lathe(prof, segs=72, phase=math.pi / 72)
        Minv = Ml.inverted()

        def lid_tint(co):
            l = Minv @ co
            rr = l.length
            b = math.atan2(math.hypot(l.x, l.y), l.z)
            if rr < Rin + 0.004 and l.z > 0.0:
                return (0.62, 0.42, 0.42)
            if l.z < 0.01:
                return (1.0, 0.72, 0.7)
            crease = 0.5 + 0.5 * math.sin(b * 22)
            k = 1.0 - 0.25 * (1 - crease) * smoothstep(math.radians(45), math.radians(85), b)
            k *= 1.0 - 0.1 * max(0.0, fbm(co * 1.5, 2))
            return (k, k * 0.96, k * 0.96)
        lb = MB()
        lb.add(xform(shell, Ml), flesh, tint=lid_tint)
        for k in range(lashes):
            ph = -math.pi / 2 + math.radians(62) * (2 * k / (lashes - 1) - 1)
            ph += rng.uniform(-0.02, 0.02)
            out = V((math.cos(ph), math.sin(ph), 0))
            root = out * (Rout + 0.005) + V((0, 0, -rho * 0.7))
            L = rng.uniform(0.26, 0.36) * (1 - 0.35 * abs(2 * k / (lashes - 1) - 1))
            pts = []
            for i in range(6):
                s = i / 5
                pts.append(root + out * (L * 0.75 * s) + V((0, 0, -L * 0.45 * s + curl * L * s * s)))
            tube = bm_tube(pts, [0.02 * (1 - i / 5) ** 0.8 for i in range(6)], sides=5)
            lb.add(xform(tube, Ml), lashm)
        finish(lb, name, pivot=C, parent='UW_Body', sharp=None)
    lid('UW_LidTop', 1.562, 1.605, -alpha, 25, 0.9)
    lid('UW_LidBottom', 1.512, 1.552, math.pi + alpha, 13, 0.6)
    # ---- four spindly legs (Dali's elephants)
    for i, deg in enumerate((45, 135, 225, 315)):
        a = math.radians(deg)
        d = V((math.cos(a), math.sin(a), 0))
        Hp = V((d.x * 1.0, d.y * 1.0, 5.3))
        Kp = V((d.x * 2.9, d.y * 2.9, 4.6))
        Fp = V((d.x * 4.5, d.y * 4.5, 0.0))

        def leg_tint_for(path, base_rad):
            def f(co):
                best, bi = 1e9, 0
                for i_, q in enumerate(path):
                    dd = (co - q).length_squared
                    if dd < best:
                        best, bi = dd, i_
                dist = math.sqrt(best)
                br = base_rad[bi]
                k = lerp(0.36, 1.0, smoothstep(br + 0.004, br + 0.04, dist))
                k *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.8, co.z))
                return (k, k * 0.95, k * 0.88)
            return f
        ub = MB()
        ub.add(bm_ico(0.2, 3, center=Hp), legm, tint=(0.85, 0.8, 0.72))
        n_up = 14
        side = d.cross(V((0, 0, 1)))
        pts, rad = [], []
        base_u = lambda s: 0.09 - 0.015 * s
        for k in range(n_up + 1):
            s = k / n_up
            p = Hp.lerp(Kp, s) + V((0, 0, 0.18 * math.sin(math.pi * s)))
            pts.append(p)
            rad.append(base_u(s) + 0.05 * math.exp(-((s - 0.5) / 0.07) ** 2))
        ub.add(bm_tube(pts, rad, sides=12), legm,
               tint=leg_tint_for(pts, [base_u(k / n_up) for k in range(n_up + 1)]))
        finish(ub, 'UW_Leg%d' % i, pivot=Hp, parent='UW_Body', sharp=None)
        lw = MB()
        lw.add(bm_ico(0.17, 3, center=Kp), legm, tint=(0.95, 0.92, 0.85))
        n_lo = 44
        pts, rad = [], []
        base_l = lambda s: lerp(0.085, 0.05, s)
        for k in range(n_lo + 1):
            s = k / n_lo
            p = Kp.lerp(Fp, s) + d * (0.35 * math.sin(math.pi * s)) + side * (0.08 * math.sin(2 * math.pi * s))
            r = base_l(s)
            for (sc, amp) in ((0.26, 0.05), (0.5, 0.045), (0.72, 0.04)):
                r += amp * math.exp(-((s - sc) / 0.035) ** 2)
            r += 0.03 * math.exp(-((s - 0.93) / 0.025) ** 2)
            r *= smoothstep(1.0, 0.9, s) ** 0.6 if s > 0.9 else 1.0
            pts.append(p)
            rad.append(r)
        rad[-1] = 0.0
        lw.add(bm_tube(pts, rad, sides=10), legm,
               tint=leg_tint_for(pts, [base_l(k / n_lo) * (smoothstep(1.0, 0.9, k / n_lo) ** 0.6 if k / n_lo > 0.9 else 1.0)
                                       for k in range(n_lo + 1)]))
        finish(lw, 'UW_Leg%d_Lower' % i, pivot=Kp, parent='UW_Leg%d' % i, sharp=None)


# ============================================================================
# ROUND 2: Frame, PortalRing, CanvasScrap, NightLight, Easel
# ============================================================================
def bm_beam(p0, p1, w, d, bevel=0.004):
    """Chamfered wooden beam from p0 to p1; w across (horizontal), d in depth."""
    p0, p1 = V(p0), V(p1)
    z = p1 - p0
    L = z.length
    z.normalize()
    x = V((0, 1, 0)).cross(z)
    if x.length < 1e-6:
        x = V((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    bm = bm_box((w, d, L), bevel=bevel, segs=1)
    M = Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))
    return xform(bm, Matrix.Translation((p0 + p1) / 2) @ M)


def easel_stand(mb, wood, brass, H, tray_top, front_y, canvas_d, lean, feet_x=0.4, back_y=0.55,
                mast_top=None, clamp_z=None):
    """Studio A-frame easel.  The A-plane leans back by `lean` over its height;
    the picture stands upright on a ledge in front of it with its front face at
    y = front_y."""
    def ay(z):
        return lean * z / H

    def lx(z):
        return feet_x + (0.03 - feet_x) * z / (H - 0.02)
    for sx in (-1, 1):
        mb.add(bm_beam((sx * feet_x, 0.0, 0.0), (sx * 0.03, ay(H - 0.02), H - 0.02), 0.042, 0.03), wood)
        mb.add(move(bm_lathe([(0, 0), (0.024, 0), (0.024, 0.035), (0, 0.035)], segs=10),
                    (sx * (feet_x - 0.004), 0, 0)), brass)
    zb = 0.32
    mb.add(bm_beam((-lx(zb) - 0.01, ay(zb), zb), (lx(zb) + 0.01, ay(zb), zb), 0.04, 0.026), wood)
    mt = mast_top or H
    mb.add(bm_beam((0, ay(zb - 0.02), zb - 0.02), (0, ay(mt), mt), 0.05, 0.034), wood)
    # ledge with a lip, bracketed back to the legs and the mast
    y_lip = front_y - 0.07
    y_back = front_y + canvas_d + 0.012
    mb.add(bm_box_mm((-0.45, y_lip, tray_top - 0.03), (0.45, y_back, tray_top), bevel=0.005), wood)
    mb.add(bm_box_mm((-0.45, y_lip - 0.012, tray_top - 0.03), (0.45, y_lip + 0.004, tray_top + 0.03),
                     bevel=0.004), wood)
    for xx in (-lx(tray_top), 0.0, lx(tray_top)):
        mb.add(bm_beam((xx, y_back - 0.01, tray_top - 0.015), (xx, ay(tray_top) + 0.01, tray_top - 0.015),
                       0.03, 0.028), wood)
    knob = bm_lathe([(0, 0), (0.012, 0), (0.012, 0.012), (0.022, 0.016), (0.022, 0.026), (0, 0.03)], segs=14)
    rot(knob, -math.pi / 2, 'X')
    mb.add(move(knob, (0, ay(tray_top) + 0.017, tray_top - 0.015)), brass)
    # back leg hinged under the apex
    mb.add(bm_beam((0, ay(H) + 0.03, H - 0.09), (0, back_y, 0.0), 0.04, 0.028), wood)
    mb.add(bm_box((0.09, 0.05, 0.075), center=(0, ay(H) + 0.005, H - 0.05), bevel=0.006), wood)
    pin = bm_lathe([(0, -0.055), (0.009, -0.055), (0.009, 0.055), (0, 0.055)], segs=10)
    rot(pin, math.pi / 2, 'Y')
    mb.add(move(pin, (0, ay(H) + 0.03, H - 0.075)), brass)
    mb.add(move(bm_lathe([(0, 0), (0.018, 0), (0.018, 0.03), (0, 0.03)], segs=10), (0, back_y, 0)), brass)
    if clamp_z is not None:
        # top clamp hung from the apex, pressing on the top of the picture
        mb.add(bm_beam((0, ay(H - 0.09), H - 0.09), (0, ay(clamp_z) + 0.005, clamp_z + 0.03), 0.04, 0.03),
               wood)
        mb.add(bm_box_mm((-0.05, front_y - 0.022, clamp_z), (0.05, ay(clamp_z) + 0.02, clamp_z + 0.036),
                         bevel=0.004), wood)
        mb.add(bm_box_mm((-0.05, front_y - 0.022, clamp_z - 0.03), (0.05, front_y - 0.006, clamp_z + 0.036),
                         bevel=0.003), wood)
        k2 = bm_lathe([(0, 0), (0.01, 0), (0.01, 0.012), (0.02, 0.016), (0.02, 0.026), (0, 0.03)], segs=14)
        mb.add(move(k2, (0, (front_y + ay(clamp_z)) / 2, clamp_z + 0.036)), brass)
    for v in mb.bm.verts:                  # slanted leg ends: sit flat on the ground
        if v.co.z < 0.0:
            v.co.z = 0.0
    return y_lip - 0.012


def bm_mitred_frame(cx, cz, W, H, sec, y_back):
    """Rectangular picture-frame moulding with mitred corners in the XZ plane.
    sec: (u, v), u measured inward from the outer edge, v toward the front (-Y)."""
    bm = bmesh.new()
    rings = []
    for (x, z) in ((cx - W / 2, cz - H / 2), (cx + W / 2, cz - H / 2), (cx + W / 2, cz + H / 2),
                   (cx - W / 2, cz + H / 2)):
        dx, dz = math.copysign(1.0, cx - x), math.copysign(1.0, cz - z)
        rings.append([bm.verts.new((x + dx * u, y_back - v, z + dz * u)) for (u, v) in sec])
    m = len(sec)
    for i in range(4):
        a, b = rings[i], rings[(i + 1) % 4]
        for j in range(m):
            j2 = (j + 1) % m
            bm.faces.new([a[j], a[j2], b[j2], b[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    set_smooth(bm)
    return bm


def bm_shell(R, rings=5, segs=16, depth=0.035, ribs=16, thick=0.014):
    """Scallop-shell fan in local XY (opening toward +Y), domed toward +Z."""
    bm = bmesh.new()
    rows = []
    for i in range(rings + 1):
        rho = R * i / rings
        row = []
        for j in range(segs + 1):
            psi = math.pi * j / segs
            rr = rho * (1 + 0.08 * math.cos(ribs * psi) * (rho / R))
            z = depth * (1 - (rho / R) ** 2) + 0.2 * depth * math.cos(ribs * psi) * (rho / R)
            row.append(bm.verts.new((rr * math.cos(psi), rr * math.sin(psi), z)))
            if i == 0:
                break
        rows.append(row)
    for i in range(1, rings + 1):
        for j in range(segs):
            if i == 1:
                bm.faces.new([rows[0][0], rows[1][j], rows[1][j + 1]])
            else:
                bm.faces.new([rows[i - 1][j], rows[i][j], rows[i][j + 1], rows[i - 1][j + 1]])
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    set_smooth(bm)
    return solidify(bm, thick)


def bm_cscroll(r0, turns=1.25, n=14, thick=0.012, sides=6, phase=0.0, flip=1):
    """Flat C-scroll (spiral tube) in the local XZ plane, centred on the origin."""
    pts, rad = [], []
    for k in range(n):
        s = k / (n - 1)
        r = r0 * (1 - 0.7 * s)
        a = phase + flip * turns * TAU * s
        pts.append((r * math.cos(a), 0.0, r * math.sin(a)))
        rad.append(thick * (1 - 0.55 * s))
    return bm_tube(pts, rad, sides=sides)


def gilt_tint(front_y, depth):
    """Gilding: bright on the high points, reddish bole in the recesses."""
    bole = (0.6, 0.44, 0.36)

    def f(co):
        v = front_y + depth - co.y       # height above the back plane
        t = smoothstep(0.35 * depth, 0.85 * depth, v)
        return mix3(bole, (1.0, 1.0, 1.0), t)
    return f


def recenter(mbs, pivots, ref=None):
    """Centre the XY bounding box of `ref` (default: all builders) on the origin
    and move every builder and pivot by the same offset."""
    ref = ref or mbs
    xs = [v.co.x for m in ref for v in m.bm.verts]
    ys = [v.co.y for m in ref for v in m.bm.verts]
    off = V((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, 0.0))
    for m in mbs:
        move(m.bm, off)
    return [V(p) + off for p in pivots]


FRAME_SEC = [(0.0, 0.0), (0.1, 0.0), (0.1, 0.018), (0.095, 0.028), (0.087, 0.031), (0.079, 0.04),
             (0.068, 0.045), (0.057, 0.041), (0.05, 0.033), (0.041, 0.039), (0.03, 0.05), (0.018, 0.048),
             (0.009, 0.041), (0.003, 0.031), (0.0, 0.016)]


def build_frame(P):
    """Magritte's La condition humaine: an easel holding an empty gilt frame."""
    gilt, brass = P['gilt'], P['brass']
    wood = material('EaselWood', '#a8763f', 0.0, 0.55)
    glow = material('FrameOpening', '#bddcf6', 0.0, 0.2, emit='#bddcf6', strength=0.6, alpha=0.35,
                    double=True)
    H, tray_top, fy = 1.9, 0.75, -0.1
    FW, FH, FD = 0.8, 1.0, 0.05
    cz = tray_top + FH / 2
    mb = MB()
    easel_stand(mb, wood, brass, H, tray_top, fy, FD, lean=0.06, back_y=0.52, mast_top=tray_top - 0.02,
                clamp_z=tray_top + FH)
    mb.add(bm_mitred_frame(0.0, cz, FW, FH, FRAME_SEC, fy + FD), gilt, tint=gilt_tint(fy, FD))
    tint = gilt_tint(fy - 0.03, FD)
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        cx_, cz_ = sx * (FW / 2 - 0.05), cz + sz * (FH / 2 - 0.05)
        base = math.atan2(-sz, -sx)
        for k in range(3):
            a = base + (k - 1) * 0.75
            leaf = bm_ico(1.0, 1, sc=(0.042, 0.011, 0.015))
            rot(leaf, -a, 'Y')
            mb.add(move(leaf, (cx_ - 0.018 * math.cos(a), fy - 0.004, cz_ - 0.018 * math.sin(a))), gilt,
                   tint=tint)
        sc = bm_cscroll(0.03, turns=1.2, thick=0.008, phase=base + math.pi, flip=sx * sz)
        mb.add(move(sc, (cx_, fy - 0.006, cz_)), gilt, tint=tint)
    for sx in (-1, 1):
        sh = bm_shell(0.055, rings=4, segs=12, depth=0.02, ribs=12, thick=0.01)
        rot(sh, -sx * math.pi / 2, 'Z')
        xform(sh, Matrix.Translation(V((sx * (FW / 2 - 0.03), fy - 0.002, cz))) @
              Matrix.Rotation(math.radians(90), 4, 'X'))
        mb.add(sh, gilt, tint=tint)
    # the see-through opening (shimmer quad), 0.6 x 0.8, UVs 0..1
    x0, x1 = -FW / 2 + 0.1, FW / 2 - 0.1
    z0, z1 = cz - FH / 2 + 0.1, cz + FH / 2 - 0.1
    yq = fy + FD * 0.5
    q = bmesh.new()
    q.faces.new([q.verts.new((x0, yq, z0)), q.verts.new((x1, yq, z0)), q.verts.new((x1, yq, z1)),
                 q.verts.new((x0, yq, z1))])
    ob_ = MB()
    ob_.add(q, glow, smooth=False, uv=lambda co: ((co.x - x0) / (x1 - x0), (co.z - z0) / (z1 - z0)))
    (piv,) = recenter([mb, ob_], [(0.0, yq, cz)])
    finish(mb, 'Frame', sharp=40, weighted=True, vfn=ao_fn(h=0.25, amt=0.25))
    finish(ob_, 'Frame_Opening', pivot=piv, parent='Frame', sharp=None)


PORTAL_SEC = [(-0.13, -0.04), (0.0, -0.04), (0.0, -0.006), (-0.008, 0.012), (-0.02, 0.018), (-0.031, 0.03),
              (-0.043, 0.034), (-0.054, 0.027), (-0.066, 0.02), (-0.08, 0.03), (-0.095, 0.04), (-0.11, 0.037),
              (-0.123, 0.024), (-0.13, 0.006)]


def build_portal_ring(P):
    """Rococo gilt oval frame drawn around a portal; open 1.2 x 2.0 ellipse."""
    gold = material('PortalGilt', '#e6b54e', 1.0, 0.25)
    a, b = 0.6, 1.0
    N = 72
    pts, rad = [], []
    for i in range(N):
        t = TAU * i / N
        pts.append((a * math.cos(t), 0.0, b * math.sin(t)))
        bump = (0.5 + 0.5 * math.cos(10 * t)) ** 1.5
        rad.append((1.0 + 0.22 * bump, 1.0 + 0.12 * bump))
    mb = MB()
    tint = gilt_tint(-0.04, 0.08)
    mb.add(bm_tube(pts, rad, closed=True, section=PORTAL_SEC, fixed_b=(0, -1, 0)), gold, tint=tint)
    Mf = Matrix.Rotation(math.radians(90), 4, 'X')        # local z -> -Y, local y -> +Z
    crest = bm_shell(0.15, rings=5, segs=14, depth=0.04, ribs=14, thick=0.016)
    xform(crest, Matrix.Translation(V((0, -0.038, b + 0.085))) @ Mf)
    mb.add(crest, gold, tint=tint)
    mb.add(bm_ico(0.022, 1, center=(0, -0.045, b + 0.255)), gold)
    drop = bm_shell(0.09, rings=4, segs=12, depth=0.03, ribs=12, thick=0.014)
    rot(drop, math.pi, 'Z')
    xform(drop, Matrix.Translation(V((0, -0.038, -b - 0.075))) @ Mf)
    mb.add(drop, gold, tint=tint)
    for sx in (-1, 1):
        sc = bm_cscroll(0.06, turns=1.3, thick=0.015, phase=0.0 if sx > 0 else math.pi, flip=-sx)
        mb.add(move(sc, (sx * 0.175, -0.042, b + 0.07)), gold, tint=tint)
        sc = bm_cscroll(0.065, turns=1.3, thick=0.016, phase=math.pi / 2, flip=sx)
        mb.add(move(sc, (sx * (a + 0.16), -0.03, 0.0)), gold, tint=tint)
        for tz in (0.55, -0.55):
            t = math.asin(tz)
            px, pz = sx * a * math.cos(t) * 1.13, b * math.sin(t) * 1.08
            leaf = bm_ico(1.0, 1, sc=(0.05, 0.014, 0.022))
            rot(leaf, -math.atan2(pz, px) - sx * 0.5, 'Y')
            mb.add(move(leaf, (px, -0.05, pz)), gold, tint=tint)
    finish(mb, 'PortalRing', sharp=45, vfn=lambda co, n, f: grey(1.0 - 0.3 * smoothstep(0.2, 1.0, n.y)))


def build_canvas_scrap(P):
    """A torn corner of L'Homme au Chapeau: sky, sand and a sliver of bowler hat."""
    paint = material('CanvasPaint', '#ffffff', 0.0, 0.62)
    linen = material('Linen', '#d8cbaf', 0.0, 0.95)
    brass = P['brass']
    rng = random.Random(1958)
    NU, NV = 20, 14
    W, H, TH = 0.45, 0.32, 0.0025

    def en(s, k, amp=1.0):
        return amp * (0.011 * noise.noise(V((s * 5.0, k * 3.1, 0.5))) +
                      0.006 * noise.noise(V((s * 17.0, k * 1.7, 2.5))))

    def L(t):
        return -W / 2 + en(t, 1)

    def R(t):
        return W / 2 + en(t, 2) - 0.07 * smoothstep(0.32, 0.0, t)

    def B(s):
        return -H / 2 + en(s, 3) + 0.06 * smoothstep(0.72, 1.0, s)

    def T(s):
        return H / 2 + en(s, 4, 1.4)
    grid = []
    for i in range(NU + 1):
        s = i / NU
        col = []
        for j in range(NV + 1):
            t = j / NV
            x = lerp(L(t), R(t), s)
            z = lerp(B(s), T(s), t)
            if i in (0, NU) or j in (0, NV):         # frayed, fibrous tear
                jx = rng.uniform(-0.004, 0.004)
                jz = rng.uniform(-0.004, 0.004)
                x += jx if i in (0, NU) else jx * 0.3
                z += jz if j in (0, NV) else jz * 0.3
            y = 0.016 * (2 * s - 1) ** 2 + 0.03 * smoothstep(0.55, 1.0, s) * smoothstep(0.5, 1.0, t) \
                + 0.012 * smoothstep(0.3, 0.0, t) * smoothstep(0.4, 0.0, s)
            col.append(V((x, y, z)))
        grid.append(col)
    xs = [p.x for c in grid for p in c]
    zs = [p.z for c in grid for p in c]
    ys = [p.y for c in grid for p in c]
    off = V((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2 - TH / 2, -(max(zs) + min(zs)) / 2))
    grid = [[p + off for p in c] for c in grid]
    # the painted image (linear colours)
    sky_hi, sky_lo = hexcol('#5f8fcc'), hexcol('#c3d8ec')
    sand_hi, sand_lo = hexcol('#dcab5c'), hexcol('#a8773c')
    black = hexcol('#141318')

    def painted(p, s, t):
        hz = -0.02 + 0.012 * math.sin(p.x * 9.0)
        if p.z > hz:
            c = mix3(sky_lo, sky_hi, smoothstep(hz, H / 2, p.z))
            k = 1.0 + 0.16 * noise.noise(V((p.x * 7.0, p.z * 34.0, 1.0))) + \
                0.08 * noise.noise(V((p.x * 23.0, p.z * 9.0, 4.0)))
            c = mix3(c, hexcol('#e9eef2'), 0.35 * max(0.0, noise.noise(V((p.x * 5.0, p.z * 11.0, 7.0)))))
        else:
            c = mix3(sand_hi, sand_lo, smoothstep(hz, -H / 2, p.z))
            k = 1.0 + 0.2 * noise.noise(V(((p.x + p.z) * 26.0, (p.x - p.z) * 5.0, 3.0)))
        c = mix3(c, sand_hi, 0.6 * smoothstep(0.012, 0.0, abs(p.z - hz)))
        hx, hzc = 0.165, 0.035
        dome = ((p.x - hx) / 0.08) ** 2 + ((p.z - hzc) / 0.085) ** 2
        brim = ((p.x - hx) / 0.13) ** 2 + ((p.z - hzc + 0.004) / 0.016) ** 2
        hat = max(smoothstep(1.1, 0.9, dome) * smoothstep(hzc - 0.01, hzc, p.z), smoothstep(1.12, 0.88, brim))
        c = mix3(c, black, 0.97 * hat)
        return (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k))
    front = bmesh.new()
    fv = [[front.verts.new(p) for p in c] for c in grid]
    for i in range(NU):
        for j in range(NV):
            front.faces.new([fv[i][j], fv[i + 1][j], fv[i + 1][j + 1], fv[i][j + 1]])
    set_smooth(front)
    cols = [painted(grid[i][j], i / NU, j / NV) for i in range(NU + 1) for j in range(NV + 1)]
    back = bmesh.new()
    bv = [[back.verts.new(p + V((0, TH, 0))) for p in c] for c in grid]
    for i in range(NU):
        for j in range(NV):
            back.faces.new([bv[i][j], bv[i][j + 1], bv[i + 1][j + 1], bv[i + 1][j]])
    ring = [(i, 0) for i in range(NU)] + [(NU, j) for j in range(NV)] + \
           [(i, NV) for i in range(NU, 0, -1)] + [(0, j) for j in range(NV, 0, -1)]
    rim = [(back.verts.new(grid[i][j]), bv[i][j]) for (i, j) in ring]
    for k in range(len(rim)):
        a0, a1 = rim[k]
        b0, b1 = rim[(k + 1) % len(rim)]
        back.faces.new([a0, b0, b1, a1])
    set_smooth(back)
    mb = MB()
    mb.add(front, paint, vtint=cols)
    mb.add(back, linen, tint=lambda co: grey(0.9 + 0.1 * noise.noise(co * 60.0)))
    corner = grid[2][NV - 2]
    head = bm_lathe([(0, 0), (0.011, 0), (0.0105, 0.0015), (0.008, 0.0035), (0, 0.0045)], segs=16)
    rot(head, math.pi / 2, 'X')
    mb.add(move(head, corner + V((0, -0.0004, 0))), brass)
    pin = bm_lathe([(0, 0.0), (0.0016, 0.0), (0.0012, 0.018), (0, 0.021)], segs=6)
    rot(pin, -math.pi / 2, 'X')
    mb.add(move(pin, corner), brass)
    finish(mb, 'CanvasScrap', sharp=60)


def build_night_light(P):
    """The narrator: Odile's window candle, floating in a squat preserving jar."""
    glass = material('JarGlass', '#d9efe7', 0.0, 0.05, alpha=0.3)
    tin = material('Tin', '#aeaea8', 0.9, 0.38)
    wire = material('Wire', '#77736b', 0.85, 0.42)
    wax = material('Wax', '#f3e9d0', 0.0, 0.42)                       # shared with Candle
    flame = material('Flame', '#ffbe5a', 0.0, 0.5, emit='#ff8f24', strength=5.0)
    wick = material('Wick', '#2a2018', 0.0, 0.9)
    rng = random.Random(1961)
    mb = MB()
    jar = bm_lathe([(0, -0.095), (0.066, -0.095), (0.08, -0.091), (0.0855, -0.078), (0.087, -0.03),
                    (0.086, 0.03), (0.081, 0.05), (0.07, 0.064), (0.0625, 0.071), (0.0625, 0.092),
                    (0.0605, 0.096), (0.0575, 0.094), (0.0575, 0.072), (0.065, 0.064), (0.077, 0.049),
                    (0.0825, 0.03), (0.0835, -0.03), (0.0825, -0.076), (0.078, -0.087), (0.064, -0.0905),
                    (0, -0.0905)], segs=48)
    mb.add(jar, glass, tint=lambda co: grey(1.0 - 0.1 * smoothstep(-0.07, -0.095, co.z)))

    def lid_v(t, r, z):
        rr = r
        if r > 0.068 and 0.081 < z < 0.102:
            rr = r * (1 + 0.016 * math.cos(48 * t))
        x, y, zz = rr * math.cos(t), rr * math.sin(t), z
        if z > 0.104:
            zz -= 0.0045 * math.exp(-((x - 0.022) ** 2 + (y + 0.024) ** 2) / 0.013 ** 2)
        return (x, y, zz)
    lid = bm_lathe([(0, 0.099), (0.059, 0.099), (0.0605, 0.095), (0.0605, 0.08), (0.0665, 0.0775),
                    (0.0688, 0.08), (0.0688, 0.1025), (0.0668, 0.1065), (0.06, 0.1085), (0.04, 0.1095),
                    (0.018, 0.1098), (0, 0.11)], segs=64, vfun=lid_v)
    mb.add(lid, tin, tint=lambda co: grey(1.0 - 0.3 * max(0.0, fbm(co * 70.0, 2))) if co.z > 0.1 else
           (0.92, 0.9, 0.86))
    # neck wire with two ears and a bail arching over the lid (tipped back a little)
    mb.add(bm_tube([(0.0645 * math.cos(TAU * k / 40), 0.0645 * math.sin(TAU * k / 40), 0.0725)
                    for k in range(40)], 0.0022, sides=6, closed=True, fixed_b=(0, 0, 1)), wire)
    for sx in (-1, 1):
        mb.add(bm_tube([(sx * (0.0715 + 0.0065 * math.cos(TAU * k / 16)), 0, 0.0725 + 0.0065 *
                         math.sin(TAU * k / 16)) for k in range(16)], 0.002, sides=6, closed=True,
                       fixed_b=(0, 1, 0)), wire)
    bail = [(0.0715 * math.cos(math.pi * k / 20), 0.0, 0.0725 + 0.09 * math.sin(math.pi * k / 20))
            for k in range(21)]
    bail_bm = bm_tube(bail, 0.0024, sides=6)
    rot(bail_bm, math.radians(-14), 'X', center=(0, 0, 0.0725))
    mb.add(bail_bm, wire)
    # half-melted stub, pooled on the floor of the jar
    def stub_v(t, r, z):
        rr, zz = r, z
        if z < -0.081:
            rr = r * (1 + 0.16 * math.sin(3 * t + 0.4) + 0.07 * math.sin(5 * t + 1.1))
        if z > -0.046:
            zz = z + 0.007 * math.sin(t + 0.6) + 0.003 * math.sin(3 * t + 1.0)
        return (rr * math.cos(t), rr * math.sin(t), zz)
    stub = bm_lathe([(0, -0.0903), (0.05, -0.0903), (0.058, -0.0885), (0.053, -0.085), (0.036, -0.082),
                     (0.029, -0.078), (0.028, -0.06), (0.0285, -0.044), (0.0265, -0.039), (0.018, -0.037),
                     (0.007, -0.041), (0, -0.042)], segs=28, vfun=stub_v)
    mb.add(stub, wax)
    for k in range(4):
        th = TAU * k / 4 + rng.uniform(-0.4, 0.4)
        L = rng.uniform(0.018, 0.04)
        pts = [((0.029) * math.cos(th), 0.029 * math.sin(th), -0.04 - L * i / 6) for i in range(7)]
        mb.add(bm_tube(pts, [0.0035, 0.004, 0.0042, 0.0045, 0.005, 0.0055, 0.0], sides=6), wax)
    mb.add(bm_tube([(0, 0, -0.042), (0, 0, -0.034), (0.0015, 0, -0.029)], [0.0016, 0.0015, 0.001], sides=5),
           wick)
    finish(mb, 'NightLight', sharp=50, vfn=lambda co, n, f: grey(1.0 - 0.15 * smoothstep(0.0, -1.0, n.z)))
    fb = MB()
    base = V((0.0015, 0.0, -0.0305))
    fl = bm_lathe([(0, 0), (0.006, 0.003), (0.011, 0.013), (0.0125, 0.025), (0.011, 0.036),
                   (0.0075, 0.047), (0.0035, 0.056), (0, 0.063)], segs=18, sy=0.85)
    fb.add(move(fl, base), flame)
    finish(fb, 'NightLight_Flame', pivot=base, parent='NightLight', sharp=None)


def drape_box(nu, nv, u0, u1, v0, v1, x0, x1, y0, y1, top, rho, amp, seed, freq=10.0, flare=0.0, skew=0.0,
              back_amp=1.0):
    """Cloth thrown over the rectangle [x0,x1] x [y0,y1] at height `top`,
    hanging on every side.  Grid (u, v) are flat-sheet coordinates.  flare
    swings the front (-Y) hem outward, skew lifts one side of the hem and
    back_amp scales the folds of the flap hanging behind (+Y)."""
    bm = bm_grid(nu, nv, u0, u1, v0, v1)
    ph = seed * 1.7
    arc = math.pi * rho / 2
    for v in bm.verts:
        u, w = v.co.x, v.co.y
        bx, by = clamp(u, x0, x1), clamp(w, y0, y1)
        ex, ey = abs(u - bx), abs(w - by)
        e = math.hypot(ex, ey)
        if e <= 1e-9:
            v.co = V((u, w, top))
            continue
        d = V(((u - bx) / e, (w - by) / e, 0.0))
        if e < arc:
            ang = e / rho
            h, dz, hang = rho * math.sin(ang), rho * (1 - math.cos(ang)), 0.0
        else:
            h, dz, hang = rho, rho + (e - arc), e - arc
        s = u if ey >= ex else w
        fold = amp * smoothstep(0.0, 0.35, hang) * (0.55 * math.sin(freq * s + ph) +
                                                    0.3 * math.sin(2.3 * freq * s + 2 * ph) +
                                                    0.15 * math.sin(5.1 * freq * s + 3 * ph))
        front = d.y < -0.5
        if d.y > 0.5:
            fold *= back_amp
        out = h + fold * (1 + 0.6 * smoothstep(0.3, 1.0, hang)) + (flare * hang * hang if front else 0.0)
        if flare and front:
            # tension folds radiating from the two top corners of whatever it hangs over
            for cx_ in (x0, x1):
                dxc, dzc = bx - cx_, hang
                dist = math.hypot(dxc, dzc)
                ang = math.atan2(dzc, abs(dxc) + 1e-6)
                out += 0.6 * amp * math.sin(9.0 * ang + ph) * smoothstep(0.05, 0.3, dist) * \
                    (1.0 - smoothstep(0.45, 0.8, dist))
        if flare:
            out = max(out, 0.6 * h)        # never sink into the canvas it hangs over
        hem = 0.02 * math.sin(7.0 * s + ph) * smoothstep(0.6, 1.0, hang)
        v.co = V((bx, by, top - dz + skew * u * smoothstep(0.2, 1.0, hang) + hem)) + d * out
    set_smooth(bm)
    return bm


def build_easel(P):
    """The ending: the unfinished painting on its easel, under a dust sheet."""
    wood = material('EaselWood', '#a8763f', 0.0, 0.55)
    linen = material('Linen', '#d8cbaf', 0.0, 0.95)
    painting = material('Painting', '#ffffff', 0.0, 0.8)
    brass, sheet = P['brass'], P['sheet']
    H, tray_top, cf, cd = 1.95, 0.74, -0.1, 0.025
    CW, CH = 0.8, 1.0
    mb = MB()
    easel_stand(mb, wood, brass, H, tray_top, cf, cd, lean=0.03, back_y=0.6, mast_top=H - 0.08)
    x0, x1, z0, z1 = -CW / 2, CW / 2, tray_top, tray_top + CH

    def uvf(co):
        return ((co.x - x0) / CW, (co.z - z0) / CH)
    cb = MB()
    q = bmesh.new()
    q.faces.new([q.verts.new((x0, cf, z0)), q.verts.new((x1, cf, z0)), q.verts.new((x1, cf, z1)),
                 q.verts.new((x0, cf, z1))])
    cb.add(q, painting, smooth=False, uv=uvf)
    sides = bm_box_mm((x0, cf, z0), (x1, cf + cd, z1), smooth=False)
    sides.normal_update()
    bmesh.ops.delete(sides, geom=[f for f in sides.faces if abs(f.normal.y) > 0.9], context='FACES_ONLY')
    cb.add(sides, linen, uv=uvf)
    bk = bmesh.new()
    bk.faces.new([bk.verts.new((x0, cf + 0.003, z0)), bk.verts.new((x0, cf + 0.003, z1)),
                  bk.verts.new((x1, cf + 0.003, z1)), bk.verts.new((x1, cf + 0.003, z0))])
    cb.add(bk, linen, smooth=False, uv=uvf, tint=(0.85, 0.82, 0.78))
    g, sw = 0.002, 0.045
    for (a, b_) in (((x0 + g, z0 + g), (x1 - g, z0 + sw)), ((x0 + g, z1 - sw), (x1 - g, z1 - g)),
                    ((x0 + g, z0 + sw), (x0 + sw, z1 - sw)), ((x1 - sw, z0 + sw), (x1 - g, z1 - sw)),
                    ((-0.02, z0 + sw), (0.02, z1 - sw))):
        cb.add(bm_box_mm((a[0], cf + 0.004, a[1]), (b_[0], cf + cd - 0.001, b_[1]), bevel=0.002, segs=1),
               wood, uv=uvf, tint=(0.8, 0.75, 0.7))
    sb = MB()
    rho = 0.03
    Lf = rho * math.pi / 2 + 1.02          # front hang: bellies out over the ledge lip
    Lb = rho * math.pi / 2 + 0.42          # shorter flap behind the canvas
    Ls = rho * math.pi / 2 + 0.3           # sides
    cloth = drape_box(40, 58, x0 - Ls - 0.05, x1 + Ls, cf - Lf, cf + cd + Lb, x0 - 0.004, x1 + 0.004,
                      cf - 0.004, cf + cd + 0.004, z1 + 0.004, rho, 0.034, 5, freq=9.0, flare=0.14,
                      skew=0.045, back_amp=0.35)
    ledge = [v.co for v in cloth.verts if v.co.z < tray_top + 0.04 and abs(v.co.x) < 0.46 and
             cf - 0.087 < v.co.y < cf + cd + 0.02]
    assert not ledge, 'dust sheet intersects the ledge (%d verts)' % len(ledge)
    cloth_tree = BVHTree.FromBMesh(cloth)
    for part, label in ((mb.bm, 'easel'), (cb.bm, 'canvas')):
        hits = cloth_tree.overlap(BVHTree.FromBMesh(part))
        assert not hits, 'dust sheet intersects the %s (%d triangle pairs)' % (label, len(hits))
    sb.add(cloth, sheet)
    pivots = recenter([mb, cb, sb], [(0, cf, (z0 + z1) / 2), (0, cf + cd / 2, z1)], ref=[mb])
    finish(mb, 'Easel', sharp=40, weighted=True, vfn=ao_fn(h=0.25, amt=0.25))
    finish(cb, 'Easel_Canvas', pivot=pivots[0], parent='Easel', sharp=40)
    finish(sb, 'Easel_Sheet', pivot=pivots[1], parent='Easel', sharp=None,
           vfn=lambda co, n, f: grey(1.0 - 0.18 * smoothstep(0.2, -0.9, n.z) - 0.1 * (1 - abs(n.z)) *
                                     max(0.0, -n.y)))


# ============================================================================
# build / export / verify
# ============================================================================
BUILDERS = [
    ('Clock', build_clock), ('Cloud', build_cloud), ('Mirror', build_mirror), ('Candle', build_candle),
    ('Anvil', build_anvil), ('Bed', build_bed), ('BowlerHat', build_bowler), ('Birdcage', build_birdcage),
    ('Pomegranate', build_pomegranate), ('Wall', build_wall), ('Wall_Fractured', build_wall_fractured),
    ('Column', build_column), ('Column_Fractured', build_column_fractured), ('Drawers', build_drawers),
    ('Drawers_Fractured', build_drawers_fractured), ('Arch', build_arch), ('DeadTree', build_dead_tree),
    ('Door', build_door), ('Rocks', build_rocks), ('Platform', build_platform), ('RailPost', build_railpost),
    ('Train', build_train), ('Apple', build_apple), ('Sleepwalker', build_sleepwalker),
    ('Unwatched', build_unwatched),
    ('Frame', build_frame), ('PortalRing', build_portal_ring), ('CanvasScrap', build_canvas_scrap),
    ('NightLight', build_night_light), ('Easel', build_easel),
]

# (name, parent, expected world pivot or None)
CONTRACT = [
    ('Clock', None, (0, 0, 0)), ('Clock_HandHour', 'Clock', None), ('Clock_HandMinute', 'Clock', None),
    ('Cloud', None, (0, 0, 0)), ('Mirror', None, (0, 0, 0)), ('Mirror_Glass', 'Mirror', None),
    ('Candle', None, (0, 0, 0)), ('Candle_Flame', 'Candle', None), ('Anvil', None, (0, 0, 0)),
    ('Bed', None, (0, 0, 0)), ('Bed_Pillow', 'Bed', None), ('BowlerHat', None, (0, 0, 0)),
    ('Birdcage', None, (0, 0, 0)), ('Pomegranate', None, (0, 0, 0)),
    ('Pomegranate_Seeds', 'Pomegranate', None), ('Wall', None, (0, 0, 0)),
    ('Wall_Fractured', None, (0, 0, 0)), ('Column', None, (0, 0, 0)), ('Column_Fractured', None, (0, 0, 0)),
    ('Drawers', None, (0, 0, 0)), ('Drawers_Fractured', None, (0, 0, 0)), ('Arch', None, (0, 0, 0)),
    ('DeadTree', None, (0, 0, 0)), ('Door', None, (0, 0, 0)), ('Door_Leaf', 'Door', None),
    ('Door_Light', 'Door', None), ('Rock_A', None, (0, 0, 0)), ('Rock_B', None, (0, 0, 0)),
    ('Rock_C', None, (0, 0, 0)), ('Platform', None, (0, 0, 0)), ('RailPost', None, (0, 0, 0)),
    ('Train', None, (0, 0, 0)), ('Apple', None, (0, 0, 0)),
    ('Sleepwalker', None, (0, 0, 0)), ('SW_Hips', 'Sleepwalker', (0, 0, 0.95)),
    ('SW_Torso', 'SW_Hips', (0, 0, 1.0)), ('SW_Drawer', 'SW_Torso', None), ('SW_Core', 'SW_Torso', None),
    ('SW_Head', 'SW_Torso', (0, 0, 1.62)), ('SW_ArmL', 'SW_Torso', (0.24, 0, 1.52)),
    ('SW_ArmR', 'SW_Torso', (-0.24, 0, 1.52)), ('SW_ForearmL', 'SW_ArmL', None),
    ('SW_ForearmR', 'SW_ArmR', None), ('SW_LegL', 'SW_Hips', (0.11, 0, 0.93)),
    ('SW_LegR', 'SW_Hips', (-0.11, 0, 0.93)), ('SW_ShinL', 'SW_LegL', None), ('SW_ShinR', 'SW_LegR', None),
    ('Unwatched', None, (0, 0, 0)), ('UW_Body', 'Unwatched', (0, 0, 6.5)),
    ('UW_Iris', 'UW_Body', (0, 0, 6.5)), ('UW_LidTop', 'UW_Body', (0, 0, 6.5)),
    ('UW_LidBottom', 'UW_Body', (0, 0, 6.5)),
] + [('UW_Leg%d' % i, 'UW_Body', None) for i in range(4)] + \
    [('UW_Leg%d_Lower' % i, 'UW_Leg%d' % i, None) for i in range(4)] + [
    ('Frame', None, (0, 0, 0)), ('Frame_Opening', 'Frame', None), ('PortalRing', None, (0, 0, 0)),
    ('CanvasScrap', None, (0, 0, 0)), ('NightLight', None, (0, 0, 0)),
    ('NightLight_Flame', 'NightLight', None), ('Easel', None, (0, 0, 0)), ('Easel_Canvas', 'Easel', None),
    ('Easel_Sheet', 'Easel', None)]

# round-2 checks: blended materials, UV'd meshes (node, material -> expected UV range), triangle caps
BLEND_MATERIALS = ['FrameOpening', 'JarGlass']
UV_CHECKS = [('Frame_Opening', 'FrameOpening'), ('Easel_Canvas', 'Painting')]
TRI_CAPS = {'PortalRing': 4000, 'CanvasScrap': 1500,
            # round-3 per-root budgets from the perf pass (all children included)
            'Pomegranate': 1200, 'BowlerHat': 1200, 'Candle': 1200, 'Clock': 2000, 'RailPost': 2000,
            'Birdcage': 3000, 'Mirror': 3000, 'Drawers': 3000, 'Platform': 3500, 'Bed': 6000,
            'DeadTree': 6000, 'Column': 6000, 'Wall': 6000, 'Rock_A': 1500, 'Rock_B': 1500, 'Rock_C': 1500,
            'Train': 8000,
            # a broken prop should not cost more than the intact one
            'Wall_Fractured': 6000, 'Column_Fractured': 6000, 'Drawers_Fractured': 3000}
CHUNK_TRI_CAP = 300   # each fracture chunk (CHUNK_TRIS is the decimation target)

REQUIRED_MATERIALS = ['MirrorGlass', 'Flame', 'Seeds', 'WoodInterior',
                      'EnemyCore', 'Mannequin', 'Sheet', 'EyeWhite', 'Flesh', 'BossLeg', 'Iris', 'DoorLight',
                      'FrameOpening', 'PortalGilt', 'JarGlass', 'Painting',
                      'TX_stucco', 'TX_stone', 'TX_marble', 'TX_schist', 'TX_sandstone', 'TX_oak', 'TX_wood',
                      'TX_plaster', 'TX_iron']
# the textured (round 3) assets and their chunk templates: (parent, chunk count)
TX_ASSETS = ['Wall', 'Wall_Fractured', 'Column', 'Column_Fractured', 'Drawers', 'Drawers_Fractured', 'Arch',
             'DeadTree', 'Door', 'Rock_A', 'Rock_B', 'Rock_C', 'Platform', 'RailPost', 'Train', 'Bed']
CHUNKS = {'Wall_Fractured': ('Wall', 24), 'Column_Fractured': ('Column', 15), 'Drawers_Fractured': ('Drawers', 14)}


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_cameras=False,
                              export_lights=False, export_vertex_color='MATERIAL',
                              export_animations=False, export_extras=False)


def read_glb_json(path):
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + ln]), len(data)


def read_accessor(path, js, idx):
    """Float VEC2/VEC3 accessor -> list of tuples (for UV range checks)."""
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    bin_start = 20 + ln + 8
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    n = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[acc['type']]
    stride = bv.get('byteStride', 4 * n)
    off = bin_start + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return [struct.unpack_from('<%df' % n, data, off + i * stride) for i in range(acc['count'])]


def world_bbox(ob):
    mn = V((1e9, 1e9, 1e9))
    mx = V((-1e9, -1e9, -1e9))
    found = False
    for o in [ob] + list(ob.children_recursive):
        if o.type != 'MESH':
            continue
        M = o.matrix_world
        for v in o.data.vertices:
            p = M @ v.co
            mn = V((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
            mx = V((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
            found = True
    return (mn, mx) if found else (V((0, 0, 0)), V((0, 0, 0)))


def verify(path):
    verify.path = path
    print('\n==== VERIFY %s ====' % path)
    js, size = read_glb_json(path)
    tris = 0
    per_mesh = {}
    no_col = []
    for m in js['meshes']:
        t = 0
        for pr in m['primitives']:
            t += js['accessors'][pr['indices']]['count'] // 3
            if 'COLOR_0' not in pr['attributes']:
                no_col.append(m['name'])
        per_mesh[m['name']] = t
        tris += t
    mats = [m['name'] for m in js.get('materials', [])]
    round2_errors = []
    for m in js.get('materials', []):
        if m['name'] in BLEND_MATERIALS:
            print('   %-12s alphaMode=%s alpha=%.2f doubleSided=%s' % (
                m['name'], m.get('alphaMode'), m['pbrMetallicRoughness'].get('baseColorFactor', [1] * 4)[3],
                m.get('doubleSided', False)))
            if m.get('alphaMode') != 'BLEND':
                round2_errors.append('%s is not alpha-blended' % m['name'])
    uv_meshes = sorted({m['name'] for m in js['meshes'] for pr in m['primitives'] if 'TEXCOORD_0' in pr['attributes']})
    print('meshes with TEXCOORD_0:', uv_meshes)
    for node_name, mat_name in UV_CHECKS:
        nd = next((n for n in js['nodes'] if n.get('name') == node_name), None)
        if nd is None:
            continue
        for pr in js['meshes'][nd['mesh']]['primitives']:
            if js['materials'][pr['material']]['name'] != mat_name:
                continue
            if 'TEXCOORD_0' not in pr['attributes']:
                round2_errors.append('%s has no UVs' % node_name)
                continue
            uvs = read_accessor(path, js, pr['attributes']['TEXCOORD_0'])
            us, vs = [u for u, v in uvs], [v for u, v in uvs]
            print('   %-14s %-12s UV u[%.3f..%.3f] v[%.3f..%.3f] (glTF: v=0 at the top edge)' % (
                node_name, mat_name, min(us), max(us), min(vs), max(vs)))
            if abs(min(us)) > 1e-4 or abs(max(us) - 1) > 1e-4 or abs(min(vs)) > 1e-4 or abs(max(vs) - 1) > 1e-4:
                round2_errors.append('%s UVs do not span 0..1' % node_name)
    print('file size: %.2f MB   triangles: %d   meshes: %d   nodes: %d   materials: %d' % (
        size / 1e6, tris, len(js['meshes']), len(js['nodes']), len(mats)))
    print('meshes without COLOR_0:', sorted(set(no_col)) or 'none')
    missing_m = [m for m in REQUIRED_MATERIALS if m not in mats]
    print('required materials missing:', missing_m or 'none')
    for m in js.get('materials', []):
        if m['name'] in ('Flame', 'Seeds', 'DoorLight', 'EnemyCore', 'Iris'):
            print('   %-10s emissive=%s strength=%s' % (m['name'], m.get('emissiveFactor'),
                  m.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength')))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = bpy.data.objects
    errors = []
    for (name, parent, piv) in CONTRACT:
        ob = obs.get(name)
        if ob is None:
            errors.append('missing ' + name)
            continue
        pn = ob.parent.name if ob.parent else None
        if pn != parent:
            errors.append('%s parent %s != %s' % (name, pn, parent))
        loc, rq, sc = ob.matrix_local.decompose()
        if abs(rq.angle) > 1e-4 or (sc - V((1, 1, 1))).length > 1e-4:
            errors.append('%s has non-identity rotation/scale' % name)
        if piv is not None and (ob.matrix_world.translation - V(piv)).length > 1e-3:
            errors.append('%s pivot %s != %s' % (name, tuple(round(x, 3) for x in ob.matrix_world.translation), piv))
    for pre, par in (('Wall_Chunk_', 'Wall_Fractured'), ('Column_Chunk_', 'Column_Fractured'),
                     ('Drawers_Chunk_', 'Drawers_Fractured')):
        ch = sorted(o.name for o in obs if o.name.startswith(pre))
        bad = [c for c in ch if not obs[c].parent or obs[c].parent.name != par]
        mv = max(len(obs[c].data.vertices) for c in ch) if ch else 0
        mu = max(len({tuple(round(x, 5) for x in v.co) for v in obs[c].data.vertices}) for c in ch) if ch else 0
        print('%-18s %2d chunks (%s..%s) max unique verts %d (max GPU verts %d) %s' % (
            par, len(ch), ch[0] if ch else '-', ch[-1] if ch else '-', mu, mv,
            'BAD PARENT %s' % bad if bad else ''))
        if not ch:
            errors.append('no chunks for ' + par)
    # triangles per top-level asset (including children)
    node_tris = {}
    for nd in js['nodes']:
        if 'mesh' in nd:
            node_tris[nd['name']] = per_mesh[js['meshes'][nd['mesh']]['name']]
    print('\ntriangles per asset:')
    for o in sorted((o for o in obs if o.parent is None), key=lambda o: o.name):
        t = sum(node_tris.get(h.name, 0) for h in [o] + list(o.children_recursive))
        print('   %-18s %7d' % (o.name, t))
    print('\n%-20s %-18s %8s %8s %8s   %s' % ('object', 'parent', 'X', 'Y', 'Z', 'pivot (world, Blender Z-up)'))
    for o in sorted(obs, key=lambda o: (o.parent is not None, o.name)):
        if 'Chunk_' in o.name:
            continue
        mn, mx = world_bbox(o)
        d = mx - mn
        t = tuple(round(x, 3) for x in o.matrix_world.translation)
        print('%-20s %-18s %8.3f %8.3f %8.3f   %s  z[%.3f..%.3f]' % (o.name, o.parent.name if o.parent else '-',
              d.x, d.y, d.z, t, mn.z, mx.z))
    print('\ntriangle budgets (root + children):')
    for nm, cap in TRI_CAPS.items():
        o = obs.get(nm)
        if o is None:
            errors.append('%s missing (has a triangle budget)' % nm)
            continue
        t = sum(node_tris.get(h.name, 0) for h in [o] + list(o.children_recursive))
        print('   %-18s %6d / %6d  %s' % (nm, t, cap, 'OVER' if t >= cap else 'ok'))
        if t >= cap:
            errors.append('%s has %d triangles (cap %d)' % (nm, t, cap))
    for par in CHUNKS:
        ct = [(node_tris.get(h.name, 0), h.name) for h in obs[par].children] if par in obs else []
        if ct:
            print('   %-18s chunk tris max %d (%s), cap %d' % (par, max(ct)[0], max(ct)[1], CHUNK_TRI_CAP))
        for t, nm in ct:
            if t > CHUNK_TRI_CAP:
                errors.append('%s has %d triangles (chunk cap %d)' % (nm, t, CHUNK_TRI_CAP))
    errors += round2_errors
    errors += verify_textured(js, obs)
    print('\nCONTRACT CHECK: %s' % ('PASS' if not errors else 'FAIL'))
    for e in errors:
        print('  ' + e)
    return not errors, tris, size


def _mesh_volume(ob):
    """Signed volume of an object's triangles in world space (closed shells)."""
    M = ob.matrix_world
    me = ob.data
    me.calc_loop_triangles()
    vs = [M @ v.co for v in me.vertices]
    vol = 0.0
    for t in me.loop_triangles:
        a, b, c = (vs[i] for i in t.vertices)
        vol += a.dot(b.cross(c))
    return vol / 6.0


def _meshes(o):
    return [h for h in [o] + list(o.children_recursive) if h.type == 'MESH']


def _hull_volume(obs_):
    bm = bmesh.new()
    for o in obs_:
        for v in o.data.vertices:
            bm.verts.new(o.matrix_world @ v.co)
    if len(bm.verts) < 4:
        return 0.0
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return abs(bm_volume_centroid(bm)[1])


def _bvh(o):
    """BVH over an object's own mesh (children excluded), world space."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    return BVHTree.FromBMesh(bm)


def verify_textured(js, obs):
    """Round-3 contract: textured props (TX_ placeholders, metre UVs, COLOR_0,
    nothing embedded), collider-derived dimensions, chunk counts / volumes."""
    errs = []
    print('\n---- textured props ----')
    if js.get('images') or js.get('textures'):
        errs.append('glb embeds %d images / %d textures' % (len(js.get('images', [])), len(js.get('textures', []))))
    print('embedded images: %d' % len(js.get('images', [])))
    # TX_ materials: plain white placeholders, UVs present
    for m in js.get('materials', []):
        if m['name'].startswith('TX_'):
            pbr = m.get('pbrMetallicRoughness', {})
            if any(k in pbr for k in ('baseColorTexture', 'metallicRoughnessTexture')) or 'normalTexture' in m:
                errs.append('%s has a texture' % m['name'])
            if pbr.get('baseColorFactor', [1, 1, 1, 1])[:3] != [1, 1, 1] and pbr.get('baseColorFactor') is not None:
                errs.append('%s base colour is not white' % m['name'])
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            mname = js['materials'][pr['material']]['name']
            if mname.startswith('TX_'):
                if 'TEXCOORD_0' not in pr['attributes']:
                    errs.append('%s (%s) has no UVs' % (mesh['name'], mname))
                if 'COLOR_0' not in pr['attributes']:
                    errs.append('%s (%s) has no COLOR_0' % (mesh['name'], mname))
    # UV sanity per object and material: range, and texel density (UV area per
    # world area ~ 1 for metre UVs; box projection alone gives >= 0.58)
    print('%-18s %-13s %7s %7s  %s' % ('object', 'material', 'uv/m2', 'max|uv|', 'UV range'))
    dens_bad = []
    for name in TX_ASSETS:
        o = obs.get(name)
        if o is None:
            errs.append('missing ' + name)
            continue
        for h in _meshes(o):
            me = h.data
            if not me.uv_layers:
                continue
            uvl = me.uv_layers[0].data
            acc = {}
            M = h.matrix_world
            for poly in me.polygons:
                mat = me.materials[poly.material_index].name if me.materials else '?'
                if not mat.startswith('TX_'):
                    continue
                pts = [M @ me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
                uvs = [uvl[li].uv for li in poly.loop_indices]
                wa = 0.0
                ua = 0.0
                for i in range(1, len(pts) - 1):
                    wa += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0]).length / 2
                    a, b = uvs[i] - uvs[0], uvs[i + 1] - uvs[0]
                    ua += abs(a.x * b.y - a.y * b.x) / 2
                r = acc.setdefault(mat, [0.0, 0.0, 1e9, -1e9, 1e9, -1e9, 0.0])
                r[0] += wa
                r[1] += ua
                for uv in uvs:
                    r[2], r[3] = min(r[2], uv.x), max(r[3], uv.x)
                    r[4], r[5] = min(r[4], uv.y), max(r[5], uv.y)
                    r[6] = max(r[6], abs(uv.x), abs(uv.y))
            for mat, (wa, ua, u0, u1, v0, v1, mx) in acc.items():
                d = ua / wa if wa > 1e-9 else 1.0
                if 'Chunk' not in h.name or h.name.endswith('_00'):
                    print('%-18s %-13s %7.2f %7.2f  u[%.2f..%.2f] v[%.2f..%.2f]' % (h.name, mat, d, mx, u0, u1, v0, v1))
                if not (0.45 <= d <= 1.4):
                    dens_bad.append('%s/%s %.2f' % (h.name, mat, d))
                if mx > 40:
                    errs.append('%s/%s UVs out of range (%.1f)' % (h.name, mat, mx))
    if dens_bad:
        errs.append('texel density off: ' + ', '.join(dens_bad))
    # collider-derived dimensions (Blender Z-up: three.js y = Blender z)
    def bb(name):
        return world_bbox(obs[name])

    def near(a, b, tol):
        return abs(a - b) <= tol
    mn, mx = bb('Wall')
    print('Wall      bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]  (collider 4 x 3 x 0.5 at y 1.5)' % (
        mn.x, mx.x, mn.y, mx.y, mn.z, mx.z))
    if not (near(mn.x, -2, 0.005) and near(mx.x, 2, 0.005) and near(mn.z, 0, 0.005) and near(mx.z, 3, 0.005)
            and mx.y <= 0.31 and mn.y >= -0.31):
        errs.append('Wall bbox off the collider')
    tree = _bvh(obs['Wall'])
    hits = 0
    for x in [-1.8 + 0.3 * i for i in range(13)]:
        for z in (0.8, 1.5, 2.2):
            for sgn in (-1, 1):
                h = tree.ray_cast(V((x, sgn * 1.0, z)), V((0, -sgn, 0)))
                if h[0] is not None and abs(abs(h[0].y) - 0.25) <= 0.03:
                    hits += 1
    print('Wall      faces within 3 cm of the collider sides: %d/78 probes' % hits)
    if hits < 70:
        errs.append('Wall faces stray from the collider (%d/78)' % hits)
    mn, mx = bb('Column')
    tree = _bvh(obs['Column'])
    rmax = 0.0
    for z in (0.6, 1.2, 2.0, 2.8, 3.4):
        for k in range(24):
            a = TAU * k / 24
            d = V((math.cos(a), math.sin(a), 0))
            h = tree.ray_cast(V((0, 0, z)) + d * 2.0, -d)
            if h[0] is not None:
                rmax = max(rmax, (h[0] - V((0, 0, z))).length)
    print('Column    bbox %.3f x %.3f x %.3f z[%.3f..%.3f], shaft radius max %.3f (collider cylinder r 0.34, h 4)' % (
        mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, mn.z, mx.z, rmax))
    if not (near(mn.z, 0, 0.005) and near(mx.z, 4.0, 0.005) and mx.x <= 0.352 and mn.x >= -0.352 and rmax <= 0.34):
        errs.append('Column off its collider')
    mn, mx = bb('Platform')
    tree = _bvh(obs['Platform'])
    tops = []
    for i in range(21):
        for j in range(21):
            x, y = -1.44 + 2.88 * i / 20, -1.44 + 2.88 * j / 20
            h = tree.ray_cast(V((x, y, 2.0)), V((0, 0, -1)))
            tops.append(h[0].z if h[0] is not None else -9.0)
    paving = [t for t in tops if t >= -0.012]
    print('Platform  bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]; top over the footprint: %d/441 probes on paving '
          'z[%.4f..%.4f], lowest (a joint) %.3f' % (mn.x, mx.x, mn.y, mx.y, mn.z, mx.z, len(paving), min(paving),
                                                     max(paving), min(tops)))
    if not (mx.z <= 1e-4 and len(paving) >= 0.93 * len(tops) and min(tops) >= -0.14 and mn.x >= -1.51
            and mx.x <= 1.51 and mn.y >= -1.51 and mx.y <= 1.51 and mn.z >= -1.2):
        errs.append('Platform top not flat at z = 0 over the footprint')
    mn, mx = bb('Drawers')
    print('Drawers   bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]  (collider 1.0 x 1.1 x 0.6)' % (
        mn.x, mx.x, mn.y, mx.y, mn.z, mx.z))
    if not (mn.x >= -0.505 and mx.x <= 0.505 and near(mn.z, 0, 0.005) and mx.z <= 1.105 and mx.y <= 0.305):
        errs.append('Drawers off the collider')
    mn, mx = bb('Bed')
    print('Bed       bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]' % (mn.x, mx.x, mn.y, mx.y, mn.z, mx.z))
    if not (mn.x >= -0.825 and mx.x <= 0.825 and mn.y >= -1.13 and mx.y <= 1.13 and mn.z >= -0.001 and mx.z <= 2.001):
        errs.append('Bed out of its old envelope')
    tree = _bvh(obs['DeadTree'])
    rt = 0.0
    for z in (0.8, 1.2, 1.6):
        for k in range(16):
            a = TAU * k / 16
            d = V((math.cos(a), math.sin(a), 0))
            h = tree.ray_cast(V((0.03, 0, z)) + d * 0.6, -d)
            if h[0] is not None:
                rt = max(rt, (h[0] - V((0.03, 0, z))).length)
    hb = tree.ray_cast(V((1.7, 0.0, 3.5)), V((0, 0, -1)))
    mn, mx = bb('DeadTree')
    print('DeadTree  bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]; trunk radius %.3f (collider 0.22); clock branch top at x 1.7: %s' % (
        mn.x, mx.x, mn.y, mx.y, mn.z, mx.z, rt, '%.3f' % hb[0].z if hb[0] is not None else 'MISSING'))
    if rt > 0.3 or hb[0] is None or not (2.15 <= hb[0].z <= 2.4):
        errs.append('DeadTree trunk / clock branch moved')
    mn, mx = bb('Door')
    leaf, lt = obs['Door_Leaf'], obs['Door_Light']
    print('Door      bbox x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]; Door_Leaf pivot %s, Door_Light pivot %s' % (
        mn.x, mx.x, mn.y, mx.y, mn.z, mx.z, tuple(round(c, 4) for c in leaf.matrix_world.translation),
        tuple(round(c, 4) for c in lt.matrix_world.translation)))
    if (leaf.matrix_world.translation - V((-0.55, -0.03, 0.0))).length > 1e-4 or \
            (lt.matrix_world.translation - V((0.0, 0.06, 1.2025))).length > 1e-4:
        errs.append('Door_Leaf / Door_Light pivots moved')
    if not (near(mn.x, -0.65, 0.02) and near(mx.x, 0.65, 0.02) and near(mx.z, 2.5, 0.005) and near(mn.z, 0.0, 0.005)):
        errs.append('Door frame off its colliders')
    tree = _bvh(obs['RailPost'])
    h = tree.ray_cast(V((0, 0, 3.0)), V((0, 0, -1)))
    mn, mx = bb('RailPost')
    print('RailPost  bbox %.3f x %.3f x %.3f; the rail rests on z %s (rail centre line 1.6)' % (
        mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, '%.3f' % h[0].z if h[0] is not None else 'MISSING'))
    if h[0] is None or not (1.5 <= h[0].z <= 1.56) or mx.z > 1.72:
        errs.append('RailPost saddle moved')
    tree = _bvh(obs['Arch'])
    mn, mx = bb('Arch')
    clear = tree.ray_cast(V((0, -2, 1.5)), V((0, 1, 0)), 4.0)[0] is None and \
        tree.ray_cast(V((0, -2, 3.3)), V((0, 1, 0)), 4.0)[0] is None
    print('Arch      bbox %.3f x %.3f x %.3f z[%.3f..%.3f]; opening clear: %s' % (
        mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, mn.z, mx.z, clear))
    if not (near(mx.x - mn.x, 4.0, 0.05) and near(mx.z, 5.0, 0.005) and clear):
        errs.append('Arch envelope / opening changed')
    for name, dims in (('Rock_A', (2.619, 2.349, 3.117)), ('Rock_B', (3.910, 3.193, 2.011)),
                       ('Rock_C', (2.548, 1.610, 2.613)), ('Train', (8.0, 2.2, 3.0))):
        mn, mx = bb(name)
        d = mx - mn
        print('%-9s bbox %.3f x %.3f x %.3f (was %.3f x %.3f x %.3f)' % ((name, d.x, d.y, d.z) + dims))
        if any(abs(d[i] - dims[i]) > 0.06 * dims[i] + 0.02 for i in range(3)) or abs(mn.z) > 0.005:
            errs.append('%s envelope changed' % name)
    # the game's debris collider is a convex hull of ~64 vertices sampled by
    # index stride (physics.js collectPoints); how much of each chunk's true
    # hull does that sample cover?
    cover = {}
    for nd in js['nodes']:
        if '_Chunk_' not in nd.get('name', '') or 'mesh' not in nd:
            continue
        allp, samp = [], []
        for pr in js['meshes'][nd['mesh']]['primitives']:
            pts = read_accessor(verify.path, js, pr['attributes']['POSITION'])
            allp += pts
            samp += pts[::max(1, len(pts) // 120)]
        if len(samp) > 64:
            samp = samp[::math.ceil(len(samp) / 64)]

        def hv(P):
            bm = bmesh.new()
            for q in P:
                bm.verts.new(q)
            bmesh.ops.convex_hull(bm, input=bm.verts)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            return abs(bm_volume_centroid(bm)[1])
        cover.setdefault(nd['name'].split('_Chunk_')[0], []).append(hv(samp) / max(1e-9, hv(allp)))
    # fracture templates: counts, total volume vs the solid, convexity
    for par, (solid, n_exp) in CHUNKS.items():
        ch = [o for o in obs if o.name.startswith(solid + '_Chunk_')]
        vols = [_mesh_volume(o) for o in ch]
        sv = sum(_mesh_volume(h) for h in _meshes(obs[solid]) if not h.name.endswith('_Pillow'))
        conv = min(abs(v) / max(1e-9, _hull_volume([o])) for o, v in zip(ch, vols)) if ch else 0.0
        gpu = max(len(o.data.vertices) for o in ch) if ch else 0
        cv = cover.get(solid, [0.0])
        print('%-17s %2d chunks (expected %d), volume %.4f vs solid %.4f (%.1f%%), min chunk vol/hull %.2f, max verts %d, '
              'game-sampled hull covers min %.2f / mean %.2f' % (par, len(ch), n_exp, sum(vols), sv,
                                                                100.0 * sum(vols) / max(sv, 1e-9), conv, gpu, min(cv),
                                                                sum(cv) / len(cv)))
        if min(cv) < 0.6:
            errs.append('%s: a chunk collider would cover only %.2f of its hull' % (par, min(cv)))
        elif min(cv) < 0.75:
            print('   note: a %s chunk collider covers %.2f of its hull (~%.0f%% smaller linearly); physics.js '
                  'samples ~64 vertices by index stride' % (par, min(cv), 100 * (1 - min(cv) ** (1 / 3))))
        if len(ch) != n_exp:
            errs.append('%s has %d chunks (expected %d)' % (par, len(ch), n_exp))
        if abs(sum(vols) - sv) > 0.03 * abs(sv):
            errs.append('%s volume %.4f far from solid %.4f' % (par, sum(vols), sv))
        if min(vols or [0]) <= 0:
            errs.append('%s has an empty or inside-out chunk' % par)
    return errs


def main():
    global COLL
    argv = sys.argv[1:]
    only = None
    out = DEFAULT_OUT
    do_verify = '--no-verify' not in argv
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--out' in argv:
        out = os.path.abspath(argv[argv.index('--out') + 1])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    COLL = bpy.context.scene.collection
    noise.seed_set(1904)
    P = palette()
    t0 = time.time()
    for name, fn in BUILDERS:
        if only and name not in only:
            continue
        t = time.time()
        fn(P)
        print('built %-18s %.1fs' % (name, time.time() - t))
    for ob in COLL.objects:
        if ob.parent is None:
            assert ob.location.length < 1e-9, ob.name
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    export(out)
    print('exported %s in %.1fs' % (out, time.time() - t0))
    ok = True
    if do_verify:
        ok = verify(out)[0]
    return 0 if ok else 1


if __name__ == '__main__':
    code = main()
    # bpy 4.2 used as a Python module segfaults during interpreter teardown once
    # the glTF add-on has run (even for a one-cube export), so skip the teardown.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
