"""items_goods - raw materials, crops, seeds, berries, meat and misc items
for items.glb (see build_items.py)."""
import math

import bpy  # noqa: F401

import ghlib as G
from ghlib import hexc
from items_kit import (DEG, TAU, V, Body, Builder, Part, bumpy_ico, circle2d, clamp, finish, flat,
                       frame_from, frond2d, leaf3d, lerp, loft, paint, poly, ring, rot_all, slab,
                       star2d, to3d, tube_path)

C = {
    'wood_end': hexc('#b8925f'),
    'wood_ring': hexc('#9c7447'),
    'wood_split': hexc('#a07a50'),
    'flint': hexc('#4b4852'),
    'flint_hi': hexc('#6f6e7c'),
    'flint_dk': hexc('#302d35'),
    'cortex': hexc('#c9bfa6'),
    'copper': hexc('#c27440'),
    'copper_hi': hexc('#e0955a'),
    'iron_bar': hexc('#8d949c'),
    'iron_bar_dk': hexc('#6a7078'),
    'rust_vein': hexc('#8e4526'),
    'amber': hexc('#d08a24'),
    'amber_dk': hexc('#a0581a'),
    'amber_hi': hexc('#f0b848'),
    'fiber': hexc('#bdb083'),
    'fiber_dk': hexc('#9d9162'),
    'fiber_lt': hexc('#d6cb9c'),
    'glass': hexc('#a9c9cc'),
    'essence': hexc('#1f94c4'),
    'essence_hi': hexc('#62d4f2'),
    'essence_dk': hexc('#135f8a'),
    'char': hexc('#2e2a28'),
    'ash': hexc('#6a625c'),
    'coal_lt': hexc('#4b4b55'),
    'coal_md': hexc('#2c2c31'),
    'leather_lt': hexc('#8a5c38'),
    'leather_md': hexc('#6e4629'),
    'suede': hexc('#b08a64'),
    'feather': hexc('#2c2e38'),
    'feather_sheen': hexc('#3b4462'),
    'feather_purple': hexc('#3b3350'),
    'down': hexc('#77757e'),
}


def noise3(p, f=1.0, seed=0.0):
    """Cheap smooth-ish pseudo noise in [-1, 1]."""
    x, y, z = p.x * f + seed, p.y * f - seed * 0.7, p.z * f + seed * 1.3
    return (math.sin(x * 1.7 + math.cos(y * 2.3)) * math.cos(y * 1.9 - z * 1.3)
            + math.sin(z * 2.1 + x * 0.7)) * 0.5


# ---------------------------------------------------------------------------
# Raw materials
# ---------------------------------------------------------------------------
def _wedge(b, L, r, a0, a1, apex, x0=0.0, arc_pts=4):
    """Split-log wedge along +X: apex (y, z) is the heart, bark arc a0..a1 deg."""
    ay, az = apex
    outline = [(ay, az)]
    for i in range(arc_pts):
        a = (a0 + (a1 - a0) * i / (arc_pts - 1)) * DEG
        rr = r * (1.0 + b.rng.uniform(-0.05, 0.05))
        outline.append((ay + rr * math.cos(a), az + rr * math.sin(a)))
    with Part(b) as p:
        slab(b, [V((x0 + L * 0.5, y, z)) for (y, z) in outline], L, color='wood_light')
    for f in p.faces:
        n = f.normal
        c = f.calc_center_median()
        if abs(n.x) > 0.9:
            paint(b, [f], C['wood_end'], var=0.05)
        else:
            radial = V((0, c.y - ay, c.z - az))
            if radial.length > r * 0.6 and n.dot(radial.normalized()) > 0.6:
                paint(b, [f], 'bark', var=0.12)
            else:
                paint(b, [f], C['wood_split'], var=0.08)
    # growth-ring inset on both end-grain faces
    cy = sum(q[0] for q in outline) / len(outline)
    cz = sum(q[1] for q in outline) / len(outline)
    inner = [(cy + (y - cy) * 0.55, cz + (z - cz) * 0.55) for (y, z) in outline]
    for (x, d) in ((x0 + L + 0.0015, 1), (x0 - 0.0015, -1)):
        poly(b, [V((x, y, z)) for (y, z) in inner], C['wood_ring'], var=0.05, facing=(d, 0, 0))
    return p


def item_wood():
    b = Builder(seed=11)
    r = 0.085
    with Part(b) as bundle:
        # triangle-strip stack: two wedges heart-up, one heart-down in the valley
        _wedge(b, 0.38, r, 225, 315, (-0.064, r), x0=-0.2)
        _wedge(b, 0.36, r, 225, 315, (0.064, r), x0=-0.17)
        _wedge(b, 0.39, r * 1.02, 45, 135, (0.0, 0.034), x0=-0.2)
        # rope loops hugging the bundle outline (y, z)
        loop = [(0.0, 0.127), (0.07, 0.104), (0.124, 0.05), (0.126, 0.012), (0.06, 0.004),
                (-0.06, 0.004), (-0.126, 0.012), (-0.124, 0.05), (-0.07, 0.104), (0.0, 0.127)]
        for x in (-0.11, 0.07):
            tube_path(b, [V((x, y * 1.04, z * 1.02)) for (y, z) in loop], 0.0085, n=4,
                      color='rope', var=0.1, cap_start=False, cap_end=False)
        b.ico(r=0.02, sub=1, loc=(0.075, -0.06, 0.112), color='rope', var=0.1)
    bundle.xf(rot=(0, 0, -38))
    return finish(b, 'item_wood')


def item_stone():
    b = Builder(seed=12)
    b.rock(r=0.13, loc=(-0.05, 0.03, 0), scale=(1.15, 1.0, 0.8), color='stone', sub=2,
           jitter=0.018, var=0.1, sink=0.08)
    b.rock(r=0.085, loc=(0.12, -0.06, 0), scale=(1.1, 1.0, 0.85), color='stone_light', sub=2,
           jitter=0.014, var=0.1, sink=0.08)
    return finish(b, 'item_stone')


def item_flint():
    b = Builder(seed=13)
    # knapped blade-like shard along +X: flattened irregular hexagon sections to a sharp tip
    secs = [(-0.15, 0.036, 0.03), (-0.1, 0.058, 0.042), (-0.02, 0.066, 0.046), (0.06, 0.05, 0.036),
            (0.13, 0.024, 0.018)]
    rings = []
    for k, (x, w, h) in enumerate(secs):
        pts = []
        for i in range(6):
            a = TAU * i / 6 + 0.35 * k
            s_ = 1.0 + b.rng.uniform(-0.2, 0.15)
            pts.append(V((x + b.rng.uniform(-0.01, 0.01), w * s_ * math.cos(a),
                          h * s_ * math.sin(a))))
        rings.append(pts)
    rings.append([V((0.2, -0.01, 0.004))])
    with Part(b) as shard:
        loft(b, rings, color=C['flint'], var=0.08)
    tones = [C['flint'], C['flint_hi'], C['flint_dk'], hexc('#6f7384')]
    paint(b, shard.faces, lambda f: tones[b.rng.randrange(4)], var=0.06)
    paint(b, shard.faces, lambda f: C['cortex'] if f.calc_center_median().x < -0.13 else None,
          var=0.06)
    # glassy glints on a few upward facets
    paint(b, shard.faces, lambda f: (hexc('#9aa0b4'), 'metal') if f.normal.z > 0.6 and
          b.rng.random() < 0.5 else None, var=0.04)
    lo = min(v.co.z for v in shard.verts)
    shard.xf(loc=(0, 0, -lo))
    shard.xf(rot=(0, -16, 0), pivot=(-0.15, 0, 0.0))
    # a small flake beside it
    with Part(b) as fl:
        b.ico(r=0.05, sub=1, loc=(0.06, -0.13, 0.016), scale=(1.5, 1.0, 0.38), rot=(0, 0, 25),
              color=C['flint'], jitter=0.008, var=0.12)
    paint(b, fl.faces, lambda f: tones[b.rng.randrange(4)], var=0.05)
    rot_all(b, rot=(0, 0, 14))
    return finish(b, 'item_flint')


def _ore_rock(b, r, scale, base_col, jitter):
    with Part(b) as p:
        b.ico(r=r, sub=2, loc=(0, 0, r * scale[2] * 0.85), scale=scale, color=base_col,
              jitter=jitter, var=0.1, flatten_below=0.0)
    return p


