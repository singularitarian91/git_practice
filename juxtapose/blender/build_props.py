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


def ratio(h_dark, h_base):
    """Linear-space multiplier that turns base colour h_base into h_dark."""
    a, b = hexcol(h_dark), hexcol(h_base)
    return tuple(min(1.0, a[i] / max(b[i], 1e-6)) for i in range(3))


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
MATS = {}


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, double=False):
    """Principled BSDF with constant values; Base Color = constant * Col attribute."""
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


def solidify(bm, thickness, offset=-1.0):
    return apply_mod(bm, 'SOLIDIFY', thickness=thickness, offset=offset, use_even_offset=True)


def bm_skin(verts, edges, radii, levels=2, root=0):
    me = bpy.data.meshes.new('_skin')
    me.from_pydata([tuple(v) for v in verts], edges, [])
    ob = bpy.data.objects.new('_skin', me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('skin', 'SKIN')
    md.branch_smoothing = 0.6
    md.use_smooth_shade = True
    layer = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        layer[i].radius = (r, r) if isinstance(r, (int, float)) else r
        layer[i].use_root = (i == root)
    if levels:
        ss = ob.modifiers.new('ss', 'SUBSURF')
        ss.levels = levels
        ss.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    set_smooth(out, True)
    return out


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
        self.mats = []

    def midx(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, src, mat, tint=None, smooth=None, mats=None):
        """Append src (freed).  tint: rgb, or fn(co) -> rgb.  mats: list mapping
        src material_index -> material (for multi-material parts)."""
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
            for lp in nf.loops:
                if tint is None:
                    c = (1.0, 1.0, 1.0)
                elif callable(tint):
                    c = tint(lp.vert.co)
                else:
                    c = tint
                lp[self.col] = (c[0], c[1], c[2], 1.0)
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


def finish(mb, name, pivot=(0, 0, 0), parent=None, sharp=40.0, vfn=None, weighted=False):
    """Turn the builder into an object whose origin is `pivot` (world space)."""
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
                     (0.404, 0.042), (0.399, 0.034), (0.398, 0.021)], segs=96, cap=False)
    mb.add(xform(case, Mw), gold)
    disc = bm_lathe([(0.405, 0.021), (0.36, 0.021), (0.27, 0.021), (0.14, 0.021), (0, 0.021)],
                    segs=96, cap=False)

    def face_tint(co):
        d = (co - C).length / 0.405
        k = 1.0 - 0.10 * smoothstep(0.55, 1.0, d) - 0.05 * max(0.0, fbm(co * 5.0 + V((3, 1, 2))))
        return (k, k * 0.985, k * 0.95)
    mb.add(xform(disc, Mw), face, tint=face_tint)
    ring = bm_lathe([(0.381, 0.0217), (0.373, 0.0217)], segs=96, cap=False)
    mb.add(xform(ring, Mw), ink)
    ring2 = bm_lathe([(0.262, 0.0217), (0.258, 0.0217)], segs=96, cap=False)
    mb.add(xform(ring2, Mw), ink)
    for k in range(60):
        a = math.pi / 2 - k * TAU / 60
        if k % 5 == 0:
            big = (k % 15 == 0)
            r0, r1, w = (0.285, 0.37, 0.032) if big else (0.305, 0.37, 0.014)
        else:
            r0, r1, w = (0.366, 0.386, 0.004)
        t = bm_box((r1 - r0, w, 0.0045), center=((r0 + r1) / 2, 0, 0.0237), smooth=False)
        rot(t, a, 'Z')
        mb.add(xform(t, Mw), ink)
    # crown / winder with a bow ring
    stem = bm_lathe([(0, 0.425), (0.021, 0.425), (0.021, 0.47), (0.03, 0.476), (0, 0.48)], segs=24)
    mb.add(xform(stem, Mup), gold)

    def knurl(t, r, z):
        rr = r * (1.0 + 0.06 * math.cos(24 * t)) if 0.487 < z < 0.521 else r
        return (rr * math.cos(t), rr * math.sin(t), z)
    knob = bm_lathe([(0, 0.476), (0.036, 0.478), (0.044, 0.485), (0.047, 0.494), (0.047, 0.514),
                     (0.044, 0.522), (0.034, 0.528), (0, 0.531)], segs=48, vfun=knurl)
    mb.add(xform(knob, Mup), gold)
    bow = bm_tube([(0.05 * math.cos(TAU * i / 40), 0.578 + 0.05 * math.sin(TAU * i / 40), 0)
                   for i in range(40)], 0.0105, sides=12, closed=True, fixed_b=(0, 0, 1))
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
    pin = bm_lathe([(0, 0.02), (0.011, 0.02), (0.012, 0.035), (0.009, 0.039), (0, 0.040)], segs=24)
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
    finish(mb, 'Mirror', sharp=45, vfn=ao_fn(h=0.3, amt=0.25), weighted=True)
    gl = bm_lathe([(1.0, 0), (0.8, 0), (0.5, 0), (0.0, 0)], segs=64, sx=0.333, sy=0.593)
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
    finish(mb, 'Candle', sharp=50, vfn=vfn)
    fb = MB()
    base = V((0.002, 0, z1 + 0.012))
    fl = bm_lathe([(0, 0), (0.008, 0.004), (0.015, 0.018), (0.018, 0.034), (0.016, 0.05),
                   (0.011, 0.068), (0.005, 0.083), (0, 0.095)], segs=20, sy=0.85)
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


def drape(nu, nv, u0, u1, v0, v1, top, hx, yf, rho, amp, seed, freq=9.0):
    """Cloth draped over a box top [|x|<=hx, y>=yf] at height `top`, hanging over
    the sides and the foot end.  Returns bmesh (grid, normals up)."""
    bm = bm_grid(nu, nv, u0, u1, v0, v1)
    ph = seed * 1.7
    for v in bm.verts:
        u, w = v.co.x, v.co.y
        ex = max(0.0, abs(u) - hx)
        ey = max(0.0, yf - w)
        e = math.hypot(ex, ey)
        if e <= 1e-9:
            v.co = V((u, w, top))
            continue
        d = V((math.copysign(ex, u) / e, -ey / e, 0.0))
        bx, by = clamp(u, -hx, hx), max(w, yf)
        arc = math.pi * rho / 2
        if e < arc:
            ang = e / rho
            h, dz = rho * math.sin(ang), rho * (1 - math.cos(ang))
            hang = 0.0
        else:
            h, dz = rho, rho + (e - arc)
            hang = e - arc
        s = w if ex >= ey else u
        fold = amp * smoothstep(0.0, 0.25, hang) * (math.sin(freq * s + ph) * 0.7 +
                                                    0.3 * math.sin(2.3 * freq * s + 2 * ph))
        v.co = V((bx, by, top - dz)) + d * (h + fold)
    set_smooth(bm)
    return bm


