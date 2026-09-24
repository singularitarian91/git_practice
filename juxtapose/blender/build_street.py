#!/usr/bin/env python3
"""
Juxtapose -- street and dressing props for the Soft Desert village (Port Lligat).

Builds the fourteen T_* dressing roots procedurally with bpy/bmesh on top of
the town kit (it imports build_town.py for its helpers, Asset pipeline and AO
bake), exports juxtapose/assets/street.glb, packs it with pack_glb.py and
re-imports the packed file to check the contract.

    python3 juxtapose/blender/build_street.py
    python3 juxtapose/blender/build_street.py --only T_Well,T_Lamp --out /tmp/s.glb
    python3 juxtapose/blender/build_street.py --no-verify
    python3 juxtapose/blender/build_street.py --verify-only [--out path]

The game loads street.glb after town.glb, so these roots replace the town
kit's placeholder T_* props of the same names.

Conventions (as build_town.py)
  * metres, Blender Z-up; every root has an identity transform and its origin
    at ground level in the centre of its footprint; the front faces Blender -Y
    (three.js +Z).  The lamp's bracket, the cart's shafts and the boat's bow
    point to -Y; the garden wall and the stair run along X.
  * TX_<texture> materials are tiled in game from assets/tex (UVs in metres).
    Painted boards (TX_wood) have their UVs turned so the texture's planks run
    along each board, one texture plank per board; oak grain (TX_oak) runs
    along boards and up staves; small dressed sandstone pieces are shifted in
    UV so no mortar joint of the ashlar texture crosses them.
  * COLOR_0 = baked AO x ground grime x tint (build_town.bake_ao).
  * <Root>_COL_<n>: hidden collider boxes; SLOT_light_<n> marks the street
    lamp's lantern.

Budgets (tris) and colliders are listed in BUDGET / COLS and checked by
verify() on the packed file.
"""
import bpy
import bmesh
import math
import random
import os
import sys
import time
import importlib
from mathutils import Vector as V, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(PROJ, 'assets', 'street.glb')
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def _import(name, tries=6, wait=60):
    """build_town.py is edited in parallel by the buildings artist; if it is
    caught mid-edit (it fails to import), wait a minute and try again."""
    for k in range(tries):
        try:
            return importlib.import_module(name)
        except Exception as e:          # noqa: BLE001 - any import failure
            sys.modules.pop(name, None)
            if k == tries - 1:
                raise
            print('%s.py failed to import (%s: %s); retrying in %ds'
                  % (name, type(e).__name__, str(e).split('\n')[0], wait))
            sys.stdout.flush()
            time.sleep(wait)


bt = _import('build_town')
pack_glb = _import('pack_glb')

TAU = math.tau
ZB = bt.ZB
Asset, Frame, Hole = bt.Asset, bt.Frame, bt.Hole
box, obox, beam = bt.box, bt.obox, bt.beam
bm_lathe, bm_tube, bm_prism, bm_ico = bt.bm_lathe, bt.bm_tube, bt.bm_prism, bt.bm_ico
displace, box_uv = bt.displace, bt.box_uv
tx, plain = bt.tx, bt.plain
xform, move, scale, rot, set_smooth = bt.xform, bt.move, bt.scale, bt.rot, bt.set_smooth
hexa, holey_slab, prism_yz = bt.hexa, bt.holey_slab, bt.prism_yz
lerp, clamp, smoothstep = bt.lerp, bt.clamp, bt.smoothstep

# hard caps from the brief, and the collider count each root is built with
BUDGET = {'T_Well': 1500, 'T_Lamp': 900, 'T_Bench': 900, 'T_Crate': 500, 'T_Barrel': 900, 'T_Amphora': 900,
          'T_Cart': 1500, 'T_GardenWall': 1000, 'T_Cypress': 3000, 'T_Olive': 3000, 'T_Egg': 800,
          'T_Gate': 2500, 'T_Boat': 2500, 'T_Stair': 1500}
COLS = {'T_Well': 6, 'T_Lamp': 2, 'T_Bench': 2, 'T_Crate': 1, 'T_Barrel': 1, 'T_Amphora': 1, 'T_Cart': 3,
        'T_GardenWall': 1, 'T_Cypress': 1, 'T_Olive': 1, 'T_Egg': 1, 'T_Gate': 10, 'T_Boat': 3, 'T_Stair': 10}
GATE_OPENING = (3.6, 4.4)     # masonry opening: pier spacing, crown height
GATE_RING = 0.04              # the voussoirs and imposts stand this far inside it: clear 3.52 x 4.36 m
                              # (brief: >= 3.4 x 4.2; the game also uses the gate at 1.5x as a tunnel mouth)


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
def palette():
    P = {n: tx(n) for n in ('stucco', 'stone', 'sandstone', 'schist', 'wood', 'oak', 'iron')}
    P['glass'] = plain('LampGlass', '#ffe4bc', 0.0, 0.25, emit='#ffcf8a', strength=3.0)
    P['cypress'] = plain('CypressLeaf', '#2f4a2c', 0.0, 0.85)
    P['cybark'] = plain('CypressBark', '#5d4a3b', 0.0, 0.95)
    P['olive'] = plain('OliveLeaf', '#7d8c63', 0.0, 0.8)
    P['obark'] = plain('OliveBark', '#857f74', 0.0, 0.95)
    P['egg'] = plain('EggShell', '#f4f0e7', 0.0, 0.35)
    P['clay'] = plain('Terracotta', '#c2714a', 0.0, 0.78)
    P['rope'] = plain('Rope', '#a58f68', 0.0, 0.95)
    P['water'] = plain('WellWater', '#17211f', 0.0, 0.06)
    P['hull'] = plain('HullWhite', '#e8e3d7', 0.0, 0.62)
    P['stripe'] = plain('HullStripe', '#4e8984', 0.0, 0.62)
    P['bottom'] = plain('HullBottom', '#8e4a33', 0.0, 0.72)
    P['sack'] = plain('Sackcloth', '#a8916b', 0.0, 0.95)
    P['sail'] = plain('SailCloth', '#d9cdb3', 0.0, 0.9)
    P['cork'] = plain('Cork', '#b98a52', 0.0, 0.9)
    P['leaf'] = plain('PotPlant', '#4a6b37', 0.0, 0.8)
    P['flower'] = plain('Geranium', '#c7353a', 0.0, 0.6)
    return P


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
PLANK = 0.15            # TX_wood: ten painted planks per 1.5 m tile, gaps at U = k * 0.15 m
DRESSED = (0.42, 0.25)  # TX_sandstone: a stone centred here sits inside one 1 x 0.5 m block (both V flips)
HEX = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]


def nz(p, off, s=1.0):
    return noise.noise(V(p) * s + off)


def noff(rng):
    return V((rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 100)))


def local_uv(c, du=DRESSED[0], dv=DRESSED[1]):
    """Box projection about a local centre, shifted (default: into one ashlar block)."""
    c = V(c)

    def f(co, n):
        u, v = box_uv(co - c, n)
        return (u + du, v + dv)
    return f


def cyl_uv2(center, radius=None, vgrain=False, du=0.0, dv=0.0):
    """Cylindrical UVs in metres that stay continuous inside every face (the
    angle is unwrapped about the face's own azimuth, so no face straddles the
    +-pi seam).  radius: arc-length radius (pick one whose circumference is a
    whole number of texture tiles for a seamless wrap).  vgrain: swap U/V
    (oak grain running up staves)."""
    c = V(center)

    def f(co, n):
        d = co - c
        nr = math.hypot(n.x, n.y)
        if abs(n.z) > 0.8 or nr < 1e-6:
            u, v = box_uv(co, n)
            return (u + du, v + dv)
        aref = math.atan2(n.y, n.x)
        r = math.hypot(d.x, d.y)
        if r < 1e-6:
            a = aref
        else:
            a = math.atan2(d.y, d.x)
            da = (a - aref + math.pi) % TAU - math.pi
            if abs(da) > math.pi / 2:          # inward-facing surface
                aref += math.pi
                da = (a - aref + math.pi) % TAU - math.pi
            a = aref + da
        rr = radius if radius else max(r, 0.05)
        u, v = a * rr, d.z
        if vgrain:
            u, v = v, u
        return (u + du, v + dv)
    return f


def board_uv(O, Ldir, Wdir, k=0, tex='wood'):
    """UVs for a board lying along Ldir (width along Wdir).  TX_wood: V runs
    along the board and U across it, centred on texture plank k, so the
    painted planks follow the boards; TX_oak: the grain (texture U) runs along
    the board."""
    O, Ld, Wd = V(O), V(Ldir).normalized(), V(Wdir).normalized()
    Td = Ld.cross(Wd)

    def f(co, n):
        d = co - O
        l, w, t = d.dot(Ld), d.dot(Wd), d.dot(Td)
        al, aw, at = abs(n.dot(Ld)), abs(n.dot(Wd)), abs(n.dot(Td))
        if al >= aw and al >= at:
            a, b = w, t
        elif aw >= at:
            a, b = t, l
        else:
            a, b = w, l
        if tex == 'wood':
            return (a + (k + 0.5) * PLANK, b)
        return (b, a + 0.37 * k)
    return f


def board(p0, p1, w, t, up=(0, 0, 1), bev=0.007, cuts=0, sag=0.0):
    """A board from p0 to p1 (centre line), w wide, t thick along `up`, long
    edges chamfered; `cuts` extra rings let it sag in the middle.  Returns
    (bm, length axis, width axis)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    L = d.length
    X = d.normalized()
    Z = V(up) - X * V(up).dot(X)
    Z.normalize()
    Y = Z.cross(X)
    bm = bt.bm_box((L, w, t), (0, 0, 0), bevel=bev, axis=0) if bev > 0 else bt.bm_box((L, w, t))
    if cuts:
        bt.grid_cut(bm, 0, [-L / 2 + L * k / (cuts + 1) for k in range(1, cuts + 1)])
    if sag:
        for v in bm.verts:
            v.co.z -= sag * math.sin(math.pi * clamp((v.co.x + L / 2) / L))
    M = Matrix((X, Y, Z)).transposed().to_4x4()
    M.translation = (p0 + p1) / 2
    xform(bm, M)
    return bm, X, Y


def rect_ring(hx, hy, c=0.0):
    """Outline for ring_lathe: a rectangle grown by the profile offset o,
    optionally with chamfered corners; o=None (or a vanishing rectangle) is
    an apex."""
    def f(o):
        if o is None:
            return [(0.0, 0.0)]
        X, Y = hx + o, hy + o
        if X <= 1e-6 or Y <= 1e-6:
            return [(0.0, 0.0)]
        if c <= 0:
            return [(-X, -Y), (X, -Y), (X, Y), (-X, Y)]
        cc = min(c, X * 0.8, Y * 0.8)
        return [(-X + cc, -Y), (X - cc, -Y), (X, -Y + cc), (X, Y - cc), (X - cc, Y), (-X + cc, Y), (-X, Y - cc),
                (-X, -Y + cc)]
    return f


SQ = rect_ring(0.0, 0.0)          # square lathe: profile offsets are half-widths


def ring_lathe(ring, prof, cap_top=True, cap_bot=False, smooth=True):
    """Sweep a closed CCW outline ring(o) up a profile [(o, z)] (bottom ->
    top), like bm_lathe with an arbitrary cross-section."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for (x, y) in ring(o)] for (o, z) in prof]
    for a, b in zip(rings, rings[1:]):
        n = max(len(a), len(b))
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
    if cap_top and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    if cap_bot and len(rings[0]) > 2:
        bm.faces.new(list(reversed(rings[0])))
    set_smooth(bm, smooth)
    return bm


def ring_grid(N, rows, rfun, mfun=None, inner=False, phase=0.0):
    """Cylindrical band of N columns; rows(i) -> [z...] for column i (same
    count for all); rfun(a, z) -> radius; mfun(i, j, a, z) -> material index."""
    bm = bmesh.new()
    cols = []
    for i in range(N):
        a = phase + TAU * i / N
        cols.append([bm.verts.new((rfun(a, z) * math.cos(a), rfun(a, z) * math.sin(a), z)) for z in rows(i)])
    for i in range(N):
        i2 = (i + 1) % N
        for j in range(len(cols[i]) - 1):
            vs = [cols[i][j], cols[i2][j], cols[i2][j + 1], cols[i][j + 1]]
            if inner:
                vs.reverse()
            f = bm.faces.new(vs)
            if mfun:
                f.material_index = mfun(i, j, phase + TAU * (i + 0.5) / N, sum(v.co.z for v in vs) / 4)
    set_smooth(bm, True)
    return bm


def drop_faces(bm, test):
    bm.normal_update()
    fs = [f for f in bm.faces if test(f)]
    if fs:
        bmesh.ops.delete(bm, geom=fs, context='FACES_ONLY')
    return bm


