#!/usr/bin/env python3
"""
Juxtapose -- the Figment, v3: a jointed wooden mannequin with the suit as
separate cloth.

    python3 juxtapose/blender/build_figure_v3.py [--preview] [--reuse]

The body is a sculpt of a wooden artist's mannequin (Higgsfield front/side/back
views -> Tripo multiview, art_src/figure/src/mannequin.glb). A mannequin is
rigid pieces between ball joints, so that is how it is rigged: a sphere is fitted
to every ball joint, the rig's pivots (build_figure.JOINTS) were set from those
centres, the sculpt is cut apart at the crevices, and each piece is carried onto
its bone and bound to it alone. Shoulders, elbows, knees turn exactly where the
wood does.

The suit is not sculpted but cut, the way a haori and hakama are: rectangles of
cloth wrapped around that body, as thin sheets with free edges.
  Haori     body tube open at the front, closed over the shoulders, to mid-thigh;
            two sleeve bags hanging from the arms, open at the cuff and the armpit
  Hakama    a pleated tube from the sash to the ankles
  Inner     the kimono front, shirt V and red tie seen in the opening
  Scarf     a loop round the neck and two ends hanging down the front
Each garment carries skin weights (where the cloth is when nothing moves) and
_maxd, the reach: how far the game's cloth solver (src/cloth.js) may carry each
point from that pose. Nothing at the yoke, the sash and the loop; most at the
hems, the sleeve bottoms and the scarf ends.

Fabrics: Higgsfield-drawn swatches made tileable (art_src/figure/fabric).

Bind pose: the rig's rest with the arms 18 degrees out from the body, so a
sleeve can hang beside the coat instead of inside it. The file says so per bone
(extras "bind", bind = C @ rest); the game builds each bone's inverse from it.

Output: assets/figure_skin.glb (Body, Haori, Hakama, Inner, Scarf).
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hero as H  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIG = os.path.join(ROOT, 'art_src', 'figure')
SRC = os.path.join(FIG, 'src', 'mannequin.glb')
CACHE = os.path.join(FIG, 'src', 'mannequin_lo.blend')
FAB = os.path.join(FIG, 'fabric')
OUT = os.path.join(ROOT, 'assets', 'figure_skin.glb')
HEIGHT = 1.935
BODY_TRIS = 14000
TEX = 2048
ARM_DEG = 18.0

# the deforming skeleton at rest (build_figure.JOINTS: keep in step)
BONES = [
    ('root', None, (0, 0, 0)), ('hips', 'root', (0, 0, 0.98)), ('spine', 'hips', (0, 0, 1.215)),
    ('chest', 'spine', (0, 0, 1.30)), ('neck', 'chest', (0, 0, 1.585)), ('head', 'neck', (0, 0, 1.632)),
    ('upperarmL', 'chest', (0.163, 0, 1.523)), ('forearmL', 'upperarmL', (0.163, 0, 1.224)), ('handL', 'forearmL', (0.163, 0, 0.960)),
    ('upperarmR', 'chest', (-0.163, 0, 1.523)), ('forearmR', 'upperarmR', (-0.163, 0, 1.224)), ('handR', 'forearmR', (-0.163, 0, 0.960)),
    ('thighL', 'hips', (0.09, 0, 0.96)), ('shinL', 'thighL', (0.09, 0, 0.554)), ('footL', 'shinL', (0.09, 0, 0.149)),
    ('thighR', 'hips', (-0.09, 0, 0.96)), ('shinR', 'thighR', (-0.09, 0, 0.554)), ('footR', 'shinR', (-0.09, 0, 0.149)),
    ('sleeveL1', 'forearmL', (0.163, 0.07, 1.219)), ('sleeveR1', 'forearmR', (-0.163, 0.07, 1.219)),
]
REST = {n: np.array(h, float) for n, _, h in BONES}
ARM_CHAIN = ['upperarm', 'forearm', 'hand', 'sleeve']


def arm_bone(b, side):
    return b + side + ('1' if b == 'sleeve' else '')


def correction():
    """rest -> bind, per bone: the arm chains turn out about the shoulder"""
    C = {n: Matrix.Identity(4) for n in REST}
    for side, sg in (('L', 1), ('R', -1)):
        S = V(REST['upperarm' + side])
        R = Matrix.Rotation(math.radians(-sg * ARM_DEG), 4, 'Y')
        for b in ARM_CHAIN:
            C[arm_bone(b, side)] = Matrix.Translation(S) @ R @ Matrix.Translation(-S)
    return C


CORR = correction()
BIND = {n: np.array(CORR[n] @ V(REST[n])) for n in REST}


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))


# ==========================================================================
# body: the mannequin, cut at its joints and carried onto the bind skeleton
# ==========================================================================
def sphere_fit(P, c, r0):
    c = np.array(c, float)
    for _ in range(6):
        Q = P[np.linalg.norm(P - c, axis=1) < r0 * 1.35]
        A = np.c_[2 * Q, np.ones(len(Q))]
        sol, *_ = np.linalg.lstsq(A, (Q ** 2).sum(1), rcond=None)
        c = sol[:3]; r0 = min(max(np.sqrt(sol[3] + c @ c), 0.015), 0.08)
    return c, r0


def joints(P):
    """ball-joint centres on the sculpt, left side fitted, right mirrored"""
    guess = {'S': ((0.165, 0.03, 1.52), 0.05), 'E': ((0.225, 0.03, 1.23), 0.035), 'W': ((0.258, 0.02, 0.968), 0.03),
             'K': ((0.11, 0.035, 0.555), 0.05), 'A': ((0.13, 0.035, 0.15), 0.035)}
    J = {}
    for k, (c, r) in guess.items():
        cL, rL = sphere_fit(P, c, r)
        cR, _ = sphere_fit(P, (-c[0], c[1], c[2]), r)
        J[k + 'L'] = cL; J[k + 'R'] = cR; J['r' + k] = rL
    J['Hp' + 'L'] = np.array([0.09, J['KL'][1], 0.96]); J['HpR'] = np.array([-0.09, J['KR'][1], 0.96])
    J['waist'], J['rwaist'] = sphere_fit(P, (0, 0.02, 1.263), 0.06)
    J['neckball'], J['rneck'] = sphere_fit(P, (0, 0.03, 1.632), 0.04)
    return J


def segments(P, J, N):
    """bone name per vertex of the sculpt"""
    n = len(P)
    seg = np.full(n, 'hips', dtype=object)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    yc = J['neckball'][1]
    # torso by height
    seg[z >= J['waist'][2] - 0.045] = 'spine'
    seg[z >= J['waist'][2] + 0.037] = 'chest'
    seg[z >= 1.585] = 'neck'
    seg[np.linalg.norm(P - J['neckball'], axis=1) < J['rneck'] * 1.15] = 'head'
    seg[z >= J['neckball'][2] + 0.02] = 'head'
    arms_seen = np.zeros(n, bool)
    for side, sg in (('L', 1), ('R', -1)):
        S, E, W, K, A = (J[k + side] for k in 'SEWKA')
        Hp = J['Hp' + side]
        # arms: close to the S-E-W line and clear of the chest block
        def seg_d(a, b):
            d = b - a; t = np.clip(((P - a) @ d) / (d @ d), 0, 1)
            return np.linalg.norm(P - (a + t[:, None] * d), axis=1), ((P - a) @ d) / (d @ d)
        d1, t1 = seg_d(S, E); d2, t2 = seg_d(E, W)
        tipd = (W - E) / np.linalg.norm(W - E)
        d3, t3 = seg_d(W, W + tipd * 0.2)
        onside = (x * sg) > 0.05
        near_arm = onside & (np.minimum(np.minimum(d1, d2), d3) < 0.06) & (z < S[2] + 0.07)
        # where arm and chest block touch, a point is arm if its surface faces away from the arm's axis
        dd = E - S; tt = np.clip(((P - S) @ dd) / (dd @ dd), 0, 1)
        away = np.einsum('ij,ij->i', N, P - (S + tt[:, None] * dd)) > 0
        contested = (np.abs(x) < 0.158) & (z > 1.30) & (z < 1.60) & (np.linalg.norm(P - S, axis=1) > J['rS'] * 1.05)
        arm = near_arm & (~contested | (away & (d1 < 0.045)))
        up = arm & (t1 < 1) & (d1 <= d2 + 0.01)
        seg[arm] = 'forearm' + side
        seg[up] = 'upperarm' + side
        seg[arm & (np.linalg.norm(P - S, axis=1) < J['rS'] * 1.08)] = 'upperarm' + side
        seg[arm & (t2 > 1.0)] = 'hand' + side
        seg[arm & (np.linalg.norm(P - E, axis=1) < J['rE'] * 1.1)] = 'forearm' + side
        seg[arm & (np.linalg.norm(P - W, axis=1) < J['rW'] * 1.1)] = 'hand' + side
        arms_seen = arms_seen | arm
        # legs: below the hip balls, this side of the crotch -- and never what the arms took
        # (the hands hang below the hips: left to this rule they would ride the thighs)
        leg = ((x * sg) > 0.004) & (z < Hp[2]) & ~((np.abs(x) < 0.05) & (z > 0.86)) & ~arms_seen
        seg[leg] = 'thigh' + side
        seg[leg & (z < K[2])] = 'shin' + side
        seg[leg & (np.linalg.norm(P - K, axis=1) < J['rK'] * 0.9)] = 'shin' + side
        seg[leg & (z < A[2])] = 'foot' + side
        seg[leg & (np.linalg.norm(P - A, axis=1) < J['rA'] * 1.0)] = 'foot' + side
    return seg


def placements(J):
    """per bone: (R 3x3, source pivot, target pivot): sculpt space -> bind space"""
    I = np.eye(3)
    yshift = np.array([0, J['neckball'][1], 0])
    out = {}
    for b in ('hips', 'spine', 'chest', 'neck', 'head'):
        out[b] = (I, yshift, np.zeros(3))
    for side in 'LR':
        S, E, W, K, A = (J[k + side] for k in 'SEWKA')
        Sb, Eb, Wb = BIND['upperarm' + side], BIND['forearm' + side], BIND['hand' + side]
        Ru = rot_between(E - S, Eb - Sb); Rf = rot_between(W - E, Wb - Eb)
        out['upperarm' + side] = (Ru, S, Sb)
        out['forearm' + side] = (Rf, E, Eb)
        out['hand' + side] = (Rf, W, Wb)
        Hp = J['Hp' + side]
        Tb, Kb, Ab = BIND['thigh' + side], BIND['shin' + side], BIND['foot' + side]
        out['thigh' + side] = (rot_between(K - Hp, Kb - Tb), Hp, Tb)
        out['shin' + side] = (rot_between(A - K, Ab - Kb), K, Kb)
        out['foot' + side] = (I, A, Ab)
    return out


def place(P, seg, pl):
    Q = P.copy()
    for b, (R, src, dst) in pl.items():
        m = seg == b
        if m.any():
            Q[m] = (P[m] - src) @ R.T + dst
    return Q


def build_body():
    t0 = time.time()
    H.reset()
    hi = H.join_all(H.import_glb(SRC))
    raw = H.tris(hi)
    hi.data.transform(Matrix.Rotation(math.radians(-90), 4, 'Z'))
    mn, mx = H.world_bbox([hi])
    hi.data.transform(Matrix.Scale(HEIGHT / (mx.z - mn.z), 4) @ Matrix.Translation(-V(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    hi.data.update()
    P = H_verts(hi)
    J = joints(P)
    print('  joints', {k: np.round(v, 3).tolist() if hasattr(v, '__len__') else round(float(v), 3) for k, v in J.items()})
    N = np.empty(len(P) * 3); hi.data.vertices.foreach_get('normal', N); N = N.reshape(-1, 3)
    seg = segments(P, J, N)
    # cut the sculpt apart where the pieces meet (each face goes with the majority of its corners)
    bm = bmesh.new(); bm.from_mesh(hi.data)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    names = sorted(set(seg))
    code = {nm: i for i, nm in enumerate(names)}
    vs = np.array([code[s] for s in seg])
    fseg = np.empty(len(bm.faces), int)
    for f in bm.faces:
        c = [vs[v.index] for v in f.verts]
        fseg[f.index] = max(set(c), key=c.count)
    cut = [e for e in bm.edges if len(e.link_faces) == 2 and fseg[e.link_faces[0].index] != fseg[e.link_faces[1].index]]
    bmesh.ops.split_edges(bm, edges=cut)
    bm.verts.ensure_lookup_table()
    vseg = np.empty(len(bm.verts), object)
    for v in bm.verts:
        vseg[v.index] = names[fseg[v.link_faces[0].index]] if v.link_faces else 'hips'
    bm.to_mesh(hi.data); bm.free()
    P = H_verts(hi)
    Q = place(P, vseg, placements(J))
    hi.data.vertices.foreach_set('co', Q.ravel())
    hi.data.update()
    # decimate, bake, and find each low vertex's piece from the nearest high one
    lo = H.decimated_copy(hi, BODY_TRIS)
    for slot in hi.material_slots:
        m = slot.material
        bsdf = m and m.use_nodes and next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            for l in list(bsdf.inputs['Metallic'].links): m.node_tree.links.remove(l)
            bsdf.inputs['Metallic'].default_value = 0.0
    maps = {'albedo': H.bake(hi, lo, 'albedo', TEX, 'Body'), 'normal': H.bake(hi, lo, 'normal', TEX // 2, 'Body')}
    for img in maps.values():
        img.file_format = 'JPEG'; img.pack()
    H.final_material(lo, 'Body', maps, {'rough': 0.55})
    kd = KDTree(len(Q))
    for i, q in enumerate(Q):
        kd.insert(q, i)
    kd.balance()
    L = H_verts(lo)
    lseg = np.array([vseg[kd.find(p)[1]] for p in L], object)
    for b in ('handL', 'handR', 'thighL', 'thighR'):
        m = lseg == b
        print(f'  piece {b}: {int(m.sum())} verts, height {L[m, 2].min():.3f}..{L[m, 2].max():.3f}, x {L[m, 0].min():.3f}..{L[m, 0].max():.3f}')
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = lo.data.name = 'Body'
    lo['seg'] = json.dumps(lseg.tolist())
    print(f'  body {raw} -> {H.tris(lo)} tris, pieces {sorted(set(lseg))} ({time.time() - t0:.0f}s)')
    return lo


def H_verts(ob):
    n = len(ob.data.vertices)
    P = np.empty(n * 3); ob.data.vertices.foreach_get('co', P)
    return P.reshape(-1, 3)


# ==========================================================================
# garments
# ==========================================================================
def superellipse(theta, A, B, n=2.6):
    s, c = np.sin(theta), np.cos(theta)
    return A * np.sign(s) * np.abs(s) ** (2 / n), -B * np.sign(c) * np.abs(c) ** (2 / n)


def mesh_from_grid(name, P, UV, closed_u=False, part=0, keep=None, ring=None):
    """P, UV: (rows, cols, 3/2) -> mesh object of quads between neighbours. A closed tube
    repeats its first column at the end (same place, UV carried on), welded later."""
    if closed_u:
        step = np.linalg.norm(P[:, -1] - P[:, 0], axis=-1)[:, None]
        du = (UV[:, -1, 0] - UV[:, -2, 0])[:, None]
        P = np.concatenate([P, P[:, :1]], 1)
        UV = np.concatenate([UV, np.dstack([UV[:, -1:, 0] + du, UV[:, -1:, 1]])], 1)
        if ring is not None:
            ring = np.concatenate([ring, ring[:, :1]], 1)
    rows, cols = P.shape[:2]
    verts = P.reshape(-1, 3).tolist()
    faces, fuv = [], []
    for j in range(rows - 1):
        for i in range(cols - 1):
            if keep is not None and not keep[j, min(i, keep.shape[1] - 1)]:
                continue
            q = [j * cols + i, j * cols + i + 1, (j + 1) * cols + i + 1, (j + 1) * cols + i]
            faces.append(q)
            fuv.append([UV[j, i], UV[j, i + 1], UV[j + 1, i + 1], UV[j + 1, i]])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    flat = np.array(fuv, float).reshape(-1, 2)
    uvl.data.foreach_set('uv', flat.ravel())
    at = me.attributes.new('part', 'INT', 'POINT')
    at.data.foreach_set('value', [part] * len(me.vertices))
    rt = me.attributes.new('ring', 'FLOAT', 'POINT')
    rt.data.foreach_set('value', (ring.reshape(-1) if ring is not None else np.full(len(me.vertices), -1.0)).astype(np.float32))
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    bm.normal_update()
    bm.to_mesh(ob.data); bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


# body measurements (bind space) the cloth has to clear
def chest_front(z):
    z = np.asarray(z, float)
    return np.interp(z, [0.95, 1.05, 1.15, 1.25, 1.35, 1.45, 1.55, 1.6], [0.08, 0.09, 0.093, 0.085, 0.106, 0.114, 0.10, 0.07])


def haori_AB(z):
    A = np.interp(z, [0.62, 1.0, 1.3, 1.5, 1.62], [0.285, 0.265, 0.25, 0.245, 0.24])
    B = np.interp(z, [0.62, 1.0, 1.3, 1.5, 1.62], [0.175, 0.16, 0.145, 0.135, 0.13])
    return A, B


HEM, TOP = 0.62, 1.615
ARMHOLE_X, ARMHOLE_Z, ARMHOLE_TOP = 0.19, 1.10, TOP - 0.03   # up to the shoulder seam: the sleeve covers the ball
TAN_ARM = math.tan(math.radians(ARM_DEG))


def arm_z(x):
    """height of the bind-pose arm's axis where it crosses x (shoulder to wrist are in line)"""
    return 1.523 - (np.asarray(x, float) - 0.163) / TAN_ARM