def build_bed(P):
    wood = material('BedWood', '#5b2a1b', 0.0, 0.42)
    sheet, brass = P['sheet'], P['brass']
    blanket = material('Blanket', '#7c2424', 0.0, 0.85, double=True)
    mb = MB()
    post_prof = [(0.0, 0.45), (0.036, 0.45), (0.041, 0.468), (0.031, 0.49), (0.028, 0.52),
                 (0.045, 0.62), (0.05, 0.7), (0.042, 0.8), (0.028, 0.88), (0.024, 0.92),
                 (0.034, 0.95), (0.024, 0.98), (0.021, 1.1), (0.02, 1.5), (0.019, 1.8),
                 (0.027, 1.83), (0.019, 1.86), (0.019, 1.88), (0.0, 1.88)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = 0.75 * sx, 1.05 * sy
            mb.add(move(bm_lathe([(0, 0), (0.04, 0), (0.048, 0.02), (0.042, 0.045), (0, 0.052)],
                                 segs=16), (x, y, 0)), wood)
            mb.add(bm_box((0.09, 0.09, 0.4), center=(x, y, 0.25), bevel=0.008), wood)
            mb.add(move(bm_lathe(post_prof, segs=16), (x, y, 0)), wood)
            mb.add(bm_box((0.07, 0.07, 0.08), center=(x, y, 1.92), bevel=0.006), wood)
            mb.add(move(bm_lathe([(0, 1.955), (0.02, 1.96), (0.028, 1.975), (0.02, 1.992),
                                  (0, 2.0)], segs=16), (x, y, 0)), brass)
        # side rails + canopy rails
        mb.add(bm_box_mm((0.73 * sx - 0.02, -1.05, 0.2), (0.73 * sx + 0.02, 1.05, 0.4), bevel=0.006),
               wood)
        mb.add(bm_box_mm((0.75 * sx - 0.022, -1.05, 1.885), (0.75 * sx + 0.022, 1.05, 1.93),
                         bevel=0.006), wood)
    for sy in (-1, 1):
        mb.add(bm_box_mm((-0.75, 1.05 * sy - 0.022, 1.885), (0.75, 1.05 * sy + 0.022, 1.93),
                         bevel=0.006), wood)
    mb.add(bm_box_mm((-0.75, -1.07, 0.2), (0.75, -1.03, 0.4), bevel=0.006), wood)
    mb.add(bm_box_mm((-0.72, -1.065, 0.4), (0.72, -1.035, 0.66), bevel=0.006), wood)
    mb.add(bm_box_mm((-0.74, -1.075, 0.66), (0.74, -1.025, 0.7), bevel=0.01), wood)
    # headboard with an arched top
    pts = [(-0.72, 0.4), (0.72, 0.4)]
    for k in range(25):
        x = lerp(0.72, -0.72, k / 24)
        pts.append((x, 1.18 + 0.27 * max(0.0, math.cos(math.pi * x / 1.44)) ** 1.5))
    head = bm_prism(pts, -1.07, -1.035)
    rot(head, math.pi / 2, 'X')
    mb.add(head, wood, smooth=False)
    arc = [(x, 1.03, 1.18 + 0.27 * max(0.0, math.cos(math.pi * x / 1.44)) ** 1.5)
           for x in [lerp(-0.73, 0.73, k / 30) for k in range(31)]]
    mb.add(bm_tube(arc, 0.024, sides=10), wood)
    for (x0, x1) in ((-0.6, -0.06), (0.06, 0.6)):
        mb.add(bm_box_mm((x0, 1.022, 0.52), (x1, 1.04, 1.06), bevel=0.012, segs=1), wood)
    mb.add(bm_box_mm((-0.72, -1.0, 0.4), (0.72, 1.0, 0.6), bevel=0.05, segs=3), sheet)
    # sheet, turned-down cuff and a folded oxblood blanket at the foot
    mb.add(solidify(drape(40, 44, -1.07, 1.07, -1.35, 0.56, 0.607, 0.72, -1.0, 0.05, 0.012, 1), 0.006),
           sheet)
    mb.add(solidify(drape(40, 8, -1.08, 1.08, 0.34, 0.6, 0.618, 0.72, -1.0, 0.058, 0.01, 2), 0.006),
           sheet)
    mb.add(solidify(drape(40, 20, -1.1, 1.1, -1.42, -0.52, 0.642, 0.72, -1.0, 0.08, 0.006, 3,
                          freq=11.0), 0.008), blanket)

    def vfn(co, n, f):
        k = 1.0 - 0.3 * (1 - smoothstep(0.0, 0.4, co.z)) - 0.2 * smoothstep(0.0, -1.0, n.z)
        return (k, k, k)
    finish(mb, 'Bed', sharp=45, vfn=vfn, weighted=True)
    # pillow
    pb = bmesh.new()
    bmesh.ops.create_cube(pb, size=2.0)
    bmesh.ops.subdivide_edges(pb, edges=pb.edges, cuts=7, use_grid_fill=True)
    hx, hy, hz = 0.32, 0.18, 0.075
    for v in pb.verts:
        x, y, z = v.co
        th = ((1 - abs(x) ** 2.5) * (1 - abs(y) ** 2.5)) ** 0.55
        X = x * hx * (1 + 0.05 * (1 - y * y))
        Y = y * hy * (1 + 0.07 * (1 - x * x))
        Z = z * hz * th
        if z > 0:
            Z -= 0.022 * (1 - x * x) * (1 - y * y)
        v.co = V((X, Y, Z))
    pb = subsurf(pb, 1)
    set_smooth(pb)
    zmin = min(v.co.z for v in pb.verts)
    pc = V((0, 0.76, 0.607))
    move(pb, pc - V((0, 0, zmin)))
    pmb = MB()
    pmb.add(pb, sheet)
    finish(pmb, 'Bed_Pillow', pivot=pc, parent='Bed', sharp=None,
           vfn=lambda co, n, f: grey(1.0 - 0.15 * smoothstep(0.0, -1.0, n.z)))


def build_bowler(P):
    felt = material('Felt', '#161514', 0.0, 0.7)
    band = material('HatBand', '#0b0b0c', 0.0, 0.32)

    def vf(t, r, z):
        zz = z
        if r > 0.132:
            k = (r - 0.132) / 0.08
            zz += 0.05 * k * k * (math.cos(t) ** 2) - 0.008 * k * (math.sin(t) ** 2)
        return (r * math.cos(t) * 0.93, r * math.sin(t), zz)
    prof = [(0, 0.186), (0.06, 0.181), (0.094, 0.162), (0.114, 0.125), (0.12, 0.075), (0.121, 0.024),
            (0.128, 0.01), (0.155, 0.007), (0.185, 0.01), (0.2, 0.017), (0.208, 0.027),
            (0.2105, 0.038), (0.205, 0.045), (0.195, 0.043), (0.176, 0.031), (0.152, 0.025),
            (0.136, 0.026), (0.1295, 0.031), (0.1275, 0.05), (0.1285, 0.09), (0.1245, 0.13),
            (0.114, 0.16), (0.096, 0.182), (0.07, 0.196), (0.04, 0.2025), (0, 0.2045)]
    mb = MB()
    mb.add(bm_lathe(prof, segs=72, vfun=vf), felt)
    mb.add(bm_lathe([(0.1281, 0.028), (0.1296, 0.031), (0.1301, 0.061), (0.1283, 0.064)],
                    segs=72, vfun=vf, cap=False), band)
    for (y, zc, sc) in ((0.017, 0.047, (0.006, 0.02, 0.012)), (-0.017, 0.045, (0.006, 0.02, 0.011)),
                        (0.0, 0.046, (0.007, 0.009, 0.011))):
        mb.add(bm_ico(1.0, 2, center=(0.1215, y, zc), sc=sc), band)
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
                     (0.0, 0.04)], segs=48)
    mb.add(tray, brass)
    nb = 24
    Rb, zt = 0.225, 0.46
    for i in range(nb):
        ph = TAU * i / nb
        pts = [(Rb, 0.05), (Rb, 0.2), (Rb, 0.35), (Rb, zt)]
        for k in range(1, 11):
            s = (math.pi / 2 - 0.12) * k / 10
            pts.append((Rb * math.cos(s), zt + 0.21 * math.sin(s)))
        p3 = [(r * math.cos(ph), r * math.sin(ph), z) for (r, z) in pts]
        mb.add(bm_tube(p3, 0.0042, sides=6), brass)
    for (z, rr, th) in ((0.075, Rb + 0.001, 0.008), (0.26, Rb + 0.001, 0.006), (zt, Rb + 0.001, 0.007)):
        mb.add(bm_tube([(rr * math.cos(TAU * k / 72), rr * math.sin(TAU * k / 72), z) for k in range(72)],
                       th, sides=8, closed=True, fixed_b=(0, 0, 1)), brass)
    zc = zt + 0.21 * math.sin(math.pi / 2 - 0.12)
    rc = Rb * math.cos(math.pi / 2 - 0.12)
    mb.add(bm_tube([(rc * math.cos(TAU * k / 32), rc * math.sin(TAU * k / 32), zc) for k in range(32)],
                   0.006, sides=8, closed=True, fixed_b=(0, 0, 1)), brass)
    mb.add(bm_lathe([(0, zc - 0.01), (0.04, zc - 0.005), (0.035, zc + 0.012), (0.018, zc + 0.025),
                     (0.012, zc + 0.045), (0.02, zc + 0.058), (0.012, zc + 0.068), (0, zc + 0.07)],
                    segs=24), brass)
    top = zc + 0.064
    mb.add(bm_tube([(0.034 * math.sin(TAU * k / 32), 0, top + 0.034 + 0.034 * -math.cos(TAU * k / 32))
                    for k in range(32)], 0.006, sides=8, closed=True, fixed_b=(0, -1, 0)), brass)
    rod = bm_lathe([(0, -0.23), (0.008, -0.23), (0.008, 0.23), (0, 0.23)], segs=10)
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
                     segs=48, vfun=crown_v)
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
            s_ = bm_ico(1.0, 1, sc=(0.0128, 0.0118, 0.0145), smooth=False)
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
WALL_BODY = ratio('#e6d2ab', '#f0e2c2')
WALL_PLINTH = ratio('#c29f78', '#f0e2c2')


