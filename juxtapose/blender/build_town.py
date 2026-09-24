#!/usr/bin/env python3
"""
Juxtapose -- the half-buried fishing village (Soft Desert layer).

Builds the town kit procedurally with bpy/bmesh, exports assets/town.glb,
packs it with blender/pack_glb.py (int8 normals, RGBA8 COLOR_0, bare collision
meshes) and verifies the packed file the game loads.

    python3 juxtapose/blender/build_town.py
    python3 juxtapose/blender/build_town.py --only B_Cottage,H_Cliff --out /tmp/t.glb
    python3 juxtapose/blender/build_town.py --no-pack --no-verify

Roots: B_Workshop B_Cottage B_House B_Chapel B_Station B_StationPlatform B_Tower
B_Boathouse B_Loggia, TP_Stucco TP_Stucco_Fractured, H_Cliff_A/B/C H_Islet H_Ridge.
The street props (T_*) live in assets/street.glb (blender/build_street.py).

Conventions
  * metres, Blender Z-up; every root sits at the world origin with an identity
    transform; its origin is ground level at the centre of its footprint (the
    chapel: the centre of the nave; the tower stands at its front-left).
  * front doors face Blender -Y (three.js +Z).
  * textured materials are named TX_<texture> (assets/tex/<texture>_*.jpg,
    tile size in assets/tex/manifest.json).  Base colour is white; nothing is
    embedded.  Every textured face is UV-mapped in metres (box projection in
    the root's local space; roofs use along-eave / up-slope metres), so the
    game sets texture.repeat = 1 / tile.
  * COLOR_0 = baked ambient occlusion (Cycles AO bake to vertex colours: a
    5 m pass for interiors and a 1.2 m pass against a ground plane for contact
    shadow) x ground grime x an occasional meaningful tint (painted dados, the
    blue apse), through the game's curve 0.22 + 0.78 c^0.65.  Multiply it in.
  * <Root>_COL_<n>: hidden boxes, axis-aligned in their own local space
    (rotation lives in the object transform, never in the vertices).
    <Root>_COL_TRI_<n>: low-poly trimesh colliders (cliffs, islet, hip and
    pyramid roofs, the tower's rubble).
    Stairs are single sloped boxes; every exterior doorway has a ~20 degree
    threshold ramp box from 0.1 m below the ground up to the 0.3 m floor.
  * SLOT_<Kind>_<n> empties (n unique across this file): prop kinds (Clock,
    Candle, Mirror, Anvil, Bed, BowlerHat, Birdcage, Pomegranate, Drawers,
    Frame) stand on the surface the prop rests on; panel / light / scrap /
    spawn as described in the brief.  An empty's -Y axis is its "front": for
    props against a wall it faces into the room; for SLOT_panel it is the
    panel's -Y face, the panel's X runs along the wall and Z is up.

Reuse from another script (importing has no side effects):
    import build_town as T
    P = T.init_scene()                     # fresh scene + palette
    A = T.Asset('T_Well', P, budget=1500)  # add parts, colliders, slots
    A.finalize()                           # meshes, colliders, empties, AO bake
    T.cleanup_scene(); T.export(path); T.pack(path)
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
import numpy as np
from mathutils import Vector as V, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(PROJ, 'assets', 'town.glb')
TEX_DIR = os.path.join(PROJ, 'assets', 'tex')
TAU = math.tau

T_WALL = 0.4          # wall thickness
STOREY = 3.6          # floor-to-floor
F0 = 0.3              # ground floor top above the origin
ZB = -0.6             # walls and plinths continue this far below the sand


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
DEBUG_TRIS = {} if os.environ.get('TOWN_DEBUG_TRIS') else None
TEXTURES = ['stucco', 'plaster', 'stone', 'terracotta', 'rooftile', 'wood', 'oak', 'schist', 'marble',
            'sandstone', 'iron']
TEX_ROUGH = {'stucco': 0.85, 'plaster': 0.78, 'stone': 0.85, 'terracotta': 0.68, 'rooftile': 0.78,
             'wood': 0.75, 'oak': 0.6, 'schist': 0.82, 'marble': 0.3, 'sandstone': 0.9, 'iron': 0.55}


def _mat(name, lin, metal, rough, emit=None, strength=0.0, alpha=1.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
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
    return m


def tx(name):
    """Textured material TX_<name>: white base, the game attaches assets/tex/<name>_*."""
    key = 'TX_' + name
    if key not in MATS:
        assert name in TEXTURES, name
        MATS[key] = _mat(key, (1.0, 1.0, 1.0), 1.0 if name == 'iron' else 0.0, TEX_ROUGH[name])
    return MATS[key]


def plain(name, color, metal=0.0, rough=0.6, emit=None, strength=0.0, alpha=1.0, double=False):
    """Untextured accent material (glass, paint, cloth, brass...)."""
    if name not in MATS:
        MATS[name] = _mat(name, hexcol(color), metal, rough, emit, strength, alpha, double)
    return MATS[name]


def palette():
    P = {n: tx(n) for n in TEXTURES}
    P['glass'] = plain('Glass', '#5d7a7c', 0.0, 0.08, alpha=0.32)
    P['glassdark'] = plain('GlassDark', '#28383c', 0.0, 0.1)
    P['brass'] = plain('Brass', '#c9a24e', 1.0, 0.32)
    P['bronze'] = plain('BellBronze', '#8a6a3c', 1.0, 0.38)
    P['ink'] = plain('Ink', '#1b1816', 0.0, 0.45)
    P['face'] = plain('ClockFace', '#f1e6c8', 0.0, 0.45)
    P['signpaint'] = plain('SignPaint', '#2f4f46', 0.0, 0.6)
    P['gilt'] = plain('SignGilt', '#d7b25a', 0.6, 0.35)
    P['paintblue'] = plain('PaintBlue', '#3f7d8c', 0.0, 0.6)
    P['paintochre'] = plain('PaintOchre', '#d6a45c', 0.0, 0.8)
    P['clay'] = plain('Clay', '#b8653d', 0.0, 0.8)
    P['clayglaze'] = plain('ClayGlazed', '#3f6f78', 0.0, 0.3)
    P['cloth'] = plain('Cloth', '#e8dcc2', 0.0, 0.95, double=True)
    P['awning'] = plain('Awning', '#c9d4d0', 0.0, 0.9, double=True)
    P['linen'] = plain('Linen', '#efe8da', 0.0, 0.9)
    P['straw'] = plain('Straw', '#a88d58', 0.0, 0.95)
    P['rope'] = plain('Rope', '#a58f68', 0.0, 0.95)
    P['foliage'] = plain('Foliage', '#3f5a2c', 0.0, 0.85)
    P['olive'] = plain('OliveLeaf', '#7d8a5c', 0.0, 0.8)
    P['bark'] = plain('Bark', '#6b5a48', 0.0, 0.95)
    P['egg'] = plain('EggPlaster', '#f2ede2', 0.0, 0.45)
    P['hull'] = plain('HullPaint', '#e9e3d6', 0.0, 0.55)
    P['hullband'] = plain('HullBand', '#2e6f86', 0.0, 0.55)
    P['hullred'] = plain('HullRed', '#a8432c', 0.0, 0.6)
    P['stained'] = plain('StainedGlass', '#6a4a8c', 0.0, 0.2, emit='#d49a52', strength=1.2)
    P['lampglow'] = plain('LampGlow', '#ffd79a', 0.0, 0.4, emit='#ffcc80', strength=3.0)
    P['ridge'] = plain('RidgeRock', '#8c8a86', 0.0, 0.95)
    P['produce'] = plain('Produce', '#a8321f', 0.0, 0.5)
    P['fruitgreen'] = plain('Apples', '#8aa33a', 0.0, 0.5)
    return P


# ----------------------------------------------------------------------------
# bmesh primitive helpers (all return a fresh bmesh in assembly space)
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


def grid_cut(bm, axis, values):
    no = [0, 0, 0]
    no[axis] = 1
    for val in values:
        co = [0, 0, 0]
        co[axis] = val
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    return bm


def dice(bm, maxlen):
    """Cut long parts so the vertex-colour AO has somewhere to live."""
    if not bm.verts:
        return bm
    mn = [min(v.co[i] for v in bm.verts) for i in range(3)]
    mx = [max(v.co[i] for v in bm.verts) for i in range(3)]
    for ax in range(3):
        L = mx[ax] - mn[ax]
        if L > maxlen * 1.05:
            n = int(math.ceil(L / maxlen))
            grid_cut(bm, ax, [mn[ax] + L * i / n for i in range(1, n)])
    return bm


def bm_box(size, center=(0, 0, 0), bevel=0.0, segs=1, smooth=False, axis=None):
    """axis: bevel only the edges parallel to this axis (0, 1, 2) - cheaper."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V(size), verts=bm.verts)
    if bevel > 0:
        edges = list(bm.edges)
        if axis is not None:
            edges = [e for e in edges if abs((e.verts[1].co - e.verts[0].co).normalized()[axis]) > 0.9]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type='OFFSET',
                        segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    move(bm, center)
    set_smooth(bm, smooth)
    return bm


def box(mn, mx, bevel=0.0, segs=1, smooth=False, maxlen=None, axis=None):
    mn, mx = V(mn), V(mx)
    bm = bm_box(mx - mn, (mn + mx) / 2, bevel=bevel, segs=segs, smooth=smooth, axis=axis)
    if maxlen:
        dice(bm, maxlen)
    return bm


def obox(center, size, M3, bevel=0.0, maxlen=None):
    """Box of `size` rotated by the 3x3 matrix M3 about `center`."""
    bm = bm_box(size, (0, 0, 0), bevel=bevel)
    if maxlen:
        dice(bm, maxlen)
    xform(bm, M3.to_4x4())
    move(bm, center)
    return bm


def beam(p0, p1, w, h, up=(0, 0, 1), bevel=0.01, maxlen=1.2):
    """Rectangular beam from p0 to p1 (w across, h along `up`)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    L = d.length
    X = d.normalized()
    Z = V(up) - X * V(up).dot(X)
    if Z.length < 1e-6:
        Z = X.orthogonal()
    Z.normalize()
    Y = Z.cross(X)
    M = Matrix((X, Y, Z)).transposed()
    return obox((p0 + p1) / 2, (L, w, h), M, bevel=bevel, maxlen=maxlen)


def bm_lathe(profile, segs=16, sx=1.0, sy=1.0, cap=True, smooth=True, phase=0.0):
    """Surface of revolution around +Z.  profile: [(r, z), ...] bottom -> top."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(phase + TAU * j / segs) * sx,
                                        r * math.sin(phase + TAU * j / segs) * sy, z)) for j in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(segs):
            j2 = (j + 1) % segs
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
        dz0 = profile[1][1] - profile[0][1]
        dz1 = profile[-1][1] - profile[-2][1]
        if len(rings[0]) > 1 and abs(dz0) > 1e-9:
            bm.faces.new(list(reversed(rings[0])) if dz0 > 0 else rings[0])
        if len(rings[-1]) > 1 and abs(dz1) > 1e-9:
            bm.faces.new(rings[-1] if dz1 > 0 else list(reversed(rings[-1])))
    set_smooth(bm, smooth)
    return bm