def item_copper_ore():
    b = Builder(seed=14)
    rock = _ore_rock(b, 0.13, (1.15, 0.95, 0.8), 'stone', 0.02)
    paint(b, rock.faces, lambda f: ('copper_ore' if noise3(f.calc_center_median(), 22, 1.0) > 0.3
                                    else None), var=0.12)
    for (x, y, z, s) in [(-0.06, -0.08, 0.13, 0.034), (0.05, -0.09, 0.08, 0.03),
                         (0.1, -0.02, 0.14, 0.028), (-0.02, 0.0, 0.2, 0.032),
                         (-0.12, -0.02, 0.07, 0.024)]:
        b.ico(r=s, sub=1, loc=(x, y, z), color=C['copper_hi'], mat='metal', jitter=s * 0.2,
              var=0.1)
    for (x, y, z, rx, ry) in [(-0.1, -0.05, 0.12, -30, -20), (0.03, -0.1, 0.12, 40, -10)]:
        b.cone(r=0.022, h=0.07, seg=5, loc=(x, y, z), rot=(rx, ry, 0), color='copper_ore',
               var=0.1)
    return finish(b, 'item_copper_ore')


def item_iron_ore():
    b = Builder(seed=15)
    rock = _ore_rock(b, 0.14, (1.2, 0.95, 0.7), 'slate', 0.026)
    nv = V((0.5, -0.3, 0.8)).normalized()
    nv2 = V((-0.6, -0.2, 0.7)).normalized()

    def vein(f):
        c = f.calc_center_median() - V((0, 0, 0.09))
        if abs(c.dot(nv)) < 0.011 or abs(c.dot(nv2) - 0.02) < 0.009:
            return C['rust_vein']
        return 'iron_dark' if noise3(f.calc_center_median(), 20, 3.0) > 0.45 else None
    paint(b, rock.faces, vein, var=0.1)
    for (x, y, z, s, c) in [(-0.07, -0.09, 0.1, 0.03, 'rust'), (0.08, -0.07, 0.09, 0.026, 'rust'),
                            (0.02, -0.03, 0.17, 0.03, C['iron_bar']),
                            (-0.1, 0.0, 0.15, 0.022, C['iron_bar'])]:
        b.ico(r=s, sub=1, loc=(x, y, z), color=c, mat='metal', jitter=s * 0.25, var=0.12)
    return finish(b, 'item_iron_ore')


def _ingot(b, L, W, H, color, mark_col, hi_col, edge_col=None, side_col=None):
    def rrect(l, w, z, k=0.18):
        c = min(l, w) * k
        hl, hw = l / 2, w / 2
        pts = [(hl, -hw + c), (hl, hw - c), (hl - c, hw), (-hl + c, hw), (-hl, hw - c),
               (-hl, -hw + c), (-hl + c, -hw), (hl - c, -hw)]
        return [V((x, y, z)) for (x, y) in pts]
    rings = [rrect(L, W, 0.0), rrect(L * 0.97, W * 0.95, H * 0.62),
             rrect(L * 0.93, W * 0.88, H * 0.86), rrect(L * 0.86, W * 0.74, H)]
    with Part(b) as bar:
        loft(b, rings, color=color, mat='metal', var=0.06)

    def tone(f):
        c = f.calc_center_median()
        if f.normal.z > 0.9:
            return hi_col
        if c.z > H * 0.7:
            return edge_col or hi_col          # bright bevel catching the light
        return side_col                        # darker flanks
    paint(b, bar.faces, tone, var=0.05, mat='metal')
    pts = [V((x, y, H)) for (x, y) in [(-0.045, 0.0), (0.0, -0.024), (0.045, 0.0), (0.0, 0.024)]]
    slab(b, pts, 0.008, color=mark_col, mat='metal', var=0.04)
    return bar


def item_copper_bar():
    b = Builder(seed=16)
    _ingot(b, 0.30, 0.13, 0.075, C['copper'], G.col(C['copper'], 0.72), C['copper_hi'],
           edge_col=hexc('#f2b27a'), side_col=hexc('#9a5228'))
    rot_all(b, rot=(0, 0, 18))
    return finish(b, 'item_copper_bar', ao=0.15)


def item_iron_bar():
    b = Builder(seed=17)
    _ingot(b, 0.30, 0.13, 0.075, C['iron_bar'], C['iron_bar_dk'], G.col(C['iron_bar'], 1.1),
           edge_col=hexc('#c9ced4'), side_col=hexc('#646a72'))
    rot_all(b, rot=(0, 0, 18))
    return finish(b, 'item_iron_bar', ao=0.15)


def item_resin():
    b = Builder(seed=18)
    prof = [(0.0, 0.0), (0.06, 0.004), (0.085, 0.03), (0.08, 0.065), (0.055, 0.095),
            (0.028, 0.125), (0.0, 0.145)]
    with Part(b) as blob:
        b.lathe(prof, seg=9, color=C['amber'], mat='metal', jitter=0.006, var=0.1, smooth=True)
    blob.xf(rot=(0, 12, 0), scale=(1.1, 1.0, 1.0))
    paint(b, blob.faces, lambda f: C['amber_hi'] if f.normal.z > 0.5 and f.normal.x < 0.2
          else (C['amber_dk'] if f.normal.z < -0.1 else None), var=0.08, mat='metal')
    b.lathe([(0.0, 0.0), (0.035, 0.003), (0.045, 0.02), (0.03, 0.045), (0.0, 0.06)], seg=7,
            loc=(0.1, -0.07, 0), color=C['amber'], mat='metal', jitter=0.003, var=0.1, smooth=True)
    b.box(size=(0.07, 0.035, 0.012), loc=(-0.07, -0.02, 0.085), rot=(10, -50, 20),
          color='bark', var=0.1)
    return finish(b, 'item_resin')


def item_fiber():
    b = Builder(seed=19)
    rng = b.rng
    strands = 8
    with Part(b) as bundle:
        for k in range(strands):
            a = TAU * k / strands + rng.uniform(-0.25, 0.25)
            rr = 0.02 + rng.uniform(-0.004, 0.004)
            y0, z0 = math.cos(a) * rr, math.sin(a) * rr
            spread = 2.6 + rng.uniform(-0.4, 0.5)
            pts = []
            for x in (-0.21, -0.07, 0.07, 0.21):
                s = 1.0 + (abs(x) / 0.21) ** 1.4 * (spread - 1.0)
                pts.append((x + rng.uniform(-0.012, 0.012), y0 * s, z0 * s * 0.8))
            c = [C['fiber'], C['fiber_dk'], C['fiber_lt']][k % 3]
            tube_path(b, pts, [0.009, 0.011, 0.011, 0.008], n=3, flat=0.6, color=c, var=0.1)
        for (x, w) in ((-0.02, 0.04), (-0.13, 0.022)):
            b.cyl(r1=0.027, h=w, seg=7, loc=(x, 0, 0), rot=(0, 90, 0), color='rope', var=0.1)
    bundle.xf(rot=(0, 0, -20))
    rot_all(b, rot=(25, 0, 0))
    return finish(b, 'item_fiber')


def _bone(b, p0, p1, r=0.017, knob=0.028, color='bone'):
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0).normalized()
    side = d.cross(V((0, 0, 1))).normalized()
    with Part(b) as p:
        b.tube([p0, p0.lerp(p1, 0.5), p1], [r * 1.15, r * 0.9, r * 1.15], seg=6, color=color,
               var=0.06)
        for e, s in ((p0, -1), (p1, 1)):
            for k in (-1, 1):
                b.ico(r=knob, sub=1, loc=e + side * (k * knob * 0.75) + d * (s * knob * 0.35),
                      color=color, var=0.08)
    return p


def item_bone():
    b = Builder(seed=20)
    z = 0.03
    _bone(b, (-0.16, -0.1, z), (0.16, 0.1, z + 0.005))
    _bone(b, (-0.16, 0.1, z + 0.035), (0.16, -0.1, z + 0.035), color=G.col('bone', 0.95))
    rot_all(b, rot=(22, 0, 0))
    return finish(b, 'item_bone')