def wall_color(co, zc):
    if zc < 0.3:
        t = WALL_PLINTH
    elif zc > 2.74:
        t = (1.0, 1.0, 1.0)
    else:
        t = WALL_BODY
    k = 1.0 - 0.2 * max(0.0, fbm(V((co.x * 0.9, co.y * 0.9, co.z * 0.8)) + V((5.3, 1.1, 7.7)), 3))
    if 0.3 <= zc <= 2.74:
        streak = max(0.0, noise.noise(V((co.x * 2.1, 7.7, 1.3)))) * smoothstep(1.4, 2.74, co.z)
        k -= 0.3 * streak
        k -= 0.25 * (1.0 - smoothstep(0.3, 1.2, co.z))
    elif zc < 0.3:
        k -= 0.12 * (1.0 - smoothstep(0.0, 0.25, co.z))
    return (t[0] * k, t[1] * k, t[2] * k * 0.98)


def grid_cut(bm, axis, values):
    no = [0, 0, 0]
    no[axis] = 1
    for val in values:
        co = [0, 0, 0]
        co[axis] = val
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co,
                               plane_no=no)
    return bm


def build_wall(P):
    st = P['stucco']
    mb = MB()
    body = bm_box_mm((-2, -0.25, 0.3), (2, 0.25, 2.74), smooth=False)
    grid_cut(body, 0, [-2 + i * 0.25 for i in range(1, 16)])
    grid_cut(body, 2, [0.3 + k * 0.244 for k in range(1, 10)])
    mb.add(body, st)
    mb.add(bm_box_mm((-2, -0.29, 0.0), (2, 0.29, 0.25), bevel=0.012), st)
    mb.add(bm_box_mm((-2, -0.272, 0.25), (2, 0.272, 0.3), bevel=0.012, segs=3), st)
    mb.add(bm_box_mm((-2, -0.266, 2.74), (2, 0.266, 2.8), bevel=0.01, segs=3), st)
    mb.add(bm_box_mm((-2, -0.285, 2.8), (2, 0.285, 2.88), bevel=0.012), st)
    mb.add(bm_box_mm((-2, -0.305, 2.88), (2, 0.305, 3.0), bevel=0.015), st)
    finish(mb, 'Wall', sharp=40, weighted=True,
           vfn=lambda co, n, f: wall_color(co, f.calc_center_median().z))


def interior_tint(co, n, f, dark=0.8):
    k = dark + (1 - dark) * (0.5 + 0.5 * fbm(co * 6.0, 2))
    return (k, k, k)


def chunk_object(convex, name, parent, mats, vfn_out, extra_cuts=(), max_verts=128):
    bm = convex.to_bm({'out': 0, 'in': 1})
    for (co, no) in extra_cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co,
                               plane_no=no)
    cen, vol = bm_volume_centroid(bm)
    set_smooth(bm, True)          # flat look comes from the angle-based sharp edges
    mb = MB()
    mb.add(bm, None, mats=mats)

    def vfn(co, n, f):
        if f.material_index == 0:
            return vfn_out(co, n, f)
        return interior_tint(co, n, f)
    ob = finish(mb, name, pivot=cen, parent=parent, sharp=35, vfn=vfn)
    nv = len(ob.data.vertices)
    assert nv <= max_verts, (name, nv)
    return ob, vol, nv


def build_wall_fractured(P):
    st, wi = P['stucco'], P['wallint']
    rng = random.Random(1904)
    empty('Wall_Fractured')
    impact = V((0.0, 0.0, 1.5))
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
    box = Convex.box((-2, -0.25, 0), (2, 0.25, 3))
    cells = []
    for i, s in enumerate(seeds):
        c = box
        for j, t in enumerate(seeds):
            if i == j or c is None:
                continue
            n = (t - s).normalized()
            c = c.clip(n, n.dot((s + t) / 2), 'in')
        if c is None:
            continue
        cen, vol = c.volume_centroid()
        if vol > 1e-5:
            cells.append((c, cen, vol))
    cells.sort(key=lambda x: (x[1] - impact).length)
    total, vmax = 0.0, 0
    for k, (c, cen, vol) in enumerate(cells):
        ob, v, nv = chunk_object(c, 'Wall_Chunk_%02d' % k, 'Wall_Fractured', [st, wi],
                                 lambda co, n, f: wall_color(co, f.calc_center_median().z),
                                 extra_cuts=[((0, 0, 0.3), (0, 0, 1)), ((0, 0, 2.74), (0, 0, 1))])
        total += v
        vmax = max(vmax, nv)
    print('  Wall_Fractured: %d chunks, volume %.4f (box 6.0), max verts %d' % (len(cells), total, vmax))


def column_R(z):
    t = clamp((z - 0.255) / (3.62 - 0.255))
    return 0.302 - 0.04 * t ** 1.6 + 0.006 * math.sin(math.pi * t)


def build_column(P):
    mar = P['marble']
    mb = MB()
    mb.add(bm_box((0.7, 0.7, 0.14), center=(0, 0, 0.07), bevel=0.012), mar)
    mb.add(bm_lathe([(0, 0.14), (0.325, 0.14), (0.338, 0.152), (0.343, 0.175), (0.335, 0.198),
                     (0.318, 0.212), (0.304, 0.218), (0.304, 0.232), (0.314, 0.238), (0.314, 0.25),
                     (0.3, 0.256), (0, 0.256)], segs=64), mar)
    NF, SPF = 16, 6

    def flute(t, r, z):
        ph = (t * NF / TAU) % 1.0
        depth = 0.02 * math.sin(math.pi * ph) ** 0.7
        rr = r - depth
        return (rr * math.cos(t), rr * math.sin(t), z)
    zs = [0.25, 0.3] + [lerp(0.3, 3.56, k / 9) for k in range(1, 10)] + [3.6]
    shaft = bm_lathe([(column_R(z), z) for z in zs], segs=NF * SPF, vfun=flute, cap=False)
    mb.add(shaft, mar)
    mb.add(bm_lathe([(0, 3.585), (0.27, 3.585), (0.282, 3.595), (0.282, 3.612), (0.272, 3.62),
                     (0.272, 3.632), (0.283, 3.64), (0.283, 3.655), (0.27, 3.662), (0, 3.662)],
                    segs=64), mar)
    mb.add(bm_lathe([(0, 3.655), (0.27, 3.655), (0.285, 3.68), (0.31, 3.72), (0.332, 3.76),
                     (0.345, 3.795), (0.35, 3.82), (0.348, 3.832), (0, 3.832)], segs=64), mar)
    mb.add(bm_box((0.7, 0.7, 0.168), center=(0, 0, 3.916), bevel=0.012), mar)

    def vfn(co, n, f):
        k = 1.0 - 0.06 * max(0.0, fbm(co * 1.7 + V((2, 9, 4)), 3)) * 2
        if 0.26 < co.z < 3.6 and n.z < 0.5 and n.z > -0.5:
            t = math.atan2(co.y, co.x)
            ph = (t * NF / TAU) % 1.0
            k *= 1.0 - 0.13 * math.sin(math.pi * ph) ** 0.7
        k *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.8, co.z))
        k *= 1.0 - 0.2 * smoothstep(0.0, -1.0, n.z)
        return (k, k * 0.99, k * 0.97)
    finish(mb, 'Column', sharp=34, weighted=True, vfn=vfn)