def bm_tube(pts, radii, sides=8, closed=False, caps=True, smooth=True):
    """Sweep a circle along a polyline (parallel-transport frames)."""
    pts = [V(p) for p in pts]
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    T = []
    for i in range(n):
        d = (pts[(i + 1) % n] - pts[(i - 1) % n]) if closed else (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        T.append(d.normalized())
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
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        Nn, B = frames[i]
        r = radii[i]
        rings.append([bm.verts.new(p + Nn * (math.cos(TAU * k / sides) * r) + B * (math.sin(TAU * k / sides) * r))
                      for k in range(sides)])
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        for j in range(sides):
            j2 = (j + 1) % sides
            try:
                bm.faces.new([a[j], a[j2], b[j2], b[j]])
            except ValueError:
                pass
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    set_smooth(bm, smooth)
    return bm


def bm_prism(pts2, z0, z1, smooth=False):
    """Extrude a CCW 2D polygon (x, y) from z0 to z1."""
    a = sum(pts2[i][0] * pts2[(i + 1) % len(pts2)][1] - pts2[(i + 1) % len(pts2)][0] * pts2[i][1]
            for i in range(len(pts2)))
    if a < 0:
        pts2 = list(reversed(pts2))
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


def bm_ico(radius=1.0, subdiv=2, center=(0, 0, 0), sc=(1, 1, 1), smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    scale(bm, sc)
    move(bm, center)
    set_smooth(bm, smooth)
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


def bm_skin(verts, edges, radii, levels=1, root=0):
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


def text_mesh(s, size, center, depth=0.02, align='CENTER', face=-1):
    """Blender's built-in font -> mesh, lying in the XZ plane facing -Y (face=-1)."""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = s
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = align
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    ob = bpy.data.objects.new('_txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    # text is in XY facing +Z; stand it up to face -Y (or +Y)
    rot(bm, math.pi / 2, 'X')
    if face > 0:
        rot(bm, math.pi, 'Z')
    move(bm, center)
    set_smooth(bm, False)
    return bm


def bm_volume_centroid(bm):
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
# convex polyhedra (Voronoi chunks for the breakable panel, as in build_props)
# ----------------------------------------------------------------------------
class Convex:
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

    def clip(self, n, d, tag='in', eps=1e-7):
        n = V(n)
        allp = [p for pts, _ in self.faces for p in pts]
        s = [n.dot(p) - d for p in allp]
        if max(s) <= eps:
            return self
        if min(s) >= -eps:
            return None
        new_faces, cut = [], []
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
# UVs in metres
# ----------------------------------------------------------------------------
def box_uv(co, n):
    """Cube projection in metres, oriented so no face is mirrored and V is up
    on every vertical face."""
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if az >= ax and az >= ay:
        return (co.x, co.y) if n.z >= 0 else (co.x, -co.y)
    if ax >= ay:
        return (co.y, co.z) if n.x >= 0 else (-co.y, co.z)
    return (-co.x, co.z) if n.y >= 0 else (co.x, co.z)


def frame_uv(O, U, Vv):
    O, U, Vv = V(O), V(U), V(Vv)
    return lambda co, n: ((co - O).dot(U), (co - O).dot(Vv))


def cyl_uv(center, axis='Z', radius=None):
    c = V(center)

    def f(co, n):
        d = co - c
        if axis == 'Z':
            a, h, r = math.atan2(d.y, d.x), d.z, math.hypot(d.x, d.y)
        elif axis == 'X':
            a, h, r = math.atan2(d.z, d.y), d.x, math.hypot(d.y, d.z)
        else:
            a, h, r = math.atan2(d.x, d.z), d.y, math.hypot(d.x, d.z)
        rr = radius if radius else max(r, 0.05)
        if (axis == 'Z' and abs(n.z) > 0.8) or (axis == 'X' and abs(n.x) > 0.8) or (axis == 'Y' and abs(n.y) > 0.8):
            return box_uv(co, n)
        return (a * rr, h)
    return f


# ----------------------------------------------------------------------------
# mesh builder: parts (bmesh + material + UV + tint) accumulate into one mesh
# ----------------------------------------------------------------------------
class MB:
    def __init__(self):
        self.bm = bmesh.new()
        self.tint = self.bm.loops.layers.float_color.new('Tint')
        self.uvl = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []

    def midx(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, src, mat=None, tint=None, uv=None, mats=None, smooth=None, maxlen=None):
        """Append src (freed).  uv: fn(co, face_normal) -> (u, v) in metres
        (default: cube projection).  tint: rgb or fn(co) -> rgb.  mats: list
        mapping src material_index -> material."""
        if maxlen:
            dice(src, maxlen)
        src.normal_update()
        if DEBUG_TRIS is not None:
            import inspect
            st = inspect.stack()
            who = '/'.join(fr_.function for fr_ in st[1:4])
            for f in src.faces:
                mname = (mats[min(f.material_index, len(mats) - 1)] if mats else mat).name
                DEBUG_TRIS[(mname, who)] = DEBUG_TRIS.get((mname, who), 0) + len(f.verts) - 2
        idxs = [self.midx(m) for m in mats] if mats else None
        idx = None if mats else self.midx(mat)
        uvf = uv or box_uv
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idxs[min(f.material_index, len(idxs) - 1)] if idxs else idx
            nf.smooth = f.smooth if smooth is None else smooth
            fn = f.normal.copy()
            fc = f.calc_center_median() if callable(tint) else None
            for lp, sv in zip(nf.loops, f.verts):
                c = (1.0, 1.0, 1.0) if tint is None else (tint(sv.co, fc) if callable(tint) else tint)
                lp[self.tint] = (c[0], c[1], c[2], 1.0)
                lp[self.uvl].uv = uvf(sv.co, fn)
        for e in src.edges:
            if not e.smooth:
                ne = self.bm.edges.get((vmap[e.verts[0]], vmap[e.verts[1]]))
                if ne:
                    ne.smooth = False
        src.free()
        return self


def mark_sharp(bm, angle_deg):
    th = math.radians(angle_deg)
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2 and lf[0].smooth and lf[1].smooth:
            if lf[0].normal.angle(lf[1].normal, 0.0) > th:
                e.smooth = False


# ----------------------------------------------------------------------------
# gridded slabs with openings: walls, floors, roofs
# ----------------------------------------------------------------------------
def graded(a, b, step=1.3, bands=(0.15, 0.5)):
    """Breakpoints between a and b, dense near both ends (where AO changes)."""
    L = b - a
    if L <= 1e-6:
        return [a, b]
    pts = {a, b}
    for e in bands:
        if L > 2 * e + 0.15:
            pts.add(a + e)
            pts.add(b - e)
    lo, hi = (a + bands[-1], b - bands[-1]) if L > 2 * bands[-1] + 0.15 else (a, b)
    n = max(1, int(math.ceil((hi - lo) / step)))
    for i in range(1, n):
        pts.add(lo + (hi - lo) * i / n)
    return sorted(pts)


class Hole:
    """Rectangular opening a..b along U, lo..hi along V, optional arched head
    ('round', 'seg' with rise, 'pointed') springing at hi."""

    def __init__(self, a, b, lo, hi, arch=None, rise=None):
        self.a, self.b, self.lo, self.hi, self.arch, self.rise = a, b, lo, hi, arch, rise

    def top(self, u):
        if not self.arch:
            return self.hi
        w = self.b - self.a
        c = (self.a + self.b) / 2
        x = min(max(u, self.a), self.b)
        if self.arch == 'round':
            r = w / 2
            return self.hi + math.sqrt(max(0.0, r * r - (x - c) ** 2))
        if self.arch == 'seg':
            r = self.rise
            R = (w * w / 4 + r * r) / (2 * r)
            return self.hi + r - R + math.sqrt(max(0.0, R * R - (x - c) ** 2))
        if self.arch == 'pointed':
            return self.hi + math.sqrt(max(0.0, w * w - (x - (self.b if x < c else self.a)) ** 2))
        return self.hi

    def apex(self):
        return self.top((self.a + self.b) / 2)

    def samples(self, n=8):
        if not self.arch:
            return [self.a, self.b]
        return [self.a + (self.b - self.a) * i / n for i in range(n + 1)]


class Frame:
    def __init__(self, O, U, Vv, T):
        self.O, self.U, self.V, self.T = V(O), V(U), V(Vv), V(T)

    def __call__(self, u, v, t):
        return self.O + self.U * u + self.V * v + self.T * t


def wall_frame(p0, p1):
    """Wall centreline p0 -> p1 (plan); U along it, V up, T to its left (the
    inside of a counter-clockwise footprint).  t < 0 is the exterior face."""
    p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    d = (p1 - p0).normalized()
    return Frame(p0, d, (0, 0, 1), (-d.y, d.x, 0)), (p1 - p0).length


def holey_slab(fr, u0, u1, v0, v1, t0, t1, holes=(), top=None, step=1.3, ends=(True, True),
               vbot=True, vtop=True, faces=('neg', 'pos', 'rev', 'top', 'bot', 'end'), vextra=(),
               bands=(0.15, 0.5)):
    """A slab of thickness t0..t1 over the region u0..u1 x v0..top(u) (top:
    optional polyline [(u, v)...], default v1) with holes.  Faces are gridded
    for vertex AO and tagged by material index:
        0 neg (t0 face)  1 pos (t1 face)  2 rev (hole reveals)
        3 top (upper boundary)  4 bot (lower boundary)  5 end (u0/u1 ends)"""
    CAT = {'neg': 0, 'pos': 1, 'rev': 2, 'top': 3, 'bot': 4, 'end': 5}
    bm = bmesh.new()
    cache = {}

    def vert(u, v, t):
        k = (round(u, 4), round(v, 4), round(t, 4))
        if k not in cache:
            cache[k] = bm.verts.new(fr(u, v, t))
        return cache[k]

    def face(pts, want, cat):
        if cat not in faces:
            return
        vs = []
        for p in pts:
            vv = vert(*p)
            if not vs or vv is not vs[-1]:
                vs.append(vv)
        while len(vs) > 1 and vs[0] is vs[-1]:
            vs.pop()
        if len(vs) < 3 or len(set(vs)) < len(vs):
            return
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
        f.material_index = CAT[cat]
        f.smooth = False

    def vtop_at(u):
        if not top:
            return v1
        for (ua, va), (ub, vb) in zip(top, top[1:]):
            if ua - 1e-9 <= u <= ub + 1e-9:
                return va if ub == ua else va + (vb - va) * (u - ua) / (ub - ua)
        return top[0][1] if u < top[0][0] else top[-1][1]

    crit = {u0, u1}
    for h in holes:
        crit.update(h.samples())
    if top:
        crit.update(p[0] for p in top)
    us = sorted(crit)
    for g in graded(u0, u1, step, bands):
        if all(abs(g - c) > 0.12 for c in us):
            us.append(g)
    us = sorted(u for u in us if u0 - 1e-9 <= u <= u1 + 1e-9)
    vmax = max(vtop_at(u) for u in us)
    base_grid = set(graded(v0, vmax, step, bands)) | {v0} | {v for v in vextra if v0 < v < vmax}
    vs_grid = sorted(base_grid)

    def local_grid(ua, ub):
        """Row breakpoints for a column: the AO grid plus the sill/head lines of
        openings this column touches (keeps hole corners watertight)."""
        g = set(base_grid)
        for h in holes:
            if h.a - 1e-6 <= ub and ua <= h.b + 1e-6:
                g.update((h.lo, h.hi))
        return sorted(g)
    Tn = fr.T
    for ua, ub in zip(us, us[1:]):
        um = (ua + ub) / 2
        ivs = [[v0, v0, vtop_at(ua), vtop_at(ub)]]
        for h in holes:
            if h.a - 1e-6 <= um <= h.b + 1e-6:
                new = []
                for lo_a, lo_b, hi_a, hi_b in ivs:
                    if h.lo > max(lo_a, lo_b) + 1e-6:
                        new.append([lo_a, lo_b, min(h.lo, hi_a), min(h.lo, hi_b)])
                    ta, tb = h.top(ua), h.top(ub)
                    if max(ta, tb) < min(hi_a, hi_b) - 1e-6:
                        new.append([ta, tb, hi_a, hi_b])
                ivs = new
        cg = local_grid(ua, ub)
        for lo_a, lo_b, hi_a, hi_b in ivs:
            inner = [z for z in cg if max(lo_a, lo_b) + 0.03 < z < min(hi_a, hi_b) - 0.03]
            A = [lo_a] + inner + [hi_a]
            B = [lo_b] + inner + [hi_b]
            for i in range(len(A) - 1):
                q = [(ua, A[i]), (ub, B[i]), (ub, B[i + 1]), (ua, A[i + 1])]
                face([(u, v, t0) for u, v in q], -Tn, 'neg')
                face([(u, v, t1) for u, v in q], Tn, 'pos')
        # upper boundary strip
        if vtop:
            ta, tb = vtop_at(ua), vtop_at(ub)
            face([(ua, ta, t0), (ub, tb, t0), (ub, tb, t1), (ua, ta, t1)], fr.V, 'top')
        if vbot:
            face([(ua, v0, t0), (ub, v0, t0), (ub, v0, t1), (ua, v0, t1)], -fr.V, 'bot')
    # hole reveals
    for h in holes:
        hg = local_grid(h.a, h.b)
        for side, u, want in ((0, h.a, fr.U), (1, h.b, -fr.U)):
            zs = [h.lo] + [z for z in hg if h.lo + 0.03 < z < h.hi - 0.03] + [h.hi]
            for za, zb in zip(zs, zs[1:]):
                face([(u, za, t0), (u, zb, t0), (u, zb, t1), (u, za, t1)], want, 'rev')
        hu = [u for u in us if h.a - 1e-9 <= u <= h.b + 1e-9]
        for ua, ub in zip(hu, hu[1:]):
            if h.lo > v0 + 1e-6:
                face([(ua, h.lo, t0), (ub, h.lo, t0), (ub, h.lo, t1), (ua, h.lo, t1)], fr.V, 'rev')
            ta, tb = h.top(ua), h.top(ub)
            face([(ua, ta, t0), (ub, tb, t0), (ub, tb, t1), (ua, ta, t1)], -fr.V, 'rev')
    # ends
    for flag, u, want in ((ends[0], u0, -fr.U), (ends[1], u1, fr.U)):
        if not flag:
            continue
        eg = local_grid(u - 1e-3, u + 1e-3)
        zs = [v0] + [z for z in eg if v0 + 0.03 < z < vtop_at(u) - 0.03] + [vtop_at(u)]
        for za, zb in zip(zs, zs[1:]):
            face([(u, za, t0), (u, zb, t0), (u, zb, t1), (u, za, t1)], want, 'end')
    return bm


def slab_boxes(u0, u1, v0, v1, holes, top=None, slices=4):
    """Collider rectangles (u0, u1, v0, v1) covering a holey slab: piers between
    holes, pieces above/below holes (arched heads stepped), stepped gables."""
    def vtop_at(u):
        if not top:
            return v1
        for (ua, va), (ub, vb) in zip(top, top[1:]):
            if ua - 1e-9 <= u <= ub + 1e-9:
                return va if ub == ua else va + (vb - va) * (u - ua) / (ub - ua)
        return top[0][1] if u < top[0][0] else top[-1][1]

    def vmin_on(a, b):
        pts = [a, b] + ([p[0] for p in top if a < p[0] < b] if top else [])
        return min(vtop_at(p) for p in pts)

    rects = []
    hs = sorted(holes, key=lambda h: h.a)
    cur = u0
    for h in hs:
        if h.a > cur + 1e-4:
            rects.append((cur, h.a, v0, vmin_on(cur, h.a)))
        vt = vmin_on(h.a, h.b)
        if h.lo > v0 + 1e-4:
            rects.append((h.a, h.b, v0, h.lo))
        if h.arch:
            n = 3
            c = (h.a + h.b) / 2
            edges = [h.a + (c - h.a) * i / n for i in range(n + 1)]
            for ea, eb in zip(edges, edges[1:]):
                bot = h.top(eb)
                if bot < vt - 1e-3:
                    rects.append((ea, eb, bot, vt))
            edges = [c + (h.b - c) * i / n for i in range(n + 1)]
            for ea, eb in zip(edges, edges[1:]):
                bot = h.top(ea)
                if bot < vt - 1e-3:
                    rects.append((ea, eb, bot, vt))
        elif h.hi < vt - 1e-4:
            rects.append((h.a, h.b, h.hi, vt))
        cur = max(cur, h.b)
    if u1 > cur + 1e-4:
        rects.append((cur, u1, v0, vmin_on(cur, u1)))
    if top:
        base = min(vtop_at(p[0]) for p in top)
        peak = max(p[1] for p in top)
        if peak > base + 0.2:
            for i in range(slices):
                za = base + (peak - base) * i / slices
                zb = base + (peak - base) * (i + 1) / slices
                inside = []
                N = 60
                for k in range(N + 1):
                    u = u0 + (u1 - u0) * k / N
                    inside.append(vtop_at(u) >= zb - 1e-6)
                k = 0
                while k <= N:
                    if inside[k]:
                        s = k
                        while k + 1 <= N and inside[k + 1]:
                            k += 1
                        ua, ub = u0 + (u1 - u0) * s / N, u0 + (u1 - u0) * k / N
                        if ub - ua > 0.05:
                            rects.append((ua, ub, za, zb))
                    k += 1
    return rects


# ----------------------------------------------------------------------------
# assets: root mesh + child meshes + colliders + slots, AO baked to COLOR_0
# ----------------------------------------------------------------------------
COLL = None
SLOT_N = {}
DADO_OCHRE = (0.9, 0.72, 0.52)     # painted dado bands (vertex tint on the plaster)
DADO_BLUE = (0.7, 0.8, 0.86)
DADO_OXBLOOD = (0.78, 0.55, 0.47)
AO_SAMPLES = 96
AO_FLOOR = 0.1            # darkest a fully enclosed corner gets
GRIME = (0.8, 0.72, 0.6)  # ground grime multiplier (exterior faces near z = 0)


def frame_matrix(fr):
    M = Matrix((fr.U, fr.V, fr.T)).transposed().to_4x4()
    M.translation = fr.O
    return M


class Asset:
    def __init__(self, name, P, budget=30000, kind='building'):
        self.name, self.P, self.budget, self.kind = name, P, budget, kind
        self.parts = {'': MB()}
        self.pivots = {}
        self.cols = []
        self.slots = []
        self.lean = None
        self.ao_dist = 5.0
        self.ground = True
        self.grime = True
        self.root_empty = False
        self.bake = True

    def mb(self, key=''):
        if key not in self.parts:
            self.parts[key] = MB()
        return self.parts[key]

    def add(self, bm, mat, key='', **kw):
        self.mb(key).add(bm, mat, **kw)
        return self

    # -- colliders --------------------------------------------------------
    def col(self, mn, mx):
        mn, mx = V(mn), V(mx)
        self.cols.append(('box', (mn + mx) / 2, mx - mn, Matrix.Identity(3)))

    def col_obox(self, center, size, M3):
        self.cols.append(('box', V(center), V(size), M3.copy()))

    def col_frame(self, fr, u0, u1, v0, v1, t0, t1):
        """Collider for a box given in a wall/slab frame."""
        c = fr((u0 + u1) / 2, (v0 + v1) / 2, (t0 + t1) / 2)
        M3 = Matrix((fr.U, fr.V, fr.T)).transposed()
        self.col_obox(c, (abs(u1 - u0), abs(v1 - v0), abs(t1 - t0)), M3)

    def ramp(self, p_lo, p_hi, width, thick=0.3, ext=0.05):
        """Sloped box whose top surface runs from p_lo to p_hi (centre line)."""
        p_lo, p_hi = V(p_lo), V(p_hi)
        d = p_hi - p_lo
        X = d.normalized()
        Z = V((0, 0, 1)) - X * X.z
        Z.normalize()
        Y = Z.cross(X)
        M3 = Matrix((X, Y, Z)).transposed()
        c = (p_lo + p_hi) / 2 - Z * (thick / 2)
        self.col_obox(c, (d.length + 2 * ext, width, thick), M3)

    def col_tri(self, bm):
        self.cols.append(('tri', bm))

    # -- slots ------------------------------------------------------------
    def slot(self, kind, pos, rz=0.0):
        self.slots.append((kind, V(pos), rz))

    # -- output -----------------------------------------------------------
    def finalize(self):
        t0 = time.time()
        L = self.lean
        vis = []
        root = None
        for key in [''] + [k for k in self.parts if k]:
            mb = self.parts[key]
            bm = mb.bm
            loose = [v for v in bm.verts if not v.link_faces]
            if loose:
                bmesh.ops.delete(bm, geom=loose, context='VERTS')
            if L is not None:
                xform(bm, L)
            pivot = V(self.pivots.get(key, (0, 0, 0)))
            if L is not None and key:
                pivot = L @ pivot
            if key:
                bmesh.ops.translate(bm, vec=-pivot, verts=bm.verts)
            bm.normal_update()
            mark_sharp(bm, 50.0)
            name = self.name if not key else (key[1:] if key.startswith('=') else self.name + '_' + key)
            if not key and self.root_empty:
                bm.free()
                root = bpy.data.objects.new(name, None)
                root.empty_display_type = 'PLAIN_AXES'
                COLL.objects.link(root)
                continue
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for m in mb.mats:
                me.materials.append(m)
            ob = bpy.data.objects.new(name, me)
            COLL.objects.link(ob)
            if key:
                ob.parent = root
                ob.location = pivot
            else:
                root = ob
            vis.append(ob)
        for i, c in enumerate(self.cols):
            if c[0] == 'box':
                _, center, size, M3 = c
                if L is not None:
                    center = L @ center
                    M3 = L.to_3x3() @ M3
                col_box_object('%s_COL_%d' % (self.name, i), root, center, size, M3)
            else:
                bm = c[1]
                if L is not None:
                    xform(bm, L)
                col_tri_object('%s_COL_TRI_%d' % (self.name, i), root, bm)
        for kind, pos, rz in self.slots:
            SLOT_N[kind] = SLOT_N.get(kind, 0) + 1
            e = bpy.data.objects.new('SLOT_%s_%d' % (kind, SLOT_N[kind]), None)
            e.empty_display_type = 'ARROWS'
            e.empty_display_size = 0.3
            COLL.objects.link(e)
            e.parent = root
            M = Matrix.Translation(pos) @ Matrix.Rotation(rz, 4, 'Z')
            if L is not None:
                M = L @ M
            e.matrix_world = M
        bake_ao(self, vis)
        tris = sum(len(p.vertices) - 2 for o in vis for p in o.data.polygons)
        ncol = len(self.cols)
        print('built %-20s %6d tris  %3d colliders  %2d slots  %.1fs' % (
            self.name, tris, ncol, len(self.slots), time.time() - t0))
        if tris > self.budget:
            print('   WARNING %s over budget (%d > %d)' % (self.name, tris, self.budget))
        return root


def col_box_object(name, parent, center, size, M3):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    _white_col(me)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    ob.parent = parent
    M = M3.to_4x4()
    M.translation = V(center)
    ob.matrix_world = M
    ob.hide_render = True
    ob.display_type = 'WIRE'
    return ob


def col_tri_object(name, parent, bm):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    _white_col(me)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    ob.parent = parent
    ob.hide_render = True
    ob.display_type = 'WIRE'
    return ob


def _white_col(me):
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    buf = np.ones(len(me.loops) * 4, np.float32)
    ca.data.foreach_set('color', buf)
    me.color_attributes.active_color = ca


AO_GROUND = None


def weld_corner_colors(me, cols):
    """Average the baked per-corner colours of loops that share a vertex, a
    normal, a UV and a material, so the glTF exporter can weld them (coplanar
    grid faces would otherwise export four vertices per grid point)."""
    n = len(me.loops)
    if n == 0:
        return cols
    vi = np.empty(n, np.int64)
    me.loops.foreach_get('vertex_index', vi)
    cn = np.empty(n * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    npoly = len(me.polygons)
    tot = np.empty(npoly, np.int64)
    me.polygons.foreach_get('loop_total', tot)
    pm = np.empty(npoly, np.int64)
    me.polygons.foreach_get('material_index', pm)
    lm = np.repeat(pm, tot)
    keys = [vi[:, None], np.round(cn.reshape(-1, 3) * 400).astype(np.int64), lm[:, None]]
    if me.uv_layers:
        uv = np.empty(n * 2, np.float32)
        me.uv_layers[0].data.foreach_get('uv', uv)
        keys.append(np.round(uv.reshape(-1, 2) * 4000).astype(np.int64))
    key = np.concatenate(keys, axis=1)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    sums = np.zeros((inv.max() + 1, 4), np.float64)
    np.add.at(sums, inv, cols)
    cnt = np.bincount(inv).astype(np.float64)
    return (sums[inv] / cnt[inv, None]).astype(np.float32)


def bake_ao(asset, objs):
    """Two Cycles AO bakes to vertex colours: a long one (interiors read dark)
    and a short one against a ground plane (contact shadow at the sand)."""
    global AO_GROUND
    sc = bpy.context.scene
    if AO_GROUND is None:
        me = bpy.data.meshes.new('_AOGround')
        s = 400
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        AO_GROUND = bpy.data.objects.new('_AOGround', me)
        sc.collection.objects.link(AO_GROUND)
    objs = [o for o in objs if len(o.data.polygons)]
    for o in objs:
        me = o.data
        if 'Col' not in me.color_attributes:
            me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes['Col']
    if not objs:
        return
    hidden = []
    for o in sc.objects:
        if o in objs or o is AO_GROUND:
            continue
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    res = {}
    for tag, dist, ground in (('A', asset.ao_dist, False), ('B', 1.2, asset.ground)):
        if not asset.bake:
            for o in objs:
                res[(tag, o.name)] = np.ones(len(o.data.loops), np.float32)
            continue
        sc.world.light_settings.distance = dist
        AO_GROUND.hide_render = not ground
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        for o in objs:
            buf = np.empty(len(o.data.loops) * 4, np.float32)
            o.data.color_attributes['Col'].data.foreach_get('color', buf)
            res[(tag, o.name)] = buf.reshape(-1, 4)[:, 0].copy()
    AO_GROUND.hide_render = True
    for o in hidden:
        o.hide_render = False
    for o in objs:
        me = o.data
        a, b = res[('A', o.name)], res[('B', o.name)]
        ao = a * (0.4 + 0.6 * b)
        val = AO_FLOOR + (1.0 - AO_FLOOR) * np.power(np.clip(ao, 0, 1), 0.85)
        n = len(me.loops)
        tint = np.ones(n * 4, np.float32)
        if 'Tint' in me.color_attributes:
            me.color_attributes['Tint'].data.foreach_get('color', tint)
        tint = tint.reshape(-1, 4)[:, :3]
        vi = np.empty(n, np.int64)
        me.loops.foreach_get('vertex_index', vi)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        z = co.reshape(-1, 3)[vi, 2] + o.matrix_world.translation.z
        col = tint * val[:, None]
        if asset.grime:
            ext = np.clip((a - 0.45) / 0.3, 0, 1)
            g = (1.0 - np.clip(z / 1.4, 0, 1)) ** 1.5 * ext
            col = col * (1.0 - 0.55 * g[:, None] * (1.0 - np.array(GRIME)[None, :]))
        # the game's curve (was applied by pack_glb.py to COLOR_1): deep corners
        # stay dark, open walls stay clean
        col = 0.22 + 0.78 * np.power(np.clip(col, 0, 1), 0.65)
        out = np.ones((n, 4), np.float32)
        out[:, :3] = np.clip(col, 0, 1)
        out = weld_corner_colors(me, out)
        me.color_attributes['Col'].data.foreach_set('color', out.ravel())
        if 'Tint' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['Tint'])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    for o in objs:
        o.select_set(False)


# ----------------------------------------------------------------------------
# architectural elements
# ----------------------------------------------------------------------------
def lbox(fr, u0, u1, v0, v1, t0, t1, bevel=0.0, maxlen=None, axis=None):
    """Box given in a frame's (u, v, t) coordinates (axis: 0 u, 1 v, 2 t)."""
    bm = box((min(u0, u1), min(v0, v1), min(t0, t1)), (max(u0, u1), max(v0, v1), max(t0, t1)),
             bevel=bevel, maxlen=maxlen, axis=axis)
    xform(bm, frame_matrix(fr))
    return bm


def lmap(fr, bm):
    xform(bm, frame_matrix(fr))
    return bm


class Wall:
    """A straight wall from p0 to p1 (centre line, plan).  Openings are given
    along the wall in metres from p0.  t < 0 is the exterior (right-hand) side."""

    def __init__(self, A, p0, p1, top, openings=(), T=T_WALL, zb=ZB, ext=None, inn=None,
                 ends=(True, True), gable=None, collide=True, step=1.3, rev=None, topmat=None, dado=None,
                 both=False, bands=(0.15, 0.5)):
        self.A, self.T, self.zb = A, T, zb
        self.fr, self.L = wall_frame(p0, p1)
        self.top = top
        self.holes = []
        self.ops = []
        P = A.P
        ext = ext or P['stucco']
        inn = inn or P['plaster']
        for o in openings:
            h = Hole(o['u'] - o['w'] / 2, o['u'] + o['w'] / 2, o['z0'], o['z1'], o.get('arch'), o.get('rise'))
            self.holes.append(h)
            self.ops.append((h, o))
        gtop = None
        if gable:
            gtop = gable
        dz = []
        tintf = None
        if dado:
            # painted dado band(s) on the interior face: [(z_top, rgb), ...] per storey
            dbands = dado if isinstance(dado[0], (list, tuple)) else [dado]
            dz = [b[0] for b in dbands]
            O, Tn = self.fr.O, self.fr.T

            def tintf(co, fc, dbands=dbands, O=O, Tn=Tn, T=T, both=both):
                t = (fc - O).dot(Tn)
                if t > T / 2 - 0.02 or (both and t < -T / 2 + 0.02):
                    for (zt, rgb, zlo) in [(b[0], b[1], b[2] if len(b) > 2 else -9) for b in dbands]:
                        if zlo < fc.z < zt:
                            return rgb
                return (1.0, 1.0, 1.0)
        bm = holey_slab(self.fr, 0.0, self.L, zb, top, -T / 2, T / 2, self.holes, top=gtop, ends=ends,
                        vbot=False, step=step, vextra=dz, bands=bands)
        A.add(bm, None, mats=[ext, inn, rev or ext, topmat or ext, ext, ext], tint=tintf)
        if collide:
            for (u0, u1, v0, v1) in slab_boxes(0.0, self.L, zb, top, self.holes, top=gtop):
                A.col_frame(self.fr, u0, u1, v0, v1, -T / 2, T / 2)

    def at(self, u, v, t):
        return self.fr(u, v, t)


def hexa(pts):
    """Hexahedron from 8 points: bottom quad (0-3, CCW from below... any order
    consistent with the top quad 4-7).  Faces are oriented outward."""
    bm = bmesh.new()
    vs = [bm.verts.new(V(p)) for p in pts]
    c = sum((V(p) for p in pts), V((0, 0, 0))) / 8
    quads = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for q in quads:
        try:
            f = bm.faces.new([vs[i] for i in q])
        except ValueError:
            continue
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - c) < 0:
            f.normal_flip()
    set_smooth(bm, False)
    return bm


def arch_curve(h, d, n=11):
    """(inner, outer) (u, v) pairs along an arched head, outer offset by d."""
    w = h.b - h.a
    c = (h.a + h.b) / 2
    out = []
    if h.arch == 'round':
        r = w / 2
        for i in range(n + 1):
            th = math.pi * (1 - i / n)
            out.append(((c + r * math.cos(th), h.hi + r * math.sin(th)),
                        (c + (r + d) * math.cos(th), h.hi + (r + d) * math.sin(th))))
    elif h.arch == 'seg':
        r = h.rise
        R = (w * w / 4 + r * r) / (2 * r)
        cz = h.hi + r - R
        th0 = math.acos(clamp((w / 2) / R, -1, 1))
        for i in range(n + 1):
            th = (math.pi - th0) + (2 * th0 - math.pi) * i / n
            out.append(((c + R * math.cos(th), cz + R * math.sin(th)),
                        (c + (R + d) * math.cos(th), cz + (R + d) * math.sin(th))))
    else:   # pointed: two arcs of radius w
        half = n // 2
        for i in range(half + 1):
            th = math.pi - (math.pi / 3) * i / half
            out.append(((h.b + w * math.cos(th), h.hi + w * math.sin(th)),
                        (h.b + (w + d) * math.cos(th), h.hi + (w + d) * math.sin(th))))
        for i in range(1, half + 1):
            th = (math.pi / 3) * (1 - i / half)
            out.append(((h.a + w * math.cos(th), h.hi + w * math.sin(th)),
                        (h.a + (w + d) * math.cos(th), h.hi + (w + d) * math.sin(th))))
    return out


def arch_ring(A, fr, h, d, t0, t1, mat, gap=0.012, key=''):
    """Voussoirs around an arched opening (in the frame's u/v, t0..t1 deep)."""
    pts = arch_curve(h, d, 7 if (h.b - h.a) < 1.5 else 11)
    n = len(pts) - 1
    for i in range(n):
        (ia, oa), (ib, ob) = pts[i], pts[i + 1]
        # shrink each stone a little along the curve so the joints show
        def sh(p, q, k):
            return (p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)
        ia2, ib2 = sh(ia, ib, gap / max(1e-3, math.dist(ia, ib))), sh(ib, ia, gap / max(1e-3, math.dist(ia, ib)))
        oa2, ob2 = sh(oa, ob, gap / max(1e-3, math.dist(oa, ob))), sh(ob, oa, gap / max(1e-3, math.dist(oa, ob)))
        ext = 0.06 if i == n // 2 else 0.0          # keystone
        if ext:
            mid_o = ((oa2[0] + ob2[0]) / 2, (oa2[1] + ob2[1]) / 2)
            dirv = V((mid_o[0] - (ia2[0] + ib2[0]) / 2, mid_o[1] - (ia2[1] + ib2[1]) / 2, 0)).normalized()
            oa2 = (oa2[0] + dirv.x * ext, oa2[1] + dirv.y * ext)
            ob2 = (ob2[0] + dirv.x * ext, ob2[1] + dirv.y * ext)
        q = [ia2, ib2, ob2, oa2]
        te = t0 - (0.015 if ext else 0.0)
        pts8 = [fr(u, v, te) for (u, v) in q] + [fr(u, v, t1) for (u, v) in q]
        A.add(hexa(pts8), mat, key=key)


def dress_window(A, w, h, o):
    P = A.P
    fr, T = w.fr, w.T
    t0, t1 = -T / 2, T / 2
    stone = P[o.get('stone', 'sandstone')]
    wood = P['wood']
    width = h.b - h.a
    if o.get('sill', True):
        A.add(lbox(fr, h.a - 0.09, h.b + 0.09, h.lo - 0.07, h.lo + 0.012, t0 - 0.06, t0 + 0.16, bevel=0.014, axis=0),
              stone)
    s = o.get('surround', 'stone')
    if s == 'stone':
        for ua, ub in ((h.a - 0.16, h.a), (h.b, h.b + 0.16)):
            A.add(lbox(fr, ua, ub, h.lo, h.hi, t0 - 0.03, t0 + 0.02, bevel=0.012, axis=1), stone)
        if h.arch:
            arch_ring(A, fr, h, 0.2, t0 - 0.03, t0 + 0.02, stone)
        else:
            A.add(lbox(fr, h.a - 0.2, h.b + 0.2, h.hi, h.hi + 0.22, t0 - 0.035, t0 + 0.02, bevel=0.012, axis=0), stone)
    elif s == 'paint':
        pm = P[o.get('paint', 'paintochre')]
        top = h.apex() if h.arch else h.hi
        for ua, ub in ((h.a - 0.13, h.a), (h.b, h.b + 0.13)):
            A.add(lbox(fr, ua, ub, h.lo - 0.02, top, t0 - 0.006, t0 + 0.01), pm)
        if not h.arch:
            A.add(lbox(fr, h.a - 0.13, h.b + 0.13, h.hi, h.hi + 0.13, t0 - 0.006, t0 + 0.01), pm)
        else:
            arch_ring(A, fr, h, 0.13, t0 - 0.006, t0 + 0.01, pm, gap=0.0)
    if o.get('shutters', True):
        top = h.hi
        lw = width / 2
        off = 0.17 if s == 'stone' else 0.14
        for side in (-1, 1):
            if side < 0:
                ua, ub = h.a - off - lw, h.a - off
            else:
                ua, ub = h.b + off, h.b + off + lw
            A.add(lbox(fr, ua, ub, h.lo + 0.02, top - 0.02, t0 - 0.075, t0 - 0.035, bevel=0.008), wood)
            for vz in (h.lo + 0.25, top - 0.25):
                A.add(lbox(fr, ua + 0.03, ub - 0.03, vz - 0.06, vz + 0.06, t0 - 0.09, t0 - 0.075), wood)
                hu = (ub - 0.02, ub + 0.08) if side < 0 else (ua - 0.08, ua + 0.02)
                A.add(lbox(fr, hu[0], hu[1], vz - 0.02, vz + 0.02, t0 - 0.095, t0 - 0.03), P['iron'])
    blocked = False
    if o.get('grille'):
        blocked = True
        n = max(3, int(round(width / 0.13)))
        top = h.hi if not h.arch else h.hi
        for k in range(1, n):
            u = h.a + width * k / n
            A.add(lbox(fr, u - 0.011, u + 0.011, h.lo, top, t0 + 0.06, t0 + 0.082), P['iron'])
        for vz in (h.lo + 0.12, (h.lo + top) / 2, top - 0.12):
            A.add(lbox(fr, h.a, h.b, vz - 0.012, vz + 0.012, t0 + 0.05, t0 + 0.092), P['iron'])
    g = o.get('glass', 'clear')
    if g:
        blocked = True
        tg = t0 + T * 0.62
        top = h.apex() if h.arch else h.hi
        gm = P['glass'] if g == 'clear' else P['glassdark']
        if h.arch:
            # glass follows the arch in strips
            us = h.samples(4)
            for ua, ub in zip(us, us[1:]):
                A.add(lbox(fr, ua, ub, h.lo + 0.03, min(h.top(ua), h.top(ub)) - 0.02, tg - 0.005, tg + 0.005), gm)
        else:
            A.add(lbox(fr, h.a + 0.03, h.b - 0.03, h.lo + 0.03, top - 0.03, tg - 0.005, tg + 0.005), gm)
        sash = o.get('sash', 'paintblue')
        if sash:
            fm = P[sash] if sash in P else P['paintblue']
            ftop = h.hi
            for ua, ub in ((h.a, h.a + 0.06), (h.b - 0.06, h.b), ((h.a + h.b) / 2 - 0.025, (h.a + h.b) / 2 + 0.025)):
                A.add(lbox(fr, ua, ub, h.lo, ftop, tg - 0.03, tg + 0.03), fm)
            for vz in (h.lo + 0.03, ftop - 0.03, (h.lo + ftop) / 2):
                A.add(lbox(fr, h.a, h.b, vz - 0.025, vz + 0.025, tg - 0.03, tg + 0.03), fm)
    if blocked and o.get('block', True):
        top = h.apex() if h.arch else h.hi
        A.col_frame(fr, h.a, h.b, h.lo, top, t0 + 0.04, t1 - 0.04)


def door_leaf(A, fr, u0, u1, v0, v1, t, glazed=False):
    """A planked leaf lying flat against the wall plane at t (> 0: interior side)."""
    P = A.P
    s = 1 if t >= 0 else -1
    A.add(lbox(fr, u0, u1, v0, v1, t, t + s * 0.05, bevel=0.008, maxlen=1.0), P['wood'])
    for vz in (v0 + 0.3, (v0 + v1) / 2, v1 - 0.3):
        A.add(lbox(fr, u0 + 0.04, u1 - 0.04, vz - 0.07, vz + 0.07, t + s * 0.05, t + s * 0.075), P['wood'])
        A.add(lbox(fr, u0 + 0.02, u0 + 0.35, vz - 0.022, vz + 0.022, t + s * 0.075, t + s * 0.085), P['iron'])
    if glazed:
        A.add(lbox(fr, u0 + 0.12, u1 - 0.12, (v0 + v1) / 2 + 0.1, v1 - 0.15, t + s * 0.052, t + s * 0.056), P['glassdark'])


def dress_door(A, w, h, o):
    P = A.P
    fr, T = w.fr, w.T
    t0, t1 = -T / 2, T / 2
    stone = P[o.get('stone', 'sandstone')]
    width = h.b - h.a
    ext = o.get('exterior', True)
    s = o.get('surround', 'stone')
    if s == 'stone':
        for ua, ub in ((h.a - 0.2, h.a), (h.b, h.b + 0.2)):
            A.add(lbox(fr, ua, ub, h.lo - 0.02, h.hi, t0 - 0.04, t0 + 0.02, bevel=0.012, maxlen=1.0), stone)
        if h.arch:
            arch_ring(A, fr, h, 0.28, t0 - 0.04, t0 + 0.02, stone)
        else:
            A.add(lbox(fr, h.a - 0.26, h.b + 0.26, h.hi, h.hi + 0.28, t0 - 0.05, t0 + 0.02, bevel=0.015), stone)
    elif s == 'oak':
        for tt in ((t0 - 0.03, t0 + 0.0), (t1, t1 + 0.03)):
            for ua, ub in ((h.a - 0.12, h.a), (h.b, h.b + 0.12)):
                A.add(lbox(fr, ua, ub, h.lo, h.hi + (0.0 if h.arch else 0.12), tt[0], tt[1], bevel=0.006,
                           maxlen=1.0), P['oak'])
            if not h.arch:
                A.add(lbox(fr, h.a - 0.12, h.b + 0.12, h.hi, h.hi + 0.12, tt[0], tt[1], bevel=0.006), P['oak'])
    if ext:
        # worn threshold stone and a lower step, plus the ~20 degree ramp collider
        A.add(lbox(fr, h.a - 0.08, h.b + 0.08, -0.25, h.lo + 0.015, t0 - 0.36, t0 + 0.12, bevel=0.03), stone)
        A.add(lbox(fr, h.a - 0.02, h.b + 0.02, -0.3, 0.14, t0 - 0.78, t0 - 0.3, bevel=0.035), stone)
        c = (h.a + h.b) / 2
        A.ramp(fr(c, -0.1, t0 - 1.1), fr(c, h.lo, t0 + 0.02), width)
    leaves = o.get('leaves', 1)
    if leaves:
        lw = width / leaves
        tl = t1 if o.get('inward', True) else t0 - 0.0
        tside = 1 if o.get('inward', True) else -1
        top = h.hi - 0.02
        glz = o.get('glazed', False)
        if leaves == 1:
            door_leaf(A, fr, h.a - lw - 0.02, h.a - 0.02, h.lo + 0.02, top, tl * 1.0 + 0.001 * tside, glz)
        else:
            door_leaf(A, fr, h.a - lw - 0.02, h.a - 0.02, h.lo + 0.02, top, tl + 0.001 * tside, glz)
            door_leaf(A, fr, h.b + 0.02, h.b + lw + 0.02, h.lo + 0.02, top, tl + 0.001 * tside, glz)


def dress(A, w):
    for h, o in w.ops:
        k = o.get('kind', 'window')
        if k == 'window':
            dress_window(A, w, h, o)
        elif k == 'door':
            dress_door(A, w, h, o)
        elif k == 'panel':
            # a doorway-sized gap for the breakable panel: slot at bottom centre
            c = w.fr((h.a + h.b) / 2, h.lo, 0.0)
            ang = math.atan2(w.fr.U.y, w.fr.U.x)
            A.slot('panel', c, ang)
        elif k == 'arch':
            if o.get('ring', True):
                arch_ring(A, w.fr, h, o.get('ring_d', 0.3), -w.T / 2 - 0.03, w.T / 2 + 0.03,
                          A.P[o.get('stone', 'sandstone')])


def quoins(A, x, y, sx, sy, z0, z1, mat, h=0.52, proud=0.03, long_=0.62, short=0.32, bevel=0.022):
    if z1 - z0 > 10.0:
        h = 0.72
    """Alternating long/short stone blocks wrapping an exterior corner (x, y)."""
    z = z0
    k = 0
    while z + h * 0.6 < z1:
        hh = min(h, z1 - z)
        lx, ly = (long_, short) if k % 2 == 0 else (short, long_)
        mn = (min(x - sx * lx, x + sx * proud), min(y - sy * ly, y + sy * proud), z + 0.012)
        mx = (max(x - sx * lx, x + sx * proud), max(y - sy * ly, y + sy * proud), z + hh - 0.012)
        A.add(box(mn, mx, bevel=bevel, axis=2), mat)
        z += hh
        k += 1


def profile_run(fr, prof, u0, u1, maxlen=1.3):
    """Extrude a (t, v) profile polygon along U from u0 to u1."""
    bm = bm_prism([(t, v) for (t, v) in prof], u0, u1)
    dice(bm, maxlen)
    M = Matrix((fr.T, fr.V, fr.U)).transposed().to_4x4()
    M.translation = fr.O
    xform(bm, M)
    return bm


def rect_loop_profile(x0, x1, y0, y1, prof, segs=1.3):
    """Sweep an (out, z) profile around a rectangle (mitred corners).  prof is
    ordered bottom -> top on the outside."""
    bm = bmesh.new()
    rings = []
    for (o, z) in prof:
        corners = [(x0 - o, y0 - o), (x1 + o, y0 - o), (x1 + o, y1 + o), (x0 - o, y1 + o)]
        base = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        ring = []
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            L = math.dist(base[i], base[(i + 1) % 4])
            n = max(1, int(math.ceil(L / segs)))
            for k in range(n):
                ring.append(bm.verts.new((lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), z)))
        rings.append(ring)
    m = len(rings[0])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(m):
            j2 = (j + 1) % m
            try:
                bm.faces.new([r0[j], r0[j2], r1[j2], r1[j]])
            except ValueError:
                pass
    bm.normal_update()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(V((c.x - cx, c.y - cy, 0))) < 0:
            f.normal_flip()
    set_smooth(bm, False)
    return bm


CORNICE = [(0.0, -0.02), (0.05, 0.0), (0.05, 0.05), (0.09, 0.08), (0.12, 0.14), (0.16, 0.16), (0.16, 0.22),
           (0.0, 0.22)]


def cornice(A, x0, x1, y0, y1, z, mat=None, prof=CORNICE):
    A.add(rect_loop_profile(x0, x1, y0, y1, [(o, z + dz) for (o, dz) in prof]), mat or A.P['stucco'])


def plinth(A, x0, x1, y0, y1, gaps=(), z1=0.62, depth=0.06, mat=None):
    """Stone plinth band proud of the exterior faces, broken at door gaps.
    gaps: [(side, a, b)] with side in 'front','back','left','right' (world coords)."""
    mat = mat or A.P['stone']
    prof = [(0.02, ZB), (-depth, ZB), (-depth, z1), (0.02, z1 + depth + 0.02)]
    sides = {'front': ((x0 - depth, y0), (x1 + depth, y0)), 'right': ((x1, y0 + 0.01), (x1, y1 - 0.01)),
             'back': ((x1 + depth, y1), (x0 - depth, y1)), 'left': ((x0, y1 - 0.01), (x0, y0 + 0.01))}
    for side, (p0, p1) in sides.items():
        fr, L = wall_frame(p0, p1)
        ax = 0 if side in ('front', 'back') else 1
        cuts = []
        for (s, a, b) in gaps:
            if s != side:
                continue
            ua, ub = sorted(((a - p0[ax]) * (1 if p1[ax] > p0[ax] else -1),
                             (b - p0[ax]) * (1 if p1[ax] > p0[ax] else -1)))
            cuts.append((ua, ub))
        cuts.sort()
        cur = 0.0
        for ua, ub in cuts + [(L, L)]:
            if ua > cur + 0.05:
                A.add(profile_run(fr, prof, cur, ua), mat)
            cur = max(cur, ub)


def coping(A, pts, z, width, mat, seg=0.9, th=0.07, over=0.05, rng=None):
    """Individual coping stones along a polyline (plan points), top at z + th."""
    rng = rng or random.Random(7)
    for p0, p1 in zip(pts, pts[1:]):
        p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
        L = (p1 - p0).length
        n = max(1, int(round(L / seg)))
        d = (p1 - p0).normalized()
        for k in range(n):
            a = p0 + d * (L * k / n)
            b = p0 + d * (L * (k + 1) / n)
            dz = rng.uniform(-0.012, 0.012)
            A.add(beam(a + V((0, 0, z + th / 2 + dz)) + d * 0.006, b + V((0, 0, z + th / 2 + dz)) - d * 0.006,
                       width + 2 * over, th, bevel=0.015, maxlen=None), mat)


def parapet(A, x0, x1, y0, y1, z0, h=1.0, T=0.3, gaps=(), mat=None, cop=None):
    """Parapet walls flush with the outer faces of rectangle x0..x1, y0..y1,
    from z0 (roof top) up h, with coping.  gaps: [(side, a, b)]."""
    P = A.P
    mat = mat or P['stucco']
    cop = cop or P['stone']
    runs = {'front': ((x0, y0 + T / 2), (x1, y0 + T / 2), 0),
            'right': ((x1 - T / 2, y0 + T), (x1 - T / 2, y1 - T), 1),
            'back': ((x1, y1 - T / 2), (x0, y1 - T / 2), 0),
            'left': ((x0 + T / 2, y1 - T), (x0 + T / 2, y0 + T), 1)}
    for side, (p0, p1, ax) in runs.items():
        fr, L = wall_frame(p0, p1)
        sgn = 1 if p1[ax] > p0[ax] else -1
        holes = []
        for (s, a, b) in gaps:
            if s == side:
                ua, ub = sorted(((a - p0[ax]) * sgn, (b - p0[ax]) * sgn))
                holes.append(Hole(ua, ub, z0 - 0.001, z0 + h + 1.0))
        spans = []
        cur = 0.0
        ext = (T if ax == 1 else 0.0)
        for hh in sorted(holes, key=lambda q: q.a) + [Hole(L, L, 0, 0)]:
            if hh.a > cur + 0.05:
                spans.append((cur, hh.a))
            cur = max(cur, hh.b)
        for (ua, ub) in spans:
            ends = (ua > 0.01 or ax == 0, ub < L - 0.01 or ax == 0)
            bm = holey_slab(fr, ua, ub, z0, z0 + h, -T / 2, T / 2, (), ends=ends, vbot=False,
                            faces=('neg', 'pos', 'end'))
            A.add(bm, None, mats=[mat, mat, mat, mat, mat, mat])
            A.col_frame(fr, ua, ub, z0, z0 + h + 0.07, -T / 2, T / 2)
            ea = ua - (T if (ax == 1 and ua < 0.01) else 0.0)
            eb = ub + (T if (ax == 1 and ub > L - 0.01) else 0.0)
            coping(A, [fr(ea, 0, 0)[:2], fr(eb, 0, 0)[:2]], z0 + h, T, cop)


def floor_slab(A, x0, x1, y0, y1, ztop, thick=0.3, holes=(), top=None, ceil=None, beams=True,
               beam_axis='y', beam_step=0.85, collide=True, reveal=None, embed=0.15):
    """Interior floor between walls: gridded top face, plaster ceiling with oak
    beams below.  holes are plan rectangles (x0, x1, y0, y1)."""
    P = A.P
    top = top or P['terracotta']
    ceil = ceil or P['plaster']
    fr = Frame((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    hs = [Hole(a, b, c, d) for (a, b, c, d) in holes]
    bm = holey_slab(fr, x0, x1, y0, y1, ztop - thick, ztop, hs, ends=(False, False), vbot=False, vtop=False,
                    faces=('neg', 'pos', 'rev'))
    A.add(bm, None, mats=[ceil, top, reveal or P['oak'], ceil, ceil, ceil])
    if beams:
        zb = ztop - thick
        if beam_axis == 'y':
            n = max(1, int((x1 - x0) / beam_step))
            for k in range(n):
                x = x0 + (x1 - x0) * (k + 0.5) / n
                segs = [(y0 - embed, y1 + embed)]
                for (a, b, c, d) in holes:
                    if a - 0.1 < x < b + 0.1:
                        segs = [s2 for s in segs for s2 in ((s[0], c), (d, s[1])) if s2[1] - s2[0] > 0.3]
                for (ya, yb) in segs:
                    A.add(box((x - 0.1, ya, zb - 0.24), (x + 0.1, yb, zb), bevel=0.012, maxlen=1.9), P['oak'])
        else:
            n = max(1, int((y1 - y0) / beam_step))
            for k in range(n):
                y = y0 + (y1 - y0) * (k + 0.5) / n
                segs = [(x0 - embed, x1 + embed)]
                for (a, b, c, d) in holes:
                    if c - 0.1 < y < d + 0.1:
                        segs = [s2 for s in segs for s2 in ((s[0], a), (b, s[1])) if s2[1] - s2[0] > 0.3]
                for (xa, xb) in segs:
                    A.add(box((xa, y - 0.1, zb - 0.24), (xb, y + 0.1, zb), bevel=0.012, maxlen=1.9), P['oak'])
        for (a, b, c, d) in holes:        # trimmers around stair wells
            A.add(box((a - 0.12, c - 0.12, zb - 0.24), (b + 0.12, c, zb), bevel=0.01, maxlen=1.1), P['oak'])
            A.add(box((a - 0.12, d, zb - 0.24), (b + 0.12, d + 0.12, zb), bevel=0.01, maxlen=1.1), P['oak'])
    if collide:
        for (u0, u1, v0, v1) in slab_boxes(x0, x1, y0, y1, [Hole(a, b, c, d) for (a, b, c, d) in holes]):
            A.col((u0, v0, ztop - thick), (u1, v1, ztop))


def tile_caps(A, p0, p1, z_of, spacing=0.4, r=0.075, length=0.34, down=None, mat=None):
    """Row of curved cap-tile ends along an eave from p0 to p1 (plan); z_of(pt)
    gives the roof surface height; `down` is the downslope unit vector."""
    mat = mat or A.P['rooftile']
    p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    L = (p1 - p0).length
    d = (p1 - p0).normalized()
    n = int(L / spacing)
    dn = V(down).normalized()
    for k in range(n):
        c = p0 + d * (spacing * (k + 0.5))
        top = V((c.x, c.y, z_of(c)))
        a = top - dn * length
        a.z = z_of(a)
        b = top + dn * 0.03
        b.z = top.z - dn.z * 0.03
        bm = bm_tube([a + V((0, 0, 0.02)), b + V((0, 0, 0.02))], r, sides=4, caps=True, smooth=True)
        rot(bm, 0.0, 'Z')
        A.add(bm, mat, uv=frame_uv(p0, d, -dn))


def gable_roof(A, x0, x1, y0, y1, z_eave, pitch_deg, over=0.45, verge=0.3, th=0.22, rafters=True,
               axis='x', caps=True, collide=True, key='', rafter_step=0.95):
    """Two-pitch tiled roof over the rectangle (outer wall faces), ridge along
    `axis`.  The underside (rafters, boards) is dressed for interiors.
    Returns the gable polyline helper g(u_from_side_start) for the gable walls."""
    P = A.P
    tp = math.tan(math.radians(pitch_deg))
    if axis == 'x':
        ym = (y0 + y1) / 2
        run = (y1 - y0) / 2 + over
        ridge_z = z_eave + ((y1 - y0) / 2) * tp
        slopes = [((x0 - verge, y0 - over), (x1 + verge, y0 - over), V((0, 1, 0))),
                  ((x1 + verge, y1 + over), (x0 - verge, y1 + over), V((0, -1, 0)))]
    else:
        xm = (x0 + x1) / 2
        run = (x1 - x0) / 2 + over
        ridge_z = z_eave + ((x1 - x0) / 2) * tp
        slopes = [((x1 + over, y0 - verge), (x1 + over, y1 + verge), V((-1, 0, 0))),
                  ((x0 - over, y1 + verge), (x0 - over, y0 - verge), V((1, 0, 0)))]
    cosp = math.cos(math.radians(pitch_deg))
    slope_len = run / cosp
    z_low = z_eave - over * tp
    for (e0, e1, inward) in slopes:
        e0v = V((e0[0], e0[1], z_low))
        e1v = V((e1[0], e1[1], z_low))
        U = (e1v - e0v).normalized()
        Vs = (inward * cosp + V((0, 0, math.sin(math.radians(pitch_deg))))).normalized()
        Tn = U.cross(Vs)
        if Tn.z < 0:
            Tn = -Tn
        fr = Frame(e0v, U, Vs, Tn)
        L = (e1v - e0v).length
        bm = holey_slab(fr, 0.0, L, 0.0, slope_len, 0.0, th, (), step=1.5, vtop=False)
        uvf = frame_uv(e0v, U, Vs)
        A.add(bm, None, mats=[P['oak'], P['rooftile'], P['wood'], P['wood'], P['wood'], P['wood']], uv=uvf, key=key)
        # rafters under the boards
        if rafters:
            n = int(L / rafter_step)
            for k in range(1, n):
                u = L * k / n
                A.add(beam(fr(u, 0.1, -0.08), fr(u, slope_len - 0.05, -0.08), 0.1, 0.16, up=Tn, bevel=0.0,
                           maxlen=1.8), P['oak'], key=key)
        if caps:
            dn = -V((inward.x, inward.y, 0))
            tile_caps(A, e0, e1, lambda p, e0v=e0v, inward=inward: z_low + th / cosp + (V((p.x, p.y, 0)) - V((e0v.x, e0v.y, 0))).dot(inward) * tp,
                      down=dn)
        if collide:
            c0 = fr(L / 2, 0.0, th)
            c1 = fr(L / 2, slope_len, th)
            A.ramp(c0, c1, L, thick=0.3, ext=0.0)
    # ridge tiles
    if axis == 'x':
        a, b = V((x0 - verge, ym, ridge_z + th / cosp)), V((x1 + verge, ym, ridge_z + th / cosp))
    else:
        a, b = V((xm, y0 - verge, ridge_z + th / cosp)), V((xm, y1 + verge, ridge_z + th / cosp))
    A.add(bm_tube([a, b], 0.13, sides=8), P['rooftile'], uv=frame_uv(a, (b - a).normalized(), V((0, 0, 1))), key=key,
          maxlen=1.2)
    return ridge_z


def gable_top(L, z_eave, ridge_z, T=T_WALL, inset=0.0):
    """Polyline for a gable wall of centre-line length L whose ends are T inside
    the outer faces: eave at the outer faces, ridge in the middle."""
    half = L / 2 + T
    tp = (ridge_z - z_eave) / half
    return [(0.0, z_eave + T * tp - inset), (L / 2, ridge_z - inset), (L, z_eave + T * tp - inset)]


def stair(A, S, d, width, z0, z1, run, kind='stone', zb=None, rail=None, mat=None, body=None,
          side_wall=None, collide=True, key=''):
    """Straight stair: bottom riser centred at S (plan), rising along d.
    kind 'stone' (solid masonry body below) or 'wood' (open oak stringers).
    rail: None | 'left' | 'right' | 'both' (iron handrail)."""
    P = A.P
    S = V((S[0], S[1], 0))
    d = V((d[0], d[1], 0)).normalized()
    left = V((-d.y, d.x, 0))
    rise_total = z1 - z0
    n = max(2, int(round(rise_total / 0.19)))
    rise = rise_total / n
    g = run / n
    fr = Frame(S, d, (0, 0, 1), left)
    if kind == 'stone':
        tread = mat or P['stone']
        bodym = body or P['stucco']
        zb = ZB if zb is None else zb
        top = [(0.0, z0), (run - g, z1 - rise)]
        bm = holey_slab(fr, 0.0, run - g, zb, z1, -width / 2, width / 2, (), top=top, ends=(True, True), vbot=False,
                        step=1.0)
        A.add(bm, None, mats=[bodym, bodym, bodym, bodym, bodym, bodym], key=key)
        for i in range(n):
            u0, u1 = i * g - 0.035, (i + 1) * g
            zt = z0 + (i + 1) * rise
            zlo = z0 + (i * g) * (rise_total - rise) / max(1e-6, run - g) - 0.08
            A.add(lbox(fr, u0, u1, zlo, zt, -width / 2 - 0.02, width / 2 + 0.02, bevel=0.02), tread, key=key)
    elif kind == 'slab':
        tread = mat or P['stone']
        A.add(beam(fr(-0.02, z0 - 0.22, 0.0), fr(run, z1 - rise - 0.22, 0.0), width, 0.2, bevel=0.0, maxlen=1.2),
              body or P['plaster'], key=key)
        for i in range(n):
            u0, u1 = i * g - 0.03, (i + 1) * g
            zt = z0 + (i + 1) * rise
            zlo = z0 + (i * g) * (rise_total - rise) / max(1e-6, run - g) - 0.14
            A.add(lbox(fr, u0, u1, zlo, zt, -width / 2, width / 2), tread, key=key)
    else:
        wood = mat or P['oak']
        for s in (-1, 1):
            A.add(beam(fr(-0.05, z0 - 0.05, s * (width / 2 + 0.03)), fr(run, z1 - 0.1, s * (width / 2 + 0.03)),
                       0.06, 0.28, bevel=0.01), wood, key=key)
        for i in range(n):
            u0, u1 = i * g - 0.03, (i + 1) * g
            zt = z0 + (i + 1) * rise
            A.add(lbox(fr, u0, u1, zt - 0.05, zt, -width / 2, width / 2), wood, key=key)
    if rail:
        sides = {'left': [1], 'right': [-1], 'both': [-1, 1]}[rail]
        for s in sides:
            t = s * (width / 2 - 0.05)
            a = fr(0.0, z0 + 0.95, t)
            b = fr(run - g * 0.5, z1 + 0.95, t)
            A.add(bm_tube([a, b], 0.025, sides=6), P['iron'], key=key, maxlen=1.2)
            m = max(2, int(run / 0.9))
            for k in range(m + 1):
                u = (run - g) * k / m
                zz = z0 + u / max(1e-6, run - g) * (z1 - rise - z0) + rise
                A.add(lbox(fr, u - 0.02, u + 0.02, zz, zz + 0.95 - 0.02, t - 0.02, t + 0.02), P['iron'], key=key)
    if collide:
        A.ramp(fr(-g * 0.5, z0, 0.0), fr(run - g * 0.5, z1, 0.0), width)
        A.col_frame(fr, run - g, run + 0.02, z1 - 0.3, z1, -width / 2, width / 2)
    return fr


def railing(A, p0, p1, z0, h=1.0, spacing=0.15, collide=True, posts=1.2, key='', z1=None):
    """Iron railing from p0 to p1 (plan) standing on z0 (or sloping to z1)."""
    P = A.P
    z1 = z0 if z1 is None else z1
    a, b = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    L = (b - a).length
    d = (b - a).normalized()
    at = lambda s, dz: V((a.x + d.x * s, a.y + d.y * s, lerp(z0, z1, s / max(L, 1e-6)) + dz))
    A.add(bm_tube([at(0, h), at(L, h)], 0.028, sides=6), P['iron'], key=key, maxlen=1.2)
    A.add(bm_tube([at(0, 0.1), at(L, 0.1)], 0.015, sides=4), P['iron'], key=key, maxlen=1.2)
    n = max(1, int(L / spacing))
    for k in range(n + 1):
        s = L * k / n
        p = at(s, 0)
        thick = 0.022 if (k % max(1, int(posts / spacing))) else 0.035
        A.add(box((p.x - thick / 2, p.y - thick / 2, p.z), (p.x + thick / 2, p.y + thick / 2, p.z + h)), P['iron'], key=key)
    if collide:
        c = (at(0, h / 2) + at(L, h / 2)) / 2
        X = (at(L, 0) - at(0, 0)).normalized()
        Z = V((0, 0, 1)) - X * X.z
        Z.normalize()
        Y = Z.cross(X)
        A.col_obox(c, ((at(L, 0) - at(0, 0)).length, 0.08, h), Matrix((X, Y, Z)).transposed())


def render_patch(A, fr, u, v, size, t_face, seed, key=''):
    """Fallen render showing the rubble behind: a stone patch with a thick
    stucco lip, sitting on the exterior face (t_face, facing -T)."""
    P = A.P
    rng = random.Random(seed)
    n = 14
    ph = rng.uniform(0, 10)
    rad = []
    for i in range(n):
        a = TAU * i / n
        r = size * (1.0 + 0.32 * math.sin(3 * a + ph) + 0.18 * math.sin(5 * a + ph * 2.1) + rng.uniform(-0.1, 0.1))
        rad.append((math.cos(a) * r * 1.6, math.sin(a) * r * 0.85))
    sgn = -1.0            # outward is -T
    bm = bmesh.new()
    c = bm.verts.new(fr(u, v, t_face + sgn * 0.004))
    inner = [bm.verts.new(fr(u + x, v + y, t_face + sgn * 0.004)) for x, y in rad]
    mid = [bm.verts.new(fr(u + x * 0.55, v + y * 0.55, t_face + sgn * 0.004)) for x, y in rad]
    for i in range(n):
        j = (i + 1) % n
        for q in ([c, mid[i], mid[j]], [mid[i], inner[i], inner[j], mid[j]]):
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.dot(-fr.T) < 0:
                f.normal_flip()
    A.add(bm, P['stone'], tint=(0.85, 0.82, 0.78), key=key)
    bm = bmesh.new()
    lip_in = [bm.verts.new(fr(u + x, v + y, t_face + sgn * 0.022)) for x, y in rad]
    base_in = [bm.verts.new(fr(u + x, v + y, t_face + sgn * 0.004)) for x, y in rad]
    outer = [bm.verts.new(fr(u + x * 1.22 + (0.02 if x > 0 else -0.02), v + y * 1.22, t_face + sgn * 0.001))
             for x, y in rad]
    cu = fr(u, v, t_face)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new([lip_in[i], lip_in[j], outer[j], outer[i]])
        f.normal_update()
        if f.normal.dot(-fr.T) < 0:
            f.normal_flip()
        f = bm.faces.new([base_in[i], base_in[j], lip_in[j], lip_in[i]])
        f.normal_update()
        cen = f.calc_center_median()
        if f.normal.dot(cu - cen) < 0:
            f.normal_flip()
    A.add(bm, P['stucco'], key=key)


# ----------------------------------------------------------------------------
# furniture and small objects (built at the origin, then placed)
# ----------------------------------------------------------------------------
def placed(bm, c, rz=0.0, z=0.0):
    if rz:
        rot(bm, rz, 'Z')
    move(bm, (c[0], c[1], z))
    return bm


class Parts:
    """Collect (bm, mat, uv) for a piece of furniture, then place them all."""

    def __init__(self):
        self.items = []

    def add(self, bm, mat, uv=None):
        self.items.append((bm, mat, uv))
        return self

    def put(self, A, c, rz=0.0, z=0.0, key='', tint=None):
        for bm, mat, uv in self.items:
            A.add(placed(bm, c, rz, z), mat, key=key, uv=uv, tint=tint)


def table(A, c, w, d, h=0.78, rz=0.0, z=F0, mat=None, col=True):
    P = A.P
    mat = mat or P['oak']
    p = Parts()
    p.add(box((-w / 2, -d / 2, h - 0.05), (w / 2, d / 2, h), bevel=0.012, maxlen=1.0), mat)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - 0.08), sy * (d / 2 - 0.08)
            p.add(box((x - 0.035, y - 0.035, 0), (x + 0.035, y + 0.035, h - 0.05)), mat)
    p.add(box((-w / 2 + 0.06, -d / 2 + 0.06, h - 0.16), (w / 2 - 0.06, -d / 2 + 0.085, h - 0.05)), mat)
    p.add(box((-w / 2 + 0.06, d / 2 - 0.085, h - 0.16), (w / 2 - 0.06, d / 2 - 0.06, h - 0.05)), mat)
    p.put(A, c, rz, z)
    if col:
        R = Matrix.Rotation(rz, 3, 'Z')
        A.col_obox(V((c[0], c[1], z + h / 2)), (w, d, h), R)
    return z + h


def chair(A, c, rz=0.0, z=F0):
    P = A.P
    p = Parts()
    oak = P['oak']
    p.add(box((-0.21, -0.2, 0.42), (0.21, 0.2, 0.46), bevel=0.01), P['straw'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 0.18, sy * 0.17
            top = 0.95 if sy > 0 else 0.44
            p.add(box((x - 0.022, y - 0.022, 0), (x + 0.022, y + 0.022, top)), oak)
    for zz in (0.62, 0.82):
        p.add(box((-0.18, 0.15, zz), (0.18, 0.19, zz + 0.07)), oak)
    p.add(box((-0.18, -0.19, 0.14), (0.18, -0.16, 0.18)), oak)
    p.put(A, c, rz, z)


def bench(A, c, L, rz=0.0, z=F0, back=False, mat=None, col=True):
    P = A.P
    mat = mat or P['oak']
    p = Parts()
    p.add(box((-L / 2, -0.2, 0.42), (L / 2, 0.2, 0.47), bevel=0.012, maxlen=1.0), mat)
    for x in (-L / 2 + 0.2, L / 2 - 0.2):
        p.add(box((x - 0.04, -0.17, 0), (x + 0.04, 0.17, 0.42)), mat)
    p.add(box((-L / 2 + 0.2, -0.03, 0.12), (L / 2 - 0.2, 0.03, 0.18), maxlen=1.0), mat)
    if back:
        for x in (-L / 2 + 0.2, L / 2 - 0.2):
            p.add(box((x - 0.03, 0.15, 0.47), (x + 0.03, 0.2, 0.95)), mat)
        p.add(box((-L / 2 + 0.1, 0.17, 0.72), (L / 2 - 0.1, 0.21, 0.9), bevel=0.008, maxlen=1.0), mat)
    p.put(A, c, rz, z)
    if col:
        A.col_obox(V((c[0], c[1], z + 0.235)), (L, 0.4, 0.47), Matrix.Rotation(rz, 3, 'Z'))


def shelf(A, c, w, d, h, n, rz=0.0, z=F0, mat=None, fill=None, rng=None, col=False):
    """Open shelf unit against a wall (its back at local +Y)."""
    P = A.P
    mat = mat or P['oak']
    rng = rng or random.Random(3)
    p = Parts()
    for x in (-w / 2, w / 2 - 0.035):
        p.add(box((x, -d / 2, 0), (x + 0.035, d / 2, h), maxlen=1.5), mat)
    levels = [0.1 + (h - 0.25) * k / (n - 1) for k in range(n)]
    for zz in levels:
        p.add(box((-w / 2, -d / 2, zz), (w / 2, d / 2, zz + 0.03), maxlen=1.5), mat)
    p.put(A, c, rz, z)
    if fill:
        R = Matrix.Rotation(rz, 3, 'Z')
        for zz in levels[:-1] + [levels[-1]]:
            x = -w / 2 + 0.08
            while x < w / 2 - 0.1:
                s = fill(A, rng)
                if s is None:
                    x += 0.12
                    continue
                bm, mat2, wid = s
                off = R @ V((x + wid / 2, rng.uniform(-0.03, 0.03), 0))
                A.add(placed(bm, (c[0] + off.x, c[1] + off.y), rz + rng.uniform(-0.3, 0.3), z + zz + 0.03), mat2)
                x += wid + rng.uniform(0.02, 0.1)
    if col:
        A.col_obox(V((c[0], c[1], z + h / 2)), (w, d, h), Matrix.Rotation(rz, 3, 'Z'))


def pot_bm(kind, s=1.0, segs=12):
    prof = {
        'tinaja': [(0, 0), (0.16, 0), (0.28, 0.12), (0.36, 0.38), (0.34, 0.62), (0.22, 0.8), (0.17, 0.85),
                   (0.2, 0.9), (0.17, 0.92), (0.14, 0.86), (0, 0.84)],
        'olla': [(0, 0), (0.08, 0), (0.13, 0.05), (0.15, 0.11), (0.12, 0.17), (0.13, 0.19), (0.1, 0.19),
                 (0, 0.15)],
        'cantir': [(0, 0), (0.06, 0), (0.1, 0.06), (0.11, 0.14), (0.07, 0.22), (0.02, 0.28), (0.035, 0.3), (0, 0.29)],
        'jar': [(0, 0), (0.05, 0), (0.07, 0.04), (0.075, 0.12), (0.05, 0.16), (0.055, 0.18), (0, 0.17)],
        'bowl': [(0, 0), (0.06, 0), (0.1, 0.03), (0.13, 0.07), (0.11, 0.07), (0, 0.03)],
        'amphora': [(0, 0), (0.03, 0.02), (0.1, 0.18), (0.2, 0.5), (0.21, 0.72), (0.12, 0.9), (0.07, 0.98),
                    (0.07, 1.08), (0.095, 1.12), (0.06, 1.12), (0, 1.0)],
    }[kind]
    return bm_lathe([(r * s, z * s) for r, z in prof], segs=segs)


def pot_fill(A, rng):
    k = rng.choice(['olla', 'jar', 'cantir', 'bowl', 'jar'])
    s = rng.uniform(0.8, 1.2)
    mat = A.P['clayglaze'] if rng.random() < 0.3 else A.P['clay']
    bm = pot_bm(k, s, segs=8)
    wid = {'olla': 0.3, 'jar': 0.15, 'cantir': 0.22, 'bowl': 0.26}[k] * s
    return bm, mat, wid


def clockpart_fill(A, rng):
    P = A.P
    r = rng.random()
    if r < 0.35:
        s = rng.uniform(0.07, 0.14)
        bm = bm_lathe([(0, 0), (s, 0), (s, 0.012), (0, 0.012)], segs=8, smooth=False)
        rot(bm, math.pi / 2, 'X')
        move(bm, (0, 0, s))
        return bm, P['brass'], s * 2
    if r < 0.65:
        w = rng.uniform(0.14, 0.24)
        h = rng.uniform(0.18, 0.3)
        bm = box((-w / 2, -0.07, 0), (w / 2, 0.07, h), bevel=0.01)
        return bm, P['oak'], w
    if r < 0.85:
        s = rng.uniform(0.09, 0.13)
        bm = bm_lathe([(0, 0), (s, 0), (s, 0.05), (0, 0.05)], segs=8, smooth=False)
        rot(bm, math.pi / 2, 'X')
        move(bm, (0, 0, s))
        return bm, P['face'], s * 2
    return None


def barrel_bm(h=0.9, r=0.3):
    prof = [(0, 0), (r * 0.82, 0)] + [(r * (0.82 + 0.18 * math.sin(math.pi * k / 8)), h * k / 8) for k in range(9)] + \
        [(r * 0.82, h), (0, h)]
    return bm_lathe(prof, segs=16)


def barrel(A, c, h=0.9, r=0.3, z=0.0, rz=0.0, col=True):
    P = A.P
    A.add(placed(barrel_bm(h, r), c, rz, z), P['oak'], uv=cyl_uv((c[0], c[1], z)))
    for zz in (0.1, 0.3, h - 0.3, h - 0.1):
        rr = r * (0.82 + 0.18 * math.sin(math.pi * zz / h)) + 0.006
        bm = bm_lathe([(rr, zz - 0.02), (rr, zz + 0.02)], segs=16, cap=False)
        A.add(placed(bm, c, rz, z), P['iron'])
    if col:
        A.col((c[0] - r, c[1] - r, z), (c[0] + r, c[1] + r, z + h))


def crate(A, c, s=(0.6, 0.45, 0.4), z=0.0, rz=0.0, col=True, fruit=None):
    P = A.P
    w, d, h = s
    p = Parts()
    wood = P['wood']
    for zz in (0.02, h / 2 + 0.01):
        for sy in (-1, 1):
            p.add(box((-w / 2, sy * d / 2 - 0.012, zz), (w / 2, sy * d / 2 + 0.012, zz + h / 2 - 0.04)), wood)
        for sx in (-1, 1):
            p.add(box((sx * w / 2 - 0.012, -d / 2, zz), (sx * w / 2 + 0.012, d / 2, zz + h / 2 - 0.04)), wood)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(box((sx * w / 2 - 0.03, sy * d / 2 - 0.03, 0), (sx * w / 2 + 0.03, sy * d / 2 + 0.03, h)), wood)
    p.add(box((-w / 2, -d / 2, 0), (w / 2, d / 2, 0.02)), wood)
    p.put(A, c, rz, z)
    if fruit:
        rng = random.Random(int(c[0] * 100 + c[1] * 7))
        R = Matrix.Rotation(rz, 3, 'Z')
        for k in range(10):
            off = R @ V((rng.uniform(-w / 2 + 0.07, w / 2 - 0.07), rng.uniform(-d / 2 + 0.07, d / 2 - 0.07), 0))
            A.add(bm_ico(0.055, 1, (c[0] + off.x, c[1] + off.y, z + h - 0.05 + rng.uniform(-0.02, 0.02))),
                  P[fruit])
    if col:
        A.col_obox(V((c[0], c[1], z + h / 2)), (w, d, h), Matrix.Rotation(rz, 3, 'Z'))


def bed_cot(A, c, rz=0.0, z=F0, L=1.95, W=0.95):
    P = A.P
    p = Parts()
    oak = P['oak']
    p.add(box((-W / 2, -L / 2, 0.25), (W / 2, L / 2, 0.35), bevel=0.01, maxlen=1.0), oak)
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = 0.95 if sy > 0 else 0.6
            p.add(box((sx * W / 2 - 0.05, sy * L / 2 - 0.05, 0), (sx * W / 2 + 0.03, sy * L / 2 + 0.03, top)), oak)
    p.add(box((-W / 2, L / 2 - 0.04, 0.45), (W / 2, L / 2 + 0.01, 0.9), bevel=0.01), oak)
    p.add(box((-W / 2 + 0.03, -L / 2 + 0.03, 0.35), (W / 2 - 0.03, L / 2 - 0.05, 0.52), bevel=0.05, segs=2), P['linen'])
    p.add(box((-W / 2 + 0.1, L / 2 - 0.45, 0.52), (W / 2 - 0.1, L / 2 - 0.1, 0.62), bevel=0.04, segs=2), P['linen'])
    p.add(box((-W / 2 - 0.02, -L / 2 + 0.02, 0.4), (W / 2 + 0.02, 0.2, 0.56), bevel=0.03, segs=2), P['cloth'])
    p.put(A, c, rz, z)
    A.col_obox(V((c[0], c[1], z + 0.28)), (W, L, 0.56), Matrix.Rotation(rz, 3, 'Z'))


def lantern(A, pos, key='', hang=0.0):
    """Small iron lantern with a glowing glass body (street lamps, belfry...)."""
    P = A.P
    x, y, z = pos
    body = bm_lathe([(0.0, 0.0), (0.07, 0.0), (0.1, 0.05), (0.1, 0.28), (0.0, 0.28)], segs=6, smooth=False)
    A.add(placed(body, (x, y), 0, z), P['lampglow'], key=key)
    cap = bm_lathe([(0.0, 0.26), (0.15, 0.27), (0.02, 0.42), (0.0, 0.42)], segs=6, smooth=False)
    A.add(placed(cap, (x, y), 0, z), P['iron'], key=key)
    for k in range(6):
        a = TAU * (k + 0.5) / 6
        A.add(box((x + 0.1 * math.cos(a) - 0.008, y + 0.1 * math.sin(a) - 0.008, z + 0.02),
                  (x + 0.1 * math.cos(a) + 0.008, y + 0.1 * math.sin(a) + 0.008, z + 0.28)), P['iron'], key=key)
    base = bm_lathe([(0.0, -0.04), (0.08, -0.04), (0.08, 0.0), (0.0, 0.0)], segs=6, smooth=False)
    A.add(placed(base, (x, y), 0, z), P['iron'], key=key)
    if hang:
        A.add(box((x - 0.008, y - 0.008, z + 0.42), (x + 0.008, y + 0.008, z + 0.42 + hang)), P['iron'], key=key)


def egg_bm(h=1.6, segs=24, rings=16):
    """Dali's egg: blunt end down, a touch of asymmetry."""
    prof = []
    for i in range(rings + 1):
        t = i / rings
        th = math.pi * t
        z = (1 - math.cos(th)) / 2
        r = math.sin(th) * (0.5 + 0.1 * (1 - z) - 0.02 * z) * 0.78
        prof.append((max(r, 0.0), z * h))
    prof[0] = (0.0, 0.0)
    prof[-1] = (0.0, h)
    return bm_lathe([(r * h * 0.84, z) for r, z in prof], segs=segs)


# ----------------------------------------------------------------------------
# rectangular shells
# ----------------------------------------------------------------------------
def rect_walls(A, x0, x1, y0, y1, top, ops, T=T_WALL, ext=None, inn=None, gables=None, zb=ZB, topmat=None,
               step=1.3, dado=None, bands=(0.15, 0.5)):
    """Four exterior walls of the rectangle (outer faces), front = -Y.  ops:
    {'front'|'right'|'back'|'left': [opening dicts with 'at' = world x (front,
    back) or world y (sides)]}.  gables: {side: (z_eave, ridge_z)}."""
    runs = {
        'front': ((x0, y0 + T / 2), (x1, y0 + T / 2), lambda a: a - x0, (True, True)),
        'right': ((x1 - T / 2, y0 + T), (x1 - T / 2, y1 - T), lambda a: a - (y0 + T), (False, False)),
        'back': ((x1, y1 - T / 2), (x0, y1 - T / 2), lambda a: x1 - a, (True, True)),
        'left': ((x0 + T / 2, y1 - T), (x0 + T / 2, y0 + T), lambda a: (y1 - T) - a, (False, False)),
    }
    walls = {}
    for side, (p0, p1, conv, ends) in runs.items():
        L = math.dist(p0, p1)
        ol = []
        for o in ops.get(side, []):
            o = dict(o)
            o['u'] = conv(o['at'])
            ol.append(o)
        gab = None
        if gables and side in gables:
            ze, rz = gables[side]
            gab = gable_top(L, ze, rz, T=T if side in ('left', 'right') else 0.0)
        walls[side] = Wall(A, p0, p1, top, ol, T=T, ext=ext, inn=inn, ends=ends, gable=gab, zb=zb,
                           topmat=topmat, step=step, dado=dado, bands=bands)
        dress(A, walls[side])
    return walls


def door_gaps(ops, pad=0.32):
    g = []
    for side, lst in ops.items():
        for o in lst:
            if o.get('kind') in ('door', 'arch') and o['z0'] < 0.5:
                g.append((side, o['at'] - o['w'] / 2 - pad, o['at'] + o['w'] / 2 + pad))
    return g


def prism_yz(pts_yz, x0, x1):
    """Extrude a (y, z) profile along X from x0 to x1."""
    bm = bm_prism(pts_yz, x0, x1)
    M = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0)))       # (x, y, z)_prism -> (y, z, x)
    xform(bm, M.to_4x4())
    return bm


def pew(A, c, L, z=F0):
    """Church pew facing +Y: solid shaped ends, seat, back and a kneeler board."""
    P = A.P
    oak = P['oak']
    p = Parts()
    for x in (-L / 2, L / 2 - 0.05):
        p.add(prism_yz([(-0.25, 0.0), (0.25, 0.0), (0.25, 0.95), (0.12, 1.0), (-0.25, 0.6)], x, x + 0.05), oak)
    p.add(box((-L / 2 + 0.05, -0.22, 0.42), (L / 2 - 0.05, 0.2, 0.46), maxlen=1.6), oak)
    p.add(box((-L / 2 + 0.05, 0.19, 0.46), (L / 2 - 0.05, 0.23, 0.92), maxlen=1.6), oak)
    p.add(box((-L / 2 + 0.05, -0.22, 0.05), (L / 2 - 0.05, -0.2, 0.42), maxlen=1.6), oak)
    p.put(A, c, 0.0, z)
    A.col((c[0] - L / 2, c[1] - 0.25, z), (c[0] + L / 2, c[1] + 0.25, z + 0.95))


def all_quoins(A, x0, x1, y0, y1, z0, z1, mat=None, bevel=0.022):
    mat = mat or A.P['sandstone']
    for (x, y, sx, sy) in ((x0, y0, -1, -1), (x1, y0, 1, -1), (x1, y1, 1, 1), (x0, y1, -1, 1)):
        quoins(A, x, y, sx, sy, z0, z1, mat, bevel=bevel)


def chimney(A, x0, x1, y0, y1, z0, z1, scrap=False):
    P = A.P
    A.add(box((x0, y0, z0), (x1, y1, z1), maxlen=0.7), P['stucco'])
    A.add(box((x0 - 0.06, y0 - 0.06, z1), (x1 + 0.06, y1 + 0.06, z1 + 0.08), bevel=0.015), P['stone'])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for sx in (-1, 1):
        A.add(box((cx + sx * (x1 - x0) / 2 - 0.08 * (sx > 0) - 0.0, cy - 0.1, z1 + 0.08),
                  (cx + sx * (x1 - x0) / 2 + 0.08 * (sx < 0), cy + 0.1, z1 + 0.34)), P['stucco'])
    # a little tiled cap
    A.add(obox(V((cx, cy, z1 + 0.42)), ((x1 - x0) + 0.12, (y1 - y0) + 0.12, 0.06), Matrix.Identity(3), bevel=0.01),
          P['rooftile'])
    A.col((x0, y0, z0), (x1, y1, z1 + 0.45))
    if scrap:
        A.slot('scrap', (cx, cy, z1 + 0.45))


# ============================================================================
# B_Cottage  (8 x 8, one storey, outside stair to a roof terrace, a Dali egg)
# ============================================================================
def build_cottage(P):
    A = Asset('B_Cottage', P)
    x0, x1, y0, y1 = -4.0, 4.0, -4.0, 4.0
    top = F0 + STOREY                   # 3.9: roof terrace level
    ops = {
        'front': [dict(kind='door', at=-1.4, w=1.4, z0=F0, z1=2.75, leaves=1, surround='stone'),
                  dict(kind='window', at=1.7, w=1.1, z0=1.25, z1=2.6, grille=True, surround='paint', glass=None),
                  dict(kind='window', at=-3.0, w=0.7, z0=1.5, z1=2.4, surround='paint', shutters=False)],
        'right': [dict(kind='window', at=-1.9, w=1.0, z0=1.3, z1=2.55, surround='paint'),
                  dict(kind='window', at=2.0, w=1.0, z0=1.3, z1=2.55, surround='paint')],
        'back': [dict(kind='panel', at=-1.4, w=4.0, z0=F0, z1=F0 + STOREY),
                 dict(kind='window', at=2.3, w=0.8, z0=2.0, z1=2.9, surround='paint', shutters=False, grille=True,
                      glass=None)],
        'left': [],
    }
    walls = rect_walls(A, x0, x1, y0, y1, top, ops, topmat=P['terracotta'], dado=(F0 + 1.05, DADO_OCHRE))
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops))
    all_quoins(A, x0, x1, y0, y1, 0.66, 3.55)
    cornice(A, x0, x1, y0, y1, 3.6)
    # partition with an arched doorway between kitchen and back room
    pw = Wall(A, (-3.6, 0.0), (3.6, 0.0), top - 0.3, [dict(kind='door', u=4.8, w=1.3, z0=F0, z1=2.45, arch='round',
                                                        exterior=False, surround='oak', leaves=0)],
              T=0.2, ext=P['plaster'], inn=P['plaster'], ends=(False, False), zb=F0,
              dado=(F0 + 1.05, DADO_OCHRE), both=True)
    dress(A, pw)
    floor_slab(A, -3.6, 3.6, -3.6, 3.6, F0, thick=0.9, beams=False, collide=False)
    A.col((x0, y0, ZB), (x1, y1, F0))
    floor_slab(A, -3.6, 3.6, -3.6, 3.6, top, beam_axis='x')
    parapet(A, x0, x1, y0, y1, top, 1.0, gaps=[('left', 1.7, 2.8)])
    # outside stair along the left wall to the terrace
    stair(A, (-4.6, -3.2), (0, 1), 1.2, 0.0, top, 4.8, kind='stone')
    A.add(box((-5.2, 1.6, ZB), (-4.0, 2.9, top - 0.06), maxlen=0.8), P['stucco'])
    A.add(box((-5.24, 1.56, top - 0.06), (-4.0, 2.94, top), bevel=0.012), P['stone'])
    A.col((-5.2, 1.6, ZB), (-4.0, 2.9, top))
    bfr, _ = wall_frame((-5.1, -3.3), (-5.1, 2.9))
    bal = holey_slab(bfr, 0.0, 6.2, ZB, top + 0.9, -0.1, 0.1, (), top=[(0.0, 0.95), (4.9, top + 0.9), (6.2, top + 0.9)],
                     vbot=False, step=1.0)
    A.add(bal, None, mats=[P['stucco']] * 6)
    A.ramp(bfr(0.0, 0.95, 0.0), bfr(4.9, top + 0.9, 0.0), 0.2, thick=1.0)
    A.col((-5.2, 1.6, top), (-5.0, 2.9, top + 0.9))
    bfr2, _ = wall_frame((-5.2, 2.8), (-4.0, 2.8))
    A.add(holey_slab(bfr2, 0.0, 1.2, top - 0.1, top + 0.9, -0.1, 0.1, (), vbot=False, step=1.0), None,
          mats=[P['stucco']] * 6)
    A.col((-5.2, 2.7, top), (-4.0, 2.9, top + 0.9))
    # the Dali egg on the front-right parapet corner
    A.add(box((3.42, -4.08, top + 1.07), (4.08, -3.42, top + 1.4), bevel=0.02), P['stone'])
    egg = egg_bm(1.25)
    A.add(placed(egg, (3.75, -3.75), 0.4, top + 1.4), P['egg'])
    A.col((3.42, -4.08, top + 1.0), (4.08, -3.42, top + 2.65))
    # chimney from the hearth (left wall, kitchen)
    chimney(A, -3.7, -3.0, -2.45, -1.55, top, top + 1.7, scrap=True)
    # render damage
    render_patch(A, walls['front'].fr, 7.1, 0.85, 0.38, -T_WALL / 2, 11)
    render_patch(A, walls['right'].fr, 0.9, 2.9, 0.42, -T_WALL / 2, 12)
    render_patch(A, walls['back'].fr, 6.2, 1.1, 0.45, -T_WALL / 2, 13)
    # --- kitchen -------------------------------------------------------------
    zt = table(A, (0.8, -1.9), 1.5, 0.85)
    for (cx, cy, r) in ((0.35, -2.55, 0.0), (1.25, -2.55, 0.1), (0.8, -1.2, math.pi), (1.75, -1.9, math.pi / 2)):
        chair(A, (cx, cy), r)
    A.slot('Pomegranate', (0.7, -1.85, zt))
    A.add(placed(pot_bm('bowl', 1.4), (1.2, -1.75), 0, zt), P['clayglaze'])
    A.add(placed(pot_bm('cantir'), (0.2, -2.0), 0, zt), P['clay'])
    # hearth with a hood on the left wall
    A.add(box((-3.6, -2.8, F0), (-2.85, -1.2, 0.72), bevel=0.02), P['stone'])
    A.add(box((-3.6, -2.95, 1.75), (-2.7, -1.05, 1.85), bevel=0.012), P['oak'])
    hood = bm_prism([(-3.6, -2.9), (-2.75, -2.9), (-2.75, -1.1), (-3.6, -1.1)], 1.85, 2.6)
    A.add(hood, P['plaster'])
    A.add(box((-3.6, -2.6, 2.6), (-3.05, -1.4, 3.6), maxlen=0.8), P['plaster'])
    A.add(placed(pot_bm('olla', 1.3), (-3.2, -2.0), 0, 0.72), P['clay'])
    A.col((-3.6, -2.8, F0), (-2.85, -1.2, 0.72))
    # sink counter under the front window
    A.add(box((2.25, -3.6, F0), (3.6, -3.0, 1.12), maxlen=0.8), P['stucco'])
    A.add(box((2.2, -3.6, 1.12), (3.6, -2.94, 1.2), bevel=0.012), P['stone'])
    A.col((2.25, -3.6, F0), (3.6, -3.0, 1.2))
    A.add(placed(pot_bm('olla', 1.1), (3.2, -3.25), 0.0, 1.2), P['clayglaze'])
    shelf(A, (-2.1, -0.28), 1.6, 0.32, 1.9, 4, rz=0.0, fill=pot_fill, rng=random.Random(21))
    A.add(placed(pot_bm('tinaja', 1.0), (-3.1, -0.6), 0.0, F0), P['clay'])
    A.col((-3.45, -0.95, F0), (-2.75, -0.25, F0 + 0.9))
    A.slot('Candle', (1.7, -3.72, 1.25))
    A.slot('light', (0.8, -1.9, 3.25))
    A.slot('spawn', (-1.4, -2.6, F0))
    # --- back room ------------------------------------------------------------
    shelf(A, (-2.4, 0.28), 1.5, 0.32, 1.8, 4, rz=math.pi, fill=pot_fill, rng=random.Random(22))
    zt2 = table(A, (2.7, 2.9), 1.0, 0.6)
    chair(A, (2.2, 2.2), -0.3)
    A.slot('Birdcage', (2.7, 2.95, zt2), math.pi)
    A.slot('Drawers', (3.15, 0.9, F0), -math.pi / 2)
    A.slot('light', (0.0, 1.9, 3.25))
    A.slot('spawn', (-1.2, 2.2, F0))
    # terrace pots
    for (px, py) in ((2.9, 2.9), (-2.6, 3.1)):
        A.add(placed(pot_bm('olla', 2.2), (px, py), 0.0, top), P['clay'])
        A.add(bm_ico(0.32, 1, (px, py, top + 0.55), sc=(1, 1, 0.8)), P['foliage'])
        A.col((px - 0.3, py - 0.3, top), (px + 0.3, py + 0.3, top + 0.4))
    return A.finalize()


