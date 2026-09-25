"""items_gear - relics, tools and food for items.glb (see build_items.py).

Tools follow the hand-held convention: origin exactly at the grip point,
handle along +Z, working end at the top, blade / head facing -Y.
"""
import math

import bpy  # noqa: F401

import ghlib as G
from ghlib import hexc
from items_kit import (DEG, TAU, V, Body, Builder, Part, circle2d, finish, flat, lerp, loft,
                       paint, poly, ring, rot_all, slab, tube_path)

R = {
    # relics
    'silver': hexc('#868c8e'), 'tarnish': hexc('#4f5654'), 'patina': hexc('#5f7e6a'),
    'silver_hi': hexc('#aab0b2'),
    'bone': hexc('#dcd2b9'), 'bone_old': hexc('#b9ab8b'), 'carve': hexc('#6a5a44'),
    'rivet': hexc('#6f5a3a'),
    'tablet': hexc('#7b7f80'), 'tablet_dk': hexc('#5d6264'), 'rune': hexc('#4fc6ec'),
    'bronze': hexc('#b07a3a'), 'bronze_hi': hexc('#d6a55c'), 'bronze_dk': hexc('#7e5426'),
    'verdigris': hexc('#5f9a82'),
    'horn_tip': hexc('#3b2e25'), 'horn_mid': hexc('#8a6a4a'), 'horn_mouth': hexc('#d1b88e'),
    'horn_in': hexc('#2a1e18'),
    'iron': hexc('#6d7278'), 'iron_dk': hexc('#44484c'), 'rust': hexc('#8a4e2a'),
    'rust_lt': hexc('#a8683a'), 'gem': hexc('#8a1f28'),
    'amber': hexc('#d38a26'), 'amber_lt': hexc('#eaae44'), 'amber_dk': hexc('#a85e18'),
    'cord': hexc('#5a4632'),
    'idol': hexc('#8e6c48'), 'idol_dk': hexc('#5e4530'), 'idol_lt': hexc('#a8845a'),
    # tools
    'handle': hexc('#8a6a47'), 'handle_dk': hexc('#6b4d33'), 'wrap': hexc('#4a2f1c'),
    'steel': hexc('#9aa0a6'), 'steel_hi': hexc('#cdd2d6'), 'steel_dk': hexc('#5d6268'),
    'copper': hexc('#b8703c'), 'tin': hexc('#8a958f'), 'net': hexc('#d8cdb0'),
    'cork': hexc('#b89060'), 'thread': hexc('#9a2a24'), 'line': hexc('#e0dccc'),
    # food
    'bowl': hexc('#8a6440'), 'bowl_dk': hexc('#5e4228'), 'bowl_in': hexc('#6f4f32'),
    'stew': hexc('#6e3f1f'), 'stew_lt': hexc('#8a5428'), 'potato': hexc('#d8c38a'),
    'carrot': hexc('#d9782d'), 'meat': hexc('#6a3a24'), 'herb': hexc('#5f8a36'),
    'crust': hexc('#6d4526'), 'crust_lt': hexc('#9c6a3a'), 'score': hexc('#c8975e'),
    'flour': hexc('#d8ccb4'),
    'grill': hexc('#b07636'), 'grill_dk': hexc('#6a3e1c'), 'char': hexc('#2e2016'),
    'pie_crust': hexc('#c9924a'), 'pie_crust_dk': hexc('#9a6630'), 'filling': hexc('#5e1a3a'),
    'filling_lt': hexc('#8a2a4c'), 'dish': hexc('#8a5a3a'),
    'plate': hexc('#7a5a3a'), 'roast_c': hexc('#c8642a'), 'roast_t': hexc('#d8b880'),
    'roast_b': hexc('#6d1830'), 'roast_char': hexc('#5a3218'),
    'mush_cap': hexc('#8a4a2a'), 'mush_cap_lt': hexc('#a8603a'), 'mush_stem': hexc('#dccfb2'),
    'stick': hexc('#8a6a47'),
    'tankard': hexc('#8e6a44'), 'tankard_dk': hexc('#6c4e30'), 'foam': hexc('#efe6cf'),
    'foam_dk': hexc('#d6c8a6'), 'mead': hexc('#c98a2a'),
    'porridge': hexc('#d9c7a0'), 'porridge_dk': hexc('#bba67c'), 'honey': hexc('#d99a2a'),
    'butter': hexc('#ecd57a'), 'berry_red': hexc('#a3202a'), 'berry_blue': hexc('#3a4a9a'),
}


# ---------------------------------------------------------------------------
# Relics
# ---------------------------------------------------------------------------
def relic_coin():
    b = Builder(seed=81)
    ro, rr, hs, t = 0.13, 0.108, 0.034, 0.026
    n = 12
    bm = b.bm

    def ang(i):
        return (15 + 30 * i) * DEG
    # coin in the XZ plane (faces -Y / +Y) with a square hole; rim ring raised
    sides = []
    for y in (-t / 2, t / 2):
        inset = 0.004 if y < 0 else -0.004
        outer = [bm.verts.new(V((ro * math.cos(ang(i)), y, ro * math.sin(ang(i)))))
                 for i in range(n)]
        rim = [bm.verts.new(V((rr * math.cos(ang(i)), y + inset, rr * math.sin(ang(i)))))
               for i in range(n)]
        sq = [bm.verts.new(V((hs * math.copysign(1, math.cos((45 + 90 * k) * DEG)), y + inset,
                              hs * math.copysign(1, math.sin((45 + 90 * k) * DEG)))))
              for k in range(4)]
        sides.append((outer, rim, sq))
    faces = []
    for si, (outer, rim, sq) in enumerate(sides):
        quads = []
        for i in range(n):
            j = (i + 1) % n
            quads.append((outer[i], outer[j], rim[j], rim[i]))
        for k in range(4):
            i0 = 3 * k
            quads += [(rim[i0], rim[i0 + 1], sq[k]), (rim[i0 + 1], rim[i0 + 2], sq[k]),
                      (rim[i0 + 2], rim[(i0 + 3) % n], sq[(k + 1) % 4], sq[k])]
        for q in quads:
            faces.append(bm.faces.new(q if si == 0 else tuple(reversed(q))))
    (of, _, sf), (ob, _, sb) = sides
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((of[j], of[i], ob[i], ob[j])))
    for k in range(4):
        m = (k + 1) % 4
        faces.append(bm.faces.new((sf[k], sf[m], sb[m], sb[k])))
    allv = [v for side in sides for lst in side for v in lst]
    b._finish(allv, R['silver'], 'metal', 0.0, 0.08)
    paint(b, faces, lambda f: (R['tarnish'] if b.rng.random() < 0.35 else
                               R['patina'] if b.rng.random() < 0.25 else
                               R['silver_hi'] if b.rng.random() < 0.15 else None),
          var=0.06, mat='metal')
    # stamped marks around the hole on both faces
    for s_ in (-1, 1):
        y = s_ * (t / 2 - 0.004 - 0.0012)
        for k in range(4):
            a = (90 * k) * DEG
            c = V((0.068 * math.cos(a), y, 0.068 * math.sin(a)))
            u = V((math.cos(a + math.pi / 2), 0, math.sin(a + math.pi / 2)))
            r_ = V((math.cos(a), 0, math.sin(a)))
            pts = [c - u * 0.018 - r_ * 0.005, c + u * 0.018 - r_ * 0.005,
                   c + u * 0.012 + r_ * 0.01, c - u * 0.012 + r_ * 0.01]
            poly(b, pts, R['tarnish'], mat='metal', facing=(0, s_, 0))
    rot_all(b, rot=(-38, 0, 12))
    return finish(b, 'relic_coin', ao=0.1)