def build_column_fractured(P):
    mar, si = P['marble'], P['stoneint']
    rng = random.Random(311)
    empty('Column_Fractured')
    NS = 20

    def poly(r, n=NS):
        return [(r * math.cos(TAU * k / n + 0.1), r * math.sin(TAU * k / n + 0.1)) for k in range(n)]
    shaft = Convex.frustum(poly(column_R(0.255)), poly(column_R(3.62)), 0.255, 3.62)
    zs = [0.44, 1.07, 1.7, 2.31, 2.93, 3.48]
    planes = []
    for z in zs:
        a, b = math.radians(rng.uniform(3, 8)), rng.uniform(0, TAU)
        planes.append(cut_plane((math.sin(a) * math.cos(b), math.sin(a) * math.sin(b), math.cos(a)),
                                (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z)))

    def vfn_out(co, n, f):
        k = 1.0 - 0.06 * max(0.0, fbm(co * 1.7 + V((2, 9, 4)), 3)) * 2
        k *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.8, co.z))
        return (k, k * 0.99, k * 0.97)
    chunks = []
    # base: plinth + torus + broken stub
    n0, d0 = planes[0]
    stub = shaft.clip(n0, d0, 'in')
    bm = bmesh.new()
    parts = [Convex.box((-0.35, -0.35, 0), (0.35, 0.35, 0.14)).to_bm({'out': 0}),
             bm_lathe([(0.0, 0.14), (0.33, 0.14), (0.342, 0.175), (0.325, 0.21), (0.304, 0.256),
                       (0.0, 0.256)], segs=16),
             stub.to_bm({'out': 0, 'in': 1})]
    base_mb = MB()
    for p_ in parts:
        set_smooth(p_, True)
        base_mb.add(p_, None, mats=[mar, si])
    chunks.append(('base', base_mb))
    # drums split into wedges
    for k in range(5):
        (na, da), (nb, db) = planes[k], planes[k + 1]
        drum = shaft.clip(-na, -da, 'in').clip(nb, db, 'in')
        m = [3, 2, 3, 2, 3][k]
        c = V((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
        th0 = rng.uniform(0, TAU)
        if m == 2:
            tilt = rng.uniform(-0.25, 0.25)
            n, d = cut_plane((math.cos(th0), math.sin(th0), tilt), c + V((0, 0, (zs[k] + zs[k + 1]) / 2)))
            pieces = [drum.clip(n, d, 'in'), drum.clip(-n, -d, 'in')]
        else:
            angs = [th0, th0 + TAU / 3 + rng.uniform(-0.3, 0.3), th0 + 2 * TAU / 3 + rng.uniform(-0.3, 0.3)]
            pieces = []
            for i in range(3):
                a0, a1 = angs[i], angs[(i + 1) % 3]
                da_ = V((math.cos(a0), math.sin(a0), 0))
                db_ = V((math.cos(a1), math.sin(a1), 0))
                n1 = V((da_.y, -da_.x, 0))
                n2 = V((-db_.y, db_.x, 0))
                w = drum.clip(n1, n1.dot(c), 'in')
                w = w.clip(n2, n2.dot(c), 'in') if w else None
                pieces.append(w)
        for pc in pieces:
            if pc is None:
                continue
            chunks.append(('drum', pc))
    # capital: broken neck + echinus + abacus
    n5, d5 = planes[5]
    neck = shaft.clip(-n5, -d5, 'in')
    cap_mb = MB()
    for p_ in [neck.to_bm({'out': 0, 'in': 1}),
               bm_lathe([(0, 3.6), (0.275, 3.6), (0.285, 3.64), (0.33, 3.74), (0.35, 3.832),
                         (0, 3.832)], segs=16),
               Convex.box((-0.35, -0.35, 3.832), (0.35, 0.35, 4.0)).to_bm({'out': 0})]:
        set_smooth(p_, True)
        cap_mb.add(p_, None, mats=[mar, si])
    chunks.append(('cap', cap_mb))
    total = 0.0
    vmax = 0
    for k, (kind, item) in enumerate(chunks):
        name = 'Column_Chunk_%02d' % k
        if kind == 'drum':
            ob, vol, nv = chunk_object(item, name, 'Column_Fractured', [mar, si], vfn_out)
            total += vol
        else:
            cen, vol = bm_volume_centroid(item.bm)
            total += vol
            ob = finish(item, name, pivot=cen, parent='Column_Fractured', sharp=35,
                        vfn=lambda co, n, f: vfn_out(co, n, f) if f.material_index == 0
                        else interior_tint(co, n, f))
            nv = len(ob.data.vertices)
            assert nv <= 128, (name, nv)
        vmax = max(vmax, nv)
    print('  Column_Fractured: %d chunks, max verts %d' % (len(chunks), vmax))


DRAWER_Z = [(0.185, 0.455), (0.495, 0.755), (0.795, 1.035)]


def build_drawers(P):
    wood, brass = P['wood'], P['brass']
    mb = MB()
    shadow = (0.18, 0.16, 0.15)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.add(move(bm_lathe([(0, 0), (0.035, 0), (0.045, 0.02), (0.042, 0.05), (0.032, 0.07),
                                  (0, 0.075)], segs=16), (0.42 * sx, 0.22 * sy, 0)), wood)
        x0, x1 = sorted((sx * 0.465, sx * 0.5))
        mb.add(bm_box_mm((x0, -0.28, 0.16), (x1, 0.28, 1.06), bevel=0.006), wood)
    mb.add(bm_box_mm((-0.49, -0.29, 0.07), (0.49, 0.29, 0.16), bevel=0.012, segs=2), wood,
           tint=(0.8, 0.8, 0.8))
    mb.add(bm_box_mm((-0.47, 0.265, 0.16), (0.47, 0.29, 1.06)), wood)
    mb.add(bm_box_mm((-0.5, -0.3, 1.06), (0.5, 0.3, 1.1), bevel=0.014, segs=3), wood)
    for (z0, z1) in ((0.16, 0.185), (0.455, 0.495), (0.755, 0.795), (1.035, 1.06)):
        mb.add(bm_box_mm((-0.466, -0.285, z0), (0.466, -0.24, z1), bevel=0.004), wood)
    mb.add(bm_box_mm((-0.466, -0.24, 0.16), (0.466, 0.266, 1.06)), wood, tint=shadow)
    for i, (z0, z1) in enumerate(DRAWER_Z):
        dy = -0.09 if i == 1 else 0.0
        y0 = -0.293 + dy
        zm = (z0 + z1) / 2
        mb.add(bm_box_mm((-0.458, y0, z0), (0.458, y0 + 0.028, z1), bevel=0.008), wood,
               tint=(1.08 * 0.93, 0.93, 0.9))
        mb.add(bm_box_mm((-0.39, y0 - 0.008, z0 + 0.045), (0.39, y0 + 0.01, z1 - 0.045), bevel=0.016,
                         segs=1), wood, tint=(0.97, 0.95, 0.93))
        for kx in (-0.24, 0.24):
            kn = bm_lathe([(0, 0), (0.012, 0), (0.009, 0.012), (0.02, 0.022), (0.025, 0.033),
                           (0.021, 0.043), (0, 0.046)], segs=20)
            rot(kn, math.pi / 2, 'X')
            mb.add(move(kn, (kx, y0 - 0.006, zm)), brass)
            pl = bm_lathe([(0, 0), (0.034, 0), (0.034, 0.002), (0.028, 0.004), (0, 0.004)], segs=20)
            scale(pl, (1.0, 1.35, 1.0))
            rot(pl, math.pi / 2, 'X')
            mb.add(move(pl, (kx, y0 - 0.006, zm)), brass)
        esc = bm_lathe([(0, 0), (0.026, 0), (0.026, 0.002), (0.02, 0.004), (0, 0.004)], segs=20)
        scale(esc, (0.8, 1.4, 1.0))
        rot(esc, math.pi / 2, 'X')
        mb.add(move(esc, (0, y0 - 0.006, zm)), brass)
        kh = bm_prism([(-0.004, -0.016), (0.004, -0.016), (0.0025, 0.0), (0.006, 0.006), (0.0, 0.011),
                       (-0.006, 0.006), (-0.0025, 0.0)], 0.0, 0.003)
        rot(kh, math.pi / 2, 'X')
        mb.add(move(kh, (0, y0 - 0.0085, zm)), P['ink'])
        if dy:
            for sx in (-1, 1):
                mb.add(bm_box_mm((sx * 0.445 - 0.007, y0 + 0.028, z0 + 0.02),
                                 (sx * 0.445 + 0.007, y0 + 0.2, z1 - 0.035)), wood,
                       tint=(0.75, 0.72, 0.7))
            mb.add(bm_box_mm((-0.445, y0 + 0.028, z0 + 0.02), (0.445, y0 + 0.2, z0 + 0.03)), wood,
                   tint=(0.35, 0.33, 0.32))
    finish(mb, 'Drawers', sharp=40, weighted=True, vfn=ao_fn(h=0.2, amt=0.25, down=0.3))


def build_drawers_fractured(P):
    wood, wi = P['wood'], P['woodint']
    empty('Drawers_Fractured')
    B = Convex.box
    pieces = []

    def split(c, n, pt):
        n, d = cut_plane(n, pt)
        return [c.clip(n, d, 'in'), c.clip(-n, -d, 'in')]
    top = B((-0.5, -0.3, 1.06), (0.5, 0.3, 1.1))
    a, b = split(top, (1, 0.45, 0.05), (0.12, 0, 1.08))
    sl, a = split(a, (0, -1, 0.12), (0, -0.235, 1.08))
    pieces += [a, b, sl]
    left = B((-0.5, -0.28, 0.16), (-0.465, 0.28, 1.06))
    sl2, left = split(left, (0.05, -1, 0.06), (0, -0.2, 0.6))
    pieces += [left, sl2]
    right = B((0.465, -0.28, 0.16), (0.5, 0.28, 1.06))
    pieces += split(right, (0, 0.35, 1), (0.48, 0, 0.62))
    back = B((-0.465, 0.265, 0.16), (0.465, 0.29, 1.06))
    pieces += split(back, (1, 0, 0.5), (-0.05, 0.28, 0.6))
    for i, (z0, z1) in enumerate(DRAWER_Z):
        fr = B((-0.458, -0.293, z0), (0.458, -0.265, z1))
        if i == 1:
            pieces += split(fr, (1, 0.1, -0.7), (0.1, -0.28, (z0 + z1) / 2))
        else:
            pieces.append(fr)
    pieces.append(B((-0.49, -0.29, 0.0), (0.49, 0.29, 0.16)))
    vmax = 0
    for k, c in enumerate(p for p in pieces if p is not None):
        ob, vol, nv = chunk_object(c, 'Drawers_Chunk_%02d' % k, 'Drawers_Fractured', [wood, wi],
                                   ao_fn(h=0.2, amt=0.2, down=0.3))
        vmax = max(vmax, nv)
    print('  Drawers_Fractured: %d chunks, max verts %d' % (k + 1, vmax))


def build_arch(P):
    st = P['arcade']
    K = 16
    Rr, zs, W, H, D = 1.2, 2.6, 2.0, 5.0, 0.5
    arc = [(Rr * math.cos(math.pi - math.pi * k / K), zs + Rr * math.sin(math.pi - math.pi * k / K))
           for k in range(K + 1)]
    outer = []
    for (x, z) in arc:
        dx, dz = x / Rr, (z - zs) / Rr
        ts = []
        if abs(dx) > 1e-9:
            ts.append(W / abs(dx))
        if dz > 1e-9:
            ts.append((H - zs) / dz)
        t = min(ts)
        outer.append((dx * t, zs + dz * t))

    def side(q):
        if abs(q[0] + W) < 1e-6:
            return 'L'
        if abs(q[0] - W) < 1e-6:
            return 'R'
        return 'T'
    polys = [[(-W, 0), (-Rr, 0), (-Rr, zs), (-W, zs)], [(Rr, 0), (W, 0), (W, zs), (Rr, zs)]]
    for k in range(K):
        p0, p1, q0, q1 = arc[k], arc[k + 1], outer[k], outer[k + 1]
        poly = [p0, p1, q1]
        s0, s1 = side(q0), side(q1)
        if s0 != s1:
            if s0 == 'L':
                poly.append((-W, H))
            elif s1 == 'R':
                poly.append((W, H))
        poly.append(q0)
        polys.append(poly)
    bm = bmesh.new()
    cache = {}

    def vert(x, y, z):
        key = (round(x, 5), round(y, 5), round(z, 5))
        if key not in cache:
            cache[key] = bm.verts.new((x, y, z))
        return cache[key]
    for poly in polys:
        clean = []
        for p in poly:
            if not clean or (abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6):
                clean.append(p)
        bm.faces.new([vert(x, -D, z) for (x, z) in clean])
        bm.faces.new([vert(x, D, z) for (x, z) in reversed(clean)])
    # walls: every boundary edge of the front face set gets a quad to the back
    front_edges = [e for e in bm.edges if len(e.link_faces) == 1 and all(abs(v.co.y + D) < 1e-6 for v in e.verts)]
    for e in front_edges:
        a, b = e.verts
        a2, b2 = vert(a.co.x, D, a.co.z), vert(b.co.x, D, b.co.z)
        try:
            bm.faces.new([a, b, b2, a2])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    grid_cut(bm, 2, [0.7, 1.4, 2.0, 3.3, 4.2])
    set_smooth(bm, False)
    mb = MB()
    mb.add(bm, st)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * W, sx * (Rr - 0.04)))
        mb.add(bm_box_mm((x0, -D - 0.04, 0), (x1, D + 0.04, 0.32), bevel=0.012), st, tint=(0.82, 0.8, 0.78))
        x0, x1 = sorted((sx * W, sx * (Rr - 0.03)))
        mb.add(bm_box_mm((x0, -D - 0.03, zs - 0.1), (x1, D + 0.03, zs + 0.02), bevel=0.01), st)
    band = [(1.44 * math.cos(math.pi * k / 24), zs + 1.44 * math.sin(math.pi * k / 24)) for k in range(25)]
    band += [(Rr * math.cos(math.pi - math.pi * k / 24), zs + Rr * math.sin(math.pi - math.pi * k / 24))
             for k in range(25)]
    for (z0, z1) in ((D - 0.01, D + 0.025), (-D - 0.025, -D + 0.01)):
        pr = bm_prism(band, z0, z1)
        rot(pr, math.pi / 2, 'X')
        mb.add(pr, st, tint=(0.95, 0.93, 0.9))
    ks = bm_prism([(-0.13, 3.74), (0.13, 3.74), (0.17, 4.1), (-0.17, 4.1)], -D - 0.045, D + 0.045)
    rot(ks, math.pi / 2, 'X')
    mb.add(ks, st, tint=(0.97, 0.95, 0.93))
    mb.add(bm_box_mm((-W, -D - 0.025, 4.74), (W, D + 0.025, 4.83), bevel=0.01), st)
    mb.add(bm_box_mm((-W, -D - 0.05, 4.83), (W, D + 0.05, 5.0), bevel=0.015), st)

    def vfn(co, n, f):
        k = 1.0 - 0.1 * max(0.0, fbm(co * 0.8 + V((3, 3, 3)), 3)) * 2
        c = f.calc_center_median()
        if abs(c.x) < Rr - 0.001 and c.z < 3.85 and abs(c.y) < D - 0.001:
            k *= 0.72 + 0.18 * smoothstep(D, D * 0.2, abs(co.y))
        k *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.2, co.z))
        k *= 1.0 - 0.15 * smoothstep(0.0, -1.0, n.z)
        streak = max(0.0, noise.noise(V((co.x * 1.8, 3.3, 0.7)))) * smoothstep(3.0, 4.74, co.z)
        k *= 1.0 - 0.18 * streak
        return (k, k * 0.98, k * 0.96)
    finish(mb, 'Arch', sharp=40, vfn=vfn)


