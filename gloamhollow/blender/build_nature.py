"""
build_nature.py - trees, bushes, forageables, rocks, ores, cliffs and the
distant world-tree for Gloamhollow  ->  assets/models/nature.glb

    python blender/build_nature.py          (bpy module)
    blender -b -P blender/build_nature.py   (Blender)

Every asset is ONE mesh object (instanced heavily in-game) named exactly as
in ASSETS.md, origin at the ground centre.  Foliage faces use Mat_Leaves
(wind sway + autumn tint), everything else Mat_Base, tiny glows Mat_Emit.
Colliders are custom properties: col_r (circle radius) / col_box [w, d].
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: F401,E402
from mathutils import Vector  # noqa: E402

from ghlib import export_glb, hexc, mix, reset_scene, stats  # noqa: E402
from nature_kit import NB, bezier, finish, lerp  # noqa: E402

# ---------------------------------------------------------------------------
# local colours (sRGB)
# ---------------------------------------------------------------------------
NEEDLE = mix(mix('pine', 'pine_light', 0.45), 'teal', 0.25)
NEEDLE_DK = mix(NEEDLE, 'pine', 0.5)
NEEDLE_TIP = mix(NEEDLE, 'pine_light', 0.6)
BARK_PINE = mix('bark', 'wood_grey', 0.35)
BARK_OAK = mix('bark', 'wood_grey', 0.3)
BIRCH_MARK = mix('birch_mark', 'wood_grey', 0.3)
BIRCH_LEAF = mix(mix('leaf_light', 'leaf', 0.45), 'moss', 0.2)
OAK_LEAF = mix('leaf', 'leaf_dark', 0.45)
DEAD_WOOD = hexc('#5f5c58')
DEAD_DARK = hexc('#4a4643')
LICHEN = hexc('#6d735a')
CUT_WOOD = mix('wood_light', 'straw', 0.25)
CUT_RING = mix('wood_light', 'wood', 0.55)
MOSS = mix('moss', 'turf', 0.3)
MOSS_LT = mix('moss', 'leaf_light', 0.3)
ROCK = mix('stone', 'slate', 0.25)
SLATE = mix('slate', 'blue_dark', 0.15)


class NatB(NB):
    """NB whose build() first flattens anything buried deeper than zmin
    (trunks, roots and rocks may sink at most 0.15 m)."""

    def build(self, name, *a, zmin=-0.15, **kw):
        self.clamp_z(zmin)
        return super().build(name, *a, **kw)


# ===========================================================================
# CONIFERS
# ===========================================================================
def pine(name, seed, H, R, n_t, z0, tips, pw=0.85, droop=0.5, trunk_r=0.3,
         top_n=6, snag=False, bend=0.0, lean_tiers=0.0, ncol=NEEDLE):
    b = NatB(seed)
    rng = b.rng

    def ax(z):
        t = max(0.0, (z - H * 0.45) / (H * 0.55))
        return bend * t * t

    top_trunk = H * (0.8 if not snag else 0.66)
    tz = [-0.14, 0.16, 0.55, 1.4, H * 0.35, H * 0.6, top_trunk]
    pts = [(ax(z), 0, z) for z in tz]
    rr = [1.3, 0.95, 0.78, 0.68, 0.5, 0.3, 0.07 if not snag else 0.25]
    tf = b.tube(pts, [trunk_r * k for k in rr], seg=10, color=BARK_PINE,
                lobes=(5, [0.85, 0.3]), rough=0.07, tip=True, var=0.08)
    b.light_from_above(tf, up=1.0, down=0.75, side=1.0)

    zt = H - (H - z0) * 0.26 if not snag else H * 0.66
    ks = [k / (n_t - 1) for k in range(n_t)]
    zs = [lerp(z0, zt, k ** 0.95) for k in ks]
    for k, zb in enumerate(zs):
        t = ks[k]
        last = (k == n_t - 1)
        Rk = lerp(R, R * 0.2, t ** pw) * (1 + rng.uniform(-0.07, 0.07))
        if last:
            Hk = (H - zb) if not snag else (zs[1] - zs[0]) * 1.8
            n = top_n
        else:
            Hk = (zs[k + 1] - zb) * lerp(2.25, 1.9, t)
            n = tips if k < n_t - 2 else max(6, tips - 2)
        c = (ax(zb) + rng.uniform(-0.07, 0.07), rng.uniform(-0.07, 0.07))
        shade_k = 0.84 + 0.2 * t + (0.05 if k % 2 else -0.04)
        colk = tuple(min(1, x * shade_k) for x in mix(ncol, NEEDLE_DK, rng.uniform(0, 0.5)))
        tilt = None
        if bend and zb > H * 0.5:
            tilt = (0, bend * 9 * (zb / H) ** 2)
        elif lean_tiers:
            tilt = (rng.uniform(-lean_tiers, lean_tiers), rng.uniform(-lean_tiers, lean_tiers))
        skip = tuple(rng.sample(range(n), 1)) if (not last and rng.random() < 0.5) else ()
        top, tipf, und = b.tier(c, zb + Hk, zb, Rk, n=n, droop=droop * lerp(1.0, 0.35, t),
                                rot=rng.uniform(0, 6.3), color=colk, tilt=tilt, skip=skip,
                                notch=0.66 + rng.uniform(-0.05, 0.05))
        b.paint(tipf, mix(colk, NEEDLE_TIP, 0.55), var=0.08)
        b.light_from_above(top + tipf, up=1.12, down=0.8, side=0.94)
        b.shade(und, lambda f: 0.5)
    if snag:
        # the old leader snapped: a bleached, jagged snag pokes above the crown
        zs0 = zs[-1] + (zs[1] - zs[0]) * 0.7
        sx = ax(zs0)
        b.tube([(sx, 0, zs0 - 0.8), (sx + 0.02, 0.0, zs0 + 0.6), (sx + 0.05, 0.02, H * 0.84)],
               [0.13, 0.1, 0.08], seg=5, color=DEAD_WOOD, cap_end=True, var=0.12)
        for (dx, dy, hh) in [(0.04, 0.03, 0.34), (-0.04, 0.02, 0.22), (0.0, -0.05, 0.15)]:
            b.tube([(sx + 0.05 + dx, dy, H * 0.84 - 0.05), (sx + 0.05 + dx * 1.6, dy * 1.6, H * 0.84 + hh)],
                   [0.04, 0.0], seg=3, tip=True, color=mix(DEAD_WOOD, 'bone', 0.25), var=0.1)
        # a side shoot turned upward to become the new leader
        bx, by = -0.6, 0.25
        zb = zs[-1] + (zs[1] - zs[0]) * 0.3
        b.tube([(sx, 0, zb - 0.9), (bx * 0.8, by * 0.8, zb + 0.1), (bx, by, zb + 0.9), (bx * 0.95, by, H * 0.93)],
               [0.08, 0.07, 0.05, 0.02], seg=5, color=BARK_PINE, tip=True)
        for j, (h0, h1, r) in enumerate([(zb - 0.1, zb + 1.1, 0.95), (zb + 0.55, zb + 1.7, 0.7),
                                         (zb + 1.2, H * 0.96, 0.42)]):
            top, tipf, und = b.tier((bx * lerp(0.85, 1.0, j / 2), by), h1, h0, r, n=7 if j < 2 else 5,
                                    droop=0.28, rot=rng.uniform(0, 6.3), color=ncol)
            b.paint(tipf, mix(ncol, NEEDLE_TIP, 0.55), var=0.08)
            b.light_from_above(top + tipf, up=1.12, down=0.8, side=0.94)
            b.shade(und, lambda f: 0.5)
    ob = b.build(name, ao=0.2)
    return finish(ob, col_r=0.35)


# ===========================================================================
# BIRCH
# ===========================================================================
def birch_trunk(b, base, H, lean, r0, ph, seg=7, top=0.62):
    """Pale trunk with dark horizontal marks.  Rings come in pairs so the
    narrow bands between them read as the classic birch dashes."""
    rng = b.rng
    zs = [-0.12, 0.35]
    z = 0.35
    while z < H * top - 0.4:
        z += rng.uniform(0.5, 0.8)
        zs.append(z)
        zs.append(z + rng.uniform(0.09, 0.13))
        z = zs[-1]
    zs += [H * 0.8, H * 0.95]
    pts = []
    for z in zs:
        t = max(0.0, z / H)
        x = base[0] + lean[0] * t * t + 0.06 * math.sin(t * 6 + ph)
        y = base[1] + lean[1] * t * t + 0.06 * math.cos(t * 5 + ph)
        pts.append((x, y, z))
    radii = [r0 * (1.3 if i == 0 else lerp(1.0, 0.22, (max(0, zz) / H) ** 0.9))
             for i, zz in enumerate(zs)]
    tf = b.tube(pts, radii, seg=seg, color='birch', rough=0.05, tip=True, var=0.05,
                lobes=(3, [0.35]))
    nb = len(zs) - 2  # quad bands
    for k in range(nb):
        z0, z1 = zs[k], zs[k + 1]
        band = [tf[k * seg + i] for i in range(seg)]
        if k == 0:
            # dark, fissured foot of the trunk
            for f in band:
                b.paint([f], mix('birch', BIRCH_MARK, rng.uniform(0.45, 0.75)), var=0.1)
            continue
        if (z1 - z0) < 0.2:
            # two dashes on roughly opposite sides of the trunk
            start = rng.randrange(seg)
            for s0, ln in ((start, rng.choice([2, 3])), (start + seg // 2 + 1, rng.choice([1, 2]))):
                b.paint([band[(s0 + i) % seg] for i in range(ln)], BIRCH_MARK, var=0.1)
        elif rng.random() < 0.3 and z0 < H * 0.6:
            b.paint([band[rng.randrange(seg)]], mix('birch', BIRCH_MARK, 0.5), var=0.1)
    b.light_from_above(tf, up=1.0, down=0.8, side=1.0)
    return pts, radii


def birch(name, seed, H, crown, lean=(0.25, 0.1), twin=False, n_br=4):
    b = NatB(seed)
    rng = b.rng
    if twin:
        stems = [(birch_trunk(b, (-0.1, 0.02), H, (-0.8, 0.25), 0.15, 0.5, seg=6, top=0.55), H, 2),
                 (birch_trunk(b, (0.1, -0.02), H * 0.84, (0.7, -0.35), 0.13, 2.0, seg=6, top=0.5),
                  H * 0.84, 2)]
    else:
        stems = [(birch_trunk(b, (0, 0), H, lean, 0.19, rng.uniform(0, 6)), H, n_br)]
    leaf = []
    k = 0
    for si, ((pts, radii), hs, nb) in enumerate(stems):
        top = Vector(pts[-1])

        def on_trunk(z):
            ip = min(range(len(pts) - 1), key=lambda i: abs(pts[i][2] - z))
            return Vector(pts[ip])
        # hanging side clumps on short up-swept branches
        for j in range(nb):
            t = lerp(0.52, 0.74, j / max(1, nb - 1))
            p0 = on_trunk(hs * t)
            yaw = k * 2.39996 + rng.uniform(-0.25, 0.25) + (math.pi * si if twin else 0.0)
            k += 1
            L = rng.uniform(0.75, 1.05) * crown
            out = Vector((math.cos(yaw), math.sin(yaw), 0))
            p2 = p0 + out * L + Vector((0, 0, L * 0.6))
            p1 = p0 + out * L * 0.55 + Vector((0, 0, L * 0.3))
            b.tube(bezier(p0, p1, p2, 3), [0.06, 0.045, 0.03, 0.015], seg=4,
                   color=mix('birch', 'wood_grey', 0.35), tip=True, var=0.08)
            r = rng.uniform(0.62, 0.72) * crown
            leaf += b.blob(r, loc=tuple(p2 + Vector((0, 0, -0.15))), scale=(1, 1, 1.15), sub=2,
                           noise=0.16, color=BIRCH_LEAF, var=0.08, droop=0.5)
        # central column: crown top + one mid clump hugging the trunk
        if si == 0:
            mid = on_trunk(hs * 0.82)
            off = Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))
            leaf += b.blob(crown * 0.78, loc=tuple(mid + off), scale=(1, 1, 1.1), sub=2, noise=0.15,
                           color=BIRCH_LEAF, var=0.08, droop=0.45)
        leaf += b.blob(crown * 0.66, loc=tuple(top + Vector((0, 0, -0.1))), scale=(0.9, 0.9, 1.3),
                       sub=2, noise=0.14, color=BIRCH_LEAF, var=0.08, droop=0.3)
    for f in leaf:
        if rng.random() < 0.2:
            b.paint([f], mix(BIRCH_LEAF, 'leaf_light', 0.6), var=0.06)
    b.light_from_above(leaf, up=1.15, down=0.62, side=0.92)
    ob = b.build(name, ao=0.18)
    return finish(ob, col_r=0.25)


# ===========================================================================
# OAK
# ===========================================================================
def oak(name='tree_oak', seed=31):
    b = NatB(seed)
    rng = b.rng
    tp = [(0, 0, -0.15), (0.05, 0.02, 0.55), (0.16, 0.05, 1.35), (0.24, 0.02, 2.1), (0.26, -0.02, 2.7)]
    tf = b.tube(tp, [0.8, 0.5, 0.44, 0.41, 0.37], seg=10, color=BARK_OAK, lobes=(5, [0.8, 0.28, 0.05]),
                rough=0.09, twist=16, cap_end=True, var=0.12)
    # moss creeping up the roots on the north (+Y) side
    b.tint_where(tf, lambda f: f.calc_center_median().z < 1.0 and f.normal.y > 0.15, MOSS, var=0.12)
    b.light_from_above(tf, up=1.0, down=0.8, side=1.05)
    top = Vector(tp[-1])
    limbs = []
    n_l = 5
    for j in range(n_l):
        yaw = j * (2 * math.pi / n_l) + rng.uniform(-0.25, 0.25)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        L = rng.uniform(1.9, 2.4)
        p0 = top + Vector((0, 0, -0.4)) + out * 0.1
        p1 = p0 + out * L * 0.55 + Vector((0, 0, L * 0.2 + rng.uniform(-0.15, 0.15)))
        p2 = p0 + out * L + Vector((0, 0, L * 0.55))
        b.tube(bezier(p0, p1, p2, 3), [0.3, 0.21, 0.15, 0.09], seg=5, color=BARK_OAK, rough=0.07,
               cap_end=True, var=0.12)
        limbs.append((p2, out))
    leaf = []
    leaf += b.blob(1.8, loc=(0.25, 0.0, 5.0), scale=(1.15, 1.1, 0.7), sub=2, noise=0.13,
                   color=OAK_LEAF, var=0.09)
    for j, (p2, out) in enumerate(limbs):
        r = rng.uniform(1.15, 1.35)
        c = p2 + out * 0.3 + Vector((0, 0, 0.3))
        leaf += b.blob(r, loc=tuple(c), scale=(1.08, 1.08, 0.74), sub=2, noise=0.15,
                       color=OAK_LEAF, var=0.09, flat_z=c.z - r * 0.5)
    for f in leaf:
        if rng.random() < 0.16:
            b.paint([f], mix(OAK_LEAF, 'leaf_light', 0.5), var=0.06)
    b.light_from_above(leaf, up=1.15, down=0.55, side=0.9)
    b.radial_ao(leaf, (0.25, 0), 1.0, 2.6, k_in=0.8)
    ob = b.build(name, ao=0.12)
    return finish(ob, col_r=0.6)


# ===========================================================================
# DEAD TREE
# ===========================================================================
def crooked(b, p0, d, L, r0, r1, seg, color, n=3, wig=0.3, up=0.0, tip=False):
    """One crooked branch segment chain; returns (faces, points, end_dir)."""
    rng = b.rng
    pts = [Vector(p0)]
    dd = Vector(d).normalized()
    q = Vector(p0)
    for i in range(n):
        dd = (dd + Vector((rng.uniform(-wig, wig), rng.uniform(-wig, wig), rng.uniform(-wig, wig) * 0.6 + up))).normalized()
        q = q + dd * (L / n)
        pts.append(q.copy())
    radii = [lerp(r0, r1, i / n) for i in range(n + 1)]
    if tip:
        radii[-1] = 0.0
    fs = b.tube(pts, radii, seg=seg, color=color, tip=tip, cap_end=not tip, rough=0.1, var=0.1)
    return fs, pts, dd


def dead_tree(name='tree_dead', seed=41):
    b = NatB(seed)
    rng = b.rng
    tp = [(0, 0, -0.14), (0.04, 0, 0.5), (0.2, 0.06, 1.35), (0.3, 0.12, 2.15), (0.18, 0.2, 2.9)]
    tf = b.tube(tp, [0.58, 0.36, 0.29, 0.25, 0.21], seg=8, color=DEAD_WOOD, lobes=(4, [1.0, 0.25]),
                rough=0.12, twist=30, cap_end=True, var=0.1)
    fs = list(tf)
    top = Vector(tp[-1])
    specs = [  # start, direction, length, radius, up-bias
        (top, (0.8, -0.25, 0.95), 1.9, 0.18, 0.05),
        (top + Vector((0, 0, -0.2)), (-0.9, 0.25, 0.7), 1.8, 0.17, 0.08),
        (top + Vector((0, 0, -0.05)), (0.05, 0.9, 1.1), 1.5, 0.15, 0.1),
        (Vector((0.29, 0.1, 2.0)), (-0.25, -1.0, 0.18), 1.7, 0.13, -0.06),   # low reaching claw
    ]
    for (p0, d, L, r, up) in specs:
        f, pts, dd = crooked(b, p0, d, L, r, r * 0.55, 6, DEAD_WOOD, n=3, wig=0.28, up=up)
        fs += f
        for t, (dy, lz) in enumerate([(0.7, 0.45), (-0.7, 0.2)]):
            yaw = math.atan2(dd.y, dd.x) + dy * rng.uniform(0.7, 1.1)
            d2 = Vector((math.cos(yaw), math.sin(yaw), lz + rng.uniform(0.0, 0.5)))
            base_pt = pts[-1] if t == 0 else pts[2]
            f2, pts2, dd2 = crooked(b, base_pt, d2, L * rng.uniform(0.5, 0.65), r * 0.5, r * 0.25, 4, DEAD_WOOD,
                                    n=2, wig=0.3, up=0.05)
            fs += f2
            f3, _, _ = crooked(b, pts2[-1], dd2 + Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 0.3)),
                               L * 0.3, r * 0.25, 0.0, 3, DEAD_WOOD, n=2, wig=0.35, tip=True)
            fs += f3
    # a thick branch snapped off long ago: short stub with a pale broken end
    stub = b.tube([(0.18, 0.02, 1.3), (0.55, -0.22, 1.5), (0.72, -0.3, 1.52)], [0.13, 0.1, 0.09], seg=6,
                  color=DEAD_DARK, cap_end=True, rough=0.08)
    b.paint(stub[-1:], mix(DEAD_WOOD, 'bone', 0.35), var=0.05)
    fs += stub
    for f in fs:
        z = f.calc_center_median().z
        if z < 0.9 and rng.random() < 0.7:
            b.paint([f], DEAD_DARK, var=0.1)
        elif rng.random() < 0.12:
            b.paint([f], LICHEN, var=0.1)
    hole = [f for f in tf if 0.9 < f.calc_center_median().z < 1.5 and f.normal.y < -0.55]
    b.paint(hole[:1], hexc('#2d2723'), var=0.02)
    b.light_from_above(fs, up=1.08, down=0.8, side=1.0)
    ob = b.build(name, ao=0.2)
    return finish(ob, col_r=0.35)


# ===========================================================================
# STUMP & LOG
# ===========================================================================
def stump(name='stump', seed=51):
    b = NatB(seed)
    rng = b.rng
    zt = 0.44
    prof = [(0.5, -0.12), (0.42, 0.05), (0.35, 0.2), (0.32, 0.36), (0.31, zt),
            (0.265, zt + 0.012), (0.19, zt + 0.02), (0.11, zt + 0.024), (0.0, zt + 0.028)]
    seg = 10
    noise = {}

    def rf(k, a):
        m = 1.0
        if k == 0:
            m += 0.55 * max(0.0, math.cos(4 * a)) ** 2
        elif k == 1:
            m += 0.22 * max(0.0, math.cos(4 * a)) ** 2
        key = (k, round(a, 4))
        if key not in noise:
            noise[key] = rng.uniform(-0.05, 0.05)
        m *= 1.0 + (noise[key] if k < 5 else noise[key] * 0.3)
        # slanted axe cut
        dz = 0.04 * math.cos(a) if k >= 4 else 0.0
        return m, dz
    fs = b.lathe2(prof, seg=seg, color=BARK_OAK, ring_fn=rf, cap_bottom=False, cap_top=False, var=0.1)
    bands = [fs[k * seg:(k + 1) * seg] for k in range(len(prof) - 1)]
    b.paint(bands[4], mix(CUT_WOOD, 'bark', 0.6), var=0.08)      # bark rim top
    b.paint(bands[5], CUT_WOOD, var=0.05)
    b.paint(bands[6], CUT_RING, var=0.05)
    b.paint(bands[7], CUT_WOOD, var=0.05)
    side = [f for k in range(4) for f in bands[k]]
    b.tint_where(side, lambda f: f.normal.y > 0.3 and rng.random() < 0.7, MOSS, var=0.12)
    b.light_from_above(side, up=1.0, down=0.8, side=1.0)
    # the hinge splinters left when the tree fell
    for (x, y, h) in [(-0.2, 0.05, 0.16), (-0.24, -0.08, 0.1), (-0.15, 0.16, 0.08)]:
        b.tube([(x, y, zt - 0.05), (x - 0.02, y, zt + h)], [0.035, 0.0], seg=3, tip=True,
               color=CUT_WOOD, var=0.08)
    ob = b.build(name, ao=0.25)
    return finish(ob, col_r=0.35)


def log_fallen(name='log_fallen', seed=61):
    b = NatB(seed)
    rng = b.rng
    zc = 0.27
    prof = [(0.0, -1.62), (0.2, -1.7), (0.3, -1.74), (0.33, -1.3), (0.34, -0.6), (0.32, 0.2),
            (0.31, 1.0), (0.29, 1.58), (0.285, 1.7), (0.21, 1.712), (0.12, 1.72), (0.0, 1.726)]
    seg = 9
    noise = {}

    def rf(k, a):
        key = (k, round(a, 4))
        if key not in noise:
            noise[key] = (rng.uniform(-0.06, 0.06), rng.uniform(-0.09, 0.09))
        n, dz = noise[key]
        if k == 1 or k == 2:        # jagged broken end
            return 1.0 + n * 2, dz * (2.2 if k == 2 else 1.2)
        if 3 <= k <= 7:
            return 1.0 + n * 1.6, 0.0
        return 1.0 + n * 0.2, 0.0
    fs = b.lathe2(prof, seg=seg, loc=(0, 0, zc), rot=(0, 90, 0), color=BARK_OAK, ring_fn=rf,
                  cap_bottom=False, cap_top=False, var=0.1)
    bands = [fs[k * seg:(k + 1) * seg] for k in range(len(prof) - 1)]
    b.paint(bands[0] + bands[1], mix('wood', 'bark_dark', 0.4), var=0.12)   # rotten hollow end
    b.paint(bands[8], CUT_WOOD, var=0.05)
    b.paint(bands[9], CUT_RING, var=0.05)
    b.paint(bands[10], CUT_WOOD, var=0.05)
    body = [f for k in range(2, 8) for f in bands[k]]
    # longitudinal bark furrows: every other face around the log a shade darker
    for k in range(2, 8):
        for i, f in enumerate(bands[k]):
            if i % 2 == 0:
                b.shade([f], lambda f_: 0.78)
    b.light_from_above(body, up=1.05, down=0.7, side=1.0)
    # patchy moss: thick drifts along the log, spilling down one side
    patch = lambda f: (math.sin(f.calc_center_median().x * 1.7 + 1.9) > -0.55)
    b.moss_top(body, thresh=0.3, color=MOSS, chance=0.85, noise_fn=patch)
    b.moss_top(body, thresh=-0.2, color=mix(MOSS, 'bark', 0.4), chance=0.35,
               noise_fn=lambda f: f.normal.y > 0.3 and patch(f))
    b.moss_top(body, thresh=0.85, color=MOSS_LT, chance=0.6, noise_fn=patch)
    # low moss cushions on top
    for (x, s_) in [(-0.95, 1.0), (0.45, 0.8)]:
        cush = b.blob(0.2 * s_, loc=(x, 0.02, zc + 0.28), scale=(1.3, 0.9, 0.35), uv=(5, 3), noise=0.15,
                      color=MOSS, mat='base', var=0.1)
        b.light_from_above(cush, up=1.12, down=0.8, side=1.0)
    # snapped branch stub
    b.tube([(0.35, 0.05, zc + 0.2), (0.5, 0.12, zc + 0.62), (0.58, 0.14, zc + 0.78)], [0.08, 0.06, 0.05],
           seg=5, color=BARK_OAK, cap_end=True, var=0.1)
    # shelf fungi on the front side
    for (x, z, s) in [(-0.62, 0.36, 1.0), (-0.4, 0.24, 0.8), (0.85, 0.32, 0.9)]:
        b.blob(0.14 * s, loc=(x, -0.31, z), scale=(1.15, 0.8, 0.3), uv=(6, 3), noise=0.08,
               color=mix('mush_yellow', 'mush_stem', 0.5), mat='base', var=0.06)
    # a few grass blades sprouting from the moss
    for i in range(4):
        b.blade((rng.uniform(-1.0, 0.8), rng.uniform(-0.08, 0.08), zc + 0.28), rng.uniform(0, 360),
                rng.uniform(0.18, 0.28), 0.04, tilt=20, bend=0.5, segs=2, color='grass')
    # gentle bow along the length
    for v in b.bm.verts:
        v.co.y += 0.07 * math.sin(v.co.x * 0.85)
        v.co.z += 0.03 * math.cos(v.co.x * 1.1) - 0.03
    ob = b.build(name, ao=0.3)
    return finish(ob, col_box=[3.5, 0.7])


# ===========================================================================
# BUSHES
# ===========================================================================
def fringe(b, clumps, n, color, L=(0.14, 0.2), w=0.09, zmin=0.1, up=0.35):
    """Scatter leaf cards pointing out of clump surfaces (breaks the smooth
    blob silhouette so it reads as foliage, not stone)."""
    rng = b.rng
    fs = []
    tries = 0
    while n > 0 and tries < 400:
        tries += 1
        (x, y, z), r, sc = clumps[rng.randrange(len(clumps))]
        a = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(-0.25, 1.1)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        p = Vector((x + d.x * r * sc[0] * 0.82, y + d.y * r * sc[1] * 0.82, z + d.z * r * sc[2] * 0.82))
        if p.z < zmin:
            continue
        dd = (d + Vector((0, 0, up))).normalized()
        fs += b.card(p, dd, rng.uniform(*L), w * rng.uniform(0.8, 1.2), color=color)
        n -= 1
    return fs


def clumps_of(b, specs, color, uv=(6, 5), sub=None, noise=0.14, flat=0.08, droop=0.0):
    fs = []
    for (c, r, sc) in specs:
        fs += b.blob(r, loc=c, scale=sc, uv=None if sub else uv, sub=sub or 1, noise=noise, color=color,
                     flat_z=flat, droop=droop)
    return fs


BUSH_SEED = 71
BUSH_LEAF = mix('leaf', 'leaf_dark', 0.35)


def bush_foliage(b):
    """Foliage shared by bush_a and bush_raspberry: the game swaps a picked
    (or out-of-season) berry bush for a bush_a instance at the same spot, so
    both are built from the same seed and the swap only removes the fruit."""
    rng = b.rng
    c = BUSH_LEAF
    specs = [((0.02, 0.03, 0.56), 0.42, (1.05, 1.0, 0.9)), ((0.3, -0.14, 0.33), 0.31, (1, 1, 0.92)),
             ((-0.27, -0.17, 0.3), 0.29, (1, 1, 0.9))]
    leaf = b.blob(specs[0][1], loc=specs[0][0], scale=specs[0][2], sub=2, noise=0.17, color=c, flat_z=0.1)
    for (cc, r, sc) in specs[1:]:
        leaf += b.blob(r, loc=cc, scale=sc, uv=(6, 4), noise=0.22, color=c, flat_z=0.02, droop=0.2,
                       rot=(0, 0, rng.uniform(0, 60)))
    for f in leaf:
        if rng.random() < 0.2:
            b.paint([f], mix(c, 'leaf_light', 0.45), var=0.06)
    b.light_from_above(leaf, up=1.15, down=0.55, side=0.92)
    cards = fringe(b, specs, 8, mix(c, 'leaf_light', 0.3), zmin=0.25)
    b.light_from_above(cards, up=1.12, down=0.7, side=0.95)
    return specs


def bush_a(name='bush_a'):
    b = NatB(BUSH_SEED)
    bush_foliage(b)
    return b.build(name, ao=0.3)


def raspberry(name='bush_raspberry'):
    b = NatB(BUSH_SEED)
    specs = bush_foliage(b)
    rng = b.rng
    berry = hexc('#b5283c')
    for i, (si, a, el) in enumerate([(0, 0.3, 0.35), (0, 2.4, 0.1), (0, 4.3, 0.45), (1, 5.6, 0.25)]):
        (cc, r, sc) = specs[si]
        a += rng.uniform(-0.2, 0.2)
        p = Vector((cc[0] + math.cos(a) * math.cos(el) * r * sc[0] * 1.03,
                    cc[1] + math.sin(a) * math.cos(el) * r * sc[1] * 1.03,
                    cc[2] + math.sin(el) * r * sc[2] * 0.95))
        b.blob(0.062, loc=tuple(p), scale=(1, 1, 1.12), sub=1, noise=0.05, color=berry, mat='base', var=0.1)
    return b.build(name, ao=0.3)


def blueberry(name='bush_blueberry', seed=77):
    b = NatB(seed)
    rng = b.rng
    c = mix('leaf_dark', 'teal', 0.2)
    specs = [((0.0, 0.0, 0.42), 0.34, (1.25, 1.15, 1.0)), ((0.28, 0.16, 0.27), 0.25, (1.1, 1.1, 0.95)),
             ((-0.26, -0.15, 0.25), 0.24, (1.1, 1.1, 0.95))]
    leaf = clumps_of(b, specs, c, uv=(6, 4), noise=0.22, flat=0.08, droop=0.15)
    for f in leaf:
        if rng.random() < 0.15:
            b.paint([f], mix(c, 'leaf', 0.5), var=0.06)
    b.light_from_above(leaf, up=1.15, down=0.55, side=0.92)
    cards = fringe(b, specs, 6, mix(c, 'leaf', 0.35), L=(0.1, 0.14), w=0.07, zmin=0.15, up=0.6)
    b.light_from_above(cards, up=1.12, down=0.7, side=0.95)
    berry = mix(mix('berry_blue', 'flax', 0.35), 'frost', 0.15)
    for i in range(6):
        (cc, r, sc) = specs[i % 3]
        a = i * 2.39996 + rng.uniform(-0.3, 0.3)
        el = rng.uniform(0.2, 0.9)
        p = Vector((cc[0] + math.cos(a) * math.cos(el) * r * sc[0],
                    cc[1] + math.sin(a) * math.cos(el) * r * sc[1],
                    cc[2] + math.sin(el) * r * sc[2]))
        b.blob(0.048, loc=tuple(p), sub=1, noise=0.05, color=berry, mat='base', var=0.12)
    return b.build(name, ao=0.25)


# ===========================================================================
# SMALL PLANTS
# ===========================================================================
def fern(name='fern', seed=81):
    b = NatB(seed)
    rng = b.rng
    fs = []
    n = 9
    for i in range(n):
        yaw = i * 360 / n + rng.uniform(-14, 14)
        inner = i % 3 == 0
        L = rng.uniform(0.66, 0.76) if inner else rng.uniform(0.78, 0.92)
        fs += b.frond((0.03 * math.cos(math.radians(yaw)), 0.03 * math.sin(math.radians(yaw)), 0.0),
                      yaw, L, rng.uniform(0.22, 0.27), rise=rng.uniform(80, 86) if inner else rng.uniform(64, 74),
                      arch=rng.uniform(0.5, 0.7), segs=4,
                      color=mix('leaf', 'pine_light', rng.uniform(0.2, 0.6)))
    b.light_from_above(fs, up=1.12, down=0.75, side=0.95)
    return b.build(name, ao=0.35)


def reeds(name='reeds', seed=91):
    b = NatB(seed)
    rng = b.rng
    fs = []
    for i in range(15):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.0, 0.22)
        yaw = math.degrees(a) + rng.uniform(-40, 40)
        fs += b.blade((r * math.cos(a), r * math.sin(a), 0.0), yaw, rng.uniform(0.75, 1.3),
                      rng.uniform(0.045, 0.06), tilt=rng.uniform(4, 16), bend=rng.uniform(0.1, 0.55),
                      segs=4, color=mix('grass', 'straw', rng.uniform(0.0, 0.4)))
    head = mix('leather', 'bark', 0.4)
    for (x, y, h) in [(0.05, 0.02, 1.3), (-0.1, 0.08, 1.15), (0.12, -0.1, 1.05), (-0.03, -0.12, 1.22)]:
        tx, ty = x * 1.6, y * 1.6
        stem = [(x, y, 0.0), (lerp(x, tx, 0.5), lerp(y, ty, 0.5), h * 0.5), (tx, ty, h)]
        fs += b.tube(stem, [0.014, 0.011, 0.009], seg=3, color=mix('grass', 'straw', 0.3), cap_end=False,
                     mat='leaves')
        hz = h - 0.24
        hx, hy = lerp(x, tx, hz / h), lerp(y, ty, hz / h)
        b.cyl(r1=0.034, r2=0.032, h=0.2, seg=6, loc=(hx, hy, hz), color=head, mat='leaves', var=0.08)
        b.tube([(tx, ty, h - 0.04), (tx, ty, h + 0.08)], [0.008, 0.0], seg=3, tip=True,
               color=head, mat='leaves')
    b.light_from_above(fs, up=1.1, down=0.8, side=0.95)
    return b.build(name, ao=0.3)


def thistle(name='thistle', seed=101):
    b = NatB(seed)
    rng = b.rng
    green = mix('leaf_dark', 'slate', 0.2)
    bloom = hexc('#8d4fa3')
    fs = []
    for i in range(4):
        yaw = i * 90 + rng.uniform(-15, 15)
        f, _ = b.leaf((0, 0, 0.02), yaw, rng.uniform(10, 22), 0.3, 0.11, color=green, fold=0.45,
                      curl=0.05, shape=(0.55, 1.0, 0.55))
        fs += f
    for (tx, ty, h, head) in [(0.0, 0.0, 0.5, 1.3), (0.14, 0.06, 0.39, 1.05), (-0.11, -0.08, 0.32, 0.6)]:
        b.tube([(0, 0, 0.0), (tx * 0.5, ty * 0.5, h * 0.5), (tx, ty, h)], [0.016, 0.013, 0.011], seg=3,
               color=green, cap_end=False)
        if head > 0.9:
            f, _ = b.leaf((tx * 0.45, ty * 0.45, h * 0.45), rng.uniform(0, 360), 35, 0.13, 0.05, color=green,
                          fold=0.5, shape=(0.6, 1.0, 0.5))
            fs += f
        s_ = head
        # spiny bract bulb: alternate ring verts pushed out into spikes
        b.lathe2([(0.0, h - 0.01), (0.05 * s_, h + 0.03 * s_), (0.034 * s_, h + 0.07 * s_)], seg=6,
                 loc=(tx, ty, 0), color=mix(green, 'straw', 0.3), cap_bottom=False, cap_top=False, var=0.08,
                 ring_fn=lambda k, a: (1.35 if (k == 1 and round(a * 3 / math.pi) % 2) else 1.0, 0.0))
        if head < 0.6:
            continue   # a closed bud
        # purple brush: flares upward, ragged top
        b.lathe2([(0.032 * s_, h + 0.065 * s_), (0.058 * s_, h + 0.13 * s_), (0.0, h + 0.12 * s_)], seg=6,
                 loc=(tx, ty, 0), color=bloom, cap_bottom=False, cap_top=False, var=0.1,
                 ring_fn=lambda k, a: (1.0, 0.025 if (k == 1 and round(a * 3 / math.pi) % 2) else 0.0))
        b.blob(0.012 * s_, loc=(tx, ty, h + 0.128 * s_), uv=(4, 2), noise=0.0, color='glow_purple',
               mat='emit', var=0.0)
    b.light_from_above(fs, up=1.1, down=0.8, side=0.95)
    return b.build(name, ao=0.3)


def dandelion(name='dandelion', seed=111):
    b = NatB(seed)
    rng = b.rng
    fs = []
    for i in range(7):
        yaw = i * (360 / 7) + rng.uniform(-10, 10)
        f, _ = b.leaf((0, 0, 0.015), yaw, rng.uniform(5, 14), rng.uniform(0.17, 0.22), 0.075,
                      color=mix('leaf', 'leaf_light', 0.3), fold=0.3, curl=0.02, shape=(0.55, 0.9, 0.8))
        fs += f
    b.light_from_above(fs, up=1.1, down=0.8, side=0.95)
    yel = mix('gold', 'mush_yellow', 0.3)
    for (tx, ty, h, kind) in [(0.03, 0.02, 0.24, 'flower'), (-0.08, 0.04, 0.19, 'flower'),
                              (0.06, -0.08, 0.3, 'puff')]:
        b.tube([(0, 0, 0.01), (tx * 0.6, ty * 0.6, h * 0.55), (tx, ty, h)], [0.008, 0.007, 0.006], seg=3,
               color=mix('leaf_light', 'straw', 0.3), cap_end=False)
        if kind == 'flower':
            b.star((tx, ty, h), 0.058, n=9, inner=0.72, h=0.02, color=yel, mid=mix('ochre', 'gold', 0.5),
                   mid_r=0.35, tilt=(rng.uniform(-10, 10), rng.uniform(-10, 10)), cup=0.016)
        else:
            b.blob(0.045, loc=(tx, ty, h + 0.035), sub=2, noise=0.1, color=mix('white', 'linen', 0.3),
                   mat='base', var=0.05)
    return b.build(name, ao=0.3)


def mushroom(b, x, y, h, r, cap_col, stem_col, spots=0, gills=None, shape='dome', lean=(0, 0)):
    rng = b.rng
    tx, ty = x + lean[0], y + lean[1]
    b.lathe2([(r * 0.3, 0.0), (r * 0.32, h * 0.3), (r * 0.24, h * 0.75), (r * 0.22, h)], seg=6,
             loc=(0, 0, 0), color=stem_col, cap_bottom=False, cap_top=False, var=0.05,
             ring_fn=lambda k, a: (1.0, 0.0))
    # shift the stem verts later is overkill; stems are short - simple lean via cap offset
    if shape == 'dome':
        prof = [(r * 0.25, h - 0.01), (r * 1.0, h + 0.005), (r * 0.95, h + r * 0.35),
                (r * 0.62, h + r * 0.7), (0.0, h + r * 0.85)]
    elif shape == 'bell':
        prof = [(r * 0.2, h - r * 0.2), (r * 0.9, h - r * 0.45), (r * 0.85, h),
                (r * 0.55, h + r * 0.55), (0.0, h + r * 0.8)]
    else:  # funnel (chanterelle)
        prof = [(r * 0.25, h - r * 0.4), (r * 1.0, h + r * 0.05), (r * 0.9, h + r * 0.2),
                (r * 0.45, h + r * 0.12), (0.0, h + r * 0.02)]
    cap = b.lathe2(prof, seg=9, loc=(tx - x + x, ty - y + y, 0), color=cap_col, cap_bottom=False,
                   cap_top=False, var=0.06, smooth=(shape == 'dome'),
                   ring_fn=(lambda k, a: (1.0 + (0.08 * math.sin(5 * a) if k in (1, 2) else 0.0), 0.0))
                   if shape == 'funnel' else None)
    under = cap[:9]
    if gills:
        b.paint(under, gills[0], var=0.03, mat=gills[1])
    else:
        b.paint(under, mix(stem_col, cap_col, 0.2), var=0.05)
    if spots:
        for i in range(spots):
            a = i * 2.4 + rng.uniform(-0.3, 0.3)
            rr = r * rng.uniform(0.25, 0.75)
            zz = h + r * 0.85 * (1 - (rr / r) ** 2) ** 0.5 * 0.95 + 0.006
            b.star((tx + rr * math.cos(a), ty + rr * math.sin(a), zz), r * rng.uniform(0.13, 0.2), n=3,
                   inner=0.85, h=0.004, color='mush_stem', tilt=(math.degrees(-math.sin(a) * rr / r * 0.8),
                                                                  math.degrees(math.cos(a) * rr / r * 0.8)))
    return cap


def mushroom_red(name='mushroom_red', seed=121):
    b = NatB(seed)
    mushroom(b, 0.0, 0.0, 0.17, 0.13, 'mushroom', 'mush_stem', spots=7)
    b2 = b
    # small companion
    b2.lathe2([(0.018, 0.0), (0.02, 0.05), (0.015, 0.08)], seg=5, loc=(0.13, -0.06, 0), color='mush_stem',
              cap_bottom=False, cap_top=False)
    b2.lathe2([(0.01, 0.075), (0.055, 0.085), (0.05, 0.11), (0.0, 0.125)], seg=7, loc=(0.13, -0.06, 0),
              color=mix('mushroom', 'red', 0.3), cap_bottom=False, cap_top=False, smooth=True)
    return b.build(name, ao=0.2)


def mushroom_yellow(name='mushroom_yellow', seed=131):
    b = NatB(seed)
    for (x, y, h, r) in [(0.0, 0.0, 0.16, 0.08), (0.1, 0.06, 0.12, 0.065), (-0.07, 0.08, 0.1, 0.055)]:
        b.lathe2([(r * 0.35, 0.0), (r * 0.4, h * 0.5), (r * 0.55, h * 0.9)], seg=5, loc=(x, y, 0),
                 color=mix('mush_yellow', 'mush_stem', 0.3), cap_bottom=False, cap_top=False)
        prof = [(r * 0.5, h * 0.88), (r * 1.0, h + r * 0.05), (r * 0.92, h + r * 0.28),
                (r * 0.45, h + r * 0.18), (0.0, h + r * 0.1)]
        seed_off = b.rng.uniform(0, 6)
        b.lathe2(prof, seg=8, loc=(x, y, 0), color='mush_yellow', cap_bottom=False, cap_top=False,
                 var=0.07, ring_fn=lambda k, a, s=seed_off: (1.0 + (0.1 * math.sin(5 * a + s) if k in (1, 2) else 0.0),
                                                               0.02 * math.sin(4 * a + s) if k in (1, 2) else 0.0))
    return b.build(name, ao=0.2)


def mushroom_glow(name='mushroom_glow', seed=141):
    b = NatB(seed)
    rng = b.rng
    pale = mix('mush_stem', 'frost', 0.35)
    for (x, y, h, r) in [(0.0, 0.0, 0.21, 0.075), (0.1, -0.05, 0.15, 0.058), (-0.075, 0.065, 0.11, 0.05)]:
        b.lathe2([(r * 0.28, 0.0), (r * 0.24, h * 0.5), (r * 0.18, h)], seg=5, loc=(x, y, 0), color=pale,
                 cap_bottom=False, cap_top=False)
        prof = [(r * 0.2, h - r * 0.15), (r * 0.95, h - r * 0.3), (r * 0.9, h + r * 0.05),
                (r * 0.55, h + r * 0.55), (0.0, h + r * 0.85)]
        cap = b.lathe2(prof, seg=7, loc=(x, y, 0), color=mix(pale, 'white', 0.3), cap_bottom=False,
                       cap_top=False, smooth=True)
        b.paint(cap[:7], 'glow_blue', var=0.0, mat='emit')          # gills
        b.paint(cap[7:14], mix('glow_blue', 'white', 0.5), var=0.0, mat='emit')   # glowing rim
        # a faint glowing freckle on the cap so it reads from above
        for i in range(1):
            a = rng.uniform(0, 6.28)
            rr = r * 0.55
            zz = h + r * 0.62
            b.star((x + rr * math.cos(a), y + rr * math.sin(a), zz), r * 0.16, n=3, inner=0.8, h=0.004,
                   color=mix('glow_blue', 'white', 0.3), mat='emit', var=0.0,
                   tilt=(-math.sin(a) * 40, math.cos(a) * 40))
    for (x, y) in [(0.06, 0.09), (-0.11, -0.04)]:
        b.blob(0.007, loc=(x, y, 0.012), uv=(4, 2), noise=0.0, color='glow_blue', mat='emit', var=0.0)
    return b.build(name, ao=0.2)


def flower_patch(name, seed, kind):
    b = NatB(seed)
    rng = b.rng
    fs = []
    for i in range(7):
        a = rng.uniform(0, 6.28)
        r = rng.uniform(0.02, 0.14)
        fs += b.blade((r * math.cos(a), r * math.sin(a), 0), math.degrees(a), rng.uniform(0.1, 0.18), 0.025,
                      tilt=20, bend=0.5, segs=2, color='grass')
    b.light_from_above(fs, up=1.1, down=0.8, side=0.95)
    stem_c = mix('leaf', 'leaf_light', 0.4)
    if kind == 'a':
        for i in range(10):
            a = i * 2.4 + rng.uniform(-0.3, 0.3)
            r = 0.03 + 0.12 * math.sqrt((i + 0.5) / 10)
            x, y = r * math.cos(a), r * math.sin(a)
            h = rng.uniform(0.12, 0.24)
            b.blade((x * 0.7, y * 0.7, 0), 0, h, 0.012, tilt=0, bend=0.0, segs=1, color=stem_c)
            tilt = (rng.uniform(-15, 15), rng.uniform(-15, 15))
            if i % 3 == 2:   # buttercup
                b.star((x, y, h), 0.032, n=5, inner=0.75, h=0.012, color=mix('gold', 'mush_yellow', 0.4),
                       tilt=tilt, cup=0.014)
            else:            # white wood-anemone / daisy with a yellow eye
                b.star((x, y, h), 0.04, n=6, inner=0.55, h=0.01, color='white', mid=mix('gold', 'ochre', 0.3),
                       mid_r=0.3, tilt=tilt, cup=0.008)
    else:
        spike_c = mix('purple', 'glow_purple', 0.35)
        for i, (x, y, h) in enumerate([(0.02, 0.03, 0.26), (-0.08, -0.05, 0.21), (0.08, -0.06, 0.18)]):
            b.blade((x, y, 0), 0, h - 0.08, 0.014, tilt=0, bend=0.0, segs=1, color=stem_c)
            z0 = h - 0.12
            b.lathe2([(0.018, z0), (0.03, z0 + 0.025), (0.02, z0 + 0.05), (0.026, z0 + 0.075),
                      (0.014, z0 + 0.1), (0.0, z0 + 0.13)], seg=4, loc=(x, y, 0), color=spike_c,
                     cap_bottom=False, cap_top=False, var=0.1, phase=rng.uniform(0, 1))
        blue = mix('flax', 'blue', 0.2)
        for i in range(5):
            a = i * 2.4 + 1.0
            r = 0.08 + 0.08 * ((i * 0.37) % 1)
            x, y = r * math.cos(a), r * math.sin(a)
            h = rng.uniform(0.1, 0.17)
            b.blade((x * 0.7, y * 0.7, 0), 0, h, 0.012, tilt=0, bend=0.0, segs=1, color=stem_c)
            b.star((x, y, h), 0.036, n=5, inner=0.5, h=0.01, color=blue, mid='white', mid_r=0.25,
                   tilt=(rng.uniform(-20, 20), rng.uniform(-20, 20)), cup=0.014)
    return b.build(name, ao=0.25)


# ===========================================================================
# ROCKS, ORES, CLIFFS
# ===========================================================================
def rock(name, seed, size, col_r, n=13, bevel=0.03, extra=(), moss=0.55, color=ROCK, tilt=(0, 0),
         jag=(0.72, 1.1)):
    b = NatB(seed)
    fs = b.hull_rock(size=size, n=n, sink=0.12, rot=b.rng.uniform(0, 6.28), color=color, var=0.1,
                     bevel=bevel, tilt=tilt, jag=jag)
    for (sz, off, nn) in extra:
        fs += b.hull_rock(size=sz, loc=off, n=nn, sink=0.08, rot=b.rng.uniform(0, 6.28), color=color,
                          var=0.1, bevel=bevel * 0.6, jag=jag)
    b.light_from_above(fs, up=1.1, down=0.72, side=0.97)
    b.moss_top(fs, thresh=moss, color=MOSS, chance=0.85)
    b.moss_top(fs, thresh=0.9, color=MOSS_LT, chance=0.5)
    ob = b.build(name, ao=0.3)
    return finish(ob, col_r=col_r)


def surface_pt(size, sink, d, k=0.86):
    """Approximate point on a hull rock's surface in direction d."""
    return Vector((d.x * size[0] * 0.5 * k, d.y * size[1] * 0.5 * k,
                   size[2] * 0.5 - sink + d.z * size[2] * 0.5 * k))