def rock(c, size, rng, jit=0.14, bev=0.22, R=None, edges='all', drop_bottom=False):
    """An irregular chamfered block: eight jittered corners, bevelled edges
    ('all', 'top' = top face only, 'topvert' = top face and uprights)."""
    sx, sy, sz = size
    pts = [V(((ix - 0.5) * sx + rng.uniform(-jit, jit) * sx, (iy - 0.5) * sy + rng.uniform(-jit, jit) * sy,
              (iz - 0.5) * sz + rng.uniform(-jit, jit) * sz * 0.6)) for (ix, iy, iz) in HEX]
    bm = hexa(pts)
    if bev > 0:
        es = list(bm.edges)
        if edges == 'top':
            es = [e for e in es if all(v.co.z > 0 for v in e.verts)]
        elif edges == 'topvert':
            es = [e for e in es if not all(v.co.z < 0 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=es, offset=bev * min(sx, sy, sz), offset_type='OFFSET', segments=1, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    if drop_bottom:
        drop_faces(bm, lambda f: f.normal.z < -0.85 and f.calc_center_median().z < -sz * 0.3)
    if R is not None:
        xform(bm, R.to_4x4() if len(R) == 3 else R)
    move(bm, c)
    set_smooth(bm, True)
    return bm


def proud_stone(c, N, U, w, h, d, rng, sides=6):
    """A rubble stone standing d proud of a wall face at c (outward normal N,
    U along the face): an irregular frustum with a domed face; its base sits
    1.5 cm inside the wall so only the face and sides show."""
    N = V(N).normalized()
    U = (V(U) - N * V(U).dot(N)).normalized()
    W = N.cross(U)
    c = V(c)
    bm = bmesh.new()
    ph = rng.uniform(0, TAU)
    base, top = [], []
    for k in range(sides):
        a = ph + TAU * k / sides
        rr = 1.0 + rng.uniform(-0.2, 0.12)
        x, y = math.cos(a) * w / 2 * rr, math.sin(a) * h / 2 * rr
        base.append(bm.verts.new(c + U * x + W * y - N * 0.015))
        top.append(bm.verts.new(c + U * (x * 0.74) + W * (y * 0.74) + N * (d * rng.uniform(0.62, 0.85))))
    tip = bm.verts.new(c + N * (d * 1.3) + U * (rng.uniform(-0.1, 0.1) * w) + W * (rng.uniform(-0.1, 0.1) * h))
    ctr = c + N * (d * 0.4)
    for k in range(sides):
        k2 = (k + 1) % sides
        for vs in ([base[k], base[k2], top[k2], top[k]], [top[k], top[k2], tip]):
            f = bm.faces.new(vs)
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - ctr) < 0:
                f.normal_flip()
    set_smooth(bm, True)
    return bm


def flake(bm, fr, mi, mask, new_mi, jit=0.06, off=V(), proud=0.0):
    """Limewash flaking off rubble: jitter the grid of one side of a
    holey_slab (faces of material index mi) in its plane, then give the faces
    whose centre passes mask(u, v) material new_mi; `proud` lifts the washed
    patches a few millimetres."""
    O, U, Vv = fr.O, fr.U, fr.V
    fs = [f for f in bm.faces if f.material_index == mi]
    fset = set(fs)
    inner = [v for v in {v for f in fs for v in f.verts} if all(lf in fset for lf in v.link_faces)]
    for v in inner:
        d = v.co - O
        p = V((d.dot(U) * 2.6, d.dot(Vv) * 2.6, mi * 7.0)) + off
        v.co += U * (jit * noise.noise(p)) + Vv * (jit * noise.noise(p + V((31.4, 17.2, 5.5))))
    for f in fs:
        d = f.calc_center_median() - O
        if mask(d.dot(U), d.dot(Vv)):
            f.material_index = new_mi
    if proud:
        bm.normal_update()
        for v in inner:
            if all(lf.material_index == new_mi for lf in v.link_faces):
                v.co += v.normal * proud


def lime_band(fr, u0, u1, top_fn, bot_fn, surf_fn, n=28, drips=(), lift=0.009, facing=None):
    """A coat of limewash hanging from a wall top: a curtain between z = top_fn(u)
    and a ragged lower edge bot_fn(u), with drip tongues (u, width, length),
    laid `lift` in front of the (bulging) wall surface surf_fn(u, z) -> point.
    It faces `facing` (default -fr.T, the frame's front)."""
    facing = V(facing) if facing is not None else -fr.T
    us = {u0 + (u1 - u0) * k / (n - 1) for k in range(n)}
    for (du, w, _) in drips:
        us.update((du - w / 2, du, du + w / 2))
    us = sorted(u for u in us if u0 <= u <= u1)

    def bot(u):
        z = bot_fn(u)
        for (du, w, ln) in drips:       # rounded tongues
            z -= ln * math.sqrt(max(0.0, 1.0 - (abs(u - du) / (w / 2)) ** 2))
        return z
    bm = bmesh.new()
    cols = []
    for u in us:
        zt, zb = top_fn(u), min(bot(u), top_fn(u) - 0.02)
        cols.append([bm.verts.new(surf_fn(u, z, lift)) for z in (zb, (zb + zt) / 2, zt)])
    for a, b in zip(cols, cols[1:]):
        for j in range(2):
            f = bm.faces.new([a[j], b[j], b[j + 1], a[j + 1]])
            f.normal_update()
            if f.normal.dot(facing) < 0:
                f.normal_flip()
    set_smooth(bm, True)
    return bm


def blob(c, N, U, rx, ry, rng, sides=9, lift=0.004):
    """A flat irregular patch (flaked lime showing the stone) facing N."""
    N = V(N).normalized()
    U = (V(U) - N * V(U).dot(N)).normalized()
    W = N.cross(U)
    bm = bmesh.new()
    ctr = bm.verts.new(V(c) + N * lift)
    ph = rng.uniform(0, TAU)
    ring = []
    for k in range(sides):
        a = ph + TAU * k / sides
        rr = 1.0 + 0.35 * math.sin(2 * a + ph) + rng.uniform(-0.2, 0.2)
        ring.append(bm.verts.new(V(c) + N * lift + U * (math.cos(a) * rx * rr) + W * (math.sin(a) * ry * rr)))
    for k in range(sides):
        f = bm.faces.new([ctr, ring[k], ring[(k + 1) % sides]])
        f.normal_update()
        if f.normal.dot(N) < 0:
            f.normal_flip()
    set_smooth(bm, True)
    return bm


def spiral(c, U, W, r0, r1, a0, turns, n):
    """Points of a flat spiral about c in the plane (U, W)."""
    c, U, W = V(c), V(U), V(W)
    pts = []
    for k in range(n + 1):
        t = k / n
        a = a0 + TAU * turns * t
        r = r0 + (r1 - r0) * t
        pts.append(c + U * (r * math.cos(a)) + W * (r * math.sin(a)))
    return pts


def gnarl_tube(pts, radii, sides=7, flutes=3, famp=0.16, twist=1.4, namp=0.1, off=V(), caps=False):
    """A tube along pts whose cross-section is fluted and twists along its
    length, with lumpy noise: old olive wood."""
    pts = [V(p) for p in pts]
    n = len(pts)
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = V((0, 0, 1)) if abs(T[0].z) < 0.9 else V((1, 0, 0))
    Nn = (ref - T[0] * ref.dot(T[0])).normalized()
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = T[i]
        Nn = (Nn - t * Nn.dot(t))
        Nn = Nn.normalized() if Nn.length > 1e-9 else t.orthogonal().normalized()
        B = t.cross(Nn)
        s = i / max(1, n - 1)
        ring = []
        for k in range(sides):
            th = TAU * k / sides
            dirv = Nn * math.cos(th) + B * math.sin(th)
            rr = radii[i] * (1.0 + famp * math.cos(flutes * th + twist * TAU * s)
                             + namp * noise.noise(p * 2.3 + dirv * 0.8 + off))
            ring.append(bm.verts.new(p + dirv * rr))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            j2 = (j + 1) % sides
            bm.faces.new([a[j], a[j2], b[j2], b[j]])
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    set_smooth(bm, True)
    return bm


def catmull(pts, n):
    """Resample a polyline as a Catmull-Rom spline through its points (n samples)."""
    P_ = [V(p) for p in pts]
    P_ = [P_[0] * 2 - P_[1]] + P_ + [P_[-1] * 2 - P_[-2]]
    out = []
    segs = len(pts) - 1
    for k in range(n):
        t = k / (n - 1) * segs
        i = min(int(t), segs - 1)
        u = t - i
        p0, p1, p2, p3 = P_[i], P_[i + 1], P_[i + 2], P_[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
                          (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u))
    return out


def soft_normals(root, key, centre_fn, blend=0.7):
    """Foliage shading: bend the normals of the child mesh <root>_<key> toward
    the canopy volume (centre_fn(co) -> the point they radiate from), so the
    clumps shade as one soft mass while the silhouette and the baked AO keep
    the lumps.  Runs after the AO bake, so the bake is unaffected."""
    ob = next((o for o in root.children if o.name == root.name + '_' + key), None)
    if ob is None:
        return
    me = ob.data
    vco = [v.co.copy() for v in me.vertices]
    out = []
    for lp in me.loops:
        co = vco[lp.vertex_index]
        n0 = V(lp.normal)
        radial = co - centre_fn(co)
        radial = radial.normalized() if radial.length > 1e-6 else n0
        n = (radial * blend + n0 * (1.0 - blend)).normalized()
        out.append(n)
    me.normals_split_custom_set(out)


def lumpy(c, r, sc, off, amp=0.24, subdiv=2):
    """A clump of foliage: a displaced, squashed icosphere."""
    bm = bm_ico(r, subdiv, c, sc=sc)
    cc = V(c)

    def f(co, n):
        k = 0.8 * noise.noise((co - cc) * (1.8 / r) + off) + 0.2 * noise.noise((co - cc) * (3.4 / r) + off * 1.7)
        return co + n * (r * amp * k)
    return displace(bm, f)


# ============================================================================
# T_Well: rubble wellhead, whitewashed rim and coping, two posts, iron hoop,
# pulley, rope and bucket
# ============================================================================
def build_well(P):
    A = Asset('T_Well', P, budget=BUDGET['T_Well'])
    A.ao_dist = 2.0
    rng = random.Random(21)
    off = noff(rng)
    N = 20
    RU = 6.0 / TAU               # 6 m of arc = 3 stone tiles = 2 stucco tiles: no texture seam
    mats = [P['stone'], P['stucco']]

    def r_out(a, z):
        k = nz((math.cos(a) * 1.7, math.sin(a) * 1.7, z * 2.3), off)
        return 0.925 - 0.035 * clamp(z / 0.78) + 0.05 * clamp(-z / 0.3) + 0.014 * k

    wline = []
    for i in range(N):
        a = TAU * i / N
        drip = 0.17 if rng.random() < 0.3 else 0.0
        wline.append(0.55 + 0.08 * nz((math.cos(a) * 2.2, math.sin(a) * 2.2, 7.0), off) - drip)

    def rows_out(i):
        return [-0.3, 0.0, 0.25 + 0.04 * nz((i * 0.7, 3.0, 1.0), off), wline[i], 0.785]
    A.add(ring_grid(N, rows_out, r_out, mfun=lambda i, j, a, z: 1 if j == 3 else 0), None, mats=mats,
          uv=cyl_uv2((0, 0, 0), RU))

    def r_in(a, z):
        return 0.625 + 0.01 * nz((math.cos(a) * 2.0, math.sin(a) * 2.0, z * 2.0 + 5.0), off)
    A.add(ring_grid(N, lambda i: [0.19, 0.52 + 0.08 * nz((i * 0.9, 1.0, 2.0), off), 0.775], r_in,
                    mfun=lambda i, j, a, z: 1 if j == 1 else 0, inner=True), None, mats=mats,
          uv=cyl_uv2((0, 0, 0), RU))
    # whitewashed bullnose coping, laid by hand
    cop = bm_lathe([(0.955, 0.77), (0.985, 0.83), (0.95, 0.895), (0.68, 0.915), (0.605, 0.87), (0.6, 0.77)],
                   segs=N, cap=False)
    displace(cop, lambda co, n: co + V((0, 0, 0.01 * nz(co * 1.9, off))) + n * (0.005 * nz(co * 4.0 + V((3, 1, 2)), off)))
    A.add(cop, P['stucco'], uv=cyl_uv2((0, 0, 0), RU))
    A.add(bt.disc(0.64, 0.19, N), P['water'])
    # two whitewashed posts with slate caps
    for sx in (-1, 1):
        cx = sx * 0.775
        post = ring_lathe(rect_ring(0.14, 0.14, 0.03), [(0.0, 0.84), (-0.015, 1.9)], cap_top=False)
        A.add(move(post, (cx, 0, 0)), P['stucco'], uv=local_uv((cx, 0, 1.3), 0.0, 0.0))
        cap = ring_lathe(rect_ring(0.14, 0.14, 0.012), [(-0.02, 1.9), (0.05, 1.9), (0.05, 1.962), (0.028, 1.985),
                                                         (None, 2.1)], cap_top=False)
        A.add(move(cap, (cx, 0, 0)), P['schist'])
    # wrought-iron hoop with two scrolls, pulley on a yoke
    hoop = [V((0.775 * math.cos(th), 0.0, 2.06 + 0.5 * math.sin(th))) for th in [math.pi * k / 12 for k in range(13)]]
    A.add(bm_tube(hoop, 0.017, sides=4), P['iron'])
    for sx in (-1, 1):        # U = (sx, 0, 0) mirrors the scroll for the left side
        pts = spiral((sx * 0.5, 0.0, 2.2), (sx, 0, 0), (0, 0, 1), 0.15, 0.04, math.radians(38), -1.15, 10)
        A.add(bm_tube(pts, 0.011, sides=3), P['iron'])
    pc = V((0.0, 0.0, 2.36))
    wheel = bm_lathe([(0.0, -0.022), (0.105, -0.022), (0.084, 0.0), (0.105, 0.022), (0.0, 0.022)], segs=10)
    rot(wheel, math.pi / 2, 'X')
    A.add(move(wheel, pc), P['iron'])
    for sy in (-1, 1):
        A.add(box((-0.012, sy * 0.036 - 0.005, pc.z - 0.025), (0.012, sy * 0.036 + 0.005, 2.575)), P['iron'])
    A.add(box((-0.022, -0.043, 2.548), (0.022, 0.043, 2.585)), P['iron'])
    # rope: bucket -> over the pulley -> tied off on the right post -> tail; a spare coil on the coping
    rope = [V((-0.086, 0.0, 1.655)), V((-0.086, 0.0, 2.36))]
    rope += [pc + V((0.088 * math.cos(th), 0.0, 0.088 * math.sin(th))) for th in (math.pi * 0.72, math.pi * 0.5,
                                                                                  math.pi * 0.28)]
    rope += [V((0.086, 0.0, 2.36)), V((0.628, 0.0, 1.53)), V((0.62, -0.035, 1.46)), V((0.635, -0.07, 1.28)),
             V((0.618, -0.1, 1.1))]
    A.add(bm_tube(rope, 0.011, sides=4), P['rope'])
    A.add(box((0.618, -0.032, 1.5), (0.65, 0.032, 1.53)), P['iron'])            # cleat
    coil = bm_lathe([(0.055, 0.0), (0.115, 0.0), (0.12, 0.034), (0.07, 0.046), (0.055, 0.0)], segs=10, cap=False)
    A.add(move(coil, (0.43, -0.7, 0.9)), P['rope'])
    # oak bucket (flat staves), two iron hoops, a bail
    Mb = Matrix.Translation((-0.086, 0.0, 1.245)) @ Matrix.Rotation(0.06, 4, 'Y')
    body = bm_lathe([(0.0, 0.0), (0.108, 0.0), (0.142, 0.27), (0.127, 0.27), (0.097, 0.035), (0.0, 0.035)], segs=10)
    for e in body.edges:
        a, b = e.verts[0].co, e.verts[1].co
        if abs(a.x * b.y - a.y * b.x) < 1e-7 and (a - b).length > 1e-6:
            e.smooth = False
    xform(body, Mb)
    A.add(body, P['oak'], uv=cyl_uv2(Mb.translation, None, vgrain=True))
    for z in (0.05, 0.215):
        r = 0.108 + 0.034 * z / 0.27 + 0.004
        A.add(xform(bm_lathe([(r, z - 0.017), (r + 0.002, z + 0.017), (r - 0.006, z + 0.019)], segs=10, cap=False), Mb),
              P['iron'])
    bail = [V((0.146 * math.cos(th), 0.0, 0.24 + 0.17 * math.sin(th))) for th in [math.pi * k / 6 for k in range(7)]]
    A.add(xform(bm_tube(bail, 0.008, sides=3), Mb), P['iron'])
    # a worn schist step for drawing water
    A.add(rock((0.0, -1.14, 0.02), (0.9, 0.38, 0.2), rng, jit=0.06, bev=0.3, R=Matrix.Rotation(0.06, 3, 'Z'),
               drop_bottom=True), P['schist'])
    for k in range(6):
        a = TAU * (k + 0.5) / 6
        A.col_obox(V((0.79 * math.cos(a), 0.79 * math.sin(a), 0.31)), (0.34, 1.11, 1.22), Matrix.Rotation(a, 3, 'Z'))
    return A.finalize()


# ============================================================================
# T_Lamp: moulded sandstone foot, cast-iron post, scrolled bracket, farol
# ============================================================================
def build_lamp(P):
    A = Asset('T_Lamp', P, budget=BUDGET['T_Lamp'])
    A.ao_dist = 1.2
    A.add(ring_lathe(rect_ring(0.21, 0.21, 0.035), [(0.0, -0.25), (0.0, 0.34)], cap_top=False), P['sandstone'],
          uv=local_uv((0, 0, 0.17)))
    A.add(ring_lathe(SQ, [(0.2, 0.34), (0.232, 0.35), (0.232, 0.39), (0.19, 0.41), (0.14, 0.47), (0.11, 0.5),
                          (0.11, 0.525)]), P['sandstone'], uv=local_uv((0, 0, 0.44), 1.05, 0.72))
    post = [(0.104, 0.5), (0.104, 0.56), (0.07, 0.68), (0.056, 0.9), (0.068, 0.93), (0.068, 0.98), (0.05, 1.0),
            (0.044, 2.95), (0.058, 2.98), (0.058, 3.11), (0.04, 3.14), (0.038, 3.3), (0.055, 3.33), (0.026, 3.4),
            (0.042, 3.46), (0.0, 3.6)]
    A.add(bm_lathe(post, segs=8, cap=False), P['iron'])
    # bracket toward the front (-Y): arm with a curled tip, a big brace scroll, a small scroll at the post
    arm = [V((0, -0.03, 3.08)), V((0, -0.25, 3.13)), V((0, -0.45, 3.15)), V((0, -0.6, 3.14))]
    arm += spiral((0, -0.655, 3.075), (0, -1, 0), (0, 0, 1), 0.07, 0.022, math.radians(60), -0.95, 6)[1:]
    A.add(bm_tube(arm, 0.017, sides=4), P['iron'])
    brace = [V((0, -0.04 - 0.4 * math.sin(t * math.pi / 2), 2.72 + 0.36 * (1 - math.cos(t * math.pi / 2))))
             for t in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)]
    brace += spiral((0, -0.36, 3.0), (0, -1, 0), (0, 0, 1), 0.1, 0.02, math.radians(40), 1.05, 9)[1:]
    A.add(bm_tube(brace, 0.013, sides=4), P['iron'])
    A.add(bm_tube(spiral((0, -0.13, 2.99), (0, -1, 0), (0, 0, 1), 0.105, 0.02, math.radians(92), -1.0, 8), 0.01,
                  sides=3), P['iron'])
    # the lantern (a square farol), hanging from the arm
    lx, ly = 0.0, -0.6
    lan = []
    lan.append((ring_lathe(SQ, [(0.09, 2.5), (0.13, 2.82)], cap_top=False), P['glass']))
    lan.append((ring_lathe(SQ, [(0.0, 2.36), (0.022, 2.39), (0.03, 2.42), (0.1, 2.49), (0.125, 2.5), (0.125, 2.512)]),
                P['iron']))
    lan.append((ring_lathe(SQ, [(0.13, 2.81), (0.178, 2.845), (0.178, 2.866), (0.04, 2.975), (0.028, 2.985),
                                (0.045, 3.02), (0.03, 3.05), (0.0, 3.07)], cap_top=False), P['iron']))
    for sx in (-1, 1):
        for sy in (-1, 1):
            lan.append((beam((sx * 0.09, sy * 0.09, 2.5), (sx * 0.13, sy * 0.13, 2.82), 0.016, 0.016, bevel=0.0,
                             maxlen=None), P['iron']))
    for bm, m in lan:
        A.add(move(bm, (lx, ly, 0)), m)
    hook = [V((lx, ly, 3.13)), V((lx + 0.02, ly, 3.11)), V((lx, ly, 3.087)), V((lx - 0.012, ly, 3.066))]
    A.add(bm_tube(hook, 0.007, sides=3), P['iron'])
    A.slot('light', (lx, ly, 2.66))
    A.col((-0.22, -0.22, -0.25), (0.22, 0.22, 0.52))
    A.col((-0.07, -0.07, 0.52), (0.07, 0.07, 3.45))
    return A.finalize()