def relic_comb():
    b = Builder(seed=82)
    L, H, T = 0.32, 0.05, 0.022
    teeth = 11
    tooth_len = 0.055
    outline = []
    # arched top from right to left
    for k in range(7):
        t = k / 6
        x = lerp(L / 2, -L / 2, t)
        outline.append((x, H + 0.018 * math.sin(math.pi * t)))
    # teeth along the bottom from left to right
    pitch = L / teeth
    for k in range(teeth):
        x0 = -L / 2 + k * pitch
        ln = tooth_len * (0.45 if k in (3, 8) else 1.0)
        outline += [(x0 + pitch * 0.12, 0.0), (x0 + pitch * 0.2, -ln), (x0 + pitch * 0.72, -ln),
                    (x0 + pitch * 0.82, 0.0)]
    with Part(b) as comb:
        slab(b, [V((x, 0.0, z)) for (x, z) in outline], T, color=R['bone'], var=0.06,
             side=R['bone_old'])
    paint(b, comb.faces, lambda f: R['bone_old'] if f.calc_center_median().z < -0.035 else None,
          var=0.05)
    # riveted side plates (the decorated spine) on both faces
    for s in (-1, 1):
        y = s * (T / 2 + 0.004)
        with Part(b) as plate:
            b.box(size=(L * 0.94, 0.008, H * 0.72), loc=(0, y, H * 0.5), color=R['bone'],
                  var=0.05)
        for x in (-0.12, -0.04, 0.04, 0.12):
            poly(b, [V((x + px, y + s * 0.0045, H * 0.5 + pz)) for (px, pz) in circle2d(0.009, 6)],
                 R['carve'], facing=(0, s, 0))
            poly(b, [V((x + px, y + s * 0.0055, H * 0.5 + pz)) for (px, pz) in circle2d(0.004, 5)],
                 R['bone'], facing=(0, s, 0))
        for z in (H * 0.2, H * 0.82):
            yy = y + s * 0.0045
            poly(b, [V((-L * 0.45, yy, z - 0.002)), V((L * 0.45, yy, z - 0.002)),
                     V((L * 0.45, yy, z + 0.002)), V((-L * 0.45, yy, z + 0.002))],
                 R['carve'], facing=(0, s, 0))
    rot_all(b, rot=(-30, 0, 10))
    return finish(b, 'relic_comb', ao=0.15)


def relic_tablet():
    b = Builder(seed=83)
    W, Hh, T = 0.24, 0.3, 0.05
    outline = [(-W / 2, 0.0), (W / 2, 0.0), (W / 2 + 0.006, Hh * 0.62)]
    for k in range(1, 6):
        a = (0 + 180 * k / 6) * DEG
        outline.append((W / 2 * math.cos(a), Hh * 0.62 + (Hh * 0.38) * math.sin(a)))
    outline += [(-W / 2 + 0.03, Hh * 0.8), (-W / 2 + 0.005, Hh * 0.72), (-W / 2 - 0.004, Hh * 0.6)]
    outline = [(x + b.rng.uniform(-0.004, 0.004), z + b.rng.uniform(-0.004, 0.004) * (z > 0.01))
               for (x, z) in outline]
    with Part(b) as slab_p:
        slab(b, [V((x, 0.0, z)) for (x, z) in outline], T, color=R['tablet'], var=0.08,
             side=R['tablet_dk'])
    # moss on the top edge
    paint(b, slab_p.faces, lambda f: 'moss' if f.calc_center_median().z > Hh * 0.9 and
          f.normal.z > 0.3 else None, var=0.1)
    # glowing runes carved on the front (-Y) face
    y = -T / 2 - 0.0015

    def stroke(p0, p1, w=0.0065):
        p0, p1 = V((p0[0], y, p0[1])), V((p1[0], y, p1[1]))
        d = (p1 - p0).normalized()
        n = V((-d.z, 0, d.x)) * (w / 2)
        poly(b, [p0 - n, p0 + n, p1 + n, p1 - n], R['rune'], mat='emit', var=0.0,
             facing=(0, -1, 0))
    glyphs = [
        [((0, 0), (0, 1)), ((0, 1), (0.6, 0.75)), ((0, 0.55), (0.6, 0.3))],      # fehu-ish
        [((0, 0), (0, 1)), ((0, 1), (0.55, 0.75)), ((0.55, 0.75), (0, 0.5)), ((0, 0.5), (0.55, 0))],
        [((0.3, 0), (0.3, 1)), ((0.3, 0.6), (0, 1)), ((0.3, 0.6), (0.6, 1))],    # algiz
        [((0, 0), (0, 1)), ((0.6, 0), (0.6, 1)), ((0, 0.7), (0.6, 0.3))],        # hagalaz
        [((0.3, 0), (0.3, 1)), ((0, 0.35), (0.6, 0.65))],
        [((0, 0), (0.6, 1)), ((0.6, 0), (0, 1))],                               # gebo
    ]
    cells = [(-0.075, 0.15), (-0.005, 0.15), (0.065, 0.15), (-0.075, 0.055), (-0.005, 0.055),
             (0.065, 0.055)]
    for (cx, cz), gl in zip(cells, glyphs):
        s = 0.07
        for (p0, p1) in gl:
            stroke((cx - 0.02 + p0[0] * s * 0.6, cz + p0[1] * s),
                   (cx - 0.02 + p1[0] * s * 0.6, cz + p1[1] * s))
    # a carved line frame under the arch
    stroke((-0.095, 0.235), (0.095, 0.235), 0.005)
    rot_all(b, rot=(-14, 0, 12))
    return finish(b, 'relic_tablet', ao=0.15)


def relic_brooch():
    b = Builder(seed=84)
    H = 0.07
    prof = [(0.0, H), (0.04, H * 0.95), (0.075, H * 0.75), (0.098, H * 0.45), (0.108, H * 0.16),
            (0.12, H * 0.08), (0.122, 0.0), (0.0, 0.0)]
    with Part(b) as dome:
        b.lathe(list(reversed(prof)), seg=12, color=R['bronze'], mat='metal', var=0.06,
                cap_bottom=False, cap_top=False)
    dome.xf(scale=(1.3, 1.0, 1.0))
    paint(b, dome.faces, lambda f: (R['verdigris'], 'base') if b.rng.random() < 0.18 else
          (R['bronze_hi'] if f.normal.z > 0.75 else None), var=0.06)

    def zdome(x, y):
        rr = ((x / 1.3) ** 2 + y ** 2) ** 0.5
        # piecewise-linear lookup of the profile
        pr = list(reversed(prof))[1:]
        pr = sorted(pr[:-1], key=lambda q: q[0])
        for (r0, z0), (r1, z1) in zip(pr, pr[1:]):
            if r0 <= rr <= r1:
                return lerp(z0, z1, (rr - r0) / max(1e-6, r1 - r0))
        return 0.0
    # raised bosses: centre + four around
    for (x, y, r) in [(0, 0, 0.022), (0.085, 0.0, 0.016), (-0.085, 0.0, 0.016),
                      (0.0, 0.06, 0.015), (0.0, -0.06, 0.015)]:
        z = zdome(x, y)
        b.cone(r=r, h=r * 1.1, seg=6, loc=(x, y, z - 0.006), color=R['bronze_hi'], mat='metal',
               var=0.05)
    # ridges between the panels
    for a in (40, 140, 220, 320):
        ar = a * DEG
        pts = []
        for t in (0.2, 0.55, 0.92):
            x, y = 0.155 * t * math.cos(ar), 0.12 * t * math.sin(ar)
            pts.append(V((x, y, zdome(x, y) + 0.003)))
        tube_path(b, pts, 0.005, n=4, color=R['bronze_dk'], mat='metal', var=0.04)
    rot_all(b, rot=(38, 0, 8))
    return finish(b, 'relic_brooch', ao=0.12)