def vein_paint(b, faces, planes, width, color, stain=None, max_area=0.02):
    """Mineral veins: small faces (bevel strips / crevices) near the vein
    planes get the vein colour, so the veins read as thin lines tracing the
    rock's edges; big facets on the plane only get a faint stain."""
    sel = []
    stained = []
    pl = [(Vector(p0), Vector(n).normalized()) for (p0, n) in planes]
    for f in faces:
        c = f.calc_center_median()
        d = min(abs((c - p0).dot(n)) for (p0, n) in pl)
        if d < width * 1.5 and f.calc_area() < max_area:
            sel.append(f)
        elif d < width and stain is not None:
            stained.append(f)
    b.paint(sel, color, var=0.12)
    if stain is not None:
        b.paint(stained, stain, var=0.08)
    return sel


def crystal(b, base, d, L, r, color, mat='base', seg=5):
    """Pointed prism poking out of a rock along direction d."""
    d = d.normalized()
    p0 = base - d * (L * 0.3)
    p1 = base + d * (L * 0.55)
    p2 = base + d * L
    return b.tube([p0, p1, p2], [r, r * 0.95, 0.0], seg=seg, tip=True, color=color, mat=mat, var=0.1)


def ore(name, seed, size, rock_c, vein_c, gems, col_r, stain=None):
    """gems: list of (colour, mat, count, length, radius)."""
    b = NatB(seed)
    rng = b.rng
    sink = 0.12
    fs = b.hull_rock(size=size, n=14, sink=sink, rot=0.0, color=rock_c, var=0.1, bevel=0.03, jag=(0.75, 1.08))
    b.light_from_above(fs, up=1.1, down=0.72, side=0.97)
    planes = [((0, 0, size[2] * 0.5), (0.35, 0.25, 1.0)), ((0.05, 0, size[2] * 0.3), (-0.9, 0.45, 0.25))]
    vein_paint(b, fs, planes, 0.05, vein_c, stain=stain)
    b.moss_top(fs, thresh=0.88, color=MOSS, chance=0.35)
    k = 0
    for (gc, gm, count, L, r) in gems:
        for i in range(count):
            a = (k * 2.39996) + rng.uniform(-0.25, 0.25)
            el = rng.uniform(0.05, 0.95)
            k += 1
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
            p = surface_pt(size, sink, d, 0.74)
            dd = (d + Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0.2))).normalized()
            crystal(b, p, dd, L * rng.uniform(0.8, 1.2), r * rng.uniform(0.85, 1.15), gc, gm,
                    seg=rng.choice([4, 5]))
    ob = b.build(name, ao=0.3)
    return finish(ob, col_r=col_r)