def item_gloam_essence():
    b = Builder(seed=21)
    body = [(0.0, 0.0), (0.05, 0.004), (0.075, 0.028), (0.08, 0.06), (0.068, 0.092),
            (0.04, 0.115), (0.024, 0.126)]
    with Part(b) as vial:
        b.lathe(body, seg=9, color=C['essence'], mat='emit', var=0.0)

    def swirl(f):
        c = f.calc_center_median()
        if c.z > 0.088:
            return (C['glass'], 'base')        # empty glass shoulder
        a = math.atan2(c.y, c.x)
        s = math.sin(a + c.z * 70.0)
        if s > 0.6:
            return (C['essence_hi'], 'emit')
        if s < -0.55:
            return (C['essence_dk'], 'emit')
        return (C['essence'], 'emit')
    paint(b, vial.faces, swirl, var=0.05)
    # glass neck + lip, cork, string
    b.lathe([(0.026, 0.12), (0.02, 0.13), (0.02, 0.165), (0.03, 0.17), (0.03, 0.18),
             (0.0, 0.18)], seg=7, color=C['glass'], var=0.05, cap_bottom=False)
    b.lathe([(0.018, 0.17), (0.024, 0.2), (0.022, 0.215), (0.0, 0.217)], seg=7,
            color='wood_light', var=0.08, cap_bottom=False)
    b.cyl(r1=0.025, h=0.012, seg=7, loc=(0, 0, 0.14), color='rope', cap=False)
    b.tube([(0.02, -0.015, 0.146), (0.045, -0.03, 0.12), (0.05, -0.035, 0.09)],
           [0.004, 0.004, 0.004], seg=4, color='rope')
    return finish(b, 'item_gloam_essence', ao=0.0)


def item_ember():
    b = Builder(seed=22)
    # glowing core showing through thin cracks between charred plates
    b.ico(r=0.085, sub=1, loc=(0, 0, 0.068), scale=(1.3, 1.05, 0.72), color='ember', mat='emit',
          var=0.1)
    plates = [(-0.075, -0.02, 0.085, 0.06), (0.03, -0.06, 0.1, 0.058), (0.085, 0.025, 0.08, 0.058),
              (-0.02, 0.05, 0.1, 0.058), (0.0, -0.005, 0.125, 0.05), (-0.08, 0.045, 0.05, 0.05),
              (0.075, -0.05, 0.045, 0.05), (-0.04, -0.07, 0.045, 0.05), (0.04, 0.06, 0.05, 0.048)]
    for (x, y, z, r) in plates:
        with Part(b) as pl:
            b.ico(r=r, sub=1, loc=(x, y, z), scale=(1.0, 1.0, 0.78), color=C['char'],
                  jitter=r * 0.18, var=0.12)
        paint(b, pl.faces, lambda f: C['ash'] if f.normal.z > 0.6 and b.rng.random() < 0.6
              else None, var=0.1)
    rot_all(b, rot=(0, 0, 10))
    return finish(b, 'item_ember', ao=0.1)


def item_leather():
    b = Builder(seed=23)
    # a tanned deer hide: stretched pelt outline with one hind leg folded over
    pelt = [(-0.22, 0.0), (-0.18, 0.045), (-0.14, 0.07), (-0.16, 0.13), (-0.12, 0.165),
            (-0.075, 0.105), (0.0, 0.1), (0.075, 0.11), (0.11, 0.13), (0.15, 0.175),
            (0.175, 0.1), (0.2, 0.04), (0.25, 0.0), (0.2, -0.04), (0.16, -0.09), (0.1, -0.1),
            (0.03, -0.1), (-0.075, -0.105), (-0.12, -0.165), (-0.16, -0.13), (-0.14, -0.07),
            (-0.18, -0.045)]
    t = 0.014
    pts = [V((x + b.rng.uniform(-0.005, 0.005), y + b.rng.uniform(-0.005, 0.005), t / 2))
           for (x, y) in pelt]
    slab(b, pts, t, color=C['leather_lt'], var=0.07, side=C['leather_md'])
    # lighter grain field inside a darker rim
    poly(b, [V((x * 0.72 + 0.01, y * 0.7, t + 0.0012)) for (x, y) in pelt], hexc('#96683f'),
         facing=(0, 0, 1), var=0.05)
    # hind-leg flap folded back over the hide along y = -0.1 (pale suede flesh side up)
    flap = [(0.03, -0.1), (0.1, -0.1), (0.16, -0.09), (0.2, -0.04), (0.14, 0.0), (0.06, -0.02)]
    slab(b, [V((x, -0.2 - y, t + 0.009)) for (x, y) in flap], 0.01, color=C['suede'], var=0.06,
         side=C['leather_md'])
    b.cyl(r1=0.009, h=0.17, seg=5, loc=(0.02, -0.1, 0.012), rot=(0, 90, 0), color=C['leather_md'],
          var=0.06)
    rot_all(b, rot=(24, 0, -8))
    return finish(b, 'item_leather')


def item_feather():
    b = Builder(seed=24)
    L = 0.42

    def spine(t):
        return V((lerp(-L / 2, L / 2, t), 0.06 * math.sin(math.pi * t) - 0.03 * t, 0.0))
    ts = [i / 6 for i in range(7)]
    tube_path(b, [spine(-0.08)] + [spine(t) for t in ts[1:-1]] + [spine(0.99)],
              [0.007, 0.0065, 0.006, 0.0055, 0.005, 0.004, 0.0015], n=4, color='bone', var=0.05)

    def width(t, side):
        w = 0.07 if side > 0 else 0.055
        return w * math.sin(math.pi * clamp((t - 0.06) / 0.97) ** 0.75) ** 0.6
    for side in (1, -1):
        for seg in range(3):
            t0, t1 = 0.08 + seg * 0.3, 0.08 + (seg + 1) * 0.3
            inner, outer = [], []
            for i in range(4):
                t = lerp(t0, t1, i / 3)
                p = spine(t)
                tang = (spine(min(1, t + 0.01)) - spine(max(0, t - 0.01))).normalized()
                nrm = V((-tang.y, tang.x, 0)) * side
                w = width(t, side)
                if seg == 1 and i == 1:
                    w *= 0.7  # split in the vane
                outer.append(p + nrm * w + tang * (0.5 * w) + V((0, 0, 0.001)))
                inner.append(p + V((0, 0, 0.0005)))
            outline = inner + list(reversed(outer))
            c = [C['feather'], C['feather_sheen'], C['feather_purple']][(seg + (side > 0)) % 3]
            flat(b, outline, color=c, var=0.08, back=C['feather'], facing=(0, 0, 1))
    b.ico(r=0.024, sub=1, loc=spine(0.07) + V((0.005, 0.014, 0.002)), scale=(1.5, 1.0, 0.4),
          color=C['down'], var=0.1)
    b.ico(r=0.02, sub=1, loc=spine(0.09) + V((0.0, -0.014, 0.002)), scale=(1.5, 1.0, 0.4),
          color=C['down'], var=0.1)
    rot_all(b, rot=(26, 0, 14))
    return finish(b, 'item_feather')


def item_coal():
    b = Builder(seed=25)
    for (x, y, z, r, s) in [(-0.07, 0.03, 0.0, 0.085, (1.2, 1.0, 0.85)),
                            (0.08, 0.02, 0.0, 0.075, (1.0, 1.1, 0.9)),
                            (0.0, -0.07, 0.0, 0.06, (1.1, 1.0, 0.9)),
                            (0.0, 0.03, 0.09, 0.07, (1.1, 1.0, 0.85))]:
        with Part(b) as lump:
            b.ico(r=r, sub=1, loc=(x, y, z + r * s[2] * 0.9), scale=s, color=C['coal_md'],
                  jitter=r * 0.22, var=0.15)
        paint(b, lump.faces, lambda f: (C['coal_lt'], 'metal') if b.rng.random() < 0.35 else None,
              var=0.1)
    return finish(b, 'item_coal')


MATERIALS = [item_wood, item_stone, item_flint, item_copper_ore, item_iron_ore, item_copper_bar,
             item_iron_bar, item_resin, item_fiber, item_bone, item_gloam_essence, item_ember,
             item_leather, item_feather, item_coal]