def relic_horn():
    b = Builder(seed=85)
    pts, rad = [], []
    N = 8
    for i in range(N):
        t = i / (N - 1)
        a = lerp(-100, 35, t) * DEG
        R0 = 0.17
        pts.append(V((R0 * math.cos(a) * 1.3 - 0.02, R0 * math.sin(a) * 0.7 + 0.03, 0.0)))
        rad.append(lerp(0.006, 0.05, t ** 1.2))
    for i, p in enumerate(pts):
        p.z = rad[i]
    with Part(b) as horn:
        tube_path(b, pts, rad, n=8, color=R['horn_mid'], var=0.06, cap_start=True, cap_end=True)

    def grad(f):
        c = f.calc_center_median()
        best = min(range(N), key=lambda i: (pts[i] - c).length)
        t = best / (N - 1)
        if (pts[-1] - c).length < 0.012:
            return R['horn_in']
        return G.col(R['horn_tip']) if t < 0.25 else (R['horn_mid'] if t < 0.6 else R['horn_mouth'])
    paint(b, horn.faces, grad, var=0.06)
    # bronze rim at the mouth, a band and a knob at the tip
    d = (pts[-1] - pts[-2]).normalized()
    for (i, w, rk) in ((N - 1, 0.018, 1.08), (4, 0.012, 1.12)):
        c = pts[i] - d * (w if i == N - 1 else 0)
        end = (c + (pts[i + 1] - pts[i]).normalized() * w) if i < N - 1 else c + d * w
        tube_path(b, [c, end],
                  [rad[i] * rk, rad[i] * rk], n=8, color=R['bronze'], mat='metal', var=0.05)
    b.ico(r=0.012, sub=1, loc=pts[0] - (pts[1] - pts[0]).normalized() * 0.006, color=R['bronze'],
          mat='metal')
    rot_all(b, rot=(22, 0, -8))
    return finish(b, 'relic_horn', ao=0.15)


def relic_crown():
    b = Builder(seed=86)
    r, h, t = 0.11, 0.05, 0.012
    n = 10
    rings = [ring((0, 0, z), (1, 0, 0), (0, 1, 0), rad, rad, n)
             for (rad, z) in ((r, 0.0), (r * 1.03, h * 0.5), (r, h))]
    inner = [list(reversed(ring((0, 0, z), (1, 0, 0), (0, 1, 0), r - t, r - t, n)))
             for z in (h, 0.0)]
    with Part(b) as band:
        loft(b, rings, color=R['iron'], mat='metal', var=0.08, cap_start=False, cap_end=False)
        loft(b, inner, color=R['iron_dk'], mat='metal', var=0.06, cap_start=False, cap_end=False)
        # top + bottom lips
        for (z, rr) in ((h, rings[-1]), (0.0, rings[0])):
            rin = ring((0, 0, z), (1, 0, 0), (0, 1, 0), r - t, r - t, n)
            for i in range(n):
                j = (i + 1) % n
                q = [rr[i], rr[j], rin[j], rin[i]]
                poly(b, q, R['iron'], mat='metal', facing=(0, 0, 1 if z > 0 else -1))
    paint(b, band.faces, lambda f: (R['rust'] if b.rng.random() < 0.4 else
                                    R['rust_lt'] if b.rng.random() < 0.2 else None), var=0.08)
    # five spikes, one snapped off
    for k in range(5):
        a = (90 + 72 * k) * DEG
        ca, sa = math.cos(a), math.sin(a)
        base = V((ca * (r - t * 0.5), sa * (r - t * 0.5), h - 0.004))
        tall = 0.03 if k == 2 else 0.075
        tang = V((-sa, ca, 0))
        outn = V((ca, sa, 0))
        tip = base + V((0, 0, tall)) + outn * 0.008
        pts = [base - tang * 0.028, base + tang * 0.028, tip + tang * (0.01 if k == 2 else 0.0),
               tip - tang * (0.004 if k == 2 else 0.0)]
        with Part(b) as sp:
            slab(b, pts, t * 0.8, color=R['iron'], mat='metal', var=0.08)
        paint(b, sp.faces, lambda f: R['rust'] if b.rng.random() < 0.45 else None, var=0.08,
              mat='metal')
        if k != 2:
            b.ico(r=0.011, sub=1, loc=tip + V((0, 0, 0.004)), color=R['rust_lt'], mat='metal',
                  var=0.08)
    # dull red gem set in the front
    b.ico(r=0.016, sub=1, loc=(0, -r * 1.02, h * 0.5), scale=(1.0, 0.6, 1.2), color=R['gem'],
          mat='metal', var=0.06)
    rot_all(b, rot=(-12, 10, 18))
    return finish(b, 'relic_crown', ao=0.15)


def relic_amber():
    b = Builder(seed=87)
    n = 11
    pts = []
    for i in range(n):
        a = (-90 + 360 * i / n) * DEG
        pts.append(V((0.12 * math.cos(a), 0.085 * math.sin(a) + 0.01, 0.0)))
    # cord loop (closed by repeating the first point)
    cord = [p + V((0, 0, 0.012)) for p in pts] + [pts[0] + V((0, 0, 0.012))]
    tube_path(b, cord, 0.0035, n=3, color=R['cord'], var=0.05, cap_start=False, cap_end=False)
    for i, p in enumerate(pts):
        big = i == 0
        r = 0.03 if big else 0.02 + 0.004 * ((i * 7) % 3) / 2
        c = V((p.x, p.y, r * 0.85))
        with Part(b) as bead:
            b.ico(r=r, sub=1, loc=c, scale=(1.0, 1.0, 0.85) if not big else (1.2, 0.9, 0.8),
                  color=R['amber'], mat='metal', var=0.08, smooth=True)
        paint(b, bead.faces, lambda f: R['amber_lt'] if f.normal.z > 0.6 else
              (R['amber_dk'] if f.normal.z < -0.2 else None), var=0.06, mat='metal')
    rot_all(b, rot=(24, 0, 0))
    return finish(b, 'relic_amber', ao=0.12)