def build_dead_tree(P):
    dw = P['deadwood']
    rng = random.Random(1931)
    verts, edges, radii = [], [], []

    def node(p, r, parent=None):
        verts.append(V(p))
        radii.append(r)
        i = len(verts) - 1
        if parent is not None:
            edges.append((parent, i))
        return i

    def branch(parent, pts, r0, r1, jitter=0.03):
        idx = parent
        out = []
        for k, p in enumerate(pts):
            t = (k + 1) / len(pts)
            p = V(p) + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter
            idx = node(p, lerp(r0, r1, t) * rng.uniform(0.9, 1.12), idx)
            out.append(idx)
        return out
    root = node((0, 0, 0.0), 0.2)
    trunk = branch(root, [(0.04, 0.02, 0.35), (-0.04, 0.05, 0.7), (0.05, -0.03, 1.05),
                          (0.1, 0.0, 1.4), (0.06, 0.03, 1.72), (0.02, 0.0, 2.0)], 0.17, 0.11, 0.0)
    top = branch(trunk[-1], [(-0.1, 0.04, 2.35), (-0.18, 0.02, 2.68), (-0.24, -0.02, 2.95),
                             (-0.3, 0.0, 3.2)], 0.1, 0.03)
    branch(top[1], [(0.05, 0.2, 2.9), (0.1, 0.3, 3.05)], 0.05, 0.02)
    branch(trunk[-1], [(0.3, -0.02, 2.13), (0.62, 0.03, 2.22), (0.98, 0.0, 2.27), (1.34, -0.04, 2.28),
                       (1.66, 0.0, 2.25), (1.9, 0.02, 2.19), (2.08, 0.03, 2.12)], 0.1, 0.028, 0.0)
    lb = branch(trunk[3], [(-0.25, 0.04, 1.62), (-0.5, 0.0, 1.9), (-0.68, -0.05, 2.2),
                           (-0.8, 0.0, 2.48), (-0.86, 0.02, 2.62)], 0.075, 0.022)
    branch(lb[2], [(-0.95, 0.12, 2.25), (-1.1, 0.18, 2.3)], 0.03, 0.012)
    branch(trunk[2], [(0.12, 0.28, 1.2), (0.12, 0.42, 1.28)], 0.055, 0.04, 0.0)
    for k in range(5):
        a = TAU * k / 5 + 0.4
        L = rng.uniform(0.45, 0.65)
        branch(root, [(math.cos(a) * L * 0.5, math.sin(a) * L * 0.5, 0.05),
                      (math.cos(a) * L, math.sin(a) * L, 0.0)], 0.1, 0.035, 0.0)
    bm = bm_skin(verts, edges, radii, levels=2, root=0)

    def bark(co, n):
        q = V((co.x * 7, co.y * 7, co.z * 1.6))
        ridge = abs(noise.noise(q)) * 2 - 1
        g = fbm(co * 2.5, 2)
        return co + n * (0.012 * ridge + 0.035 * g)
    displace(bm, bark)
    for v in bm.verts:
        if v.co.z < 0.0:
            v.co.z = 0.0
    set_smooth(bm)
    mb = MB()
    mb.add(bm, dw)

    def vfn(co, n, f):
        q = V((co.x * 7, co.y * 7, co.z * 1.6))
        ridge = abs(noise.noise(q))
        k = 0.55 + 0.45 * smoothstep(0.05, 0.5, ridge)
        k *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.8, co.z))
        k *= 1.0 - 0.2 * smoothstep(0.0, -1.0, n.z)
        return (k, k * 0.95, k * 0.88)
    finish(mb, 'DeadTree', sharp=None, vfn=vfn)