def rock_big(name='rock_big', seed=171):
    b = NatB(seed)
    fs = b.hull_rock(size=(3.0, 2.6, 2.0), n=16, sink=0.15, rot=0.4, color=ROCK, var=0.1, bevel=0.06,
                     jag=(0.74, 1.1))
    fs += b.hull_rock(size=(1.5, 1.3, 1.0), loc=(1.15, -0.95, 0), n=10, sink=0.12, rot=1.3, color=ROCK,
                      var=0.1, bevel=0.05, jag=(0.75, 1.1))
    b.light_from_above(fs, up=1.1, down=0.72, side=0.97)
    b.moss_top(fs, thresh=0.5, color=MOSS, chance=0.9)
    b.moss_top(fs, thresh=0.85, color=MOSS_LT, chance=0.6)
    ob = b.build(name, ao=0.35)
    return finish(ob, col_r=1.5)


def slab_pts(rng, n=7, taper=0.85, wob=0.18):
    """Prism-like point cloud: an irregular n-gon at z=-1 and a smaller,
    independently jittered one at z=+1 (hull -> angular block)."""
    pts = []
    for zz, k in ((-1.0, 1.0), (1.0, taper)):
        off = rng.uniform(0, 2 * math.pi)
        for i in range(n):
            a = off + 2 * math.pi * (i + rng.uniform(-0.25, 0.25)) / n
            r = k * rng.uniform(1 - wob, 1 + wob * 0.4)
            pts.append((math.cos(a) * r, math.sin(a) * r, zz + rng.uniform(-0.08, 0.08)))
    return pts