def relic_idol():
    b = Builder(seed=88)
    col_ = R['idol']
    b.cyl(r1=0.06, r2=0.055, h=0.025, seg=7, color=R['idol_dk'], var=0.08)
    b.lathe([(0.042, 0.025), (0.046, 0.09), (0.052, 0.15), (0.05, 0.19), (0.036, 0.205)], seg=7,
            color=col_, var=0.08, cap_bottom=False, cap_top=True, jitter=0.002)
    poly(b, [V((-0.004, -0.0445, 0.03)), V((0.004, -0.0445, 0.03)), V((0.004, -0.047, 0.085)),
             V((-0.004, -0.047, 0.085))], R['idol_dk'], facing=(0, -1, 0))
    b.lathe([(0.0, 0.2), (0.03, 0.203), (0.04, 0.225), (0.041, 0.25), (0.036, 0.27),
             (0.0, 0.272)], seg=7, color=R['idol_lt'], var=0.07, jitter=0.0015)
    b.cone(r=0.046, h=0.07, seg=7, loc=(0, 0.004, 0.262), rot=(-8, 0, 0), color=R['idol_dk'],
           var=0.08)
    b.cyl(r1=0.047, h=0.012, seg=7, loc=(0, 0.002, 0.258), color=R['idol'], var=0.06, cap=False)
    for sgn in (-1, 1):
        poly(b, [V((sgn * 0.014 + x, -0.0405, 0.244 + z)) for (x, z) in circle2d(0.0065, 5)],
             hexc('#2a1e14'), facing=(0, -1, 0))
    b.prism([(-0.005, 0.0), (0.005, 0.0), (0.0, -0.012)], 0.02, loc=(0, -0.034, 0.222),
            color=R['idol_lt'])
    b.prism([(-0.03, 0.0), (0.03, 0.0), (0.0, -0.028)], 0.05, loc=(0, -0.012, 0.172),
            color=R['idol_dk'])
    for sgn in (-1, 1):
        tube_path(b, [(sgn * 0.05, -0.005, 0.18), (sgn * 0.053, -0.02, 0.14),
                      (sgn * 0.02, -0.05, 0.125), (-sgn * 0.006, -0.052, 0.13)],
                  [0.012, 0.011, 0.01, 0.009], n=4, color=R['idol_lt'], var=0.06)
    b.ico(r=0.014, sub=1, loc=(0.035, 0.03, 0.03), scale=(1.2, 1.0, 0.5), color='moss', var=0.1)
    rot_all(b, rot=(0, 0, 14))
    return finish(b, 'relic_idol', ao=0.2)


RELICS = [relic_coin, relic_comb, relic_tablet, relic_brooch, relic_horn, relic_crown,
          relic_amber, relic_idol]


# ---------------------------------------------------------------------------
# Tools (origin = grip, handle +Z, head up and facing -Y)
# ---------------------------------------------------------------------------
def _handle(b, z0, z1, r0, r1=None, seg=6, color=None, bend=0.0):
    """Wooden handle along +Z with a gentle forward bow of `bend` metres."""
    r1 = r0 if r1 is None else r1
    ts = (0.0, 0.25, 0.5, 0.75, 1.0)
    pts = [V((0, -bend * math.sin(math.pi * t), lerp(z0, z1, t))) for t in ts]
    tube_path(b, pts, [lerp(r0, r1, t) for t in ts], n=seg, color=color or R['handle'], var=0.07)


def _wrap(b, z0, z1, r, color=None, seg=6, bands=3):
    """Leather grip wrap: a few slightly offset bands."""
    h = (z1 - z0) / bands
    for k in range(bands):
        b.cyl(r1=r, h=h * 0.92, seg=seg, loc=(0, 0, z0 + k * h), rot=(0, 0, 15 * k),
              color=color or R['wrap'], var=0.08, cap=(k in (0, bands - 1)))


def tool_hoe():
    b = Builder(seed=91)
    _handle(b, -0.11, 0.98, 0.017, 0.015, color=R['handle'], bend=0.006)
    _wrap(b, -0.09, 0.09, 0.02)
    b.cyl(r1=0.02, h=0.012, seg=6, loc=(0, 0, -0.12), color=R['handle_dk'])
    # iron socket collar + neck bending forward
    b.cyl(r1=0.022, r2=0.02, h=0.07, seg=6, loc=(0, 0, 0.93), color=R['steel_dk'], mat='metal')
    tube_path(b, [(0, 0, 0.985), (0, -0.04, 1.0), (0, -0.08, 0.985)], [0.014, 0.013, 0.012],
              n=4, color=R['steel_dk'], mat='metal')
    # blade: a broad plate reaching forward and angled down, edge at -Y
    blade = [(-0.09, -0.075), (0.09, -0.075), (0.105, -0.215), (-0.105, -0.215)]
    with Part(b) as bl:
        slab(b, [V((x, y, 0.985)) for (x, y) in blade], 0.012, color=R['steel'], mat='metal',
             var=0.05)
        for s_ in (1, -1):
            zz = 0.985 + s_ * 0.0068
            poly(b, [V((-0.105, -0.215, zz)), V((0.105, -0.215, zz)), V((0.1, -0.19, zz)),
                     V((-0.1, -0.19, zz))], R['steel_hi'], mat='metal', facing=(0, 0, s_))
    bl.xf(rot=(-12, 0, 0), pivot=(0, -0.075, 0.985))
    return finish(b, 'tool_hoe', origin=(0, 0, 0), ao=0.0)


def tool_can():
    b = Builder(seed=92)
    # body hangs below the grip (origin = top of the handle arc)
    zt = -0.08
    prof = [(0.0, -0.3), (0.105, -0.3), (0.112, -0.27), (0.112, -0.14), (0.1, -0.1),
            (0.07, zt), (0.0, zt)]
    with Part(b) as body:
        b.lathe(prof, seg=10, color=R['copper'], mat='metal', var=0.06)
    paint(b, body.faces, lambda f: R['tin'] if abs(f.calc_center_median().z + 0.2) < 0.03 else None,
          mat='metal', var=0.05)
    for z in (-0.285, -0.14):
        b.cyl(r1=0.116, h=0.016, seg=10, loc=(0, 0, z), color=hexc('#8a5a30'), mat='metal',
              cap=False)
    # handle arc from the back to the front of the lid; the grip is its top
    tube_path(b, [(0, 0.075, zt + 0.005), (0, 0.06, -0.025), (0, 0.0, 0.0),
                  (0, -0.06, -0.025), (0, -0.075, zt + 0.005)], 0.012, n=5, color=R['copper'],
              mat='metal')
    b.cyl(r1=0.016, h=0.05, seg=6, loc=(-0.025, 0, 0.0), rot=(0, 90, 0), color=R['wrap'],
          var=0.08)
    # spout from the lower front, reaching forward (-Y) and up, with a rose
    sp = [V((0, -0.09, -0.27)), V((0, -0.16, -0.22)), V((0, -0.23, -0.15)), V((0, -0.26, -0.12))]
    tube_path(b, sp, [0.026, 0.02, 0.015, 0.014], n=6, color=R['copper'], mat='metal')
    d = (sp[-1] - sp[-2]).normalized()
    rose = [sp[-1], sp[-1] + d * 0.035]
    tube_path(b, rose, [0.016, 0.034], n=8, color=R['tin'], mat='metal', cap_end=True)
    return finish(b, 'tool_can', origin=(0, 0, 0), ao=0.0)