FRONT_EDGE = lambda z: np.interp(z, [0.6, 1.3, 1.5, 1.62], [0.105, 0.105, 0.085, 0.07])


def haori_body():
    nz, nu = 34, 72
    rows = []
    zs = np.concatenate([[TOP, TOP - 0.012, TOP - 0.035], np.linspace(TOP - 0.07, HEM, nz - 3)])
    P = np.zeros((nz, nu, 3)); UV = np.zeros((nz, nu, 2)); mask = np.ones((nz - 1, nu - 1), bool)
    n = 2.6
    for j, z in enumerate(zs):
        A, B = haori_AB(z)
        e = FRONT_EDGE(z)
        th0 = math.asin(min(0.999, (e / A) ** (n / 2)))
        th = np.linspace(th0, 2 * math.pi - th0, nu)
        x, y = superellipse(th, A, B, n)
        # the top rows fold over the shoulders: front meets back, except round the neck
        if j < 3:
            k = [0.0, 0.55, 0.85][j]
            neck = np.clip(1 - (np.abs(x) - 0.075) / 0.04, 0, 1)
            y_top = np.where(y > 0, 0.075 * neck, -0.04 * neck)   # the shoulder line, round the back of the neck
            y = y * k + (1 - k) * y_top
        zz = z - 0.045 * smooth(0.12, 0.25, np.abs(x)) * (j < 3)  # shoulders slope to the arm
        P[j, :, 0] = x; P[j, :, 1] = y + 0.005; P[j, :, 2] = zz
        arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.c_[x, y], axis=0), axis=1))])
        UV[j, :, 0] = arc / 0.22; UV[j, :, 1] = z / 0.22
        rows.append(th0)
    # the armholes: a haori is open under the arm, from the shoulder seam to near the waist;
    # the arm leaves the body there and the sleeve takes it
    C = (P[1:, 1:] + P[:-1, :-1]) / 2
    # only the side wall opens: the front and back panels stay whole
    Bz = haori_AB(C[..., 2])[1]
    side = np.abs(C[..., 1] - 0.005) < 0.62 * Bz
    keep = ~((np.abs(C[..., 0]) > ARMHOLE_X) & side & (C[..., 2] > ARMHOLE_Z) & (C[..., 2] < ARMHOLE_TOP))
    return mesh_from_grid('HaoriBody', P, UV, part=0, keep=keep)