def build_door(P):
    frame = material('DoorFrame', '#ede1c4', 0.0, 0.8)
    paint = material('DoorPaint', '#2a5f5c', 0.0, 0.48)
    brass = P['brass']
    light = material('DoorLight', '#fff0c0', 0.0, 1.0, emit='#ffd98c', strength=4.0)
    mb = MB()
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.55, sx * 0.65))
        mb.add(bm_box_mm((x0, -0.11, 0), (x1, 0.11, 2.4), bevel=0.006), frame)
        x0, x1 = sorted((sx * 0.57, sx * 0.65))
        for (y0, y1) in ((-0.125, -0.1), (0.1, 0.125)):
            mb.add(bm_box_mm((x0, y0, 0), (x1, y1, 2.47), bevel=0.008, segs=2), frame)
        x0, x1 = sorted((sx * 0.55, sx * 0.535))
        mb.add(bm_box_mm((x0, 0.022, 0.02), (x1, 0.05, 2.385)), frame)
    mb.add(bm_box_mm((-0.65, -0.11, 2.4), (0.65, 0.11, 2.47), bevel=0.006), frame)
    mb.add(bm_box_mm((-0.55, 0.022, 2.385), (0.55, 0.05, 2.4)), frame)
    for (y0, y1) in ((-0.125, -0.1), (0.1, 0.125)):
        mb.add(bm_box_mm((-0.65, y0, 2.4), (0.65, y1, 2.47), bevel=0.008), frame)
    mb.add(bm_box_mm((-0.65, -0.125, 2.47), (0.65, 0.125, 2.5), bevel=0.01, segs=2), frame)
    mb.add(bm_box_mm((-0.55, -0.11, 0.0), (0.55, 0.11, 0.02), bevel=0.004), frame, tint=(0.8, 0.78, 0.75))
    finish(mb, 'Door', sharp=40, weighted=True, vfn=ao_fn(h=0.3, amt=0.3))
    # the leaf: slab with six raised panels per side, knobs and hinges
    lb = MB()
    y0, y1 = -0.03, 0.02
    lb.add(bm_box_mm((-0.546, y0, 0.023), (0.546, y1, 2.382), bevel=0.004), paint)
    cols = [(-0.46, -0.04), (0.04, 0.46)]
    rows = [(0.14, 0.72), (0.84, 1.52), (1.64, 2.27)]
    for (xa, xb) in cols:
        for (za, zb) in rows:
            for (ya, yb) in ((y0 - 0.008, y0 + 0.004), (y1 - 0.004, y1 + 0.008)):
                lb.add(bm_box_mm((xa, ya, za), (xb, yb, zb), bevel=0.02, segs=1), paint)
    for (yy, sgn) in ((y0, -1), (y1, 1)):
        kn = bm_lathe([(0, 0), (0.012, 0), (0.008, 0.015), (0.018, 0.03), (0.028, 0.045),
                       (0.025, 0.058), (0, 0.062)], segs=24)
        rot(kn, -sgn * math.pi / 2, 'X')
        lb.add(move(kn, (0.44, yy, 1.02)), brass)
        lb.add(bm_box_mm((0.425, yy - 0.004 if sgn < 0 else yy, 0.93),
                         (0.455, yy if sgn < 0 else yy + 0.004, 1.1), bevel=0.003), brass)
    hinge = V((-0.55, y0, 0.0))         # front-left edge: the leaf swings out toward -Y
    for z in (0.3, 1.2, 2.1):
        kb = bm_lathe([(0, z - 0.06), (0.012, z - 0.06), (0.012, z + 0.06), (0.008, z + 0.07), (0, z + 0.075)],
                      segs=12)
        lb.add(move(kb, (hinge.x, hinge.y, 0)), brass)
    finish(lb, 'Door_Leaf', pivot=hinge, parent='Door', sharp=40, weighted=True)
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


STRATA = [(1.0, 0.96, 0.9), (0.93, 0.78, 0.62), (0.84, 0.6, 0.44), (0.97, 0.87, 0.74)]


def strata_color(co, off, n):
    q = co.z * 3.0 + 0.9 * fbm(co * 0.6 + off, 2)
    i = int(math.floor(q)) % len(STRATA)
    f = q - math.floor(q)
    c = mix3(STRATA[i], STRATA[(i + 1) % len(STRATA)], smoothstep(0.75, 1.0, f))
    k = 1.0 - 0.18 * max(0.0, math.sin(q * TAU * 2.0)) * 0.5
    k *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.45, co.z))
    k *= 1.0 - 0.3 * smoothstep(0.1, -0.9, n.z)
    return (c[0] * k, c[1] * k, c[2] * k)