# ---------------------------------------------------------------------------
# Harvested crops (built upright along +Z, then laid on their side)
# ---------------------------------------------------------------------------
C.update({
    'turnip_mid': hexc('#b98fb0'),
    'carrot_dk': hexc('#b95e22'),
    'carrot_top': hexc('#5f8a36'),
    'onion_dk': hexc('#b3834a'),
    'onion_lt': hexc('#d6aa6c'),
    'onion_root': hexc('#d8cba8'),
    'shoot': hexc('#5d7f34'),
    'barley_dk': hexc('#a88a45'),
    'barley_lt': hexc('#dcc07a'),
    'pumpkin_dk': hexc('#b35f22'),
    'pumpkin_lt': hexc('#e38a3a'),
    'stem_olive': hexc('#5b5a2c'),
    'flax_petal': hexc('#8ea6dc'),
    'flax_dk': hexc('#6a82bc'),
    'flax_stem': hexc('#71803f'),
    'flax_eye': hexc('#e8d27a'),
    'berry_night': hexc('#2e1c44'),
    'night_leaf': hexc('#3e4a2c'),
    'night_stem': hexc('#4b3a4a'),
    'night_glint': hexc('#7a4ab0'),
    'beet_lt': hexc('#8e2446'),
    'beet_stem': hexc('#a02a48'),
    'beet_leaf': hexc('#3f6a2a'),
    'ice': hexc('#5fa9d6'),
    'ice_lt': hexc('#9fd6ee'),
    'ice_dk': hexc('#3d78aa'),
    'ice_glow': hexc('#1f6f96'),
    'frost_leaf': hexc('#dbe9e4'),
    'frost_leaf_dk': hexc('#a9c2bd'),
})


def _pose(b, tilt=62.0, yaw=-18.0, roll=0.0):
    """Lay an upright-built crop down: its top leans toward +X, then turn."""
    rot_all(b, rot=(roll, tilt, 0))
    rot_all(b, rot=(0, 0, yaw))


def _crown_leaves(b, top, count, length, width, color, back, lean=0.45, curl=-0.25, start=0.0,
                  outline=None, midrib=None, jit=10.0, lengths=None, fan=(200.0, 15.0)):
    """Leaves fanned between angles fan[0]..fan[1] around the crown (the crop is later
    laid down toward +X, so this keeps every leaf off the camera-facing side)."""
    for k in range(count):
        t = k / max(1, count - 1)
        a = (lerp(fan[0], fan[1], t) + b.rng.uniform(-jit, jit)) * DEG
        d = V((math.cos(a) * lean, math.sin(a) * lean, 1.0)).normalized()
        sd = V((-math.sin(a), math.cos(a), 0.0))
        ln = lengths[k] if lengths else length * b.rng.uniform(0.85, 1.1)
        leaf3d(b, V(top) + V((math.cos(a), math.sin(a), 0)) * 0.006, d, sd, ln, width,
               n=4, curl=curl, color=color, back=back, outline=outline and outline(ln),
               midrib=midrib)


def _turnip_leaf(L, W):
    # lobed leaf: long bare stalk, rounded lobes toward the tip
    return [(0.0, 0.0), (L * 0.25, -W * 0.08), (L * 0.35, -W * 0.3), (L * 0.5, -W * 0.25),
            (L * 0.62, -W * 0.48), (L * 0.8, -W * 0.4), (L, 0.0), (L * 0.82, W * 0.42),
            (L * 0.64, W * 0.5), (L * 0.5, W * 0.28), (L * 0.36, W * 0.32), (L * 0.25, W * 0.08)]


def item_turnip():
    b = Builder(seed=31)
    prof = [(0.0, 0.0), (0.014, 0.035), (0.048, 0.072), (0.085, 0.112), (0.094, 0.148),
            (0.078, 0.18), (0.04, 0.2), (0.0, 0.205)]
    with Part(b) as bulb:
        b.lathe(prof, seg=10, color='turnip', smooth=True, var=0.05)
    paint(b, bulb.faces, lambda f: ('turnip_top' if f.calc_center_median().z > 0.162 else
                                    C['turnip_mid'] if f.calc_center_median().z > 0.14 else None),
          var=0.06)
    tube_path(b, [(0, 0, 0.012), (0.004, 0.0, -0.035), (0.014, 0.0, -0.075)],
              [0.012, 0.006, 0.0], n=5, color='turnip', var=0.05)
    _crown_leaves(b, (0, 0, 0.198), 3, 0.22, 0.12, 'leaf_light', G.col('leaf_light', 0.85),
                  lean=0.5, curl=-0.2, outline=lambda L: _turnip_leaf(L, 0.12))
    _pose(b, tilt=64, yaw=-16)
    return finish(b, 'item_turnip')


def item_carrot():
    b = Builder(seed=32)
    prof = [(0.0, 0.0), (0.011, 0.05), (0.022, 0.11), (0.032, 0.17), (0.041, 0.225),
            (0.043, 0.25), (0.03, 0.268), (0.0, 0.272)]
    with Part(b) as root:
        b.lathe(prof, seg=7, color='carrot', var=0.05, jitter=0.002)
    ridges = [0.06, 0.13, 0.19]
    paint(b, root.faces, lambda f: C['carrot_dk'] if any(abs(f.calc_center_median().z - r) < 0.018
                                                          for r in ridges) else None, var=0.05)
    _crown_leaves(b, (0, 0, 0.265), 4, 0.2, 0.085, C['carrot_top'], G.col(C['carrot_top'], 0.85),
                  lean=0.35, curl=-0.15, outline=lambda L: frond2d(L, 0.085, 4))
    _pose(b, tilt=66, yaw=-20)
    return finish(b, 'item_carrot')


def item_onion():
    b = Builder(seed=33)
    prof = [(0.0, 0.0), (0.04, 0.004), (0.078, 0.035), (0.092, 0.075), (0.08, 0.115),
            (0.047, 0.145), (0.018, 0.168), (0.012, 0.19), (0.0, 0.196)]
    with Part(b) as bulb:
        b.lathe(prof, seg=10, color='onion', var=0.05, smooth=True)

    def stripes(f):
        c = f.calc_center_median()
        k = int(((math.atan2(c.y, c.x) / TAU) % 1.0) * 10)
        return C['onion_dk'] if k % 2 else (C['onion_lt'] if c.z > 0.07 else None)
    paint(b, bulb.faces, stripes, var=0.05)
    # root tuft under the bulb
    for k in range(5):
        a = (72 * k + 20) * DEG
        tube_path(b, [(0, 0, 0.006), (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.0),
                      (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.002)], [0.004, 0.003, 0.0015],
                  n=3, color=C['onion_root'], var=0.05)
    # two green shoots from the neck
    for (dx, dy, h) in ((0.05, -0.02, 0.18), (-0.035, 0.03, 0.14)):
        tube_path(b, [(0, 0, 0.185), (dx * 0.4, dy * 0.4, 0.185 + h * 0.6),
                      (dx, dy, 0.185 + h)], [0.009, 0.007, 0.0], n=4, color=C['shoot'],
                  var=0.06)
    rot_all(b, rot=(0, 14, -10))
    return finish(b, 'item_onion')


def _ear(b, p0, d, L, r, color, awn_col, awns=True):
    """Barley ear: a knobbly spindle along d with long awns."""
    d = V(d).normalized()
    pts = [V(p0) + d * (L * t) for t in (0.0, 0.25, 0.55, 0.8, 1.0)]
    with Part(b) as ear:
        tube_path(b, pts, [r * 0.6, r, r * 0.95, r * 0.7, 0.0], n=4, color=color, var=0.14)
    if awns:
        side = d.cross(V((0, 0, 1))).normalized()
        for (t, sgn) in ((0.3, 1), (0.45, -1), (0.62, 1), (0.78, -1), (0.95, 0)):
            base = V(p0) + d * (L * t) + side * (sgn * r * 0.6)
            tip = base + (d * 0.9 + side * (sgn * 0.35)).normalized() * (L * 0.75)
            w = side * 0.0025
            flat(b, [base - w, base + w, tip], color=awn_col, var=0.06)
    return ear