def sleeve(side):
    """A kimono sleeve built round the arm: rings square to the arm, from the shoulder ball to
    just past the wrist, each ring moving as one with its point of the arm. The ring is the
    tube round the arm drawn out sideways into the bag (with the arms down a haori's bag
    stands out beside the arm, as in the drawing); the cloth solver lets the bag hang.
    Both ends are open: the arm comes in under the yoke, the hand leaves by the cuff."""
    sg = 1 if side == 'L' else -1
    S, Wr = BIND['upperarm' + side], BIND['hand' + side]
    d = (Wr - S) / np.linalg.norm(Wr - S)
    out = np.array([d[2] * -sg * 0 + math.cos(math.radians(ARM_DEG)) * sg, 0.0, math.sin(math.radians(ARM_DEG))])
    out = out - d * (out @ d); out /= np.linalg.norm(out)      # square to the arm, away from the body
    out = out * 0.72 + np.array([0, 0.69, 0])                    # and back: the bag falls behind the arm
    out = out - d * (out @ d); out /= np.linalg.norm(out)
    yv = np.cross(d, out); yv /= np.linalg.norm(yv)            # the bag's thickness: square to arm and bag
    ts = np.linspace(-0.09, 0.9, 19)   # the cuff stops short: the wooden wrist and the hand hang from it, visibly
    nl = 30
    psi = np.linspace(0, 2 * math.pi, nl, endpoint=False)
    L = np.linalg.norm(Wr - S)
    P = np.zeros((len(ts), nl, 3)); UV = np.zeros((len(ts), nl, 2)); RING = np.zeros((len(ts), nl))
    for a, t in enumerate(ts):
        A = S + (Wr - S) * t
        w = np.interp(t, [-0.09, 0.3, 0.6, 0.9], [0.08, 0.17, 0.21, 0.21])   # how far the bag stands out
        r_in = np.interp(t, [-0.09, 0.2, 0.9], [0.09, 0.07, 0.062])    # room for the shoulder ball, then the arm
        cu, hu = (w - r_in) / 2, (w + r_in) / 2
        u = cu + hu * np.cos(psi)
        tw = 0.022 + (r_in - 0.012) * np.exp(-(u / 0.09) ** 2)
        v = tw * np.sin(psi)
        P[a] = A + np.outer(u, out) + np.outer(v, yv) + np.array([0, 0.005, 0])
        arc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(u), np.diff(v)))])
        UV[a, :, 0] = t * L / 0.22; UV[a, :, 1] = arc / 0.22
        RING[a] = t
    return mesh_from_grid('Sleeve' + side, P, UV, closed_u=True, part=1 if side == 'L' else 2, ring=RING)