# ============================================================================
# T_Bench: whitewashed masonry ends, faded blue-green slats
# ============================================================================
def build_bench(P):
    A = Asset('T_Bench', P, budget=BUDGET['T_Bench'])
    A.ao_dist = 1.0
    rng = random.Random(33)
    prof = [(-0.27, -0.12), (-0.285, 0.12), (-0.29, 0.26), (-0.275, 0.345), (-0.245, 0.385), (-0.2, 0.395),
            (0.1, 0.395), (0.14, 0.44), (0.168, 0.6), (0.195, 0.77), (0.213, 0.855), (0.248, 0.895), (0.295, 0.892),
            (0.325, 0.852), (0.333, 0.62), (0.318, 0.3), (0.3, -0.12)]
    for sx in (-1, 1):
        pts = [(y + rng.uniform(-0.008, 0.008), z + (rng.uniform(-0.006, 0.006) if z > 0 else 0.0)) for y, z in prof]
        x0, x1 = (0.74, 0.94) if sx > 0 else (-0.94, -0.74)
        end = prism_yz(pts, x0, x1)
        es = [e for e in end.edges if not all(v.co.z < -0.1 for v in e.verts)]
        bmesh.ops.bevel(end, geom=es, offset=0.018, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
        drop_faces(end, lambda f: f.normal.z < -0.9 and f.calc_center_median().z < -0.1)
        set_smooth(end, True)
        A.add(end, P['stucco'], uv=local_uv((sx * 0.84, 0, 0.4), 0.0, 0.0))
    for k, y in enumerate((-0.215, -0.08, 0.055)):
        bm, X, Y = board((-1.0, y, 0.4175), (1.0, y, 0.4175), 0.125, 0.045, cuts=2, sag=0.012)
        A.add(bm, P['wood'], uv=board_uv((-1.0, y, 0.4175), X, Y, k=2 * k + 1))
    b = V((0.0, 0.06, 0.41)).normalized()
    nb = V((0.0, -b.z, b.y))
    for k, s in enumerate((0.3, 0.78)):
        c = V((0.0, 0.14 + 0.06 * s, 0.43 + 0.41 * s)) + nb * 0.023
        bm, X, Y = board(c - V((1.0, 0, 0)), c + V((1.0, 0, 0)), 0.12, 0.04, up=nb, cuts=2, sag=0.006)
        A.add(bm, P['wood'], uv=board_uv(c, X, Y, k=6 + k))
    # iron straps bolting the back slats to the ends
    for sx in (-1, 1):
        for s in (0.3, 0.78):
            c = V((sx * 0.84, 0.14 + 0.06 * s, 0.43 + 0.41 * s)) + nb * 0.047
            A.add(obox(c, (0.05, 0.1, 0.006), Matrix((V((1, 0, 0)), b, nb)).transposed()), P['iron'])
    A.col((-1.0, -0.31, -0.12), (1.0, 0.18, 0.44))
    A.col((-1.0, 0.12, 0.44), (1.0, 0.32, 0.89))
    return A.finalize()


# ============================================================================
# T_Crate: slatted fish crate with a lump of net and two floats
# ============================================================================
def build_crate(P):
    A = Asset('T_Crate', P, budget=BUDGET['T_Crate'])
    A.ao_dist = 0.8
    rng = random.Random(44)
    Lx, Wy, H, th = 0.9, 0.58, 0.46, 0.018
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (Lx / 2 - th - 0.021), sy * (Wy / 2 - th - 0.021)
            bm = drop_faces(box((cx - 0.021, cy - 0.021, 0.012), (cx + 0.021, cy + 0.021, H - 0.014)),
                            lambda f: f.normal.z < -0.9)
            A.add(bm, P['oak'], uv=board_uv((cx, cy, 0), (0, 0, 1), (1, 0, 0), tex='oak'))
    k = 0
    for sy in (-1, 1):
        y = sy * (Wy / 2 - th / 2)
        for (z0, z1) in ((0.015, 0.125), (0.172, 0.282), (0.33, 0.44)):
            dz = rng.uniform(-0.004, 0.004)
            x0 = -Lx / 2 + rng.uniform(0.0, 0.006)
            x1 = Lx / 2 - (0.09 if (sy > 0 and z0 > 0.3) else rng.uniform(0.0, 0.006))    # one broken slat
            zc = (z0 + z1) / 2 + dz
            bm, X, Y = board((x0, y, zc), (x1, y, zc), z1 - z0, th, up=(0, sy, 0), bev=0.004)
            A.add(bm, P['wood'], uv=board_uv((x0, y, zc), X, Y, k=k))
            k += 1
    for sx in (-1, 1):
        x = sx * (Lx / 2 - th / 2)
        for (z0, z1) in ((0.015, 0.2), (0.255, 0.44)):
            zc = (z0 + z1) / 2
            bm, X, Y = board((x, -Wy / 2 + th, zc), (x, Wy / 2 - th, zc), z1 - z0, th, up=(sx, 0, 0), bev=0.004)
            A.add(bm, P['wood'], uv=board_uv((x, 0, zc), X, Y, k=k))
            k += 1
    for (y0, y1) in ((-0.271, -0.095), (-0.088, 0.088), (0.095, 0.271)):
        bm = drop_faces(box((-Lx / 2 + th, y0, 0.0), (Lx / 2 - th, y1, 0.016)),
                        lambda f: f.normal.z < -0.9 or abs(f.normal.x) > 0.9)
        A.add(bm, P['oak'], uv=board_uv((0, y0, 0), (1, 0, 0), (0, 1, 0), tex='oak'))
    off = noff(rng)
    net = lumpy((0.08, 0.03, 0.12), 0.22, (1.45, 1.05, 0.5), off, amp=0.3)
    A.add(net, P['rope'], tint=lambda co, fc: (0.62, 0.72, 0.66))
    for (c, a) in (((-0.2, -0.12, 0.2), 0.4), ((0.26, 0.14, 0.23), 1.9)):
        fl = bm_lathe([(0.0, -0.035), (0.045, -0.03), (0.05, 0.0), (0.045, 0.03), (0.0, 0.035)], segs=6)
        rot(fl, math.pi / 2, 'X')
        rot(fl, a, 'Z')
        A.add(move(fl, c), P['cork'])
    A.col((-Lx / 2, -Wy / 2, 0.0), (Lx / 2, Wy / 2, H))
    return A.finalize()


# ============================================================================
# T_Barrel: lathe-profiled oak barrel, sixteen staves, four iron hoops
# ============================================================================
def build_barrel(P):
    A = Asset('T_Barrel', P, budget=BUDGET['T_Barrel'])
    A.ao_dist = 0.8
    rng = random.Random(55)
    H, R0, BL = 1.0, 0.27, 0.06

    def rz(z):
        return R0 + BL * math.sin(math.pi * clamp(z / H))
    zs = [0.0, 0.1, 0.2, 0.27, 0.4, 0.5, 0.6, 0.73, 0.8, 0.9, 1.0]
    prof = [(0.0, 0.045), (R0 - 0.02, 0.045), (R0 - 0.012, 0.012)] + [(rz(z), z) for z in zs] + \
        [(R0 - 0.012, H - 0.012), (R0 - 0.02, H - 0.045), (0.0, H - 0.045)]
    body = bm_lathe(prof, segs=16)
    for e in body.edges:
        a, b = e.verts[0].co, e.verts[1].co
        if abs(a.x * b.y - a.y * b.x) < 1e-7 and a.xy.dot(b.xy) > 0 and min(a.xy.length, b.xy.length) > 0.2:
            e.smooth = False                  # stave joints
    tone = [0.84 + 0.16 * rng.random() for _ in range(16)]

    def stave(co, fc):
        i = int(((math.atan2(fc.y, fc.x) + math.pi) / TAU) * 16) % 16
        return (tone[i],) * 3
    A.add(body, P['oak'], uv=cyl_uv2((0, 0, 0), None, vgrain=True), tint=stave)
    for z in (0.1, 0.27, 0.73, 0.9):
        A.add(bm_lathe([(rz(z - 0.028) + 0.007, z - 0.028), (rz(z + 0.028) + 0.007, z + 0.028),
                        (rz(z + 0.03) - 0.004, z + 0.03)], segs=16, cap=False), P['iron'])
    bung = bm_lathe([(0.0, 0.0), (0.03, 0.0), (0.03, 0.012), (0.022, 0.02), (0.0, 0.02)], segs=6)
    rot(bung, math.pi / 2, 'X')
    A.add(move(bung, (0.0, -(rz(0.5) - 0.006), 0.5)), P['oak'])
    A.col((-0.33, -0.33, 0.0), (0.33, 0.33, H))
    return A.finalize()


# ============================================================================
# T_Amphora: terracotta amphora leaning in a small iron stand
# ============================================================================
def build_amphora(P):
    A = Asset('T_Amphora', P, budget=BUDGET['T_Amphora'])
    A.ao_dist = 0.8
    rng = random.Random(66)
    off = noff(rng)
    prof = [(0.0, 0.0), (0.028, 0.004), (0.038, 0.04), (0.03, 0.085), (0.045, 0.12), (0.1, 0.2), (0.16, 0.32),
            (0.2, 0.46), (0.215, 0.6), (0.205, 0.71), (0.17, 0.8), (0.11, 0.87), (0.068, 0.92), (0.058, 1.0),
            (0.066, 1.04), (0.082, 1.06), (0.08, 1.09), (0.062, 1.1), (0.05, 1.08), (0.045, 1.0), (0.0, 0.98)]
    am = bm_lathe(prof, segs=12)
    displace(am, lambda co, n: co + n * (0.006 * nz(co * 3.0, off)))
    handles = []
    for s_ in (-1, 1):
        h = [V((s_ * 0.05, 0, 1.0)), V((s_ * 0.13, 0, 1.0)), V((s_ * 0.19, 0, 0.96)), V((s_ * 0.2, 0, 0.9)),
             V((s_ * 0.17, 0, 0.83)), V((s_ * 0.14, 0, 0.8))]
        handles.append(bm_tube(h, 0.02, sides=5))
    lean = math.radians(13.0)
    d = V((math.sin(math.radians(25)), math.cos(math.radians(25)), 0.0))
    k = V((-d.y, d.x, 0.0))
    ring_r = 0.24
    toe = -d * 0.069
    M = Matrix.Translation(toe) @ Matrix.Rotation(lean, 4, k)

    def dust(co, fc):                 # fired unevenly, dirt low down, weathered in blotches
        s = (0.74 + 0.26 * smoothstep(0.0, 0.55, co.z)) * (0.86 + 0.1 * nz(co * 4.0, off) + 0.06 * nz(co * 11.0, off))
        return (s, s * (0.95 + 0.04 * nz(co * 2.5, off)), s * 0.93)
    A.add(xform(am, M), P['clay'], uv=cyl_uv2((0, 0, 0)), tint=dust)
    for h in handles:
        A.add(xform(h, M), P['clay'], tint=dust)
    # iron stand: a ring the amphora leans on, three legs with curled feet, a lower ring
    zr = 0.45
    A.add(bm_tube([V((ring_r * math.cos(a), ring_r * math.sin(a), zr)) for a in [TAU * j / 12 for j in range(12)]],
                  0.011, sides=4, closed=True), P['iron'])
    for j in range(3):
        a = math.radians(90 + 120 * j)
        u = V((math.cos(a), math.sin(a), 0.0))
        leg = [u * ring_r + V((0, 0, zr + 0.01)), u * (ring_r + 0.035) + V((0, 0, 0.3)),
               u * (ring_r + 0.075) + V((0, 0, 0.1)), u * (ring_r + 0.1) + V((0, 0, 0.025)),
               u * (ring_r + 0.14) + V((0, 0, 0.018))]
        A.add(bm_tube(leg, 0.01, sides=4), P['iron'])
    rl = ring_r + 0.062
    A.add(bm_tube([V((rl * math.cos(a), rl * math.sin(a), 0.15)) for a in [TAU * j / 10 for j in range(10)]],
                  0.008, sides=3, closed=True), P['iron'])
    A.col((-0.3, -0.3, 0.0), (0.3, 0.3, 1.1))
    return A.finalize()


# ============================================================================
# T_Cart: two-wheeled hand cart tipped forward onto its shafts
# ============================================================================
def wheel(A, P, c, R=0.56, spokes=8, segs=14, dish=0.02, side=1):
    """Spoked cart wheel in the YZ plane centred at c (axle along X)."""
    c = V(c)
    to_x = Matrix.Rotation(math.pi / 2, 4, 'Y')          # lathe axis Z -> X
    fel = bm_lathe([(R - 0.012, 0.03), (R - 0.065, 0.03), (R - 0.065, -0.03), (R - 0.012, -0.03)], segs=segs,
                   cap=False)
    tyre = bm_lathe([(R - 0.012, -0.03), (R, -0.032), (R, 0.032), (R - 0.012, 0.03)], segs=segs, cap=False)
    hub = bm_lathe([(0.0, -0.12), (0.05, -0.12), (0.068, -0.09), (0.085, -0.04), (0.085, 0.04), (0.068, 0.09),
                    (0.05, 0.12), (0.0, 0.12)], segs=8)
    for bm, m in ((fel, P['oak']), (tyre, P['iron']), (hub, P['oak'])):
        xform(bm, to_x)
        if bm is not hub:
            move(bm, (side * dish, 0, 0))
        A.add(move(bm, c), m)
    for k in range(spokes):
        a = TAU * (k + 0.5) / spokes
        dirv = V((0.0, math.cos(a), math.sin(a)))
        p0 = c + dirv * 0.07
        p1 = c + dirv * (R - 0.06) + V((side * dish, 0, 0))
        sp = bm_tube([p0, p1], [0.02, 0.015], sides=4, caps=False, smooth=True)
        A.add(sp, P['oak'], uv=board_uv(p0, p1 - p0, V((1, 0, 0)), tex='oak'))


def build_cart(P):
    A = Asset('T_Cart', P, budget=BUDGET['T_Cart'])
    A.ao_dist = 1.4
    rng = random.Random(77)
    off = noff(rng)
    Rw = 0.56
    # local frame: axle at the origin, bed from y = -0.82 (front) to 0.78 (back), shafts to -Y
    oak, wood = P['oak'], P['wood']
    for sx in (-1, 1):
        x = sx * 0.4
        bm, X, Y = board((x, 0.8, 0.075), (x, -0.84, 0.075), 0.065, 0.08, bev=0.0)
        A.add(bm, oak, uv=board_uv((x, 0.8, 0.075), X, Y, tex='oak'))
        shaft = [V((x, -0.8, 0.075)), V((sx * 0.37, -1.3, 0.075)), V((sx * 0.33, -1.8, 0.07)),
                 V((sx * 0.31, -2.02, 0.045)), V((sx * 0.305, -2.09, 0.01))]
        A.add(bm_tube(shaft, [0.042, 0.04, 0.036, 0.032, 0.028], sides=4), oak,
              uv=board_uv((x, -0.8, 0.075), (0, -1, 0), (1, 0, 0), tex='oak'))
    for y in (-0.72, 0.0, 0.66):
        A.add(box((-0.56, y - 0.03, 0.115), (0.56, y + 0.03, 0.165)), oak,
              uv=board_uv((0, y, 0.14), (1, 0, 0), (0, 1, 0), tex='oak'))
    bm, X, Y = board((0.0, 0.79, 0.18), (0.0, -0.83, 0.18), 1.16, 0.03, bev=0.006)
    A.add(bm, wood, uv=board_uv((0.0, 0.79, 0.18), X, Y, k=0))
    k = 1
    for sx in (-1, 1):
        x = sx * 0.5925
        for (z0, z1) in ((0.2, 0.345), (0.36, 0.5)):
            zc = (z0 + z1) / 2
            bm, X, Y = board((x, 0.79, zc), (x, -0.84, zc), z1 - z0, 0.025, up=(sx, 0, 0), bev=0.005)
            A.add(bm, wood, uv=board_uv((x, 0.79, zc), X, Y, k=k))
            k += 1
        for y in (-0.78, -0.02, 0.72):
            A.add(box((sx * 0.605 - 0.02, y - 0.025, 0.1), (sx * 0.605 + 0.02, y + 0.025, 0.55)), oak,
                  uv=board_uv((sx * 0.605, y, 0.1), (0, 0, 1), (0, 1, 0), tex='oak'))
    for (z0, z1) in ((0.2, 0.345), (0.36, 0.5)):
        zc = (z0 + z1) / 2
        bm, X, Y = board((-0.58, -0.8375, zc), (0.58, -0.8375, zc), z1 - z0, 0.025, up=(0, -1, 0), bev=0.005)
        A.add(bm, wood, uv=board_uv((0, -0.8375, zc), X, Y, k=k))
        k += 1
    A.add(box((-0.74, -0.035, -0.035), (0.74, 0.035, 0.035)), oak, uv=board_uv((0, 0, 0), (1, 0, 0), (0, 1, 0), tex='oak'))
    for sx in (-1, 1):
        wheel(A, P, (sx * 0.68, 0.0, 0.0), R=Rw, side=sx)
        pin = bm_lathe([(0.0, 0.0), (0.028, 0.0), (0.028, 0.03), (0.0, 0.03)], segs=6)
        rot(pin, sx * math.pi / 2, 'Y')
        A.add(move(pin, (sx * 0.8, 0, 0)), P['iron'])
    # a slumped sack slid down against the front board
    sack = lumpy((0.12, -0.6, 0.34), 0.24, (1.25, 0.9, 0.72), off, amp=0.2)
    A.add(sack, P['sack'])
    # tip forward: rotate about the axle until the shaft tips (lowest point
    # local (y, z) = (-2.09, -0.018)) rest on the sand
    yt, zt = -2.09, -0.018
    phi = math.asin(clamp(Rw / -yt))
    for _ in range(20):                    # Newton on Rw + yt sin(phi) + zt cos(phi) = 0.004
        f = Rw + yt * math.sin(phi) + zt * math.cos(phi) - 0.004
        df = yt * math.cos(phi) - zt * math.sin(phi)
        phi -= f / df
    L = Matrix.Translation((0, 0, Rw)) @ Matrix.Rotation(phi, 4, 'X')
    # the loose tailboard leaning on the right wheel (placed in world space, so pre-invert the tilt)
    Li = L.inverted()
    tb, X, Y = board((0.95, 0.35, 0.02), (0.95, 0.55, 0.62), 1.1, 0.025, up=(1, 0, 0.35), bev=0.005)
    xform(tb, Li)
    A.add(tb, wood, uv=board_uv(Li @ V((0.95, 0.35, 0.02)), Li.to_3x3() @ X, Li.to_3x3() @ Y, k=9))
    A.col((-0.62, -0.86, 0.035), (0.62, 0.8, 0.52))
    for sx in (-1, 1):
        A.col((sx * 0.68 - 0.05, -Rw, -Rw), (sx * 0.68 + 0.05, Rw, Rw))
    # centre the footprint
    lo, hi = footprint(A, L)
    A.lean = Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, 0)) @ L
    return A.finalize()