def tool_axe():
    b = Builder(seed=93)
    _handle(b, -0.06, 0.78, 0.018, 0.02, bend=0.008)
    _wrap(b, -0.06, 0.09, 0.021)
    b.cyl(r1=0.024, r2=0.02, h=0.03, seg=6, loc=(0, 0, -0.08), color=R['handle_dk'])
    # bearded head: outline in the YZ plane, blade toward -Y, wedge-thick at the eye

    def half_t(y):
        return 0.016 * (0.22 + 0.78 * min(1.0, max(0.0, (y + 0.15) / 0.15)))
    head = [(0.03, 0.8), (0.03, 0.7), (-0.02, 0.69), (-0.06, 0.62), (-0.1, 0.56), (-0.13, 0.58),
            (-0.15, 0.66), (-0.16, 0.73), (-0.155, 0.8), (-0.13, 0.83), (-0.07, 0.8)]
    with Part(b) as hd:
        slab(b, [V((0.0, y, z)) for (y, z) in head], 0.032, color=R['steel'], mat='metal',
             var=0.05)
    for v in hd.verts:
        v.co.x *= half_t(v.co.y) / 0.016
    # thicker eye around the handle top
    b.box(size=(0.042, 0.06, 0.12), loc=(0, 0.004, 0.75), color=R['steel_dk'], mat='metal',
          bevel=0.006)
    # bright honed edge on both faces
    edge = [(-0.13, 0.58), (-0.15, 0.66), (-0.16, 0.73), (-0.155, 0.8), (-0.13, 0.83),
            (-0.12, 0.8), (-0.13, 0.73), (-0.125, 0.66), (-0.11, 0.6)]
    for s in (-1, 1):
        poly(b, [V((s * (half_t(y) + 0.0012), y, z)) for (y, z) in edge], R['steel_hi'],
             mat='metal', facing=(s, 0, 0))
    return finish(b, 'tool_axe', origin=(0, 0, 0), ao=0.0)


def tool_pickaxe():
    b = Builder(seed=94)
    _handle(b, -0.06, 0.8, 0.018, 0.02, bend=0.0)
    _wrap(b, -0.06, 0.09, 0.021)
    b.cyl(r1=0.024, r2=0.02, h=0.03, seg=6, loc=(0, 0, -0.08), color=R['handle_dk'])
    # curved head across the top: long pick forward (-Y), short chisel back (+Y)
    pick = [V((0, 0.0, 0.8)), V((0, -0.1, 0.795)), V((0, -0.2, 0.765)), V((0, -0.27, 0.72))]
    tube_path(b, pick, [0.026, 0.022, 0.014, 0.0], n=4, color=R['steel'], mat='metal',
              start=math.pi / 4)
    back = [V((0, 0.0, 0.8)), V((0, 0.09, 0.795)), V((0, 0.15, 0.775))]
    with Part(b) as bk:
        tube_path(b, back, [0.026, 0.022, 0.018], n=4, color=R['steel'], mat='metal',
                  start=math.pi / 4, flat=0.5)
    b.box(size=(0.05, 0.07, 0.07), loc=(0, 0.0, 0.795), color=R['steel_dk'], mat='metal',
          bevel=0.008)
    b.cone(r=0.012, h=0.035, seg=4, loc=(0, -0.26, 0.726), rot=(128, 0, 0), color=R['steel_hi'],
           mat='metal')
    return finish(b, 'tool_pickaxe', origin=(0, 0, 0), ao=0.0)


def tool_sword():
    b = Builder(seed=95)
    # grip + pommel
    b.cyl(r1=0.018, h=0.16, seg=6, loc=(0, 0, -0.08), color=R['wrap'], var=0.08)
    for z in (-0.06, -0.02, 0.02, 0.06):
        b.cyl(r1=0.0195, h=0.008, seg=6, loc=(0, 0, z), color=hexc('#6a4a2a'), cap=False)
    b.lathe([(0.0, -0.13), (0.028, -0.125), (0.032, -0.105), (0.022, -0.085), (0.0, -0.082)],
            seg=7, color=R['bronze'], mat='metal')
    # crossguard (extends along the blade width, +-Y) and blade with the edge toward -Y
    b.box(size=(0.04, 0.2, 0.03), loc=(0, 0, 0.095), color=R['bronze'], mat='metal', bevel=0.006)
    blade = [(0.028, 0.1), (0.03, 0.62), (0.022, 0.76), (0.0, 0.82), (-0.022, 0.76), (-0.03, 0.62),
             (-0.028, 0.1)]
    with Part(b) as bl:
        slab(b, [V((0.0, y, z)) for (y, z) in blade], 0.012, color=R['steel'], mat='metal',
             var=0.04)
    # fuller (groove) down the middle of both flats
    for s in (-1, 1):
        poly(b, [V((s * 0.0062, -0.0055, 0.12)), V((s * 0.0062, 0.0055, 0.12)),
                 V((s * 0.0062, 0.004, 0.62)), V((s * 0.0062, -0.004, 0.62))], R['steel_dk'],
             mat='metal', facing=(s, 0, 0))
        poly(b, [V((s * 0.0062, -0.03, 0.12)), V((s * 0.0062, -0.024, 0.12)),
                 V((s * 0.0062, -0.017, 0.76)), V((s * 0.0062, -0.03, 0.62))], R['steel_hi'],
             mat='metal', facing=(s, 0, 0))
    b.ico(r=0.012, sub=1, loc=(0, 0, 0.095), scale=(1.8, 0.8, 0.8), color=R['gem'], mat='metal')
    return finish(b, 'tool_sword', origin=(0, 0, 0), ao=0.0)