def hakama():
    """Hakama are split: a pleated waist over the pelvis, then a wide leg for each leg, so a
    knee lifted to the chest carries its own leg of cloth instead of tearing through a skirt."""
    parts = []
    th = np.linspace(0, 2 * math.pi, 64, endpoint=False)
    zs = np.linspace(1.035, 0.82, 6)
    P = np.zeros((len(zs), len(th), 3)); UV = np.zeros((len(zs), len(th), 2))
    for j, z in enumerate(zs):
        x, y = superellipse(th, np.interp(z, [0.82, 1.035], [0.205, 0.19]), np.interp(z, [0.82, 1.035], [0.135, 0.12]), 2.4)
        pl = 0.008 * ((th * 16 / (2 * math.pi)) % 1.0)
        r = 1 + pl / np.maximum(np.hypot(x, y), 1e-3)
        P[j, :, 0] = x * r; P[j, :, 1] = y * r + 0.005; P[j, :, 2] = z
        arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.c_[x, y], axis=0), axis=1))])
        UV[j, :, 0] = arc / 0.3; UV[j, :, 1] = z / 0.3
    parts.append(mesh_from_grid('HakamaWaist', P, UV, closed_u=True, part=0))
    for side, sg in (('L', 1), ('R', -1)):
        zs = np.linspace(0.86, 0.13, 18)
        th = np.linspace(0, 2 * math.pi, 40, endpoint=False)
        P = np.zeros((len(zs), len(th), 3)); UV = np.zeros((len(zs), len(th), 2))
        s, c = np.sin(th), np.cos(th)
        for j, z in enumerate(zs):
            ao = np.interp(z, [0.13, 0.55, 0.86], [0.16, 0.15, 0.1])     # to the outside
            ai = np.interp(z, [0.13, 0.55, 0.86], [0.1, 0.095, 0.1])      # to the other leg
            b = np.interp(z, [0.13, 0.55, 0.86], [0.2, 0.18, 0.135])
            cx = sg * 0.115
            half = np.where(s * sg > 0, ao, ai)
            x = cx + half * np.sign(s) * np.abs(s) ** (2 / 2.4)
            y = -b * np.sign(c) * np.abs(c) ** (2 / 2.4)
            pl = 0.02 * smooth(0.9, 0.35, z) * ((th * 8 / (2 * math.pi)) % 1.0)
            rr = np.hypot(x - cx, y)
            k = 1 + pl / np.maximum(rr, 1e-3)
            P[j, :, 0] = cx + (x - cx) * k; P[j, :, 1] = y * k + 0.005; P[j, :, 2] = z
            arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.c_[x, y], axis=0), axis=1))])
            UV[j, :, 0] = arc / 0.3; UV[j, :, 1] = z / 0.3
        parts.append(mesh_from_grid('HakamaLeg' + side, P, UV, closed_u=True, part=1 if side == 'L' else 2))
    return parts