def flat_quad(hw, z0, z1, y):
    """A single quad in the XZ plane at y, facing -Y."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in ((-hw, y, z0), (hw, y, z0), (hw, y, z1), (-hw, y, z1))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    return bm


def wall_clock(A, pos, r, face_dir, hands=(6, 40), depth=0.06, key=''):
    """Round wall clock: brass bezel, face, hour marks, hands (h, m)."""
    P = A.P
    d = V(face_dir).normalized()
    ang = math.atan2(d.y, d.x) + math.pi / 2          # local -Y -> face_dir
    c = V(pos)

    def put(bm):
        rot(bm, ang, 'Z')
        move(bm, c)
        return bm
    body = bm_lathe([(0, 0), (r * 1.08, 0), (r * 1.08, depth), (0, depth)], segs=14, smooth=False)
    rot(body, -math.pi / 2, 'X')
    A.add(put(body), P['brass'], key=key)
    face = bm_lathe([(0, 0), (r, 0), (0, 0.001)], segs=14, smooth=False)
    rot(face, math.pi / 2, 'X')
    move(face, (0, -depth - 0.004, 0))
    A.add(put(face), P['face'], key=key)
    for k in range(12):
        a = TAU * k / 12
        L = 0.16 if k % 3 == 0 else 0.1
        m = flat_quad(0.012 * r * 4, r * (0.84 - L), r * 0.86, -depth - 0.008)
        rot(m, -a, 'Y')
        A.add(put(m), P['ink'], key=key)
    hh, mm = hands
    for (frac, L, w) in (((hh % 12 + mm / 60) / 12, 0.5, 0.05), (mm / 60, 0.78, 0.032)):
        m = flat_quad(w * r, -0.1 * r, L * r, -depth - 0.014)
        rot(m, -TAU * frac, 'Y')
        A.add(put(m), P['ink'], key=key)


def desk_lamp(A, base, facing, key=''):
    """Jeweller's articulated lamp on a bench."""
    P = A.P
    b = V(base)
    d = V((facing[0], facing[1], 0)).normalized()
    bm = bm_lathe([(0, 0), (0.09, 0), (0.08, 0.03), (0, 0.035)], segs=12)
    A.add(move(bm, b), P['iron'], key=key)
    j1 = b + V((0, 0, 0.45)) - d * 0.12
    j2 = j1 + d * 0.42 + V((0, 0, 0.05))
    A.add(bm_tube([b + V((0, 0, 0.03)), j1], 0.012, sides=6), P['brass'], key=key)
    A.add(bm_tube([j1, j2], 0.012, sides=6), P['brass'], key=key)
    shade = bm_lathe([(0.0, 0.0), (0.03, 0.0), (0.1, -0.14), (0.0, -0.1)], segs=12)
    A.add(move(shade, j2), P['brass'], key=key)
    A.add(bm_ico(0.035, 1, j2 + V((0, 0, -0.1))), P['lampglow'], key=key)