def build_rock(P, name, prof, seed, sx=1.0, sy=1.0, lean=0.0, droop=None, ns=0.16):
    sand = P['sandstone']
    rng = random.Random(seed)
    off = V((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    a1, a2 = rng.uniform(0, TAU), rng.uniform(0, TAU)
    rmax = max(p[0] for p in prof)

    def vf(t, r, z):
        rr = r * (1 + 0.13 * math.cos(t - a1) + 0.08 * math.cos(2 * t - a2) + 0.04 * math.cos(3 * t + a1))
        x, y = rr * math.cos(t) * sx, rr * math.sin(t) * sy
        zz = z
        if droop:
            (dz0, dz1, amt, da) = droop
            w = max(0.0, math.cos(t - da)) ** 2
            zz -= amt * w * smoothstep(dz0, dz1, z) * smoothstep(0.3, 1.0, r / rmax)
        return (x + lean * z, y, zz)
    bm = bm_lathe(smooth_profile(prof, 27), segs=27, vfun=vf)

    def disp(co, n):
        g = 0.65 * fbm(co * 0.33 + off, 3) + 0.35 * fbm(co * 1.1 + off * 0.7, 3)
        side = 1.0 - abs(n.z)
        q = co.z * 2.2 + 0.6 * fbm(co * 0.35 + off * 1.3, 2)
        fq = q - math.floor(q)
        ledge = smoothstep(0.0, 0.7, fq) - smoothstep(0.85, 1.0, fq)
        return co + n * (ns * g + 0.13 * side * (ledge - 0.5))
    displace(bm, disp)
    bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.12, use_axis_x=True, use_axis_y=True,
                          use_axis_z=True)
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
        if v.co.z < 0.04:
            v.co.z = 0.0
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    move(bm, (-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, 0))
    set_smooth(bm)
    mb = MB()
    mb.add(bm, sand)

    def vfn(co, n, f):
        c = strata_color(co, off, n)
        g = fbm(co * 0.5 + off, 4)
        k = 1.0 - 0.25 * smoothstep(0.0, -0.4, g)
        return (c[0] * k, c[1] * k, c[2] * k)
    finish(mb, name, sharp=None, vfn=vfn)


def build_rocks(P):
    build_rock(P, 'Rock_A', [(0, 3.0), (0.7, 2.96), (1.2, 2.78), (1.38, 2.5), (1.25, 2.26), (0.85, 2.12),
                             (0.7, 1.7), (0.68, 1.1), (0.85, 0.5), (1.05, 0.15), (1.0, -0.05),
                             (0, -0.08)], seed=11, sx=1.0, sy=0.8,
               droop=(1.9, 2.6, 0.55, 0.8), ns=0.3)
    build_rock(P, 'Rock_B', [(0, 1.85), (0.9, 1.78), (1.55, 1.5), (1.95, 1.0), (2.0, 0.55), (1.85, 0.15),
                             (1.6, -0.05), (0, -0.08)], seed=23, sx=1.0, sy=0.72,
               droop=(0.9, 1.6, 0.4, 2.6), ns=0.38)
    build_rock(P, 'Rock_C', [(0, 2.45), (0.45, 2.4), (0.85, 2.1), (1.02, 1.7), (0.95, 1.3), (0.62, 0.95),
                             (0.6, 0.55), (0.82, 0.18), (0.8, -0.05), (0, -0.08)], seed=37, sx=1.0,
               sy=0.75, lean=0.28, droop=(1.3, 2.2, 0.45, 0.2), ns=0.3)


def build_platform(P):
    sand, sst = P['sand'], P['sandstone']
    stone = material('PlatformStone', '#b49a72', 0.0, 0.85)
    roots = P['deadwood']
    rng = random.Random(77)
    mb = MB()
    top = bm_grid(12, 12, -1.34, 1.34, -1.34, 1.34, z=-0.004)
    mb.add(top, sand, smooth=False,
           tint=lambda co: grey(0.93 + 0.07 * math.sin(co.x * 9 + 2.0 * fbm(co * 1.3, 2))))
    # stone lip: a ring of bevelled blocks, tops flush at z = 0
    blocks = []
    for k in range(6):
        x0 = -1.5 + k * 0.5
        blocks.append(((x0, -1.5), (x0 + 0.5, -1.33)))
        blocks.append(((x0, 1.33), (x0 + 0.5, 1.5)))
    for k in range(5):
        y0 = -1.33 + k * (2.66 / 5)
        blocks.append(((-1.5, y0), (-1.33, y0 + 2.66 / 5)))
        blocks.append(((1.33, y0), (1.5, y0 + 2.66 / 5)))
    for (a, b) in blocks:
        zb = -rng.uniform(0.26, 0.32)
        g = 0.006
        x0 = a[0] if abs(a[0]) >= 1.5 else a[0] + g
        y0 = a[1] if abs(a[1]) >= 1.5 else a[1] + g
        x1 = b[0] if abs(b[0]) >= 1.5 else b[0] - g
        y1 = b[1] if abs(b[1]) >= 1.5 else b[1] - g
        t = rng.uniform(0.84, 1.0)
        mb.add(bm_box_mm((x0, y0, zb), (x1, y1, 0.0), bevel=0.02, segs=2), stone,
               tint=(t, t * 0.98, t * 0.95))
    # tapered rocky underside
    off = V((3.1, 7.2, 1.9))
    prof = [(1.44, -0.2), (1.46, -0.3), (1.3, -0.45), (1.05, -0.62), (0.75, -0.8), (0.45, -0.95),
            (0.18, -1.06), (0.0, -1.1)]

    def se(t, r, z):
        e = lerp(4.0, 2.0, smoothstep(-0.3, -0.9, z))
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** (2 / e), c)
        y = math.copysign(abs(s) ** (2 / e), s)
        return (r * x, r * y, z)
    under = bm_lathe(list(reversed(prof)), segs=48, vfun=se)

    def disp(co, n):
        if co.z > -0.28:
            return co
        g = fbm(co * 1.4 + off, 4)
        return co + n * 0.12 * g * smoothstep(-0.28, -0.45, co.z)
    displace(under, disp)
    mb.add(under, sst)
    # hanging roots and drips
    for k in range(6):
        a = TAU * k / 6 + rng.uniform(-0.3, 0.3)
        r0 = rng.uniform(0.5, 1.0)
        x, y = math.cos(a) * r0, math.sin(a) * r0
        z0 = -0.45 - (1.0 - r0) * 0.3
        pts, rad = [], []
        L = min(rng.uniform(0.35, 0.7), 1.17 + z0)
        for i in range(8):
            s = i / 7
            pts.append((x * (1 + 0.15 * s) + 0.05 * math.sin(s * 7 + k), y * (1 + 0.15 * s),
                        z0 - L * s))
            rad.append(lerp(0.035, 0.0, s ** 1.3))
        mb.add(bm_tube(pts, rad, sides=6), roots, tint=grey(0.7))
    for k in range(3):
        a = TAU * k / 3 + 1.0
        x, y = math.cos(a) * 0.35, math.sin(a) * 0.35
        zb = -1.18 + 0.08 * k
        drip = bm_lathe([(0, zb), (0.028, zb + 0.03), (0.04, zb + 0.06), (0.025, zb + 0.12),
                         (0.05, -0.8), (0.0, -0.7)], segs=12)
        mb.add(move(drip, (x, y, 0)), sst)

    def vfn(co, n, f):
        if co.z > -0.26:
            return (1.0, 1.0, 1.0)
        c = strata_color(co * 1.8, off, n)
        k = 1.0 - 0.35 * smoothstep(-0.3, -1.1, co.z)
        return (c[0] * k, c[1] * k, c[2] * k)
    finish(mb, 'Platform', sharp=40, vfn=vfn)