def chest_back(z):
    return np.interp(z, [0.95, 1.1, 1.25, 1.35, 1.45, 1.55, 1.6], [0.078, 0.095, 0.075, 0.088, 0.096, 0.09, 0.07])


def inner():
    """The kimono worn under the haori, all the way round (the armholes show its sides): the
    front painted with the shirt V and the tie, the back plain."""
    nz, nu = 22, 56
    zs = np.linspace(1.585, 1.0, nz)
    th = np.linspace(0, 2 * math.pi, nu, endpoint=False)
    P = np.zeros((nz, nu, 3)); UV = np.zeros((nz, nu, 2))
    for j, z in enumerate(zs):
        A = np.interp(z, [1.0, 1.12, 1.25, 1.33, 1.42, 1.5, 1.555, 1.585], [0.165, 0.145, 0.125, 0.13, 0.158, 0.16, 0.14, 0.1])
        f = chest_front(z) + 0.012; bk = chest_back(z) + 0.012
        x, y = superellipse(th, A, 1.0, 2.6)          # y in [-1, 1]: scale front and back apart
        y = np.where(y < 0, y * f, y * bk)
        P[j, :, 0] = x; P[j, :, 1] = y; P[j, :, 2] = z
        front = y < 0
        UV[j, :, 0] = np.clip((x + 0.14) / 0.28, 0.01, 0.99)
        UV[j, :, 1] = np.where(front & (np.abs(x) < 0.14), (z - 0.97) / (1.6 - 0.97), 0.03)
    # closed all round, no armholes: through the haori's armholes you see kimono, never wood;
    # where an arm meets it, the cloth solver moves it aside
    return mesh_from_grid('Inner', P, UV, closed_u=True)