def cliff_strata(name='cliff_a', seed=193):
    """Stepped outcrop of tilted, fractured strata with mossy ledges."""
    b = NatB(seed)
    rng = b.rng
    fs = []
    layers = [  # (width x, depth y, height, cx, cy, z0)
        (8.2, 6.6, 1.7, 0.0, 0.0, 0.0),
        (7.0, 5.6, 1.6, -0.3, 0.5, 1.45),
        (5.8, 4.6, 1.7, 0.2, 0.9, 2.85),
        (4.4, 3.6, 1.6, -0.35, 1.2, 4.3),
        (2.9, 2.5, 1.5, 0.3, 1.45, 5.6),
    ]
    tilt = (5, -4)
    for li, (w, d, h, cx, cy, z0) in enumerate(layers):
        nb = 3 if w > 5 else 2
        cuts = sorted(rng.uniform(-0.25, 0.25) + (i + 1) / nb for i in range(nb - 1))
        edges = [0.0] + cuts + [1.0]
        for j in range(nb):
            x0 = cx - w / 2 + edges[j] * w + 0.06
            x1 = cx - w / 2 + edges[j + 1] * w - 0.06
            bw = x1 - x0
            hh = h * rng.uniform(0.9, 1.15)
            c = mix(SLATE, 'stone', rng.uniform(0.0, 0.3))
            fs += b.hull_rock(size=(bw * 1.08, d * rng.uniform(0.9, 1.0), hh), loc=((x0 + x1) / 2, cy, z0),
                              pts=slab_pts(rng, n=7, taper=0.88), sink=0.2, rot=rng.uniform(-0.12, 0.12),
                              color=c, var=0.1, tilt=(tilt[0] + rng.uniform(-3, 3), tilt[1] + rng.uniform(-3, 3)),
                              dissolve=2)
    # tumbled blocks at the foot
    for (x, y, sc) in [(3.6, -2.6, 1.2), (-3.4, -2.9, 0.9), (1.2, -3.6, 0.7)]:
        fs += b.hull_rock(size=(1.3 * sc, 1.1 * sc, 0.9 * sc), loc=(x, y, 0), pts=slab_pts(rng, n=6, taper=0.8),
                          sink=0.12, rot=rng.uniform(0, 6.28), color=mix(SLATE, 'stone', 0.2), var=0.1,
                          tilt=(rng.uniform(-15, 15), rng.uniform(-15, 15)))
    b.light_from_above(fs, up=1.12, down=0.7, side=0.97)
    b.moss_top(fs, thresh=0.6, color=MOSS, chance=0.9)
    b.moss_top(fs, thresh=0.9, color=MOSS_LT, chance=0.5)
    ob = b.build(name, ao=0.35)
    return finish(ob, col_r=4.0)


