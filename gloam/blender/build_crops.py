"""
build_crops.py - farm plots and crops for Gloam  ->  assets/models/crops.glb

    python blender/build_crops.py          (bpy module)
    blender -b -P blender/build_crops.py   (Blender)

Origin = tile centre on the ground.  `soil_tilled` is a 1 x 1 m patch
(<= 0.06 m tall, 3 furrows); every crop stands in the middle furrow, so its
geometry starts at Z0 ~ 0.03 and fits inside 0.8 x 0.8 m.

Stages: crop_sprout (1) -> crop_young (2) -> crop_<id>_grow (3) ->
crop_<id>_ripe (4, produce clearly visible), plus crop_withered.
Crop foliage is Mat_Leaves; roots/bulbs/fruit/berries are Mat_Base (the
nightshade berries get a painted gloss highlight); frostroot tips and
nightshade glints are tiny Mat_Emit specks.  Max 3 material slots each.  Barley and flax stalks carry their
heads/flowers on Mat_Leaves too, so the whole stalk sways as one.
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
from nature_kit import NB, bezier, lerp  # noqa: E402

Z0 = 0.03   # top of the furrow the crop sits in

# crop palette (sRGB)
LEAF = mix('leaf', 'leaf_light', 0.25)
LEAF_DK = mix('leaf', 'leaf_dark', 0.5)
TURNIP_W = hexc('#e6ddd0')
TURNIP_P = hexc('#8f4a95')
CARROT = hexc('#e07a28')
CARROT_TOP = mix('leaf_light', 'pine_light', 0.35)
ONION = hexc('#cf9a4c')
ONION_SKIN = hexc('#e2bf7e')
ONION_LEAF = mix('pine_light', 'teal', 0.35)
BARLEY = hexc('#d2b061')
BARLEY_STALK = hexc('#b89a58')
PUMPKIN = hexc('#d8772a')
PUMPKIN_DK = hexc('#b35d1f')
FLAX_FLOWER = hexc('#8eaee0')
NIGHT_LEAF = mix(mix('nightshade', 'leaf_dark', 0.4), 'purple', 0.35)
NIGHT_STEM = hexc('#4a2a5e')
NIGHT_BERRY = hexc('#46275f')
BEET = hexc('#8c1f3c')
BEET_VEIN = hexc('#a3203f')
FROST = hexc('#a9dbee')
FROST_LEAF = hexc('#dde8ee')
WITHER = hexc('#6e5a3e')


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def veined_leaf(b, base, yaw, pitch, L, W, color, vein, stalk=0.04, curl=0.03, vein_mat='leaves'):
    """Broad leaf with a coloured midrib band and petiole (beet chard look).
    Stations carry 5 verts: edge, inner, mid, inner, edge."""
    base = Vector(base)
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))

    def xf(x, y, z):
        x2, z2 = x * cp - z * sp, x * sp + z * cp
        return base + Vector((x2 * cy - y * sy, x2 * sy + y * cy, z2))
    st = [0.0, 0.3, 0.65, 1.0]
    wd = [0.25, 0.5, 0.42, 0.0]
    V, F = [], []
    for t, w in zip(st, wd):
        x = stalk + t * L
        dz = -curl * t * t
        ww = w * W
        V += [xf(x, -ww, dz), xf(x, -ww * 0.18, dz + ww * 0.12), xf(x, 0, dz + ww * 0.2),
              xf(x, ww * 0.18, dz + ww * 0.12), xf(x, ww, dz)]
    for k in range(3):
        a, c = 5 * k, 5 * (k + 1)
        for i in range(4):
            if k == 2:
                F.append((a + i, a + i + 1, c + 2))
            else:
                F.append((a + i, a + i + 1, c + i + 1, c + i))
    fs = b.mesh(V, F, color=color, mat='leaves', var=0.07)
    veins = [f for j, f in enumerate(fs) if (j % 4) in (1, 2)]
    b.paint(veins, vein, var=0.06)
    b.tube([xf(0, 0, 0), xf(stalk + 0.01, 0, 0.004)], [W * 0.07, W * 0.05], seg=3, color=vein,
           mat=vein_mat, cap_end=False)
    return fs


def rosette(b, n, L, W, pitch, color, z=Z0 + 0.01, yaw0=0.0, stalk=0.03, curl=0.03, shape=(0.4, 1.0, 0.7),
            fold=0.3, jit=12, lvar=0.15):
    rng = b.rng
    fs = []
    for i in range(n):
        yaw = yaw0 + i * 360 / n + rng.uniform(-jit, jit)
        f, s = b.leaf((0, 0, z), yaw, pitch + rng.uniform(-8, 8), L * rng.uniform(1 - lvar, 1 + lvar),
                      W, color=color, fold=fold, curl=curl, stalk=stalk, shape=shape)
        fs += f + s
    return fs


class CropB(NB):
    """NB whose build() flattens anything below the ground plane (crops
    never poke under the tile)."""

    def build(self, name, *a, **kw):
        self.clamp_z(0.0)
        return super().build(name, *a, **kw)


def bulb(b, prof, color, seg=10, loc=(0, 0, 0), smooth=True, ring_fn=None):
    return b.lathe2(prof, seg=seg, loc=loc, color=color, cap_bottom=False, cap_top=False, smooth=smooth,
                    var=0.05, ring_fn=ring_fn)


def bands(fs, seg):
    """Split lathe faces (fan, quads..., fan) into per-band lists."""
    return [fs[i:i + seg] for i in range(0, len(fs), seg)]


def lit(b, fs, up=1.12, down=0.75, side=0.95):
    b.light_from_above(fs, up=up, down=down, side=side)


# ---------------------------------------------------------------------------
# soil + generic stages
# ---------------------------------------------------------------------------
def soil_tilled(name='soil_tilled'):
    """1 x 1 m hoed patch: three raised rows (the crop stands on the middle
    one, whose top is ~0.055 m) separated by grooves, bevelled edges."""
    b = CropB(5)
    rng = b.rng
    xs = [-0.5, -0.46, -0.38, -0.3, -0.22, -0.15, -0.08, 0.0, 0.08, 0.15, 0.22, 0.3, 0.38, 0.46, 0.5]
    zp = [0.0, 0.03, 0.05, 0.056, 0.044, 0.025, 0.044, 0.057, 0.044, 0.025, 0.044, 0.056, 0.05, 0.03, 0.0]
    ys = [-0.5, -0.46, -0.25, 0.0, 0.25, 0.46, 0.5]
    endf = [0.0, 0.6, 1, 1, 1, 0.6, 0.0]
    V = []
    nx = len(xs)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            z = zp[i] * endf[j]
            xx, yy = x, y
            if 0 < i < nx - 1 and 0 < j < len(ys) - 1:
                z += rng.uniform(-0.0035, 0.0035)
                if i not in (1, nx - 2):
                    xx += rng.uniform(-0.008, 0.008)
                if j not in (1, len(ys) - 2):
                    yy += rng.uniform(-0.03, 0.03)
            V.append((xx, yy, max(0.0, min(0.06, z))))
    F = []
    for j in range(len(ys) - 1):
        for i in range(nx - 1):
            a = j * nx + i
            F.append((a, a + 1, a + 1 + nx, a + nx))
    fs = b.mesh(V, F, color='soil', var=0.06)
    for f in fs:
        z = f.calc_center_median().z
        if z < 0.036:
            b.paint([f], mix('soil', 'soil_wet', 0.4), var=0.06)
        elif z > 0.05:
            b.paint([f], mix('soil', 'wood', 0.2), var=0.06)
    lit(b, fs, up=1.05, down=0.85, side=0.92)
    for (x, y, s_) in [(-0.3, 0.2, 0.03), (0.3, -0.28, 0.026), (0.02, 0.36, 0.024), (-0.15, -0.3, 0.02),
                       (0.3, 0.33, 0.02)]:
        b.hull_rock(size=(s_ * 1.3, s_, s_ * 0.7), loc=(x, y, 0.04), n=7, sink=0.0, rot=rng.uniform(0, 6),
                    color=mix('soil', 'wood', 0.25), var=0.08)
    return b.build(name, ao=0.0)


def sprout(name='crop_sprout'):
    b = CropB(301)
    c = mix('leaf_light', 'grass', 0.2)
    fs = b.tube([(0, 0, Z0 - 0.01), (0.006, 0.0, Z0 + 0.065)], [0.009, 0.007], seg=3, color=c, mat='leaves',
                cap_end=False)
    for yaw in (10, 190):
        f, _ = b.leaf((0.006, 0, Z0 + 0.06), yaw, 24, 0.08, 0.065, color=c, fold=0.25, curl=0.015,
                      shape=(0.55, 1.0, 0.85), tipw=0.3)
        fs += f
    f, _ = b.leaf((0.006, 0, Z0 + 0.064), 100, 68, 0.035, 0.025, color=mix(c, 'leaf', 0.4), fold=0.2)
    fs += f
    lit(b, fs)
    return b.build(name, ao=0.15)


def young(name='crop_young'):
    b = CropB(302)
    fs = rosette(b, 6, 0.16, 0.09, 48, mix(LEAF, 'leaf_light', 0.3), stalk=0.03, curl=0.04,
                 shape=(0.45, 1.0, 0.75))
    fs += rosette(b, 3, 0.17, 0.07, 74, mix(LEAF, 'leaf_light', 0.5), z=Z0 + 0.03, yaw0=60, stalk=0.02, curl=0.03)
    lit(b, fs)
    return b.build(name, ao=0.2)


def withered(name='crop_withered'):
    b = CropB(303)
    rng = b.rng
    fs = b.tube(bezier((0, 0, Z0 - 0.01), (0.02, 0.0, 0.2), (0.14, 0.04, 0.16), 3), [0.012, 0.01, 0.008, 0.006],
                seg=3, color=mix(WITHER, 'straw', 0.2), cap_end=False)
    for i in range(6):
        yaw = i * 60 + rng.uniform(-15, 15)
        f, _ = b.leaf((0, 0, Z0 + 0.02 + 0.02 * (i % 2)), yaw, rng.uniform(-5, 15), rng.uniform(0.12, 0.17), 0.06,
                      color=mix(WITHER, 'straw' if i % 2 else 'wood_dark', rng.uniform(0.1, 0.4)),
                      mat='base', fold=0.45, curl=0.09, shape=(0.35, 0.8, 0.5), roll=rng.uniform(-25, 25))
        fs += f
    # the flopped-over top with two shrivelled leaves
    for yaw in (20, -40):
        f, _ = b.leaf((0.14, 0.04, 0.16), yaw, -35, 0.09, 0.045, color=mix(WITHER, 'wood_dark', 0.3), mat='base',
                      fold=0.5, curl=0.03, shape=(0.35, 0.8, 0.5))
        fs += f
    lit(b, fs, up=1.05, down=0.85, side=1.0)
    return b.build(name, ao=0.2)


# ---------------------------------------------------------------------------
# turnip
# ---------------------------------------------------------------------------
def turnip_root(b, s=1.0, loc=(0, 0, 0)):
    prof = [(0.0, 0.0), (0.03 * s, 0.02 * s), (0.075 * s, 0.05 * s), (0.1 * s, 0.1 * s), (0.092 * s, 0.145 * s),
            (0.06 * s, 0.18 * s), (0.02 * s, 0.195 * s), (0.0, 0.2 * s)]
    fs = bulb(b, prof, TURNIP_W, seg=10, loc=loc)
    bs = bands(fs, 10)
    b.paint(bs[3], mix(TURNIP_W, TURNIP_P, 0.45), var=0.05)
    for k in (4, 5, 6):
        b.paint(bs[k], TURNIP_P, var=0.05)
    return fs


def turnip(stage):
    b = CropB(310 if stage == 'grow' else 311)
    if stage == 'grow':
        fs = rosette(b, 6, 0.2, 0.1, 50, LEAF, stalk=0.04, curl=0.05, shape=(0.5, 1.0, 0.8))
        turnip_root(b, 0.45, (0, 0, Z0 - 0.04))
    else:
        turnip_root(b, 1.3, (0, 0, Z0 - 0.03))
        fs = rosette(b, 7, 0.25, 0.13, 55, LEAF, z=Z0 + 0.21, stalk=0.05, curl=0.07, shape=(0.5, 1.0, 0.8))
    lit(b, fs)
    return b.build(f'crop_turnip_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# carrot
# ---------------------------------------------------------------------------
def carrot_top(b, loc, s=1.0):
    prof = [(0.0, 0.0), (0.035 * s, 0.02 * s), (0.056 * s, 0.065 * s), (0.06 * s, 0.1 * s), (0.044 * s, 0.122 * s),
            (0.0, 0.13 * s)]
    fs = bulb(b, prof, CARROT, seg=8, loc=loc, smooth=False)
    bs = bands(fs, 8)
    b.paint(bs[-1], mix(CARROT, 'leaf', 0.25), var=0.05)
    return fs


def carrot_fronds(b, c, n, L, W, z, rise=(55, 72), yaw0=0.0):
    rng = b.rng
    fs = []
    for i in range(n):
        yaw = yaw0 + i * 360 / n + rng.uniform(-18, 18)
        fs += b.frond((c[0], c[1], z), yaw, L * rng.uniform(0.85, 1.15), W, rise=rng.uniform(*rise),
                      arch=rng.uniform(0.45, 0.65), segs=3, color=mix(CARROT_TOP, 'leaf', rng.uniform(0, 0.4)),
                      teeth=0.72, fold=0.2)
    return fs


def carrot(stage):
    b = CropB(320 if stage == 'grow' else 321)
    fs = []
    if stage == 'grow':
        fs = carrot_fronds(b, (0, 0), 7, 0.24, 0.12, Z0 + 0.01, rise=(62, 80))
        carrot_top(b, (0, 0, Z0 - 0.07), 0.6)
    else:
        for (x, y, s, n, tilt) in [(-0.08, 0.05, 1.35, 4, (0, 0, 0)), (0.09, 0.04, 1.2, 4, (0, 0, 0)),
                                   (0.0, -0.1, 1.25, 4, (0, 0, 0))]:
            carrot_top(b, (x, y, Z0 - 0.035), s)
            fs += carrot_fronds(b, (x, y), n, 0.3 * s, 0.14, Z0 + 0.12 * s, yaw0=b.rng.uniform(0, 90))
    lit(b, fs)
    return b.build(f'crop_carrot_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# onion
# ---------------------------------------------------------------------------
def onion_bulb(b, loc, s=1.0):
    prof = [(0.0, 0.0), (0.045 * s, 0.012 * s), (0.07 * s, 0.05 * s), (0.064 * s, 0.088 * s),
            (0.036 * s, 0.114 * s), (0.013 * s, 0.13 * s), (0.011 * s, 0.155 * s)]
    fs = bulb(b, prof, ONION, seg=9, loc=loc)
    bs = bands(fs, 9)
    b.paint(bs[0] + bs[1], mix(ONION, 'linen', 0.35), var=0.05)       # pale root plate
    b.paint(bs[4] + bs[5], ONION_SKIN, var=0.05)                         # papery neck
    return fs


def onion_leaves(b, c, n, L, z, bend=(0.0, 0.25), flop=()):
    rng = b.rng
    fs = []
    for i in range(n):
        yaw = i * 360 / n + rng.uniform(-20, 20)
        bd = 0.85 if i in flop else rng.uniform(*bend)
        f = b.blade((c[0], c[1], z), yaw, L * rng.uniform(0.8, 1.15), 0.03, tilt=rng.uniform(4, 14), bend=bd,
                    segs=3, color=ONION_LEAF, tube=True)
        if i in flop:
            b.paint(f[-6:], mix(ONION_LEAF, 'straw', 0.6), var=0.06)       # yellowing tip
        fs += f
    return fs


def onion(stage):
    b = CropB(330 if stage == 'grow' else 331)
    fs = []
    if stage == 'grow':
        for (x, y) in [(0.0, 0.0)]:
            onion_bulb(b, (x, y, Z0 - 0.04), 0.5)
            fs += onion_leaves(b, (x, y), 8, 0.32, Z0 + 0.03, bend=(0.0, 0.25))
    else:
        for i, (x, y, s) in enumerate([(-0.07, 0.06, 1.25), (0.09, 0.035, 1.1), (0.0, -0.1, 1.0)]):
            onion_bulb(b, (x, y, Z0 - 0.015), s)
            fs += onion_leaves(b, (x, y), 3, 0.4 * s, Z0 + 0.12 * s, bend=(0.1, 0.35), flop=(i % 3,))
    lit(b, fs)
    return b.build(f'crop_onion_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# barley
# ---------------------------------------------------------------------------
def barley(stage):
    b = CropB(340 if stage == 'grow' else 341)
    rng = b.rng
    fs = []
    if stage == 'grow':
        for i in range(18):
            a = rng.uniform(0, 2 * math.pi)
            r = rng.uniform(0.0, 0.1)
            fs += b.blade((r * math.cos(a), r * math.sin(a), Z0 - 0.01), math.degrees(a) + rng.uniform(-30, 30),
                          rng.uniform(0.28, 0.42), 0.032, tilt=rng.uniform(5, 20), bend=rng.uniform(0.2, 0.5), segs=3,
                          color=mix('grass', 'leaf_light', rng.uniform(0.1, 0.5)))
    else:
        n = 9
        for i in range(n):
            a = i * 2.39996 + rng.uniform(-0.2, 0.2)
            r = 0.02 + 0.08 * math.sqrt((i + 0.5) / n)
            x, y = r * math.cos(a), r * math.sin(a)
            h = rng.uniform(0.52, 0.66)
            lean = Vector((math.cos(a), math.sin(a), 0)) * rng.uniform(0.04, 0.1)
            p0 = Vector((x * 0.5, y * 0.5, Z0 - 0.01))
            p1 = Vector((x, y, Z0 + h * 0.6))
            p2 = Vector((x, y, Z0 + h)) + lean
            fs += b.tube([p0, p1, p2], [0.009, 0.007, 0.006], seg=3, color=BARLEY_STALK, mat='leaves',
                         cap_end=False)
            # nodding head along the curve beyond the stalk tip
            d = (p2 - p1).normalized()
            hd = (d + lean.normalized() * 0.9 + Vector((0, 0, -0.35))).normalized()
            q1 = p2 + hd * 0.05
            q2 = p2 + (hd + Vector((0, 0, -0.25))).normalized() * 0.11
            fs += b.tube([p2 - d * 0.01, q1, q2], [0.013, 0.02, 0.0], seg=4, color=BARLEY, mat='leaves', tip=True)
            # awns (whiskers) from the head
            for s_ in (-1, 1):
                side = hd.cross(Vector((0, 0, 1))).normalized() * s_
                fs += b.mesh([q1, q1 + side * 0.008, q1 + (hd * 0.7 + side * 0.5 + Vector((0, 0, 0.4))).normalized() * 0.09],
                             [(0, 1, 2)], color=mix(BARLEY, 'straw', 0.4), mat='leaves')
            # a drying leaf on the stalk
            fs += b.blade(tuple(p0.lerp(p1, 0.45)), math.degrees(a) + rng.uniform(-60, 60), 0.18, 0.024, tilt=45,
                          bend=0.6, segs=2, color=mix(BARLEY_STALK, 'grass', 0.35))
    lit(b, fs)
    return b.build(f'crop_barley_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# pumpkin
# ---------------------------------------------------------------------------
def pumpkin_body(b, loc, R, H, seg=16, color=PUMPKIN, groove=PUMPKIN_DK):
    prof = [(0.0, 0.0), (R * 0.45, 0.0), (R * 0.86, H * 0.2), (R, H * 0.5), (R * 0.9, H * 0.8), (R * 0.58, H * 0.97),
            (R * 0.2, H), (0.0, H * 0.93)]

    def rf(k, a):
        if k == 0 or k == len(prof) - 1:
            return 1.0, 0.0
        return (0.9 if (round(a * seg / (2 * math.pi)) % 2) else 1.0), 0.0
    fs = b.lathe2(prof, seg=seg, loc=loc, color=color, cap_bottom=False, cap_top=False, smooth=True, var=0.05,
                  ring_fn=rf)
    for j, f in enumerate(fs):
        if (j % seg) % 2 == 1 and 0 < j // seg < len(prof) - 2:
            b.paint([f], groove, var=0.04)
    return fs


def pumpkin_leaf(b, c, r, yaw, tilt=12, stalk_from=None):
    """Palmate 5-lobed leaf, cupped with wavy lobes (20 tris) + petiole."""
    rng = b.rng
    c = Vector(c)
    R = mathutils_euler(tilt, yaw)
    V = [c + R @ Vector((0, 0, r * 0.12))]
    for i in range(5):
        a = math.radians(yaw) + 2 * math.pi * i / 5
        V.append(c + R @ Vector((math.cos(a) * r * 0.45, math.sin(a) * r * 0.45, r * 0.1)))
    for i in range(10):
        a = math.radians(yaw) + math.pi * i / 5
        rr = r * (1.0 + rng.uniform(-0.08, 0.08)) if i % 2 == 0 else r * 0.62
        zz = r * (0.02 + rng.uniform(-0.05, 0.08)) if i % 2 == 0 else r * 0.08
        V.append(c + R @ Vector((math.cos(a) * rr, math.sin(a) * rr, zz)))
    F = []
    for i in range(5):
        F.append((0, 1 + i, 1 + (i + 1) % 5))
        t, n1, n0 = 6 + 2 * i, 6 + (2 * i + 1) % 10, 6 + (2 * i - 1) % 10
        F.append((1 + i, n0, t))
        F.append((1 + i, t, n1))
        F.append((1 + i, n1, 1 + (i + 1) % 5))
    fs = b.mesh(V, F, color=mix(LEAF_DK, 'leaf', rng.uniform(0.0, 0.4)), mat='leaves', var=0.08)
    if stalk_from is not None:
        fs += b.tube([stalk_from, tuple(V[0])], [0.01, 0.008], seg=3, color=mix(LEAF_DK, 'straw', 0.35),
                     mat='leaves', cap_end=False)
    return fs


def mathutils_euler(tilt, yaw):
    from mathutils import Euler
    return Euler((math.radians(tilt), 0, math.radians(yaw)), 'XYZ').to_matrix()


def pumpkin(stage):
    b = CropB(350 if stage == 'grow' else 351)
    rng = b.rng
    fs = []
    vine_c = mix('leaf', 'straw', 0.35)
    # vines along the ground
    vine = [(-0.26, -0.2, Z0), (-0.1, -0.05, Z0 + 0.02), (0.12, 0.08, Z0 + 0.015), (0.26, 0.2, Z0)]
    fs += b.tube(vine, [0.018, 0.016, 0.014, 0.01], seg=3, color=vine_c, mat='leaves', cap_end=False)
    if stage == 'grow':
        for (i, off, r) in [(0, (0.04, 0.1), 0.12), (1, (0.02, -0.14), 0.13), (2, (-0.1, 0.12), 0.14),
                            (3, (-0.05, -0.12), 0.11)]:
            p = vine[i]
            c = (p[0] + off[0], p[1] + off[1], Z0 + 0.1)
            fs += pumpkin_leaf(b, c, r, b.rng.uniform(0, 72), tilt=b.rng.uniform(-18, 18), stalk_from=p)
        # blossom + a small green pumpkin
        b.star((0.2, 0.17, Z0 + 0.09), 0.045, n=5, inner=0.6, h=0.02, color=mix('gold', 'mush_yellow', 0.3),
               mid=mix('ochre', 'gold', 0.4), mid_r=0.3, cup=0.02, tilt=(-15, 10))
        b.tube([(0.2, 0.17, Z0 + 0.01), (0.2, 0.17, Z0 + 0.08)], [0.008, 0.008], seg=3, color=vine_c,
               cap_end=False)
        pumpkin_body(b, (-0.08, 0.02, Z0 - 0.01), 0.075, 0.1, seg=10, color=mix('leaf', 'leaf_light', 0.45),
                     groove=mix('leaf', 'leaf_dark', 0.3))
    else:
        pumpkin_body(b, (0.0, 0.0, Z0 - 0.02), 0.27, 0.33)
        b.tube(bezier((0, 0, Z0 + 0.28), (0.0, 0.01, Z0 + 0.38), (0.05, 0.03, Z0 + 0.4), 2), [0.024, 0.02, 0.016],
               seg=5, color=mix('wood', 'leaf_dark', 0.35), cap_end=True)
        for (p, sp) in [((-0.24, -0.23), (-0.22, -0.16)), ((0.25, 0.23), (0.25, 0.16)), ((-0.23, 0.25), (-0.12, 0.08)),
                        ((0.25, -0.24), (0.2, -0.18))]:
            fs += pumpkin_leaf(b, (p[0], p[1], Z0 + 0.08), 0.125, b.rng.uniform(0, 72), tilt=b.rng.uniform(-15, 15),
                               stalk_from=(sp[0], sp[1], Z0 + 0.015))
        # a curly tendril
        fs += b.tube(bezier((0.14, 0.1, Z0 + 0.02), (0.2, -0.02, Z0 + 0.12), (0.26, 0.04, Z0 + 0.06), 3),
                     [0.006, 0.005, 0.004, 0.003], seg=3, color=vine_c, mat='leaves', cap_end=False)
    lit(b, fs)
    return b.build(f'crop_pumpkin_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# flax
# ---------------------------------------------------------------------------
def flax(stage):
    b = CropB(360 if stage == 'grow' else 361)
    rng = b.rng
    fs = []
    n = 11
    green = mix('leaf_light', 'grass', 0.4)
    for i in range(n):
        a = i * 2.39996 + rng.uniform(-0.2, 0.2)
        r = 0.02 + 0.1 * math.sqrt((i + 0.5) / n)
        x, y = r * math.cos(a), r * math.sin(a)
        h = rng.uniform(0.26, 0.36) if stage == 'grow' else rng.uniform(0.44, 0.58)
        yaw = math.degrees(a)
        f = b.blade((x * 0.4, y * 0.4, Z0 - 0.01), yaw, h, 0.014, tilt=rng.uniform(3, 10), bend=0.12, segs=2,
                    color=green)
        fs += f
        top = max((v.co for fc in f for v in fc.verts), key=lambda v: v.z)
        for k in range(2):
            fs += b.card(top.lerp(Vector((x * 0.4, y * 0.4, Z0)), 0.3 + 0.25 * k),
                         Vector((math.cos(a + k * 2), math.sin(a + k * 2), 1.2)), 0.06, 0.02, color=green)
        if stage == 'ripe':
            if i % 4 == 3:
                b.blob(0.016, loc=tuple(top + Vector((0, 0, 0.01))), uv=(4, 2), color=mix('straw', 'leaf', 0.4),
                       mat='leaves', var=0.08)            # a seed boll
            else:
                b.star(tuple(top + Vector((0, 0, 0.005))), 0.034, n=5, inner=0.62, h=0.012, color=FLAX_FLOWER,
                       mid=mix('gold', 'white', 0.4), mid_r=0.25, mat='leaves', cup=0.012,
                       tilt=(rng.uniform(-20, 20), rng.uniform(-20, 20)))
        else:
            b.blob(0.012, loc=tuple(top + Vector((0, 0, 0.006))), uv=(4, 2), color=mix(green, 'flax', 0.3),
                   mat='leaves', var=0.08)                # bud
    lit(b, fs)
    return b.build(f'crop_flax_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# nightshade
# ---------------------------------------------------------------------------
def nightshade(stage):
    b = CropB(370 if stage == 'grow' else 371)
    rng = b.rng
    fs = []
    H = 0.3 if stage == 'grow' else 0.45
    tops = []
    for j in range(3):
        a = j * 2.1 + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        p2 = Vector((0, 0, Z0)) + d * 0.1 + Vector((0, 0, H * rng.uniform(0.8, 1.0)))
        b.tube(bezier((0, 0, Z0 - 0.01), (d.x * 0.02, d.y * 0.02, Z0 + H * 0.5), tuple(p2), 2),
               [0.014, 0.011, 0.008], seg=3, color=NIGHT_STEM, cap_end=False)
        tops.append((p2, d))
    for (p2, d) in tops:
        for k in range(3):
            q = Vector((0, 0, Z0)).lerp(p2, 0.45 + 0.25 * k)
            yaw = math.degrees(math.atan2(d.y, d.x)) + rng.uniform(-70, 70)
            f, s = b.leaf(tuple(q), yaw, rng.uniform(10, 35), 0.15 if stage == 'ripe' else 0.12, 0.08,
                          color=mix(NIGHT_LEAF, 'purple', rng.uniform(0, 0.3)), fold=0.3, curl=0.04, stalk=0.02,
                          stalk_col=NIGHT_STEM, shape=(0.45, 1.0, 0.7))
            fs += f + s
    if stage == 'grow':
        for (p2, d) in tops[:2]:
            b.star(tuple(p2 + Vector((0, 0, 0.01))), 0.03, n=5, inner=0.45, h=0.012, color=mix('purple', 'glow_purple', 0.4),
                   mid=mix('gold', 'ochre', 0.3), mid_r=0.3, cup=0.01, tilt=(rng.uniform(-20, 20), 0))
    else:
        for ci, (p2, d) in enumerate(tops):
            c0 = p2 + d * 0.03 + Vector((0, 0, -0.03))
            b.tube([tuple(p2), tuple(c0)], [0.004, 0.003], seg=3, color=NIGHT_STEM, cap_end=False)
            for k, off in enumerate([(0, 0, 0), (0.036, 0.016, -0.022), (-0.025, 0.032, -0.026)]):
                p = c0 + Vector(off)
                bf = b.blob(0.031, loc=tuple(p), sub=1, noise=0.04, color=NIGHT_BERRY, mat='base', var=0.08)
                # painted gloss: the faces turned toward the sky catch a sheen
                for f in bf:
                    f.normal_update()
                    if f.normal.z > 0.9:
                        b.paint([f], mix(NIGHT_BERRY, 'glow_purple', 0.22), var=0.03)
                if k == 0 and ci != 1:
                    b.blob(0.007, loc=tuple(p + Vector((0.008, -0.014, 0.018))), uv=(4, 2), noise=0.0,
                           color=hexc('#7a45b0'), mat='emit', var=0.0)
    lit(b, fs)
    return b.build(f'crop_nightshade_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# beet
# ---------------------------------------------------------------------------
def beet_root(b, loc, s=1.0):
    prof = [(0.0, 0.0), (0.04 * s, 0.015 * s), (0.08 * s, 0.06 * s), (0.088 * s, 0.1 * s), (0.07 * s, 0.138 * s),
            (0.034 * s, 0.158 * s), (0.0, 0.165 * s)]
    fs = bulb(b, prof, BEET, seg=10, loc=loc)
    bs = bands(fs, 10)
    b.paint(bs[-1], mix(BEET, 'bark', 0.3), var=0.05)
    return fs


def beet(stage):
    b = CropB(380 if stage == 'grow' else 381)
    rng = b.rng
    fs = []
    if stage == 'grow':
        beet_root(b, (0, 0, Z0 - 0.07), 0.6)
        n, L, W, z, pitch = 5, 0.18, 0.14, Z0 + 0.02, 50
    else:
        beet_root(b, (0, 0, Z0 - 0.035), 1.3)
        n, L, W, z, pitch = 6, 0.24, 0.17, Z0 + 0.16, 58
    for i in range(n):
        yaw = i * 360 / n + rng.uniform(-12, 12)
        fs += veined_leaf(b, (0, 0, z), yaw, pitch + rng.uniform(-8, 8), L * rng.uniform(0.85, 1.15), W,
                          mix(LEAF_DK, 'red_dark', 0.12), BEET_VEIN, stalk=0.05, curl=0.05)
    lit(b, fs)
    return b.build(f'crop_beet_{stage}', ao=0.2)


# ---------------------------------------------------------------------------
# frostroot
# ---------------------------------------------------------------------------
def frost_crystal(b, loc, h, r, tilt, glow=False):
    fs = b.lathe2([(r, 0.0), (r * 1.08, h * 0.68), (0.0, h)], seg=6, loc=loc, rot=tilt,
                  color=mix(FROST, 'white', b.rng.uniform(0.0, 0.3)), cap_bottom=False, cap_top=False, var=0.1)
    for j, f in enumerate(fs):
        if j % 2 == 0:
            b.paint([f], mix(FROST, 'blue', 0.18), var=0.06)
    if glow:
        b.paint(fs[-6:], mix('glow_blue', 'frost', 0.5), var=0.0, mat='emit')
    return fs


def frostroot(stage):
    b = CropB(390 if stage == 'grow' else 391)
    rng = b.rng
    if stage == 'grow':
        fs = rosette(b, 5, 0.14, 0.08, 40, FROST_LEAF, stalk=0.02, curl=0.04, shape=(0.45, 1.0, 0.7))
        frost_crystal(b, (0.02, 0.0, Z0 - 0.01), 0.07, 0.022, (8, -6, 0))
        frost_crystal(b, (-0.03, 0.02, Z0 - 0.01), 0.05, 0.016, (-12, 10, 0))
    else:
        b.lathe2([(0.0, Z0 - 0.02), (0.07, Z0 + 0.0), (0.075, Z0 + 0.04), (0.04, Z0 + 0.07), (0.0, Z0 + 0.075)],
                 seg=8, color=mix(FROST, 'white', 0.45), cap_bottom=False, cap_top=False, smooth=True)
        for (x, y, h, r, t, g) in [(0.0, 0.0, 0.27, 0.05, (4, -5, 0), True), (0.06, 0.03, 0.2, 0.038, (18, 22, 0), True),
                                   (-0.055, 0.035, 0.17, 0.034, (22, -24, 0), False),
                                   (-0.01, -0.06, 0.15, 0.032, (-25, 5, 0), True),
                                   (0.05, -0.05, 0.11, 0.026, (-20, 30, 0), False)]:
            frost_crystal(b, (x, y, Z0 - 0.01), h, r, t, glow=g)
        fs = rosette(b, 5, 0.17, 0.09, 32, FROST_LEAF, yaw0=30, stalk=0.03, curl=0.05, shape=(0.45, 1.0, 0.7))
    lit(b, fs, up=1.08, down=0.85, side=0.97)
    return b.build(f'crop_frostroot_{stage}', ao=0.15)


CROPS = ['turnip', 'carrot', 'onion', 'barley', 'pumpkin', 'flax', 'nightshade', 'beet', 'frostroot']
MAKERS = {'turnip': turnip, 'carrot': carrot, 'onion': onion, 'barley': barley, 'pumpkin': pumpkin,
          'flax': flax, 'nightshade': nightshade, 'beet': beet, 'frostroot': frostroot}


def build_all_assets():
    roots = [soil_tilled(), sprout(), young(), withered()]
    for c in CROPS:
        roots.append(MAKERS[c]('grow'))
        roots.append(MAKERS[c]('ripe'))
    return roots


def build(out_dir):
    reset_scene()
    roots = build_all_assets()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'crops.glb')
    export_glb(path, roots)
    st = stats(roots)
    for k, v in st.items():
        print(f'  {k:24s} {v:5d} tris')
    print(f'[crops] {len(roots)} assets -> {path}')
    return st


if __name__ == '__main__':
    build(os.path.normpath(os.path.join(HERE, '..', 'assets', 'models')))