def gear_bm(r, th=0.012, teeth=12):
    pts = []
    for k in range(teeth * 2):
        a = TAU * k / (teeth * 2)
        rr = r if k % 2 == 0 else r * 0.85
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return bm_prism(pts, 0, th)


# ============================================================================
# B_Workshop  (12 x 8: Odile's clock-repair shop, with a mezzanine)
# ============================================================================
def build_workshop(P):
    A = Asset('B_Workshop', P)
    x0, x1, y0, y1 = -6.0, 6.0, -4.0, 4.0
    ze, pitch = 6.3, 24.0
    tp = math.tan(math.radians(pitch))
    ridge = ze + 4.0 * tp
    top = ze + T_WALL * tp
    ops = {
        'front': [dict(kind='window', at=-3.0, w=4.0, z0=1.3, z1=3.55, surround=None, shutters=False, sill=True,
                       glass='clear', sash='signpaint', stone='stone'),
                  dict(kind='door', at=0.9, w=1.5, z0=F0, z1=3.1, leaves=2, glazed=True, surround=None),
                  dict(kind='window', at=4.0, w=1.2, z0=1.35, z1=3.0, surround='stone', grille=True, glass='clear'),
                  dict(kind='window', at=-3.0, w=0.9, z0=4.9, z1=5.9, surround='paint', paint='paintochre'),
                  dict(kind='window', at=0.9, w=0.9, z0=4.9, z1=5.9, surround='paint', paint='paintochre'),
                  dict(kind='window', at=4.0, w=0.9, z0=4.3, z1=5.6, surround='paint', paint='paintochre')],
        'back': [dict(kind='panel', at=-3.0, w=4.0, z0=F0, z1=F0 + STOREY),
                 dict(kind='window', at=0.2, w=0.8, z0=1.4, z1=2.6, surround='stone', grille=True, glass=None,
                      shutters=False),
                 dict(kind='window', at=3.2, w=1.0, z0=4.3, z1=5.5, surround='stone')],
        'left': [dict(kind='window', at=0.0, w=1.1, z0=1.35, z1=3.0, surround='stone', glass='clear')],
        'right': [dict(kind='window', at=-2.0, w=0.9, z0=1.5, z1=2.7, surround='stone', glass='clear'),
                  dict(kind='window', at=2.0, w=0.9, z0=4.2, z1=5.4, surround='stone')],
    }
    walls = rect_walls(A, x0, x1, y0, y1, top, ops, gables={'left': (ze, ridge), 'right': (ze, ridge)},
                       dado=(F0 + 1.2, DADO_BLUE))
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops) + [('front', -5.6, 2.05)])
    all_quoins(A, x0, x1, y0, y1, 0.66, ze - 0.05)
    gable_roof(A, x0, x1, y0, y1, ze, pitch, over=0.5, verge=0.3)
    # eave cornice along the front and back (stepped clay courses)
    for yy, sgn in ((y0, -1), (y1, 1)):
        fr, L = wall_frame((x0 - 0.02, yy), (x1 + 0.02, yy)) if sgn < 0 else wall_frame((x1 + 0.02, yy), (x0 - 0.02, yy))
        for k, (o, zz) in enumerate(((0.06, ze - 0.36), (0.13, ze - 0.26), (0.2, ze - 0.16), (0.28, ze - 0.06))):
            A.add(profile_run(fr, [(0.02, zz), (-o, zz), (-o, zz + 0.07), (0.02, zz + 0.07)], 0.0, L),
                  P['terracotta'] if k % 2 == 0 else P['stucco'])
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F0, thick=0.9, beams=False, collide=False)
    A.col((x0, y0, ZB), (x1, y1, F0))
    # trusses: tie beams, king posts and struts
    for x in (-3.0, 0.0, 3.0):
        A.add(box((x - 0.12, y0 + 0.25, ze - 0.12), (x + 0.12, y1 - 0.25, ze + 0.14), bevel=0.015, maxlen=1.0), P['oak'])
        A.col((x - 0.12, y0 + 0.4, ze - 0.12), (x + 0.12, y1 - 0.4, ze + 0.14))
        A.add(box((x - 0.09, -0.09, ze + 0.14), (x + 0.09, 0.09, ridge - 0.05), bevel=0.01), P['oak'])
        for s in (-1, 1):
            A.add(beam((x, s * 0.1, ze + 0.5), (x, s * 2.4, ze + 0.14 + 2.4 * tp * 0.5 + 0.35), 0.1, 0.12), P['oak'])
    A.slot('scrap', (3.0, 0.9, ze + 0.14))
    # --- shopfront -------------------------------------------------------------
    sp = P['signpaint']
    for x in (-5.35, 1.8):
        A.add(box((x - 0.14, y0 - 0.1, 0.25), (x + 0.14, y0 + 0.02, 3.72), bevel=0.012, maxlen=1.0), sp)
        A.add(box((x - 0.18, y0 - 0.13, 0.2), (x + 0.18, y0 + 0.02, 0.55), bevel=0.012), sp)
    A.add(box((-5.2, y0 - 0.08, ZB), (-0.85, y0 + 0.02, 0.3), bevel=0.01, maxlen=1.0), P['stone'])
    A.add(box((-5.1, y0 - 0.06, F0), (-0.95, y0 + 0.02, 1.3), bevel=0.01, maxlen=1.0), sp)
    for x in (-4.1, -3.0, -1.9):
        A.add(box((x - 0.35, y0 - 0.09, 0.45), (x + 0.35, y0 - 0.05, 1.15), bevel=0.01), sp)
    fascia_z0, fascia_z1 = 3.72, 4.62
    A.add(box((-5.55, y0 - 0.16, fascia_z0), (2.0, y0 + 0.02, fascia_z1), bevel=0.015, maxlen=1.0), sp)
    fr_f, Lf = wall_frame((-5.6, y0 - 0.16), (2.05, y0 - 0.16))
    A.add(profile_run(fr_f, [(0.0, fascia_z1), (-0.12, fascia_z1), (-0.16, fascia_z1 + 0.08), (-0.2, fascia_z1 + 0.14),
                             (0.0, fascia_z1 + 0.14)], 0.0, Lf), sp)
    A.add(text_mesh('HORLOGERIE', 0.42, (-1.75, y0 - 0.175, 4.25), depth=0.02), P['gilt'])
    A.add(text_mesh('O. VAUTRIN  ·  RÉPARATIONS', 0.15, (-1.75, y0 - 0.175, 3.88), depth=0.012), P['gilt'])
    for x in (-5.0, 1.45):
        wall_clock(A, (x, y0 - 0.16, 4.17), 0.28, (0, -1), hands=(6, 40), depth=0.04)
    # mullions + transom in the shop window
    for x in (-4.0 + 0.0, -3.0, -2.0):
        A.add(box((x - 0.035, y0 + 0.2, 1.3), (x + 0.035, y0 + 0.28, 3.55)), sp)
    A.add(box((-5.0, y0 + 0.2, 2.95), (-1.0, y0 + 0.28, 3.02)), sp)
    # projecting bracket sign: a double-faced clock on an iron arm
    A.add(beam((2.45, y0 + 0.02, 4.2), (2.45, y0 - 1.05, 4.2), 0.04, 0.05), P['iron'])
    A.add(beam((2.45, y0 + 0.02, 3.6), (2.45, y0 - 0.7, 4.18), 0.03, 0.03), P['iron'])
    for s in (-1, 1):
        wall_clock(A, (2.45 + s * 0.035, y0 - 0.75, 3.7), 0.32, (s, 0), hands=(6, 40), depth=0.035)
    A.add(box((2.44, y0 - 0.78, 4.02), (2.46, y0 - 0.72, 4.2)), P['iron'])
    # --- interior --------------------------------------------------------------
    # workbench under the shop window
    bx0, bx1, by0, by1, bz = -5.4, -0.95, y0 + 0.4, y0 + 1.15, F0 + 0.92
    A.add(box((bx0, by0, bz - 0.08), (bx1, by1, bz), bevel=0.015, maxlen=1.0), P['oak'])
    A.add(box((bx0 + 0.05, by0, F0), (bx0 + 0.95, by1 - 0.05, bz - 0.08), bevel=0.01), P['oak'])
    for k in range(4):
        zz = F0 + 0.08 + k * 0.13
        A.add(box((bx0 + 0.1, by1 - 0.06, zz), (bx0 + 0.9, by1 - 0.03, zz + 0.11), bevel=0.006), P['oak'])
        A.add(box((bx0 + 0.45, by1 - 0.04, zz + 0.04), (bx0 + 0.55, by1 + 0.0, zz + 0.07)), P['brass'])
    for x in (bx1 - 0.08, (bx0 + bx1) / 2 + 0.4):
        for y in (by0 + 0.06, by1 - 0.08):
            A.add(box((x - 0.04, y - 0.04, F0), (x + 0.04, y + 0.04, bz - 0.08)), P['oak'])
    A.add(box(((bx0 + bx1) / 2 - 1.5, by1 - 0.1, F0 + 0.15), (bx1 - 0.1, by1 - 0.06, F0 + 0.22), maxlen=1.0), P['oak'])
    A.col((bx0, by0, F0), (bx1, by1, bz))
    desk_lamp(A, (-3.9, by0 + 0.2, bz), (0, 1))
    desk_lamp(A, (-1.6, by0 + 0.2, bz), (0, 1))
    rng = random.Random(40)
    for k in range(9):
        g = gear_bm(rng.uniform(0.03, 0.09), 0.01, rng.choice([8, 10, 12]))
        A.add(placed(g, (rng.uniform(bx0 + 1.1, bx1 - 0.2), rng.uniform(by0 + 0.1, by1 - 0.15)), rng.uniform(0, 3), bz),
              P['brass'])
    A.add(box((-2.6, by1 - 0.25, bz), (-2.25, by1 - 0.05, bz + 0.12), bevel=0.01), P['iron'])
    A.slot('Clock', (-2.9, by0 + 0.45, bz))
    # shelves of clock parts on the left wall
    shelf(A, (x0 + 0.4 + 0.19, 2.1), 2.6, 0.38, 2.7, 5, rz=math.pi / 2, fill=clockpart_fill, rng=random.Random(41),
          col=True)
    shelf(A, (x0 + 0.4 + 0.19, -2.2), 1.9, 0.38, 2.2, 4, rz=math.pi / 2, fill=clockpart_fill, rng=random.Random(42),
          col=True)
    # the wall of clocks under the mezzanine (back wall)
    rng = random.Random(43)
    for k, (x, z, r) in enumerate(((1.0, 2.2, 0.26), (1.75, 1.7, 0.18), (1.8, 2.45, 0.2), (2.55, 2.1, 0.3),
                                   (3.35, 1.6, 0.16), (3.4, 2.4, 0.22), (4.1, 1.95, 0.2), (1.2, 1.45, 0.14))):
        wall_clock(A, (x, y1 - 0.4, z), r, (0, -1), hands=(rng.randint(1, 12), rng.choice([0, 10, 25, 40, 50])))
    # longcase clock
    A.add(box((0.0, y1 - 0.78, F0), (0.62, y1 - 0.42, F0 + 0.55), bevel=0.02), P['oak'])
    A.add(box((0.06, y1 - 0.74, F0 + 0.55), (0.56, y1 - 0.44, F0 + 1.7), bevel=0.015), P['oak'])
    A.add(box((-0.02, y1 - 0.8, F0 + 1.7), (0.64, y1 - 0.4, F0 + 2.35), bevel=0.02), P['oak'])
    wall_clock(A, (0.31, y1 - 0.8, F0 + 2.02), 0.22, (0, -1), hands=(6, 40), depth=0.01)
    A.col((0.0, y1 - 0.8, F0), (0.64, y1 - 0.4, F0 + 2.35))
    # central repair table
    zt = table(A, (-2.8, 0.9), 1.8, 0.9)
    chair(A, (-2.8, 0.2), 0.0)
    chair(A, (-1.7, 1.4), math.pi * 0.6)
    A.slot('Candle', (-3.4, 1.0, zt))
    A.slot('Anvil', (-0.2, -1.6, F0))
    A.add(placed(gear_bm(0.12, 0.015, 18), (-2.3, 1.1), 0.3, zt), P['brass'])
    # mezzanine (x 0.5..5.6, y 0.4..3.6) on posts, with a straight oak stair
    mz = F0 + 3.0
    floor_slab(A, 0.5, x1 - 0.4, 0.4, y1 - 0.4, mz, thick=0.22, top=P['oak'], ceil=P['oak'], beam_axis='y',
               beam_step=0.8, embed=0.0)
    A.add(box((0.4, 0.3, mz - 0.46), (x1 - 0.4, 0.5, mz - 0.22), bevel=0.012, maxlen=1.1), P['oak'])
    for x in (0.55, 2.5, 4.4):
        A.add(box((x - 0.09, 0.31, F0), (x + 0.09, 0.49, mz - 0.46), bevel=0.012, maxlen=1.2), P['oak'])
        A.col((x - 0.09, 0.31, F0), (x + 0.09, 0.49, mz - 0.46))
        for s in (-1, 1):
            A.add(beam((x, 0.4, mz - 1.0), (x + s * 0.45, 0.4, mz - 0.47), 0.08, 0.1), P['oak'])
    railing(A, (0.5, 0.42), (4.4, 0.42), mz, h=1.0)
    railing(A, (0.52, 0.4), (0.52, y1 - 0.4), mz, h=1.0)
    stair(A, (5.05, -3.35), (0, 1), 1.1, F0, mz, 3.75, kind='wood', rail='right')
    bed_cot(A, (4.7, 2.5), rz=0.0, z=mz, L=1.9, W=0.9)
    zd = table(A, (2.0, 3.25), 1.1, 0.55, z=mz)
    chair(A, (2.0, 2.65), 0.0, z=mz)
    A.slot('Clock', (2.2, 3.3, zd), math.pi)
    A.add(placed(box((-0.35, -0.22, 0), (0.35, 0.22, 0.45), bevel=0.02), (3.3, 3.25), 0.0, mz), P['wood'])
    A.slot('light', (-3.0, -2.5, 3.0))
    A.slot('light', (-2.0, 1.2, 4.6))
    A.slot('light', (3.0, 2.0, mz + 2.2))
    A.slot('spawn', (-3.0, 2.0, F0))
    A.slot('spawn', (2.2, -1.5, F0))
    render_patch(A, walls['back'].fr, 9.5, 1.0, 0.5, -T_WALL / 2, 31)
    render_patch(A, walls['left'].fr, 5.6, 2.4, 0.4, -T_WALL / 2, 32)
    render_patch(A, walls['right'].fr, 6.4, 1.1, 0.45, -T_WALL / 2, 33)
    return A.finalize()