def footprint(A, L=None, keys=None):
    """XY bounds of an asset's geometry (after the optional transform L)."""
    lo, hi = V((1e9, 1e9, 1e9)), V((-1e9, -1e9, -1e9))
    for key, mb in A.parts.items():
        if keys is not None and key not in keys:
            continue
        for v in mb.bm.verts:
            p = L @ v.co if L is not None else v.co
            lo = V((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = V((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


# ============================================================================
# T_GardenWall: dry-stone rubble wall with a rough coping, part whitewashed
# ============================================================================
def build_gardenwall(P):
    A = Asset('T_GardenWall', P, budget=BUDGET['T_GardenWall'])
    A.ao_dist = 1.8
    rng = random.Random(12)
    off = noff(rng)
    stone, lime = P['stone'], P['stucco']
    fr = Frame((-2.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0))
    top = [(0.0, 0.93), (0.16, 1.08), (0.42, 1.19), (1.0, 1.225), (1.6, 1.205), (2.2, 1.235), (2.8, 1.215),
           (3.4, 1.2), (3.66, 1.13), (3.86, 1.0), (4.0, 0.88)]
    bm = holey_slab(fr, 0.0, 4.0, ZB, 1.24, -0.21, 0.21, (), top=top, step=0.52, bands=(0.3,), vextra=(0.0,),
                    vbot=False)

    def ztop(u):
        for (ua, va), (ub, vb) in zip(top, top[1:]):
            if ua <= u <= ub:
                return va + (vb - va) * (u - ua) / (ub - ua)
        return top[-1][1]

    def face_y(u, z, sgn):            # battered, bulging dry-stone faces
        return sgn * (0.18 + 0.035 * (1.0 - clamp(z / 1.2))) + sgn * 0.016 * nz((u * 1.3, z * 1.6, 3.0 + sgn), off)
    for v in bm.verts:
        d = v.co - fr.O
        u, z, t = d.dot(fr.U), d.dot(fr.V), d.dot(fr.T)
        sgn = -1.0 if t < 0 else 1.0
        v.co.y = face_y(u, z, sgn)
        if u < 1e-4 or u > 4.0 - 1e-4:          # ragged ends: every course sticks out or falls back
            v.co.x += (0.07 * nz((z * 3.1, sgn, 9.0), off)) * (1 if u > 2 else -1)
    A.add(bm, None, mats=[stone] * 6, smooth=True)

    def surf(sgn):
        return lambda u, z, lift: V((u - 2.0, face_y(u, z, sgn) + sgn * lift, z))

    def dirty(co, fc):                 # old limewash, greyed and yellowed unevenly, darker under the coping
        k = (0.88 + 0.08 * nz((co.x * 2.2, co.z * 0.5, 4.0), off)) * (0.9 + 0.1 * smoothstep(0.0, 0.25, 1.2 - co.z))
        return (k, k * 0.985, k * 0.95)
    # front: a band of limewash along the top, dripping, fading out ragged toward both ends
    def bot_front(u):
        base = 0.62 + 0.1 * nz((u * 1.8, 0.0, 1.0), off) + 0.035 * nz((u * 9.0, 2.0, 1.0), off)
        e = min(u - 0.32, 3.62 - u)
        return base + (ztop(u) - base) * (1.0 - smoothstep(0.0, 0.5, e + 0.05 * nz((u * 5.0, 1.0, 1.0), off)))
    drips = [(0.98, 0.12, 0.16), (2.3, 0.14, 0.2), (2.86, 0.08, 0.1)]
    A.add(lime_band(fr, 0.32, 3.62, lambda u: ztop(u) - 0.004, bot_front, surf(-1), n=28, drips=drips), lime,
          tint=dirty)
    for (u, z, rx, ry) in ((1.25, 0.97, 0.15, 0.09), (2.62, 1.03, 0.11, 0.07), (3.08, 0.86, 0.09, 0.06)):
        A.add(blob((u - 2.0, face_y(u, z, -1) - 0.009, z), (0, -1, 0), (1, 0, 0), rx, ry, rng), stone)
    def bot_back(u):                   # back: a shorter, older band
        base = 0.8 + 0.1 * nz((u * 2.0, 3.0, 1.0), off)
        e = min(u - 0.7, 2.3 - u)
        return base + (ztop(u) - base) * (1.0 - smoothstep(0.0, 0.35, e))
    A.add(lime_band(fr, 0.7, 2.3, lambda u: ztop(u) - 0.004, bot_back, surf(1), n=12, drips=[(1.45, 0.12, 0.14)],
                    facing=fr.T), lime, tint=dirty)
    # coping: rough flat stones
    x = -1.97
    while x < 1.95:
        L = min(rng.uniform(0.38, 0.56), 1.97 - x)
        if L < 0.12:
            break
        u = x + L / 2 + 2.0
        H = rng.uniform(0.1, 0.15)
        c = V((x + L / 2, rng.uniform(-0.02, 0.02), ztop(u) + H / 2 - 0.015))
        R = Matrix.Rotation(rng.uniform(-0.05, 0.05), 3, 'Y') @ Matrix.Rotation(rng.uniform(-0.04, 0.04), 3, 'X') @ \
            Matrix.Rotation(rng.uniform(-0.06, 0.06), 3, 'Z')
        m = P['schist'] if rng.random() < 0.55 else stone
        A.add(rock(c, (L - 0.02, rng.uniform(0.46, 0.52), H), rng, jit=0.07, bev=0.28, R=R, edges='top',
                   drop_bottom=True), m, tint=(rng.uniform(0.82, 1.0),) * 3)
        x += L
    # rubble standing proud of the bare stone
    placed_, tries = 0, 0
    while placed_ < 10 and tries < 600:
        tries += 1
        side = -1 if placed_ % 3 else 1
        u = rng.uniform(0.12, 3.88)
        z = rng.uniform(0.04, ztop(u) - 0.2)
        lim = bot_front(u) if side < 0 else (bot_back(u) if 0.7 < u < 2.3 else 9.0)
        if z > lim - 0.2:
            continue
        w = rng.uniform(0.2, 0.34) * (1.25 if z < 0.35 else 1.0)
        A.add(proud_stone((u - 2.0, face_y(u, z, side), z), (0, side, 0), (1, 0, 0), w, w * rng.uniform(0.5, 0.75),
                          rng.uniform(0.035, 0.06), rng), stone, tint=(rng.uniform(0.85, 1.0),) * 3)
        placed_ += 1
    # through-stones sticking out of the ragged ends
    for (x, sx) in ((-2.0, -1), (2.0, 1)):
        c = V((x + sx * 0.06, rng.uniform(-0.05, 0.05), 0.45 + rng.uniform(-0.1, 0.1)))
        A.add(rock(c, (0.32, 0.34, 0.17), rng, jit=0.12, bev=0.3, R=Matrix.Rotation(rng.uniform(-0.3, 0.3), 3, 'Z'),
                   edges='top'), stone)
    A.col((-2.0, -0.26, -0.3), (2.0, 0.26, 1.4))
    return A.finalize()


# ============================================================================
# T_Cypress: 8 m flame of dark clumps on a short trunk
# ============================================================================
def build_cypress(P):
    A = Asset('T_Cypress', P, budget=BUDGET['T_Cypress'])
    A.ao_dist = 2.5
    rng = random.Random(8)
    off = noff(rng)
    H = 8.0

    def Rz(z):                       # the flame: swells low, long taper to a soft point
        if z < 0.55:
            return 0.0
        if z < 2.3:
            return 0.3 + 0.56 * math.sin(0.5 * math.pi * (z - 0.55) / 1.75)
        t = (z - 2.3) / (H - 2.3)
        return 0.86 * (1.0 - t ** 1.55) ** 0.9

    def xc(z):                       # a flame's lean and sway
        return V((0.1 * math.sin(z * 0.55 + 0.6) + 0.12 * (z / H) ** 2, 0.06 * math.sin(z * 0.8 + 2.0), 0.0))
    trunk = bm_lathe([(0.0, -0.2), (0.24, -0.2), (0.2, 0.04), (0.155, 0.3), (0.13, 0.9), (0.1, 1.8), (0.0, 1.9)],
                     segs=7)
    displace(trunk, lambda co, n: co + n * (0.03 * nz(co * 3.0, off)))
    A.add(trunk, P['cybark'], uv=cyl_uv2((0, 0, 0)))
    # a dense core with vertical plumes...
    prof = [(0.0, 0.5)] + [(0.84 * Rz(z), z) for z in [0.66 + (H - 1.0) * i / 25 for i in range(26)]] + \
        [(0.0, H - 0.1)]
    core = bm_lathe(prof, segs=14)

    def plume(co, n):          # vertical sprays: noise stretched along z, two scales
        k = 0.55 * noise.noise(V((co.x * 3.0, co.y * 3.0, co.z * 0.8)) + off) + \
            0.45 * noise.noise(V((co.x * 7.5, co.y * 7.5, co.z * 2.2)) + off * 1.3)
        return co + xc(co.z) + n * (0.26 * k * min(1.0, math.hypot(co.x, co.y) / 0.3))
    displace(core, plume)
    A.add(core, P['cypress'], key='leaves', tint=lambda co, fc: (0.66 + 0.2 * smoothstep(1.0, 7.0, fc.z),) * 3)
    # ...and upright tufts breaking the silhouette
    n_cl = 22
    for i in range(n_cl):
        t = (i + 0.5) / n_cl
        z = 0.85 + (H - 1.55) * t ** 1.1
        R = Rz(z)
        a = i * 2.39996 + rng.uniform(-0.35, 0.35)
        c = V((0.66 * R * math.cos(a), 0.66 * R * math.sin(a), z)) + xc(z)
        s_ = 0.2 * R + 0.15
        tone = (0.8 + 0.2 * smoothstep(1.0, 6.5, z)) * rng.uniform(0.88, 1.0)
        A.add(lumpy(c, s_, (1.0, 1.0, 1.9), off + V((i * 3.1, 0, 0)), amp=0.3), P['cypress'], key='leaves',
              tint=lambda co, fc, tone=tone: (tone,) * 3)
    A.col((-0.2, -0.2, 0.0), (0.2, 0.2, 2.2))
    root = A.finalize()
    soft_normals(root, 'leaves', lambda co: V((0, 0, co.z)) + xc(co.z) - V((0, 0, 0.15 + 0.9 * smoothstep(5.5, 8.0, co.z))))
    return root


# ============================================================================
# T_Olive: gnarled split trunk, silvery-green lumpy canopy
# ============================================================================
def build_olive(P):
    A = Asset('T_Olive', P, budget=BUDGET['T_Olive'])
    A.ao_dist = 2.5
    rng = random.Random(9)
    off = noff(rng)
    bark = P['obark']
    # root flare with buttresses, then a thick, short, fused bole that twists and leans
    base = bm_lathe([(0.0, -0.25), (0.78, -0.25), (0.66, 0.0), (0.5, 0.12), (0.0, 0.2)], segs=12)

    def buttress(co, n):
        rxy = V((co.x, co.y, 0))
        if rxy.length < 1e-6:
            return co
        a = math.atan2(co.y, co.x)
        k = 0.34 * max(0.0, math.cos(3 * a + 0.5)) ** 3 + 0.12 * nz(co * 2.5, off)
        return co + rxy.normalized() * (k * clamp(1.0 - co.z / 0.25))
    displace(base, buttress)
    A.add(base, bark, uv=cyl_uv2((0, 0, 0)))
    bole = [V((0.0, 0.0, -0.05)), V((0.04, 0.02, 0.3)), V((0.1, 0.02, 0.62)), V((0.16, -0.01, 0.95))]
    A.add(gnarl_tube(catmull(bole, 6), [0.48, 0.42, 0.37, 0.34, 0.32, 0.3], sides=12, flutes=3, famp=0.3, twist=0.55,
                     namp=0.18, off=off), bark, uv=box_uv)
    # three leaders split out of the bole and twist away from each other
    leaders = [
        ([(0.26, 0.02, 0.8), (0.46, 0.1, 1.2), (0.62, 0.22, 1.62), (0.9, 0.34, 2.0), (1.15, 0.5, 2.28)],
         [0.2, 0.17, 0.14, 0.1, 0.075]),
        ([(0.08, 0.1, 0.8), (-0.18, 0.32, 1.18), (-0.4, 0.62, 1.55), (-0.72, 0.86, 1.9), (-1.04, 0.98, 2.18)],
         [0.2, 0.17, 0.13, 0.1, 0.07]),
        ([(0.14, -0.12, 0.8), (0.12, -0.38, 1.22), (0.2, -0.66, 1.6), (0.3, -1.0, 1.98), (0.42, -1.3, 2.26)],
         [0.19, 0.16, 0.13, 0.095, 0.065]),
    ]
    tips = []
    for j, (pts, radii) in enumerate(leaders):
        pts = catmull(pts, 7)
        pts = [p + (V((nz((p.z * 1.9, j, 0.0), off), nz((p.z * 1.9, j, 5.0), off), 0.0)) * 0.1 if k else V())
               for k, p in enumerate(pts)]
        rr = [lerp(radii[0], radii[-1], (k / 6) ** 0.9) for k in range(7)]
        A.add(gnarl_tube(pts, rr, sides=8, flutes=2, famp=0.26, twist=0.9 + 0.3 * j, namp=0.18,
                         off=off + V((j * 7.0, 0, 0)), caps=True), bark, uv=box_uv)
        tips.append(pts[-1])
    branch_tips = [(0, (1.55, 0.2, 2.72)), (0, (0.8, 1.0, 2.95)), (1, (-1.5, 0.5, 2.68)), (1, (-0.5, 1.45, 2.86)),
                   (2, (1.05, -1.45, 2.7)), (2, (-0.3, -1.55, 2.8))]
    ends = []
    for j, (lead, end) in enumerate(branch_tips):
        p0 = tips[lead]
        end = V(end)
        m1 = p0.lerp(end, 0.35) + V((rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14), 0.14))
        m2 = p0.lerp(end, 0.7) + V((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0.05))
        A.add(gnarl_tube([p0, m1, m2, end], [0.07, 0.055, 0.04, 0.025], sides=5, flutes=2, famp=0.12, twist=0.5,
                         namp=0.14, off=off + V((0, j * 5.0, 0))), bark, uv=box_uv)
        ends.append(end)
    A.add(gnarl_tube([V((0.16, 0.0, 0.9)), V((0.14, 0.12, 1.9)), V((0.04, 0.05, 2.7)), V((0.02, 0.05, 3.2))],
                     [0.12, 0.08, 0.05, 0.03], sides=5, flutes=2, famp=0.12, twist=0.4, namp=0.14, off=off), bark,
          uv=box_uv)
    ends.append(V((0.02, 0.05, 3.3)))
    # the canopy: clusters of lumpy clumps round each branch tip, with gaps between
    k = 0
    for j, e in enumerate(ends):
        n_here = 3 if j == len(ends) - 1 else 4
        for m in range(n_here):
            a = rng.uniform(0, TAU)
            d = rng.uniform(0.15, 0.5)
            c = e + V((d * math.cos(a), d * math.sin(a), rng.uniform(-0.12, 0.3) + (0.25 if j == len(ends) - 1 else 0)))
            r = rng.uniform(0.36, 0.54)
            tone = rng.uniform(0.84, 1.0)
            A.add(lumpy(c, r, (1.0, 1.0, 0.72), off + V((0, 0, k * 2.3)), amp=0.28), P['olive'], key='leaves',
                  tint=lambda co, fc, tone=tone: (tone * (0.74 + 0.26 * smoothstep(2.3, 3.9, fc.z)),) * 3)
            k += 1
    A.col((-0.45, -0.45, 0.0), (0.45, 0.45, 1.6))
    root = A.finalize()
    soft_normals(root, 'leaves', lambda co: V((0.35 * co.x, 0.35 * co.y, 2.2)), blend=0.35)
    return root


# ============================================================================
# T_Egg: Dali's egg on a small whitewashed plinth
# ============================================================================
def build_egg(P):
    A = Asset('T_Egg', P, budget=BUDGET['T_Egg'])
    A.ao_dist = 1.5
    A.add(ring_lathe(rect_ring(0.43, 0.43, 0.03), [(0.0, 0.1), (0.0, 0.4)], cap_top=False), P['stucco'],
          uv=local_uv((0, 0, 0), 0.0, 0.0))
    A.add(ring_lathe(rect_ring(0.43, 0.43, 0.03), [(0.025, -0.1), (0.025, 0.1), (0.0, 0.12)], cap_top=False),
          P['stone'])
    A.add(ring_lathe(rect_ring(0.43, 0.43, 0.03), [(-0.005, 0.4), (0.03, 0.418), (0.05, 0.44), (0.05, 0.488),
                                                    (0.03, 0.505)]), P['stucco'], uv=local_uv((0, 0, 0), 0.0, 0.0))
    egg = bt.egg_bm(1.6, segs=20, rings=13)
    rot(egg, 0.35, 'Z')
    A.add(move(egg, (0, 0, 0.495)), P['egg'])
    collar = bm_lathe([(0.34, 0.503), (0.3, 0.53), (0.24, 0.56)], segs=20, cap=False)
    A.add(collar, P['stucco'], uv=cyl_uv2((0, 0, 0), 3.0 / TAU))
    A.col((-0.48, -0.48, 0.0), (0.48, 0.48, 2.1))
    return A.finalize()


# ============================================================================
# T_Gate: rubble arched gateway, whitewashed face, pier caps, coping
# ============================================================================
def build_gate(P):
    A = Asset('T_Gate', P, budget=BUDGET['T_Gate'])
    A.ao_dist = 3.0
    rng = random.Random(27)
    off = noff(rng)
    W, T2, ZT = 5.6, 0.35, 5.0
    ow, hs = GATE_OPENING[0], GATE_OPENING[1] - GATE_OPENING[0] / 2      # opening width, springing height
    r = ow / 2
    fr = Frame((-W / 2, 0.0, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0))
    hole = Hole(W / 2 - r, W / 2 + r, ZB, hs, 'round')
    CR = 0.3                         # the crest over the arch rises this much between the piers

    def crest(x):                    # wall top at x (the piers stay flat at ZT)
        t = clamp((x + r) / (2 * r))
        return ZT + CR * math.sin(math.pi * t) ** 0.8 if -r < x < r else ZT
    top = [(0.0, ZT), (W / 2 - r, ZT)] + [(W / 2 - r + 2 * r * k / 10, crest(-r + 2 * r * k / 10)) for k in range(1, 10)] + \
        [(W / 2 + r, ZT), (W, ZT)]
    bm = holey_slab(fr, 0.0, W, ZB, ZT + CR, -T2, T2, [hole], top=top, step=0.5, bands=(0.3,), vextra=(0.0,),
                    vbot=False)
    # the soffit hides behind the voussoirs
    drop_faces(bm, lambda f: f.material_index == 2 and f.normal.z < -0.3)
    for v in bm.verts:
        d = v.co - fr.O
        t = d.dot(fr.T)
        if abs(abs(t) - T2) < 1e-4:
            v.co.y += (1 if t > 0 else -1) * 0.014 * nz((d.x * 1.1, d.z * 1.1, t * 3.0), off)
    wash_b = lambda u, z: (z > 2.4 and nz((u * 1.3, z * 1.3, 21.0), off) > 0.3)
    flake(bm, fr, 1, wash_b, 6, jit=0.12, off=off + V((5, 5, 5)), proud=0.004)
    stone = P['stone']

    def gface(u, z, side):           # the (displaced) face position
        t = side * T2
        return V((u - W / 2, t + side * 0.014 * nz((u * 1.1, z * 1.1, t * 3.0), off), z))

    def splash(u):                   # the lime worn off at the pier feet, higher toward the outer corners
        e = min(u, W - u) / (W / 2 - r)
        return 0.45 + 0.5 * (1.0 - clamp(e)) ** 2 + 0.16 * nz((u * 1.7, 0.0, 1.0), off) + 0.05 * nz((u * 7.0, 2.0, 1.0), off)

    def wash_f(u, z):                # what the front's lime still covers (for placing bare rubble)
        if z < splash(u) + 0.05:
            return False
        return all(math.hypot((u - bu) / brx, (z - bz) / bry) > 1.0 for (bu, bz, brx, bry) in flakes)
    flakes = [(0.35, 1.9, 0.22, 0.3), (0.7, 3.4, 0.25, 0.16), (4.95, 1.55, 0.26, 0.2), (5.15, 3.9, 0.2, 0.28),
              (1.6, 4.75, 0.3, 0.12), (4.1, 4.7, 0.18, 0.1)]

    def streaks(co, fc):             # rain runs down the lime from the caps and coping
        k = 1.0 - 0.14 * smoothstep(3.6, 5.0, co.z) * max(0.0, nz((co.x * 3.5, 0.0, 7.0), off) + 0.25)
        return (k, k * 0.98, k * 0.94)
    A.add(bm, None, mats=[P['stucco'], stone, stone, stone, stone, stone, P['stucco']], smooth=True, tint=streaks)
    for (ua, ub) in ((0.0, W / 2 - r), (W / 2 + r, W)):
        A.add(lime_band(fr, ua + 0.01, ub - 0.01, splash, lambda u: -0.05, lambda u, z, lift: gface(u, z, -1) -
                        V((0, lift, 0)), n=11, lift=0.005), stone)
    for (bu, bz, brx, bry) in flakes:
        A.add(blob(gface(bu, bz, -1) - V((0, 0.006, 0)), (0, -1, 0), (1, 0, 0), brx, bry, rng), stone)
    # voussoirs: rough dressed sandstone, irregular tails, a proud keystone
    n = 11
    for i in range(n):
        a0 = math.pi * (1 - i / n) - 0.006
        a1 = math.pi * (1 - (i + 1) / n) + 0.006
        dd = 0.55 if i == n // 2 else rng.uniform(0.38, 0.5)
        ri = r - GATE_RING
        q = [(ri, a0), (ri, a1), (ri + dd, a1 + rng.uniform(-0.01, 0.01)), (ri + dd, a0 + rng.uniform(-0.01, 0.01))]
        pr = 0.06 if i == n // 2 else rng.uniform(0.015, 0.03)
        pts = [V((rr * math.cos(aa), -T2 - pr, hs + rr * math.sin(aa))) for rr, aa in q] + \
              [V((rr * math.cos(aa), T2 + 0.02, hs + rr * math.sin(aa))) for rr, aa in q]
        c = sum(pts, V()) / 8
        st = hexa(pts)
        bmesh.ops.bevel(st, geom=[e for e in st.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) < 0.5],
                        offset=0.018, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        set_smooth(st, True)
        A.add(st, P['sandstone'], uv=local_uv(c), tint=(rng.uniform(0.86, 1.0),) * 3)
    # imposts at the springing and caps on the piers
    for sx in (-1, 1):
        xa, xb = sorted((sx * r, sx * W / 2))
        ia, ib = sorted((sx * (r - GATE_RING), sx * (W / 2 + 0.03)))   # the arch springs from it
        c = V(((ia + ib) / 2, 0, hs - 0.09))
        imp = box((ia, -T2 - 0.045, hs - 0.18), (ib, T2 + 0.045, hs), bevel=0.02)
        A.add(imp, P['sandstone'], uv=local_uv(c))
        cap = ring_lathe(rect_ring((xb - xa) / 2, T2, 0.02),
                         [(-0.01, ZT - 0.02), (0.06, ZT), (0.085, ZT + 0.05), (0.085, ZT + 0.14), (0.055, ZT + 0.17),
                          (0.0, ZT + 0.18), (None, 5.4)], cap_top=False)
        A.add(move(cap, ((xa + xb) / 2, 0, 0)), P['sandstone'], uv=local_uv(((xa + xb) / 2, 0, ZT + 0.1)))
    # coping between the caps: rough schist slabs
    x = -r - 0.02
    while x < r - 0.05:
        L = min(rng.uniform(0.38, 0.5), r + 0.02 - x)
        xm = x + L / 2
        slope = (crest(min(r - 1e-3, xm + 0.05)) - crest(max(-r + 1e-3, xm - 0.05))) / 0.1
        c = V((xm, rng.uniform(-0.015, 0.015), crest(xm) + 0.045))
        R = Matrix.Rotation(-math.atan(slope) + rng.uniform(-0.03, 0.03), 3, 'Y') @ \
            Matrix.Rotation(rng.uniform(-0.05, 0.05), 3, 'Z')
        A.add(rock(c, (L - 0.02, 2 * T2 + 0.12, rng.uniform(0.09, 0.12)), rng, jit=0.06, bev=0.3, R=R, edges='top',
                   drop_bottom=True), P['schist'], tint=(rng.uniform(0.85, 1.0),) * 3)
        x += L
    # rubble standing proud: bare where the lime is gone, washed over where it holds
    placed_, tries = 0, 0
    while placed_ < 24 and tries < 800:
        tries += 1
        side = -1 if placed_ % 3 else 1
        u = rng.uniform(0.1, W - 0.1)
        z = rng.uniform(0.05, ZT - 0.3)
        if abs(u - W / 2) < r + 0.55 and z > hs - 0.5 and math.hypot(u - W / 2, z - hs) < r + 0.62:
            continue
        if abs(u - W / 2) < r + 0.05 and z < hs + 0.2:
            continue
        if (side < 0 and wash_f(u, z)) or (side > 0 and wash_b(u, z)):
            continue
        w = rng.uniform(0.24, 0.42)
        yface = side * T2 + side * 0.014 * nz((u * 1.1, z * 1.1, side * T2 * 3.0), off)
        A.add(proud_stone((u - W / 2, yface, z), (0, side, 0), (1, 0, 0), w, w * rng.uniform(0.5, 0.75),
                          rng.uniform(0.035, 0.06), rng), P['stone'], tint=(rng.uniform(0.85, 1.0),) * 3)
        placed_ += 1
    # colliders: the piers, and stepped boxes above the arch that never dip into the opening
    for sx in (-1, 1):
        xa, xb = sorted((sx * r, sx * W / 2))
        A.col((xa, -T2, ZB), (xb, T2, 5.4))
    k = 8
    edges = [-r * math.cos(math.pi * j / k) for j in range(k + 1)]
    for xa, xb in zip(edges, edges[1:]):
        xm = xa if abs(xa) < abs(xb) else xb
        bot = hs + math.sqrt(max(0.0, r * r - xm * xm)) + 0.005
        A.col((xa, -T2, bot), (xb, T2, min(crest(xa), crest(xb)) + 0.1))
    return A.finalize()


# ============================================================================
# T_Boat: a beached llaut, 6 m, clinker planked, rolled 12 degrees onto its side
# ============================================================================
def build_boat(P):
    A = Asset('T_Boat', P, budget=BUDGET['T_Boat'])
    A.ao_dist = 2.0
    rng = random.Random(61)
    off = noff(rng)
    L, B, D = 6.0, 2.05, 0.86
    NS, NQ = 16, 6
    xs = [-L / 2 + L * i / NS for i in range(NS + 1)]

    def half_beam(x):
        t = abs(2 * x / L)
        return max(0.0, (B / 2) * (1 - t ** 2.2) ** 0.75)

    def sheer(x):
        t = 2 * x / L
        return D + 0.24 * t * t + 0.1 * max(0.0, t) ** 3

    def keel(x):
        return 0.1 * abs(2 * x / L) ** 3

    def S(x, t, shrink=0.0):
        b = max(0.0, half_beam(x) - shrink)
        k = keel(x) + shrink
        sh = sheer(x)
        y = b * math.sin(t * math.pi / 2) ** 0.7
        z = k + (sh - k) * (1 - math.cos(t * math.pi / 2)) ** 1.15
        return y, z

    def normal(x, t):
        e = 1e-3
        y0, z0 = S(x, max(0.0, t - e))
        y1, z1 = S(x, min(1.0, t + e))
        dy, dz = y1 - y0, z1 - z0
        ln = math.hypot(dy, dz) or 1.0
        return dz / ln, -dy / ln

    lap_full = 0.022
    # roll onto the side, point the bow to -Y, sink the lowest point 4 cm, hull midpoint over the origin
    roll = math.radians(12.0)
    R = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Rotation(roll, 4, 'X')
    zmin = min((R @ V((x, s * S(x, t)[0], S(x, t)[1]))).z for x in xs for t in (0, 0.25, 0.5, 0.75, 1.0) for s in (-1, 1))
    mid = sum(((R @ V((0.0, s * S(0.0, t)[0], S(0.0, t)[1]))) for t in (0.0, 0.5, 1.0) for s in (-1, 1)), V()) / 6
    M = Matrix.Translation((-mid.x, -mid.y, -zmin - 0.04)) @ R
    M3 = M.to_3x3()

    def W(x, y, z):
        return M @ V((x, y, z))
    # outer hull: clinker strakes (each lower edge lapped over the strake below)
    bm = bmesh.new()
    rings = []
    for x in xs:
        lap = lap_full * (half_beam(x) / (B / 2)) ** 0.5
        side = []
        for q in range(NQ):
            ta, tb = q / NQ, (q + 1) / NQ
            ya, za = S(x, ta)
            ny, nz_ = normal(x, ta)
            la = (ya + ny * lap, za + nz_ * lap) if q > 0 else (ya, za)
            side.append((la, q))
            side.append((S(x, tb), q))
        port = [((-p[0], p[1]), q) for (p, q) in reversed(side)]
        rings.append([(bm.verts.new(W(x, y, z)), q) for ((y, z), q) in port + side[1:]])   # keel point shared
    paint = {0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2}
    for i in range(NS):
        a, b = rings[i], rings[i + 1]
        for j in range(len(a) - 1):
            q = max(a[j][1], a[j + 1][1])
            try:
                f = bm.faces.new([a[j][0], b[j][0], b[j + 1][0], a[j + 1][0]])
            except ValueError:
                continue
            f.material_index = paint[q]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bm.normal_update()
    ctr = W(0, 0, D * 0.6)
    axis = M3 @ V((1, 0, 0))

    def outward(bm_, sign=1.0):
        """Faces share one winding; flip them all if the big ones face the wrong way."""
        s = 0.0
        for f in bm_.faces:
            c = f.calc_center_median()
            radial = (c - ctr) - axis * (c - ctr).dot(axis)
            s += f.normal.dot(radial) * f.calc_area()
        if s * sign < 0:
            for f in bm_.faces:
                f.normal_flip()
    outward(bm)
    set_smooth(bm, True)
    for e in bm.edges:                      # the laps read as crisp lines
        if len(e.link_faces) == 2 and e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) > math.radians(35):
            e.smooth = False

    def grime(co, fc):
        lc = M.inverted() @ co
        s = 0.9 + 0.1 * nz((lc.x * 2.5, 0.0, 0.0), off)
        s *= 0.82 + 0.18 * smoothstep(0.0, 0.5, lc.z)
        return (s, s, s)
    A.add(bm, None, mats=[P['bottom'], P['hull'], P['stripe']], tint=grime)
    # inside: painted planking (TX_wood planks along the hull), smooth
    bm = bmesh.new()
    uvs = {}
    xi = xs[::2]
    rings = []
    for x in xi:
        ring = []
        pts = []
        for q in range(NQ + 1):
            t = q / NQ
            y, z = S(x, t, shrink=0.03)
            pts.append((y, z))
        arc = [0.0]
        for p0, p1 in zip(pts, pts[1:]):
            arc.append(arc[-1] + math.hypot(p1[0] - p0[0], p1[1] - p0[1]))
        full = [((-y, z), -s) for (y, z), s in reversed(list(zip(pts, arc)))] + [((y, z), s) for (y, z), s in
                                                                                zip(pts[1:], arc[1:])]
        for (y, z), s in full:
            v = bm.verts.new(W(x, y, z))
            uvs[(round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))] = (s, x)
            ring.append(v)
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(len(a) - 1):
            vs = [a[j], a[j + 1], b[j + 1], b[j]]
            if len(set(vs)) < 3:
                continue
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bm.normal_update()
    outward(bm, -1.0)
    set_smooth(bm, True)
    A.add(bm, P['wood'], uv=lambda co, n: uvs.get((round(co.x, 4), round(co.y, 4), round(co.z, 4)), box_uv(co, n)))
    # gunwale rails, keel, stem and sternpost
    for s_ in (-1, 1):
        pts = [W(x, s_ * half_beam(x), sheer(x) + 0.012) for x in xs[::2]]
        A.add(bm_tube(pts, 0.03, sides=4), P['oak'])
    A.add(bm_tube([W(x, 0, keel(x) - 0.03) for x in xs[1:-1:2]] + [W(L / 2 - 0.25, 0, keel(L / 2 - 0.25) - 0.02)],
                  0.04, sides=4), P['oak'])
    # the llaut's tall stem post (roda), rising well above the sheer with a knob
    sh2 = sheer(L / 2)
    stem = [W(L / 2 - 0.3, 0, keel(L / 2) + 0.02), W(L / 2 - 0.06, 0, 0.3), W(L / 2 + 0.02, 0, sh2 - 0.12),
            W(L / 2 + 0.07, 0, sh2 + 0.15), W(L / 2 + 0.08, 0, sh2 + 0.4), W(L / 2 + 0.04, 0, sh2 + 0.56)]
    A.add(bm_tube(stem, [0.055, 0.062, 0.068, 0.066, 0.06, 0.055], sides=6), P['oak'])
    knob = bm_lathe([(0.0, 0.0), (0.065, 0.02), (0.075, 0.06), (0.05, 0.1), (0.0, 0.11)], segs=6)
    xform(knob, M @ Matrix.Translation((L / 2 + 0.035, 0, sh2 + 0.55)))
    A.add(knob, P['stripe'])
    stern = [W(-L / 2 + 0.25, 0, keel(-L / 2) + 0.02), W(-L / 2 + 0.03, 0, 0.35), W(-L / 2 - 0.02, 0, sheer(-L / 2)),
             W(-L / 2 - 0.02, 0, sheer(-L / 2) + 0.14)]
    A.add(bm_tube(stern, 0.045, sides=5), P['oak'])
    rud, X_, Y_ = board((-L / 2 - 0.13, 0, 0.05), (-L / 2 - 0.1, 0, sheer(-L / 2) + 0.05), 0.2, 0.04, up=(0, 1, 0),
                        bev=0.01)
    xform(rud, M)
    A.add(rud, P['wood'], uv=board_uv(W(-L / 2 - 0.13, 0, 0.05), M3 @ X_, M3 @ Y_, k=3))
    A.add(bm_tube([W(-L / 2 - 0.08, 0, sheer(-L / 2) - 0.05), W(-L / 2 + 0.5, 0, sheer(-L / 2) + 0.05)], 0.022,
                  sides=4), P['oak'])
    # thwarts, ribs, floorboards
    for x in (-1.45, 0.05, 1.45):
        hb = half_beam(x) - 0.06
        tz = sheer(x) - 0.24
        bm_, X_, Y_ = board((x, -hb, tz), (x, hb, tz), 0.24, 0.04, bev=0.008)
        xform(bm_, M)
        A.add(bm_, P['oak'], uv=board_uv(W(x, -hb, tz), M3 @ X_, M3 @ Y_, tex='oak'))
    for x in (-2.1, -0.7, 0.75, 2.1):
        sec = [S(x, t, shrink=0.045) for t in (0.0, 0.2, 0.4, 0.6, 0.8, 0.95)]
        pts = [W(x, -y, z) for (y, z) in reversed(sec)] + [W(x, y, z) for (y, z) in sec[1:]]
        A.add(bm_tube(pts, 0.022, sides=3, caps=False), P['oak'])
    for yy in (-0.2, 0.2):
        bm_, X_, Y_ = board((-1.9, yy, keel(0) + 0.07), (1.9, yy, keel(0) + 0.07), 0.2, 0.02, bev=0.0)
        xform(bm_, M)
        A.add(bm_, P['oak'], uv=board_uv(W(-1.9, yy, 0.07), M3 @ X_, M3 @ Y_, tex='oak'))
    # two oars on the thwarts, blades out past the stern quarters
    for k, (y0, y1) in enumerate(((-0.28, -0.95), (0.3, 1.0))):
        a = V((0.95, y0, sheer(0.05) - 0.17))
        b = V((-3.3, y1, sheer(-2.8) - 0.02 + 0.05 * k))
        d = (b - a).normalized()
        A.add(bm_tube([W(*a), W(*(a + d * 3.1))], [0.026, 0.024], sides=5), P['oak'])
        blade, X_, Y_ = board(a + d * 3.0, a + d * 4.1, 0.15, 0.022, up=(0, 0, 1), bev=0.006)
        xform(blade, M)
        A.add(blade, P['wood'], uv=board_uv(W(*(a + d * 3.0)), M3 @ X_, M3 @ Y_, k=k + 5))
    # the lateen yard and furled sail: from the sternpost head down onto the bow thwart
    ya, yb = V((1.75, 0.12, sheer(1.45) - 0.15)), V((-3.55, -0.08, sheer(-L / 2) + 0.2))
    ya2 = ya + (ya - yb).normalized() * 0.9
    A.add(bm_tube([W(*ya2), W(*yb)], [0.045, 0.035], sides=6), P['oak'])
    sail = []
    for k in range(9):
        t = 0.06 + 0.84 * k / 8
        sail.append(ya2.lerp(yb, t) + V((0, 0.0, 0.07 + 0.02 * math.sin(k * 1.7))))
    radii = [0.06, 0.1, 0.12, 0.115, 0.12, 0.105, 0.09, 0.075, 0.05]
    sb = bm_tube([W(*p) for p in sail], radii, sides=6)
    displace(sb, lambda co, n: co + n * (0.035 * nz(co * 5.0, off) + 0.015 * nz(co * 13.0, off)))
    A.add(sb, P['sail'], tint=lambda co, fc: (0.9 + 0.1 * nz(co * 3.0, off),) * 3)
    dsail = (sail[-1] - sail[0]).normalized()
    for k in (2, 4, 6):                   # rope ties round the furled sail
        c = sail[k]
        u_ = dsail.orthogonal().normalized()
        w_ = dsail.cross(u_)
        rr = radii[k] + 0.012
        A.add(bm_tube([W(*(c + (u_ * math.cos(a) + w_ * math.sin(a)) * rr)) for a in [TAU * j / 7 for j in range(7)]],
                      0.012, sides=3, closed=True), P['rope'])
    # mooring line from the stem down to a coil in the sand
    tipw = W(L / 2 + 0.02, 0, sheer(L / 2) + 0.3)
    coil_c = W(L / 2 + 0.75, 0.5, 0.0)
    coil_c.z = 0.0
    A.add(bm_tube([tipw, tipw.lerp(coil_c, 0.5) + V((0, 0, -0.3)), coil_c + V((0.12, 0, 0.05))], 0.014, sides=4),
          P['rope'])
    coil = bm_lathe([(0.1, 0.0), (0.2, 0.0), (0.21, 0.05), (0.13, 0.07), (0.1, 0.0)], segs=10, cap=False)
    A.add(move(coil, coil_c), P['rope'])
    # colliders: three boxes along the rolled hull
    A.col_obox(W(0, 0, D * 0.5), (L * 0.6, B * 0.9, D), M3)
    for sx in (-1, 1):
        A.col_obox(W(sx * L * 0.37, 0, (D + 0.1) * 0.55), (L * 0.2, B * 0.62, D * 0.95), M3)
    return A.finalize()


def pot_plant(A, P, c, rng, off, s=1.0):
    """A terracotta pot of geraniums."""
    c = V(c)
    pot = bm_lathe([(0.0, 0.0), (0.1 * s, 0.0), (0.155 * s, 0.24 * s), (0.18 * s, 0.25 * s), (0.18 * s, 0.29 * s),
                    (0.148 * s, 0.29 * s), (0.138 * s, 0.25 * s), (0.0, 0.23 * s)], segs=10)
    A.add(move(pot, c), P['clay'], tint=lambda co, fc: (0.85 + 0.15 * smoothstep(0.0, 0.2, co.z - c.z),) * 3)
    A.add(lumpy(c + V((0, 0, 0.36 * s)), 0.2 * s, (1.25, 1.2, 0.85), off + c, amp=0.38), P['leaf'])
    for k in range(4):
        a = rng.uniform(0, TAU)
        d = rng.uniform(0.05, 0.16) * s
        A.add(bm_ico(0.045 * s, 1, c + V((d * math.cos(a), d * math.sin(a), rng.uniform(0.48, 0.55) * s))),
              P['flower'])


# ============================================================================
# T_Stair: exterior stone stair against a wall, whitewashed side and parapet
# ============================================================================
def build_stair(P):
    A = Asset('T_Stair', P, budget=BUDGET['T_Stair'])
    A.ao_dist = 2.5
    rng = random.Random(14)
    off = noff(rng)
    X0, X1, ZT = -2.0, 2.0, 3.6
    n = 18
    rise = ZT / n
    land = 0.6
    g = (X1 - X0 - land) / (n - 1)
    wy0, wy1 = -0.6, 0.6            # the flight; the wall it stands against is at +Y
    py0 = -0.8                      # parapet outer face
    # the masonry body under the flight and landing (hidden faces dropped)
    fr = Frame((X0, 0.0, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0))
    # body top: 4 cm under the tread tops, inside the tread blocks
    top = [(0.0, -0.04), ((n - 1) * g, ZT - rise - 0.04), ((n - 1) * g + 0.005, ZT - 0.06), (X1 - X0, ZT - 0.06)]
    body = holey_slab(fr, 0.0, X1 - X0, ZB, ZT, wy0, wy1, (), top=top, step=0.9, bands=(0.3,), vbot=False,
                      faces=('pos', 'end'))
    A.add(body, None, mats=[P['stucco']] * 6, smooth=True)
    # the side wall and parapet: one whitewashed mass along the open side, a newel at its foot
    NW = 0.22
    ptop = [(0.0, 1.35), (NW, 1.35), (NW + 0.005, 1.23), ((n - 1) * g + 0.1, ZT + 0.88), (X1 - X0, ZT + 0.88)]
    pw = holey_slab(fr, 0.0, X1 - X0, ZB, ZT + 0.9, py0, wy0, (), top=ptop, step=0.6, bands=(0.3,),
                    vextra=(0.0,), vbot=False)

    def side_y(u, z):                 # the open side's outer face, gently uneven
        return py0 - 0.008 * nz((u * 1.5, z * 1.5, 0.0), off)
    for v in pw.verts:
        d = v.co - fr.O
        if abs(d.dot(fr.T) - py0) < 1e-4:
            v.co.y = side_y(d.x, d.z)
    st, sc = P['stone'], P['stucco']
    A.add(pw, None, mats=[sc] * 6, smooth=True, tint=lambda co, fc: (0.97, 0.965, 0.94))
    # lime worn off low down (a stone splash band with a ragged top) and flaked in patches
    surf = lambda u, z, lift: V((u + X0, side_y(u, z) - lift, z))
    A.add(lime_band(fr, 0.02, X1 - X0 - 0.02, lambda u: 0.36 + 0.14 * nz((u * 1.9, 0.0, 2.0), off) +
                    0.05 * nz((u * 7.0, 1.0, 2.0), off), lambda u: -0.05, surf, n=26, lift=0.005), st)
    for (u, z, rx, ry) in ((0.9, 1.1, 0.2, 0.12), (1.7, 0.75, 0.14, 0.09), (2.5, 2.2, 0.24, 0.14), (3.3, 1.5, 0.16, 0.1),
                           (3.6, 3.1, 0.12, 0.08), (1.35, 1.75, 0.1, 0.07)):
        A.add(blob(surf(u, z, 0.006), (0, -1, 0), (1, 0, 0), rx, ry, rng), st)
    # rounded whitewashed coping along the parapet
    pts2 = [(u + X0, z) for (u, z) in ptop[2:]]
    for (xa, za), (xb, zb) in zip(pts2, pts2[1:]):
        prof = [(-0.125, -0.03), (-0.125, 0.025), (-0.085, 0.07), (0.0, 0.088), (0.085, 0.07), (0.125, 0.025),
                (0.125, -0.03)]
        a, b = V((xa - 0.01, 0, za)), V((xb + 0.01, 0, zb))
        d = (b - a).normalized()
        up = V((0, 0, 1)) - d * d.z
        up.normalize()
        bmc = bmesh.new()
        ra = [bmc.verts.new(a + V((0, (py0 + wy0) / 2 + y, 0)) + up * zz) for (y, zz) in prof]
        rb = [bmc.verts.new(b + V((0, (py0 + wy0) / 2 + y, 0)) + up * zz) for (y, zz) in prof]
        for j in range(len(prof) - 1):
            bmc.faces.new([ra[j], rb[j], rb[j + 1], ra[j + 1]])
        bmc.faces.new(list(reversed(ra)))
        bmc.faces.new(rb)
        bmc.normal_update()
        cc = (a + b) / 2 + V((0, (py0 + wy0) / 2, 0))
        for f in bmc.faces:
            if f.normal.dot(f.calc_center_median() - cc) < 0:
                f.normal_flip()
        set_smooth(bmc, True)
        A.add(bmc, sc)
    # newel pillar cap at the foot of the parapet
    newel = ring_lathe(rect_ring(NW / 2, (wy0 - py0) / 2, 0.0), [(-0.01, 1.35), (0.035, 1.37), (0.035, 1.42),
                                                               (0.02, 1.435)])
    A.add(move(newel, (X0 + NW / 2, (py0 + wy0) / 2, 0.0)), sc)
    # slate treads: solid blocks with worn, slightly uneven nosings (ends and backs hidden)
    for i in range(n - 1):
        xa, xb = X0 + i * g, X0 + (i + 1) * g
        zt = (i + 1) * rise
        zb = zt - rise - 0.06
        pts = [V((xa - 0.025, wy0, zb)), V((xb, wy0, zb)), V((xb, wy1, zb)), V((xa - 0.025, wy1, zb)),
               V((xa - 0.025, wy0, zt - rng.uniform(0.0, 0.012))), V((xb, wy0, zt)), V((xb, wy1, zt)),
               V((xa - 0.025, wy1, zt - rng.uniform(0.0, 0.012)))]
        stb = hexa(pts)
        nose = [e for e in stb.edges if all(abs(v.co.x - (xa - 0.025)) < 1e-6 and v.co.z > zt - 0.03 for v in e.verts)]
        bmesh.ops.bevel(stb, geom=nose, offset=0.025, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
        drop_faces(stb, lambda f: f.normal.z < -0.9 or f.normal.x > 0.9 or abs(f.normal.y) > 0.9)
        set_smooth(stb, True)
        A.add(stb, P['schist'], tint=(rng.uniform(0.85, 1.0),) * 3)
    lx0 = X0 + (n - 1) * g
    A.add(rock(V(((lx0 + X1) / 2 - 0.012, 0.0, ZT - 0.04)), (X1 - lx0 + 0.02, wy1 - wy0, 0.08), rng, jit=0.01, bev=0.3,
               edges='top', drop_bottom=True), P['schist'])
    # geraniums in terracotta pots: on the landing against the wall, and on the newel post
    pot_plant(A, P, (X1 - 0.24, wy1 - 0.24, ZT), rng, off, 1.0)
    pot_plant(A, P, (X0 + NW / 2, (py0 + wy0) / 2, 1.435), rng, off, 0.78)
    # colliders: ramp over the flight, the landing, the parapet, stepped fill under the flight
    A.ramp((X0 - g * 0.5, 0.0, 0.0), (lx0 - g * 0.5, 0.0, ZT), wy1 - wy0)
    A.col((lx0, wy0, ZB), (X1, wy1, ZT))
    A.ramp((X0 + NW, (py0 + wy0) / 2, 1.23), (lx0 + 0.1, (py0 + wy0) / 2, ZT + 0.88), wy0 - py0, thick=1.0)
    A.col((lx0 + 0.1, py0, ZT - 0.1), (X1, wy0, ZT + 0.97))
    A.col((X0, py0, ZB), (X0 + NW, wy0, 1.45))
    k = 5
    for j in range(k):
        xa = X0 + (lx0 - X0) * j / k
        xb = X0 + (lx0 - X0) * (j + 1) / k
        ztop = (xa - (X0 - g * 0.5)) * ZT / (lx0 - X0) - 0.02
        if ztop > 0.05:
            A.col((xa, py0, ZB), (xb, wy1, ztop))
    A.lean = Matrix.Translation((0.0, -(py0 + wy1) / 2, 0.0))
    return A.finalize()


# ============================================================================
# build / export / verify
# ============================================================================
BUILDERS = [
    ('T_Well', build_well),
    ('T_Lamp', build_lamp),
    ('T_Bench', build_bench),
    ('T_Crate', build_crate),
    ('T_Barrel', build_barrel),
    ('T_Amphora', build_amphora),
    ('T_Cart', build_cart),
    ('T_GardenWall', build_gardenwall),
    ('T_Cypress', build_cypress),
    ('T_Olive', build_olive),
    ('T_Egg', build_egg),
    ('T_Gate', build_gate),
    ('T_Boat', build_boat),
    ('T_Stair', build_stair),
]


def describe(root):
    """tris / colliders / materials / slots of a built root (Blender side)."""
    objs = [root] + list(root.children_recursive)
    vis = [o for o in objs if o.type == 'MESH' and '_COL' not in o.name]
    tris = sum(len(p.vertices) - 2 for o in vis for p in o.data.polygons)
    mats = sorted({m.name for o in vis for m in o.data.materials if m})
    cols = [o for o in objs if o.type == 'MESH' and '_COL' in o.name]
    slots = [o.name for o in objs if o.type == 'EMPTY' and o.name.startswith('SLOT_')]
    return dict(tris=tris, cols=len(cols), mats=mats, slots=slots)


def main():
    argv = sys.argv[1:]
    names = [n for n, _ in BUILDERS]
    only = None
    out = DEFAULT_OUT
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
        bad = only - set(names)
        if bad:
            print('unknown roots: %s (have %s)' % (', '.join(sorted(bad)), ', '.join(names)))
            return 2
    if '--out' in argv:
        out = os.path.abspath(argv[argv.index('--out') + 1])
    elif only and '--verify-only' not in argv:
        print('NOTE: --only without --out rewrites %s with just %s (as build_town does)' % (out, ', '.join(sorted(only))))
    if '--verify-only' in argv:
        return 0 if verify(out, only and sorted(only)) else 1
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 8 if '--fast' in argv else bt.AO_SAMPLES      # --fast: noisy AO, for iterating
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world = bpy.data.worlds.new('AOWorld')
    bt.COLL = sc.collection
    noise.seed_set(1958)
    P = palette()
    t0 = time.time()
    stats = {}
    for name, fn in BUILDERS:
        if only and name not in only:
            continue
        stats[name] = describe(fn(P))
    if bt.AO_GROUND is not None:
        bpy.data.objects.remove(bt.AO_GROUND)
        bt.AO_GROUND = None
    for ob in bt.COLL.objects:
        if ob.parent is None:
            assert ob.location.length < 1e-9 and ob.matrix_world == Matrix.Identity(4), ob.name
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    if bt.DEBUG_TRIS:                 # TOWN_DEBUG_TRIS=1: tris by material and caller
        for (m, who), k in sorted(bt.DEBUG_TRIS.items(), key=lambda kv: -kv[1])[:30]:
            print('   %6d  %-14s %s' % (k, m, who))
    bt.export(out)
    pack_glb.pack(out, out)
    print('exported %s in %.1fs' % (out, time.time() - t0))
    ok = verify(out, sorted(stats), stats) if '--no-verify' not in argv else True
    print_table(stats, out)
    return 0 if ok else 1


def print_table(stats, out):
    print('\n%-14s %6s %6s %4s  %s' % ('root', 'tris', 'cap', 'cols', 'materials'))
    for name, s in stats.items():
        print('%-14s %6d %6d %4d  %s' % (name, s['tris'], BUDGET[name], s['cols'], ', '.join(s['mats'])))
    print('%s: %.2f MB' % (out, os.path.getsize(out) / 1e6))


def verify(path, expect=None, built=None):
    """Re-import the packed glb and check the contract: root names, identity
    root transforms, collider counts, tri budgets (and build-time counts),
    the lamp's slot and glass, the gate's clear opening, the packing."""
    names = expect or [n for n, _ in BUILDERS]
    errs = []
    # the packed file itself: quantized, AO in COLOR_0, colliders stripped to positions
    j, _ = pack_glb.load(path)
    if 'KHR_mesh_quantization' not in j.get('extensionsUsed', []):
        errs.append('not packed (no KHR_mesh_quantization): run pack_glb.py')
    for me in j['meshes']:
        for p in me['primitives']:
            at = set(p['attributes'])
            if '_COL' in me.get('name', ''):
                if at != {'POSITION'}:
                    errs.append('collider %s keeps %s' % (me['name'], sorted(at)))
            elif 'COLOR_0' not in at:
                errs.append('%s has no COLOR_0 (AO)' % me.get('name'))
    size = os.path.getsize(path)
    if size > 2.2e6:
        errs.append('file is %.2f MB (expected < ~2 MB)' % (size / 1e6))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    roots = {o.name: o for o in bpy.data.objects if o.parent is None}
    for n in names:
        if n not in roots:
            errs.append('missing root %s' % n)
    for n in roots:
        if n not in names:
            errs.append('unexpected root %s' % n)
    I = Matrix.Identity(4)
    for n in names:
        o = roots.get(n)
        if o is None:
            continue
        if any(abs(o.matrix_world[r][c] - I[r][c]) > 1e-5 for r in range(4) for c in range(4)):
            errs.append('%s: root transform is not identity' % n)
        kids = list(o.children_recursive)
        cols = [k for k in kids if k.type == 'MESH' and '_COL' in k.name]
        vis = [o] + [k for k in kids if k.type == 'MESH' and '_COL' not in k.name]
        vis = [v for v in vis if v.type == 'MESH']
        tris = sum(len(p.vertices) - 2 for v in vis for p in v.data.polygons)
        if len(cols) != COLS[n]:
            errs.append('%s: %d colliders, expected %d' % (n, len(cols), COLS[n]))
        if tris > BUDGET[n]:
            errs.append('%s: %d tris over the %d cap' % (n, tris, BUDGET[n]))
        if built and n in built and tris != built[n]['tris']:
            print('verify note: %s has %d tris after export, %d built' % (n, tris, built[n]['tris']))
        wverts = [v.matrix_world @ p.co for v in vis for p in v.data.vertices]
        lo = V((min(p.x for p in wverts), min(p.y for p in wverts), min(p.z for p in wverts)))
        hi = V((max(p.x for p in wverts), max(p.y for p in wverts), max(p.z for p in wverts)))
        if lo.z > 0.02 or lo.z < -0.75:
            errs.append('%s: does not sit on the ground (min z %.2f)' % (n, lo.z))
        # origin in the middle of what stands on the ground (overhangs such as the lamp's
        # bracket do not count); trees, the boat and the leaning amphora are exempt
        gnd = [p for p in wverts if p.z < 0.4]
        gx = (min(p.x for p in gnd) + max(p.x for p in gnd)) / 2
        gy = (min(p.y for p in gnd) + max(p.y for p in gnd)) / 2
        if n not in ('T_Boat', 'T_Amphora', 'T_Olive', 'T_Cypress') and math.hypot(gx, gy) > 0.25:
            errs.append('%s: ground footprint centred at (%.2f, %.2f), not the origin' % (n, gx, gy))
        print('verify %-13s %5d tris  %2d colliders  %5.2f x %5.2f x %5.2f m  ground centre (%+.2f, %+.2f)' % (
            n, tris, len(cols), hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, gx, gy))
        if n == 'T_Lamp':
            if not any(k.name.startswith('SLOT_light') for k in kids):
                errs.append('T_Lamp: no SLOT_light empty')
            glass = [m for v in vis for m in v.data.materials if m and m.name == 'LampGlass']
            if not glass:
                errs.append('T_Lamp: no LampGlass material')
        if n == 'T_Gate':
            # nothing may block the opening: probe a grid through it against every collider box
            ow, oh = GATE_OPENING
            r, hs = ow / 2 - 0.02, oh - ow / 2
            boxes = []
            for k in cols:
                inv = k.matrix_world.inverted()
                bb = [V(c) for c in k.bound_box]
                boxes.append((k.name, inv, V((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb))),
                              V((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))))
            hits = set()
            for i in range(41):
                x = -r + 2 * r * i / 40
                ztop = hs + math.sqrt(max(0.0, r * r - x * x)) - 0.02
                for jz in range(60):
                    z = 0.02 + (ztop - 0.02) * jz / 59
                    for y in (-0.36, 0.0, 0.36):
                        for name, inv, bmn, bmx in boxes:
                            q = inv @ V((x, y, z))
                            if bmn.x < q.x < bmx.x and bmn.y < q.y < bmx.y and bmn.z < q.z < bmx.z:
                                hits.add(name)
            for name in sorted(hits):
                errs.append('T_Gate: collider %s blocks the opening' % name)
            if not hits:
                print('verify T_Gate: opening %.2f x %.2f m clear of all colliders' % (ow, oh))
            # scaled 1.5x as the railway tunnel mouth, a 3.2 m wide, 4.5 m tall train passes through
            inside = [p for p in wverts if abs(p.x) * 1.5 < 1.6 and 0.02 < p.z * 1.5 < 4.5 and abs(p.y) < 0.6]
            if inside:
                errs.append('T_Gate: %d vertices inside the train envelope at 1.5x' % len(inside))
            else:
                print('verify T_Gate: at 1.5x the 3.2 x 4.5 m train envelope is clear of all geometry')
    for e in errs:
        print('VERIFY FAIL:', e)
    print('verify %s: %s (%d roots, %.2f MB)' % (path, 'OK' if not errs else '%d problems' % len(errs), len(names),
                                                 size / 1e6))
    return not errs


if __name__ == '__main__':
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