def tool_rod():
    b = Builder(seed=96)
    # cork grip below and above the origin, butt cap
    b.lathe([(0.0, -0.26), (0.02, -0.26), (0.022, -0.24), (0.02, 0.09), (0.013, 0.1)], seg=7,
            color=R['cork'], var=0.07, cap_top=False)
    b.cyl(r1=0.022, h=0.02, seg=7, loc=(0, 0, -0.27), color=R['handle_dk'])
    # tapered blank bending slightly forward
    pts = [V((0, -0.12 * (max(0.0, t - 0.3) / 0.7) ** 2, lerp(0.09, 1.55, t)))
           for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    tube_path(b, pts, [0.015, 0.012, 0.0095, 0.007, 0.004], n=5, color=R['handle'], var=0.06)
    # thread whippings + guide rings
    for t in (0.25, 0.5, 0.75):
        i = int(t * 4)
        p = pts[i]
        b.cyl(r1=0.013 - 0.006 * t, h=0.018, seg=5, loc=p - V((0, 0, 0.009)), color=R['thread'],
              cap=False)
        tube_path(b, [p + V((0, 0.01, 0)), p + V((0, 0.03, 0.01))], 0.003, n=3,
                  color=R['steel'], mat='metal')
    # reel under the rod just above the grip (+Y side), with crank
    b.cyl(r1=0.055, h=0.045, seg=10, loc=(-0.0225, 0.062, 0.14), rot=(0, 90, 0),
          color=R['bronze'], mat='metal')
    b.cyl(r1=0.036, h=0.05, seg=10, loc=(-0.025, 0.062, 0.14), rot=(0, 90, 0),
          color=R['line'], cap=False)
    b.box(size=(0.012, 0.03, 0.02), loc=(0, 0.025, 0.14), color=R['steel_dk'], mat='metal')
    tube_path(b, [(0.023, 0.062, 0.14), (0.032, 0.062, 0.14), (0.032, 0.062, 0.095)], 0.005,
              n=4, color=R['steel'], mat='metal')
    b.cyl(r1=0.008, h=0.024, seg=5, loc=(0.032, 0.062, 0.095), rot=(0, 90, 0),
          color=R['handle_dk'])
    # line from the reel up along the rod to the tip
    tube_path(b, [V((0, 0.03, 0.17)), pts[1] + V((0, 0.014, 0)), pts[2] + V((0, 0.014, 0)),
                  pts[3] + V((0, 0.012, 0)), pts[4]], 0.0015, n=3, color=R['line'], var=0.02,
              cap_start=False, cap_end=False)
    return finish(b, 'tool_rod', origin=(0, 0, 0), ao=0.0)


def tool_net():
    b = Builder(seed=97)
    _handle(b, -0.1, 0.83, 0.016, 0.014, bend=0.0)
    _wrap(b, -0.08, 0.08, 0.019, color=R['wrap'])
    b.cyl(r1=0.02, h=0.015, seg=6, loc=(0, 0, -0.112), color=R['handle_dk'])
    # hoop in the XZ plane (opening faces -Y), bag trailing toward +Y
    cz, rr = 1.09, 0.19
    n = 12
    hoop = [V((rr * math.sin(TAU * i / n), 0.0, cz - rr * math.cos(TAU * i / n)))
            for i in range(n)] + [V((0.0, 0.0, cz - rr))]
    tube_path(b, hoop, 0.011, n=4, color=R['handle_dk'], var=0.06, cap_start=False,
              cap_end=False)
    # collar where the hoop meets the handle
    b.cyl(r1=0.02, h=0.05, seg=6, loc=(0, 0, cz - rr - 0.04), color=hexc('#8b7650'))
    # netting: crossing bars across the opening + a shallow bag of ribs
    for k in (-1, 0, 1):
        x = k * 0.1
        hh = (rr ** 2 - x ** 2) ** 0.5
        tube_path(b, [V((x, 0.004, cz - hh)), V((x, 0.004, cz + hh))], 0.005, n=3, color=R['net'],
                  var=0.04, cap_start=False, cap_end=False)
        z = cz + k * 0.1
        tube_path(b, [V((-hh, 0.004, z)), V((hh, 0.004, z))], 0.005, n=3, color=R['net'],
                  var=0.04, cap_start=False, cap_end=False)
    tail = V((0.0, 0.22, cz - 0.06))
    for i in range(0, n, 2):
        p = hoop[i]
        mid = p.lerp(tail, 0.5) + V((0, 0.02, -0.03))
        tube_path(b, [p, mid, tail], 0.004, n=3, color=R['net'], var=0.04, cap_start=False,
                  cap_end=False)
    ring_pts = [hoop[i].lerp(tail, 0.5) + V((0, 0.02, -0.03)) for i in range(0, n, 2)]
    tube_path(b, ring_pts + [ring_pts[0]], 0.004, n=3, color=R['net'], var=0.04,
              cap_start=False, cap_end=False)
    return finish(b, 'tool_net', origin=(0, 0, 0), ao=0.0)


def tool_hammer():
    b = Builder(seed=98)
    _handle(b, -0.06, 0.36, 0.017, 0.019)
    _wrap(b, -0.06, 0.07, 0.02)
    b.cyl(r1=0.022, h=0.02, seg=6, loc=(0, 0, -0.075), color=R['handle_dk'])
    # chunky iron head along Y, striking face toward -Y, claw toward +Y
    b.box(size=(0.07, 0.13, 0.07), loc=(0, -0.025, 0.38), color=R['steel'], mat='metal',
          bevel=0.01)
    b.cyl(r1=0.042, r2=0.04, h=0.03, seg=8, loc=(0, -0.088, 0.38), rot=(90, 0, 0),
          color=R['steel_hi'], mat='metal')
    for s in (-1, 1):
        tube_path(b, [V((s * 0.016, 0.035, 0.39)), V((s * 0.018, 0.08, 0.38)),
                      V((s * 0.016, 0.11, 0.35))], [0.014, 0.011, 0.004], n=4,
                  color=R['steel'], mat='metal', start=math.pi / 4)
    b.box(size=(0.05, 0.04, 0.09), loc=(0, 0.0, 0.37), color=R['steel_dk'], mat='metal',
          bevel=0.006)
    return finish(b, 'tool_hammer', origin=(0, 0, 0), ao=0.0)


TOOLS = [tool_hoe, tool_can, tool_axe, tool_pickaxe, tool_sword, tool_rod, tool_net, tool_hammer]


# ---------------------------------------------------------------------------
# Food
# ---------------------------------------------------------------------------
def _bowl(b, r=0.13, h=0.075, fill=0.8, seg=10, color=None, inner=None):
    """Wooden bowl (one lathe: outside, rim, inside); returns the contents height."""
    prof = [(r * 0.55, 0.0), (r * 0.62, 0.008), (r * 0.9, h * 0.35), (r, h * 0.85),
            (r * 1.02, h), (r * 0.93, h), (r * 0.85, h * 0.55), (r * 0.5, h * 0.2)]
    with Part(b) as bw:
        b.lathe(prof, seg=seg, color=color or R['bowl'], var=0.07)
    paint(b, bw.faces, lambda f: (R['bowl_dk'] if f.calc_center_median().z < h * 0.3 and
                                  f.normal.z < 0.5 else
                                  (inner or R['bowl_in']) if f.normal.z > 0.2 and
                                  V((f.calc_center_median().x, f.calc_center_median().y, 0)).length
                                  < r * 0.9 else None), var=0.06)
    return h * fill


def food_stew():
    b = Builder(seed=101)
    r, h = 0.13, 0.08
    zf = _bowl(b, r, h, 0.8)
    rs = r * 0.9
    with Part(b) as surf:
        b.cyl(r1=rs, h=0.004, seg=10, loc=(0, 0, zf - 0.004), color=R['stew'], var=0.08)
    paint(b, surf.faces, lambda f: R['stew_lt'] if b.rng.random() < 0.3 else None, var=0.06)
    rng = b.rng
    chunks = [(R['carrot'], 0.022), (R['potato'], 0.026), (R['meat'], 0.026), (R['carrot'], 0.02),
              (R['potato'], 0.022), (R['meat'], 0.024), (R['carrot'], 0.018)]
    for k, (c, s) in enumerate(chunks):
        a = TAU * k / len(chunks) + rng.uniform(-0.3, 0.3)
        rad = rng.uniform(0.02, 0.075)
        b.box(size=(s, s, s * 0.8), loc=(math.cos(a) * rad, math.sin(a) * rad, zf + 0.003),
              rot=(rng.uniform(-20, 20), rng.uniform(-20, 20), rng.uniform(0, 90)), color=c,
              var=0.08)
    for k in range(4):
        a = rng.uniform(0, TAU)
        rad = rng.uniform(0.02, 0.08)
        b.box(size=(0.014, 0.008, 0.003), loc=(math.cos(a) * rad, math.sin(a) * rad, zf + 0.004),
              rot=(0, 0, rng.uniform(0, 180)), color=R['herb'], var=0.06)
    # wooden spoon resting in the bowl
    tube_path(b, [V((0.03, 0.02, zf + 0.004)), V((0.1, 0.07, h + 0.02)), V((0.17, 0.11, h + 0.05))],
              [0.007, 0.006, 0.006], n=4, color=R['handle'], var=0.06)
    b.sphere(r=0.024, seg=6, rings=4, loc=(0.015, 0.01, zf + 0.004), scale=(1.3, 1.0, 0.35),
             color=R['handle'], var=0.06)
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'food_stew', ao=0.2)


