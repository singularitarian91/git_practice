"""
Build props.glb - placeables and decor for Gloam.

    python blender/build_props.py                   # all props
    python blender/build_props.py --only=chest,campfire

Every asset: origin at the ground centre, front facing Blender -Y, light
sockets at flame / lantern centres, colliders as custom properties.
Budget: <= 800 triangles each.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401
from mathutils import Vector  # noqa: E402

from ghlib import Builder, empty, export_glb, reset_scene, stats, mix, col  # noqa: E402
from bldkit import (  # noqa: E402
    BEAM, EMBER, IRON, TIMBER_LT, WEATHERED, Frame,
    RAVEN_SPREAD, GLYPHS, StoneSlab, anvil_on_stump, barrel, beam, blades, crate,
    embers, emblem, fire, fix_glb_names, flower, goat_skull, grass, lantern, loft,
    log, moss_ring, ngon_prism, paint, pebble, rune_strokes, rvar, sack,
    shield, stone_color, sweep, tone, torus,
)


def finish(b, name, col_box=None, col_r=None, ao=0.2, ao_floor=None):
    root = b.build(name, ao=ao, ao_floor=ao_floor)
    if col_box is not None:
        root['col_box'] = [float(col_box[0]), float(col_box[1])]
    if col_r is not None:
        root['col_r'] = float(col_r)
    return root


def base_stones(b, n=4, r=0.14, size=(0.05, 0.08)):
    for i in range(n):
        a = 2 * math.pi * (i + b.rng.random() * 0.5) / n
        pebble(b, (math.cos(a) * r, math.sin(a) * r, 0), r=b.rng.uniform(*size))


# ---------------------------------------------------------------------------
# light sources
# ---------------------------------------------------------------------------
def torch_standing():
    b = Builder(seed=3001)
    sweep(b, [(0, 0, -0.1), (0.015, 0.0, 0.6), (-0.01, 0.01, 1.2), (0.0, 0.0, 1.56)],
          [0.058, 0.054, 0.05, 0.046], seg=6, color=mix('wood', 'wood_dark', 0.3), jitter=0.003)
    for z in (0.92, 1.22):
        b.cyl(0.064, h=0.07, seg=6, loc=(0, 0, z), color='leather')
    base_stones(b, 4, 0.13)
    b.lathe([(0.05, 1.5), (0.11, 1.6), (0.15, 1.74), (0.13, 1.74), (0.09, 1.64)], seg=8,
            color=IRON, mat='metal')
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        beam(b, (math.cos(a) * 0.14, math.sin(a) * 0.14, 1.72), (math.cos(a) * 0.17, math.sin(a) * 0.17, 1.9),
             0.022, 0.022, color=IRON, mat='metal')
    b.ico(r=0.1, sub=0, loc=(0, 0, 1.69), scale=(1, 1, 0.6), color=mix('coal', 'wood_dark', 0.5))
    embers(b, (0, 0, 1.72), r=0.07, n=3, size=0.035)
    glow = fire(b, (0, 0, 1.7), s=0.55)
    root = finish(b, 'torch_standing', col_r=0.15)
    empty('light', (glow[0], glow[1], glow[2] + 0.04), root)
    return root


def brazier():
    b = Builder(seed=3002)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        c, s = math.cos(a), math.sin(a)
        sweep(b, [(c * 0.3, s * 0.3, 0.05), (c * 0.4, s * 0.4, 0.02), (c * 0.36, s * 0.36, 0.3),
                  (c * 0.26, s * 0.26, 0.68)], 0.028, seg=4, color=IRON, mat='metal')
    torus(b, (0, 0, 0.34), 0.34, 0.017, seg=9, seg2=3, color=IRON)
    b.lathe([(0.08, 0.62), (0.3, 0.68), (0.42, 0.86), (0.46, 0.95), (0.42, 0.95), (0.38, 0.87)], seg=10,
            color='iron', mat='metal', var=0.05)
    for i in range(10):
        a = b.rng.uniform(0, 2 * math.pi)
        d = b.rng.uniform(0, 0.3)
        hot = b.rng.random() < 0.55
        b.ico(r=b.rng.uniform(0.05, 0.08), sub=0, loc=(math.cos(a) * d, math.sin(a) * d, 0.9 + (0.3 - d) * 0.15),
              scale=(1, 1, 0.7), color=(EMBER if hot else mix('coal', 'stone_dark', 0.5)),
              mat='emit' if hot else 'base', jitter=0.01)
    glow = fire(b, (0.0, 0.0, 0.92), s=0.6)
    root = finish(b, 'brazier', col_r=0.4)
    empty('light', (glow[0], glow[1], glow[2] + 0.05), root)
    return root


def campfire():
    b = Builder(seed=3003)
    for i in range(9):
        a = 2 * math.pi * i / 9 + b.rng.uniform(-0.1, 0.1)
        b.ico(r=b.rng.uniform(0.11, 0.15), sub=0, loc=(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.08),
              scale=(1.2, 1.0, 0.75), rot=(0, 0, math.degrees(a)), color=stone_color(b.rng, 'stone'),
              jitter=0.02)
    b.cyl(0.42, h=0.02, seg=10, loc=(0, 0, 0), color=mix('coal', 'stone_dark', 0.6))
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.2
        log(b, (math.cos(a) * 0.38, math.sin(a) * 0.38, 0.04),
            (math.cos(a + 0.35) * 0.05, math.sin(a + 0.35) * 0.05, 0.42), 0.055, seg=5, color='bark',
            end_color=mix('coal', 'wood_dark', 0.5), jitter=0.004)
    embers(b, (0, 0, 0.03), r=0.26, n=8, size=0.06)
    glow = fire(b, (0.0, 0.0, 0.04), s=0.95)
    root = finish(b, 'campfire', col_r=0.5)
    empty('light', (glow[0], glow[1], glow[2] + 0.05), root)
    return root


def lantern_post():
    b = Builder(seed=3009)
    sweep(b, [(0, 0, -0.12), (0.04, 0.0, 0.8), (-0.03, 0.02, 1.6), (0.02, 0.0, 2.22)],
          [0.08, 0.07, 0.065, 0.06], seg=6, color=BEAM, jitter=0.004)
    b.cone(r=0.075, h=0.08, seg=6, loc=(0.02, 0.0, 2.2), color=BEAM)
    beam(b, (0.0, 0.0, 2.08), (0.58, 0.0, 2.1), 0.06, 0.07, color=BEAM)
    beam(b, (0.0, 0.0, 1.74), (0.34, 0.0, 2.06), 0.045, 0.045, color=BEAM)
    b.box((0.025, 0.025, 0.12), loc=(0.5, 0.0, 2.0), color=IRON, mat='metal')
    glow = lantern(b, (0.5, 0.0, 1.95), s=1.3)
    base_stones(b, 4, 0.15)
    root = finish(b, 'lantern_post', col_r=0.15)
    empty('light', glow, root)
    return root


def cauldron():
    b = Builder(seed=3011)
    for k in range(3):
        a = 2 * math.pi * k / 3 + math.pi / 2
        c, s = math.cos(a), math.sin(a)
        sweep(b, [(c * 0.6, s * 0.6, -0.05), (-c * 0.07, -s * 0.07, 1.32)], [0.036, 0.03], seg=5,
              color=mix('wood', 'wood_dark', 0.35))
    b.cyl(0.07, h=0.1, seg=6, loc=(0, 0, 1.12), color='rope')
    for i in range(4):
        b.box((0.03, 0.012 if i % 2 else 0.045, 0.07), loc=(0, 0, 1.08 - i * 0.07), rot=(0, 0, 90 * (i % 2)),
              color=IRON, mat='metal')
    torus(b, (0, 0, 0.8), 0.28, 0.012, seg=8, seg2=3, rot=(90, 0, 0), arc=180, color=IRON)
    b.lathe([(0.1, 0.34), (0.24, 0.37), (0.32, 0.5), (0.33, 0.62), (0.28, 0.74), (0.3, 0.78), (0.26, 0.78)],
            seg=10, color='iron', mat='metal', var=0.05)
    b.cyl(0.26, h=0.02, seg=10, loc=(0, 0, 0.72), color=mix('soil', 'moss', 0.45))
    for i in range(4):
        a = b.rng.uniform(0, 2 * math.pi)
        b.ico(r=0.035, sub=0, loc=(math.cos(a) * 0.14, math.sin(a) * 0.14, 0.75),
              color=b.rng.choice(('carrot', 'turnip', 'onion')))
    for i in range(6):
        a = 2 * math.pi * i / 6
        b.ico(r=0.08, sub=0, loc=(math.cos(a) * 0.3, math.sin(a) * 0.3, 0.05), scale=(1.2, 1, 0.8),
              color=stone_color(b.rng, 'stone'), jitter=0.015)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        log(b, (math.cos(a) * 0.26, math.sin(a) * 0.26, 0.04), (math.cos(a) * -0.05, math.sin(a) * -0.05, 0.12),
            0.04, seg=5, color='bark', end_color=mix('coal', 'wood_dark', 0.5))
    embers(b, (0, 0, 0.03), r=0.15, n=5, size=0.045)
    glow = fire(b, (0.0, 0.0, 0.04), s=0.45)
    root = finish(b, 'cauldron', col_r=0.5)
    empty('light', (glow[0], glow[1], glow[2]), root)
    return root


# ---------------------------------------------------------------------------
# crafting & storage
# ---------------------------------------------------------------------------
def workbench():
    b = Builder(seed=3004)
    W, D, H = 1.9, 0.85, 0.88
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.12, 0.12, H - 0.1), loc=(sx * (W / 2 - 0.12), sy * (D / 2 - 0.1), (H - 0.1) / 2),
                  color=BEAM, jitter=0.005)
    for i in range(3):
        b.box((W, D / 3 - 0.012, 0.1), loc=(b.rng.uniform(-0.02, 0.02), -D / 2 + D / 6 + i * D / 3, H - 0.05),
              color=rvar(b.rng, TIMBER_LT, 0.08), jitter=0.004)
    for sy in (-1, 1):
        b.box((W - 0.3, 0.06, 0.08), loc=(0, sy * (D / 2 - 0.1), 0.25), color=BEAM)
    b.box((W - 0.3, D - 0.22, 0.04), loc=(0, 0, 0.3), color=mix('wood', 'wood_light', 0.3))
    for i in range(3):
        log(b, (-0.6, -0.17 + i * 0.14, 0.38), (0.45, -0.15 + i * 0.13, 0.38), 0.055, seg=5, color='bark')
    # tool rack with a little pent roof
    for sx in (-1, 1):
        b.box((0.09, 0.09, 1.0), loc=(sx * (W / 2 - 0.12), D / 2 - 0.08, H + 0.45), color=BEAM)
    b.box((W - 0.15, 0.05, 0.62), loc=(0, D / 2 - 0.06, H + 0.4), color=mix('wood', 'wood_dark', 0.3))
    beam(b, (-W / 2 - 0.06, D / 2 + 0.1, H + 0.98), (W / 2 + 0.06, D / 2 + 0.1, H + 0.98), 0.5, 0.05,
         color=rvar(b.rng, WEATHERED, 0.05), roll=-18)
    # tools hanging on the board: hammer, tongs, saw
    z0 = H + 0.62
    b.box((0.03, 0.03, 0.3), loc=(-0.6, D / 2 - 0.1, z0 - 0.15), color='wood_light')
    b.box((0.12, 0.05, 0.05), loc=(-0.6, D / 2 - 0.1, z0 + 0.02), color='iron', mat='metal')
    for dx in (-0.03, 0.03):
        beam(b, (-0.25 + dx * 2, D / 2 - 0.1, z0 - 0.3), (-0.25 + dx, D / 2 - 0.1, z0 + 0.05), 0.02, 0.02,
             color=IRON, mat='metal')
    ngon_prism(b, [(0.15, z0 - 0.32), (0.55, z0 - 0.24), (0.55, z0 - 0.1), (0.15, z0 - 0.12)], 0.01,
               frame=Frame((0, D / 2 - 0.09, 0), 0), w0=0.0, color='silver', mat='metal')
    b.box((0.12, 0.03, 0.12), loc=(0.62, D / 2 - 0.1, z0 - 0.16), color='wood_light')
    # vice on the front-right corner
    vx, vy = W / 2 - 0.25, -D / 2 + 0.02
    b.box((0.16, 0.14, 0.16), loc=(vx, vy + 0.06, H + 0.08), color=IRON, mat='metal')
    b.box((0.16, 0.05, 0.16), loc=(vx, vy - 0.04, H + 0.08), color='iron', mat='metal')
    beam(b, (vx - 0.14, vy - 0.1, H + 0.06), (vx + 0.14, vy - 0.1, H + 0.06), 0.025, 0.025, color='iron', mat='metal')
    # saw and axe lying on the top
    beam(b, (-0.55, -0.15, H + 0.01), (-0.08, -0.12, H + 0.01), 0.1, 0.01, color='silver', mat='metal')
    b.box((0.12, 0.05, 0.04), loc=(-0.02, -0.12, H + 0.02), color='wood_light')
    beam(b, (0.05, 0.12, H + 0.03), (0.55, 0.2, H + 0.03), 0.04, 0.04, color='wood_light')
    b.box((0.08, 0.16, 0.035), loc=(0.57, 0.14, H + 0.03), rot=(0, 0, 10), color='iron', mat='metal')
    for i in range(5):
        b.box((0.05, 0.02, 0.01), loc=(b.rng.uniform(-0.8, 0.8), b.rng.uniform(-0.35, 0.3), H + 0.005),
              rot=(0, 0, b.rng.uniform(0, 180)), color='wood_light')
    return finish(b, 'workbench', col_box=(2.0, 1.0))


def chest():
    b = Builder(seed=3005)
    W, D, HB, HL = 0.9, 0.6, 0.38, 0.2
    wood = mix('wood', 'wood_light', 0.2)
    b.box((W - 0.02, D - 0.02, HB - 0.03), loc=(0, 0, HB / 2 + 0.015), color=wood, bevel=0.012, jitter=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.07, 0.07, 0.04), loc=(sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), 0.02), color=BEAM)
            b.box((0.05, 0.05, HB - 0.03), loc=(sx * (W / 2 - 0.02), sy * (D / 2 - 0.02), HB / 2 + 0.015),
                  color=IRON, mat='metal')
    for x in (-0.27, 0.27):
        b.box((0.06, D + 0.01, HB - 0.02), loc=(x, 0, HB / 2 + 0.015), color=IRON, mat='metal')
    b.box((W + 0.01, D + 0.01, 0.04), loc=(0, 0, 0.06), color=IRON, mat='metal')
    b.box((0.15, 0.02, 0.15), loc=(0, -D / 2 - 0.012, HB - 0.1), color='iron', mat='metal')
    b.box((0.025, 0.01, 0.05), loc=(0, -D / 2 - 0.024, HB - 0.11), color='coal')
    root = finish(b, 'chest', col_box=(W, D))
    # --- lid (origin on the back hinge edge)
    lb = Builder(seed=3055)
    n = 7

    def arc(off=0.0):
        pts = []
        for i in range(n):
            t = math.pi * i / (n - 1)
            pts.append((0.0, (D / 2 + off) * math.cos(t), HB + (HL + off) * math.sin(t) ** 0.7))
        return pts

    rings = []
    for x in (-W / 2, W / 2):
        rings.append([(x, p[1], p[2]) for p in arc()])
    loft(lb, rings, color=wood, closed=True, caps=True, var=0.1)
    for x in (-0.27, 0.27):
        rings = [[(x + dx, p[1], p[2]) for p in arc(0.012)] for dx in (-0.03, 0.03)]
        loft(lb, rings, color=IRON, mat='metal', closed=True, caps=True)
    rings = [[(x, p[1], p[2]) for p in arc(0.008)] for x in (-W / 2 - 0.005, -W / 2 + 0.04)]
    loft(lb, rings, color=IRON, mat='metal', closed=True, caps=True)
    rings = [[(x, p[1], p[2]) for p in arc(0.008)] for x in (W / 2 - 0.04, W / 2 + 0.005)]
    loft(lb, rings, color=IRON, mat='metal', closed=True, caps=True)
    lb.box((0.08, 0.02, 0.14), loc=(0, -D / 2 - 0.02, HB - 0.02), color='iron', mat='metal')
    torus(lb, (0, -D / 2 - 0.035, HB - 0.08), 0.03, 0.008, seg=6, seg2=3, rot=(90, 0, 0), color='iron')
    lb.build('lid', origin=(0, D / 2, HB), parent=root, ao=0.1)
    return root


def shipping_crate():
    b = Builder(seed=3006)
    W, D, H = 1.2, 0.9, 0.7
    wood = mix('wood_light', 'wood', 0.35)
    b.box((W - 0.05, D - 0.05, H - 0.02), loc=(0, 0, H / 2), color=wood, jitter=0.004, var=0.1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.08, 0.08, H), loc=(sx * (W / 2 - 0.04), sy * (D / 2 - 0.04), H / 2), color=BEAM, jitter=0.003)
    for z in (0.05, H - 0.05):
        b.box((W + 0.006, D + 0.006, 0.08), loc=(0, 0, z), color=BEAM, jitter=0.003)
    for sy in (-1, 1):
        b.box((W - 0.12, 0.02, 0.07), loc=(0, sy * (D / 2 - 0.018), H / 2), color=BEAM)
    Ff = Frame((0, -D / 2 + 0.024, 0), 0)
    emblem(b, Ff, RAVEN_SPREAD, 0.0, H / 2 + 0.02, 0.46, w0=0.0, depth=0.008,
           color=mix('coal', 'wood_dark', 0.35))
    for sx in (-1, 1):
        beam(b, (sx * (W / 2 + 0.005), -0.12, H * 0.55), (sx * (W / 2 + 0.005), 0.12, H * 0.55), 0.03, 0.03,
             color='rope')
    root = finish(b, 'shipping_crate', col_box=(W, D))
    lb = Builder(seed=3066)
    for i in range(4):
        y = -D / 2 + D * (i + 0.5) / 4
        lb.box((W + 0.02, D / 4 - 0.012, 0.05), loc=(0, y, H + 0.025), color=rvar(lb.rng, wood, 0.08), jitter=0.003)
    for x in (-0.4, 0.4):
        lb.box((0.09, D - 0.04, 0.03), loc=(x, 0, H + 0.065), color=BEAM)
    lb.box((0.24, 0.05, 0.03), loc=(0, -D / 2 + 0.1, H + 0.07), color='rope')
    for (a, c) in GLYPHS['fehu']:
        pa = Vector((a[0] * 0.36, -0.18 + a[1] * 0.36, H + 0.052))
        pc = Vector((c[0] * 0.36, -0.18 + c[1] * 0.36, H + 0.052))
        beam(lb, pa, pc, 0.035, 0.006, color=mix('ochre', 'bone', 0.3), up=(0, 0, 1))
    lb.build('lid', origin=(0, D / 2, H), parent=root, ao=0.1)
    return root


def p_barrel():
    b = Builder(seed=3013)
    barrel(b, (0, 0, 0), r=0.34, h=0.9, seg=10, color='wood', hoops=(0.1, 0.34, 0.66, 0.9))
    b.box((0.05, 0.03, 0.05), loc=(0.0, -0.33, 0.35), color='wood_dark')
    return finish(b, 'barrel', col_r=0.35)


def crate_stack():
    b = Builder(seed=3014)
    crate(b, (-0.33, 0.0, 0), size=(0.62, 0.62, 0.55), rot_z=3, color='wood_light')
    crate(b, (0.34, 0.03, 0), size=(0.6, 0.6, 0.55), rot_z=-4, color=mix('wood_light', 'wood', 0.4))
    crate(b, (0.02, 0.02, 0.55), size=(0.56, 0.56, 0.5), rot_z=11, color=mix('wood_light', 'wood', 0.2))
    sack(b, (0.05, 0.0, 1.05), s=0.4, color='linen', rot=(0, 0, 20))
    return finish(b, 'crate_stack', col_box=(1.3, 0.7))


def wood_pile():
    b = Builder(seed=3017)
    for sx in (-1, 1):
        for sy, h in ((-1, 1.05), (1, 1.25)):
            b.box((0.08, 0.08, h), loc=(sx * 0.72, sy * 0.22, h / 2 - 0.03), color=BEAM, jitter=0.004)
    for sy in (-1, 1):
        log(b, (-0.8, sy * 0.15, 0.05), (0.8, sy * 0.15, 0.05), 0.05, seg=5, color=BEAM)
    for row in range(4):
        n = 7
        for i in range(n):
            x = -0.57 + i * 0.19 + (0.095 if row % 2 else 0.0)
            if x > 0.62:
                continue
            z = 0.17 + row * 0.18
            log(b, (x, -0.27, z), (x + b.rng.uniform(-0.02, 0.02), 0.26, z + b.rng.uniform(-0.01, 0.01)),
                0.085, seg=5, color='bark', end_color=tone('wood_light', b.rng.uniform(0.9, 1.08)),
                jitter=0.006, phase=b.rng.uniform(0, 1.2))
    beam(b, (-0.85, -0.02, 1.2), (0.85, -0.02, 1.2), 0.7, 0.05, color=rvar(b.rng, WEATHERED, 0.05), roll=-14)
    b.cyl(0.24, 0.26, h=0.3, seg=7, loc=(0.95, -0.35, -0.02), color='bark')
    b.cyl(0.22, h=0.02, seg=7, loc=(0.95, -0.35, 0.28), color='wood_light')
    beam(b, (0.95, -0.35, 0.3), (1.05, -0.2, 0.62), 0.035, 0.035, color='wood_light')
    b.box((0.05, 0.16, 0.1), loc=(0.96, -0.36, 0.34), rot=(22, 0, 0), color='iron', mat='metal')
    return finish(b, 'wood_pile', col_box=(1.5, 0.7))


def cart():
    b = Builder(seed=3016)
    oy = 0.43
    y0, y1 = -0.7 + oy, 0.7 + oy
    ZB = 0.55
    b.box((1.2, 1.4, 0.06), loc=(0, oy, ZB), color=mix('wood', 'wood_light', 0.3), jitter=0.004)
    for sx in (-1, 1):
        for k in range(2):
            b.box((0.05, 1.42, 0.13), loc=(sx * 0.6, oy, ZB + 0.1 + k * 0.15), color=rvar(b.rng, 'wood', 0.08))
    for y in (y0, y1):
        for k in range(2):
            b.box((1.22, 0.05, 0.13), loc=(0, y, ZB + 0.1 + k * 0.15), color=rvar(b.rng, 'wood', 0.08))
    for sx in (-1, 1):
        for y in (y0, y1):
            b.box((0.07, 0.07, 0.4), loc=(sx * 0.6, y, ZB + 0.15), color=BEAM)
        beam(b, (sx * 0.5, y0 + 0.2, ZB - 0.06), (sx * 0.42, -1.17, ZB + 0.08), 0.07, 0.07, color=BEAM)
    beam(b, (-0.46, -1.08, ZB + 0.07), (0.46, -1.08, ZB + 0.07), 0.05, 0.05, color='wood_light')
    beam(b, (0, y0 + 0.05, ZB - 0.03), (0, y0 - 0.1, 0.0), 0.06, 0.06, color=BEAM)
    WR = 0.45
    log(b, (-0.78, oy + 0.1, WR), (0.78, oy + 0.1, WR), 0.04, seg=6, color=BEAM, end_color=BEAM)
    for sx in (-1, 1):
        x = sx * 0.72
        torus(b, (x, oy + 0.1, WR), WR - 0.04, 0.045, seg=10, seg2=3, rot=(0, 90, 0), color=BEAM, mat='base')
        b.cyl(0.08, h=0.14, seg=6, loc=(x - 0.07, oy + 0.1, WR), rot=(0, 90, 0), color='wood_dark')
        for k in range(5):
            a = 2 * math.pi * k / 5
            beam(b, (x, oy + 0.1, WR), (x, oy + 0.1 + math.cos(a) * (WR - 0.06), WR + math.sin(a) * (WR - 0.06)),
                 0.035, 0.035, color='wood')
    sack(b, (-0.25, oy + 0.2, ZB + 0.03), s=0.85, color='linen', rot=(0, 0, 30))
    crate(b, (0.25, oy - 0.2, ZB + 0.03), size=(0.48, 0.45, 0.38), rot_z=8, color='wood_light', brace=False)
    return finish(b, 'cart', col_box=(1.6, 2.5))


def bench():
    b = Builder(seed=3012)
    for x in (-0.6, 0.6):
        b.cyl(0.15, 0.17, h=0.34, seg=7, loc=(x, 0, -0.02), color='bark', jitter=0.01)
    rings = []
    for x in (-0.9, -0.3, 0.3, 0.9):
        ring = []
        for k in range(7):
            a = math.pi + math.pi * k / 6
            ring.append((x + b.rng.uniform(-0.01, 0.01), 0.2 * math.cos(a), 0.46 + 0.14 * math.sin(a)))
        rings.append(ring)
    fs, caps, bands = loft(b, rings, color='bark', closed=True, caps=True)
    for band in bands:
        paint(b, [band[-1]], mix('wood_light', 'wood', 0.3), 0.06)
    paint(b, caps, 'wood_light', 0.05)
    return finish(b, 'bench', col_box=(1.8, 0.45))


def hay_bale():
    b = Builder(seed=3015)
    prof = [(0.0, -0.5), (0.42, -0.5), (0.53, -0.42), (0.57, -0.15), (0.57, 0.15), (0.53, 0.42), (0.42, 0.5),
            (0.0, 0.5)]
    fs = b.lathe(prof, seg=11, loc=(0, 0, 0.555), rot=(0, 90, 0), color='straw', jitter=0.02, var=0.1)
    for x in (-0.24, 0.24):
        b.lathe([(0.585, -0.025), (0.585, 0.025)], seg=11, loc=(x, 0, 0.555), rot=(0, 90, 0), color='rope',
                cap_bottom=False, cap_top=False)
    for f in fs:
        f.normal_update()
        if abs(f.normal.x) > 0.8:
            paint(b, [f], mix('straw', 'thatch', 0.5), 0.08)
    for i in range(10):
        a = b.rng.uniform(0, 2 * math.pi)
        x = b.rng.uniform(-0.45, 0.45)
        p = Vector((x, math.cos(a) * 0.56, 0.555 + math.sin(a) * 0.56))
        d = Vector((b.rng.uniform(-0.3, 0.3), math.cos(a), math.sin(a))).normalized()
        sweep(b, [p - d * 0.03, p + d * 0.14], [0.025, 0.0], seg=3, color=mix('straw', 'barley', 0.5))
    return finish(b, 'hay_bale', col_r=0.5)


# ---------------------------------------------------------------------------
# farm & village decor
# ---------------------------------------------------------------------------
def scarecrow():
    b = Builder(seed=3007)
    burlap = mix('sand', 'linen', 0.35)
    sweep(b, [(0, 0, -0.12), (0.0, 0.01, 1.0), (0.01, 0.0, 1.5)], 0.045, seg=5, color=BEAM)
    beam(b, (-0.68, 0.0, 1.37), (0.68, 0.0, 1.4), 0.06, 0.06, color=BEAM)
    b.lathe([(0.25, 0.74), (0.24, 0.92), (0.2, 1.15), (0.24, 1.34), (0.14, 1.46), (0.06, 1.5)], seg=7,
            scale=(1, 0.72, 1), color=burlap, jitter=0.012)
    b.lathe([(0.215, 0.95), (0.215, 1.0)], seg=7, scale=(1, 0.75, 1), color='rope', cap_bottom=False,
            cap_top=False)
    for sx in (-1, 1):
        sweep(b, [(sx * 0.16, 0, 1.37), (sx * 0.6, 0, 1.39)], [0.095, 0.075], seg=6, color=burlap, jitter=0.01)
        for k in range(4):
            a = k * math.pi / 2 + 0.3
            sweep(b, [(sx * 0.6, 0, 1.39), (sx * 0.74, math.cos(a) * 0.06, 1.35 + math.sin(a) * 0.06)],
                  [0.035, 0.0], seg=3, color='straw')
    for k in range(7):
        a = 2 * math.pi * k / 7
        p = (math.cos(a) * 0.22, math.sin(a) * 0.16, 0.76)
        sweep(b, [p, (p[0] * 1.2, p[1] * 1.2, 0.58 + b.rng.uniform(-0.04, 0.04))], [0.04, 0.0], seg=3, color='straw')
    # tattered cloak over the shoulders
    rings = []
    for i in range(6):
        x = -0.34 + 0.68 * i / 5
        bot = 0.86 - (0.08 if i % 2 else 0.0) - b.rng.uniform(0, 0.08)
        rings.append([(x, 0.13, 1.47), (x, 0.2, 1.2), (x * 1.05, 0.2, bot), (x * 1.05, 0.23, bot),
                      (x, 0.23, 1.2), (x, 0.16, 1.49)])
    loft(b, rings, color=mix('green', 'blue_dark', 0.4), closed=True, caps=True, var=0.08)
    # burlap sack head with stitched face
    b.ico(r=0.17, sub=1, loc=(0, 0, 1.66), scale=(1, 0.88, 1.08), color=burlap, jitter=0.012)
    b.cone(r=0.08, h=0.12, seg=5, loc=(0, 0.02, 1.82), color=burlap)
    for k in range(4):
        a = k * math.pi / 2
        sweep(b, [(0, 0.02, 1.9), (math.cos(a) * 0.08, 0.02 + math.sin(a) * 0.05, 1.99)], [0.02, 0.0], seg=3,
              color='straw')
    torus(b, (0, 0, 1.52), 0.1, 0.018, seg=7, seg2=3, color='rope', mat='base')
    dark = mix('coal', 'wood_dark', 0.4)
    for sx in (-1, 1):
        for d in (-1, 1):
            beam(b, (sx * 0.07 - 0.03, -0.155, 1.71 - d * 0.03), (sx * 0.07 + 0.03, -0.155, 1.71 + d * 0.03),
                 0.012, 0.012, color=dark, up=(0, -1, 0))
    for k in range(5):
        x = -0.06 + k * 0.03
        beam(b, (x, -0.16, 1.585), (x, -0.16, 1.62), 0.01, 0.01, color=dark)
    beam(b, (-0.07, -0.158, 1.602), (0.07, -0.158, 1.602), 0.008, 0.008, color=dark)
    # crow skull charm hanging from the right arm
    beam(b, (0.52, 0.0, 1.36), (0.52, -0.01, 1.14), 0.01, 0.01, color='rope')
    b.ico(r=0.045, sub=0, loc=(0.52, -0.01, 1.1), scale=(1, 1.2, 0.9), color='bone')
    sweep(b, [(0.52, -0.05, 1.1), (0.52, -0.13, 1.08)], [0.018, 0.0], seg=4, color='bone_dark')
    for dx in (-0.02, 0.02):
        b.box((0.012, 0.05, 0.1), loc=(0.52 + dx, -0.0, 1.0), rot=(0, dx * 300, 0), color='feather_blk')
    grass(b, (0, 0), 0.4, 3)
    return finish(b, 'scarecrow', col_r=0.2)


def fence_wood():
    b = Builder(seed=3008)
    wc = mix('wood_grey', 'wood', 0.45)
    for x in (-1.0, 1.0):
        sweep(b, [(x, 0, -0.1), (x + 0.01, 0.005, 1.0)], [0.075, 0.065], seg=6, color=BEAM, jitter=0.004)
        b.cone(r=0.065, h=0.07, seg=6, loc=(x + 0.01, 0.005, 1.0), color=BEAM)
    for z, sag in ((0.46, 0.02), (0.84, 0.03)):
        sweep(b, [(-1.08, 0.0, z), (0.0, 0.02, z - sag), (1.08, 0.0, z + 0.01)], 0.05, seg=5, color=wc,
              sy=0.65, jitter=0.004)
    return finish(b, 'fence_wood', col_box=(2.0, 0.2))


def rain_totem():
    b = Builder(seed=3010)
    st = StoneSlab(b, (0, 0.06, 0), 0.95, 0.44, 0.36, top=0.35, taper=0.12, levels=6, seg=8,
                   color=mix('stone', 'slate', 0.45), jitter=0.02)
    F = Frame(st.front(0.0, 0.0, 0.0), 0)
    rune_strokes(b, F, GLYPHS['laguz'], 0.02, 0.36, 0.4, 0.018, color=col('glow_blue', 0.85), width=0.055,
                 depth=0.02)
    for k in range(3):
        v = 0.2 + k * 0.05
        beam(b, st.front(-0.14, v, 0.004), st.front(0.14, v + 0.02 * (k % 2), 0.004), 0.018, 0.008,
             color=mix('stone_dark', 'blue_dark', 0.3), up=st.normal())
    b.lathe([(0.12, 0.0), (0.22, 0.05), (0.24, 0.16), (0.2, 0.16), (0.16, 0.1)], seg=9, loc=(0, -0.3, 0),
            color=stone_color(b.rng, 'stone'), jitter=0.006)
    b.cyl(0.18, h=0.02, seg=9, loc=(0, -0.3, 0.13), color=mix('blue', 'teal', 0.4), mat='metal')
    moss_ring(b, 0, 0.06, 0.26, n=5)
    return finish(b, 'rain_totem', col_r=0.3)


def banner():
    b = Builder(seed=3018)
    sweep(b, [(0, 0, -0.12), (0.0, 0.0, 1.4), (0.0, 0.0, 2.72)], [0.05, 0.045, 0.04], seg=6, color=BEAM)
    b.cone(r=0.05, h=0.2, seg=4, loc=(0, 0, 2.72), color='bronze', mat='metal')
    b.cyl(0.06, h=0.05, seg=6, loc=(0, 0, 2.68), color='bronze', mat='metal')
    log(b, (-0.5, 0.0, 2.55), (0.5, 0.0, 2.55), 0.028, seg=5, color=BEAM, end_color='bronze')
    cols = 7
    rings = []
    for i in range(cols + 1):
        x = -0.43 + 0.86 * i / cols
        zb = 1.2 + 0.28 * abs(x) / 0.43
        pts_f, pts_b = [], []
        for k in range(5):
            z = 2.52 - (2.52 - zb) * k / 4
            yw = 0.035 * math.sin(3.0 * x + 2.2 * z) * (0.3 + 0.7 * abs(x) / 0.43)
            pts_f.append((x, yw - 0.012, z))
            pts_b.append((x, yw + 0.012, z))
        rings.append(pts_f + list(reversed(pts_b)))
    fs, caps, bands = loft(b, rings, color='red_dark', closed=True, caps=True)
    for i, band in enumerate(bands):
        for j, f in enumerate(band):
            c = 'red_dark' if (i + j) % 3 else 'red'
            paint(b, [f], tone(c, 1.05), 0.05)
    for sy, yaw in ((-1, 0), (1, 180)):
        Fb = Frame((0, sy * 0.05, 0), yaw)
        emblem(b, Fb, RAVEN_SPREAD, 0.0, 1.95, 0.56, w0=0.0, depth=0.01, color='bone')
    Ft = Frame((0, -0.052, 0), 0)
    Ft.box(b, (0.84, 0.05, 0.012), (0.0, 2.44, 0.0), color='bone')
    Ft2 = Frame((0, 0.052, 0), 180)
    Ft2.box(b, (0.84, 0.05, 0.012), (0.0, 2.44, 0.0), color='bone')
    base_stones(b, 4, 0.12)
    return finish(b, 'banner', col_r=0.1)


def skull_pike():
    b = Builder(seed=3019)
    sweep(b, [(0, 0, -0.15), (0.03, 0.0, 0.7), (-0.01, 0.01, 1.35), (0.02, 0.0, 1.62)],
          [0.045, 0.042, 0.038, 0.03], seg=5, color=mix('wood_dark', 'wood_grey', 0.3), jitter=0.004)
    goat_skull(b, (0.02, -0.02, 1.62), s=1.3)
    for z in (1.36, 1.2):
        b.cyl(0.05, h=0.05, seg=5, loc=(0.0, 0.005, z), color='rope')
    for k, (dx, dy, ln, c) in enumerate(((-0.05, -0.02, 0.5, 'red_dark'), (0.05, 0.0, 0.42, 'wool'),
                                         (0.0, 0.05, 0.56, mix('blue_dark', 'wood_grey', 0.3)),
                                         (0.03, -0.05, 0.34, 'leather_dk'))):
        top = (dx * 0.6, dy * 0.6, 1.38)
        bot = (dx * 2.4 + b.rng.uniform(-0.03, 0.03), dy * 2.4, 1.38 - ln)
        beam(b, top, bot, 0.09, 0.008, color=tone(c, 0.85), up=(dx, dy, 0) if (dx or dy) else (1, 0, 0))
        for j in range(2):
            t = bot
            tip = (t[0] + b.rng.uniform(-0.02, 0.02) + (j - 0.5) * 0.04, t[1], t[2] - 0.08)
            sweep(b, [t, tip], [0.02, 0.0], seg=3, color=tone(c, 0.8))
    for dx in (-0.04, 0.05):
        sweep(b, [(dx, -0.03, 1.36), (dx * 2.2, -0.05, 1.18)], [0.02, 0.0], seg=3, color='feather_blk', sx=0.4)
    base_stones(b, 4, 0.12)
    return finish(b, 'skull_pike', col_r=0.1)


def flower_pot():
    b = Builder(seed=3020)
    terracotta = mix('rust', 'copper', 0.35)
    b.lathe([(0.12, 0.0), (0.17, 0.25), (0.205, 0.27), (0.205, 0.33), (0.17, 0.33), (0.16, 0.29)], seg=9,
            color=terracotta, var=0.06)
    b.cyl(0.165, h=0.012, seg=9, loc=(0, 0, 0.28), color='soil')
    for k in range(6):
        a = 2 * math.pi * k / 6 + b.rng.uniform(-0.2, 0.2)
        blades(b, (math.cos(a) * 0.07, math.sin(a) * 0.07, 0.28), h=b.rng.uniform(0.15, 0.24), r=0.035, n=2,
               color=b.rng.choice(('leaf', 'leaf_light', 'pine_light')), tilt=25, mat='leaves')
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        b.ico(r=0.055, sub=0, loc=(math.cos(a) * 0.08, math.sin(a) * 0.08, 0.4 + 0.03 * k),
              color=tone('leaf', 0.9), mat='leaves')
    for (x, y, c) in ((0.04, -0.05, 'flax'), (-0.07, 0.02, 'bone'), (0.02, 0.08, 'glow_purple')):
        flower(b, (x, y, 0.3), color=c, h=0.2, r=0.035)
    return finish(b, 'flower_pot')


def fish_shape(b, top, length=0.34, color='silver', yaw=0.0):
    """Fish hanging head-down from `top` (string included)."""
    x, y, z = top
    beam(b, (x, y, z), (x, y, z - 0.12), 0.01, 0.01, color='rope')
    a = math.radians(yaw)
    side = Vector((math.cos(a), math.sin(a), 0))
    t0 = Vector((x, y, z - 0.12))
    sweep(b, [t0, t0 - Vector((0, 0, length * 0.35)), t0 - Vector((0, 0, length * 0.8))],
          [length * 0.1, length * 0.14, length * 0.03], seg=5, color=color, sx=0.45, up=tuple(side), mat='metal')
    tail = t0 - Vector((0, 0, length * 0.8))
    pts = [(0.0, 0.0), (length * 0.12, -length * 0.18), (-length * 0.12, -length * 0.18)]
    ngon_prism(b, [((p[0]), (p[1])) for p in pts], 0.012,
               frame=Frame((tail.x, tail.y, tail.z), yaw), w0=-0.006, color=tone(color, 0.8))


def drying_rack():
    b = Builder(seed=3021)
    for x in (-0.9, 0.9):
        for sy in (-1, 1):
            sweep(b, [(x, sy * 0.38, -0.05), (x, -sy * 0.05, 1.72)], [0.04, 0.035], seg=5, color=BEAM)
        b.cyl(0.05, h=0.07, seg=5, loc=(x, 0, 1.58), color='rope')
    log(b, (-1.05, 0.0, 1.64), (1.05, 0.0, 1.66), 0.04, seg=6, color='wood_light', end_color='wood_light')
    log(b, (-0.9, 0.0, 0.95), (0.9, 0.0, 0.95), 0.03, seg=5, color=BEAM, end_color='wood_light')
    fish_cols = ('silver', mix('silver', 'blue', 0.35), mix('fur_brown', 'silver', 0.4), 'silver',
                 mix('silver', 'teal', 0.3), mix('fur_brown', 'silver', 0.5))
    for i, x in enumerate((-0.72, -0.44, -0.16, 0.12, 0.4, 0.68)):
        fish_shape(b, (x, 0.0, 1.61), length=0.34 + 0.06 * (i % 2), color=fish_cols[i], yaw=b.rng.uniform(-20, 20))
    for x in (-0.5, 0.25):
        beam(b, (x, 0.0, 0.93), (x + 0.02, 0.0, 0.62), 0.045, 0.012, color=mix('red_dark', 'leather', 0.5),
             up=(0, 1, 0))
    return finish(b, 'drying_rack', col_box=(2.0, 0.8))


def weapon_rack():
    b = Builder(seed=3022)
    for x in (-0.65, 0.65):
        b.box((0.09, 0.09, 1.5), loc=(x, 0.05, 0.73), color=BEAM, jitter=0.004)
        b.box((0.1, 0.4, 0.07), loc=(x, 0.05, 0.035), color=BEAM)
    b.box((1.45, 0.1, 0.08), loc=(0, 0.05, 1.3), color=BEAM)
    b.box((1.4, 0.3, 0.06), loc=(0, 0.02, 0.18), color=mix('wood', 'wood_light', 0.3))
    for (x, tip) in ((-0.42, 'iron'), (-0.18, 'iron'), (0.1, 'iron')):
        beam(b, (x, 0.02, 0.2), (x + 0.02, 0.1, 1.68), 0.035, 0.035, color='wood_light')
        b.cyl(0.028, h=0.06, seg=5, loc=(x + 0.02, 0.1, 1.66), color=IRON, mat='metal')
        sweep(b, [(x + 0.02, 0.1, 1.7), (x + 0.02, 0.105, 1.8), (x + 0.02, 0.11, 1.92)], [0.035, 0.045, 0.0],
              seg=4, color=tip, mat='metal', sx=0.3, up=(0, 1, 0))
    beam(b, (0.4, 0.0, 0.25), (0.42, 0.0, 1.25), 0.035, 0.035, color='wood_light')
    ngon_prism(b, [(0.0, 0.0), (0.16, 0.06), (0.2, -0.1), (0.14, -0.2), (0.0, -0.06)], 0.02,
               frame=Frame((0.42, 0.01, 1.2), 0), w0=-0.01, color='iron', mat='metal')
    shield(b, (0.5, -0.2, 0.45), Vector((0.2, -1.0, 0.3)).normalized(), r=0.38, colors=('blue', 'bone'),
           sectors=4, seg=8)
    return finish(b, 'weapon_rack', col_box=(1.6, 0.6))


def p_anvil():
    b = Builder(seed=3023)
    anvil_on_stump(b, 0.0, 0.0, rot=0.0, s=1.12)
    beam(b, (-0.12, -0.06, 0.73), (0.16, -0.02, 0.74), 0.03, 0.03, color='wood_light')
    b.box((0.07, 0.12, 0.07), loc=(-0.14, -0.06, 0.74), color=IRON, mat='metal')
    beam(b, (0.28, -0.12, 0.0), (0.2, -0.16, 0.5), 0.02, 0.02, color=IRON, mat='metal')
    beam(b, (0.31, -0.1, 0.0), (0.23, -0.14, 0.5), 0.02, 0.02, color=IRON, mat='metal')
    return finish(b, 'anvil', col_r=0.4)


def beehive():
    b = Builder(seed=3024)
    b.cyl(0.26, 0.28, h=0.4, seg=7, loc=(0, 0, -0.02), color='bark', jitter=0.01)
    b.cyl(0.25, h=0.02, seg=7, loc=(0, 0, 0.38), color='wood_light')
    prof = []
    n = 8
    for k in range(n + 1):
        t = k / n
        r = 0.3 * math.sqrt(max(0.0, 1.0 - t ** 1.6)) * (1.0 + 0.05 * (1 if k % 2 else -1))
        prof.append((max(0.0, r), 0.4 + 0.5 * t))
    prof[-1] = (0.0, 0.9)
    fs = b.lathe(prof, seg=10, color='straw', jitter=0.006)
    for f in fs:
        z = f.calc_center_median().z
        band = int((z - 0.4) / 0.0625)
        paint(b, [f], tone(mix('straw', 'thatch', 0.35 if band % 2 else 0.0), 1.0), 0.05)
    b.box((0.1, 0.06, 0.06), loc=(0, -0.28, 0.44), color=mix('coal', 'soil_wet', 0.5))
    for (x, y, z) in ((0.08, -0.38, 0.55), (-0.12, -0.34, 0.62)):
        b.ico(r=0.018, sub=0, loc=(x, y, z), scale=(1.4, 1, 1), color='mush_yellow')
    return finish(b, 'beehive', col_r=0.3)


def planter_box():
    b = Builder(seed=3025)
    W, D, H = 1.0, 0.5, 0.38
    wc = mix('wood', 'wood_light', 0.25)
    for k in range(2):
        z = 0.1 + k * 0.15
        for sy in (-1, 1):
            b.box((W - 0.06, 0.045, 0.14), loc=(0, sy * (D / 2 - 0.022), z), color=rvar(b.rng, wc, 0.08))
        for sx in (-1, 1):
            b.box((0.045, D - 0.06, 0.14), loc=(sx * (W / 2 - 0.022), 0, z), color=rvar(b.rng, wc, 0.08))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.07, 0.07, H + 0.04), loc=(sx * (W / 2 - 0.035), sy * (D / 2 - 0.035), (H + 0.04) / 2 - 0.02),
                  color=BEAM)
    b.box((W - 0.1, D - 0.1, 0.05), loc=(0, 0, H - 0.07), color='soil')
    for i in range(5):
        x = -0.36 + i * 0.18
        blades(b, (x, b.rng.uniform(-0.08, 0.08), H - 0.05), h=b.rng.uniform(0.18, 0.28), r=0.04, n=3,
               color=b.rng.choice(('leaf', 'leaf_light')), tilt=25, mat='leaves')
    for i in range(6):
        x = -0.4 + i * 0.16 + b.rng.uniform(-0.03, 0.03)
        flower(b, (x, b.rng.uniform(-0.12, 0.12), H - 0.05),
               color=b.rng.choice(('flax', 'bone', 'mush_yellow', 'turnip_top', 'berry_red')), h=b.rng.uniform(0.2, 0.3),
               r=0.045)
    return finish(b, 'planter_box', col_box=(1.0, 0.5))


def bed_roll():
    b = Builder(seed=3026)
    rings = []
    for i in range(7):
        y = -0.72 + 1.5 * i / 6
        ring = []
        for k in range(5):
            x = -0.4 + 0.8 * k / 4
            ring.append((x + b.rng.uniform(-0.02, 0.02), y + b.rng.uniform(-0.02, 0.02),
                         0.07 + 0.03 * math.sin(math.pi * k / 4) + b.rng.uniform(-0.01, 0.01)))
        bottom = [(p[0], p[1], 0.005) for p in reversed(ring)]
        rings.append(ring + bottom)
    fs, caps, bands = loft(b, rings, color='fur_brown', closed=True, caps=True, var=0.1)
    for band in bands:
        for j, f in enumerate(band):
            if j in (0, 3, 4, 8, 9):
                paint(b, [f], mix('fur_brown', 'fur_cream', 0.35), 0.08)
    log(b, (-0.42, -0.86, 0.13), (0.42, -0.86, 0.13), 0.13, seg=8, color=mix('wool', 'red', 0.2),
        end_color=mix('red_dark', 'wool', 0.3))
    for x in (-0.25, 0.25):
        b.lathe([(0.137, -0.02), (0.137, 0.02)], seg=8, loc=(x, -0.86, 0.13), rot=(0, 90, 0), color='leather',
                cap_bottom=False, cap_top=False)
    b.ico(r=0.22, sub=1, loc=(0.0, 0.68, 0.12), scale=(1.35, 0.8, 0.45), color='linen', jitter=0.01)
    return finish(b, 'bed_roll')


def signpost():
    b = Builder(seed=3027)
    wc = mix('wood_grey', 'wood', 0.4)
    sweep(b, [(0, 0, -0.12), (0.02, 0.0, 1.0), (0.0, 0.01, 2.0)], [0.07, 0.065, 0.06], seg=6, color=wc,
          jitter=0.004)
    b.cone(r=0.075, h=0.1, seg=4, loc=(0.0, 0.01, 2.0), rot=(0, 0, 45), color=BEAM)
    signs = ((1.78, -8.0, 0.78, 'wood_light'), (1.52, 186.0, 0.7, 'wood'), (1.26, 32.0, 0.62, 'wood_light'))
    dark = mix('wood_dark', 'coal', 0.3)
    for (h, yaw, ln, c) in signs:
        F = Frame((0.0, 0.0, 0.0), yaw)
        pts = [(0.04, h - 0.09), (ln - 0.12, h - 0.09), (ln, h), (ln - 0.12, h + 0.09), (0.04, h + 0.09)]
        ngon_prism(b, pts, 0.04, frame=F, w0=-0.075, color=tone(c, 0.9), jitter=0.004)
        for side in (-1, 1):
            wv = -0.075 + (0.042 if side < 0 else -0.002)
            for k in range(2):
                u0 = 0.12 + 0.03 * k
                F.box(b, (ln * 0.5 - 0.05 * k, 0.018, 0.006), (u0 + ln * 0.25, h + 0.03 - 0.06 * k, wv),
                      color=dark)
        F.box(b, (0.1, 0.1, 0.12), (0.03, h, -0.055), color=BEAM)
    beam(b, (0.0, 0.0, 1.95), (0.0, -0.26, 1.95), 0.025, 0.025, color=IRON, mat='metal')
    beam(b, (0.0, -0.26, 1.95), (0.0, -0.26, 1.86), 0.02, 0.02, color=IRON, mat='metal')
    beam(b, (0.0, -0.26, 1.86), (0.0, -0.21, 1.83), 0.02, 0.02, color=IRON, mat='metal')
    base_stones(b, 5, 0.16)
    grass(b, (0, 0), 0.5, 3, avoid=lambda x, y: x * x + y * y < 0.03)
    return finish(b, 'signpost', col_r=0.15)


ASSETS = [
    ('torch_standing', torch_standing),
    ('brazier', brazier),
    ('campfire', campfire),
    ('workbench', workbench),
    ('chest', chest),
    ('shipping_crate', shipping_crate),
    ('scarecrow', scarecrow),
    ('fence_wood', fence_wood),
    ('lantern_post', lantern_post),
    ('rain_totem', rain_totem),
    ('cauldron', cauldron),
    ('bench', bench),
    ('barrel', p_barrel),
    ('crate_stack', crate_stack),
    ('hay_bale', hay_bale),
    ('cart', cart),
    ('wood_pile', wood_pile),
    ('banner', banner),
    ('skull_pike', skull_pike),
    ('flower_pot', flower_pot),
    ('drying_rack', drying_rack),
    ('weapon_rack', weapon_rack),
    ('anvil', p_anvil),
    ('beehive', beehive),
    ('planter_box', planter_box),
    ('bed_roll', bed_roll),
    ('signpost', signpost),
]


def build(out_dir, only=None):
    reset_scene()
    roots = []
    for name, fn in ASSETS:
        if only and name not in only:
            continue
        root = fn()
        assert root.name == name, (root.name, name)
        roots.append(root)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'props.glb')
    export_glb(path, roots)
    fix_glb_names(path)
    for k, v in stats(roots).items():
        print(f'  {k:22s} {v:6d} tris')
    return roots


if __name__ == '__main__':
    # --only=a,b builds a subset; --out=DIR writes elsewhere (use it with --only so
    # the shipped .glb in assets/models always contains every asset).
    only, out = None, os.path.normpath(os.path.join(HERE, '..', 'assets', 'models'))
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = [s for s in a[len('--only='):].split(',') if s]
        elif a.startswith('--out='):
            out = a[len('--out='):]
    build(out, only)