def item_barley():
    b = Builder(seed=34)
    rng = b.rng
    with Part(b) as sheaf:
        for k in range(5):
            spread = (k - 2) * 9.0 + rng.uniform(-3, 3)
            a = spread * DEG
            d = V((math.cos(a), math.sin(a), 0.0))
            base = V((-0.2, (k - 2) * 0.008, 0.012 + (k % 2) * 0.01))
            mid = V((-0.08, (k - 2) * 0.004, 0.02))
            head = mid + d * (0.12 + rng.uniform(-0.02, 0.02))
            tube_path(b, [base, mid, head], 0.0055, n=3, color='straw', var=0.08)
            _ear(b, head, d, 0.12, 0.017, ['barley', C['barley_lt'], C['barley_dk']][k % 3],
                 C['barley_lt'])
        b.cyl(r1=0.022, h=0.03, seg=7, loc=(-0.13, 0, 0.018), rot=(0, 90, 0),
              scale=(0.8, 1.3, 1.0), color=C['barley_dk'], var=0.1)
    rot_all(b, rot=(34, 0, -8))
    return finish(b, 'item_barley')


def item_pumpkin():
    b = Builder(seed=35)
    n = 14
    prof = [(0.0, 0.03), (0.095, 0.0), (0.16, 0.038), (0.178, 0.098), (0.158, 0.162),
            (0.098, 0.196), (0.036, 0.192), (0.0, 0.176)]
    rings = []
    for (r, z) in prof:
        rings.append(ring((0, 0, z), (1, 0, 0), (0, 1, 0), r, r, n,
                          wob=lambda i, a: 0.9 if i % 2 else 1.0))
    with Part(b) as body:
        loft(b, rings, color='pumpkin', var=0.05, smooth=True)

    def groove(f):
        c = f.calc_center_median()
        a = (math.atan2(c.y, c.x) / TAU) % 1.0 * n
        return C['pumpkin_dk'] if abs(a - round(a / 2) * 2 - 1) < 0.5 else C['pumpkin_lt']
    paint(b, body.faces, groove, var=0.04)
    tube_path(b, [(0, 0, 0.17), (0.006, 0.0, 0.215), (0.03, 0.004, 0.25), (0.05, 0.004, 0.255)],
              [0.024, 0.017, 0.014, 0.012], n=5, color=C['stem_olive'], var=0.08)
    tube_path(b, [(0.0, -0.02, 0.19), (-0.04, -0.05, 0.215), (-0.07, -0.03, 0.235),
                  (-0.06, 0.0, 0.25), (-0.04, -0.01, 0.245)], 0.0045, n=3, color='leaf',
              var=0.06, cap_start=False)
    leaf3d(b, (0.02, 0.02, 0.19), (0.3, 1.0, 0.2), (-1.0, 0.3, 0.0), 0.16, 0.14, n=4,
           curl=-0.15, color='leaf', back='leaf_dark', outline=[(0, 0), (0.03, -0.03),
           (0.05, -0.07), (0.09, -0.05), (0.11, -0.07), (0.16, 0.0), (0.11, 0.07), (0.09, 0.05),
           (0.05, 0.07), (0.03, 0.03)], midrib='leaf_light')
    rot_all(b, rot=(0, 0, -15))
    return finish(b, 'item_pumpkin')


def _flower5(b, center, facing, r, color, eye, rot=0.0):
    f = V(facing).normalized()
    u, v, _ = frame_from(f, up=(0, 0, 1))
    pts = to3d(star2d(r, r * 0.45, 5, start=90 + rot), center, u, v)
    flat(b, pts, color=color, var=0.08, back=C['flax_dk'], facing=f)
    poly(b, to3d(circle2d(r * 0.28, 5), center, u, v), eye, var=0.04, offset=0.0015, facing=f)


def item_flax():
    b = Builder(seed=36)
    rng = b.rng
    face = V((0.25, -0.75, 0.62))
    with Part(b) as bunch:
        for k in range(5):
            a = ((k - 2) * 11.0 + rng.uniform(-3, 3)) * DEG
            base = V((-0.19, (k - 2) * 0.007, 0.015))
            mid = V((-0.07, (k - 2) * 0.005, 0.02))
            ln = 0.2 + rng.uniform(-0.03, 0.02)
            top = mid + V((math.cos(a), math.sin(a), 0.1)).normalized() * ln
            tube_path(b, [base, mid, top], 0.0045, n=3, color=C['flax_stem'], var=0.08)
            _flower5(b, top + V((0.0, 0.0, 0.006)), face, 0.036, C['flax_petal'], C['flax_eye'],
                     rot=rng.uniform(0, 40))
            if k in (1, 3):
                bud = mid.lerp(top, 0.6)
                b.cone(r=0.009, h=0.03, seg=4, loc=bud, rot=(0, 60, math.degrees(a)),
                       color=C['flax_stem'], var=0.06)
        b.cyl(r1=0.02, h=0.026, seg=6, loc=(-0.12, 0, 0.018), rot=(0, 90, 0),
              scale=(0.8, 1.2, 1.0), color='straw', var=0.1)
    rot_all(b, rot=(30, 0, -10))
    return finish(b, 'item_flax')


def item_nightshade():
    b = Builder(seed=37)
    stem = [V((-0.16, 0.02, 0.02)), V((-0.06, 0.0, 0.05)), V((0.03, -0.01, 0.07)),
            V((0.09, 0.0, 0.06))]
    tube_path(b, stem, [0.007, 0.006, 0.005, 0.003], n=4, color=C['night_stem'], var=0.06)
    berries = [(0.05, -0.05, 0.035), (0.1, -0.03, 0.03), (0.075, 0.02, 0.04), (0.02, 0.0, 0.03),
               (0.12, 0.02, 0.028), (0.045, -0.015, 0.075)]
    face = V((0.25, -0.75, 0.62))
    for (x, y, r) in [(q[0], q[1], q[2]) for q in berries]:
        c = V((x, y, r if r < 0.07 else 0.07))
        rr = 0.036
        c = V((x, y, 0.036 if r < 0.07 else 0.084))
        tube_path(b, [c + V((0, 0, rr * 0.8)), stem[2].lerp(stem[3], 0.4)], 0.003, n=3,
                  color=C['night_stem'], var=0.05)
        b.ico(r=rr, sub=1, loc=c, color=C['berry_night'], mat='metal', smooth=True, var=0.06)
        poly(b, [c + p for p in to3d(star2d(0.014, 0.006, 5), (0, 0, rr * 0.93), (1, 0, 0),
                                       (0, 1, 0))], 'leaf', var=0.05, facing=(0, 0, 1))
        # tiny glint
        g = c + face.normalized() * rr * 1.01 + V((-0.008, 0, 0.008))
        u = V((0.9, 0.3, 0)).normalized() * 0.006
        v = face.cross(u).normalized() * 0.006
        poly(b, [g + u, g + v, g - u, g - v], C['night_glint'], mat='emit', var=0.0, facing=face)
    for (base, d, s, L) in [((-0.06, 0.0, 0.05), (-0.3, 1.0, 0.25), (1.0, 0.3, 0.0), 0.14),
                            ((-0.1, 0.01, 0.04), (-0.6, -1.0, 0.2), (1.0, -0.6, 0.0), 0.12)]:
        leaf3d(b, base, d, s, L, 0.07, n=4, curl=-0.1, color=C['night_leaf'], back='leaf_dark',
               midrib=C['night_stem'])
    rot_all(b, rot=(22, 0, -8))
    return finish(b, 'item_nightshade')


def item_beet():
    b = Builder(seed=38)
    prof = [(0.0, 0.0), (0.012, 0.04), (0.042, 0.075), (0.078, 0.105), (0.085, 0.14),
            (0.066, 0.172), (0.028, 0.186), (0.0, 0.19)]
    with Part(b) as bulb:
        b.lathe(prof, seg=9, color='beet', var=0.06, smooth=True)
    paint(b, bulb.faces, lambda f: C['beet_lt'] if f.normal.z > 0.3 else None, var=0.05)
    tube_path(b, [(0, 0, 0.01), (0.006, 0, -0.04), (0.02, 0, -0.085)], [0.011, 0.005, 0.0], n=4,
              color='beet', var=0.05)
    for k, a in enumerate((200, 110, 20)):
        ar = a * DEG
        base = V((0, 0, 0.184))
        d = V((math.cos(ar) * 0.35, math.sin(ar) * 0.35, 1.0)).normalized()
        sd = V((-math.sin(ar), math.cos(ar), 0))
        top = base + d * 0.07
        tube_path(b, [base, top], [0.007, 0.005], n=4, color=C['beet_stem'], var=0.05)
        leaf3d(b, top, d, sd, 0.17, 0.1, n=4, curl=-0.3, color=C['beet_leaf'],
               back=G.col(C['beet_leaf'], 0.85), midrib=C['beet_stem'])
    _pose(b, tilt=62, yaw=-14)
    return finish(b, 'item_beet')