# ============================================================================
# B_House  (8 x 12, two storeys, balcony, roof terrace with a stair-house)
# ============================================================================
def build_house(P):
    A = Asset('B_House', P)
    x0, x1, y0, y1 = -4.0, 4.0, -6.0, 6.0
    F1 = F0 + STOREY            # 3.9
    F2 = F1 + STOREY            # 7.5 (roof terrace)
    ops = {
        'front': [dict(kind='door', at=-1.9, w=1.4, z0=F0, z1=2.7, arch='round', leaves=1, surround='stone'),
                  dict(kind='window', at=1.9, w=1.1, z0=1.25, z1=2.75, grille=True, glass='clear'),
                  dict(kind='door', at=0.0, w=1.4, z0=F1, z1=F1 + 2.55, leaves=2, glazed=True, exterior=False,
                       surround='stone'),
                  dict(kind='window', at=-2.7, w=0.9, z0=F1 + 1.0, z1=F1 + 2.5, surround='paint'),
                  dict(kind='window', at=2.7, w=0.9, z0=F1 + 1.0, z1=F1 + 2.5, surround='paint')],
        'right': [dict(kind='window', at=3.4, w=1.0, z0=1.3, z1=2.7, glass='clear'),
                  dict(kind='window', at=-3.4, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint'),
                  dict(kind='window', at=3.4, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint')],
        'back': [dict(kind='door', at=1.6, w=1.3, z0=F0, z1=2.7, leaves=1, surround='stone'),
                 dict(kind='window', at=-2.0, w=1.0, z0=1.3, z1=2.6, grille=True, glass='clear', surround='paint'),
                 dict(kind='window', at=-2.0, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint'),
                 dict(kind='window', at=1.6, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint')],
        'left': [dict(kind='window', at=-3.2, w=1.0, z0=1.3, z1=2.7, glass='clear', surround='paint'),
                 dict(kind='window', at=3.0, w=1.0, z0=1.3, z1=2.7, glass='clear', surround='paint'),
                 dict(kind='window', at=-3.2, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint'),
                 dict(kind='window', at=3.0, w=1.0, z0=F1 + 1.0, z1=F1 + 2.4, surround='paint')],
    }
    walls = rect_walls(A, x0, x1, y0, y1, F2, ops, topmat=P['terracotta'], step=1.6,
                       dado=[(F0 + 1.1, DADO_OXBLOOD), (F1 + 1.1, DADO_BLUE, F1 - 0.35)])
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops))
    all_quoins(A, x0, x1, y0, y1, 0.66, F2 - 0.3)
    cornice(A, x0, x1, y0, y1, F2 - 0.3)
    # string course between the storeys
    A.add(rect_loop_profile(x0, x1, y0, y1, [(0.0, F1 - 0.2), (0.05, F1 - 0.18), (0.05, F1 - 0.08), (0.0, F1 - 0.06)]),
          P['sandstone'])
    # floors
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F0, thick=0.9, beams=False, collide=False)
    A.col((x0, y0, ZB), (x1, y1, F0))
    hole1 = (2.3, 3.6, -4.0, -1.0)
    hole2 = (1.0, 2.3, -2.4, 0.6)
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F1, holes=[hole1], beam_axis='x', beam_step=1.0)
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F2, holes=[hole2], beam_axis='x', beam_step=1.0)
    parapet(A, x0, x1, y0, y1, F2, 1.0)
    # partitions (ground: doorway + breakable panel; first floor: doorway)
    pw = Wall(A, (-3.6, 1.2), (3.6, 1.2), F1 - 0.3,
              [dict(kind='door', u=0.95, w=1.3, z0=F0, z1=2.5, arch='round', exterior=False, surround='oak', leaves=0),
               dict(kind='panel', u=3.9, w=4.0, z0=F0, z1=F0 + STOREY)],
              T=0.4, ext=P['plaster'], inn=P['plaster'], ends=(False, False), zb=F0, dado=(F0 + 1.1, DADO_OXBLOOD),
              both=True)
    dress(A, pw)
    pw2 = Wall(A, (-3.6, 1.2), (3.6, 1.2), F2 - 0.3,
               [dict(kind='door', u=1.0, w=1.3, z0=F1, z1=F1 + 2.4, exterior=False, surround='oak', leaves=1)],
               T=0.3, ext=P['plaster'], inn=P['plaster'], ends=(False, False), zb=F1,
               dado=(F1 + 1.1, DADO_BLUE), both=True)
    dress(A, pw2)
    # dog-leg stair: ground -> first floor along the right wall, then up to the roof hatch
    stair(A, (2.95, 0.6), (0, -1), 1.3, F0, F1, 4.6, kind='wood', rail='left')
    stair(A, (1.65, -4.0), (0, 1), 1.3, F1, F2, 4.6, kind='wood', rail='right')
    railing(A, (2.3, -1.0), (3.6, -1.0), F1, h=1.0)
    A.add(box((2.3, -1.05, F1 - 0.3), (3.6, -0.95, F1), maxlen=1.0), P['oak'])
    # stair-house on the roof
    sx0, sx1, sy0, sy1 = 0.75, 2.55, -2.65, 1.6
    sh_top = F2 + 2.6
    sw = rect_walls(A, sx0, sx1, sy0, sy1, sh_top,
                    {'back': [dict(kind='door', at=1.65, w=1.3, z0=F2, z1=F2 + 2.4, leaves=1, exterior=False,
                                   surround='stone')],
                     'right': [dict(kind='window', at=-1.2, w=0.6, z0=F2 + 1.2, z1=F2 + 2.0, shutters=False,
                                    surround='paint')]},
                    T=0.25, zb=F2 - 0.05)
    floor_slab(A, sx0 + 0.25, sx1 - 0.25, sy0 + 0.25, sy1 - 0.25, sh_top, thick=0.2, beams=False)
    A.add(box((sx0 - 0.08, sy0 - 0.08, sh_top), (sx1 + 0.08, sy1 + 0.08, sh_top + 0.1), bevel=0.02, maxlen=0.9),
          P['stone'])
    A.col((sx0, sy0, sh_top - 0.2), (sx1, sy1, sh_top + 0.1))
    A.slot('scrap', (1.65, -0.5, sh_top + 0.1))
    # balcony on stone corbels with an iron rail
    A.add(box((-1.65, y0 - 1.05, F1 - 0.16), (1.65, y0 + 0.05, F1), bevel=0.02, maxlen=0.9), P['stone'])
    for x in (-1.3, 0.0, 1.3):
        cb = bm_prism([(0.0, -0.02), (1.0, -0.02), (1.0, -0.16), (0.7, -0.45), (0.0, -0.65)], -0.12, 0.12)
        rot(cb, math.pi / 2, 'X')
        rot(cb, -math.pi / 2, 'Z')
        move(cb, (x, y0 + 0.0, F1))
        A.add(cb, P['stone'])
    A.col((-1.65, y0 - 1.05, F1 - 0.16), (1.65, y0, F1))
    railing(A, (-1.6, y0 - 1.0), (1.6, y0 - 1.0), F1)
    railing(A, (-1.6, y0 - 1.0), (-1.6, y0), F1)
    railing(A, (1.6, y0 - 1.0), (1.6, y0), F1)
    # --- ground floor: hall / living room (front), kitchen (back) --------------
    zt = table(A, (-1.4, -2.2), 1.6, 0.9)
    for (cx, cy, r) in ((-1.9, -2.9, 0.0), (-0.9, -2.9, 0.15), (-1.4, -1.45, math.pi)):
        chair(A, (cx, cy), r)
    A.slot('Candle', (-1.2, -2.1, zt))
    # hat stand by the door
    hs = bm_lathe([(0, 0), (0.2, 0), (0.05, 0.05), (0.03, 1.75), (0.05, 1.8), (0, 1.82)], segs=10)
    A.add(placed(hs, (-3.2, -5.1), 0, F0), P['oak'])
    for k in range(4):
        a = TAU * k / 4
        A.add(beam((-3.2, -5.1, F0 + 1.6), (-3.2 + 0.2 * math.cos(a), -5.1 + 0.2 * math.sin(a), F0 + 1.72), 0.025,
                   0.025), P['oak'])
    A.slot('BowlerHat', (-2.7, -5.0, F0))
    shelf(A, (-3.41, -0.3), 1.6, 0.36, 1.7, 3, rz=math.pi / 2, fill=pot_fill, rng=random.Random(51), col=True)
    A.slot('light', (-1.0, -2.5, 3.0))
    A.slot('spawn', (0.5, -3.8, F0))
    # kitchen
    A.add(box((-3.6, 4.2, F0), (-2.8, 5.6, 0.75), bevel=0.02), P['stone'])
    A.add(bm_prism([(-3.6, 4.1), (-2.7, 4.1), (-2.7, 5.6), (-3.6, 5.6)], 1.9, 2.6), P['plaster'])
    A.add(box((-3.6, 4.4, 2.6), (-3.1, 5.4, 3.6), maxlen=0.8), P['plaster'])
    A.col((-3.6, 4.2, F0), (-2.8, 5.6, 0.75))
    zk = table(A, (0.2, 3.4), 1.4, 0.8)
    chair(A, (-0.35, 3.4), -math.pi / 2)
    chair(A, (0.75, 3.4), math.pi / 2)
    A.slot('Pomegranate', (0.2, 3.35, zk))
    A.add(placed(pot_bm('tinaja', 1.0), (3.1, 2.1), 0, F0), P['clay'])
    A.col((2.75, 1.75, F0), (3.45, 2.45, F0 + 0.9))
    A.slot('light', (0.0, 3.5, 3.0))
    # --- first floor: bedroom (front), study (back) -----------------------------
    A.slot('Bed', (-1.8, -3.4, F1), 0.0)
    A.add(box((-3.6, -1.0, F1), (-2.9, 0.9, F1 + 2.1), bevel=0.02, maxlen=1.0), P['oak'])
    A.add(box((-2.92, -0.95, F1 + 1.9), (-2.88, 0.85, F1 + 2.0)), P['oak'])
    A.col((-3.6, -1.0, F1), (-2.9, 0.9, F1 + 2.1))
    chair(A, (0.3, -5.0), 0.4, z=F1)
    A.slot('Mirror', (-0.6, -0.4, F1), math.pi)
    A.slot('Candle', (-2.7, -5.72, F1 + 1.0))
    A.slot('light', (-1.0, -3.0, F1 + 3.0))
    zs = table(A, (-2.4, 4.9), 1.3, 0.65, z=F1)
    chair(A, (-2.4, 4.25), 0.0, z=F1)
    A.slot('Drawers', (0.6, 5.3, F1), math.pi)
    A.slot('Frame', (2.6, 3.0, F1), math.pi / 2)
    shelf(A, (3.41, 4.0), 1.8, 0.34, 2.0, 4, rz=-math.pi / 2, fill=clockpart_fill, rng=random.Random(52), col=True)
    A.slot('light', (0.0, 3.5, F1 + 3.0))
    A.slot('spawn', (-1.0, 3.0, F1))
    # roof terrace pots, a washing line post, render damage
    for (px, py) in ((-3.0, 5.0), (3.0, 5.0), (-3.0, -5.0)):
        A.add(placed(pot_bm('olla', 2.4), (px, py), 0.0, F2), P['clay'])
        A.add(bm_ico(0.35, 1, (px, py, F2 + 0.6), sc=(1, 1, 0.85)), P['foliage'])
        A.col((px - 0.33, py - 0.33, F2), (px + 0.33, py + 0.33, F2 + 0.45))
    render_patch(A, walls['left'].fr, 9.2, 1.0, 0.5, -T_WALL / 2, 51)
    render_patch(A, walls['right'].fr, 2.0, 5.6, 0.45, -T_WALL / 2, 52)
    render_patch(A, walls['back'].fr, 6.3, 4.8, 0.4, -T_WALL / 2, 53)
    return A.finalize()


def pyramid_roof(A, x0, x1, y0, y1, z_eave, rise, over=0.35, th=0.16, collide=True, key=''):
    """Four-sided tiled pyramid over a rectangle (outer faces), apex `rise` above
    the eave line at the walls."""
    P = A.P
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 + over, (y1 - y0) / 2 + over
    apex = V((cx, cy, z_eave + rise))
    k = rise / ((x1 - x0) / 2)
    zlow = z_eave - over * k
    corners = [V((cx - hx, cy - hy, zlow)), V((cx + hx, cy - hy, zlow)), V((cx + hx, cy + hy, zlow)),
               V((cx - hx, cy + hy, zlow))]
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        U = (b - a).normalized()
        mid = (a + b) / 2
        Vs = (apex - mid).normalized()
        Tn = U.cross(Vs)
        if Tn.dot(mid - V((cx, cy, mid.z))) < 0 and Tn.z < 0:
            Tn = -Tn
        if Tn.z < 0:
            Tn = -Tn
        fr = Frame(a, U, Vs, Tn)
        L = (b - a).length
        sl = (apex - mid).length
        bm = holey_slab(fr, 0.0, L, 0.0, sl, 0.0, th, (), top=[(0.0, 0.0), (L / 2, sl), (L, 0.0)], step=1.5,
                        vtop=False)
        A.add(bm, None, mats=[P['oak'], P['rooftile'], P['wood'], P['wood'], P['wood'], P['wood']],
              uv=frame_uv(a, U, Vs), key=key)
        # hip tiles
        A.add(bm_tube([a + Tn * th + V((0, 0, 0.02)), apex + V((0, 0, th + 0.02))], 0.09, sides=6), P['rooftile'],
              uv=frame_uv(a, (apex - a).normalized(), Tn), key=key, maxlen=1.2)
    if collide:
        bm = bmesh.new()
        vs = [bm.verts.new(c + V((0, 0, th))) for c in corners]
        va = bm.verts.new(apex + V((0, 0, th)))
        for i in range(4):
            bm.faces.new([vs[i], vs[(i + 1) % 4], va])
        bm.faces.new(list(reversed(vs)))
        A.col_tri(bm)
    return apex


def rose_window(A, c, r, face=-1, key=''):
    """Stone rose window with tracery on a wall plane (centre c, facing ±Y)."""
    P = A.P
    c = V(c)
    s = face

    def ring(r0, r1, d0, d1, n=16):
        pts = [(math.cos(TAU * k / n), math.sin(TAU * k / n)) for k in range(n)]
        bm = bmesh.new()
        outer0 = [bm.verts.new((c.x + r1 * x, c.y + s * d0, c.z + r1 * y)) for x, y in pts]
        outer1 = [bm.verts.new((c.x + r1 * x, c.y + s * d1, c.z + r1 * y)) for x, y in pts]
        inner0 = [bm.verts.new((c.x + r0 * x, c.y + s * d0, c.z + r0 * y)) for x, y in pts]
        inner1 = [bm.verts.new((c.x + r0 * x, c.y + s * d1, c.z + r0 * y)) for x, y in pts]
        for k in range(n):
            j = (k + 1) % n
            for q in ([outer1[k], outer1[j], inner1[j], inner1[k]], [outer0[k], outer0[j], outer1[j], outer1[k]],
                      [inner0[k], inner1[k], inner1[j], inner0[j]]):
                bm.faces.new(q)
        bm.normal_update()
        for f in bm.faces:
            fc = f.calc_center_median()
            out = V((fc.x - c.x, 0, fc.z - c.z))
            want = V((0, s, 0)) if abs(f.normal.y) > 0.7 else (out if (fc - c).length > (r0 + r1) / 2 else -out)
            if f.normal.dot(want) < 0:
                f.normal_flip()
        return bm
    A.add(ring(r * 0.86, r, 0.0, 0.1), P['sandstone'], key=key)
    A.add(ring(r * 0.2, r * 0.3, 0.0, 0.06), P['sandstone'], key=key)
    for k in range(8):
        a = TAU * k / 8
        p0 = c + V((math.cos(a) * r * 0.28, s * 0.03, math.sin(a) * r * 0.28))
        p1 = c + V((math.cos(a) * r * 0.87, s * 0.03, math.sin(a) * r * 0.87))
        A.add(beam(p0, p1, 0.06, 0.07, up=(0, 1, 0), bevel=0.0), P['sandstone'], key=key)
    disc = bm_lathe([(0, 0), (r * 0.9, 0), (0, 0.001)], segs=16, smooth=False)
    rot(disc, s * math.pi / 2, 'X')
    move(disc, c + V((0, -s * 0.01, 0)))
    A.add(disc, P['stained'], key=key)


def bell_bm(s=1.0):
    outer = [(0.4, 0.03), (0.44, 0.0), (0.45, 0.06), (0.39, 0.2), (0.31, 0.52), (0.29, 0.78), (0.24, 0.93),
             (0.14, 1.0), (0.0, 1.01)]
    bm = bm_lathe([(r * s, z * s) for r, z in outer], segs=16)
    inner = [(0.4, 0.03), (0.33, 0.25), (0.26, 0.6), (0.2, 0.86), (0.0, 0.9)]
    bi = bm_lathe([(r * s, z * s) for r, z in inner], segs=16)
    bmesh.ops.reverse_faces(bi, faces=bi.faces[:])
    return bm, bi


def buttress(A, x, y, sx, width=0.7, h1=3.4, h2=6.0, d1=0.85, d2=0.5):
    """Stepped stone buttress against a side wall face at x (sx: outward sign)."""
    P = A.P
    for (zb, zt, d) in ((ZB, h1, d1), (h1, h2, d2)):
        xa, xb = sorted((x, x + sx * d))
        A.add(box((xa, y - width / 2, zb), (xb, y + width / 2, zt), maxlen=1.0), P['stone'])
        A.col((xa, y - width / 2, zb), (xb, y + width / 2, zt))
        # sloped weathering cap
        cap = bm_prism([(0.0, 0.0), (d + 0.04, 0.0), (d + 0.04, 0.06), (0.0, 0.42)], -width / 2 - 0.03, width / 2 + 0.03)
        rot(cap, math.pi / 2, 'X')
        if sx < 0:
            rot(cap, math.pi, 'Z')
        move(cap, (x, y, zt))
        A.add(cap, P['sandstone'])


# ============================================================================
# B_Chapel  (10 x 18 nave, apse, 4 x 4 bell tower ~19 m at the front-left)
# ============================================================================
def build_chapel(P):
    A = Asset('B_Chapel', P)
    x0, x1, y0, y1 = -5.0, 5.0, -9.0, 9.0
    ze, pitch = 8.0, 30.0
    tp = math.tan(math.radians(pitch))
    ridge = ze + 5.0 * tp
    side_top = ze + T_WALL * tp
    win = lambda at: dict(kind='window', at=at, w=0.8, z0=4.4, z1=6.3, arch='round', shutters=False, sill=True,
                          surround='stone', glass='clear', sash=None)
    ops = {
        'front': [dict(kind='door', at=0.0, w=2.2, z0=F0, z1=3.4, arch='round', leaves=2, surround='stone')],
        'back': [dict(kind='arch', at=0.0, w=6.0, z0=F0, z1=4.6, arch='round', ring=True, ring_d=0.4)],
        'left': [dict(kind='panel', at=-2.5, w=4.0, z0=F0, z1=F0 + STOREY), win(-2.5), win(2.5), win(7.0)],
        'right': [win(-7.0), win(-2.5), win(2.5), win(7.0),
                  dict(kind='door', at=7.0, w=1.3, z0=F0, z1=2.8, arch='round', leaves=1, surround='stone')],
    }
    walls = rect_walls(A, x0, x1, y0, y1, side_top, ops, gables={'front': (ze, ridge), 'back': (ze, ridge)},
                       dado=(F0 + 1.3, DADO_OXBLOOD), step=2.3, bands=(0.35,))
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops))
    for (x, y, sx, sy) in ((x1, y0, 1, -1), (x1, y1, 1, 1), (x0, y1, -1, 1)):
        quoins(A, x, y, sx, sy, 0.66, ze - 0.1, P['sandstone'])
    gable_roof(A, x0, x1, y0, y1, ze, pitch, over=0.35, verge=0.35, axis='y', rafter_step=1.5)
    # rose window on the facade (both faces), a cornice line along the eaves
    rose_window(A, (0.0, y0, 6.4), 1.05, face=-1)
    rose_window(A, (0.0, y0 + T_WALL, 6.4), 1.0, face=1)
    for side, xx in (('l', x0), ('r', x1)):
        fr, L = wall_frame((xx, y0 - 0.02), (xx, y1 + 0.02)) if side == 'r' else wall_frame((xx, y1 + 0.02), (xx, y0 - 0.02))
        A.add(profile_run(fr, [(0.02, ze - 0.25), (-0.1, ze - 0.2), (-0.16, ze - 0.08), (-0.2, ze + 0.02),
                               (0.02, ze + 0.02)], 0.0, L), P['sandstone'])
    for y in (0.0, 5.0):
        buttress(A, x1, y, 1)
        buttress(A, x0, y, -1)
    buttress(A, x1, -5.0, 1)
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F0, thick=0.9, beams=False, collide=False)
    A.col((x0, y0, ZB), (x1, y1, F0))
    # diaphragm arches (pointed) carrying the roof
    for y in (-5.0, 0.0, 5.0):
        L = 9.2
        top = [(0.0, side_top - 0.02), (L / 2, ridge - 0.25), (L, side_top - 0.02)]
        dw = Wall(A, (-4.6, y), (4.6, y), side_top, [dict(kind='arch', u=L / 2, w=8.0, z0=F0, z1=3.3,
                                                         arch='pointed', ring=False)],
                  T=0.6, ext=P['sandstone'], inn=P['sandstone'], rev=P['sandstone'], ends=(False, False), zb=F0,
                  gable=top, step=2.4)
        for u in (0.6, L - 0.6):
            A.add(lbox(dw.fr, u - 0.12 if u < 1 else u - 0.08, u + 0.08 if u < 1 else u + 0.12, 3.1, 3.35, -0.42, 0.42,
                       bevel=0.02), P['sandstone'])
    # pews
    for y in (-7.6, -6.5, -4.1, -3.0, -1.9, -0.9 + 0.0, 1.2, 2.3, 3.4):
        if abs(y - 0.0) < 0.5 or abs(y + 5.0) < 0.5:
            continue
        for x in (-2.65, 2.65):
            pew(A, (x, y), 3.1)
    # apse: stepped platform, curved wall, painted semi-dome, half-cone roof
    for (ya, yb, zt) in ((8.0, 8.5, F0 + 0.22), (8.5, 9.0, F0 + 0.45)):
        A.add(box((-3.0, ya, F0 - 0.1), (3.0, yb + 0.02, zt), bevel=0.02, maxlen=1.5), P['sandstone'])
    A.ramp((0.0, 7.9, F0), (0.0, 9.0, F0 + 0.45), 6.0)
    za = F0 + 0.45
    R0, n = 3.6, 8
    pts = [V((R0 * math.cos(math.pi * k / n), y1 + R0 * math.sin(math.pi * k / n), 0)) for k in range(n + 1)]
    apse_top = 5.8
    for k in range(n):
        a, b = pts[k], pts[k + 1]
        d = (b - a).normalized()
        a2, b2 = a - d * 0.05, b + d * 0.05
        ops_a = []
        if k in (2, 4, 5):
            Lk = (b2 - a2).length
            ops_a = [dict(kind='window', u=Lk / 2, w=0.55, z0=2.4, z1=3.9, arch='round', shutters=False,
                          surround='stone', glass='clear')]
        w = Wall(A, a2[:2], b2[:2], apse_top, ops_a, ends=(False, False), dado=(za + 1.0, DADO_OXBLOOD), step=2.5,
                 bands=(0.35,))
        dress(A, w)
    # apse floor (polar grid)
    bm = bmesh.new()
    rings = [0.0, 1.3, 2.5, 3.45]
    segs = 16
    grid = []
    for r in rings:
        if r == 0:
            grid.append([bm.verts.new((0, y1, za))])
        else:
            grid.append([bm.verts.new((r * math.cos(math.pi * j / segs), y1 + r * math.sin(math.pi * j / segs), za))
                         for j in range(segs + 1)])
    for i in range(len(rings) - 1):
        for j in range(segs):
            if i == 0:
                q = [grid[0][0], grid[1][j], grid[1][j + 1]]
            else:
                q = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    A.add(bm, P['terracotta'])
    A.col((-3.6, y1, ZB), (3.6, y1 + 3.6, za))
    # semi-dome (interior, painted blue with gilt stars)
    zs, Rd, Hd = apse_top - 0.3, 3.4, 2.2
    bm = bmesh.new()
    NL, NT = 6, 14
    gv = [[bm.verts.new((Rd * math.cos(math.pi / 2 * i / NL) * math.cos(math.pi * j / NT),
                         y1 + Rd * math.cos(math.pi / 2 * i / NL) * math.sin(math.pi * j / NT),
                         zs + Hd * math.sin(math.pi / 2 * i / NL))) for j in range(NT + 1)] for i in range(NL + 1)]
    for i in range(NL):
        for j in range(NT):
            q = [gv[i][j], gv[i][j + 1], gv[i + 1][j + 1], gv[i + 1][j]]
            if i == NL - 1:
                q = [gv[i][j], gv[i][j + 1], gv[i + 1][j]]
            try:
                f = bm.faces.new(q)
            except ValueError:
                continue
            f.normal_update()
            cen = f.calc_center_median()
            if f.normal.dot(V((0, y1, zs)) - cen) < 0:
                f.normal_flip()
    set_smooth(bm, True)
    A.add(bm, P['plaster'], tint=(0.3, 0.42, 0.72))
    rng = random.Random(77)
    for k in range(34):
        th, ph = rng.uniform(0.1, math.pi - 0.1), rng.uniform(0.1, math.pi / 2 - 0.15)
        c = V((Rd * 0.98 * math.cos(ph) * math.cos(th), y1 + Rd * 0.98 * math.cos(ph) * math.sin(th),
               zs + Hd * 0.98 * math.sin(ph)))
        nrm = (V((0, y1, zs)) - c).normalized()
        star = obox(c, (0.07, 0.07, 0.005), nrm.to_track_quat('Z', 'Y').to_matrix())
        A.add(star, P['gilt'])
    # half-cone apse roof (tiles)
    bm = bmesh.new()
    rr = [4.15, 2.8, 1.4, 0.0]
    zz = [apse_top - 0.05 + (4.15 - r) * 0.9 for r in rr]
    gv = []
    for r, z in zip(rr, zz):
        gv.append([bm.verts.new((r * math.cos(math.pi * j / NT), y1 + r * math.sin(math.pi * j / NT), z))
                   for j in range(NT + 1)])
    for i in range(len(rr) - 1):
        for j in range(NT):
            q = [gv[i][j], gv[i][j + 1], gv[i + 1][j + 1], gv[i + 1][j]]
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    slope = math.atan2(zz[-1] - zz[0], rr[0])

    def cone_uv(co, n):
        d = co - V((0, y1, 0))
        r = math.hypot(d.x, d.y)
        return (math.atan2(d.y, d.x) * 4.15, (4.15 - r) / math.cos(slope))
    A.add(bm, P['rooftile'], uv=cone_uv)
    bm = bmesh.new()
    vs = [bm.verts.new((r * math.cos(math.pi * j / 6), y1 + r * math.sin(math.pi * j / 6), z + 0.1))
          for (r, z) in ((4.15, zz[0]),) for j in range(7)]
    va = bm.verts.new((0, y1, zz[-1] + 0.1))
    for j in range(6):
        bm.faces.new([vs[j], vs[j + 1], va])
    A.col_tri(bm)
    # altar, candles, mirror
    A.add(box((-1.1, 10.3, za), (1.1, 11.2, za + 0.95), bevel=0.02, maxlen=1.2), P['sandstone'])
    A.add(box((-1.25, 10.2, za + 0.95), (1.25, 11.3, za + 1.05), bevel=0.02, maxlen=1.2), P['marble'])
    A.col((-1.25, 10.2, za), (1.25, 11.3, za + 1.05))
    A.slot('Candle', (-0.75, 10.75, za + 1.05))
    A.slot('Candle', (0.75, 10.75, za + 1.05))
    A.slot('Mirror', (2.2, 10.0, za), math.pi * 0.8)
    A.slot('Clock', (-2.3, 7.4, F0), math.pi)
    A.slot('light', (0.0, 10.0, 4.2))
    A.slot('light', (0.0, 2.5, 6.0))
    A.slot('light', (0.0, -5.5, 6.0))
    A.slot('spawn', (0.0, -2.5, F0))
    A.slot('spawn', (0.0, 5.0, F0))
    # --- bell tower --------------------------------------------------------------
    tx0, tx1, ty0, ty1 = -9.0, -5.0, -9.0, -5.0
    ttop = 17.0
    bel = lambda at: dict(kind='arch', at=at, w=1.6, z0=14.3, z1=15.4, arch='round', ring=True, ring_d=0.22)
    slit = lambda at, z: dict(kind='window', at=at, w=0.28, z0=z, z1=z + 0.9, shutters=False, sill=False,
                              surround=None, glass=None, block=False)
    tops = {
        'front': [bel(-7.0), slit(-7.0, 5.6), slit(-7.0, 10.4)],
        'left': [dict(kind='door', at=-7.0, w=1.3, z0=F0, z1=2.7, arch='round', leaves=1, surround='stone'),
                 bel(-7.0), slit(-7.0, 8.0), slit(-7.0, 12.0)],
        'back': [bel(-7.0), slit(-7.0, 4.2), slit(-7.0, 9.4)],
        'right': [bel(-7.0)],
    }
    tw = rect_walls(A, tx0, tx1, ty0, ty1, ttop, tops, inn=P['stone'], step=3.0, bands=(0.35,))
    plinth(A, tx0, tx1, ty0, ty1, gaps=door_gaps(tops))
    all_quoins(A, tx0, tx1, ty0, ty1, 0.66, ttop - 0.3, bevel=0.0)
    A.add(rect_loop_profile(tx0, tx1, ty0, ty1, [(0.0, 13.6), (0.08, 13.65), (0.08, 13.8), (0.0, 13.85)]),
          P['sandstone'])
    cornice(A, tx0, tx1, ty0, ty1, ttop - 0.2, mat=P['sandstone'])
    apex = pyramid_roof(A, tx0, tx1, ty0, ty1, ttop, 2.3, over=0.35)
    A.add(box((apex.x - 0.03, apex.y - 0.03, apex.z + 0.1), (apex.x + 0.03, apex.y + 0.03, apex.z + 1.1)), P['iron'])
    A.add(box((apex.x - 0.25, apex.y - 0.025, apex.z + 0.72), (apex.x + 0.25, apex.y + 0.025, apex.z + 0.78)), P['iron'])
    floor_slab(A, tx0 + 0.4, tx1 - 0.4, ty0 + 0.4, ty1 - 0.4, F0, thick=0.9, beams=False, collide=False,
               top=P['stone'])
    A.col((tx0, ty0, ZB), (tx1, ty1, F0))
    # eleven stone flights around a well: corners C0..C3 counter-clockwise
    ix0, ix1, iy0, iy1 = tx0 + 0.4, tx1 - 0.4, ty0 + 0.4, ty1 - 0.4
    sw = 0.95
    runs = [((ix0 + sw, iy0 + sw / 2), (1, 0)), ((ix1 - sw / 2, iy0 + sw), (0, 1)),
            ((ix1 - sw, iy1 - sw / 2), (-1, 0)), ((ix0 + sw / 2, iy1 - sw), (0, -1))]
    corner = [(ix0, iy0), (ix1 - sw, iy0), (ix1 - sw, iy1 - sw), (ix0, iy1 - sw)]
    run_len = (ix1 - ix0) - 2 * sw
    zc = F0
    for k in range(11):
        S, d = runs[k % 4]
        stair(A, S, d, sw, zc, zc + 1.2, run_len, kind='slab', mat=P['stone'], body=P['plaster'])
        zc += 1.2
        if k < 10:
            cx, cy = corner[(k + 1) % 4]
            A.add(box((cx, cy, zc - 0.25), (cx + sw, cy + sw, zc), bevel=0.01), P['stone'])
            A.col((cx, cy, zc - 0.25), (cx + sw, cy + sw, zc))
    zb_ = zc                         # 13.5: belfry floor
    floor_slab(A, ix0, ix1, iy0, iy1, zb_, thick=0.25, holes=[(ix0 + sw, ix1, iy0 + sw, iy1)], beams=False,
               top=P['stone'], ceil=P['plaster'])
    railing(A, (ix0 + sw, iy0 + sw), (ix1, iy0 + sw), zb_, h=0.95)
    railing(A, (ix0 + sw, iy0 + sw), (ix0 + sw, iy1 - sw), zb_, h=0.95)
    A.slot('scrap', (ix0 + 0.45, iy0 + 0.45, zb_))
    A.slot('light', (-7.0, -7.0, zb_ - 3.0))
    # bell and its yoke (the bell is a separate child so the game can swing it)
    A.add(box((ix0 - 0.2, -7.1, 15.95), (ix1 + 0.2, -6.9, 16.2), bevel=0.012), P['oak'])
    A.col((ix0, -7.1, 15.95), (ix1, -6.9, 16.2))
    piv = V((-7.0, -7.0, 15.95))
    A.pivots['Bell'] = piv
    bo, bi = bell_bm(1.15)
    for bm_ in (bo, bi):
        move(bm_, piv + V((0, 0, -1.3)))
        A.add(bm_, P['bronze'], key='Bell')
    A.add(box((-7.18, -7.08, 15.62), (-6.82, -6.92, 15.95), bevel=0.01), P['oak'], key='Bell')
    A.add(bm_tube([piv + V((0, 0, -0.35)), piv + V((0, 0, -1.05))], 0.02, sides=6), P['iron'], key='Bell')
    A.add(bm_ico(0.07, 1, piv + V((0, 0, -1.1))), P['iron'], key='Bell')
    render_patch(A, walls['right'].fr, 3.0, 1.0, 0.5, -T_WALL / 2, 71)
    render_patch(A, walls['back'].fr, 1.5, 2.2, 0.5, -T_WALL / 2, 72)
    render_patch(A, tw['front'].fr, 3.0, 7.5, 0.45, -T_WALL / 2, 73)
    return A.finalize()


def hip_roof(A, x0, x1, y0, y1, z_eave, pitch_deg, over=0.5, th=0.2, collide=True, key=''):
    """Hipped tiled roof over a rectangle (outer faces), ridge along the long axis."""
    P = A.P
    tp = math.tan(math.radians(pitch_deg))
    cosp = math.cos(math.radians(pitch_deg))
    X0, X1, Y0, Y1 = x0 - over, x1 + over, y0 - over, y1 + over
    run = min(X1 - X0, Y1 - Y0) / 2
    zl = z_eave - over * tp
    zr = zl + run * tp
    c = [V((X0, Y0, zl)), V((X1, Y0, zl)), V((X1, Y1, zl)), V((X0, Y1, zl))]
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        U = (b - a).normalized()
        inward = V((-U.y, U.x, 0))
        Vs = (inward * cosp + V((0, 0, math.sin(math.radians(pitch_deg))))).normalized()
        Tn = U.cross(Vs)
        if Tn.z < 0:
            Tn = -Tn
        fr = Frame(a, U, Vs, Tn)
        L = (b - a).length
        sl = run / cosp
        topl = [(0.0, 0.0), (run, sl), (L - run, sl), (L, 0.0)] if L - 2 * run > 1e-3 else [(0.0, 0.0), (L / 2, sl),
                                                                                             (L, 0.0)]
        bm = holey_slab(fr, 0.0, L, 0.0, sl, 0.0, th, (), top=topl, step=1.6, vtop=False)
        A.add(bm, None, mats=[P['oak'], P['rooftile'], P['wood'], P['wood'], P['wood'], P['wood']],
              uv=frame_uv(a, U, Vs), key=key)
        tile_caps(A, a[:2], b[:2], lambda p, a=a, inward=inward: zl + th / cosp + (V((p.x, p.y, 0)) - V((a.x, a.y, 0))).dot(inward) * tp,
                  down=-inward)
    r0 = V((X0 + run, (Y0 + Y1) / 2, zr + th / cosp)) if X1 - X0 >= Y1 - Y0 else V(((X0 + X1) / 2, Y0 + run, zr + th / cosp))
    r1 = V((X1 - run, (Y0 + Y1) / 2, zr + th / cosp)) if X1 - X0 >= Y1 - Y0 else V(((X0 + X1) / 2, Y1 - run, zr + th / cosp))
    A.add(bm_tube([r0, r1], 0.13, sides=6), P['rooftile'], uv=frame_uv(r0, (r1 - r0).normalized(), V((0, 0, 1))),
          key=key, maxlen=1.5)
    for i, cc in enumerate(c):
        tgt = r0 if (cc - r0).length < (cc - r1).length else r1
        A.add(bm_tube([cc + V((0, 0, th / cosp)), tgt], 0.1, sides=5), P['rooftile'],
              uv=frame_uv(cc, (tgt - cc).normalized(), V((0, 0, 1))), key=key, maxlen=1.5)
    if collide:
        bm = bmesh.new()
        vs = [bm.verts.new(q + V((0, 0, th / cosp))) for q in c]
        ra, rb = bm.verts.new(r0), bm.verts.new(r1)
        if X1 - X0 >= Y1 - Y0:
            bm.faces.new([vs[0], vs[1], rb, ra])
            bm.faces.new([vs[2], vs[3], ra, rb])
            bm.faces.new([vs[1], vs[2], rb])
            bm.faces.new([vs[3], vs[0], ra])
        else:
            bm.faces.new([vs[1], vs[2], rb, ra])
            bm.faces.new([vs[3], vs[0], ra, rb])
            bm.faces.new([vs[0], vs[1], ra])
            bm.faces.new([vs[2], vs[3], rb])
        A.col_tri(bm)
    return zr


def book_fill(A, rng):
    P = A.P
    if rng.random() < 0.15:
        return None
    w = rng.uniform(0.04, 0.08)
    h = rng.uniform(0.2, 0.3)
    col = rng.choice([P['signpaint'], P['hullred'], P['oak'], P['paintochre'], P['ink']])
    return box((-w / 2, -0.1, 0), (w / 2, 0.1, h)), col, w


def stove(A, c, z=F0, top=4.2):
    P = A.P
    body = bm_lathe([(0, 0), (0.28, 0), (0.3, 0.1), (0.26, 0.2), (0.28, 0.8), (0.3, 0.86), (0.18, 0.95),
                     (0.0, 0.97)], segs=12)
    A.add(placed(body, c, 0, z), P['iron'])
    A.add(bm_tube([(c[0], c[1], z + 0.95), (c[0], c[1], top)], 0.07, sides=8), P['iron'], maxlen=1.2)
    A.col((c[0] - 0.3, c[1] - 0.3, z), (c[0] + 0.3, c[1] + 0.3, z + 0.97))


# ============================================================================
# B_Station  (16 x 6: waiting room, ticket office, the 6:40 clock)
# ============================================================================
def build_station(P):
    A = Asset('B_Station', P)
    x0, x1, y0, y1 = -8.0, 8.0, -3.0, 3.0
    ze, pitch = 4.6, 25.0
    tp = math.tan(math.radians(pitch))
    top = ze + T_WALL * tp
    seg = lambda at, w=1.1: dict(kind='window', at=at, w=w, z0=1.05, z1=3.2, arch='seg', rise=0.28, surround='stone',
                                 glass='clear', shutters=False)
    ops = {
        'front': [dict(kind='door', at=0.0, w=2.0, z0=F0, z1=3.05, arch='seg', rise=0.3, leaves=2, glazed=True,
                       exterior=False, surround=None),
                  seg(-4.4), seg(4.4), seg(-6.6, 0.9), seg(6.6, 0.9)],
        'back': [dict(kind='door', at=-4.5, w=1.5, z0=F0, z1=3.0, leaves=2, glazed=True, surround='stone'),
                 dict(kind='panel', at=-0.2, w=4.0, z0=F0, z1=F0 + STOREY),
                 dict(kind='door', at=5.6, w=1.3, z0=F0, z1=2.9, leaves=1, surround='stone'),
                 seg(2.6, 0.9)],
        'left': [seg(0.0, 1.2)],
        'right': [seg(0.0, 1.2)],
    }
    walls = rect_walls(A, x0, x1, y0, y1, top, ops, dado=(F0 + 1.2, DADO_BLUE), step=1.8, bands=(0.2, 0.6))
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops) + [('front', -2.7, 2.7)])
    all_quoins(A, x0, x1, y0, y1, 0.66, ze - 0.1)
    cornice(A, x0, x1, y0, y1, ze - 0.24)
    hip_roof(A, x0, x1, y0, y1, ze, pitch, over=0.35)
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, F0, thick=0.9, beams=False, collide=False)
    A.col((x0, y0, ZB), (x1, y1, F0))
    floor_slab(A, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, ze + 0.05, thick=0.3, beam_axis='y', beam_step=1.3,
               top=P['plaster'])
    # the central pavilion: projects 0.5 m, carries a curved pediment with the clock
    pz = ze + 2.7
    arc = [(u, ze + 0.35 + 2.3 * math.sin(math.pi * u / 5.2) ** 0.8) for u in [5.2 * k / 10 for k in range(11)]]
    pav = Wall(A, (-2.6, y0 - 0.25), (2.6, y0 - 0.25), pz,
               [dict(kind='door', u=2.6, w=2.0, z0=F0, z1=3.05, arch='seg', rise=0.3, leaves=0, surround='stone')],
               T=0.5, ends=(True, True), gable=arc, step=1.6)
    dress(A, pav)
    pfr = pav.fr
    for (u0, u1, z0, z1) in ((-0.05, 0.25, ZB, 0.6), (4.95, 5.25, ZB, 0.6)):
        A.add(lbox(pfr, u0, u1, z0, z1, -0.33, 0.1, bevel=0.02), P['stone'])
    for u in (0.12, 5.08):
        A.add(lbox(pfr, u - 0.16, u + 0.16, 0.6, ze - 0.2, -0.3, -0.24, bevel=0.012, maxlen=1.0), P['sandstone'])
    # pediment coping following the curve
    for (ua, za), (ub, zb) in zip(arc, arc[1:]):
        A.add(beam(pfr(ua, za + 0.06, 0.0), pfr(ub, zb + 0.06, 0.0), 0.62, 0.12, bevel=0.0), P['sandstone'])
    wall_clock(A, pfr(2.6, ze + 1.35, -0.25), 0.62, (0, -1), hands=(6, 40), depth=0.1)
    A.add(lbox(pfr, 0.6, 4.6, 3.45, 4.05, -0.3, -0.25, bevel=0.01), P['signpaint'])
    A.add(text_mesh('PORT LLIGAT', 0.36, pfr(2.6, 3.75, -0.31), depth=0.015), P['gilt'])
    # iron and glass marquee over the door
    for u in (1.1, 4.1):
        A.add(beam(pfr(u, 3.3, -0.25), pfr(u, 3.65, -1.45), 0.05, 0.08), P['iron'])
    A.add(lbox(pfr, 0.9, 4.3, 3.62, 3.68, -1.5, -0.25), P['glassdark'])
    A.add(lbox(pfr, 0.9, 4.3, 3.56, 3.62, -1.52, -1.44), P['iron'])
    A.col_frame(pfr, 0.9, 4.3, 3.56, 3.7, -1.52, -0.25)
    # partition between the waiting room and the ticket office (door + ticket hatch)
    pw = Wall(A, (3.4, -2.6), (3.4, 2.6), ze - 0.25,
              [dict(kind='door', u=1.25, w=1.3, z0=F0, z1=2.75, exterior=False, surround='oak', leaves=1),
               dict(kind='window', u=3.6, w=0.7, z0=1.15, z1=1.75, shutters=False, sill=False, surround='oak',
                    grille=True, glass=None, block=True)],
              T=0.4, ext=P['plaster'], inn=P['plaster'], ends=(False, False), zb=F0, dado=(F0 + 1.2, DADO_BLUE),
              both=True)
    dress(A, pw)
    A.add(box((2.85, 0.55, 1.1), (3.2, 1.45, 1.15), bevel=0.01), P['oak'])
    # waiting room
    for (c, r, L) in (((-5.8, 2.28), 0.0, 3.0), ((-1.2, 2.28), math.pi * 0, 0.0), ((-7.28, -0.3), -math.pi / 2, 2.6),
                      ((-3.0, -0.6), 0.0, 2.6), ((-3.0, -1.1), math.pi, 2.6)):
        if L:
            bench(A, c, L, rz=r, back=True)
    A.slot('BowlerHat', (-3.4, -0.6, F0 + 0.47))
    stove(A, (0.6, 1.9), top=ze - 0.25)
    A.add(box((-2.4, y0 + 0.4, 1.5), (-0.9, y0 + 0.44, 2.4), bevel=0.01), P['oak'])
    A.add(box((-2.3, y0 + 0.44, 1.6), (-1.0, y0 + 0.45, 2.3)), P['cloth'])
    A.slot('light', (-3.0, 0.0, ze - 0.8))
    A.slot('spawn', (-5.5, 0.5, F0))
    A.slot('spawn', (1.2, -1.2, F0))
    # ticket office
    A.add(box((3.6, 0.2, F0), (4.25, 2.0, 1.1), bevel=0.012, maxlen=1.0), P['oak'])
    A.add(box((3.6, 0.15, 1.1), (4.35, 2.05, 1.15), bevel=0.01), P['oak'])
    A.col((3.6, 0.2, F0), (4.35, 2.05, 1.15))
    zd = table(A, (6.3, 1.9), 1.4, 0.7)
    chair(A, (6.3, 1.2), 0.0)
    shelf(A, (7.41, -1.0), 2.0, 0.36, 2.4, 5, rz=-math.pi / 2, fill=book_fill, rng=random.Random(61), col=True)
    A.add(box((4.0, -2.55, F0), (4.7, -1.95, F0 + 0.8), bevel=0.02), P['iron'])
    A.col((4.0, -2.55, F0), (4.7, -1.95, F0 + 0.8))
    wall_clock(A, (5.8, y1 - 0.4, 2.6), 0.25, (0, -1), hands=(6, 40), depth=0.05)
    A.slot('Clock', (6.8, 1.9, zd), math.pi)
    A.slot('Drawers', (4.6, 2.2, F0), math.pi)
    A.slot('light', (5.6, 0.0, ze - 0.8))
    render_patch(A, walls['left'].fr, 1.0, 1.0, 0.45, -T_WALL / 2, 81)
    render_patch(A, walls['back'].fr, 13.5, 1.2, 0.5, -T_WALL / 2, 82)
    return A.finalize()