def cliff_basalt(name='cliff_b', seed=197):
    """Crag of dark basalt columns: hex prisms rising to a tall back peak,
    a couple of toppled columns at the foot."""
    b = NatB(seed)
    rng = b.rng
    fs = []
    r = 0.52
    dx = r * math.sqrt(3) * 1.0
    peak = Vector((-0.4, 0.7, 0))
    for iy in range(-4, 5):
        for ix in range(-4, 5):
            x = (ix + (0.5 if iy % 2 else 0.0)) * dx
            y = iy * dx * 0.866
            dist = math.hypot(x / 3.0, y / 2.6)
            if dist > 1.0:
                continue
            dp = math.hypot(x - peak.x, (y - peak.y) * 1.2)
            h = max(1.2, 9.0 - dp * 2.35 + rng.uniform(-0.8, 0.5))
            if y < -1.2:
                h = min(h, 2.6 + rng.uniform(-0.6, 0.4))
            slope = rng.uniform(0.1, 0.35)
            sdir = rng.uniform(0, 2 * math.pi)
            c = mix(SLATE, 'stone_dark', rng.uniform(0.0, 0.5))
            col_f = b.lathe2([(r * 0.98, -0.15), (r * 0.94, h)], seg=6, loc=(x, y, 0), color=c,
                             cap_bottom=False, cap_top=True, var=0.1, phase=0.0,
                             ring_fn=lambda k, a, sl=slope, sd=sdir: (1.0, sl * r * math.cos(a - sd) if k == 1 else 0.0))
            fs += col_f
    # toppled columns
    for (x, y, L, yaw) in [(2.6, -2.2, 2.6, 0.5), (-2.0, -2.6, 2.0, -0.4)]:
        c = mix(SLATE, 'stone_dark', 0.3)
        fs += b.lathe2([(r * 0.9, -L / 2), (r * 0.9, L / 2)], seg=6, loc=(x, y, r * 0.7), rot=(90, 0, math.degrees(yaw)),
                       color=c, cap_bottom=True, cap_top=True, var=0.1)
    # lighter weathered column sides + mossy tops
    for f in fs:
        if abs(f.normal.z) < 0.3 and rng.random() < 0.15:
            b.paint([f], mix(SLATE, 'stone_light', 0.25), var=0.08)
    b.light_from_above(fs, up=1.12, down=0.7, side=0.97)
    b.moss_top(fs, thresh=0.75, color=MOSS, chance=0.75)
    ob = b.build(name, ao=0.35)
    return finish(ob, col_r=3.2)