def item_frostroot():
    b = Builder(seed=39)
    secs = [(0.0, 0.0), (0.016, 0.07), (0.032, 0.14), (0.048, 0.21), (0.056, 0.265), (0.044, 0.3),
            (0.0, 0.31)]
    rings = []
    for k, (r, z) in enumerate(secs):
        if r <= 0:
            rings.append([V((0, 0, z))])
        else:
            rings.append(ring((0, 0, z), (1, 0, 0), (0, 1, 0), r, r, 6, start=k * 0.52,
                              wob=lambda i, a: 1.0 + b.rng.uniform(-0.05, 0.08)))
    with Part(b) as root:
        loft(b, rings, color=C['ice'], var=0.07)
    glow = [0]

    def facet(f):
        c = f.calc_center_median()
        if c.z > 0.285:
            return hexc('#e6f4fa')
        r = b.rng.random()
        if r < 0.07 and glow[0] < 3:
            glow[0] += 1
            return (C['ice_glow'], 'emit')
        if r < 0.45:
            return C['ice_lt']
        if r < 0.62:
            return C['ice_dk']
        return None
    paint(b, root.faces, facet, var=0.05)
    # a few tiny crystal root hairs
    for (x, y, z, rx, ry) in [(0.026, -0.02, 0.12, -40, 50), (-0.022, -0.018, 0.07, 30, -50)]:
        b.cone(r=0.008, h=0.035, seg=4, loc=(x, y, z), rot=(rx, ry, 0), color=C['ice_dk'],
               var=0.06)
    _crown_leaves(b, (0, 0, 0.3), 4, 0.14, 0.05, C['frost_leaf'], C['frost_leaf_dk'], lean=0.4,
                  curl=-0.15)
    _pose(b, tilt=66, yaw=-20)
    return finish(b, 'item_frostroot')


def item_seeds():
    b = Builder(seed=40)
    prof = [(0.0, 0.0), (0.07, 0.006), (0.1, 0.04), (0.104, 0.085), (0.088, 0.125),
            (0.052, 0.152), (0.034, 0.163), (0.046, 0.18), (0.07, 0.208), (0.05, 0.2),
            (0.02, 0.185)]
    rings = []
    for k, (r, z) in enumerate(prof):
        gathered = k >= 7
        rings.append(ring((0, 0, z), (1, 0, 0), (0, 1, 0), r, r, 10,
                          wob=(lambda i, a: 0.72 if i % 2 else 1.12) if gathered else
                          (lambda i, a: 1.0 + b.rng.uniform(-0.04, 0.04))))
    with Part(b) as pouch:
        loft(b, rings, color='linen', var=0.05, smooth=False)
    # inside of the mouth is shadowed
    paint(b, pouch.faces, lambda f: (G.col('linen', 0.62) if f.calc_center_median().z > 0.19 and
                                     f.normal.z > 0.3 and abs(f.calc_center_median().x) < 0.045 and
                                     abs(f.calc_center_median().y) < 0.045
                                     else hexc('#e2dac8') if f.normal.z > 0.2 else None), var=0.05)
    # drawstring
    b.cyl(r1=0.04, h=0.014, seg=8, loc=(0, 0, 0.157), color='rope', cap=False, var=0.08)
    tube_path(b, [(0.03, -0.026, 0.163), (0.05, -0.05, 0.14), (0.055, -0.06, 0.1)], 0.0045, n=4,
              color='rope', var=0.08)
    tube_path(b, [(0.034, -0.02, 0.163), (0.07, -0.035, 0.15), (0.09, -0.04, 0.12)], 0.0045, n=4,
              color='rope', var=0.08)
    rot_all(b, rot=(0, 0, -20))
    return finish(b, 'item_seeds')


# ---------------------------------------------------------------------------
# Forage
# ---------------------------------------------------------------------------
C.update({
    'rasp_lt': hexc('#c9303a'),
    'rasp_dk': hexc('#85161f'),
    'blue_bloom': hexc('#5d6fae'),
    'blue_crown': hexc('#1d2340'),
    'hazel': hexc('#8a5a2e'),
    'hazel_dk': hexc('#6a4020'),
    'hazel_base': hexc('#d0b48a'),
    'husk': hexc('#7c8a44'),
    'cloud': hexc('#e0922e'),
    'cloud_lt': hexc('#f2b44c'),
    'cloud_dk': hexc('#c06a1e'),
})


def item_raspberry():
    b = Builder(seed=41)
    for (x, y, z, s) in [(-0.05, 0.03, 0.0, 1.0), (0.06, 0.02, 0.0, 0.95), (0.0, -0.05, 0.0, 0.9)]:
        r = 0.052 * s
        with Part(b) as berry:
            bumpy_ico(b, r, (x, y, z + r * 1.05), 'berry_red', bump=0.075, scale=(1, 1, 1.12),
                      var=0.1, smooth=True)
        paint(b, berry.faces, lambda f: (C['rasp_lt'] if b.rng.random() < 0.3 else
                                         C['rasp_dk'] if b.rng.random() < 0.2 else None), var=0.08)
    # leaf + twig
    leaf3d(b, (0.0, 0.07, 0.05), (0.2, 1.0, 0.25), (-1.0, 0.2, 0.0), 0.13, 0.075, n=4, curl=-0.1,
           color='leaf', back='leaf_dark', midrib='leaf_light',
           outline=[(0, 0), (0.02, -0.025), (0.04, -0.03), (0.06, -0.038), (0.08, -0.03),
                    (0.1, -0.025), (0.13, 0.0), (0.1, 0.025), (0.08, 0.03), (0.06, 0.038),
                    (0.04, 0.03), (0.02, 0.025)])
    tube_path(b, [(-0.05, 0.03, 0.11), (0.0, 0.05, 0.12), (0.06, 0.02, 0.105)], 0.005, n=4,
              color='leaf_dark', var=0.05)
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'item_raspberry')


def item_blueberry():
    b = Builder(seed=42)
    spots = [(-0.06, 0.02, 1.0), (0.0, 0.04, 1.05), (0.06, 0.015, 0.95), (-0.03, -0.045, 1.0),
             (0.035, -0.05, 0.92), (0.005, -0.0, 0.9)]
    face = V((0.25, -0.75, 0.62))
    for i, (x, y, s) in enumerate(spots):
        r = 0.036 * s
        z = r if i < 5 else r + 0.05
        c = V((x, y, z))
        with Part(b) as berry:
            b.sphere(r=r, seg=6, rings=4, loc=c, scale=(1, 1, 0.9), color='berry_blue',
                     smooth=True, var=0.05)
        paint(b, berry.faces, lambda f: C['blue_bloom'] if f.normal.z > 0.55 else None, var=0.06)
        # crown (calyx) on top, facing up
        poly(b, [c + p for p in to3d(star2d(0.013, 0.006, 5), (0, 0, r * 0.9), (1, 0, 0),
                                       (0, 1, 0))], C['blue_crown'], var=0.04,
             facing=(0, 0, 1))
    leaf3d(b, (0.02, 0.06, 0.03), (0.6, 1.0, 0.1), (-1.0, 0.6, 0.0), 0.12, 0.06, n=4,
           curl=-0.1, color='leaf', back='leaf_dark', midrib='leaf_light')
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'item_blueberry')


def _hazelnut(b, loc, rot, s=1.0):
    prof = [(0.0, 0.0), (0.042 * s, 0.006 * s), (0.053 * s, 0.035 * s), (0.043 * s, 0.068 * s),
            (0.014 * s, 0.09 * s), (0.0, 0.097 * s)]
    with Part(b) as nut:
        b.lathe(prof, seg=7, color=C['hazel'], var=0.05, smooth=True)

    def zone(f):
        c = f.calc_center_median()
        if c.z < 0.012 * s:
            return C['hazel_base']
        k = int(((math.atan2(c.y, c.x) / TAU) % 1.0) * 7)
        return C['hazel_dk'] if (k % 2 and c.z > 0.03 * s) else None
    paint(b, nut.faces, zone, var=0.05)
    nut.xf(loc=loc, rot=rot)
    return nut


