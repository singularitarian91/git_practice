"""
build_enemies.py - the Gloam, the draugr, Ashhorn the Mist-Stag and ambient
critters.

    python blender/build_enemies.py        (exports assets/models/enemies.glb)

Bipeds use the standard character rig (body / head / arm_l / arm_r / leg_l /
leg_r + hand sockets); the wraith has no legs; quadrupeds use body / head /
leg_fl / leg_fr / leg_bl / leg_br / tail; the crow has body / head / wing_l /
wing_r.  Front faces Blender -Y, the creature's left is +X.
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401  (bpy must be imported before ghlib's bmesh use)
from mathutils import Vector  # noqa: E402

from ghlib import export_glb, reset_scene, stats  # noqa: E402
from rig_helpers import (M4, Builder, Head, Prof, V, blend, boot, check_names,  # noqa: E402
                         clean_glb_names, deform, deg, disc, ell_pt, eye, flat,
                         frame_z, hand_socket, lathe, lens, loft, make_root,
                         mottle, paint, part, shell, sweep)

SIDES = ((1, 'l'), (-1, 'r'))   # +X is the creature's left


def up_paint(col, thresh=0.45, chance=1.0, seed=1, cell=0.07):
    """Paint upward-facing faces (moss on bark...) in blotchy patches: the
    decision is made per `cell`-sized block of space, so neighbours agree."""
    def fn(c, f):
        if f.normal.z <= thresh:
            return None
        key = (int(math.floor(c.x / cell)), int(math.floor(c.y / cell)), int(math.floor(c.z / cell)), seed)
        if random.Random(hash(key)).random() < chance:
            return col
        return None
    return fn


def twig(b, p0, d, length, r0, color, rng, kinks=3, fork=False, seg=4):
    """Crooked tapering twig from p0 along direction d."""
    d = Vector(d).normalized()
    pts, rad = [Vector(p0)], [r0]
    step = length / kinks
    p = Vector(p0)
    for k in range(kinks):
        jit = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 0.5))) * step * 0.35
        p = p + d * step + jit
        pts.append(p.copy())
        rad.append(r0 * (1 - (k + 1) / kinks) * 0.9 + 0.002)
    rad[-1] = 0.0
    sweep(b, pts, rad, seg=seg, color=color)
    if fork and len(pts) > 2:
        q = pts[1]
        d2 = (d + Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.5, 0.5), 0.3))).normalized()
        sweep(b, [q, q + d2 * length * 0.3, q + d2 * length * 0.45], [r0 * 0.5, r0 * 0.3, 0.0],
              seg=3, color=color)
    return pts


# ===========================================================================
# Gloamling - hunched twig-and-bark imp (1.10 m)
# ===========================================================================
def build_gloamling():
    NAME, H = 'enemy_gloamling', 1.10
    root = make_root(NAME, col_r=0.35)
    BARK = blend('bark_dark', 'bark', 0.35)
    BARK_L = blend('bark', 'wood_grey', 0.3)
    MOSS = blend('moss', 'leaf_dark', 0.3, 1.05)
    GLOW = (0.56, 0.74, 0.16)
    rng = random.Random(7)

    hip = V(0, 0.03, 0.34)
    neck = V(0, -0.21, 0.70)
    sh = V(0.19, -0.11, 0.625)

    # ---------------- body: hunched gnarled trunk ------------------------------
    b = Builder(seed=801)
    spine = [V(0, 0.05, 0.28), V(0, 0.05, 0.37), V(0, 0.02, 0.47), V(0, -0.05, 0.57), V(0, -0.13, 0.66),
             V(0, -0.2, 0.705), V(0, -0.24, 0.725)]
    f = sweep(b, spine, [(0.085, 0.1), (0.09, 0.11), (0.08, 0.095), (0.11, 0.13), (0.12, 0.15), (0.09, 0.11),
                         (0.06, 0.07)], seg=7, color=BARK, jitter=0.016, var=0.09)
    b.bm.normal_update()
    paint(b, f, up_paint(MOSS, 0.4, 0.5, 3, cell=0.09))
    # thorny twigs on the back
    for k, (x, y, z, dx) in enumerate(((0.0, 0.07, 0.6, 0.0), (0.07, 0.07, 0.52, 0.4), (-0.07, 0.08, 0.47, -0.4),
                                       (0.0, -0.03, 0.69, 0.1))):
        twig(b, V(x, y, z), V(dx, 0.6, 0.8), 0.16 + 0.03 * (k % 2), 0.025, BARK_L, rng, kinks=2)
    # moss clumps on the shoulders
    for s in (-1, 1):
        b.ico(r=0.055, sub=1, loc=(s * 0.1, -0.1, 0.68), scale=(1.2, 1, 0.6), color=MOSS, jitter=0.012)
    b.ico(r=0.05, sub=0, loc=(0.03, 0.03, 0.58), scale=(1.3, 1, 0.6), color=MOSS, jitter=0.01)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- head: bark mask, deep glowing eyes, twig horns ----------
    b = Builder(seed=802)
    hc, hr = V(0, -0.31, 0.8), (0.155, 0.15, 0.14)
    f = b.sphere(r=1, seg=10, rings=7, loc=hc, scale=hr, color=BARK, jitter=0.01, var=0.08)
    b.bm.normal_update()
    paint(b, f, up_paint(MOSS, 0.5, 0.6, 5, cell=0.08))
    b.cyl(r1=0.075, r2=0.07, h=0.12, seg=6, loc=(0, -0.21, 0.69), rot=(-45, 0, 0), color=BARK, cap=False)
    # brow ridge
    for s in (-1, 1):
        q0, n0 = ell_pt(hc, hr, s * 8, 28)
        q1, n1 = ell_pt(hc, hr, s * 55, 22)
        sweep(b, [q0 - n0 * 0.01, q1], [(0.035, 0.04), (0.02, 0.02)], seg=4, color=BARK_L)
    # eyes: dark sockets + big glowing orbs
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 30, 6)
        eye(b, p, n, 0.05, [dict(r=1.45, color='coal', seg=8), dict(r=1.0, color=GLOW, mat='emit', seg=10),
                            dict(r=0.28, color='coal', sy=2.4, seg=6)],
            bulge=0.5, embed=0.4)
    # jutting jaw with jagged teeth
    jc = hc + V(0, -0.1, -0.1)
    b.sphere(r=1, seg=8, rings=5, loc=jc, scale=(0.12, 0.08, 0.05), color=BARK_L, jitter=0.008)
    sweep(b, [jc + V(-0.09, -0.045, 0.03), jc + V(0, -0.075, 0.035), jc + V(0.09, -0.045, 0.03)], 0.012,
          seg=3, color='coal')
    for k in range(5):
        x = -0.07 + k * 0.035
        b.cone(r=0.012, h=0.035 + 0.01 * (k % 2), seg=4, loc=jc + V(x, -0.07 + abs(x) * 0.3, 0.02),
               color='bone_dark')
    # twig horns / crown
    for k, (az, el, d, ln) in enumerate(((25, 70, V(0.35, 0.3, 1), 0.2), (-30, 68, V(-0.4, 0.25, 1), 0.23),
                                         (0, 85, V(0.0, 0.5, 1), 0.15), (60, 45, V(0.8, 0.2, 0.7), 0.13))):
        p, n = ell_pt(hc, hr, az, el)
        twig(b, p - n * 0.02, d, ln, 0.025, BARK_L, rng, kinks=3, fork=(k < 2))
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms: long, thin, twig claws ------------------------------
    for s, sfx in SIDES:
        b = Builder(seed=810 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=6, rings=4, loc=sp, scale=(0.055, 0.055, 0.055), color=BARK, jitter=0.006)
        el = sp + V(s * 0.012, 0.01, -0.24)
        wr = sp + V(s * 0.016, -0.005, -0.44)
        sweep(b, [sp, sp + V(s * 0.004, 0.006, -0.12), el], [0.04, 0.03, 0.032], seg=5, color=BARK, jitter=0.008)
        b.sphere(r=1, seg=5, rings=4, loc=el, scale=(0.042, 0.042, 0.045), color=BARK_L, jitter=0.008)
        sweep(b, [el, el + V(s * 0.002, -0.006, -0.1), wr], [0.034, 0.026, 0.03], seg=5, color=BARK, jitter=0.008)
        for k, (ax, ln) in enumerate(((-35, 0.13), (0, 0.15), (35, 0.12))):
            a = math.radians(ax)
            dd = V(s * 0.15 + math.sin(a) * 0.15 * s, math.sin(a) * 0.5 - 0.15, -1)
            twig(b, wr, dd, ln, 0.017, BARK_L, rng, kinks=2)
        f = b.ico(r=0.035, sub=0, loc=sp + V(0, 0, 0.03), scale=(1.2, 1, 0.5), color=MOSS, jitter=0.008)
        grip = wr + V(0, -0.01, -0.03)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: short root legs ------------------------------------
    for s, sfx in SIDES:
        b = Builder(seed=820 + s)
        hp = V(s * 0.1, hip.y, hip.z)
        kn = V(s * 0.125, -0.07, 0.19)
        an = V(s * 0.125, 0.03, 0.06)
        sweep(b, [hp + V(0, 0, 0.03), kn, an], [0.065, 0.048, 0.04], seg=6, color=BARK, jitter=0.01)
        b.sphere(r=1, seg=5, rings=4, loc=kn, scale=(0.05, 0.05, 0.05), color=BARK_L, jitter=0.008)
        for ax in (-40, 0, 40):
            a = math.radians(ax)
            twig(b, an + V(0, 0, -0.01), V(math.sin(a), -math.cos(a), -0.35), 0.12, 0.028, BARK_L, rng, kinks=2)
        twig(b, an, V(0, 1, -0.4), 0.07, 0.022, BARK_L, rng, kinks=1)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


def zigzag(faces, zmax, amp, step, a0=0.0, centre=(0.0, 0.0), seed=1):
    """Ragged hem: verts below zmax are pushed down, alternating long / short
    teeth.  `step` = azimuth spacing of the verts (360/seg for a loft,
    (a1-a0)/seg for a shell); azimuth measured around `centre` (x, y)."""
    rng = random.Random(seed)
    offs = [rng.uniform(0.45, 1.0) for _ in range(97)]

    def fn(v):
        if v.z < zmax:
            az = math.degrees(math.atan2(v.x - centre[0], -(v.y - centre[1])))
            k = int(round((az - a0) / step))
            tooth = 1.0 if k % 2 == 0 else 0.2
            v = V(v.x, v.y, v.z - amp * tooth * offs[k % 97])
        return v
    deform(faces, fn)


# ===========================================================================
# Wraith - floating spectral figure (2.10 m)
# ===========================================================================
def build_wraith():
    NAME, H = 'enemy_wraith', 2.10
    root = make_root(NAME, col_r=0.4)
    ROBE = blend('slate', 'glow_blue', 0.14, 1.0)
    ROBE_D = blend('blue_dark', 'slate', 0.45, 0.95)
    PALE = blend('slate', 'frost', 0.45, 0.95)
    BONE = blend('bone', 'bone_dark', 0.5, 0.95)
    VOID = blend('coal', 'blue_dark', 0.25, 0.7)
    GLOW = 'glow_blue'

    body_o = V(0, 0, 0.9)
    neck = V(0, -0.05, 1.6)
    sh = V(0.265, -0.035, 1.47)

    # ---------------- body: robe fading into ragged wisps ----------------------
    b = Builder(seed=901)
    rings = [(0.52, 0.13, 0.12, 0, 0.11), (0.66, 0.16, 0.15, 0, 0.085), (0.85, 0.19, 0.17, 0, 0.05),
             (1.05, 0.215, 0.185, 0, 0.015), (1.25, 0.24, 0.195, 0, -0.015), (1.4, 0.255, 0.195, 0, -0.03),
             (1.5, 0.235, 0.175, 0, -0.038), (1.57, 0.17, 0.135, 0, -0.045), (1.62, 0.09, 0.08, 0, -0.05),
             (1.635, 0.0, 0.0, 0, -0.05)]
    pr = Prof(rings)
    robe = loft(b, rings, seg=12, color=ROBE, jitter=0.012, var=0.07)
    zigzag(robe, 0.56, 0.16, 30, centre=(0, 0.11), seed=3)
    paint(b, robe, lambda c, f: PALE if c.z < 0.68 else None)
    # wisps trailing below the hem, swept back
    rng = random.Random(4)
    for k in range(9):
        a = 2 * math.pi * (k + 0.5) / 9
        p0 = V(math.cos(a) * 0.1, math.sin(a) * 0.1 + 0.11, 0.52)
        ln = rng.uniform(0.24, 0.38)
        back = V(0, 0.12 + 0.05 * math.sin(a), 0)
        curl = V(math.cos(a + 1.3), math.sin(a + 1.3), 0) * 0.04
        p1 = p0 + V(-math.cos(a) * 0.03, -math.sin(a) * 0.03, -ln * 0.5) + back * 0.5 + curl
        p2 = p0 + V(-math.cos(a) * 0.03, -math.sin(a) * 0.03, -ln) + back + curl * 2.2
        sweep(b, [p0 + V(0, 0, 0.08), p1, p2], [0.06, 0.04, 0.0], seg=4, color=PALE, jitter=0.006)
    # tattered shroud over the shoulders
    sr = [pr.ring(z, 0.03 + (1.52 - z) * 0.16) for z in (1.08, 1.22, 1.36, 1.5)] + [(1.6, 0.17, 0.14, 0, -0.045)]
    sh_f = shell(b, sr, 48, 312, seg=16, thick=0.022, color=ROBE, jitter=0.01)
    zigzag(sh_f, 1.12, 0.22, (312 - 48) / 16, a0=48, centre=(0, 0.0), seed=5)
    paint(b, sh_f, lambda c, f: ROBE_D if c.z < 1.1 else None)
    # a rope belt knotted at the front
    shell(b, [pr.ring(0.98, 0.012), pr.ring(1.01, 0.012)], -180, 180, seg=12, thick=0.014,
          color=blend('rope', 'slate', 0.4), edge=False, back=False)
    sweep(b, [pr.pt(10, 0.99, 0.015), pr.pt(14, 0.88, 0.02), pr.pt(8, 0.76, 0.02)], [0.012, 0.01, 0.0],
          seg=4, color=blend('rope', 'slate', 0.4))
    body = part(b, 'body', body_o, root, H, prefix=NAME)

    # ---------------- head: peaked hood around a void -------------------------
    b = Builder(seed=902)
    hc = V(0, -0.07, 1.78)
    b.sphere(r=1, seg=8, rings=6, loc=hc + V(0, 0.02, 0.0), scale=(0.13, 0.14, 0.16), color=VOID, var=0.02)
    for s, _ in SIDES:
        p = hc + V(s * 0.055, -0.135, 0.01)
        n = V(s * 0.25, -1, 0.05).normalized()
        lens(b, p, n, 0.03, 0.012, seg=6, color=GLOW, mat='emit', sx=1.6, sy=0.55, up=V(-s * 0.35, 0, 1))
    hood = Head(hc + V(0, 0.03, 0.03), [
        (-0.24, 0.05, 0.05, 0, 0.14, 0, 360), (-0.2, 0.14, 0.18, 0, 0.09, 0, 360),
        (-0.1, 0.19, 0.24, 0, 0.05, 0, 360), (0.0, 0.2, 0.25, 0, 0.03, 0, 360),
        (0.09, 0.19, 0.24, 0, 0.02, 0, 360), (0.15, 0.175, 0.225, 0, 0.012, 0, 360)])
    hood.shell(b, hood.rings, seg=12, thick=0.035, color=ROBE, jitter=0.008, edge=True)
    # peak of the hood, bent back
    tp = hood.pt(180, -0.12, -0.03)
    sweep(b, [tp, tp + V(0, 0.08, 0.1), tp + V(0, 0.2, 0.13)], [0.1, 0.06, 0.0], seg=6, color=ROBE, jitter=0.006)
    # ragged drape of the hood over the neck
    dr = shell(b, [(1.5, 0.27, 0.22, 0, 0.0, 44, 316), (1.6, 0.23, 0.2, 0, 0.012, 40, 320),
                   (1.7, 0.19, 0.19, 0, 0.025, 34, 326), (1.78, 0.17, 0.19, 0, 0.03, 30, 330)], 0, 0, seg=12,
               thick=0.025, color=ROBE, jitter=0.008)
    zigzag(dr, 1.52, 0.1, (316 - 44) / 12, a0=44, centre=(0, 0.0), seed=6)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms: tattered sleeves, long bony claws -----------------
    for s, sfx in SIDES:
        b = Builder(seed=910 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=7, rings=5, loc=sp, scale=(0.07, 0.07, 0.07), color=ROBE)
        el = sp + V(s * 0.02, 0.0, -0.3)
        sl = lathe(b, [(0.0, -0.4), (0.115, -0.4), (0.09, -0.2), (0.07, 0.0), (0.0, 0.02)], seg=8,
                   M=M4(sp), color=ROBE, jitter=0.01)
        zigzag(sl, sp.z - 0.3, 0.14, 45, centre=(sp.x, sp.y), seed=7 + s)
        paint(b, sl, lambda c, f: PALE if c.z < sp.z - 0.3 else None)
        wr = el + V(s * 0.01, -0.01, -0.27)
        sweep(b, [el + V(0, 0, 0.1), el, wr], [0.028, 0.024, 0.02], seg=5, color=BONE)
        b.sphere(r=1, seg=5, rings=4, loc=wr, scale=(0.032, 0.036, 0.03), color=BONE)
        for k, ax in enumerate((-36, -12, 12, 36)):
            a = math.radians(ax)
            d = V(s * 0.12, math.sin(a) * 0.55 - 0.12, -1).normalized()
            p0 = wr + V(0, math.sin(a) * 0.025, -0.01)
            j1 = p0 + d * 0.09
            j2 = j1 + (d + V(0, -0.35, 0.0)).normalized() * 0.09
            j3 = j2 + (d + V(0, -0.8, 0.2)).normalized() * 0.06
            f = sweep(b, [p0, j1, j2, j3], [0.012, 0.01, 0.007, 0.0], seg=4, color=BONE)
            paint(b, f, lambda c, f_, j2=j2: 'bone_dark' if (c - j2).length < 0.05 else None)
        grip = wr + V(0, -0.01, -0.05)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)
    return root


# ===========================================================================
# Draugr - undead Norse warrior (1.90 m)
# ===========================================================================
def build_draugr():
    NAME, H = 'enemy_draugr', 1.90
    root = make_root(NAME, col_r=0.4)
    SKIN = blend('stone', 'moss', 0.42, 1.0)
    SKIN_D = blend('stone_dark', 'moss', 0.35)
    MAIL = blend('iron', 'stone_light', 0.35, 1.0)
    MAIL2 = blend('iron', 'rust', 0.3, 0.9)
    RUSTY = blend('rust', 'iron', 0.35)
    HELM = blend('iron', 'rust', 0.4)
    LEATH = blend('leather_dk', 'leather', 0.3)
    CLOTH = blend('wood_grey', 'soil', 0.5, 0.9)
    FUR = blend('fur_dark', 'fur_brown', 0.35, 1.1)
    BONE = 'bone'
    GLOW = 'glow_eye'

    hip = V(0, 0.0, 0.92)
    neck = V(0, -0.03, 1.5)
    sh = V(0.245, -0.02, 1.43)

    # ---------------- body: mail shirt, belt, fur mantle, torn ribs -----------
    b = Builder(seed=1001)
    rings = [(0.66, 0.2, 0.17, 0, 0.01), (0.8, 0.19, 0.162, 0, 0.004), (0.94, 0.172, 0.148, 0, 0.0),
             (1.08, 0.176, 0.142, 0, -0.004), (1.22, 0.2, 0.15, 0, -0.012), (1.34, 0.215, 0.152, 0, -0.018),
             (1.42, 0.2, 0.14, 0, -0.02), (1.48, 0.13, 0.1, 0, -0.024), (1.52, 0.0, 0.0, 0, -0.025)]
    pr = Prof(rings)
    mail = loft(b, rings, seg=12, color=MAIL, jitter=0.004, var=0.1)
    paint(b, mail, mottle([MAIL, MAIL, MAIL2, blend('iron', 'stone_dark', 0.5)], 13), var=0.08)
    zigzag(mail, 0.7, 0.07, 30, centre=(0, 0.01), seed=11)
    # torn hole showing ribs
    hole = pr.pt(-22, 1.18, 0.004)
    lens(b, hole, pr.normal(-22, 1.18), 0.085, 0.01, seg=8, color=SKIN_D, sy=1.3)
    for k in range(3):
        z = 1.13 + k * 0.045
        q0, q1 = pr.pt(-42, z, 0.014), pr.pt(-4, z + 0.012, 0.014)
        sweep(b, [q0, (q0 + q1) / 2 + pr.normal(-22, z) * 0.008, q1], 0.011, seg=4, color=BONE)
    # belt with an iron buckle
    shell(b, [pr.ring(0.92, 0.012), pr.ring(0.98, 0.012)], -180, 180, seg=12, thick=0.02, color=LEATH,
          edge=False, back=False)
    b.box((0.07, 0.025, 0.06), loc=pr.pt(0, 0.95, 0.02), color=RUSTY, mat='metal')
    # ragged leather skirt strips under the mail
    for a in range(-157, 181, 45):
        p0 = pr.pt(a, 0.8, 0.012)
        n0 = pr.normal(a, 0.8)
        sweep(b, [p0, p0 + n0 * 0.02 + V(0, 0, -0.16)], [(0.012, 0.04), (0.012, 0.03)], seg=4, color=LEATH,
              up=n0)
    # torn fur mantle over the shoulders
    mr = [pr.ring(z, 0.045 + (1.45 - z) * 0.12) for z in (1.3, 1.38, 1.45)] + [(1.51, 0.15, 0.115, 0, -0.024)]
    fm = shell(b, mr, -180, 180, seg=12, thick=0.04, color=FUR, jitter=0.02, edge=False)
    zigzag(fm, 1.33, 0.1, 30, a0=-180, centre=(0, -0.015), seed=12)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- head: withered face, glowing eyes, horned helm ----------
    b = Builder(seed=1002)
    hc, hr = V(0, -0.045, 1.655), (0.112, 0.12, 0.13)
    f = b.sphere(r=1, seg=10, rings=7, loc=hc, scale=hr, color=SKIN, jitter=0.004, var=0.06)
    b.cyl(r1=0.06, r2=0.055, h=0.12, seg=6, loc=(0, -0.035, 1.47), color=SKIN_D, cap=False)
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 27, 6)
        eye(b, p - n * 0.012, n, 0.03, [dict(r=1.6, color='coal', seg=8),
                                         dict(r=0.9, color=GLOW, mat='emit', seg=8)], bulge=0.4, embed=0.6)
        # cheek hollows
        q, qn = ell_pt(hc, hr, s * 40, -20)
        lens(b, q, qn, 0.03, 0.006, seg=6, color=SKIN_D, sy=1.4)
    # nose stump + skeletal jaw with teeth
    pn, nn = ell_pt(hc, hr, 0, -4)
    lens(b, pn, nn, 0.022, 0.018, seg=5, color=SKIN_D, sy=1.3)
    jc = hc + V(0, -0.075, -0.1)
    b.sphere(r=1, seg=8, rings=4, loc=jc, scale=(0.078, 0.06, 0.045), color=BONE, var=0.05)
    sweep(b, [jc + V(-0.06, -0.035, 0.016), jc + V(0, -0.058, 0.018), jc + V(0.06, -0.035, 0.016)], 0.009,
          seg=3, color='coal')
    for k in range(5):
        x = -0.04 + k * 0.02
        b.box((0.012, 0.01, 0.022), loc=jc + V(x, -0.058 + abs(x) * 0.25, 0.03), color='bone_dark')
    # scraggly beard in two braids
    for sgn in (-1, 1):
        q = jc + V(sgn * 0.035, -0.02, -0.03)
        sweep(b, [q, q + V(sgn * 0.01, -0.02, -0.1), q + V(sgn * 0.005, -0.01, -0.2)], [0.03, 0.022, 0.0],
              seg=4, color=blend('fur_grey', 'bone_dark', 0.4), jitter=0.006)
    # helm: dome + brow band + nasal guard + small horns
    hb = hc + V(0, 0.0, 0.025)
    lathe(b, [(0.132, 0.0), (0.135, 0.03), (0.125, 0.09), (0.095, 0.15), (0.05, 0.185), (0.0, 0.195)],
                 seg=10, M=M4(hb), color=HELM, mat='metal', var=0.1, sy=1.08)
    lathe(b, [(0.138, -0.012), (0.142, 0.0), (0.142, 0.03), (0.135, 0.04)], seg=10, M=M4(hb), color=RUSTY,
          mat='metal', sy=1.08, cap_bottom=False, cap_top=False)
    b.box((0.03, 0.02, 0.11), loc=hc + V(0, -0.142, 0.0), rot=(-8, 0, 0), color=RUSTY, mat='metal')
    for s, _ in SIDES:
        h0 = hb + V(s * 0.11, 0.0, 0.07)
        sweep(b, [h0, h0 + V(s * 0.06, -0.01, 0.04), h0 + V(s * 0.085, -0.025, 0.1), h0 + V(s * 0.08, -0.04, 0.14)],
              [0.028, 0.022, 0.013, 0.0], seg=5, color='bone_dark')
        # rivets
        lens(b, hb + V(s * 0.1, -0.09, 0.012), (s * 0.7, -0.7, 0), 0.01, 0.008, seg=4, color=RUSTY, mat='metal')
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms ------------------------------------------------------
    for s, sfx in SIDES:
        b = Builder(seed=1010 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=7, rings=5, loc=sp, scale=(0.065, 0.065, 0.065), color=FUR, jitter=0.01)
        el = sp + V(s * 0.012, 0.01, -0.29)
        wr = sp + V(s * 0.018, -0.01, -0.56)
        sweep(b, [sp + V(0, 0, -0.02), sp + V(s * 0.006, 0, -0.14)], [0.058, 0.054], seg=6, color=MAIL)
        sweep(b, [sp + V(s * 0.006, 0, -0.14), el], [0.045, 0.036], seg=6, color=SKIN)
        b.sphere(r=1, seg=5, rings=4, loc=el, scale=(0.04, 0.04, 0.04), color=BONE if s < 0 else SKIN_D)
        sweep(b, [el, wr + V(0, 0, 0.1)], [0.036, 0.034], seg=6, color=SKIN)
        lathe(b, [(0.04, 0.0), (0.046, 0.01), (0.046, 0.14), (0.04, 0.15)], seg=6, M=M4(wr + V(0, 0, 0.02)),
              color=LEATH, cap_bottom=False, cap_top=False)
        # bony hand
        b.sphere(r=1, seg=6, rings=4, loc=wr + V(0, 0, -0.03), scale=(0.034, 0.042, 0.042), color=SKIN_D)
        for t in (-1, 0, 1):
            p0 = wr + V(s * 0.004, t * 0.022, -0.06)
            sweep(b, [p0, p0 + V(s * 0.01, t * 0.004 - 0.012, -0.05)], [0.011, 0.007], seg=4, color=SKIN_D)
        grip = wr + V(0, -0.005, -0.06)
        if s < 0:
            # rusted sword: blade down & forward along the hanging arm
            d = V(0, -0.34, -1).normalized()
            gx = grip + V(0, 0, 0.0)
            b.cyl(r1=0.017, h=0.14, seg=5, loc=gx + V(0, 0.0, -0.07), color=LEATH)
            b.sphere(r=0.028, seg=6, rings=4, loc=gx + V(0, 0.0, 0.085), color=RUSTY, mat='metal')
            cg = gx + d * 0.08
            b.box((0.2, 0.035, 0.03), loc=cg, rot=(-19, 0, 0), color=RUSTY, mat='metal')
            L = 0.68
            tip = cg + d * L
            blade = [cg + d * 0.01, cg + d * (L * 0.5), cg + d * (L * 0.9), tip]
            f = sweep(b, blade, [(0.035, 0.009), (0.032, 0.008), (0.024, 0.006), 0.0], seg=4,
                      color=blend('iron', 'rust', 0.55), mat='metal', up=V(1, 0, 0))
            paint(b, f, mottle([blend('iron', 'rust', 0.55), blend('iron', 'rust', 0.3), 'rust'], 17))
        else:
            # battered round shield on the outer forearm
            sc = wr + V(s * 0.075, -0.02, 0.1)
            nrm = V(s * 1.0, -0.42, 0.0).normalized()
            planks = disc(b, sc, nrm, 0.3, 0.035, seg=12, color='wood', var=0.12)
            paint(b, planks, mottle([blend('wood', 'wood_grey', 0.3, 1.15), blend('wood_light', 'wood_grey', 0.4),
                                     blend('red', 'wood', 0.5, 1.1)], 19))
            lathe(b, [(0.29, -0.024), (0.305, -0.018), (0.305, 0.018), (0.29, 0.024)], seg=12,
                        M=M4(sc, frame_z(nrm)), color=RUSTY, mat='metal', cap_bottom=False, cap_top=False)
            lens(b, sc + nrm * 0.017, nrm, 0.075, 0.05, seg=8, color=HELM, mat='metal')
            # a stuck arrow stub
            sweep(b, [sc + nrm * 0.02 + V(0, 0.06, -0.12), sc + nrm * 0.16 + V(0, 0.09, -0.08)], 0.008, seg=3,
                  color='wood_light')
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: ragged trousers, leg wraps, worn boots ------------
    for s, sfx in SIDES:
        b = Builder(seed=1020 + s)
        hp = V(s * 0.1, 0.0, hip.z)
        b.sphere(r=1, seg=6, rings=4, loc=hp + V(0, 0, -0.03), scale=(0.08, 0.08, 0.08), color=CLOTH)
        kn = V(hp.x, -0.02, 0.5)
        sweep(b, [hp + V(0, 0, -0.04), kn], [0.075, 0.06], seg=6, color=CLOTH)
        f = sweep(b, [kn, V(hp.x, 0.0, 0.2)], [0.056, 0.046], seg=6, color=blend('wool', 'wood_grey', 0.5, 0.75))
        paint(b, f, lambda c, f_: 'rope' if int(c.z * 30) % 2 else None)
        if s > 0:
            lens(b, V(hp.x, -0.05, 0.36), V(0, -1, 0), 0.03, 0.015, seg=5, color=BONE, sy=2.4)
        boot(b, hp, s, ank_z=0.2, color=LEATH, toe=0.16, r=0.06)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


def deer_leg(b, pts, radii, color, hoof_col, tuft_col=None, seg=6, knobs=(), hoof_r=None):
    """Leg through `pts` (top -> ground).  knobs: indices of joints that get a
    bony knob.  Ends in a split hoof at the last point."""
    sweep(b, pts, radii, seg=seg, color=color)
    for i in knobs:
        r = radii[i] * 1.25
        b.sphere(r=1, seg=6, rings=4, loc=pts[i], scale=(r, r, r * 1.1), color=color)
    foot = V(pts[-1])
    hr = hoof_r or radii[-1] * 1.25
    for sx in (-1, 1):
        # cloven hoof halves standing on the ground, tapering up into the leg
        b.cyl(r1=hr * 0.62, r2=hr * 0.4, h=foot.z + hr * 0.6, seg=5,
              loc=(foot.x + sx * hr * 0.36, foot.y - hr * 0.3, 0.0), scale=(0.85, 1.3, 1), color=hoof_col)
    if tuft_col:
        f = pts[-2] if len(pts) > 1 else foot
        b.cone(r=radii[-2] * 1.35, h=radii[-2] * 2.2, seg=5, loc=V(f) + V(0, 0.01, -radii[-2] * 1.6),
               color=tuft_col, jitter=radii[-2] * 0.2)


def antler(b, base, s, beam, tines, r0, color, tip_col, vein=None, seg=6):
    """Branching antler.  beam: list of offsets (x mirrored by s) from base;
    tines: list of (beam index, direction, length)."""
    pts = [V(base)] + [V(base) + V(s * o[0], o[1], o[2]) for o in beam]
    n = len(pts)
    rad = [r0 * (1 - 0.72 * i / (n - 1)) for i in range(n)]
    rad[-1] = 0.0
    sweep(b, pts, rad, seg=seg, color=color)
    b.cone(r=r0 * 0.5, h=r0 * 1.6, seg=5, loc=pts[-1] - (pts[-1] - pts[-2]).normalized() * r0 * 0.8,
           rot=deg(frame_z(pts[-1] - pts[-2])), color=tip_col, mat='emit')
    for (i, d, ln) in tines:
        p0 = pts[i]
        d = V(s * d[0], d[1], d[2]).normalized()
        r = rad[i] * 0.7
        mid = p0 + d * ln * 0.55 + V(0, 0, ln * 0.12)
        end = p0 + d * ln + V(0, 0, ln * 0.3)
        sweep(b, [p0, mid, end], [r, r * 0.6, 0.0], seg=5, color=color)
        dd = (end - mid).normalized()
        b.cone(r=r * 0.42, h=r * 1.5, seg=4, loc=end - dd * r * 0.9, rot=deg(frame_z(dd)), color=tip_col,
               mat='emit')
    if vein:
        # thin glowing fissures along the beam
        for i in range(1, n - 2):
            a, c = pts[i], pts[i + 1]
            d = (c - a)
            nrm = d.cross(V(0, 0, 1))
            if nrm.length < 1e-4:
                nrm = V(1, 0, 0)
            nrm = nrm.normalized() * (-1 if s < 0 else 1)
            q = a + d * 0.3 + nrm * rad[i] * 0.72
            b.box((0.012, 0.012, d.length * 0.45), loc=q, rot=deg(frame_z(d)), color=vein, mat='emit')
    return pts


# ===========================================================================
# Ashhorn, the Mist-Stag - boss (3.30 m to the antler tips)
# ===========================================================================
def build_boss_stag():
    NAME, H = 'boss_stag', 3.30
    root = make_root(NAME, col_r=1.2)
    HIDE = blend('fur_grey', 'slate', 0.4, 1.02)
    HIDE_L = blend('fur_grey', 'bone_dark', 0.3, 1.0)
    HIDE_D = blend('slate', 'fur_dark', 0.5)
    MANE = blend('fur_dark', 'slate', 0.25, 1.05)
    BONE = blend('bone', 'white', 0.2)
    BONE_D = 'bone_dark'
    ANT = blend('bone_dark', 'wood_grey', 0.45, 0.95)
    HOOF = blend('coal', 'stone_dark', 0.5)
    GLOW = 'rune'
    VOID = blend('coal', 'blue_dark', 0.3, 0.8)

    chest = V(0, 0, 1.6)            # body origin: chest-centre height
    neck = V(0, -0.72, 1.86)
    sh_f = V(0.25, -0.52, 1.5)
    sh_b = V(0.24, 0.66, 1.55)

    # ---------------- body -------------------------------------------------------
    b = Builder(seed=1101)
    tor = Head(chest, [(-0.96, 0, 0, 0, 0.06), (-0.9, 0.17, 0.2, 0, 0.06), (-0.76, 0.28, 0.31, 0, 0.04),
                       (-0.5, 0.29, 0.31, 0, 0.02), (-0.22, 0.24, 0.26, 0, 0.06), (0.06, 0.28, 0.33, 0, 0.0),
                       (0.36, 0.31, 0.37, 0, -0.03), (0.6, 0.28, 0.34, 0, -0.01), (0.76, 0.18, 0.24, 0, 0.04),
                       (0.82, 0, 0, 0, 0.07)])
    f = tor.build(b, seg=14, color=HIDE, jitter=0.012, var=0.07)
    paint(b, f, lambda c, f_: HIDE_D if c.z < chest.z - 0.22 else None)
    # gaunt ribs
    for k in range(5):
        t = -0.02 + k * 0.085
        for s in (-1, 1):
            pts = [tor.pt(180 - s * a, t + 0.025 * (a - 90) / 40, 0.002) for a in (62, 88, 114, 138)]
            sweep(b, pts, [0.012, 0.018, 0.016, 0.0], seg=4, color=HIDE_L)
    # hip bones, shoulder blades, spine ridge
    for s in (-1, 1):
        b.sphere(r=1, seg=6, rings=4, loc=tor.pt(180 - s * 52, -0.6, -0.035), scale=(0.07, 0.1, 0.05), color=HIDE)
    for k in range(9):
        t = -0.75 + k * 0.17
        p = tor.pt(180, t, -0.012)
        b.cone(r=0.04, h=0.05 + 0.025 * (k % 2), seg=4, loc=p, rot=(12, 0, 0), color=HIDE_L)
    # dark shaggy mane on the chest / withers
    rng = random.Random(21)
    for k in range(16):
        az = rng.uniform(-70, 70)
        t = rng.uniform(0.45, 0.8)
        p = tor.pt(az, t, -0.04)
        n = tor.normal(az, t)
        sweep(b, [p, p + n * 0.12 + V(0, -0.03, -0.2)], [0.085, 0.0], seg=4, color=MANE, jitter=0.012)
    for k in range(6):
        t = 0.3 + k * 0.09
        p = tor.pt(180, t, -0.03)
        sweep(b, [p, p + V(rng.uniform(-0.05, 0.05), 0.08, 0.14)], [0.07, 0.0], seg=4, color=MANE, jitter=0.01)
    body = part(b, 'body', chest, root, H, prefix=NAME)

    # ---------------- head: neck + skull face + antlers --------------------------
    b = Builder(seed=1102)
    npts = [neck + V(0, 0.08, -0.12), neck + V(0, -0.1, 0.18), neck + V(0, -0.3, 0.46), V(0, -1.15, 2.42)]
    sweep(b, npts, [0.26, 0.22, 0.17, 0.13], seg=8, color=HIDE, jitter=0.01)
    # mane along the neck
    for k in range(11):
        t = k / 10
        p = npts[0].lerp(npts[3], t)
        w = 0.1 - t * 0.03
        # crest along the top of the neck
        sweep(b, [p + V(0, 0.07, 0.1), p + V(rng.uniform(-0.05, 0.05), 0.24, 0.17 - t * 0.06)], [w, 0.0],
              seg=4, color=MANE, jitter=0.012)
        # heavy shaggy throat mane
        for sx in (-1, 1):
            sweep(b, [p + V(sx * 0.07, -0.06, -0.08), p + V(sx * 0.09 + rng.uniform(-0.03, 0.03), -0.06,
                                                           -0.4 + t * 0.14)],
                  [w, 0.0], seg=4, color=MANE if k % 3 else HIDE_D, jitter=0.014)
    sk = Head(V(0, -1.22, 2.46), [(-0.16, 0, 0, 0, 0.02), (-0.13, 0.11, 0.11, 0, 0.02), (-0.04, 0.155, 0.15, 0, 0.02),
                                   (0.06, 0.145, 0.13, 0, 0.0), (0.18, 0.1, 0.1, 0, -0.01), (0.34, 0.075, 0.085, 0, -0.01),
                                   (0.47, 0.06, 0.07, 0, -0.005), (0.51, 0, 0, 0, 0.0)], pitch=38)
    f = sk.build(b, seg=10, color=BONE, var=0.05)
    paint(b, f, lambda c, f_: HIDE if sk.local(c)[1] < -0.07 else None)
    # eye sockets with glowing eyes, nasal cavity
    for s, _ in SIDES:
        az, t = 180 - s * 58, 0.07
        p, n = sk.pt(az, t, 0.0), sk.normal(az, t)
        eye(b, p, n, 0.052, [dict(r=1.25, color=VOID, seg=8), dict(r=0.7, color='glow_blue', mat='emit', seg=7)],
            bulge=0.35, embed=0.5)
        # ears swept back
        e0 = sk.pt(180 - s * 95, -0.07, -0.01)
        sweep(b, [e0, e0 + V(s * 0.16, 0.12, 0.03)], [(0.06, 0.02), 0.0], seg=4, color=HIDE, up=(0, 0, 1))
    for s in (-1, 1):
        lens(b, sk.pt(180 - s * 22, 0.43, 0.0), sk.normal(180 - s * 22, 0.43), 0.022, 0.006, seg=5, color=VOID,
             sy=1.6)
    # teeth along the jaw line
    for k in range(4):
        for s in (-1, 1):
            q = sk.pt(s * 62, 0.2 + k * 0.07, 0.0)
            b.cone(r=0.012, h=0.03, seg=4, loc=q, rot=(180, 0, 0), color=BONE_D)
    # antlers
    for s, _ in SIDES:
        base = sk.pt(180 - s * 38, -0.02, -0.01)
        antler(b, base, s, beam=[(0.12, 0.03, 0.17), (0.32, 0.12, 0.3), (0.5, 0.16, 0.43), (0.62, 0.1, 0.56),
                                 (0.68, 0.0, 0.67), (0.7, -0.08, 0.74)],
               tines=[(1, (0.15, -1.0, 0.2), 0.34), (2, (0.3, -1.0, 0.4), 0.34), (3, (0.4, -0.9, 0.55), 0.3),
                      (4, (0.9, -0.2, 0.55), 0.26), (5, (-0.2, -0.5, 0.9), 0.2), (4, (0.2, 0.9, 0.5), 0.22)],
               r0=0.075, color=ANT, tip_col=GLOW, vein=GLOW)
        b.cyl(r1=0.085, r2=0.075, h=0.05, seg=6, loc=base + V(0, 0, -0.02), color=BONE_D, rot=(0, s * -20, 0))
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- legs ---------------------------------------------------------
    for s, sfx in SIDES:
        b = Builder(seed=1110 + s)
        top = V(s * sh_f.x, sh_f.y, sh_f.z)
        pts = [top + V(0, 0, 0.08), V(top.x, -0.46, 1.08), V(top.x, -0.53, 0.58), V(top.x, -0.5, 0.2),
               V(top.x, -0.55, 0.06)]
        deer_leg(b, pts, [0.13, 0.08, 0.055, 0.045, 0.05], HIDE, HOOF, tuft_col=MANE, knobs=(2, 3), seg=7)
        part(b, f'leg_f{sfx}', top, body, H, prefix=NAME)
    for s, sfx in SIDES:
        b = Builder(seed=1120 + s)
        top = V(s * sh_b.x, sh_b.y, sh_b.z)
        pts = [top + V(0, 0, 0.1), V(top.x, 0.5, 1.12), V(top.x, 0.8, 0.66), V(top.x, 0.7, 0.2),
               V(top.x, 0.66, 0.06)]
        deer_leg(b, pts, [0.16, 0.1, 0.06, 0.045, 0.05], HIDE, HOOF, tuft_col=MANE, knobs=(2, 3), seg=7)
        part(b, f'leg_b{sfx}', top, body, H, prefix=NAME)

    # ---------------- tail ---------------------------------------------------------
    b = Builder(seed=1130)
    tb = V(0, 0.92, 1.72)
    f = sweep(b, [tb, tb + V(0, 0.1, -0.06), tb + V(0, 0.14, -0.22)], [(0.07, 0.09), (0.06, 0.08), 0.0], seg=6,
              color=MANE, jitter=0.01)
    part(b, 'tail', tb, body, H, prefix=NAME)
    return root


# ===========================================================================
# Crow - small ambient / crop-stealing critter (0.35 m)
# ===========================================================================
def build_crow():
    NAME, H = 'critter_crow', 0.35
    root = make_root(NAME)
    FEATH = blend('feather_blk', 'blue', 0.32, 1.2)
    FEATH_D = blend('feather_blk', 'blue', 0.15, 1.0)
    BEAK = blend('iron_dark', 'stone_dark', 0.4)

    ctr = V(0, 0.0, 0.165)
    neck = V(0, -0.075, 0.215)

    # ---------------- body: tilted egg, wedge tail, tiny legs ------------------
    b = Builder(seed=1201)
    b.sphere(r=1, seg=10, rings=7, loc=ctr, rot=(-18, 0, 0), scale=(0.07, 0.125, 0.078), color=FEATH, var=0.06)
    for ax in (-14, 0, 14):
        a = math.radians(ax)
        p0 = V(0, 0.09, 0.15)
        d = V(math.sin(a) * 0.5, 1, -0.45).normalized()
        sweep(b, [p0, p0 + d * 0.09, p0 + d * 0.16], [(0.006, 0.03), (0.006, 0.034), 0.0], seg=4,
              color=FEATH_D if ax else FEATH, up=(0, 0.45, 1))
    for s in (-1, 1):
        hp = V(s * 0.028, -0.005, 0.1)
        ft = V(s * 0.03, -0.01, 0.012)
        sweep(b, [hp, ft], [0.009, 0.007], seg=4, color=BEAK)
        for ax in (-30, 0, 30, 180):
            a = math.radians(ax)
            sweep(b, [ft, ft + V(math.sin(a), -math.cos(a), 0) * (0.035 if ax != 180 else 0.022) + V(0, 0, -0.008)],
                  [0.005, 0.0], seg=3, color=BEAK)
    body = part(b, 'body', ctr, root, H, amt=0.12, prefix=NAME)

    # ---------------- head --------------------------------------------------------
    b = Builder(seed=1202)
    hc, hr = V(0, -0.098, 0.283), (0.052, 0.058, 0.055)
    b.sphere(r=1, seg=8, rings=6, loc=hc, scale=hr, color=FEATH, var=0.05)
    b.cyl(r1=0.04, r2=0.042, h=0.07, seg=6, loc=(0, -0.078, 0.2), rot=(-25, 0, 0), color=FEATH, cap=False)
    bk = [hc + V(0, -0.04, -0.004), hc + V(0, -0.085, -0.01), hc + V(0, -0.118, -0.022), hc + V(0, -0.128, -0.034)]
    sweep(b, bk, [(0.02, 0.016), (0.014, 0.011), (0.006, 0.005), 0.0], seg=6, color=BEAK, up=(0, 0, 1))
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 58, 14)
        eye(b, p, n, 0.013, [dict(r=1.0, color='eye', seg=6)], bulge=0.5, hl='white', hl_r=0.35)
    part(b, 'head', neck, body, H, amt=0.12, prefix=NAME)

    # ---------------- wings: flat, folded along the body --------------------------
    wing = [(0.0, 0.0), (0.03, 0.03), (0.09, 0.035), (0.16, 0.022), (0.21, 0.0), (0.245, -0.022),
            (0.215, -0.028), (0.23, -0.04), (0.19, -0.042), (0.2, -0.055), (0.14, -0.05), (0.06, -0.04),
            (0.0, -0.02)]
    from mathutils import Matrix
    for s, sfx in SIDES:
        b = Builder(seed=1210 + s)
        shp = V(s * 0.05, -0.055, 0.205)
        # local u -> back along the body, v -> up toward the spine, slab normal
        # tilted outward/up so the folded wing hugs the upper flank
        u = V(0, 1, -0.32).normalized()
        nf = V(0.8, 0, 0.6 * s).normalized()
        v = nf.cross(u).normalized()
        R3 = Matrix((u, v, nf)).transposed()
        out = V(s * 0.8, 0, 0.6).normalized()
        flat(b, wing, M4(shp + out * 0.022 + V(0, 0, -0.018), R3), thick=0.012, color=FEATH, var=0.08,
             seg_color=lambda i, n_, mid: FEATH_D if mid[0] > 0.15 else FEATH, centre=(0.06, -0.005))
        part(b, f'wing_{sfx}', shp, body, H, amt=0.12, prefix=NAME)
    return root


# ===========================================================================
# Red deer - ambient (1.50 m with antlers)
# ===========================================================================
def build_deer():
    NAME, H = 'critter_deer', 1.50
    root = make_root(NAME, col_r=0.5)
    FUR = blend('fur_brown', 'fur_fox', 0.38, 1.0)
    FUR_D = blend('fur_brown', 'fur_dark', 0.35)
    NECK = blend('fur_brown', 'fur_dark', 0.2, 1.0)
    CREAM = blend('fur_cream', 'fur_white', 0.3, 0.95)
    HOOF = blend('coal', 'stone_dark', 0.5)
    ANT = blend('bone_dark', 'wood_light', 0.4)

    chest = V(0, 0, 0.93)
    neck = V(0, -0.44, 1.08)
    sh_f = V(0.145, -0.32, 0.87)
    sh_b = V(0.135, 0.4, 0.91)

    # ---------------- body -----------------------------------------------------
    b = Builder(seed=1301)
    tor = Head(chest, [(-0.62, 0, 0, 0, 0.04), (-0.57, 0.13, 0.15, 0, 0.04), (-0.44, 0.2, 0.23, 0, 0.02),
                       (-0.2, 0.2, 0.235, 0, 0.0), (0.08, 0.205, 0.25, 0, -0.01), (0.3, 0.2, 0.24, 0, -0.01),
                       (0.46, 0.15, 0.19, 0, 0.02), (0.53, 0, 0, 0, 0.04)])
    f = tor.build(b, seg=12, color=FUR, jitter=0.004, var=0.05)

    def coat(c, f_):
        az, t, x, y = tor.local(c)
        if az < 55 or az > 305:
            return CREAM
        if t < -0.5 and (az < 150 or az > 210):
            return CREAM
        return None
    paint(b, f, coat)
    body = part(b, 'body', chest, root, H, prefix=NAME)

    # ---------------- head: neck, face, ears, small antlers ----------------------
    b = Builder(seed=1302)
    npts = [neck + V(0, 0.06, -0.08), neck + V(0, -0.08, 0.12), V(0, -0.64, 1.31)]
    f = sweep(b, npts, [(0.13, 0.11), (0.115, 0.095), (0.075, 0.07)], seg=8, color=NECK, up=(0, -1, 0), jitter=0.006)
    paint(b, f, lambda c, f_: CREAM if (c - npts[1]).y < -0.06 and c.z < 1.22 else None)
    # shaggy throat fur
    for k in range(4):
        q = npts[0].lerp(npts[2], 0.25 + k * 0.17)
        sweep(b, [q + V(0, -0.07, -0.02), q + V(0, -0.1, -0.12)], [(0.05, 0.06), 0.0], seg=4, color=NECK,
              up=(0, -1, 0))
    hd = Head(V(0, -0.68, 1.35), [(-0.1, 0, 0, 0, 0.0), (-0.08, 0.07, 0.07, 0, 0.0), (0.0, 0.09, 0.09, 0, 0.0),
                                 (0.08, 0.075, 0.075, 0, -0.01), (0.18, 0.05, 0.055, 0, -0.02),
                                 (0.25, 0.04, 0.045, 0, -0.022), (0.27, 0, 0, 0, -0.022)], pitch=40)
    f = hd.build(b, seg=10, color=FUR, var=0.04)
    paint(b, f, lambda c, f_: FUR_D if hd.local(c)[1] > 0.235 else (CREAM if (hd.local(c)[0] < 40 or hd.local(c)[0] > 320) else None))
    b.sphere(r=1, seg=6, rings=4, loc=hd.pt(180, 0.255, -0.005), scale=(0.026, 0.02, 0.018), color='coal')
    for s, _ in SIDES:
        p, n = hd.pt(180 - s * 62, 0.03, 0.0), hd.normal(180 - s * 62, 0.03)
        eye(b, p, n, 0.024, [dict(r=1.0, color='eye', seg=8)], bulge=0.5, hl='white', hl_r=0.3)
        e0 = hd.pt(180 - s * 70, -0.05, -0.005)
        f = sweep(b, [e0, e0 + V(s * 0.08, 0.03, 0.06), e0 + V(s * 0.15, 0.05, 0.08)],
                  [(0.03, 0.012), (0.035, 0.012), 0.0], seg=4, color=FUR, up=(0, -1, 0.4))
        a0 = hd.pt(180 - s * 30, -0.04, -0.005)
        beam = [a0, a0 + V(s * 0.03, 0.02, 0.06), a0 + V(s * 0.06, 0.0, 0.12), a0 + V(s * 0.07, -0.03, 0.17)]
        sweep(b, beam, [0.016, 0.013, 0.009, 0.0], seg=5, color=ANT)
        sweep(b, [beam[1], beam[1] + V(s * 0.01, -0.05, 0.04)], [0.009, 0.0], seg=4, color=ANT)
        sweep(b, [beam[2], beam[2] + V(s * 0.04, 0.02, 0.04)], [0.008, 0.0], seg=4, color=ANT)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- legs -------------------------------------------------------
    for s, sfx in SIDES:
        b = Builder(seed=1310 + s)
        top = V(s * sh_f.x, sh_f.y, sh_f.z)
        pts = [top + V(0, 0, 0.06), V(top.x, -0.29, 0.62), V(top.x, -0.33, 0.34), V(top.x, -0.31, 0.12),
               V(top.x, -0.34, 0.04)]
        deer_leg(b, pts, [0.085, 0.05, 0.032, 0.027, 0.029], FUR, HOOF, knobs=(2,))
        part(b, f'leg_f{sfx}', top, body, H, prefix=NAME)
    for s, sfx in SIDES:
        b = Builder(seed=1320 + s)
        top = V(s * sh_b.x, sh_b.y, sh_b.z)
        pts = [top + V(0, 0, 0.06), V(top.x, 0.32, 0.64), V(top.x, 0.5, 0.4), V(top.x, 0.44, 0.12),
               V(top.x, 0.41, 0.04)]
        deer_leg(b, pts, [0.11, 0.065, 0.034, 0.028, 0.029], FUR, HOOF, knobs=(2,))
        part(b, f'leg_b{sfx}', top, body, H, prefix=NAME)

    # ---------------- tail -------------------------------------------------------
    b = Builder(seed=1330)
    tb = V(0, 0.6, 0.99)
    f = sweep(b, [tb, tb + V(0, 0.05, -0.04), tb + V(0, 0.06, -0.1)], [(0.035, 0.04), (0.03, 0.035), 0.0], seg=5,
              color=FUR_D)
    part(b, 'tail', tb, body, H, prefix=NAME)
    return root


BUILDERS = [build_gloamling, build_wraith, build_draugr, build_boss_stag, build_crow, build_deer]

# rig contract checked at build time (names the game code relies on)
_BIPED = ['body', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'hand_l', 'hand_r']
_QUAD = ['body', 'head', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br', 'tail']
REQUIRED = {
    'enemy_gloamling': _BIPED,
    'enemy_wraith': ['body', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'],
    'enemy_draugr': _BIPED,
    'boss_stag': _QUAD,
    'critter_crow': ['body', 'head', 'wing_l', 'wing_r'],
    'critter_deer': _QUAD,
}


def build(out_dir):
    reset_scene()
    roots = [fn() for fn in BUILDERS]
    problems = check_names(roots, REQUIRED)
    if problems:
        raise RuntimeError('rig contract broken: ' + '; '.join(problems))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'enemies.glb')
    export_glb(path, roots)
    clean_glb_names(path)
    s = stats(roots)
    for k, v in s.items():
        print(f'  {k:16s} {v:5d} tris')
    return s


if __name__ == '__main__':
    build(os.path.normpath(os.path.join(HERE, '..', 'assets', 'models')))