def build_railpost(P):
    wood = material('CrutchWood', '#a9763f', 0.0, 0.55)
    pad = material('Leather', '#6e2320', 0.0, 0.6)
    rubber = material('Rubber', '#231f1d', 0.0, 0.8)
    sand = P['sand']
    brass = P['brass']
    mb = MB()
    mb.add(bm_lathe([(0, 0), (0.15, 0), (0.12, 0.02), (0.07, 0.045), (0.025, 0.055), (0, 0.056)], segs=32),
           sand, tint=grey(0.92))
    mb.add(bm_lathe([(0, 0.02), (0.024, 0.02), (0.026, 0.05), (0.02, 0.075), (0.018, 0.08), (0, 0.08)],
                    segs=16), rubber)
    mb.add(bm_lathe([(0, 0.075), (0.02, 0.075), (0.02, 0.62), (0.025, 0.63), (0.025, 0.66),
                     (0, 0.66)], segs=14), wood)
    mb.add(bm_lathe([(0, 0.57), (0.026, 0.57), (0.026, 0.62), (0, 0.62)], segs=14), brass)
    # two bowed uprights forking into a Y
    zs = [0.62, 0.72, 0.85, 1.0, 1.15, 1.3, 1.42, 1.5, 1.58, 1.66, 1.7]
    for sgn in (-1, 1):
        pts = []
        for z in zs:
            t = (z - 0.62) / (1.5 - 0.62)
            if z <= 1.5:
                x = 0.016 + 0.082 * math.sin(math.pi * min(1.0, t) * 0.75) ** 0.9
            else:
                x = 0.08 + (z - 1.5) * 0.3
            pts.append((sgn * x, 0, z))
        rad = [0.018] * (len(pts) - 1) + [0.016]
        tube = bm_tube(pts, rad, sides=10)
        mb.add(tube, wood)
        mb.add(bm_ico(0.0175, 2, center=pts[-1], sc=(1, 1, 0.8)), wood)
    grip = bm_lathe([(0, -0.1), (0.018, -0.1), (0.022, -0.06), (0.022, 0.06), (0.018, 0.1), (0, 0.1)],
                    segs=12)
    rot(grip, math.pi / 2, 'Y')
    mb.add(move(grip, (0, 0, 1.08)), wood, tint=(0.8, 0.75, 0.7))
    # saddle: rail rests with its centre line at z = 1.6 (notch bottom at 1.55)
    sad = []
    for k in range(13):
        x = lerp(-0.1, 0.1, k / 12)
        sad.append((x, 0, 1.55 - 0.022 + 0.035 * (x / 0.1) ** 2))
    mb.add(bm_tube(sad, [(0.022, 0.045)] * len(sad), sides=12), pad)
    finish(mb, 'RailPost', sharp=45, vfn=ao_fn(h=0.15, amt=0.25))


def build_train(P):
    body = material('TrainBody', '#1f2a2c', 0.35, 0.45)
    red = material('TrainRed', '#6d1f1c', 0.1, 0.55)
    brass = P['brass']
    glassm = material('TrainWindow', '#0c0f10', 0.2, 0.2)
    mb = MB()
    mb.add(bm_box_mm((-4.0, -0.85, 0.62), (3.55, 0.85, 0.95), bevel=0.03), red)
    for x in (-1.75, -0.45, 0.85):
        for sy in (-1, 1):
            w = bm_lathe([(0, -0.06), (0.52, -0.06), (0.6, -0.04), (0.6, 0.04), (0.52, 0.06),
                          (0.12, 0.08), (0, 0.1)], segs=32)
            rot(w, sy * -math.pi / 2, 'X')
            mb.add(move(w, (x, sy * 0.92, 0.6)), red)
    for x in (2.55, 3.25):
        for sy in (-1, 1):
            w = bm_lathe([(0, -0.05), (0.32, -0.05), (0.36, -0.03), (0.36, 0.03), (0.32, 0.05),
                          (0, 0.07)], segs=24)
            rot(w, sy * -math.pi / 2, 'X')
            mb.add(move(w, (x, sy * 0.9, 0.36)), red)
    for sy in (-1, 1):
        mb.add(bm_box_mm((-1.9, sy * 1.02 - 0.03, 0.5), (1.0, sy * 1.02 + 0.03, 0.62), bevel=0.02),
               brass)
    boiler = bm_lathe([(0, -1.5), (0.78, -1.5), (0.78, 3.35), (0.72, 3.42), (0.4, 3.5), (0, 3.52)],
                      segs=40)
    rot(boiler, math.pi / 2, 'Y')
    mb.add(move(boiler, (0, 0, 1.75)), body)
    for x in (-0.6, 0.9, 2.3, 3.3):
        band = bm_lathe([(0.785, -0.04), (0.8, -0.03), (0.8, 0.03), (0.785, 0.04)], segs=40, cap=False)
        rot(band, math.pi / 2, 'Y')
        mb.add(move(band, (x, 0, 1.75)), brass)
    stack = bm_lathe([(0, 2.3), (0.26, 2.3), (0.22, 2.45), (0.18, 2.62), (0.2, 2.75), (0.3, 2.9),
                      (0.33, 3.0), (0.26, 3.0), (0, 2.96)], segs=28)
    mb.add(move(stack, (2.85, 0, 0)), body)
    dome = bm_lathe([(0, 2.35), (0.34, 2.35), (0.32, 2.5), (0.26, 2.62), (0.14, 2.7), (0, 2.72)], segs=28)
    mb.add(move(dome, (1.1, 0, 0)), brass)
    dome2 = bm_lathe([(0, 2.35), (0.24, 2.35), (0.22, 2.45), (0.12, 2.55), (0, 2.57)], segs=24)
    mb.add(move(dome2, (0.05, 0, 0)), body)
    lamp = bm_lathe([(0, 0), (0.16, 0), (0.16, 0.22), (0.13, 0.26), (0, 0.26)], segs=20)
    rot(lamp, math.pi / 2, 'Y')
    mb.add(move(lamp, (3.4, 0, 2.3)), brass)
    # cab
    mb.add(bm_box_mm((-3.3, -1.0, 0.95), (-1.45, 1.0, 2.65), bevel=0.03), body)
    rpts = [(-1.1, 2.62), (1.1, 2.62)] + [(lerp(1.1, -1.1, k / 12), 2.72 + 0.12 * math.cos(math.pi * lerp(1.1, -1.1, k / 12) / 2.2))
                                          for k in range(13)]
    rf = bm_prism(rpts, -3.42, -1.35)
    xform(rf, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    mb.add(rf, red)
    for sy in (-1, 1):
        mb.add(bm_box_mm((-3.0, sy * 1.0 - 0.012, 1.85), (-2.45, sy * 1.0 + 0.012, 2.4)), glassm)
        mb.add(bm_box_mm((-2.25, sy * 1.0 - 0.012, 1.85), (-1.7, sy * 1.0 + 0.012, 2.4)), glassm)
    # cowcatcher + buffer beam
    cc = bm_prism([(3.55, -0.85), (3.55, 0.85), (4.0, 0.05), (4.0, -0.05)], 0.12, 0.62)
    for v in cc.verts:
        if v.co.x > 3.9 and v.co.z > 0.5:
            v.co.z = 0.28
    mb.add(cc, red, smooth=False)
    mb.add(bm_box_mm((3.45, -0.95, 0.72), (3.6, 0.95, 1.0), bevel=0.02), red)
    for sy in (-1, 1):
        bf = bm_lathe([(0, 0), (0.09, 0), (0.09, 0.2), (0.12, 0.22), (0.12, 0.26), (0, 0.26)], segs=16)
        rot(bf, math.pi / 2, 'Y')
        mb.add(move(bf, (3.6, sy * 0.65, 0.86)), brass)
    finish(mb, 'Train', sharp=40, weighted=True,
           vfn=ao_fn(h=0.8, amt=0.35, down=0.3))


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
    [('UW_Leg%d_Lower' % i, 'UW_Leg%d' % i, None) for i in range(4)]

REQUIRED_MATERIALS = ['MirrorGlass', 'Flame', 'Seeds', 'WallInterior', 'StoneInterior', 'WoodInterior',
                      'EnemyCore', 'Mannequin', 'Sheet', 'EyeWhite', 'Flesh', 'BossLeg', 'Iris', 'DoorLight']


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_texcoords=False, export_normals=True, export_cameras=False,
                              export_lights=False, export_vertex_color='MATERIAL',
                              export_animations=False, export_extras=False)


def read_glb_json(path):
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + ln]), len(data)


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
    print('\nCONTRACT CHECK: %s' % ('PASS' if not errors else 'FAIL'))
    for e in errors:
        print('  ' + e)
    return not errors, tris, size


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