def item_hazelnut():
    b = Builder(seed=43)
    _hazelnut(b, (-0.075, 0.03, 0.052), (0, -80, 20))
    _hazelnut(b, (0.08, 0.035, 0.05), (0, -90, 150), 0.95)
    _hazelnut(b, (0.0, -0.04, 0.0), (0, 0, 0), 1.05)
    # frilly leafy husk (involucre) around the upright nut: a jagged open cup
    n = 12
    c0 = V((0.0, -0.04, 0.0))
    rings = [ring(c0, (1, 0, 0), (0, 1, 0), 0.05, 0.05, n),
             ring(c0 + V((0, 0, 0.035)), (1, 0, 0), (0, 1, 0), 0.066, 0.066, n),
             ring(c0 + V((0, 0, 0.07)), (1, 0, 0), (0, 1, 0), 0.085, 0.085, n,
                  wob=lambda i, a: 1.3 if i % 2 else 0.8)]
    with Part(b) as husk:
        loft(b, rings, color=C['husk'], var=0.1, cap_start=True, cap_end=False)
    inner = [list(reversed([c0 + (p - c0) * 0.97 for p in rr])) for rr in rings[1:]]
    loft(b, inner, color='leaf_dark', var=0.06, cap_start=False, cap_end=False)
    paint(b, husk.faces, lambda f: 'leaf_light' if f.calc_center_median().z > 0.05 and
          b.rng.random() < 0.5 else None, var=0.08)
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'item_hazelnut')


def item_cloudberry():
    b = Builder(seed=44)
    r = 0.075
    with Part(b) as berry:
        bumpy_ico(b, r, (0, 0, r * 1.05 + 0.012), C['cloud'], bump=0.11, var=0.1, smooth=True)
    paint(b, berry.faces, lambda f: (C['cloud_lt'] if f.normal.z > 0.3 and b.rng.random() < 0.6
                                     else C['cloud_dk'] if f.normal.z < -0.3 else None), var=0.06)
    # green sepals under the berry
    flat(b, to3d(star2d(0.085, 0.03, 5, start=90), (0, 0, 0.014), (1, 0, 0), (0, 1, 0)),
         color='leaf', back='leaf_dark', var=0.08, facing=(0, 0, 1))
    tube_path(b, [(0, 0, 0.014), (0.04, 0.05, 0.02), (0.08, 0.1, 0.012)], 0.006, n=4,
              color='leaf_dark', var=0.05)
    # kidney-shaped lobed leaf behind
    outline = [(0.0, 0.0)] + [(0.1 * math.cos(a * DEG) + 0.1, 0.11 * math.sin(a * DEG))
                              for a in range(-150, 151, 30)]
    outline = [(x * (1.0 + (0.08 if i % 2 else 0.0)), y * (1.0 + (0.08 if i % 2 else 0.0)))
               for i, (x, y) in enumerate(outline)]
    leaf3d(b, (0.02, 0.07, 0.005), (0.2, 1.0, 0.12), (-1.0, 0.2, 0.0), 0.2, 0.2, curl=0.02,
           color='leaf', back='leaf_dark', outline=outline, midrib='leaf_light')
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'item_cloudberry')


CROPS = [item_turnip, item_carrot, item_onion, item_barley, item_pumpkin, item_flax,
         item_nightshade, item_beet, item_frostroot, item_seeds]
FORAGE = [item_raspberry, item_blueberry, item_hazelnut, item_cloudberry]


# ---------------------------------------------------------------------------
# Meat
# ---------------------------------------------------------------------------
C.update({
    'raw': hexc('#a8383c'), 'raw_dk': hexc('#7e2428'), 'raw_cut': hexc('#c8545a'),
    'raw_in': hexc('#9a2a32'), 'fat': hexc('#e8dccb'), 'fat_dk': hexc('#cdbca8'),
    'roast': hexc('#8e4a22'), 'roast_dk': hexc('#5e2e14'), 'roast_hi': hexc('#b8743a'),
    'roast_char': hexc('#3a2012'),
})


def _meat_bone(b, p0, p1, r=0.016, knob=0.022, color='bone'):
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0).normalized()
    side = d.cross(V((0, 0, 1))).normalized()
    tube_path(b, [p0, p1], [r, r * 0.9], n=6, color=color, var=0.05, cap_start=False)
    for k in (-1, 1):
        b.ico(r=knob, sub=1, loc=p1 + side * (k * knob * 0.7) + d * (knob * 0.3), color=color,
              var=0.06)


def item_meat_raw():
    b = Builder(seed=121)
    body = Body([(0.0, 0.0, 0.07, 0.066), (0.05, 0.004, 0.084, 0.078), (0.12, 0.004, 0.072, 0.066),
                 (0.19, 0.002, 0.046, 0.042), (0.235, 0.0, 0.026, 0.025)], n=8)
    faces = body.build(b, color=C['raw'], var=0.08)

    def zone(f):
        c = f.calc_center_median()
        if c.x < 0.002 and f.normal.x < -0.9:
            return C['fat']          # cut face rim (fat ring), muscle added on top below
        zc, h, w = body.params(c.x)
        rel = (c.z - zc) / max(h, 1e-6)
        if rel > 0.5:
            return C['fat'] if b.rng.random() < 0.8 else C['fat_dk']
        if b.rng.random() < 0.15:
            return C['raw_dk']
        return None
    paint(b, faces, zone, var=0.06)
    # cut face: red muscle inside the fat rim + the bone core
    poly(b, [V((-0.0015, 0.066 * 0.8 * math.cos(a), 0.07 * 0.8 * math.sin(a) - 0.006))
             for a in [TAU * i / 8 for i in range(8)]], C['raw_cut'], facing=(-1, 0, 0))
    poly(b, [V((-0.003, 0.03 * math.cos(a) + 0.012, 0.03 * math.sin(a) - 0.02))
             for a in [TAU * i / 6 for i in range(6)]], C['raw_in'], facing=(-1, 0, 0))
    poly(b, [V((-0.0045, 0.014 * math.cos(a) - 0.01, 0.014 * math.sin(a) + 0.008))
             for a in [TAU * i / 6 for i in range(6)]], 'bone', facing=(-1, 0, 0))
    _meat_bone(b, (0.2, 0.0, 0.0), (0.31, 0.0, 0.004))
    rot_all(b, rot=(-20, 0, 0))
    rot_all(b, rot=(0, 0, 48))
    return finish(b, 'item_meat_raw', ao=0.15)


def food_cooked_meat():
    b = Builder(seed=122)
    body = Body([(0.0, 0.0, 0.0, 0.0), (0.025, 0.004, 0.06, 0.058), (0.08, 0.008, 0.088, 0.082),
                 (0.15, 0.006, 0.082, 0.076), (0.21, 0.003, 0.055, 0.052),
                 (0.245, 0.0, 0.03, 0.03)],
                n=9)
    faces = body.build(b, color=C['roast'], var=0.08, jitter=0.0)
    for v in sorted({v for f in faces for v in f.verts}, key=lambda v: tuple(v.co)):
        v.co += V((0, b.rng.uniform(-0.004, 0.004), b.rng.uniform(-0.004, 0.004)))

    def glaze(f):
        c = f.calc_center_median()
        if f.normal.z > 0.55:
            return C['roast_hi'] if b.rng.random() < 0.6 else C['roast']
        if f.normal.z < -0.3:
            return C['roast_dk']
        return C['roast_char'] if b.rng.random() < 0.12 else None
    paint(b, faces, glaze, var=0.06)
    # grill marks
    for t in (0.07, 0.12, 0.17):
        body.band(b, t - 0.005, t + 0.005, 60, 125, C['roast_char'])
    # the bone runs right through: knobs at both ends
    _meat_bone(b, (0.21, 0.0, 0.0), (0.33, 0.0, 0.006))
    _meat_bone(b, (0.03, 0.0, 0.0), (-0.05, 0.0, -0.004))
    rot_all(b, rot=(-26, 0, 0))
    rot_all(b, rot=(0, 0, 22))
    return finish(b, 'food_cooked_meat', ao=0.15)