def food_bread():
    b = Builder(seed=102)
    Hh, Rr = 0.134, 0.152

    def zt(x, y):
        rr = (x * x + y * y) ** 0.5
        return Hh * max(0.0, 1 - (rr / (Rr + 0.004)) ** 2.3)
    prof = [(0.0, 0.0), (0.12, 0.0), (Rr, 0.025), (Rr, 0.06), (0.13, 0.095), (0.09, 0.12),
            (0.04, 0.132), (0.0, Hh)]
    with Part(b) as loaf:
        b.lathe(prof, seg=11, color=R['crust'], var=0.07, smooth=True)
    paint(b, loaf.faces, lambda f: R['crust_lt'] if f.normal.z > 0.7 else
          (hexc('#5a3820') if f.normal.z < 0.2 else None), var=0.06)
    # three diagonal slashes across the top, following the dome
    for off in (-0.05, 0.0, 0.05):
        strip = []
        for i in range(5):
            t = i / 4
            x = lerp(-0.08, 0.08, t) * (1.0 - 0.35 * abs(off) / 0.05)
            for dy in (-0.009, 0.009):
                yy = off + dy + x * 0.35
                strip.append(V((x, yy, zt(x, yy) + 0.006)))
        for i in range(4):
            q = [strip[2 * i], strip[2 * i + 2], strip[2 * i + 3], strip[2 * i + 1]]
            poly(b, q, R['score'], facing=(0, 0, 1), var=0.05)
    for (x, y) in ((0.06, -0.05), (-0.07, 0.03), (0.02, 0.085)):
        poly(b, [V((x + px, y + py, zt(x + px, y + py) + 0.007))
                 for (px, py) in circle2d(0.015, 5)],
             R['flour'], facing=(0, 0, 1))
    rot_all(b, rot=(0, 0, 25))
    return finish(b, 'food_bread', ao=0.2)


def food_grilled_fish():
    b = Builder(seed=103)
    L = 0.34
    body = Body([(0.0, 0.0, 0.014, 0.012), (0.1 * L, 0.004, 0.058, 0.03),
                 (0.3 * L, 0.008, 0.085, 0.042),
                 (0.55 * L, 0.006, 0.078, 0.038), (0.8 * L, 0.004, 0.046, 0.024),
                 (L, 0.004, 0.02, 0.011)], n=6, start=math.pi / 6)
    with Part(b) as fish:
        faces = body.build(b, color=R['grill'], var=0.08)
        paint(b, faces, lambda f: R['grill_dk'] if f.calc_center_median().z > 0.045 else None,
              var=0.06)
        for t in (0.28, 0.42, 0.56, 0.7):
            body.band(b, t * L - 0.005, t * L + 0.005, 100, 205, R['char'])
        flat(b, [V((L - 0.004, 0, 0.004)), V((L + 0.07, 0, 0.058)), V((L + 0.05, 0, 0.004)),
                 V((L + 0.07, 0, -0.05))], color=R['grill_dk'], facing=(0, -1, 0))
        body.eye(b, 0.1 * L, 160, 0.011, hexc('#e8e0cc'), hexc('#1a1410'))
        flat(b, [V((0.35 * L, 0, 0.08)), V((0.45 * L, 0, 0.115)), V((0.65 * L, 0, 0.1)),
                 V((0.7 * L, 0, 0.068))], color=R['grill_dk'], facing=(0, -1, 0))
    fish.xf(loc=(-L / 2, 0, 0))
    tube_path(b, [V((-L / 2 - 0.09, 0, 0.004)), V((L / 2 + 0.1, 0, 0.004))], [0.007, 0.006], n=5,
              color=R['stick'], var=0.06)
    rot_all(b, rot=(-50, 0, 0))
    rot_all(b, rot=(0, -20, 10))
    return finish(b, 'food_grilled_fish', ao=0.15)


def food_berry_pie():
    b = Builder(seed=104)
    r = 0.15
    # dish
    b.lathe([(r * 0.8, 0.0), (r * 0.85, 0.004), (r * 1.02, 0.045), (r * 1.08, 0.05),
             (r * 1.04, 0.054)], seg=12, color=R['dish'], var=0.06, cap_top=False)
    # filling + crimped crust rim
    with Part(b) as fill:
        b.cyl(r1=r * 0.82, r2=r * 0.98, h=0.05, seg=12, loc=(0, 0, 0.004), color=R['filling'],
              var=0.08)
    paint(b, fill.faces, lambda f: R['filling_lt'] if b.rng.random() < 0.35 else None, var=0.06)
    n = 16
    rings = [ring((0, 0, 0.05), (1, 0, 0), (0, 1, 0), r * 1.02, r * 1.02, n),
             ring((0, 0, 0.068), (1, 0, 0), (0, 1, 0), r * 1.0, r * 1.0, n,
                  wob=lambda i, a: 1.04 if i % 2 else 0.97),
             ring((0, 0, 0.066), (1, 0, 0), (0, 1, 0), r * 0.84, r * 0.84, n)]
    with Part(b) as rim:
        loft(b, rings, color=R['pie_crust'], var=0.07, cap_start=False, cap_end=False)
    paint(b, rim.faces, lambda f: R['pie_crust_dk'] if f.normal.z < 0.3 else None, var=0.05)
    # lattice strips
    for k in (-1, 0, 1):
        o = k * 0.065
        hl = (r * 0.9) ** 2 - o ** 2
        hl = hl ** 0.5
        b.box(size=(hl * 2, 0.022, 0.01), loc=(0, o, 0.058), color=R['pie_crust'], var=0.06)
        b.box(size=(0.022, hl * 2, 0.01), loc=(o, 0, 0.064), color=R['pie_crust'], var=0.06)
    for (x, y) in ((0.03, 0.03), (-0.03, -0.035), (0.095, -0.03), (-0.1, 0.03)):
        b.ico(r=0.012, sub=1, loc=(x, y, 0.058), color=R['berry_blue'] if x > 0 else R['berry_red'],
              var=0.05)
    rot_all(b, rot=(0, 0, 15))
    return finish(b, 'food_berry_pie', ao=0.2)