def scarf():
    parts = []
    # the loop round the neck
    nz, nu = 5, 40
    th = np.linspace(0, 2 * math.pi, nu, endpoint=False)
    zs = np.linspace(1.565, 1.64, nz)
    P = np.zeros((nz, nu, 3)); UV = np.zeros((nz, nu, 2))
    for j, z in enumerate(zs):
        bulge = 0.012 * math.sin(math.pi * j / (nz - 1))
        P[j, :, 0] = (0.078 + bulge) * np.sin(th); P[j, :, 1] = -(0.082 + bulge) * np.cos(th) + 0.008; P[j, :, 2] = z
        UV[j, :, 0] = th / (2 * math.pi) * 0.5 / 0.2; UV[j, :, 1] = z / 0.2
    parts.append(mesh_from_grid('ScarfLoop', P, UV, closed_u=True))
    # the two ends, over the chest and the haori's front edges
    for sg in (1, -1):
        nl, nw = 24, 5
        zs = np.linspace(1.585, 0.84, nl)
        P = np.zeros((nl, nw, 3)); UV = np.zeros((nl, nw, 2))
        for j, z in enumerate(zs):
            cx = sg * (0.055 + 0.045 * smooth(1.58, 1.35, z))
            xs = cx + np.linspace(-0.05, 0.05, nw)
            A, B = haori_AB(z)
            hf = B * (1 - (np.minimum(np.abs(xs), A * 0.95) / A) ** 2.6) ** (1 / 2.6)
            yf = -np.maximum(chest_front(z) + 0.03, hf + 0.012)
            P[j, :, 0] = xs; P[j, :, 1] = yf; P[j, :, 2] = z
            UV[j, :, 0] = np.linspace(0, 0.5, nw); UV[j, :, 1] = (1.585 - z) / 0.2
        parts.append(mesh_from_grid('ScarfEnd', P, UV))
    return parts


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
def fabric_material(name, tex, rough=0.85, painted=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    img = painted or bpy.data.images.load(os.path.join(FAB, tex + '_albedo.png'))
    img.pack()
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if not painted:
        nimg = bpy.data.images.load(os.path.join(FAB, tex + '_normal.png'))
        nimg.colorspace_settings.name = 'Non-Color'; nimg.pack()
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nimg
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.6
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def paint_inner():
    """the opening of the haori: dark kimono crossing over a white shirt V, a red tie"""
    W = 256
    u, v = np.meshgrid(np.linspace(0, 1, W), np.linspace(0, 1, W))
    x = (u - 0.5) * 0.28; z = 0.97 + v * (1.6 - 0.97)
    kim = np.array([0.075, 0.08, 0.095])
    img = np.ones((W, W, 3)) * kim
    noise = (np.sin(x * 900) * np.sin(z * 700)) * 0.008
    img += noise[..., None]
    shirt = np.abs(x) < np.clip((z - 1.25) * 0.28, 0, 0.07)
    img[shirt] = [0.86, 0.85, 0.82]
    collar = (np.abs(x) < 0.075) & (z > 1.55)
    img[collar] = [0.9, 0.89, 0.86]
    tie = (np.abs(x) < 0.018 + 0.008 * smooth(1.5, 1.3, z)) & (z > 1.2) & (z < 1.585)
    img[tie] = [0.55, 0.05, 0.06]
    knot = (np.abs(x) < 0.02) & (z > 1.54) & (z < 1.585)
    img[knot] = [0.45, 0.04, 0.05]
    # the crossing kimono edges (a slightly lighter band)
    band = (np.abs(np.abs(x) - np.clip((z - 1.25) * 0.28, 0, 0.07)) < 0.008) & (z > 1.25)
    img[band] = kim * 1.8
    im = bpy.data.images.new('Inner_albedo', W, W, alpha=False)
    lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
    im.pixels.foreach_set(np.dstack([lin, np.ones((W, W))]).astype(np.float32).ravel())
    im.file_format = 'PNG'
    return im


# ==========================================================================
# weights and reach
# ==========================================================================
def column_weights(z):
    keys = [(0.98, 'hips'), (1.215, 'hips'), (1.26, 'spine'), (1.32, 'chest'), (1.585, 'chest'), (1.61, 'neck')]
    out = {}
    zc = np.clip(z, keys[0][0], keys[-1][0])
    for (z0, b0), (z1, b1) in zip(keys, keys[1:]):
        m = (zc >= z0) & (zc <= z1)
        t = (zc[m] - z0) / (z1 - z0)
        out.setdefault(b0, np.zeros(len(z)))[m] += 1 - t
        out.setdefault(b1, np.zeros(len(z)))[m] += t
    s = sum(out.values())
    return {b: v / np.maximum(s, 1e-9) for b, v in out.items()}


def leg_weights(P, W, amount):
    x, z = P[:, 0], P[:, 2]
    mL = smooth(-0.07, 0.07, x)
    up = smooth(0.40, 0.66, z)
    for side, m in (('L', mL), ('R', 1 - mL)):
        W.setdefault('thigh' + side, np.zeros(len(P)))
        W.setdefault('shin' + side, np.zeros(len(P)))
        W['thigh' + side] += amount * m * up
        W['shin' + side] += amount * m * (1 - up)


def arm_weights(P, side, W, amount, ring=None):
    """upper arm or forearm by where along the arm a point is. by_slice: a sleeve's ring moves
    as one with the point of the arm it surrounds (the arm crosses each x once), so bending
    the elbow turns rings, never shears them open"""
    S, E, Wr = BIND['upperarm' + side], BIND['forearm' + side], BIND['hand' + side]
    d = Wr - S
    if ring is not None:
        t = ring
    else:
        t = ((P - S) @ d) / (d @ d)
    tE = np.linalg.norm(E - S) / np.linalg.norm(d)
    fore = smooth(tE - 0.12, tE + 0.12, t)
    for b, v in (('upperarm' + side, 1 - fore), ('forearm' + side, fore)):
        W.setdefault(b, np.zeros(len(P)))
        W[b] += amount * v


def garment_weights(name, P, part, ring=None):
    n = len(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    W = {}
    if name == 'Haori':
        sleeve = part > 0
        body = ~sleeve
        col = column_weights(np.maximum(z, 0.98))
        low = smooth(1.02, 0.9, z)
        # the yoke over the shoulder balls follows the arms a little
        # round the armhole the coat rides the upper arm: an arm swung forward carries the
        # front panel over itself rather than passing through it
        sh = smooth(0.1, 0.21, np.abs(x)) * smooth(1.04, 1.34, z) * 0.95
        for b, v in col.items():
            W.setdefault(b, np.zeros(n)); W[b] += np.where(body, v * (1 - low * 0.4) * (1 - sh), 0)
        leg_weights(P, W, np.where(body, low * 0.4, 0))
        for side, sg in (('L', 1), ('R', -1)):
            on = (x * sg) > 0
            arm_weights(P, side, W, np.where(body & on, sh, 0))
            arm_weights(P, side, W, np.where(sleeve & on, 1.0, 0), ring=ring)
        # reach: the skirt below the waist, the sleeve bag below the arm
        reach = np.where(body, 0.17 * smooth(1.18, 0.64, z), 0)
        for side, sg in (('L', 1), ('R', -1)):
            S, Wr = BIND['upperarm' + side], BIND['hand' + side]
            d = (Wr - S) / np.linalg.norm(Wr - S)
            q = P - S
            perp = q - np.outer(q @ d, d)
            below = np.linalg.norm(perp, axis=1)                # how far from the arm, out into the bag
            r = 0.3 * smooth(0.075, 0.2, below)
            reach = np.where(sleeve & ((x * sg) > 0), r, reach)
    elif name == 'Hakama':
        waist = part == 0
        # the front of the waist lifts with a knee (a hakama's front panel is one piece with its leg)
        front = smooth(0.0, 0.06, -(P[:, 1] - 0.005)) * smooth(0.96, 0.84, z)
        W['hips'] = np.where(waist, 1.0 - 0.6 * front, 0.3 * smooth(0.72, 0.86, z))
        mLw = smooth(-0.05, 0.05, x)
        for side, m in (('L', mLw), ('R', 1 - mLw)):
            W['thigh' + side] = np.where(waist, 0.6 * front * m, 0.0)
        up = smooth(0.34, 0.74, z)   # a long knee: the wide leg bends as a bag, not a hinge
        for side, pid in (('L', 1), ('R', 2)):
            leg = (part == pid) * (1 - W['hips'])
            W['thigh' + side] = W['thigh' + side] + leg * up
            W['shin' + side] = leg * (1 - up)
        reach = np.where(waist, 0.03 * smooth(0.95, 0.83, z), 0.15 * smooth(0.82, 0.4, z))
    elif name == 'Inner':
        for b, v in column_weights(z).items():
            W[b] = v
        reach = np.zeros(n)
    else:  # Scarf: hangs from the neck; the ends, below the sash, lean on the legs
        low = 0.5 * smooth(1.1, 0.86, z)
        W['chest'] = 1 - low
        leg_weights(P, W, low)
        reach = 0.16 * smooth(1.38, 0.86, z)
    return W, reach


def body_weights(ob):
    seg = json.loads(ob['seg'])
    return {b: (np.array(seg) == b).astype(float) for b in set(seg)}, None


def apply_weights(ob, W, reach):
    names = list(W)
    M = np.stack([W[b] for b in names], 1)
    M[M < 1e-4] = 0
    idx = np.argsort(-M, 1)[:, :4]
    top = np.take_along_axis(M, idx, 1)
    s = top.sum(1)
    bad = s < 1e-6
    top[bad, 0] = 1; idx[bad, 0] = names.index('chest') if 'chest' in names else 0; s[bad] = 1
    top /= s[:, None]
    groups = {nm: ob.vertex_groups.new(name=nm) for nm in names}
    for v in range(len(M)):
        for j in range(top.shape[1]):
            if top[v, j] > 0:
                groups[names[idx[v, j]]].add([v], float(top[v, j]), 'REPLACE')
    if reach is not None:
        a = ob.data.attributes.new('_maxd', 'FLOAT', 'POINT')
        a.data.foreach_set('value', reach.astype(np.float32))
    print(f'  {ob.name}: {len(M)} verts, {len(ob.data.polygons)} faces, bones {sorted(names)}'
          + (f', free {int((reach > 0).sum())}, reach max {reach.max():.2f}' if reach is not None else ''))


# ==========================================================================
def armature():
    ad = bpy.data.armatures.new('FigureSkin')
    ob = bpy.data.objects.new('FigureSkin', ad)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    for n, p, h in BONES:
        b = ad.edit_bones.new(n)
        b.head = V(h); b.tail = V(h) + V((0, 0, 0.06)); b.roll = 0
        if p:
            b.parent = ad.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def to_gltf(M):
    A = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    G = A @ M @ A.inverted()
    return [G[r][c] for c in range(4) for r in range(4)]


def main():
    t0 = time.time()
    if '--reuse' in sys.argv and os.path.exists(CACHE):
        bpy.ops.wm.open_mainfile(filepath=CACHE)
        body = bpy.data.objects['Body']
    else:
        body = build_body()
        bpy.ops.wm.save_as_mainfile(filepath=CACHE)
    for o in list(bpy.data.objects):
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    garments = {
        'Haori': (join([haori_body(), sleeve('L'), sleeve('R')], 'Haori'), fabric_material('Haori', 'haori', 0.82)),
        'Hakama': (join(hakama(), 'Hakama'), fabric_material('Hakama', 'hakama', 0.8)),
        'Inner': (join([inner()], 'Inner'), fabric_material('Inner', None, 0.7, painted=paint_inner())),
        'Scarf': (join(scarf(), 'Scarf'), fabric_material('Scarf', 'scarf', 0.95)),
    }
    arm = armature()
    W, _ = body_weights(body)
    apply_weights(body, W, None)
    for name, (ob, mat) in garments.items():
        ob.data.materials.clear(); ob.data.materials.append(mat)
        part = np.zeros(len(ob.data.vertices), int)
        ob.data.attributes['part'].data.foreach_get('value', part)
        ring = np.zeros(len(ob.data.vertices), np.float32)
        ob.data.attributes['ring'].data.foreach_get('value', ring)
        W, reach = garment_weights(name, H_verts(ob), part, ring)
        ob.data.attributes.remove(ob.data.attributes['part'])
        ob.data.attributes.remove(ob.data.attributes['ring'])
        apply_weights(ob, W, reach)
    for ob in [body] + [g[0] for g in garments.values()]:
        ob.parent = arm
        ob.modifiers.new('arm', 'ARMATURE').object = arm
    arm['bind'] = json.dumps({n: to_gltf(CORR[n]) for n in REST if CORR[n] != Matrix.Identity(4)})
    if '--preview' in sys.argv:
        preview(arm, [body] + [g[0] for g in garments.values()])
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for ob in [body] + [g[0] for g in garments.values()]:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='JPEG',
                              export_jpeg_quality=86, export_yup=True, export_extras=True, export_skins=True,
                              export_animations=False, export_def_bones=False, export_influence_nb=4,
                              export_attributes=True)
    print(f'wrote {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB, {time.time() - t0:.0f}s)')


def preview(arm, obs):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 8; sc.cycles.device = 'CPU'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.82, 1)
    lamp = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); lamp.data.energy = 3
    lamp.rotation_euler = (0.8, 0.2, 0.6); sc.collection.objects.link(lamp)
    sc.render.resolution_x = 400; sc.render.resolution_y = 560
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.1
    out = os.environ.get('PREVIEW_DIR', '/tmp')
    for i, a in enumerate([0, 90, 180, 35]):
        rr = math.radians(a)
        cam.location = (3 * math.sin(rr), -3 * math.cos(rr), 0.97); cam.rotation_euler = (math.pi / 2, 0, rr)
        sc.render.filepath = os.path.join(out, f'v3_{i}.png')
        bpy.ops.render.render(write_still=True)
    # the body alone
    for o in obs[1:]:
        o.hide_render = True
    for i, a in enumerate([0, 90]):
        rr = math.radians(a)
        cam.location = (3 * math.sin(rr), -3 * math.cos(rr), 0.97); cam.rotation_euler = (math.pi / 2, 0, rr)
        sc.render.filepath = os.path.join(out, f'v3_body_{i}.png')
        bpy.ops.render.render(write_still=True)
    for o in obs[1:]:
        o.hide_render = False


if __name__ == '__main__':
    main()