MEAT = [item_meat_raw, food_cooked_meat]


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
C.update({
    'gold': hexc('#dba645'), 'gold_hi': hexc('#f2c862'), 'gold_dk': hexc('#a8762a'),
    'paper': hexc('#ddd0ae'), 'paper_dk': hexc('#c2b28c'), 'paper_lt': hexc('#e8dec2'),
    'wax': hexc('#8e1c1c'), 'wax_dk': hexc('#6a1212'), 'twine': hexc('#8b7650'),
    'antler': hexc('#bdb4a2'), 'antler_dk': hexc('#8c8476'), 'antler_burr': hexc('#6a6358'),
    'vein': hexc('#3fb8e0'), 'vein_hi': hexc('#8fe6ff'),
})


def _coin_stack(b, x, y, count, r=0.045, t=0.013, lean=0.0):
    rings = []
    z = 0.0
    for k in range(count + 1):
        dx = b.rng.uniform(-0.004, 0.004) + lean * k
        dy = b.rng.uniform(-0.004, 0.004)
        rings.append(ring((x + dx, y + dy, z), (1, 0, 0), (0, 1, 0), r, r, 9))
        z += t
    with Part(b) as st:
        loft(b, rings, color=C['gold'], mat='metal', var=0.05)
    paint(b, st.faces, lambda f: C['gold_hi'] if f.normal.z > 0.9 else
          (C['gold_dk'] if int(f.calc_center_median().z / t) % 2 else None), var=0.05,
          mat='metal')
    top = rings[-1]
    c = sum(top, V((0, 0, 0))) / len(top)
    poly(b, [c + V((px, py, 0.0012)) for (px, py) in star2d(0.02, 0.009, 4, start=45)],
         C['gold_dk'], mat='metal', facing=(0, 0, 1))
    return st


def item_coins():
    b = Builder(seed=131)
    _coin_stack(b, -0.045, 0.03, 5)
    _coin_stack(b, 0.05, 0.045, 3, lean=0.002)
    for (x, y, rx, ry, rz) in ((0.02, -0.06, 8, -12, 0), (-0.08, -0.05, -20, 30, 0),
                               (0.1, -0.02, 30, 10, 0)):
        with Part(b) as c:
            b.cyl(r1=0.045, h=0.013, seg=9, color=C['gold'], mat='metal', var=0.05)
            poly(b, [V((px, py, 0.0142)) for (px, py) in star2d(0.02, 0.009, 4, start=45)],
                 C['gold_dk'], mat='metal', facing=(0, 0, 1))
        paint(b, c.faces, lambda f: C['gold_hi'] if f.normal.z > 0.9 else None, var=0.04,
              mat='metal')
        lift = 0.045 * abs(math.sin(max(abs(rx), abs(ry)) * DEG))
        c.xf(loc=(x, y, lift), rot=(rx, ry, rz))
    rot_all(b, rot=(0, 0, 10))
    return finish(b, 'item_coins', ao=0.15)


def item_letter():
    b = Builder(seed=132)
    W, H, T = 0.3, 0.2, 0.012
    with Part(b) as env:
        b.box(size=(W, H, T), loc=(0, 0, T / 2), color=C['paper'], var=0.05, bevel=0.003)
    z = T + 0.0012
    # envelope flaps on the upper face: side flaps + the pointed top flap
    poly(b, [V((-W / 2 + 0.004, -H / 2 + 0.004, z)), V((0.0, 0.0, z)),
             V((-W / 2 + 0.004, H / 2 - 0.004, z))], C['paper_dk'], facing=(0, 0, 1))
    poly(b, [V((W / 2 - 0.004, H / 2 - 0.004, z)), V((0.0, 0.0, z)),
             V((W / 2 - 0.004, -H / 2 + 0.004, z))], C['paper_dk'], facing=(0, 0, 1))
    poly(b, [V((-W / 2 + 0.004, H / 2 - 0.004, z + 0.0008)), V((0.0, -0.02, z + 0.0008)),
             V((W / 2 - 0.004, H / 2 - 0.004, z + 0.0008))], C['paper_lt'], facing=(0, 0, 1))
    # twine around it both ways
    for (sx, sy, lx, ly) in ((0.012, H + 0.004, 0.07, 0.0), (W + 0.004, 0.012, 0.0, 0.05)):
        b.box(size=(sx, sy, T + 0.006), loc=(lx, ly, T / 2), color=C['twine'], var=0.08)
    # wax seal where the flap meets
    with Part(b) as seal:
        b.cyl(r1=0.034, r2=0.03, h=0.01, seg=9, loc=(0.0, -0.02, z + 0.002), color=C['wax'],
              var=0.06)
    poly(b, [V((px, py - 0.02, z + 0.0132)) for (px, py) in star2d(0.018, 0.008, 5)],
         C['wax_dk'], facing=(0, 0, 1))
    b.ico(r=0.012, sub=1, loc=(0.034, -0.035, z + 0.003), scale=(1.4, 1.0, 0.4), color=C['wax'],
          var=0.05)
    rot_all(b, rot=(26, 0, 10))
    return finish(b, 'item_letter', ao=0.1)


def item_trophy_stag():
    b = Builder(seed=133)
    # Ashhorn's shed antler, standing in the XZ plane (faces the camera), leaned back
    beam = [V((-0.2, 0.0, 0.03)), V((-0.11, 0.0, 0.06)), V((-0.02, 0.0, 0.1)),
            V((0.07, 0.0, 0.17)), V((0.13, 0.0, 0.27)), V((0.15, 0.0, 0.38)), V((0.2, 0.0, 0.47))]
    rad = [0.04, 0.036, 0.031, 0.027, 0.023, 0.018, 0.0]
    with Part(b) as bm_:
        tube_path(b, beam, rad, n=6, color=C['antler'], var=0.07)
    paint(b, bm_.faces, lambda f: C['antler_dk'] if f.normal.x > 0.6 else None, var=0.06)
    tines = [(1, (-0.95, -0.15, 0.45), 0.14, (0.2, 0.0, 0.5)),
             (2, (-0.7, 0.05, 1.0), 0.18, (0.3, 0.0, 0.3)),
             (3, (-0.35, -0.05, 1.0), 0.2, (0.25, 0.0, 0.2)),
             (5, (-0.8, 0.0, 1.0), 0.11, (0.3, 0.0, 0.2))]
    for (i, d, ln, bend) in tines:
        d = V(d).normalized()
        p0 = beam[i]
        p1 = p0 + d * (ln * 0.55)
        p2 = p1 + (d + V(bend)).normalized() * (ln * 0.45)
        with Part(b) as tp:
            tube_path(b, [p0, p1, p2], [rad[i] * 0.85, rad[i] * 0.55, 0.0], n=5,
                      color=C['antler'], var=0.07)
        paint(b, tp.faces, lambda f: (C['vein_hi'], 'emit') if (f.calc_center_median() - p2).length
              < ln * 0.22 else None, var=0.03)
    # rough burr at the base
    b.ico(r=0.052, sub=1, loc=(-0.205, 0.0, 0.035), scale=(0.55, 1.0, 1.0), rot=(0, -30, 0),
          color=C['antler_burr'], jitter=0.007, var=0.1)
    # thin glowing zig-zag vein running up the camera-side facet of the beam (and the back)
    for s in (-1, 1):
        pts = []
        for i in range(len(beam) - 1):
            t = (beam[min(i + 1, len(beam) - 1)] - beam[max(i - 1, 0)]).normalized()
            v = V((0, 0, 1)) - t * t.z
            v.normalize()
            zig = (0.28 if i % 2 else -0.28) * rad[i]
            pts.append(beam[i] + V((0, s, 0)) * (0.87 * rad[i] + 0.0016) + v * zig)
        pts.append(beam[-1] + (beam[-2] - beam[-1]) * 0.25 + V((0, s * 0.006, 0)))
        for i in range(len(pts) - 1):
            a, c = pts[i], pts[i + 1]
            d = (c - a).normalized()
            w = d.cross(V((0, 1, 0))).normalized() * 0.0028
            poly(b, [a - w, a + w, c + w * 0.8, c - w * 0.8], C['vein'], mat='emit', var=0.0,
                 facing=(0, s, 0))
    rot_all(b, rot=(-34, 0, 12))
    return finish(b, 'item_trophy_stag', ao=0.12)


MISC = [item_coins, item_letter, item_trophy_stag]