def pebbles(name='pebbles', seed=191):
    b = NatB(seed)
    rng = b.rng
    fs = []
    for i, (x, y, s) in enumerate([(0.0, 0.0, 0.12), (0.13, 0.05, 0.08), (-0.1, 0.1, 0.09),
                                   (0.05, -0.12, 0.07), (-0.12, -0.07, 0.06), (0.16, -0.1, 0.05)]):
        c = mix('stone', 'stone_light', rng.uniform(0, 0.6)) if i != 1 else mix('slate', 'blue_dark', 0.3)
        fs += b.hull_rock(size=(s * 1.3, s, s * 0.75), loc=(x, y, 0), n=9, sink=0.02, rot=rng.uniform(0, 6.28),
                          color=c, var=0.1)
    b.light_from_above(fs, up=1.08, down=0.75, side=0.97)
    return b.build(name, ao=0.2)


# ===========================================================================
# WORLD TREE
# ===========================================================================
def world_tree(name='world_tree', seed=201):
    """Colossal ancient ash seen far away: massive buttressed trunk that
    splits into six huge limbs, which fork into branches and twigs to a
    ~50 m wide, ~40 m tall crown.  Bare and dark (Mat_Base only)."""
    b = NatB(seed)
    rng = b.rng
    bark = hexc('#3e3935')
    bark2 = hexc('#48423d')
    tp = [(0, 0, -1.0), (0.8, 0.3, 5.0), (1.5, -0.2, 10.5), (0.7, -0.7, 15.5), (0.0, 0.0, 19.0)]
    fs = b.tube(tp, [5.8, 4.0, 3.4, 3.1, 2.9], seg=10, color=bark, lobes=(6, [1.25, 0.4]), rough=0.1,
                twist=14, cap_end=True, var=0.1)
    for j in range(6):
        yaw = j * (math.pi / 3) + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        p0 = Vector((0, 0, 2.0)) + out * 3.5
        L = rng.uniform(8, 11)
        pts = [p0, p0 + out * (L * 0.5) + Vector((0, 0, -1.6)), p0 + out * L + Vector((0, 0, -2.6))]
        fs += b.tube(pts, [1.9, 1.0, 0.0], seg=5, color=bark, tip=True, rough=0.08, var=0.1)
    top = Vector(tp[-1])

    def grow(p, d, L, r0, r1, seg, n=3, up=0.0, spread=0.0, tip=False):
        pts = [p.copy()]
        q = p.copy()
        dd = d.normalized()
        for i in range(n):
            dd = (dd + Vector((rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), up))).normalized()
            q = q + dd * (L / n)
            pts.append(q.copy())
        radii = [lerp(r0, r1, i / n) for i in range(n + 1)]
        if tip:
            radii[-1] = 0.0
        f = b.tube(pts, radii, seg=seg, color=bark if seg > 4 else bark2, tip=tip, cap_end=not tip,
                   rough=0.06, var=0.1)
        return f, pts, dd

    for j in range(6):
        if j < 5:
            yaw = j * (2 * math.pi / 5) + 0.5 + rng.uniform(-0.2, 0.2)
            d = Vector((math.cos(yaw), math.sin(yaw), rng.uniform(1.0, 1.35)))
            start = top + Vector((0, 0, -rng.uniform(1.5, 3.5))) + Vector((math.cos(yaw), math.sin(yaw), 0)) * 1.0
            f, pts, dd = grow(start, d, rng.uniform(14, 17), 2.1, 0.9, seg=7, n=3, up=-0.1)
        else:   # central leader
            d = Vector((0.15, -0.1, 1.0))
            f, pts, dd = grow(top + Vector((0, 0, -1.0)), d, 14.0, 2.2, 0.9, seg=7, n=3, up=0.0)
        fs += f
        # branches: two from the limb end, one from its middle
        forks = [(pts[-1], dd, 1.0), (pts[-1], dd, -1.0), (pts[2], dd, 0.0)]
        for (bp, bd, side) in forks:
            yaw2 = math.atan2(bd.y, bd.x) + side * rng.uniform(0.45, 0.7) + (rng.uniform(-1.2, 1.2) if side == 0 else 0)
            d2 = Vector((math.cos(yaw2), math.sin(yaw2), rng.uniform(0.25, 0.55)))
            L2 = rng.uniform(10, 13) if side else rng.uniform(7, 9)
            f2, pts2, dd2 = grow(bp, d2, L2, 0.9 if side else 0.7, 0.35, seg=4, n=3, up=-0.04)
            fs += f2
            for t in (1, -1):
                yaw3 = math.atan2(dd2.y, dd2.x) + t * rng.uniform(0.35, 0.8)
                d3 = Vector((math.cos(yaw3), math.sin(yaw3), rng.uniform(-0.1, 0.7)))
                f3, _, _ = grow(pts2[-1], d3, rng.uniform(4, 6), 0.35, 0.0, seg=4, n=2, up=0.05, tip=True)
                fs += f3
    b.light_from_above(fs, up=1.08, down=0.8, side=1.0)
    ob = b.build(name, ao=0.25)
    return ob