# ============================================================================
# B_StationPlatform  (30 x 5 x 1, canopy on cast-iron columns)
# ============================================================================
def iron_column(A, c, z0, z1):
    P = A.P
    h = z1 - z0
    prof = [(0.0, 0.0), (0.19, 0.0), (0.19, 0.12), (0.13, 0.18), (0.1, 0.3), (0.085, h * 0.6), (0.075, h - 0.35),
            (0.09, h - 0.3), (0.16, h - 0.12), (0.2, h - 0.08), (0.2, h), (0.0, h)]
    A.add(placed(bm_lathe(prof, segs=8), c, 0, z0), P['iron'], uv=cyl_uv((c[0], c[1], z0)))
    A.col((c[0] - 0.12, c[1] - 0.12, z0), (c[0] + 0.12, c[1] + 0.12, z1))


def build_platform(P):
    A = Asset('B_StationPlatform', P)
    X0, X1, Y0, Y1, H = -15.0, 15.0, -2.5, 2.5, 1.0
    fr = Frame((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    body = holey_slab(Frame((X0, Y0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)), 0.0, X1 - X0, ZB, H - 0.1, 0.0, Y1 - Y0 - 0.3,
                      (), step=2.0, vbot=False, faces=('neg', 'pos', 'end'))
    A.add(body, None, mats=[P['sandstone']] * 6)
    A.add(holey_slab(fr, X0, X1, Y0, Y1 - 0.3, H - 0.1, H, (), step=2.0, vbot=False, faces=('pos', 'end', 'top', 'bot')),
          None, mats=[P['stone']] * 6)
    A.add(box((X0 - 0.02, Y1 - 0.35, H - 0.14), (X1 + 0.02, Y1 + 0.1, H + 0.02), bevel=0.02, maxlen=1.5), P['sandstone'])
    A.add(box((X0, Y1 - 0.75, H + 0.0), (X1, Y1 - 0.62, H + 0.004), maxlen=2.0), plain('SafetyPaint', '#e8e0c8', 0, 0.7))
    A.col((X0, Y0, ZB), (X1, Y1 + 0.1, H))
    # west ramp, east steps, two short flights toward the station
    rfr, _ = wall_frame((X0 - 2.6, 0.5), (X0, 0.5))
    ramp_body = holey_slab(Frame((X0 - 2.6, -2.5, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)), 0.0, 2.6, ZB, H, 0.0, 3.0, (),
                           top=[(0.0, 0.02), (2.6, H)], vbot=False, step=1.0)
    A.add(ramp_body, None, mats=[P['sandstone'], P['sandstone'], P['sandstone'], P['stone'], P['stone'], P['sandstone']],)
    A.ramp((X0 - 2.7, -1.0, -0.02), (X0 + 0.05, -1.0, H), 3.0)
    stair(A, (X1 + 1.5, -1.2), (-1, 0), 2.0, 0.0, H, 1.5, kind='stone')
    for x in (-4.5, 5.5):
        stair(A, (x, Y0 - 1.4), (0, 1), 1.6, 0.0, H, 1.4, kind='stone')
    # canopy on cast-iron columns
    zc0, zc1 = 4.35, 4.8
    for x in (-12.5, -7.5, -2.5, 2.5, 7.5, 12.5):
        iron_column(A, (x, -0.6), H, zc0 - 0.15)
        A.add(beam((x, -2.45, zc0 - 0.12), (x, Y1 - 0.2, zc1 - 0.12), 0.08, 0.2, bevel=0.0), P['iron'])
        for s in (-1, 1):
            A.add(beam((x, -0.6, zc0 - 1.0), (x, -0.6 + s * 1.3, lerp(zc0, zc1, (s * 1.3 + 1.9) / 4.7) - 0.2), 0.05,
                       0.07, bevel=0.0), P['iron'])
    A.add(beam((X0 + 0.5, -0.6, zc0 - 0.1), (X1 - 0.5, -0.6, lerp(zc0, zc1, 1.9 / 4.7) - 0.1), 0.1, 0.18, bevel=0.0,
               maxlen=2.0), P['iron'])
    slope = V((0, 4.7, zc1 - zc0)).normalized()
    cfr = Frame((X0 + 0.3, -2.5, zc0), (1, 0, 0), slope, V((0, 0, 1)).cross(V((1, 0, 0))).cross(slope) * -1)
    cfr.T = V((1, 0, 0)).cross(slope)
    cl = V((0, 4.7, zc1 - zc0)).length
    A.add(holey_slab(cfr, 0.0, X1 - X0 - 0.6, 0.0, cl, 0.0, 0.08, (), step=2.5),
          None, mats=[P['wood'], P['iron'], P['wood'], P['wood'], P['wood'], P['wood']],
          uv=frame_uv(cfr.O, cfr.U, cfr.V))
    A.ramp(cfr((X1 - X0 - 0.6) / 2, 0.0, 0.08), cfr((X1 - X0 - 0.6) / 2, cl, 0.08), X1 - X0 - 0.6, thick=0.2, ext=0.0)
    # dagger-board valance along the track edge
    teeth = []
    n = int((X1 - X0 - 0.6) / 0.22)
    for k in range(n + 1):
        u = (X1 - X0 - 0.6) * k / n
        teeth.append((u, 0.42 if k % 2 == 0 else 0.26))
    vfr = Frame(V((X0 + 0.3, 2.18 + 0.01, zc1 + 0.02)), (1, 0, 0), (0, 0, -1), (0, 1, 0))
    A.add(holey_slab(vfr, 0.0, X1 - X0 - 0.6, 0.0, 0.42, 0.0, 0.025, (), top=teeth, step=3.0, vbot=False),
          None, mats=[P['wood']] * 6)
    # hanging double clock at 6:40 and the station name board
    A.add(box((-0.03, 0.4, zc0 - 0.55), (0.03, 0.46, zc0 + 0.25)), P['iron'])
    for s in (-1, 1):
        wall_clock(A, (0.0, 0.43 + s * 0.05, zc0 - 0.95), 0.4, (0, s), hands=(6, 40), depth=0.045)
    for x in (-9.6, -7.4):
        A.add(box((x - 0.04, -2.15, H), (x + 0.04, -2.07, H + 2.9)), P['iron'])
        A.col((x - 0.05, -2.16, H), (x + 0.05, -2.06, H + 2.9))
    A.add(box((-9.9, -2.16, H + 2.25), (-7.1, -2.06, H + 2.75), bevel=0.01), P['signpaint'])
    A.add(text_mesh('PORT LLIGAT', 0.3, (-8.5, -2.175, H + 2.5), depth=0.01), P['gilt'])
    A.add(text_mesh('PORT LLIGAT', 0.3, (-8.5, -2.045, H + 2.5), depth=0.01, face=1), P['gilt'])
    for x in (-11.0, 0.0, 9.0):
        bench(A, (x, -1.75), 2.2, rz=0.0, z=H, back=True)
    A.slot('BowlerHat', (0.4, -1.75, H + 0.47))
    for (x, y, s) in ((4.8, -1.2, (0.9, 0.55, 0.5)), (5.5, -1.3, (0.6, 0.45, 0.38)), (-5.3, 1.0, (0.7, 0.5, 0.45))):
        A.add(box((x - s[0] / 2, y - s[1] / 2, H), (x + s[0] / 2, y + s[1] / 2, H + s[2]), bevel=0.03), P['oak'])
        A.add(box((x - s[0] / 2 - 0.005, y - s[1] / 2 - 0.005, H + s[2] * 0.3), (x + s[0] / 2 + 0.005, y + s[1] / 2 + 0.005,
                                                                                H + s[2] * 0.3 + 0.04)), P['iron'])
        A.col((x - s[0] / 2, y - s[1] / 2, H), (x + s[0] / 2, y + s[1] / 2, H + s[2]))
    for x in (-13.8, 13.8):
        A.add(placed(bm_lathe([(0, 0), (0.12, 0), (0.05, 0.12), (0.04, 2.6), (0.0, 2.6)], segs=8), (x, -2.0), 0, H),
              P['iron'])
        lantern(A, (x, -2.0, H + 2.6))
        A.col((x - 0.1, -2.1, H), (x + 0.1, -1.9, H + 3.0))
    A.slot('light', (-7.5, 0.0, zc0 - 0.6))
    A.slot('light', (7.5, 0.0, zc0 - 0.6))
    A.slot('scrap', (12.5, 1.2, zc1 + 0.1))
    A.slot('spawn', (-3.0, 0.5, H))
    A.slot('spawn', (10.0, 0.5, H))
    return A.finalize()


# ============================================================================
# B_Tower  (6 x 6 ruined watchtower, half buried, leaning)
# ============================================================================
def cell_wall(A, fr, L, z0, z1, T, solid, cw=0.46, ch=0.34, mat=None, inmat=None, maxrun=1.35, ends=(True, True),
              colcell=(0.46 * 2, 0.34 * 2)):
    """Masonry of staggered cells; solid(u, z) decides which stones remain.
    Returns nothing; adds mesh + box colliders (greedy-merged coarse mask)."""
    P = A.P
    mat = mat or P['stone']
    inmat = inmat or mat
    NR = int(math.ceil((z1 - z0) / ch))
    rows = []
    for r in range(NR):
        za, zb = z0 + r * ch, min(z1, z0 + (r + 1) * ch)
        off = (r % 2) * cw / 2
        bounds = [0.0] + [off + k * cw for k in range(1, int(L / cw) + 2) if 0.05 < off + k * cw < L - 0.05] + [L]
        cells = [(bounds[k], bounds[k + 1]) for k in range(len(bounds) - 1)]
        rows.append((za, zb, [(ua, ub, solid((ua + ub) / 2, (za + zb) / 2)) for ua, ub in cells]))
    bm = bmesh.new()
    cache = {}

    def vert(u, v, t):
        k = (round(u, 4), round(v, 4), round(t, 4))
        if k not in cache:
            cache[k] = bm.verts.new(fr(u, v, t))
        return cache[k]

    def face(pts, want, mi):
        vs = [vert(*p) for p in pts]
        if len(set(vs)) < 3:
            return
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
        f.material_index = mi
        f.smooth = False
    t0, t1 = -T / 2, T / 2
    for r, (za, zb, cells) in enumerate(rows):
        # front/back runs
        k = 0
        while k < len(cells):
            if not cells[k][2]:
                k += 1
                continue
            s = k
            while k + 1 < len(cells) and cells[k + 1][2]:
                k += 1
            ua, ub = cells[s][0], cells[k][1]
            n = max(1, int(math.ceil((ub - ua) / maxrun)))
            for i in range(n):
                a, b = ua + (ub - ua) * i / n, ua + (ub - ua) * (i + 1) / n
                face([(a, za, t0), (b, za, t0), (b, zb, t0), (a, zb, t0)], -fr.T, 0)
                face([(a, za, t1), (b, za, t1), (b, zb, t1), (a, zb, t1)], fr.T, 1)
            k += 1
        # side reveals
        for i, (ua, ub, sol) in enumerate(cells):
            if not sol:
                continue
            if (i == 0 and ends[0]) or (i > 0 and not cells[i - 1][2]):
                face([(ua, za, t0), (ua, zb, t0), (ua, zb, t1), (ua, za, t1)], -fr.U, 2)
            if (i == len(cells) - 1 and ends[1]) or (i < len(cells) - 1 and not cells[i + 1][2]):
                face([(ub, za, t0), (ub, zb, t0), (ub, zb, t1), (ub, za, t1)], fr.U, 2)
        # top / bottom against empty cells of the neighbouring rows
        for nb, zz, want in ((r + 1, zb, fr.V), (r - 1, za, -fr.V)):
            for (ua, ub, sol) in cells:
                if not sol:
                    continue
                if nb < 0:
                    continue
                if nb >= len(rows):
                    face([(ua, zz, t0), (ub, zz, t0), (ub, zz, t1), (ua, zz, t1)], want, 2)
                    continue
                for (va, vb, s2) in rows[nb][2]:
                    lo, hi = max(ua, va), min(ub, vb)
                    if hi - lo > 1e-4 and not s2:
                        face([(lo, zz, t0), (hi, zz, t0), (hi, zz, t1), (lo, zz, t1)], want, 2)
    A.add(bm, None, mats=[mat, inmat, mat])
    # colliders: coarse occupancy grid, greedy rectangles
    cu, cz = colcell
    nu, nz = max(1, int(round(L / cu))), max(1, int(math.ceil((z1 - z0) / cz)))
    du, dz = L / nu, (z1 - z0) / nz
    occ = [[False] * nu for _ in range(nz)]
    for j in range(nz):
        for i in range(nu):
            hits = 0
            tot = 0
            for a in (0.25, 0.75):
                for b in (0.25, 0.75):
                    tot += 1
                    hits += solid(du * (i + a), z0 + dz * (j + b))
            occ[j][i] = hits >= 3
    used = [[False] * nu for _ in range(nz)]
    for j in range(nz):
        for i in range(nu):
            if not occ[j][i] or used[j][i]:
                continue
            i2 = i
            while i2 + 1 < nu and occ[j][i2 + 1] and not used[j][i2 + 1]:
                i2 += 1
            j2 = j
            while j2 + 1 < nz and all(occ[j2 + 1][q] and not used[j2 + 1][q] for q in range(i, i2 + 1)):
                j2 += 1
            for jj in range(j, j2 + 1):
                for q in range(i, i2 + 1):
                    used[jj][q] = True
            A.col_frame(fr, du * i, du * (i2 + 1), z0 + dz * j, z0 + dz * (j2 + 1), t0, t1)


def build_tower(P):
    A = Asset('B_Tower', P, budget=30000)
    A.lean = Matrix.Rotation(math.radians(3.0), 4, 'X') @ Matrix.Rotation(math.radians(-1.6), 4, 'Y')
    A.ao_dist = 4.0
    T = 0.7
    h = T / 2
    zb = -4.0
    rng = random.Random(1958)
    noise_off = V((rng.uniform(0, 50), rng.uniform(0, 50), 0))

    def blob(u, z, cu, cz, ru, rz, amp=0.18, seed=0.0):
        d = math.hypot((u - cu) / ru, (z - cz) / rz)
        n = noise.noise(V((u * 1.7 + seed, z * 1.7, seed * 3.1)) + noise_off)
        return d < 1.0 + amp * n

    def make_solid(top_fn, holes):
        def f(u, z):
            if z > top_fn(u):
                return False
            for hh in holes:
                if blob(u, z, *hh):
                    return False
            return True
        return f

    def ragged(base, amp, freq, seed, dips=()):
        def f(u):
            v = base + amp * noise.noise(V((u * freq + seed, seed * 1.3, 0.5)) + noise_off)
            v += 0.35 * noise.noise(V((u * 3.1 + seed, 2.2, seed)) + noise_off)
            for (c, w, d) in dips:
                v -= d * max(0.0, 1.0 - abs(u - c) / w)
            return v
        return f
    walls = {
        'front': (((-3.0, -3.0 + h), (3.0, -3.0 + h)), 6.0, (True, True),
                  ragged(12.6, 1.1, 0.7, 1.0, dips=((4.6, 1.8, 2.2),)),
                  [(3.0, 1.05, 1.05, 1.7, 0.2, 1.0), (3.0, 6.2, 0.14, 0.55, 0.05, 2.0), (4.7, 9.4, 0.7, 0.8, 0.25, 3.0)]),
        'right': (((3.0 - h, -3.0 + T), (3.0 - h, 3.0 - T)), 6.0 - 2 * T, (False, False),
                  ragged(11.8, 1.0, 0.8, 5.0), [(2.3, 8.4, 1.1, 1.5, 0.25, 4.0), (1.0, 3.2, 0.13, 0.5, 0.05, 5.0)]),
        'back': (((3.0, 3.0 - h), (-3.0, 3.0 - h)), 6.0, (True, True),
                 ragged(12.2, 1.4, 0.6, 9.0, dips=((4.8, 2.2, 2.6),)),
                 [(3.0, 5.35, 0.55, 1.05, 0.05, 6.0), (1.4, 10.2, 0.5, 0.6, 0.2, 7.0)]),
        'left': (((-3.0 + h, 3.0 - T), (-3.0 + h, -3.0 + T)), 6.0 - 2 * T, (False, False),
                 ragged(13.1, 0.9, 0.9, 13.0), [(2.3, 3.4, 0.13, 0.5, 0.05, 8.0), (2.3, 7.6, 0.13, 0.5, 0.05, 9.0),
                                                (1.2, 5.6, 0.45, 0.4, 0.2, 10.0)]),
    }
    frames = {}
    for side, ((p0, p1), L, ends, top_fn, holes) in walls.items():
        fr, _ = wall_frame(p0, p1)
        frames[side] = (fr, L)
        cell_wall(A, fr, L, zb, 14.6, T, make_solid(top_fn, holes), ends=ends)
    # battered plinth course and a broken string course
    A.add(rect_loop_profile(-3.0, 3.0, -3.0, 3.0, [(0.35, zb), (0.35, -0.2), (0.12, 0.35), (0.0, 0.5)], segs=1.2),
          P['stone'])
    # interior: rubble floor, stairs, broken floors, beams, a top ledge
    ix0, ix1, iy0, iy1 = -3.0 + T, 3.0 - T, -3.0 + T, 3.0 - T
    A.add(box((ix0, iy0, zb + 3.6), (ix1, iy1, 0.1), maxlen=1.2), P['stone'])
    A.col((ix0, iy0, zb + 3.6), (ix1, iy1, 0.1))
    rub = bm_ico(1.0, 2, (0.9, -0.9, 0.0), sc=(1.3, 1.1, 0.55))
    displace(rub, lambda co, n: co + n * 0.18 * noise.noise(co * 2.3 + noise_off))
    A.add(rub, P['stone'], tint=(0.8, 0.76, 0.7))
    rc = bm_ico(1.0, 1, (0.9, -0.9, 0.0), sc=(1.3, 1.1, 0.55))
    A.col_tri(rc)
    for k in range(9):
        c = V((rng.uniform(ix0 + 0.3, ix1 - 0.3), rng.uniform(iy0 + 0.3, iy1 - 0.3), 0.1))
        st = box((-0.2, -0.13, 0), (0.2, 0.13, 0.22), bevel=0.03)
        rot(st, rng.uniform(0, 3), 'Z')
        rot(st, rng.uniform(-0.3, 0.3), 'X')
        A.add(move(st, c), P['stone'])
    # flight A along the left wall (solid, built into the wall)
    stair(A, (ix0 + 0.5, -1.9), (0, 1), 1.0, 0.1, 2.9, 3.3, kind='stone', zb=-0.4, body=P['stone'])
    # platform 1: timber floor remnant with beams (right part)
    for y in (0.35, 1.15, 1.95):
        A.add(box((ix0 - 0.2, y - 0.11, 3.95), (ix1 + 0.2, y + 0.11, 4.2), bevel=0.012, maxlen=1.2), P['oak'])
    planks = [(-1.2, 2.3, 0.1, 2.3)]
    for (xa, xb, ya, yb) in planks:
        x = xa
        k = 0
        while x < xb - 0.05:
            w = 0.18
            ln = yb - ya - (0.0 if k % 3 else rng.uniform(0.2, 0.7))
            A.add(box((x, ya, 4.2), (x + w - 0.01, ya + ln, 4.25)), P['oak'])
            x += w
            k += 1
    A.col((-1.2, 0.1, 3.95), (ix1, iy1, 4.25))
    # flight B along the right wall, broken in the middle
    fb = Frame(V((ix1 - 0.5, 0.1, 0)), (0, -1, 0), (0, 0, 1), (1, 0, 0))
    run, z0b, z1b = 2.1, 4.25, 6.5
    g = run / 11
    for i in range(11):
        if i in (4, 5, 6):
            continue
        zt = z0b + (i + 1) * (z1b - z0b) / 11
        A.add(lbox(fb, i * g, (i + 1) * g, zt - 0.45, zt, -0.5, 0.5, bevel=0.015), P['stone'])
    A.ramp(fb(-0.1, z0b, 0.0), fb(4 * g, z0b + 4 * (z1b - z0b) / 11, 0.0), 1.0)
    A.ramp(fb(7 * g, z0b + 7 * (z1b - z0b) / 11, 0.0), fb(run, z1b, 0.0), 1.0)
    # platform 2: stone slab on corbels along the front wall
    A.add(box((ix0, iy0, 6.1), (1.3, iy0 + 1.0, 6.5), bevel=0.02, maxlen=1.0), P['stone'])
    A.col((ix0, iy0, 6.1), (ix1, iy0 + 1.0, 6.5))
    for x in (-1.6, -0.2, 1.0):
        cb = prism_yz([(0.0, 0.0), (0.7, 0.0), (0.7, -0.12), (0.0, -0.5)], x - 0.13, x + 0.13)
        move(cb, (0, iy0, 6.1))
        A.add(cb, P['stone'])
    # beams at 8.6 and flight C (cantilevered steps on the back wall)
    for x in (-0.6, 0.8):
        A.add(box((x - 0.12, iy0 - 0.25, 8.35), (x + 0.12, iy1 + 0.25, 8.6), bevel=0.012, maxlen=1.2), P['oak'])
        A.col((x - 0.12, iy0, 8.35), (x + 0.12, iy1, 8.6))
    fc = Frame(V((1.8, iy1 - 0.45, 0)), (-1, 0, 0), (0, 0, 1), (0, -1, 0))
    for i in range(12):
        if i == 7:
            continue
        zt = 8.9 + (i + 1) * 0.175
        A.add(lbox(fc, i * 0.25, (i + 1) * 0.25 - 0.02, zt - 0.22, zt, -0.45, 0.45, bevel=0.015), P['stone'])
    A.ramp(fc(-0.1, 8.9, 0.0), fc(3.0, 11.0, 0.0), 0.9)
    # top ledge (remains of the vault)
    A.add(box((ix0, -1.0, 10.5), (-1.2, iy1, 11.0), bevel=0.03, maxlen=1.0), P['stone'])
    A.col((ix0, -1.0, 10.5), (-1.2, iy1, 11.0))
    A.slot('scrap', (-1.75, 0.6, 11.0))
    A.slot('spawn', (-0.5, -0.8, 0.1))
    A.slot('light', (0.0, 0.0, 2.6))
    return A.finalize()


def boat(A, L=6.0, B=1.9, D=0.85, M=None, key='', col=True, NS=18, NQ=7, rib_step=2):
    """Catalan llaut: double-ended hull, painted (red bottom, white topsides,
    blue sheer band), oak inside with ribs, thwarts, stem post and rudder.
    Built along X centred at the origin with the keel at z = 0; M (4x4) places it."""
    P = A.P
    M = M or Matrix.Identity(4)
    xs = [-L / 2 + L * i / NS for i in range(NS + 1)]

    def half_beam(x):
        t = abs(2 * x / L)
        return max(0.0, (B / 2) * (1 - t ** 2.2) ** 0.75)

    def sheer(x):
        t = 2 * x / L
        return D + 0.22 * t * t + (0.12 * max(0.0, t) ** 3)

    def section(x, shrink=0.0):
        b = max(0.0, half_beam(x) - shrink)
        sh = sheer(x)
        pts = []
        for q in range(NQ + 1):
            t = q / NQ
            y = b * math.sin(t * math.pi / 2) ** 0.7
            z = shrink + (sh - shrink) * (1 - math.cos(t * math.pi / 2)) ** 1.15
            pts.append((y, z))
        return [(-y, z) for (y, z) in reversed(pts[1:])] + pts

    def surface(shrink, mats_by_z, inner=False):
        bm = bmesh.new()
        rings = [[bm.verts.new(M @ V((x, y, z))) for (y, z) in section(x, shrink)] for x in xs]
        for i in range(NS):
            for j in range(len(rings[0]) - 1):
                q = [rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]]
                if len(set(q)) < 4:
                    continue
                try:
                    f = bm.faces.new(q)
                except ValueError:
                    continue
                f.normal_update()
                c = f.calc_center_median()
                lc = M.inverted() @ c
                out = V((0, lc.y, lc.z - D * 0.8))
                out = M.to_3x3() @ out
                if (f.normal.dot(out) < 0) != inner:
                    f.normal_flip()
                f.material_index = mats_by_z(lc.x, lc.z)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        set_smooth(bm, True)
        return bm

    def paint(x, z):
        sh = sheer(x)
        if z < 0.3:
            return 0
        if z > sh - 0.16:
            return 2
        return 1
    A.add(surface(0.0, paint), None, mats=[P['hullred'], P['hull'], P['hullband']], key=key)
    A.add(surface(0.045, lambda x, z: 0, inner=True), None, mats=[P['oak']], key=key)
    # gunwale rails, ribs, thwarts, stem, rudder
    for s_ in (-1, 1):
        pts = [M @ V((x, s_ * half_beam(x), sheer(x) + 0.02)) for x in xs]
        A.add(bm_tube(pts, 0.035, sides=5), P['oak'], key=key)
    for i in range(2, NS - 1, rib_step):
        x = xs[i]
        sec = section(x, 0.035)
        A.add(bm_tube([M @ V((x, y, z)) for (y, z) in sec[1:-1]], 0.022, sides=4, caps=False), P['oak'], key=key)
    for x in (-L * 0.18, L * 0.12):
        b = half_beam(x) - 0.06
        A.add(obox(M @ V((x, 0, sheer(x) - 0.22)), (0.24, 2 * b, 0.04), M.to_3x3()), P['oak'], key=key)
    stem = [M @ V((L / 2 - 0.02, 0, z)) for z in (0.0, sheer(L / 2) + 0.15)]
    A.add(bm_tube(stem + [M @ V((L / 2 + 0.03, 0, sheer(L / 2) + 0.35))], 0.05, sides=5), P['oak'], key=key)
    A.add(obox(M @ V((-L / 2 - 0.12, 0, D * 0.45)), (0.3, 0.05, D * 0.9), M.to_3x3()), P['wood'], key=key)
    A.add(bm_tube([M @ V((-L * 0.05, 0, 0.1)), M @ V((-L * 0.05, 0, D + 0.6))], 0.06, sides=6), P['oak'], key=key)
    if col:
        A.col_obox(M @ V((0, 0, D * 0.5)), (L * 0.78, B * 0.85, D), M.to_3x3())
        for sx in (-1, 1):
            A.col_obox(M @ V((sx * L * 0.43, 0, D * 0.55)), (L * 0.12, B * 0.45, D * 0.9), M.to_3x3())


# ============================================================================
# B_Boathouse  (10 x 8, open arch to the beach, slipway, a llaut inside)
# ============================================================================
def build_boathouse(P):
    A = Asset('B_Boathouse', P)
    x0, x1, y0, y1 = -5.0, 5.0, -4.0, 4.0
    ze, pitch = 4.8, 26.0
    tp = math.tan(math.radians(pitch))
    ridge = ze + 5.0 * tp
    side_top = ze + T_WALL * tp
    ops = {
        'front': [dict(kind='arch', at=0.0, w=6.4, z0=-0.35, z1=2.9, arch='seg', rise=1.3, ring=True, ring_d=0.45)],
        'back': [dict(kind='door', at=3.3, w=1.3, z0=F0, z1=2.7, leaves=1, surround='stone'),
                 dict(kind='window', at=-2.2, w=0.9, z0=1.8, z1=2.8, glass=None, grille=True)],
        'left': [dict(kind='window', at=-2.0, w=0.8, z0=1.6, z1=2.5, glass='clear', surround='paint')],
        'right': [dict(kind='panel', at=-0.5, w=4.0, z0=F0, z1=F0 + STOREY),
                  dict(kind='window', at=2.6, w=0.8, z0=1.6, z1=2.5, glass='clear', surround='paint')],
    }
    walls = rect_walls(A, x0, x1, y0, y1, side_top, ops, gables={'front': (ze, ridge), 'back': (ze, ridge)},
                       dado=(F0 + 1.0, DADO_BLUE), step=1.6, bands=(0.2, 0.6))
    plinth(A, x0, x1, y0, y1, gaps=door_gaps(ops) + [('front', -3.5, 3.5)])
    all_quoins(A, x0, x1, y0, y1, 0.66, ze - 0.1)
    gable_roof(A, x0, x1, y0, y1, ze, pitch, over=0.4, verge=0.3, axis='y', rafter_step=1.1)
    # walkways at the floor level along both side walls, stone kerbs
    for (xa, xb) in ((x0 + 0.4, -2.6), (2.6, x1 - 0.4)):
        floor_slab(A, xa, xb, y0 + 0.4, y1 - 0.4, F0, thick=0.9, beams=False, collide=False, top=P['stone'])
        A.col((xa, y0 + 0.4, ZB), (xb, y1 - 0.4, F0))
        kx = -2.6 if xa < 0 else 2.6
        A.add(box((kx - 0.12, y0 + 0.4, -0.5), (kx + 0.12, y1 - 0.4, F0 + 0.03), bevel=0.02, maxlen=1.2), P['sandstone'])
    A.col((x0, y1 - 0.4, ZB), (x1, y1, F0))
    # slipway: stone slope with oak rails and sleepers, running out through the arch
    sfr = Frame(V((-2.6, 3.6, 0)), (1, 0, 0), V((0, -7.6, -0.65)).normalized(), (0, 0, 1))
    sfr.T = sfr.U.cross(sfr.V) * -1 if sfr.U.cross(sfr.V).z < 0 else sfr.U.cross(sfr.V)
    sl = V((0, -10.6, -0.95)).length
    A.add(holey_slab(Frame(V((-2.6, 3.6, F0)), (1, 0, 0), V((0, -10.6, -0.95)).normalized(), sfr.T), 0.0, 5.2, 0.0, sl,
                     -0.4, 0.0, (), step=1.6, faces=('pos',)), None, mats=[P['stone']] * 6)
    A.ramp((0.0, 3.6, F0), (0.0, -7.0, F0 - 0.95), 5.2)
    d = V((0, -10.6, -0.95))
    for x in (-0.65, 0.65):
        A.add(beam(V((x, 3.5, F0 + 0.06)), V((x, 3.5, F0 + 0.06)) + d * 0.99, 0.14, 0.1, bevel=0.0, maxlen=1.6), P['oak'])
    for k in range(12):
        c = V((0, 3.3, F0)) + d * (k / 12.0)
        A.add(box((c.x - 1.1, c.y - 0.08, c.z - 0.02), (c.x + 1.1, c.y + 0.08, c.z + 0.03)), P['oak'])
    # the llaut on its cradle
    zc = F0 - 0.95 * (3.1 / 10.6) + 0.35
    Mb = Matrix.Translation((0.0, 0.5, zc)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ \
        Matrix.Rotation(math.atan2(0.95, 10.6), 4, 'Y')
    boat(A, L=4.8, B=1.7, D=0.75, M=Mb)
    for yy in (-0.9, 1.9):
        A.add(box((-0.9, yy - 0.12, zc - 0.45), (0.9, yy + 0.12, zc + 0.12)), P['oak'])
    # loft at the back-left with an oak stair up the left walkway
    lz = F0 + 2.6
    floor_slab(A, x0 + 0.4, -1.2, 1.4, y1 - 0.4, lz, thick=0.2, top=P['oak'], ceil=P['oak'], beam_axis='x',
               beam_step=0.9, embed=0.0)
    for (px, py) in ((-1.3, 1.5), (-1.3, 3.5)):
        A.add(box((px - 0.09, py - 0.09, F0 if px > -2.6 else F0), (px + 0.09, py + 0.09, lz - 0.2)), P['oak'])
        A.col((px - 0.09, py - 0.09, -0.4), (px + 0.09, py + 0.09, lz - 0.2))
    railing(A, (-1.25, 1.42), (-1.25, y1 - 0.4), lz, h=0.95)
    railing(A, (-3.5, 1.42), (-1.25, 1.42), lz, h=0.95)
    stair(A, (-4.05, -2.2), (0, 1), 1.0, F0, lz, 3.6, kind='wood')
    A.slot('scrap', (-2.6, 3.0, lz))
    # dressing: oars, nets, barrels, fish crates, coiled rope, lantern
    for k, x in enumerate((3.3, 3.55)):
        A.add(beam((x, y1 - 0.55, F0), (x + 0.1, y1 - 0.75 - k * 0.1, F0 + 3.2), 0.05, 0.05, bevel=0.0), P['oak'])
    net = bm_ico(1.0, 2, (3.6, -2.4, F0), sc=(0.8, 1.1, 0.35))
    displace(net, lambda co, n: co + n * 0.08 * noise.noise(co * 3.0))
    A.add(net, P['rope'], tint=(0.75, 0.8, 0.72))
    A.col((2.9, -3.4, F0), (4.4, -1.4, F0 + 0.3))
    barrel(A, (-4.0, -3.1), z=F0)
    barrel(A, (-3.4, -3.25), z=F0, h=0.7, r=0.25)
    for k in range(3):
        crate(A, (3.9, 0.9 + 0.5 * (k // 2), 0), s=(0.6, 0.42, 0.28), z=F0 + 0.29 * (k % 2), rz=0.05 * k)
    coil = bm_lathe([(0.12, 0.0), (0.3, 0.0), (0.3, 0.12), (0.12, 0.12)], segs=14)
    A.add(placed(coil, (3.2, 2.9), 0, F0), P['rope'])
    A.slot('Anvil', (3.6, -0.5, F0), math.pi / 2)
    A.slot('light', (0.0, 0.0, 3.8))
    A.slot('light', (-3.0, 2.5, lz + 1.6))
    A.slot('spawn', (3.5, -1.0, F0))
    render_patch(A, walls['left'].fr, 5.4, 0.9, 0.45, -T_WALL / 2, 91)
    render_patch(A, walls['back'].fr, 8.4, 3.4, 0.4, -T_WALL / 2, 92)
    return A.finalize()


# ============================================================================
# B_Loggia  (16 x 5: an open market arcade with a walkable roof)
# ============================================================================
def marble_column(A, c, z0, z1):
    P = A.P
    h = z1 - z0
    prof = [(0.0, 0.0), (0.27, 0.0), (0.27, 0.06), (0.24, 0.1), (0.25, 0.14), (0.2, 0.2)]
    for k in range(1, 6):
        t = k / 6
        prof.append((0.2 - 0.03 * t ** 1.5 + 0.008 * math.sin(math.pi * t), 0.2 + (h - 0.62) * t))
    prof += [(0.17, h - 0.4), (0.19, h - 0.36), (0.17, h - 0.32), (0.26, h - 0.14), (0.0, h - 0.14)]
    A.add(placed(bm_lathe(prof, segs=12), c, 0, z0), P['marble'], uv=cyl_uv((c[0], c[1], z0), radius=0.2))
    A.add(box((c[0] - 0.3, c[1] - 0.3, z1 - 0.14), (c[0] + 0.3, c[1] + 0.3, z1), bevel=0.015), P['marble'])
    A.col((c[0] - 0.2, c[1] - 0.2, z0), (c[0] + 0.2, c[1] + 0.2, z1))


def stall(A, c, rz=0.0, w=1.9, d=0.85, rng=None, fruit='produce'):
    P = A.P
    rng = rng or random.Random(5)
    zt = table(A, c, w, d, h=0.85, rz=rz, mat=P['wood'])
    R = Matrix.Rotation(rz, 3, 'Z')
    cc = V((c[0], c[1], 0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = cc + R @ V((sx * (w / 2 + 0.05), sy * (d / 2 + 0.05), 0))
            hz = 2.45 if sy < 0 else 2.2
            A.add(box((p.x - 0.03, p.y - 0.03, F0), (p.x + 0.03, p.y + 0.03, F0 + hz)), P['oak'])
    red = plain('AwningRed', '#a8392c', 0.0, 0.9, double=True)
    n = 7
    for k in range(n):
        x0_ = -w / 2 - 0.15 + (w + 0.3) * k / n
        x1_ = -w / 2 - 0.15 + (w + 0.3) * (k + 1) / n
        bm = bmesh.new()
        vs = [bm.verts.new(cc + R @ V(pp)) for pp in ((x0_, -d / 2 - 0.35, F0 + 2.35), (x1_, -d / 2 - 0.35, F0 + 2.35),
                                                      (x1_, d / 2 + 0.2, F0 + 2.22), (x0_, d / 2 + 0.2, F0 + 2.22))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        A.add(bm, red if k % 2 else P['awning'])
    for k in range(3):
        off = R @ V((-w / 2 + 0.35 + k * 0.6, 0.05, 0))
        crate(A, (c[0] + off.x, c[1] + off.y), s=(0.5, 0.38, 0.22), z=zt, rz=rz + rng.uniform(-0.2, 0.2), col=False,
              fruit=fruit if k != 1 else 'fruitgreen')
    return zt


def build_loggia(P):
    A = Asset('B_Loggia', P)
    x0, x1, y0, y1 = -8.0, 8.0, -2.5, 2.5
    zs, zr = 2.9, 4.3                 # spring line, underside of the roof slab
    rtop = zr + 0.3
    bays = 5
    bw = 14.4 / bays
    arches = [dict(kind='arch', u=bw * (k + 0.5), w=bw - 0.52, z0=zs, z1=zs, arch='round', ring=True, ring_d=0.28)
              for k in range(bays)]
    for (yy, p0, p1) in ((y0 + 0.2, (-7.2, y0 + 0.2), (7.2, y0 + 0.2)), (y1 - 0.2, (7.2, y1 - 0.2), (-7.2, y1 - 0.2))):
        w = Wall(A, p0, p1, zr, arches, zb=zs, ends=(False, False), step=1.6)
        dress(A, w)
        for k in range(1, bays):
            marble_column(A, (-7.2 + bw * k, yy), F0, zs)
    for sx in (-1, 1):
        ew = Wall(A, (sx * 7.6, -1.7 * sx), (sx * 7.6, 1.7 * sx), zr,
                  [dict(kind='arch', u=1.7, w=2.2, z0=F0, z1=2.4, arch='round', ring=True, ring_d=0.28)],
                  ends=(False, False), step=1.6)
        dress(A, ew)
        for sy in (-1, 1):
            xa, xb = sorted((sx * 7.2, sx * 8.0))
            ya, yb = sorted((sy * 1.7, sy * 2.5))
            A.add(box((xa, ya, ZB), (xb, yb, zr), maxlen=0.9), P['stucco'])
            A.col((xa, ya, ZB), (xb, yb, zr))
    all_quoins(A, x0, x1, y0, y1, 0.66, zr - 0.05)
    # raised paving with two stone steps along both arcades
    floor_slab(A, x0, x1, y0, y1, F0, thick=0.9, beams=False, collide=False, top=P['sandstone'])
    A.col((x0, y0, ZB), (x1, y1, F0))
    for sy in (-1, 1):
        # lower step 0.9 deep (top 0.15), upper step 0.45 deep (top at the floor)
        for (dep, zt) in ((0.9, 0.15), (0.45, F0)):
            ya, yb = (y0 - dep, y0) if sy < 0 else (y1, y1 + dep)
            A.add(box((x0 + 0.8, ya, -0.3), (x1 - 0.8, yb, zt), bevel=0.03, maxlen=1.5), P['stone'])
        A.ramp((0.0, sy * (2.5 + 1.1), -0.1), (0.0, sy * 2.52, F0), 14.4)
    # roof slab, cornice, parapet with a gap for the stair
    floor_slab(A, x0, x1, y0, y1, rtop, thick=0.3, beam_axis='y', beam_step=bw / 2)
    A.add(box((x0 - 0.05, y0 - 0.05, zr), (x1 + 0.05, y1 + 0.05, rtop), maxlen=1.6), P['stucco'])
    cornice(A, x0, x1, y0, y1, zr - 0.02)
    parapet(A, x0, x1, y0, y1, rtop, 0.9, gaps=[('right', 1.3, 2.35)])
    # outside stair at the right end, landing and balustrade
    stair(A, (8.7, -3.4), (0, 1), 1.2, 0.0, rtop, 4.6, kind='stone')
    A.add(box((8.1, 1.2, ZB), (9.3, 2.5, rtop - 0.06), maxlen=0.9), P['stucco'])
    A.add(box((8.06, 1.16, rtop - 0.06), (9.3, 2.54, rtop), bevel=0.012), P['stone'])
    A.col((8.1, 1.2, ZB), (9.3, 2.5, rtop))
    bfr, _ = wall_frame((9.2, -3.5), (9.2, 2.5))
    A.add(holey_slab(bfr, 0.0, 6.0, ZB, rtop + 0.9, -0.1, 0.1, (), top=[(0.0, 0.95), (4.7, rtop + 0.9), (6.0, rtop + 0.9)],
                     vbot=False, step=1.0), None, mats=[P['stucco']] * 6)
    A.ramp(bfr(0.0, 0.95, 0.0), bfr(4.7, rtop + 0.9, 0.0), 0.2, thick=1.0)
    A.col((9.1, 1.2, rtop), (9.3, 2.5, rtop + 0.9))
    # market: stalls, crates, baskets, amphorae, lanterns
    rng = random.Random(88)
    zt1 = stall(A, (-4.3, -0.3), 0.0, rng=rng)
    zt2 = stall(A, (1.4, 0.4), math.pi, rng=rng, fruit='fruitgreen')
    zt3 = stall(A, (5.2, -0.2), 0.1, rng=rng)
    A.slot('Pomegranate', (-4.0, -0.25, zt1))
    A.slot('Pomegranate', (5.0, -0.1, zt3))
    A.slot('BowlerHat', (1.8, 0.35, zt2), math.pi)
    A.slot('Birdcage', (-6.6, 1.6, F0))
    A.slot('scrap', (-4.3, -0.4, F0 + 2.4))
    for (x, y) in ((-6.8, -1.6), (-2.0, 1.7), (3.2, -1.7), (6.8, 1.5)):
        crate(A, (x, y), s=(0.6, 0.42, 0.4), z=F0, rz=rng.uniform(-0.3, 0.3), fruit=rng.choice(['produce', None]))
    for (x, y) in ((-1.6, -1.6), (-1.1, -1.75), (6.9, -1.2)):
        A.add(placed(pot_bm('amphora', 0.9, segs=12), (x, y), 0, F0), P['clay'])
        A.col((x - 0.2, y - 0.2, F0), (x + 0.2, y + 0.2, F0 + 1.0))
    for (x, y) in ((-3.3, 1.8), (0.4, -1.8), (4.0, 1.9)):
        bk = bm_lathe([(0, 0), (0.2, 0), (0.26, 0.25), (0.24, 0.27), (0, 0.05)], segs=12)
        A.add(placed(bk, (x, y), 0, F0), P['straw'])
    barrel(A, (7.0, 0.2), z=F0)
    for k in range(bays):
        lantern(A, (-7.2 + bw * (k + 0.5), y0 + 0.2, zs + 0.35), hang=0.5)
        A.slot('light', (-7.2 + bw * (k + 0.5), 0.0, zs + 0.6))
    A.slot('spawn', (-1.5, 0.0, F0))
    A.slot('spawn', (3.4, 0.8, F0))
    return A.finalize()


# ============================================================================
# HORIZON: schist headlands (Cap de Creus), an islet, a far ridge
# ============================================================================
def decimate(bm, target_tris):
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    if tris <= target_tris:
        return bm
    return apply_mod(bm, 'DECIMATE', decimate_type='COLLAPSE', ratio=target_tris / tris, use_collapse_triangulate=True)


def grid_surface(P3, nu, nv, closed_u=False):
    """Quad grid from a (nu+1) x (nv+1) array of points P3[i][j]."""
    bm = bmesh.new()
    vs = [[bm.verts.new(P3[i][j]) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu if not closed_u else nu + 1):
        i2 = (i + 1) % (nu + 1) if closed_u else i + 1
        if closed_u and i == nu:
            continue
        for j in range(nv):
            q = [vs[i][j], vs[i2][j], vs[i2][j + 1], vs[i][j + 1]]
            try:
                bm.faces.new(q)
            except ValueError:
                pass
    return bm


class Schist:
    """Folded, dipping schist: thick beds of varying hardness stand out with an
    overhanging top edge (ledges) and undercut bases; joints cut the beds into
    blocky pillars.  Deterministic per seed."""

    def __init__(self, seed, th=3.0, dip=0.35, fold=3.0):
        rng = random.Random(seed)
        self.off = V((rng.uniform(0, 200), rng.uniform(0, 200), rng.uniform(0, 200)))
        self.hard = [rng.random() ** 0.8 for _ in range(97)]
        self.th, self.dip, self.fold = th, dip, fold
        self.dipdir = rng.choice((-1, 1))

    def layer(self, x, z):
        L = (z * math.cos(self.dip) + self.dipdir * x * math.sin(self.dip)
             + self.fold * noise.noise(V((x / 14.0, z / 19.0, 0.3)) + self.off)
             + 0.6 * noise.noise(V((x / 4.0, z / 5.0, 1.7)) + self.off)) / self.th
        i = math.floor(L)
        return i, L - i

    def relief(self, x, z):
        i, f = self.layer(x, z)
        h = self.hard[i % 97]
        ledge = smoothstep(0.0, 0.25, f) * (f ** 0.6) * (1.0 - smoothstep(0.84, 0.97, f))
        return (0.15 + 1.6 * h * h) * ledge

    def blocks(self, x, z, s=1.0):
        """Joint-bounded blocks: cell noise in a sheared, warped frame."""
        w = V((x / (3.1 * s) + 0.35 * z / (3.1 * s), z / (2.4 * s), 0.5)) + self.off
        w += V((0.35 * noise.noise(w * 0.7), 0.25 * noise.noise(w * 0.7 + V((9, 9, 9))), 0.0))
        return noise.cell(w)

    def big(self, x, y, z, s=1.0):
        p = V((x, y, z)) + self.off
        return 2.6 * fbm(p / (17.0 * s), 3) + 0.8 * fbm(p / 5.5, 2) + 0.28 * noise.noise(p / 1.5)


def cliff_tint(sch, Hfn):
    """Large-scale colour on the schist texture: rust streaks under ledges,
    lichen-orange and scrub-green on the crest, dusty scree."""
    def f(co, fc):
        x, y, z = fc.x, fc.y, fc.z
        p = V((x, y, z)) + sch.off
        k = 0.9 + 0.1 * noise.noise(p / 9.0)
        rust = smoothstep(0.25, 0.7, noise.noise(V((x / 3.0, 0.0, z / 14.0)) + sch.off))
        c = [k * (1.0 - 0.1 * rust), k * (1.0 - 0.2 * rust), k * (1.0 - 0.32 * rust)]
        top = smoothstep(-1.5, 0.3, z - Hfn(x))
        veg = smoothstep(0.05, 0.45, noise.noise(p / 4.0)) * top
        c = [c[0] * (1 - 0.3 * veg), c[1] * (1 - 0.12 * veg), c[2] * (1 - 0.45 * veg)]
        lich = smoothstep(0.35, 0.6, noise.noise(p / 2.2 + V((5, 5, 5)))) * (0.35 + 0.65 * top)
        c = [c[0], c[1] * (1 - 0.18 * lich), c[2] * (1 - 0.45 * lich)]
        return tuple(clamp(v) for v in c)
    return f


def build_cliff(P, name, W, H0, D=25.0, seed=1, gullies=3):
    A = Asset(name, P, budget=15000)
    A.ao_dist = 7.0
    rng = random.Random(seed)
    sch = Schist(seed * 13 + 5, th=rng.uniform(2.4, 3.6), dip=rng.uniform(0.3, 0.6), fold=rng.uniform(2.5, 4.0))
    off = sch.off
    gl = [(rng.uniform(-W * 0.38, W * 0.38), rng.uniform(1.6, 3.0), rng.uniform(3.5, 6.5)) for _ in range(gullies)]
    zb = -3.5

    def n1(x, sc, k=0.0):
        return noise.noise(V((x / sc + k, 0.37 + k, 0.11)) + off)

    def ridged(x, sc, k=0.0):
        return 1.0 - abs(n1(x, sc, k))

    def Hc(x):
        e = smoothstep(0.0, W * 0.22, W / 2 - abs(x))
        h = H0 * (0.74 + 0.18 * n1(x, 16.0)) + 0.16 * H0 * ridged(x, 7.0, 3.0) ** 2 + 0.07 * H0 * ridged(x, 2.6, 5.0) ** 3
        for (c, w, d) in gl:
            h -= 0.22 * d * math.exp(-((x - c) / (w * 1.5)) ** 2)
        return max(3.0, h * (0.28 + 0.72 * e))

    def yfoot(x):
        return -D / 2 + 3.5 + 2.8 * n1(x, 11.0, 7.0) + 1.1 * n1(x, 3.7, 2.0)

    def gully(x):
        return sum(d * math.exp(-((x - c) / w) ** 2) for (c, w, d) in gl)

    def face_pt(x, sfrac):
        H = Hc(x)
        z = zb + (H - zb) * sfrac
        zz = max(z, 0.0)
        u = zz / H
        lean = H * (0.09 * u + 0.07 * u ** 4)
        y = yfoot(x) + lean + gully(x) * (0.3 + 0.7 * sfrac)
        y -= sch.relief(x, z) * (0.35 + 0.65 * smoothstep(0.0, 3.0, z))
        y -= 1.5 * sch.blocks(x, z)
        y -= sch.big(x, 0.0, z)
        xx = x + 0.45 * noise.noise(V((x / 5.0, z / 5.0, 2.2)) + off)
        return V((xx, y, z))

    NX, NF, NT, NB = 150, 64, 14, 4
    xs = [-W / 2 + W * i / NX for i in range(NX + 1)]
    grid = []
    for x in xs:
        col = [face_pt(x, j / NF) for j in range(NF + 1)]
        crest = col[-1]
        H = Hc(x)
        yb = D / 2
        for j in range(1, NT + 1):
            t = j / NT
            y = crest.y + (yb - crest.y) * t
            z = H + 0.5 * math.sin(math.pi * min(1.0, t * 2.5)) - 0.12 * (y - crest.y) - 6.0 * t ** 4
            z += 0.5 * noise.noise(V((x / 4.0, y / 4.0, 3.3)) + off) + 0.9 * sch.blocks(x, y + 40.0, 1.3)
            col.append(V((crest.x, y, z)))
        top_back = col[-1]
        for j in range(1, NB + 1):
            t = j / NB
            col.append(V((top_back.x, yb + 1.5 * t, top_back.z + (zb - top_back.z) * t)))
        grid.append(col)
    nv = NF + NT + NB
    bm = grid_surface(grid, NX, nv)
    # close the ends
    for i, want in ((0, V((-1, 0, 0))), (NX, V((1, 0, 0)))):
        vs = [bm.verts.new(p) for p in grid[i]]
        try:
            f = bm.faces.new(vs)
            f.normal_update()
            if f.normal.dot(want) < 0:
                f.normal_flip()
        except ValueError:
            pass
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm = decimate(bm, 11200)
    set_smooth(bm, True)
    A.add(bm, P['schist'], tint=cliff_tint(sch, Hc))
    # scree fans under the face (bigger below the gullies) and fallen blocks
    NXs, NDs = 60, 6
    sg = []
    for i in range(NXs + 1):
        x = -W / 2 + 2.0 + (W - 4.0) * i / NXs
        fan = sum(math.exp(-((x - c) / (w * 2.2)) ** 2) for (c, w, d) in gl)
        hs = 2.0 + 4.5 * fan + 1.0 * n1(x, 5.0, 4.0)
        Ls = 6.0 + 7.0 * fan
        y0 = yfoot(x) + 0.8 + gully(x) * 0.3
        row = []
        for j in range(NDs + 1):
            d = j / NDs
            z = hs * (1 - d) ** 1.35 - 0.4 * d
            z += (0.35 * noise.noise(V((x / 1.6, d * 4.0, 5.5)) + off) + 0.5 * noise.noise(V((x / 3.5, d * 2.0, 8.5)) + off)
                  + 0.45 * sch.blocks(x, d * 9.0 + 70.0, 0.6)) * (1 - d * 0.6)
            row.append(V((x, y0 - Ls * d, z)))
        sg.append(row)
    scree = grid_surface(sg, NXs, NDs)
    bmesh.ops.reverse_faces(scree, faces=scree.faces[:])
    scree.normal_update()
    if sum(f.normal.z for f in scree.faces) < 0:
        bmesh.ops.reverse_faces(scree, faces=scree.faces[:])
    set_smooth(scree, True)
    A.add(scree, P['schist'], tint=lambda co, fc: (0.97, 0.94, 0.88))
    for k in range(16):
        x = rng.uniform(-W * 0.42, W * 0.42)
        r = rng.uniform(0.6, 2.4)
        c = V((x, yfoot(x) - rng.uniform(2.0, 9.0), r * 0.35))
        b = bm_ico(r, 1, c, sc=(1.0, rng.uniform(0.7, 1.1), rng.uniform(0.55, 0.8)))
        displace(b, lambda co, n: co + n * 0.25 * r * noise.noise(co / (0.8 * r) + off))
        rot(b, rng.uniform(0, 3), 'Z', c)
        set_smooth(b, False)
        A.add(b, P['schist'], tint=(0.9, 0.88, 0.84))
    # low-poly trimesh collider: the same surface, coarse, no fine relief
    cg = []
    for i in range(21):
        x = -W / 2 + W * i / 20
        col = []
        for j in range(7):
            sfrac = j / 6
            H = Hc(x)
            z = zb + (H - zb) * sfrac
            zz = max(z, 0.0)
            y = yfoot(x) + H * (0.2 * (zz / H) + 0.14 * (zz / H) ** 3) + gully(x) * (0.25 + 0.75 * sfrac) - 1.2
            col.append(V((x, y, z)))
        col.append(V((x, D / 2 - 2.0, Hc(x) - 1.0)))
        col.append(V((x, D / 2 + 1.5, zb)))
        cg.append(col)
    cbm = grid_surface(cg, 20, 8)
    A.col_tri(cbm)
    sc = []
    for i in range(11):
        x = -W / 2 + 2.0 + (W - 4.0) * i / 10
        fan = sum(math.exp(-((x - c) / (w * 2.2)) ** 2) for (c, w, d) in gl)
        y0 = yfoot(x) + 0.8
        sc.append([V((x, y0 + 1.0, 2.0 + 4.5 * fan)), V((x, y0 - (6.0 + 7.0 * fan), -0.4))])
    A.col_tri(grid_surface(sc, 10, 1))
    return A.finalize()


def build_cliffs(P):
    build_cliff(P, 'H_Cliff_A', 60.0, 28.0, seed=11, gullies=3)
    build_cliff(P, 'H_Cliff_B', 52.0, 20.0, seed=23, gullies=2)
    build_cliff(P, 'H_Cliff_C', 68.0, 34.0, seed=37, gullies=4)


def build_islet(P):
    """A schist stack rising from the sea (origin at sea level)."""
    A = Asset('H_Islet', P, budget=15000)
    A.ao_dist = 6.0
    A.ground = False
    rng = random.Random(71)
    sch = Schist(71, th=1.5, dip=0.4, fold=2.8)
    off = sch.off
    Rx, Ry, H, zb = 20.0, 13.0, 14.0, -5.0
    NA, NZ, NR = 72, 26, 7

    def R(a):
        return 1.0 + 0.18 * noise.noise(V((math.cos(a) * 1.3, math.sin(a) * 1.3, 0.5)) + off) + \
            0.07 * noise.noise(V((math.cos(a) * 4.0, math.sin(a) * 4.0, 1.5)) + off)

    def Ht(a):
        return H * (0.85 + 0.15 * noise.noise(V((math.cos(a), math.sin(a), 3.0)) + off))
    rows = []
    for i in range(NA + 1):
        a = TAU * i / NA
        ca, sa = math.cos(a), math.sin(a)
        col = []
        for j in range(NZ + 1):
            s_ = j / NZ
            z = zb + (Ht(a) - zb) * s_
            r = R(a) * (1.0 - 0.22 * max(0.0, z) / H - 0.12 * (max(0.0, z) / H) ** 3)
            x, y = ca * Rx * r, sa * Ry * r
            push = sch.relief(x + y, z) + sch.big(x, y, z, 0.7)
            nrm = V((ca / Rx, sa / Ry, 0)).normalized()
            col.append(V((x, y, z)) + nrm * push)
        # the top: rings inward to a rounded crown
        top = col[-1]
        for k in range(1, NR + 1):
            t = k / NR
            p = V((top.x * (1 - t), top.y * (1 - t), top.z + 2.2 * math.sin(math.pi / 2 * t)))
            p.z += 0.5 * noise.noise(p / 3.0 + off)
            col.append(p)
        rows.append(col)
    bm = grid_surface(rows[:-1] + [rows[0]], NA, NZ + NR)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm = decimate(bm, 7000)
    set_smooth(bm, True)
    A.add(bm, P['schist'], tint=cliff_tint(sch, lambda x: H - 1.0))
    for k in range(6):
        a = rng.uniform(0, TAU)
        r = rng.uniform(1.2, 3.0)
        c = V((math.cos(a) * Rx * 1.12, math.sin(a) * Ry * 1.15, rng.uniform(-0.6, 0.4)))
        b = bm_ico(r, 1, c, sc=(1.0, 0.8, rng.uniform(0.5, 0.9)))
        displace(b, lambda co, n: co + n * 0.3 * r * noise.noise(co / r + off))
        set_smooth(b, False)
        A.add(b, P['schist'], tint=(0.85, 0.84, 0.8))
    cr = []
    for i in range(17):
        a = TAU * i / 16
        col = []
        for (s_, rr) in ((0.0, 1.05), (0.5, 0.95), (1.0, 0.72)):
            z = zb + (H - zb) * s_
            col.append(V((math.cos(a) * Rx * R(a) * rr, math.sin(a) * Ry * R(a) * rr, z)))
        col.append(V((0, 0, H + 1.5)))
        cr.append(col)
    cbm = grid_surface(cr[:-1] + [cr[0]], 16, 3)
    bmesh.ops.remove_doubles(cbm, verts=cbm.verts, dist=1e-4)
    A.col_tri(cbm)
    return A.finalize()


def build_ridge(P):
    """Far mountain silhouette, 300 m wide, very low-poly, no collision."""
    A = Asset('H_Ridge', P, budget=2000)
    A.bake = False
    A.grime = False
    off = V((31.0, 7.0, 3.0))
    NXr, NYr = 60, 4
    rows = []
    for i in range(NXr + 1):
        x = -150.0 + 300.0 * i / NXr
        e = smoothstep(0.0, 40.0, 150.0 - abs(x))
        crest = (26.0 + 16.0 * noise.noise(V((x / 45.0, 0.3, 0.0)) + off) + 8.0 * noise.noise(V((x / 14.0, 1.3, 0.0)) + off)
                 + 4.0 * abs(noise.noise(V((x / 5.0, 2.3, 0.0)) + off)))
        crest = 6.0 + (crest - 6.0) * (0.25 + 0.75 * e)
        col = []
        for j in range(NYr + 1):
            t = j / NYr
            y = -30.0 + 60.0 * t
            prof = math.sin(math.pi * min(1.0, t * 1.25)) ** 0.8
            z = -2.0 + (crest + 2.0) * prof
            z += 1.5 * noise.noise(V((x / 9.0, y / 9.0, 4.0)) + off) * prof
            col.append(V((x, y, z)))
        rows.append(col)
    bm = grid_surface(rows, NXr, NYr)
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    set_smooth(bm, True)

    def haze(co, fc):
        k = smoothstep(0.0, 40.0, fc.z)
        g = 0.72 + 0.1 * noise.noise(fc / 20.0 + off)
        return (g * (0.9 + 0.1 * k), g * (0.92 + 0.08 * k), g * (0.98 + 0.02 * k))
    A.add(bm, P['ridge'], tint=haze)
    return A.finalize()


# ============================================================================
# the breakable panel (TP_Stucco) and its Voronoi fracture
# ============================================================================
PANEL = ((-2.0, -0.2, 0.0), (2.0, 0.2, 3.6))


def panel_tint(co, fc):
    """Cut (inner) faces of the fracture read a little darker than the skin."""
    (x0, y0, z0), (x1, y1, z1) = PANEL
    e = 1e-3
    on_skin = (abs(fc.y - y0) < e or abs(fc.y - y1) < e or abs(fc.x - x0) < e or abs(fc.x - x1) < e or
               abs(fc.z - z0) < e or abs(fc.z - z1) < e)
    return (1.0, 1.0, 1.0) if on_skin else (0.8, 0.77, 0.72)


def build_panel(P):
    """4 x 3.6 x 0.4 stucco-over-stone panel, origin at the bottom centre."""
    A = Asset('TP_Stucco', P, budget=2000)
    A.bake = False
    fr = Frame((-2.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0))
    bm = holey_slab(fr, 0.0, 4.0, 0.0, 3.6, -0.2, 0.2, (), step=1.1)
    A.add(bm, None, mats=[P['stucco'], P['stucco'], P['stone'], P['stone'], P['stone'], P['stone']])
    return A.finalize()


def build_panel_fractured(P):
    """Voronoi chunks filling exactly the TP_Stucco volume in the same frame
    (after build_props' Wall_Fractured): stucco skin, stone edges and cuts."""
    A = Asset('TP_Stucco_Fractured', P, budget=4000)
    A.root_empty = True
    A.bake = False
    rng = random.Random(1958)
    impact = V((0.0, 0.0, 1.7))
    seeds, relax, tries = [], 1.0, 0
    while len(seeds) < 16:
        tries += 1
        if tries % 4000 == 0:
            relax *= 0.9
        u = rng.random() ** 1.3
        a = rng.uniform(0, TAU)
        p = V((math.cos(a) * u * 2.4, rng.uniform(-0.05, 0.05), 1.7 + math.sin(a) * u * 2.0))
        if not (-1.92 < p.x < 1.92 and 0.08 < p.z < 3.52):
            continue
        dn = math.hypot(p.x / 2.0, (p.z - 1.7) / 1.8)
        md = (0.42 + 0.7 * dn) * relax
        if any(math.hypot(p.x - q.x, p.z - q.z) < md for q in seeds):
            continue
        seeds.append(p)
    whole = Convex.box(*PANEL)
    cells = []
    for i, sd in enumerate(seeds):
        c = whole
        for j, t in enumerate(seeds):
            if i == j or c is None:
                continue
            n = (t - sd).normalized()
            c = c.clip(n, n.dot((sd + t) / 2), 'in')
        if c is None:
            continue
        cen, vol = c.volume_centroid()
        if vol > 1e-5:
            cells.append((c, cen, vol))
    cells.sort(key=lambda q: (q[1] - impact).length)
    for k, (c, cen, vol) in enumerate(cells):
        bm = c.to_bm({'out': 0, 'in': 1})
        bm.normal_update()
        for f in bm.faces:
            if f.material_index == 0 and abs(f.normal.y) < 0.9:
                f.material_index = 2
        key = '=TP_Stucco_Chunk_%02d' % k
        A.pivots[key] = cen
        A.add(bm, None, key=key, mats=[P['stucco'], P['stone'], P['stone']], tint=panel_tint)
    return A.finalize()


# ============================================================================
# street and dressing props (each its own root, origin at ground centre)
# ============================================================================
def disc(r, z, n=16, up=True):
    bm = bmesh.new()
    vs = [bm.verts.new((r * math.cos(TAU * k / n), r * math.sin(TAU * k / n), z)) for k in range(n)]
    f = bm.faces.new(vs if up else list(reversed(vs)))
    f.normal_update()
    if (f.normal.z > 0) != up:
        f.normal_flip()
    return bm


def build_t_egg(P):
    A = Asset('T_Egg', P, budget=1500)
    base = bm_lathe([(0.0, 0.0), (0.6, 0.0), (0.62, 0.05), (0.58, 0.15), (0.5, 0.19), (0.0, 0.19)], segs=14,
                    smooth=False)
    displace(base, lambda co, n: co + V((0, 0, 0.012 * noise.noise(co * 6.0))))
    A.add(base, P['sandstone'], uv=cyl_uv((0, 0, 0)))
    egg = egg_bm(1.42, segs=20, rings=14)
    A.add(move(egg, (0, 0, 0.17)), P['egg'])
    A.col((-0.55, -0.55, 0.0), (0.55, 0.55, 1.6))
    return A.finalize()


def build_t_well(P):
    A = Asset('T_Well', P, budget=1500)
    ring = bm_lathe([(0.82, -0.3), (0.82, 0.73), (0.56, 0.73), (0.56, 0.28)], segs=16, cap=False, smooth=False)
    A.add(ring, P['stone'], uv=cyl_uv((0, 0, 0), radius=0.82))
    cop = bm_lathe([(0.88, 0.72), (0.88, 0.86), (0.53, 0.86), (0.53, 0.72)], segs=16, cap=False, smooth=False)
    A.add(cop, P['sandstone'], uv=cyl_uv((0, 0, 0), radius=0.88))
    A.add(disc(0.56, 0.32, 16), plain('WellWater', '#1a2627', 0.0, 0.05))
    for sx in (-1, 1):
        A.add(box((sx * 0.72 - 0.03, -0.03, 0.86), (sx * 0.72 + 0.03, 0.03, 1.95)), P['iron'])
    arc = [V((0.72 * math.cos(math.pi * k / 10), 0.0, 1.95 + 0.6 * math.sin(math.pi * k / 10))) for k in range(11)]
    A.add(bm_tube(arc, 0.025, sides=5), P['iron'])
    for sx in (-1, 1):
        sc = [V((sx * (0.5 - 0.12 * math.cos(a)), 0.0, 2.02 + 0.12 * math.sin(a))) for a in
              [math.pi * k / 6 for k in range(7)]]
        A.add(bm_tube(sc, 0.012, sides=4), P['iron'])
    wheel = bm_lathe([(0.0, -0.02), (0.14, -0.02), (0.12, 0.0), (0.14, 0.02), (0.0, 0.02)], segs=12)
    rot(wheel, math.pi / 2, 'X')
    A.add(move(wheel, (0, 0, 2.3)), P['iron'])
    A.add(bm_tube([V((0.14, 0, 2.3)), V((0.14, 0, 1.52))], 0.012, sides=4), P['rope'])
    bucket = bm_lathe([(0.0, 0.0), (0.13, 0.0), (0.17, 0.26), (0.155, 0.26), (0.115, 0.03), (0.0, 0.03)], segs=10)
    A.add(move(bucket, (0.14, 0, 1.22)), P['oak'], uv=cyl_uv((0.14, 0, 1.22)))
    hoop = bm_lathe([(0.15, 0.16), (0.155, 0.2)], segs=10, cap=False)
    A.add(move(hoop, (0.14, 0, 1.22)), P['iron'])
    A.add(bm_tube([V((0.14 + 0.17 * math.cos(a), 0, 1.48 + 0.1 * math.sin(a))) for a in
                   [math.pi * k / 6 for k in range(7)]], 0.008, sides=4), P['iron'])
    A.add(box((-0.95, -1.05, -0.2), (0.95, -0.82, 0.12), bevel=0.03), P['stone'])
    A.col((-0.88, -0.88, -0.3), (0.88, 0.88, 0.86))
    for sx in (-1, 1):
        A.col((sx * 0.72 - 0.04, -0.04, 0.86), (sx * 0.72 + 0.04, 0.04, 2.55))
    return A.finalize()


def build_t_boat(P):
    A = Asset('T_Boat', P, budget=1500)
    M = Matrix.Translation((0.0, 0.0, -0.3)) @ Matrix.Rotation(math.radians(13.0), 4, 'X') @ \
        Matrix.Rotation(math.radians(-2.5), 4, 'Y')
    boat(A, L=6.0, B=2.0, D=0.9, M=M, NS=12, NQ=5, rib_step=3)
    for k, y in enumerate((-1.35, -1.55)):
        A.add(beam((-2.1 + k * 0.3, y, 0.05), (1.6 + k * 0.2, y + 0.15, 0.09), 0.05, 0.04, bevel=0.0), P['oak'])
        A.add(obox(V((1.75 + k * 0.2, y + 0.16, 0.09)), (0.5, 0.14, 0.02), Matrix.Rotation(0.04, 3, 'Z')), P['oak'])
    coil = bm_lathe([(0.1, 0.0), (0.24, 0.0), (0.24, 0.09), (0.1, 0.09)], segs=10)
    A.add(move(coil, (-2.3, -1.4, 0.0)), P['rope'])
    return A.finalize()


def build_t_cypress(P):
    A = Asset('T_Cypress', P, budget=3000)
    rng = random.Random(8)
    off = V((rng.uniform(0, 50), rng.uniform(0, 50), 0))
    trunk = bm_lathe([(0.0, -0.2), (0.2, -0.2), (0.16, 0.5), (0.12, 1.3), (0.0, 1.3)], segs=8)
    A.add(trunk, P['bark'], uv=cyl_uv((0, 0, 0)))
    H = 8.0
    prof = []
    NRg = 22
    for i in range(NRg + 1):
        t = i / NRg
        z = 0.55 + (H - 0.55) * t
        r = 0.95 * (math.sin(math.pi * min(1.0, t * 1.04)) ** 0.75) * (1.0 - 0.45 * t) + 0.06 * (1 - t)
        prof.append((max(r, 0.0), z))
    prof[0] = (0.0, 0.5)
    prof[-1] = (0.0, H)
    fol = bm_lathe(prof, segs=18)

    def tuft(co, n):
        a = math.atan2(co.y, co.x)
        k = 0.2 * noise.noise(V((math.cos(a) * 2.2, math.sin(a) * 2.2, co.z * 0.9)) + off) + \
            0.1 * noise.noise(V((math.cos(a) * 5.0, math.sin(a) * 5.0, co.z * 2.2)) + off)
        rr = math.hypot(co.x, co.y)
        return V((co.x * (1 + k), co.y * (1 + k), co.z + 0.15 * k * rr))
    displace(fol, tuft)
    A.add(fol, P['foliage'], tint=lambda co, fc: (0.7 + 0.3 * smoothstep(0.5, 6.0, fc.z),) * 3)
    A.col((-0.2, -0.2, 0.0), (0.2, 0.2, 1.2))
    A.col((-0.55, -0.55, 1.2), (0.55, 0.55, H - 1.0))
    return A.finalize()


def build_t_olive(P):
    A = Asset('T_Olive', P, budget=3000)
    rng = random.Random(9)
    off = V((rng.uniform(0, 50), rng.uniform(0, 50), 0))
    verts = [(0, 0, -0.2), (0.05, 0.02, 0.5), (0.15, -0.05, 1.1),
             (0.6, 0.25, 1.8), (1.0, 0.45, 2.4),
             (-0.35, 0.3, 1.8), (-0.85, 0.55, 2.35),
             (0.2, -0.5, 1.9), (0.3, -0.95, 2.45)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (2, 5), (5, 6), (2, 7), (7, 8)]
    radii = [0.3, 0.26, 0.24, 0.14, 0.08, 0.13, 0.07, 0.12, 0.07]
    tr = bm_skin(verts, edges, radii, levels=1)
    displace(tr, lambda co, n: co + n * 0.05 * noise.noise(co * 3.0 + off))
    A.add(tr, P['bark'])
    for (c, r) in (((1.0, 0.5, 2.7), 0.95), ((-0.9, 0.6, 2.7), 0.9), ((0.3, -1.0, 2.75), 0.85),
                   ((0.1, 0.1, 3.2), 1.1), ((0.7, -0.4, 3.1), 0.8), ((-0.4, -0.3, 3.0), 0.8), ((0.3, 0.8, 3.1), 0.75)):
        cl = bm_ico(r, 2, c, sc=(1.0, 1.0, 0.72))
        displace(cl, lambda co, n, r=r: co + n * r * (0.22 * noise.noise(co * 1.8 + off) + 0.1 * noise.noise(co * 5.0 + off)))
        A.add(cl, P['olive'], tint=lambda co, fc: (0.78 + 0.22 * smoothstep(2.2, 3.8, fc.z),) * 3)
    A.col((-0.3, -0.3, 0.0), (0.3, 0.3, 1.8))
    return A.finalize()


def build_t_lamp(P):
    A = Asset('T_Lamp', P, budget=1500)
    A.add(box((-0.22, -0.22, -0.2), (0.22, 0.22, 0.35), bevel=0.03), P['stone'])
    prof = [(0.0, 0.35), (0.13, 0.35), (0.13, 0.45), (0.09, 0.55), (0.07, 1.0), (0.055, 2.6), (0.07, 2.7),
            (0.05, 2.78), (0.045, 3.3), (0.07, 3.36), (0.0, 3.4)]
    A.add(bm_lathe(prof, segs=8), P['iron'], uv=cyl_uv((0, 0, 0), radius=0.08))
    arm = [V((0.0, 0, 3.2)), V((0.25, 0, 3.32)), V((0.5, 0, 3.3)), V((0.62, 0, 3.22))]
    A.add(bm_tube(arm, 0.022, sides=5), P['iron'])
    sc = [V((0.05 + 0.13 * (1 - math.cos(a)), 0.0, 3.05 + 0.13 * math.sin(a))) for a in [math.pi * k / 6 for k in range(7)]]
    A.add(bm_tube(sc, 0.014, sides=4), P['iron'])
    lantern(A, (0.62, 0.0, 2.72), hang=0.08)
    A.slot('light', (0.62, 0.0, 2.85))
    A.col((-0.22, -0.22, 0.0), (0.22, 0.22, 3.4))
    return A.finalize()


def build_t_bench(P):
    A = Asset('T_Bench', P, budget=1500)
    for x in (-0.7, 0.7):
        A.add(box((x - 0.14, -0.2, -0.1), (x + 0.14, 0.2, 0.4), bevel=0.02), P['stone'])
    A.add(box((-0.95, -0.25, 0.4), (0.95, 0.25, 0.5), bevel=0.02, maxlen=1.0), P['sandstone'])
    A.add(box((-0.95, 0.2, 0.5), (0.95, 0.3, 0.95), bevel=0.02, maxlen=1.0), P['sandstone'])
    A.col((-0.95, -0.25, 0.0), (0.95, 0.3, 0.5))
    A.col((-0.95, 0.2, 0.5), (0.95, 0.3, 0.95))
    return A.finalize()


def build_t_crate(P):
    A = Asset('T_Crate', P, budget=1500)
    crate(A, (0, 0), s=(0.7, 0.5, 0.5), z=0.0)
    for k in range(4):
        x = -0.3 + k * 0.2
        A.add(box((x - 0.085, -0.25, 0.5), (x + 0.085, 0.25, 0.52)), P['wood'])
    return A.finalize()


def build_t_barrel(P):
    A = Asset('T_Barrel', P, budget=1500)
    barrel(A, (0, 0), h=0.95, r=0.32)
    A.add(disc(0.27, 0.955, 12), P['oak'])
    return A.finalize()


def build_t_amphora(P):
    A = Asset('T_Amphora', P, budget=1500)
    am = pot_bm('amphora', 1.0, segs=12)
    A.add(move(am, (0, 0, 0.12)), P['clay'], uv=cyl_uv((0, 0, 0)))
    for s_ in (-1, 1):
        h = [V((s_ * 0.075, 0, 1.12)), V((s_ * 0.2, 0, 1.12)), V((s_ * 0.24, 0, 1.0)), V((s_ * 0.2, 0, 0.84))]
        A.add(bm_tube(h, 0.022, sides=5), P['clay'])
    stand = bm_lathe([(0.12, 0.0), (0.2, 0.0), (0.2, 0.14), (0.12, 0.14)], segs=10, cap=False)
    A.add(stand, P['iron'])
    A.col((-0.24, -0.24, 0.0), (0.24, 0.24, 1.25))
    return A.finalize()


def build_t_cart(P):
    A = Asset('T_Cart', P, budget=1500)
    tilt = Matrix.Rotation(math.radians(-9.0), 4, 'Y')
    Mb = Matrix.Translation((0.0, 0.0, 0.62)) @ tilt

    def tb(mn, mx, mat, bevel=0.0):
        bm = box(mn, mx, bevel=bevel)
        xform(bm, Mb)
        A.add(bm, mat)
    tb((-1.1, -0.62, 0.0), (1.1, 0.62, 0.06), P['wood'])
    for sy in (-1, 1):
        tb((-1.1, sy * 0.62 - 0.03, 0.06), (1.1, sy * 0.62 + 0.03, 0.42), P['wood'])
    tb((-1.1, -0.59, 0.06), (-1.04, 0.59, 0.36), P['wood'])
    for sy in (-1, 1):
        tb((0.9, sy * 0.45 - 0.04, -0.04), (2.7, sy * 0.45 + 0.04, 0.03), P['oak'])
    tb((-0.05, -0.8, -0.06), (0.05, 0.8, 0.0), P['iron'])
    for sy in (-1, 1):
        c = V((0.0, sy * 0.72, 0.6))
        rim = bm_lathe([(0.52, -0.035), (0.6, -0.035), (0.6, 0.035), (0.52, 0.035)], segs=16, cap=False, smooth=False)
        rot(rim, math.pi / 2, 'X')
        A.add(move(rim, c), P['oak'], uv=cyl_uv(c, 'Y', 0.6))
        tyre = bm_lathe([(0.6, -0.04), (0.615, -0.04), (0.615, 0.04), (0.6, 0.04)], segs=16, cap=False, smooth=False)
        rot(tyre, math.pi / 2, 'X')
        A.add(move(tyre, c), P['iron'])
        hub = bm_lathe([(0.0, -0.09), (0.1, -0.09), (0.1, 0.09), (0.0, 0.09)], segs=8)
        rot(hub, math.pi / 2, 'X')
        A.add(move(hub, c), P['oak'])
        for k in range(8):
            a = TAU * k / 8
            sp = beam(c + V((math.cos(a) * 0.08, 0, math.sin(a) * 0.08)), c + V((math.cos(a) * 0.54, 0, math.sin(a) * 0.54)),
                      0.03, 0.035, up=(0, 1, 0), bevel=0.0)
            A.add(sp, P['oak'])
    A.col_obox(Mb @ V((0.0, 0.0, 0.2)), (2.2, 1.24, 0.42), tilt.to_3x3())
    for sy in (-1, 1):
        A.col((-0.6, sy * 0.72 - 0.05, 0.0), (0.6, sy * 0.72 + 0.05, 1.2))
    return A.finalize()


def build_t_gardenwall(P):
    A = Asset('T_GardenWall', P, budget=1500)
    rng = random.Random(12)
    fr = Frame((-2.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0))
    top = [(0.0, 1.2), (1.1, 1.24), (2.3, 1.18), (4.0, 1.22)]
    bm = holey_slab(fr, 0.0, 4.0, ZB, 1.24, -0.2, 0.2, (), top=top, step=1.2, vbot=False)
    A.add(bm, None, mats=[P['stone']] * 6)
    x = -2.02
    while x < 1.98:
        w = rng.uniform(0.28, 0.5)
        xe = min(2.02, x + w)
        c = V(((x + xe) / 2, rng.uniform(-0.03, 0.03), 1.3 + rng.uniform(-0.02, 0.04)))
        st = obox(c, (xe - x - 0.02, 0.46 + rng.uniform(-0.04, 0.06), rng.uniform(0.14, 0.22)),
                  (Matrix.Rotation(rng.uniform(-0.12, 0.12), 3, 'Y') @ Matrix.Rotation(rng.uniform(-0.1, 0.1), 3, 'Z')),
                  bevel=0.03)
        A.add(st, P['stone'] if rng.random() < 0.6 else P['sandstone'])
        x = xe
    A.col((-2.0, -0.23, -0.3), (2.0, 0.23, 1.4))
    return A.finalize()


def build_t_gate(P):
    A = Asset('T_Gate', P, budget=1500)
    w = Wall(A, (-3.0, 0.0), (3.0, 0.0), 6.0,
             [dict(kind='arch', u=3.0, w=4.0, z0=-0.02, z1=3.1, arch='round', ring=True, ring_d=0.34)],
             T=0.6, ends=(True, True), step=1.6, bands=(0.3,))
    dress(A, w)
    A.add(box((-3.08, -0.38, 6.0), (3.08, 0.38, 6.12), bevel=0.02, maxlen=1.6), P['stone'])
    for s_ in (-1, 1):
        sl = bm_prism([(0.0, 0.0), (6.2, 0.0), (6.2, 0.05), (0.0, 0.05)], 0.0, 0.45)
        M = Matrix.Translation((-3.1, 0.0, 6.12)) @ Matrix.Rotation(s_ * math.radians(-28), 4, 'X') @ \
            Matrix.Rotation(math.pi / 2, 4, 'X')
        xform(sl, M)
        if s_ > 0:
            scale(sl, (1, -1, 1), (0, 0, 6.12))
            sl.normal_update()
            bmesh.ops.reverse_faces(sl, faces=sl.faces[:])
        A.add(sl, P['rooftile'], uv=frame_uv((-3.1, 0, 6.12), (1, 0, 0), (0, -s_, 0)))
    A.add(bm_tube([V((-3.1, 0, 6.36)), V((3.1, 0, 6.36))], 0.09, sides=6), P['rooftile'], maxlen=1.6)
    for sx in (-1, 1):
        quoins(A, sx * 3.0, -0.3, sx, -1, 0.0, 5.9, P['sandstone'], h=0.55, bevel=0.0)
    for sx in (-1, 1):
        hinge = sx * 1.95
        ang = sx * math.radians(70)
        R = Matrix.Rotation(ang, 3, 'Z')
        o = V((hinge, 0.2, 0.0))
        bars = [((0.0, 0.0), (-sx * 1.9, 0.0))]
        for k in range(8):
            u = -sx * (0.1 + 1.7 * k / 7)
            A.add(obox(o + R @ V((u, 0.0, 1.25)), (0.022, 0.022, 2.4), R), P['iron'])
        for zz in (0.12, 1.25, 2.4):
            A.add(obox(o + R @ V((-sx * 0.95, 0.0, zz)), (1.9, 0.03, 0.04), R), P['iron'])
    return A.finalize()


def build_t_stair(P):
    """Exterior stone stair: 4 m run rising 3.6 m along +X, its flat back (+Y)
    meant to stand against a wall, balustrade on the open (-Y) side."""
    A = Asset('T_Stair', P, budget=1500)
    stair(A, (-2.6, 0.0), (1, 0), 1.2, 0.0, 3.6, 4.0, kind='stone')
    A.add(box((1.4, -0.6, ZB), (2.6, 0.6, 3.54), maxlen=0.9), P['stucco'])
    A.add(box((1.36, -0.64, 3.54), (2.64, 0.64, 3.6), bevel=0.012), P['stone'])
    A.col((1.4, -0.6, ZB), (2.6, 0.6, 3.6))
    bfr, _ = wall_frame((2.6, -0.52), (-2.7, -0.52))
    bal = holey_slab(bfr, 0.0, 5.3, ZB, 4.5, -0.08, 0.08, (), top=[(0.0, 4.5), (1.25, 4.5), (5.3, 0.9)], vbot=False,
                     step=1.2)
    A.add(bal, None, mats=[P['stucco']] * 6)
    A.ramp(bfr(1.2, 4.5, 0.0), bfr(5.3, 0.9, 0.0), 0.16, thick=0.9)
    A.col((1.4, -0.6, 3.6), (2.6, -0.44, 4.5))
    return A.finalize()


def build_props_all(P):
    for fn in (build_t_egg, build_t_well, build_t_boat, build_t_cypress, build_t_olive, build_t_lamp, build_t_bench,
               build_t_crate, build_t_barrel, build_t_amphora, build_t_cart, build_t_gardenwall, build_t_gate,
               build_t_stair):
        fn(P)


# ============================================================================
# build / export / verify
# ============================================================================
BUILDERS = [
    ('B_Cottage', build_cottage),
    ('B_Workshop', build_workshop),
    ('B_House', build_house),
    ('B_Chapel', build_chapel),
    ('B_Station', build_station),
    ('B_StationPlatform', build_platform),
    ('B_Tower', build_tower),
    ('B_Boathouse', build_boathouse),
    ('B_Loggia', build_loggia),
    ('H_Cliff', build_cliffs),
    ('H_Islet', build_islet),
    ('H_Ridge', build_ridge),
    ('TP_Stucco', build_panel),
    ('TP_Stucco_Fractured', build_panel_fractured),
]
# The street props (T_*) are built by blender/build_street.py into assets/street.glb.
# build_props_all() and the build_t_* functions above are kept as an optional
# starting point for that script; they are not part of town.glb.


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # 'ACTIVE': the baked 'Col' attribute is written as COLOR_0 (the 'MATERIAL'
    # mode wrote a white COLOR_0 and pushed the bake to COLOR_1)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_cameras=False,
                              export_lights=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_extras=False, export_image_format='NONE')


def init_scene(seed=1958):
    """Fresh Blender scene set up for building and AO baking.  Returns the
    palette P.  Used by main() and meant for scripts that import this module
    (e.g. build_street.py): P = build_town.init_scene(); build assets with
    Asset(...).finalize(); build_town.cleanup_scene(); build_town.export(path);
    build_town.pack(path)."""
    global COLL, AO_GROUND
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    SLOT_N.clear()
    AO_GROUND = None
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = AO_SAMPLES
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world = bpy.data.worlds.new('AOWorld')
    COLL = sc.collection
    noise.seed_set(seed)
    return palette()


def cleanup_scene():
    """Drop the AO helper ground plane and unused materials before export."""
    global AO_GROUND
    if AO_GROUND is not None:
        bpy.data.objects.remove(AO_GROUND)
        AO_GROUND = None
    for ob in COLL.objects:
        if ob.parent is None:
            assert ob.location.length < 1e-9 and ob.rotation_euler[:] == (0.0, 0.0, 0.0), ob.name
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)


def pack(path, dst=None):
    """Run the game's post-process (blender/pack_glb.py) on an exported glb."""
    sys.path.insert(0, HERE)
    import pack_glb
    pack_glb.pack(path, dst or path)


# ----------------------------------------------------------------------------
# verification (runs on the packed file the game loads)
# ----------------------------------------------------------------------------
EXPECTED_ROOTS = ['B_Workshop', 'B_Cottage', 'B_House', 'B_Chapel', 'B_Station', 'B_StationPlatform', 'B_Tower',
                  'B_Boathouse', 'B_Loggia', 'TP_Stucco', 'TP_Stucco_Fractured', 'H_Cliff_A', 'H_Cliff_B',
                  'H_Cliff_C', 'H_Islet', 'H_Ridge']
TRI_BUDGET = {'B_': 30000, 'H_Cliff': 15000, 'H_Islet': 15000, 'H_Ridge': 2000, 'TP_Stucco': 2000}
SLOT_KINDS = {'Clock', 'Candle', 'Mirror', 'Anvil', 'Bed', 'BowlerHat', 'Birdcage', 'Pomegranate', 'Drawers', 'Frame',
              'panel', 'light', 'scrap', 'spawn'}
SIZE_LIMIT = 12.0e6


def read_glb(path):
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + ln])
    return js, data, 20 + ln + 8


def accessor(js, data, binoff, idx):
    A = js['accessors'][idx]
    Vw = js['bufferViews'][A['bufferView']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5122: np.int16, 5121: np.uint8, 5120: np.int8}[
        A['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[A['type']]
    isz = np.dtype(dt).itemsize
    stride = Vw.get('byteStride', 0) or n * isz
    start = binoff + Vw.get('byteOffset', 0) + A.get('byteOffset', 0)
    raw = np.frombuffer(data, dtype=np.uint8, count=stride * (A['count'] - 1) + n * isz, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(A['count'], n * isz), strides=(stride, 1))
    arr = np.ascontiguousarray(rows).view(dt).reshape(A['count'], n).astype(np.float64)
    if A.get('normalized') and dt is not np.float32:
        arr /= float(np.iinfo(dt).max)
    return arr


def budget_for(name):
    for k, v in TRI_BUDGET.items():
        if name.startswith(k):
            return v
    return None


def verify(path):
    print('\n==== VERIFY %s ====' % path)
    js, data, binoff = read_glb(path)
    size = len(data)
    errors, warns = [], []
    nodes = js['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i
    roots = [i for i in range(len(nodes)) if i not in parent]
    kids = lambda i: [i] + [k for c in nodes[i].get('children', []) for k in kids(c)]

    def local_m(nd):
        t = V(nd.get('translation', [0, 0, 0]))
        q = nd.get('rotation', [0, 0, 0, 1])
        from mathutils import Quaternion
        R = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
        S = Matrix.Diagonal(V(nd.get('scale', [1, 1, 1])).to_4d())
        return Matrix.Translation(t) @ R @ S
    world = {}

    def world_m(i):
        if i not in world:
            world[i] = (world_m(parent[i]) if i in parent else Matrix.Identity(4)) @ local_m(nodes[i])
        return world[i]
    mats = [m['name'] for m in js.get('materials', [])]
    if js.get('images') or js.get('textures'):
        errors.append('textures are embedded in the glb')
    for m in mats:
        if m.startswith('TX_') and m[3:] not in TEXTURES:
            errors.append('unknown textured material ' + m)
    names = [nodes[i].get('name', '?') for i in roots]
    for n in EXPECTED_ROOTS:
        if n not in names:
            errors.append('missing root ' + n)
    for n in names:
        if n not in EXPECTED_ROOTS:
            warns.append('unexpected root ' + n)
    slot_names = [nd['name'] for nd in nodes if nd.get('name', '').startswith('SLOT_')]
    if len(slot_names) != len(set(slot_names)):
        errors.append('duplicate SLOT names')
    rows = []
    total_tris = 0
    for r in roots:
        rn = nodes[r].get('name', '?')
        nd = nodes[r]
        if any(k in nd and nd[k] != d for k, d in (('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]),
                                                    ('scale', [1, 1, 1]))):
            errors.append('%s root transform is not identity' % rn)
        tris, cols, tricols, slots, chunks = 0, 0, 0, {}, []
        mn = np.array([1e9] * 3)
        mx = -mn
        for i in kids(r):
            n = nodes[i]
            nm = n.get('name', '')
            if nm.startswith('SLOT_'):
                if 'mesh' in n:
                    errors.append('%s is not an empty' % nm)
                parts = nm.split('_')
                if len(parts) != 3 or parts[1] not in SLOT_KINDS or not parts[2].isdigit():
                    errors.append('bad slot name ' + nm)
                slots[parts[1]] = slots.get(parts[1], 0) + 1
                continue
            if 'mesh' not in n:
                continue
            mesh = js['meshes'][n['mesh']]
            t_mesh = sum(js['accessors'][p['indices']]['count'] // 3 for p in mesh['primitives'])
            if '_COL_' in nm:
                if not nm.startswith(rn + '_COL_'):
                    errors.append('%s is not named %s_COL_<n>' % (nm, rn))
                if '_TRI' in nm:
                    tricols += 1
                    if t_mesh > 2500:
                        errors.append('%s trimesh collider has %d tris' % (nm, t_mesh))
                else:
                    cols += 1
                    pos = accessor(js, data, binoff, mesh['primitives'][0]['attributes']['POSITION'])
                    lo, hi = pos.min(0), pos.max(0)
                    on = np.all((np.abs(pos - lo) < 1e-4) | (np.abs(pos - hi) < 1e-4))
                    if not on or len({tuple(np.round(p, 5)) for p in pos}) != 8:
                        errors.append('%s is not an axis-aligned box in its local space' % nm)
                continue
            tris += t_mesh
            if nm.startswith('TP_Stucco_Chunk_'):
                chunks.append((nm, t_mesh))
            for p in mesh['primitives']:
                at = p['attributes']
                mname = mats[p['material']] if 'material' in p else '-'
                if 'COLOR_0' not in at:
                    errors.append('%s/%s has no COLOR_0' % (nm, mname))
                if 'COLOR_1' in at:
                    errors.append('%s/%s still has COLOR_1' % (nm, mname))
                if mname.startswith('TX_'):
                    if 'TEXCOORD_0' not in at:
                        errors.append('%s/%s has no UVs' % (nm, mname))
                pa = js['accessors'][at['POSITION']]
                Mw = world_m(i)
                for cx in (pa['min'][0], pa['max'][0]):
                    for cy in (pa['min'][1], pa['max'][1]):
                        for cz in (pa['min'][2], pa['max'][2]):
                            w = Mw @ V((cx, cy, cz))
                            mn = np.minimum(mn, w[:])
                            mx = np.maximum(mx, w[:])
        total_tris += tris
        b = budget_for(rn)
        if b and tris > b:
            errors.append('%s has %d tris (budget %d)' % (rn, tris, b))
        if rn.startswith('B_'):
            if cols == 0:
                errors.append(rn + ' has no colliders')
            for k in ('light', 'spawn'):
                if not slots.get(k):
                    errors.append('%s has no SLOT_%s' % (rn, k))
        if rn.startswith('H_Cliff') or rn == 'H_Islet':
            if tricols == 0:
                errors.append(rn + ' has no _COL_TRI_ child')
        if rn == 'H_Ridge' and (cols or tricols):
            errors.append('H_Ridge should have no collision')
        if rn == 'TP_Stucco_Fractured':
            if not 12 <= len(chunks) <= 20:
                errors.append('TP_Stucco_Fractured has %d chunks (want 12-20)' % len(chunks))
            for (cn, ct) in chunks:
                if ct >= 300:
                    errors.append('%s has %d tris' % (cn, ct))
        # glTF is Y-up: Blender X = x, Blender Y = -z, Blender Z = y
        dims = (mx[0] - mn[0], mx[2] - mn[2], mn[1], mx[1]) if tris else (0, 0, 0, 0)
        rows.append((rn, dims, tris, cols, tricols, slots))
    # chunk volume = panel volume
    vol = 0.0
    for nd in nodes:
        if nd.get('name', '').startswith('TP_Stucco_Chunk_'):
            pr = js['meshes'][nd['mesh']]['primitives']
            for p in pr:
                pos = accessor(js, data, binoff, p['attributes']['POSITION'])
                idx = accessor(js, data, binoff, p['indices']).astype(np.int64).reshape(-1, 3)
                a, b_, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
                vol += np.einsum('ij,ij->i', a, np.cross(b_, c)).sum() / 6.0
    if abs(vol - 5.76) > 0.06:
        errors.append('TP_Stucco_Fractured chunk volume %.3f != 5.76' % vol)
    if size > SIZE_LIMIT:
        errors.append('file is %.2f MB (limit 12 MB)' % (size / 1e6))
    # table
    print('\n%-20s %15s %13s %7s %9s  %s' % ('root', 'footprint X x Y', 'height (Z)', 'tris', 'colliders', 'slots'))
    for (rn, d, t, c, tc, sl) in rows:
        cstr = '%d' % c + (' +%d tri' % tc if tc else '')
        sstr = ', '.join('%s %d' % (k, v) for k, v in sorted(sl.items())) or '-'
        print('%-20s %6.1f x %6.1f %5.1f..%5.1f %7d %9s  %s' % (rn, d[0], d[1], d[2], d[3], t, cstr, sstr))
    print('\ntotal triangles %d   meshes %d   nodes %d   materials %d   chunk volume %.3f m3' % (
        total_tris, len(js['meshes']), len(nodes), len(mats), vol))
    print('file size (packed): %.2f MB' % (size / 1e6))
    print('materials:', ', '.join(sorted(mats)))
    # re-import to check that empties and the hierarchy survive
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        obs = bpy.data.objects
        n_slots = sum(1 for o in obs if o.name.startswith('SLOT_') and o.type == 'EMPTY')
        if n_slots != len(slot_names):
            errors.append('re-import: %d of %d SLOT empties survived' % (n_slots, len(slot_names)))
        for rn in EXPECTED_ROOTS:
            o = obs.get(rn)
            if o is None or o.parent is not None:
                errors.append('re-import: %s missing or parented' % rn)
                continue
            loc, rq, sc_ = o.matrix_world.decompose()
            if loc.length > 1e-4 or abs(rq.angle) > 1e-4 or (sc_ - V((1, 1, 1))).length > 1e-4:
                errors.append('re-import: %s is not at identity' % rn)
        print('re-import: %d objects, %d SLOT empties' % (len(obs), n_slots))
    except Exception as e:                      # pragma: no cover
        warns.append('re-import failed: %s' % e)
    for w in warns:
        print('  warning: ' + w)
    print('\nCONTRACT CHECK: %s' % ('PASS' if not errors else 'FAIL'))
    for e in errors:
        print('  ' + e)
    return not errors, total_tris, size


def main():
    argv = sys.argv[1:]
    only = None
    out = DEFAULT_OUT
    do_verify = '--no-verify' not in argv
    do_pack = '--no-pack' not in argv
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--out' in argv:
        out = os.path.abspath(argv[argv.index('--out') + 1])
    P = init_scene()
    t0 = time.time()
    for name, fn in BUILDERS:
        if only and name not in only:
            continue
        fn(P)
    cleanup_scene()
    if DEBUG_TRIS:
        for (m, who), n in sorted(DEBUG_TRIS.items(), key=lambda kv: -kv[1])[:40]:
            print('   %6d  %-14s %s' % (n, m, who))
    export(out)
    print('exported %s in %.1fs' % (out, time.time() - t0))
    if do_pack:
        pack(out)
    ok = True
    if do_verify:
        ok = verify(out)[0]
    return 0 if ok else 1


if __name__ == '__main__':
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