def food_roast_roots():
    b = Builder(seed=105)
    r = 0.16
    b.lathe([(0.0, 0.0), (r * 0.8, 0.0), (r, 0.018), (r * 1.02, 0.028), (r * 0.92, 0.024),
             (0.0, 0.016)], seg=12, color=R['plate'], var=0.06)
    z = 0.016
    rng = b.rng
    # carrot chunks
    for (x, y, a) in ((-0.05, -0.04, 30), (0.02, -0.07, -20), (-0.08, 0.03, 80)):
        with Part(b) as ck:
            b.cyl(r1=0.022, r2=0.017, h=0.05, seg=6, loc=(0, 0, 0), rot=(0, 90, 0),
                  color=R['roast_c'], var=0.08)
        paint(b, ck.faces, lambda f: R['roast_char'] if rng.random() < 0.3 else None, var=0.05)
        ck.xf(loc=(x, y, z + 0.018), rot=(0, 0, a))
    # potato/turnip chunks and beet
    for (x, y, s, c) in ((0.05, 0.02, 0.03, R['roast_t']), (0.0, 0.05, 0.028, R['roast_t']),
                         (0.08, -0.04, 0.026, R['roast_b']), (-0.02, 0.0, 0.024, R['roast_b'])):
        with Part(b) as ch:
            b.ico(r=s, sub=1, loc=(x, y, z + s * 0.75), scale=(1.1, 1.0, 0.8), color=c,
                  jitter=s * 0.12, var=0.08)
        paint(b, ch.faces, lambda f: R['roast_char'] if f.normal.z > 0.5 and rng.random() < 0.4
              else None, var=0.05)
    # onion half
    b.lathe([(0.0, 0.0), (0.03, 0.002), (0.034, 0.018), (0.0, 0.022)], seg=7,
            loc=(-0.07, -0.08, z), color=hexc('#d8b080'), var=0.06)
    # herb sprig
    for k in range(3):
        b.box(size=(0.03, 0.012, 0.003), loc=(0.03 + k * 0.015, 0.075, z + 0.045),
              rot=(0, 0, 40 * k), color=R['herb'], var=0.06)
    rot_all(b, rot=(0, 0, 10))
    return finish(b, 'food_roast_roots', ao=0.2)


def food_mushroom_skewer():
    b = Builder(seed=106)
    L = 0.44
    tube_path(b, [V((-L / 2, 0, 0)), V((L / 2, 0, 0))], [0.006, 0.0045], n=5, color=R['stick'],
              var=0.06)
    rng = b.rng
    # upright mushrooms pierced sideways through the cap, veg chunks between
    for k, x in enumerate((-0.13, -0.04, 0.05, 0.14)):
        with Part(b) as m:
            b.lathe([(0.0, -0.055), (0.016, -0.055), (0.015, -0.018), (0.05, -0.014),
                     (0.06, 0.005), (0.046, 0.03), (0.0, 0.038)], seg=8, color=R['mush_cap'],
                    var=0.08)
        paint(b, m.faces, lambda f: (R['mush_stem'] if f.calc_center_median().z < -0.016 else
                                     R['roast_char'] if rng.random() < 0.18 else
                                     R['mush_cap_lt'] if f.normal.z > 0.6 else None), var=0.06)
        m.xf(loc=(x, 0, 0), rot=(0, (k % 2) * 16 - 8, 0))
        if k < 3:
            b.box(size=(0.026, 0.034, 0.034), loc=(x + 0.045, 0, 0), rot=(25 * k, 10, 0),
                  color=hexc('#cf5a2a') if k % 2 else hexc('#6a8a3a'), var=0.08)
    rot_all(b, rot=(-30, 0, 0))
    rot_all(b, rot=(0, -14, 12))
    return finish(b, 'food_mushroom_skewer', ao=0.15)


def food_mead():
    b = Builder(seed=107)
    r, h = 0.085, 0.2
    n = 10
    with Part(b) as tk:
        b.lathe([(0.0, 0.0), (r * 1.05, 0.0), (r * 1.02, h * 0.5), (r * 0.96, h), (r * 0.86, h),
                 (r * 0.86, h - 0.02)], seg=n, color=R['tankard'], var=0.05, cap_top=True)

    def staves(f):
        c = f.calc_center_median()
        k = int(((math.atan2(c.y, c.x) / TAU) % 1.0) * n)
        return R['tankard_dk'] if k % 2 else None
    paint(b, tk.faces, staves, var=0.05)
    for z in (0.03, h - 0.045):
        rr = lerp(r * 1.05, r * 0.96, z / h) + 0.004
        b.cyl(r1=rr, h=0.02, seg=n, loc=(0, 0, z), color=R['iron'], mat='metal', cap=False)
    # handle on +X
    tube_path(b, [V((r * 0.98, 0, h * 0.8)), V((r + 0.055, 0, h * 0.75)),
                  V((r + 0.06, 0, h * 0.35)),
                  V((r * 1.02, 0, h * 0.25))], 0.013, n=5, color=R['tankard_dk'], var=0.06)
    # foam heaped over the rim and dribbling down
    with Part(b) as fm:
        b.cyl(r1=r * 0.98, h=0.015, seg=n, loc=(0, 0, h - 0.01), color=R['foam'], var=0.05)
        for k in range(6):
            a = TAU * k / 6 + 0.3
            b.ico(r=0.034, sub=1, loc=(math.cos(a) * r * 0.55, math.sin(a) * r * 0.55, h + 0.012),
                  scale=(1.0, 1.0, 0.6), color=R['foam'], var=0.05, smooth=True)
        b.ico(r=0.04, sub=1, loc=(0, 0, h + 0.022), scale=(1.0, 1.0, 0.6), color=R['foam'],
              var=0.05, smooth=True)
        tube_path(b, [V((-r * 0.2, -r * 0.99, h + 0.005)), V((-r * 0.22, -r * 1.02, h - 0.035)),
                      V((-r * 0.2, -r * 1.02, h - 0.05))], [0.012, 0.009, 0.0], n=5,
                  color=R['foam'], var=0.04)
    paint(b, fm.faces, lambda f: R['foam_dk'] if f.normal.z < 0.2 else None, var=0.04)
    rot_all(b, rot=(0, 0, -28))
    return finish(b, 'food_mead', ao=0.2)


def food_porridge():
    b = Builder(seed=108)
    r, h = 0.13, 0.08
    zf = _bowl(b, r, h, 0.82, color=hexc('#7a5a3c'))
    with Part(b) as surf:
        b.lathe([(0.0, zf + 0.012), (r * 0.5, zf + 0.008), (r * 0.9, zf)], seg=10,
                color=R['porridge'], var=0.06, cap_bottom=False, cap_top=False)
    paint(b, surf.faces, lambda f: R['porridge_dk'] if b.rng.random() < 0.25 else None, var=0.05)
    # honey pool + butter pat + berries
    poly(b, [V((x + 0.01, y - 0.01, zf + 0.0125)) for (x, y) in circle2d(0.03, 7)], R['honey'],
         facing=(0, 0, 1), var=0.04)
    b.box(size=(0.03, 0.03, 0.012), loc=(0.012, -0.012, zf + 0.018), rot=(0, 0, 25),
          color=R['butter'], var=0.05)
    for (x, y, c) in ((-0.05, 0.03, R['berry_red']), (-0.03, 0.06, R['berry_blue']),
                      (0.05, 0.05, R['berry_red']), (-0.06, -0.03, R['berry_blue'])):
        b.ico(r=0.013, sub=1, loc=(x, y, zf + 0.018), color=c, var=0.05, smooth=True)
    # spoon
    tube_path(b, [V((0.04, 0.04, zf + 0.012)), V((0.1, 0.09, h + 0.02)), V((0.16, 0.13, h + 0.05))],
              [0.007, 0.006, 0.006], n=4, color=R['handle'], var=0.06)
    rot_all(b, rot=(0, 0, -10))
    return finish(b, 'food_porridge', ao=0.2)


FOOD = [food_stew, food_bread, food_grilled_fish, food_berry_pie, food_roast_roots,
        food_mushroom_skewer, food_mead, food_porridge]