# ===========================================================================
def build_all_assets():
    roots = []
    roots.append(pine('tree_pine_a', 3, H=9.6, R=1.75, n_t=9, z0=1.6, tips=9, pw=0.95, droop=0.5))
    roots.append(pine('tree_pine_b', 7, H=8.3, R=2.85, n_t=8, z0=0.85, tips=11, pw=0.78, droop=0.6,
                      ncol=mix(NEEDLE, 'pine_light', 0.2)))
    roots.append(pine('tree_pine_c', 11, H=8.8, R=2.05, n_t=7, z0=1.35, tips=8, pw=0.85, droop=0.5,
                      snag=True))
    roots.append(birch('tree_birch_a', 13, H=7.3, crown=1.2, lean=(0.3, 0.1)))
    roots.append(birch('tree_birch_b', 17, H=6.5, crown=1.1, twin=True))
    roots.append(oak())
    roots.append(dead_tree())
    roots.append(stump())
    roots.append(log_fallen())
    roots.append(bush_a())
    roots.append(raspberry())
    roots.append(blueberry())
    roots.append(fern())
    roots.append(reeds())
    roots.append(thistle())
    roots.append(dandelion())
    roots.append(mushroom_red())
    roots.append(mushroom_yellow())
    roots.append(mushroom_glow())
    roots.append(flower_patch('flower_patch_a', 151, 'a'))
    roots.append(flower_patch('flower_patch_b', 157, 'b'))
    roots.append(rock('rock_a', 161, (1.35, 1.2, 0.85), 0.55, n=13))
    roots.append(rock('rock_b', 163, (1.2, 0.8, 1.2), 0.5, n=12, bevel=0.025, tilt=(12, -8), moss=0.6))
    roots.append(rock('rock_c', 167, (0.95, 0.85, 0.72), 0.65, n=12,
                      extra=[((0.55, 0.48, 0.42), (0.52, 0.3, 0), 9), ((0.38, 0.34, 0.26), (-0.4, -0.45, 0), 8)]))
    roots.append(ore('ore_copper', 181, (1.25, 1.12, 0.98), ROCK, mix('copper_ore', 'teal', 0.2),
                     [('copper_ore', 'base', 4, 0.16, 0.07), (mix('copper', 'gold', 0.15), 'metal', 3, 0.13, 0.07)],
                     0.6, stain=mix(ROCK, 'copper_ore', 0.3)))
    roots.append(ore('ore_iron', 183, (1.32, 1.2, 1.08), mix('stone_dark', 'slate', 0.4), mix('rust', 'red_dark', 0.3),
                     [(mix('rust', 'red', 0.35), 'base', 4, 0.14, 0.08), ('iron', 'metal', 3, 0.12, 0.075)], 0.6,
                     stain=mix(mix('stone_dark', 'slate', 0.4), 'rust', 0.3)))
    roots.append(rock_big())
    roots.append(cliff_strata())
    roots.append(cliff_basalt())
    roots.append(pebbles())
    roots.append(world_tree())
    return roots


def build(out_dir):
    reset_scene()
    roots = build_all_assets()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'nature.glb')
    export_glb(path, roots)
    st = stats(roots)
    for k, v in st.items():
        print(f'  {k:18s} {v:5d} tris')
    print(f'[nature] {len(roots)} assets -> {path}')
    return st


if __name__ == '__main__':
    build(os.path.normpath(os.path.join(HERE, '..', 'assets', 'models')))
