"""
build_characters.py - the player and the six villagers of Gloamhollow.

    python blender/build_characters.py        (exports assets/models/characters.glb)

Every character is an empty root at the ground with rigid parts whose
origins sit on the joints (see ASSETS.md "Character rig"):
    body (hip) -> head (neck base), arm_l / arm_r (shoulders, with hand_l /
    hand_r grip sockets), leg_l / leg_r (hips) + optional extras.
Front faces Blender -Y, the character's left is +X.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401  (bpy must be imported before ghlib's bmesh use)

from ghlib import export_glb, reset_scene, stats  # noqa: E402
from rig_helpers import (M4, Builder, Head, Prof, V, az_pt, bird_foot, blend, boot,  # noqa: E402
                         check_names, clean_glb_names, deform, deg, ell_pt,
                         eye, feather_fingers, flat, frame_z, hand_socket,
                         lathe, lens, loft, make_root, mottle, paint, part,
                         paw, ram_horn, rotx, rotz, shell, socket, sweep, tint)

SIDES = ((1, 'l'), (-1, 'r'))   # +X is the character's left


# ===========================================================================
# Corvin the raven - merchant & moneylender (1.60 m)
# ===========================================================================
def build_corvin():
    NAME, H = 'npc_corvin', 1.60
    root = make_root(NAME, col_r=0.35)
    FEATH = blend('feather_blk', 'blue', 0.38, 1.12)
    FEATH_D = blend('feather_blk', 'blue', 0.15)
    RED, RED_D = tint('red', 1.08), tint('red_dark', 1.1)
    GOLD = 'gold'
    VEST = blend('ochre', 'wood', 0.45)
    BEAK = blend('bone_dark', 'stone_light', 0.4)
    LEGC = blend('iron_dark', 'stone_dark', 0.5)
    CLAW = blend('bone_dark', 'black', 0.35)

    hip = V(0, 0, 0.46)
    neck = V(0, 0.0, 0.95)
    sh = V(0.226, 0.0, 0.852)

    # ---------------- body: frock coat ----------------------------------------
    b = Builder(seed=101)
    rings = [(0.285, 0.232, 0.215, 0, 0.02), (0.315, 0.228, 0.212, 0, 0.018),
             (0.40, 0.205, 0.195, 0, 0.008), (0.50, 0.184, 0.186, 0, -0.004),
             (0.535, 0.182, 0.185, 0, -0.008), (0.575, 0.181, 0.184, 0, -0.01),
             (0.67, 0.178, 0.176, 0, -0.01), (0.76, 0.178, 0.163, 0, -0.004),
             (0.83, 0.186, 0.152, 0, 0.004), (0.878, 0.172, 0.138, 0, 0.008),
             (0.92, 0.135, 0.118, 0, 0.01), (0.948, 0.085, 0.085, 0, 0.01),
             (0.955, 0.0, 0.0, 0, 0.01)]
    pr = Prof(rings)
    coat = loft(b, rings, seg=12, color=RED, jitter=0.003, var=0.05)
    paint(b, coat, lambda c, f: GOLD if c.z < 0.312 else ('leather_dk' if 0.53 < c.z < 0.58 else None))
    # coat tails hang lower at the back
    deform(coat, lambda v: V(v.x, v.y, v.z - 0.05 * max(0.0, v.y) / 0.21) if v.z < 0.33 else v)
    # waistcoat V (panel on the chest) + gold edges down to the hem
    vz = (0.585, 0.66, 0.74, 0.81, 0.875)
    vw = lambda z: 6 + (z - 0.585) / 0.29 * 32
    shell(b, [pr.ring(z, 0.006, -vw(z), vw(z)) for z in vz], 0, 0, seg=4, thick=0.01,
          color=VEST, var=0.06, back=False)
    for s in (-1, 1):
        pts = [pr.pt(0, 0.32, 0.008), pr.pt(0, 0.45, 0.009)] + [pr.pt(s * vw(z), z, 0.012) for z in vz]
        sweep(b, pts, [(0.013, 0.02)] * len(pts), seg=4, color=GOLD, mat='metal', up=(0, -1, 0))
    for z in (0.63, 0.70, 0.77):
        lens(b, pr.pt(0, z, 0.01), (0, -1, 0.1), 0.019, 0.013, seg=6, color=GOLD, mat='metal')
    # two gold buttons at the back waist (frock-coat style)
    for sgn in (-1, 1):
        lens(b, pr.pt(180 + sgn * 16, 0.6, 0.004), pr.normal(180 + sgn * 16, 0.6), 0.017, 0.012, seg=6,
             color=GOLD, mat='metal')
    # back vent
    sweep(b, [pr.pt(180, 0.30, -0.02) + V(0, 0.0, -0.06), pr.pt(180, 0.47, 0.004)], [(0.006, 0.01)] * 2,
          seg=3, color=RED_D)
    # watch chain to a pocket watch
    chain = [pr.pt(0, 0.70, 0.012), pr.pt(12, 0.665, 0.012), pr.pt(26, 0.648, 0.012), pr.pt(40, 0.655, 0.012)]
    sweep(b, chain, 0.0065, seg=4, color=GOLD, mat='metal', cap_start=False, cap_end=False)
    lens(b, pr.pt(42, 0.648, 0.008), pr.normal(42, 0.648), 0.03, 0.013, seg=8, color=GOLD, mat='metal')
    # buckle
    b.box((0.062, 0.02, 0.05), loc=pr.pt(0, 0.555, 0.006), color=GOLD, mat='metal')
    # coin purse on the right hip (hangs from the belt)
    pc = pr.pt(-52, 0.52, 0.045) * 1.0
    pc.z = 0.0
    f = lathe(b, [(0.0, 0.385), (0.04, 0.39), (0.06, 0.42), (0.056, 0.46), (0.026, 0.49),
                  (0.022, 0.50), (0.04, 0.515), (0.0, 0.52)], seg=6, M=M4(pc),
              color=blend('purple', 'red_dark', 0.4, 1.3), jitter=0.002)
    paint(b, f, lambda c, f_: (GOLD, 'metal') if 0.488 < c.z < 0.505 else None)
    lens(b, pc + V(-0.018, -0.052, 0.44), pr.normal(-52, 0.45), 0.022, 0.008, seg=7, color=GOLD, mat='metal')
    # left pocket flap
    shell(b, [pr.ring(0.425, 0.01), pr.ring(0.465, 0.014)], 28, 62, seg=3, thick=0.012, color=RED_D, back=False)
    # rolled collar around the back of the neck, gold-edged
    col_r = [(0.86, 0.172, 0.14, 0, 0.012), (0.93, 0.152, 0.13, 0, 0.018), (1.02, 0.172, 0.158, 0, 0.03)]
    shell(b, col_r, 40, 320, seg=8, thick=0.022, color=RED_D)
    sweep(b, [az_pt(math.radians(a), 0.172, 0.158, 0, 0.03, 1.021) for a in (40, 96, 152, 208, 264, 320)],
          0.009, seg=4, color=GOLD, mat='metal')
    # linen jabot at the throat
    b.sphere(r=1, seg=6, rings=4, loc=(0, -0.122, 0.885), scale=(0.036, 0.028, 0.03), color='linen', var=0.03)
    b.prism([(-0.042, 0), (0.042, 0), (0.014, -0.1), (-0.014, -0.1)], 0.018, loc=(0, -0.13, 0.88),
            rot=(90, 0, 0), color='linen', var=0.05)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- tail (fan of feathers out of the coat vent) --------------
    b = Builder(seed=103)
    tb = V(0, 0.16, 0.42)
    for ax in (-26, -13, 0, 13, 26):
        a = math.radians(ax)
        d = V(math.sin(a) * 0.6, 0.8, -0.5).normalized()
        ln = 0.28 - abs(ax) * 0.0022
        sweep(b, [tb + V(0, -0.03, 0.02), tb + d * ln * 0.6, tb + d * ln],
              [(0.012, 0.045), (0.012, 0.055), 0.0], seg=4, color=FEATH if ax % 26 else FEATH_D,
              up=(0, 0.5, 0.8))
    part(b, 'tail', tb, body, H, prefix=NAME)

    # ---------------- head ----------------------------------------------------
    b = Builder(seed=102)
    hc, hr = V(0, 0.0, 1.29), (0.235, 0.252, 0.268)
    b.sphere(r=1, seg=12, rings=7, loc=hc, scale=hr, color=FEATH, var=0.05)
    b.cyl(r1=0.145, r2=0.13, h=0.2, seg=8, loc=(0, 0.012, 0.91), color=FEATH_D, jitter=0.008)
    # swept-back crown feathers
    for dx, ln, w in ((0.0, 0.21, 0.055), (0.07, 0.15, 0.045), (-0.07, 0.15, 0.045)):
        p0 = hc + V(dx, -0.09, 0.24 - abs(dx) * 0.5)
        p1 = p0 + V(dx * 0.8, ln, ln * 0.2)
        sweep(b, [p0, (p0 + p1) / 2 + V(0, 0, 0.022), p1], [(w * 0.55, w), (w * 0.45, w * 0.8), 0.0],
              seg=4, color=FEATH, up=(0, 0, 1))
    # shaggy nape feathers bridging down to the collar
    for k, (az, el, ln) in enumerate(((180, -20, 0.16), (150, 0, 0.13), (210, 0, 0.13), (165, 25, 0.12),
                                      (195, 25, 0.12))):
        p0, n0 = ell_pt(hc, hr, az, el)
        d = (n0 * 0.12 + V(0, 0.1, -1)).normalized()
        sweep(b, [p0 - n0 * 0.012, p0 + n0 * 0.006 + d * ln * 0.5, p0 + n0 * 0.0 + d * ln],
              [(0.02, 0.05), (0.018, 0.045), 0.0], seg=4, color=FEATH if k % 2 else FEATH_D, up=n0)
    # shaggy throat hackles
    for dx in (-0.075, 0.0, 0.075):
        sweep(b, [V(dx, -0.12, 1.14), V(dx * 1.25, -0.175, 1.02 - abs(dx) * 0.35)],
              [(0.04, 0.03), 0.0], seg=4, color=FEATH)
    # beak: deep base, slight hook
    bk = [(0, -0.15, 1.255), (0, -0.27, 1.242), (0, -0.38, 1.218), (0, -0.455, 1.183), (0, -0.482, 1.14)]
    sweep(b, bk, [(0.098, 0.078), (0.08, 0.062), (0.054, 0.04), (0.027, 0.021), 0.0],
          seg=8, color=BEAK, var=0.03, up=(0, 0, 1))
    for sx in (-1, 1):
        sweep(b, [(sx * 0.064, -0.2, 1.233), (sx * 0.05, -0.32, 1.213), (sx * 0.022, -0.43, 1.177)],
              0.006, seg=3, color=blend('bone_dark', 'black', 0.65))
    # bristle tuft over the beak base
    b.sphere(r=1, seg=6, rings=4, loc=(0, -0.2, 1.308), rot=(-12, 0, 0),
             scale=(0.06, 0.1, 0.045), color=FEATH)
    # eyes + sly brows
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 38, 13)
        eye(b, p, n, 0.074, [dict(r=1.0, color='white'),
                             dict(r=0.62, color='eye', dx=-s * 0.08)],
            bulge=0.34, hl='fire_hot', hl_mat='emit', hl_r=0.22)
        q0, n0 = ell_pt(hc, hr, s * 22, 30)
        q1, n1 = ell_pt(hc, hr, s * 52, 35)
        sweep(b, [q0 + n0 * 0.012, (q0 + q1) / 2 + (n0 + n1) * 0.012, q1 + n1 * 0.008],
              [(0.02, 0.014), (0.022, 0.016), (0.01, 0.01)], seg=4, color=FEATH_D)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms (belled velvet sleeves + feather fingers) ----------
    for s, sfx in SIDES:
        b = Builder(seed=110 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp, scale=(0.056, 0.058, 0.058), color=RED)
        wr = sp + V(s * 0.014, 0, -0.29)
        sweep(b, [sp + V(0, 0, -0.01), sp + V(s * 0.006, 0, -0.15), wr + V(0, 0, 0.02)],
              [0.056, 0.053, 0.064], seg=8, color=RED, jitter=0.002, cap_start=False)
        # turned-back cuff with gold edge
        f = lathe(b, [(0.062, -0.01), (0.077, 0.0), (0.079, 0.042), (0.084, 0.048), (0.077, 0.058)],
                  seg=8, M=M4(wr), color=RED_D, cap_bottom=True, cap_top=False)
        paint(b, f, lambda c, f_: (GOLD, 'metal') if c.z > wr.z + 0.043 else None)
        # feather fingers
        for ax, ln in ((-34, 0.11), (-12, 0.14), (12, 0.14), (34, 0.11)):
            a = math.radians(ax)
            d = V(s * 0.1, math.sin(a) * 0.75, -1).normalized()
            p0 = wr + V(0, math.sin(a) * 0.03, 0.0)
            sweep(b, [p0, p0 + d * ln * 0.55, p0 + d * ln], [(0.026, 0.011), (0.03, 0.011), 0.0],
                  seg=4, color=FEATH, up=(s, 0, 0))
        grip = wr + V(s * 0.006, 0, -0.065)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs (feathered thigh, thin scaly shank, talons) -------
    for s, sfx in SIDES:
        b = Builder(seed=120 + s)
        hp = V(s * 0.095, 0, hip.z)
        b.sphere(r=1, seg=6, rings=4, loc=hp + V(0, 0, -0.04), scale=(0.07, 0.07, 0.09), color=FEATH)
        sweep(b, [hp + V(0, 0, -0.06), hp + V(0, 0.005, -0.17)], [0.066, 0.046], seg=6,
              color=FEATH, jitter=0.003)
        ank = V(hp.x, 0.005, 0.045)
        sweep(b, [hp + V(0, 0.005, -0.16), ank], [0.027, 0.023], seg=6, color=LEGC)
        b.sphere(r=1, seg=6, rings=4, loc=ank, scale=(0.03, 0.03, 0.028), color=LEGC)
        bird_foot(b, ank, s, LEGC, CLAW, toe=0.15, r=0.02)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# Morrow the owl - keeper of the Barrow (1.35 m)
# ===========================================================================
def build_morrow():
    NAME, H = 'npc_morrow', 1.35
    root = make_root(NAME, col_r=0.35)
    OWL = tint('feather_owl')
    OWL2 = blend('feather_owl', 'fur_grey', 0.55)
    OWL3 = blend('feather_owl', 'fur_brown', 0.6, 0.9)
    CREAM = tint('fur_cream', 0.97)
    RIM = blend('fur_brown', 'feather_owl', 0.3, 0.8)
    ROBE = blend('blue', 'slate', 0.35, 1.05)
    COWL = blend('purple', 'slate', 0.35, 1.1)
    BONE = 'bone'
    TAL = blend('bone_dark', 'black', 0.45)
    AMBER = (0.52, 0.33, 0.085)

    hip = V(0, 0, 0.27)
    neck = V(0, 0.0, 0.70)
    sh = V(0.262, 0.01, 0.585)

    # ---------------- body: round robed owl -----------------------------------
    b = Builder(seed=201)
    rings = [(0.05, 0.255, 0.25, 0, 0.0), (0.09, 0.27, 0.27, 0, -0.005),
             (0.2, 0.235, 0.265, 0, -0.012), (0.33, 0.205, 0.255, 0, -0.018),
             (0.45, 0.2, 0.245, 0, -0.02), (0.56, 0.195, 0.225, 0, -0.012),
             (0.64, 0.17, 0.19, 0, -0.004), (0.70, 0.12, 0.13, 0, 0.0), (0.715, 0.0, 0.0, 0, 0.0)]
    pr = Prof(rings)
    robe = loft(b, rings, seg=12, color=ROBE, jitter=0.003, var=0.05)
    paint(b, robe, lambda c, f: COWL if c.z < 0.075 else None)
    # mottled chest bib showing between the cowl ends
    bz = (0.40, 0.48, 0.56, 0.64)
    bw = lambda z: 8 + (z - 0.40) / 0.24 * 30
    bib = shell(b, [pr.ring(z, 0.006, -bw(z), bw(z)) for z in bz], 0, 0, seg=4, thick=0.01,
                color=CREAM, back=False)
    paint(b, bib, mottle([CREAM, CREAM, blend('fur_cream', 'feather_owl', 0.35)], 3))
    # robe front edges (bone-dark piping)
    for sgn in (-1, 1):
        pts = [pr.pt(0, 0.06, 0.004), pr.pt(0, 0.3, 0.004)] + [pr.pt(sgn * bw(z), z, 0.01) for z in bz]
        sweep(b, pts, [(0.009, 0.014)] * len(pts), seg=4, color='bone_dark', up=(0, -1, 0))
    # sash / belt with a small bone buckle
    shell(b, [pr.ring(0.36, 0.008), pr.ring(0.40, 0.008)], -180, 180, seg=12, thick=0.012,
          color=blend('leather_dk', 'purple', 0.3), edge=False, back=False)
    lens(b, pr.pt(0, 0.38, 0.012), (0, -1, 0), 0.03, 0.012, seg=6, color='bone_dark')
    # cowl: a thick soft roll over the shoulders + hood lying on the back
    cowl = [(0.555, 0.262, 0.272, 0, 0.0), (0.60, 0.29, 0.29, 0, 0.004), (0.66, 0.272, 0.275, 0, 0.008),
            (0.715, 0.215, 0.225, 0, 0.01), (0.75, 0.16, 0.175, 0, 0.012)]
    shell(b, cowl, -152, 152, seg=14, thick=0.05, color=COWL, jitter=0.004)
    # the hood itself, lying down the back like a soft pointed pouch
    shell(b, [(0.34, 0.2, 0.25, 0, 0.06, 176, 184), (0.42, 0.22, 0.272, 0, 0.06, 158, 202),
              (0.5, 0.245, 0.285, 0, 0.05, 142, 218), (0.58, 0.272, 0.295, 0, 0.03, 136, 224)],
          0, 0, seg=4, thick=0.035, color=blend('purple', 'slate', 0.45, 0.95), jitter=0.004)
    # bone clasp at the throat
    for sgn in (-1, 1):
        lens(b, pr.pt(sgn * 14, 0.655, 0.07), (sgn * 0.3, -1, 0.1), 0.026, 0.018, seg=6, color=BONE)
    b.box((0.07, 0.018, 0.018), loc=pr.pt(0, 0.655, 0.085), color=BONE)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- head -----------------------------------------------------
    b = Builder(seed=202)
    hc, hr = V(0, 0.0, 0.955), (0.275, 0.25, 0.245)
    f = b.sphere(r=1, seg=12, rings=8, loc=hc, scale=hr, color=OWL, var=0.06)
    paint(b, f, mottle([OWL, OWL, OWL2, OWL3], 5))
    b.cyl(r1=0.15, r2=0.16, h=0.12, seg=8, loc=(0, 0.0, 0.68), color=OWL3, jitter=0.006)
    # facial disc (two cream discs with a brown rim) + huge amber eyes
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 25, 2)
        eye(b, p, n, 0.086, [
            dict(r=1.62, color=RIM, var=0.04, seg=12),
            dict(r=1.48, color=CREAM, var=0.03, seg=12),
            dict(r=1.0, color=AMBER, mat='emit', seg=12),
            dict(r=0.56, color='eye', seg=10),
        ], bulge=0.2, hl='white', hl_r=0.22)
        # stern brow feathers
        q0, n0 = ell_pt(hc, hr, s * 8, 22)
        q1, n1 = ell_pt(hc, hr, s * 46, 30)
        sweep(b, [q0 + n0 * 0.03, (q0 + q1) / 2 + (n0 + n1) * 0.02, q1 + n1 * 0.012],
              [(0.022, 0.03), (0.024, 0.032), 0.0], seg=4, color=OWL3)
        # ear tufts
        e0 = hc + V(s * 0.15, -0.02, 0.19)
        for k, (dx, ln) in enumerate(((0.0, 0.17), (0.045, 0.12))):
            e1 = e0 + V(s * (0.06 + dx), 0.03 + dx * 0.5, ln)
            sweep(b, [e0 + V(s * dx, 0.0, 0), (e0 + e1) / 2 + V(s * 0.012, 0, 0), e1],
                  [(0.03, 0.045), (0.024, 0.04), 0.0], seg=4, color=OWL3 if k == 0 else OWL2,
                  up=(0, -1, 0))
    # small hooked beak
    bk = [(0, -0.2, 0.93), (0, -0.265, 0.915), (0, -0.285, 0.875), (0, -0.27, 0.845)]
    sweep(b, bk, [(0.036, 0.03), (0.03, 0.025), (0.016, 0.014), 0.0], seg=6,
          color=blend('beak', 'bone_dark', 0.55), var=0.03, up=(0, -1, 0))
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms: wide robe sleeves, feather hands -------------------
    for s, sfx in SIDES:
        b = Builder(seed=210 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=6, loc=sp + V(0, 0, -0.01), scale=(0.058, 0.06, 0.05), color=ROBE)
        wr = sp + V(s * 0.012, -0.005, -0.21)
        sweep(b, [sp + V(0, 0, -0.01), sp + V(s * 0.006, 0, -0.1), wr + V(0, 0, 0.01)],
              [0.058, 0.06, 0.078], seg=8, color=ROBE, jitter=0.002, cap_start=False)
        f = lathe(b, [(0.07, -0.012), (0.084, 0.0), (0.084, 0.03), (0.07, 0.036)], seg=8,
                  M=M4(wr), color=COWL, cap_top=False)
        feather_fingers(b, wr + V(0, 0, -0.005), s, OWL3, n=3, ln=0.1, w=0.026, spread=26, out=0.05)
        grip = wr + V(s * 0.004, 0, -0.06)
        if s > 0:
            # lantern hanging from the left hand
            lc = grip + V(0, -0.005, -0.15)
            IRON = blend('iron_dark', 'iron', 0.4)
            sweep(b, [grip + V(0, 0, 0.01), grip + V(0, 0, -0.03), lc + V(0, 0, 0.1)], 0.006, seg=4,
                  color=IRON, mat='metal')
            b.cone(r=0.075, h=0.06, seg=6, loc=lc + V(0, 0, 0.07), color=IRON, mat='metal')
            b.cyl(r1=0.07, h=0.02, seg=6, loc=lc + V(0, 0, 0.055), color=IRON, mat='metal')
            b.cyl(r1=0.052, h=0.11, seg=6, loc=lc + V(0, 0, -0.055), color='fire', mat='emit')
            for k in range(6):
                a = 2 * math.pi * (k + 0.5) / 6
                q = lc + V(math.cos(a) * 0.058, math.sin(a) * 0.058, 0)
                b.box((0.012, 0.012, 0.12), loc=q, rot=(0, 0, math.degrees(a)), color=IRON, mat='metal')
            b.cyl(r1=0.068, r2=0.06, h=0.03, seg=6, loc=lc + V(0, 0, -0.085), color=IRON, mat='metal')
            b.sphere(r=0.012, seg=4, rings=3, loc=lc + V(0, 0, 0.135), color=IRON, mat='metal')
            arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
            socket('light', lc, arm)
        else:
            arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: stubby feathered legs, big talons -----------------
    for s, sfx in SIDES:
        b = Builder(seed=220 + s)
        hp = V(s * 0.095, 0, hip.z)
        sweep(b, [hp + V(0, 0, 0.03), hp + V(0, -0.01, -0.12), V(hp.x, -0.02, 0.07)],
              [0.07, 0.068, 0.055], seg=6, color=OWL3, jitter=0.004)
        ank = V(hp.x, -0.03, 0.045)
        bird_foot(b, ank, s, blend('beak', 'bone_dark', 0.6, 0.8), TAL, toe=0.1, r=0.022)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# Bramble the badger - gruff smith (1.50 m)
# ===========================================================================
def build_bramble():
    NAME, H = 'npc_bramble', 1.50
    root = make_root(NAME, col_r=0.35)
    FUR = blend('fur_grey', 'stone', 0.3)
    WHITE = blend('fur_white', 'bone', 0.3, 0.97)
    BLACK = blend('fur_dark', 'black', 0.35)
    SHIRT = blend('blue', 'wool', 0.38, 1.0)
    TROU = blend('wood_grey', 'slate', 0.4, 0.9)
    APRON = tint('leather', 1.1)
    APRON_D = tint('leather_dk', 1.05)
    SOOT = blend('coal', 'fur_dark', 0.4)

    hip = V(0, 0, 0.40)
    neck = V(0, 0.0, 0.88)
    sh = V(0.322, 0.0, 0.8)

    # ---------------- body -----------------------------------------------------
    b = Builder(seed=301)
    rings = [(0.33, 0.205, 0.175, 0, 0.012), (0.42, 0.235, 0.2, 0, 0.0),
             (0.47, 0.245, 0.21, 0, -0.005), (0.55, 0.255, 0.222, 0, -0.012),
             (0.67, 0.256, 0.226, 0, -0.012), (0.75, 0.262, 0.214, 0, -0.002),
             (0.81, 0.272, 0.198, 0, 0.006), (0.865, 0.235, 0.172, 0, 0.012),
             (0.91, 0.16, 0.135, 0, 0.016), (0.935, 0.0, 0.0, 0, 0.016)]
    pr = Prof(rings)
    tor = loft(b, rings, seg=12, color=SHIRT, jitter=0.003, var=0.05)
    paint(b, tor, lambda c, f: TROU if c.z < 0.445 else None)
    # belt
    shell(b, [pr.ring(0.43, 0.01), pr.ring(0.475, 0.012)], -180, 180, seg=12, thick=0.02,
          color='leather_dk', edge=False, back=False)
    # heavy apron: bib + skirt to the knees
    az = [(0.25, 80), (0.33, 78), (0.43, 82), (0.52, 60), (0.62, 42), (0.72, 38), (0.80, 36)]
    arings = []
    for z, w in az:
        zz, rx, ry, cx, cy = pr.at(max(z, 0.33))
        flare = max(0.0, 0.33 - z) * 0.35
        arings.append((z, rx + 0.018 + flare, ry + 0.022 + flare, cx, cy - flare * 0.6, -w, w))
    ap = shell(b, arings, 0, 0, seg=6, thick=0.022, color=APRON, jitter=0.002, back=False)
    paint(b, ap, lambda c, f: APRON_D if (c.z < 0.265 or c.z > 0.79) else None)
    # pocket with tongs sticking out
    pk = [pr.ring(z, 0.043) for z in (0.5, 0.58)]
    shell(b, [r + (-24, 24) for r in pk], 0, 0, seg=3, thick=0.016, color=APRON_D, back=False)
    tp = pr.pt(10, 0.58, 0.05)
    for dx in (-0.012, 0.012):
        sweep(b, [tp + V(dx, 0.0, -0.04), tp + V(dx * 2.5, -0.01, 0.1), tp + V(dx * 3.5, -0.012, 0.14)],
              0.008, seg=4, color='iron_dark', mat='metal')
    # neck strap & ties
    for sgn in (-1, 1):
        sweep(b, [pr.pt(sgn * 34, 0.8, 0.026), pr.pt(sgn * 42, 0.86, 0.02) + V(0, 0, 0.02),
                  pr.pt(sgn * 90, 0.9, 0.0) + V(sgn * -0.03, 0.02, 0.0), V(0, 0.12, 0.905)],
              [(0.01, 0.022)] * 4, seg=4, color=APRON_D, up=(0, 0, 1))
    shell(b, [pr.ring(0.495, 0.012), pr.ring(0.52, 0.012)], 70, 290, seg=8, thick=0.014,
          color=APRON_D, edge=False, back=False)
    b.box((0.06, 0.03, 0.08), loc=pr.pt(180, 0.47, 0.02), color=APRON_D)
    # smith's neckerchief
    KER = blend('red', 'rust', 0.35, 1.05)
    lathe(b, [(0.2, 0.855), (0.205, 0.885), (0.19, 0.93), (0.165, 0.955), (0.0, 0.96)], seg=10,
          M=M4((0, 0.02, 0)), color=KER, jitter=0.004, sy=0.92)
    b.sphere(r=1, seg=6, rings=4, loc=(0, -0.175, 0.89), scale=(0.045, 0.03, 0.035), color=KER)
    b.prism([(-0.07, 0), (0.07, 0), (0.0, -0.1)], 0.02, loc=(0, -0.168, 0.885), rot=(80, 0, 0),
            color=blend('red', 'rust', 0.35, 0.95))
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- head -----------------------------------------------------
    b = Builder(seed=302)
    hd = Head((0, 0.03, 1.175), [
        (-0.278, 0, 0, 0, 0.03), (-0.262, 0.095, 0.09, 0, 0.03), (-0.228, 0.168, 0.16, 0, 0.03),
        (-0.17, 0.225, 0.214, 0, 0.03),
        (-0.1, 0.262, 0.248, 0, 0.028), (0.0, 0.272, 0.258, 0, 0.022), (0.09, 0.255, 0.232, 0, 0.008),
        (0.17, 0.198, 0.176, 0, -0.024), (0.245, 0.12, 0.104, 0, -0.058), (0.305, 0.072, 0.066, 0, -0.072),
        (0.325, 0, 0, 0, -0.074)])
    f = hd.build(b, seg=12, color=WHITE, var=0.04)
    paint(b, f, lambda c, f_: FUR if c.y > 0.15 else None)
    b.cyl(r1=0.17, r2=0.16, h=0.12, seg=6, loc=(0, 0.03, 0.86), color=FUR, cap=False)
    # the two black stripes, nose to nape (raised panels)
    strip = [(-0.262, 10, 20), (-0.225, 13, 30), (-0.16, 15, 40), (-0.08, 16, 50), (0.03, 16, 56), (0.12, 15, 54),
             (0.2, 13, 38), (0.268, 12, 24)]
    for sgn in (-1, 1):
        rr = []
        for t, w0, w1 in strip:
            a0, a1 = (180 - w1, 180 - w0) if sgn > 0 else (180 + w0, 180 + w1)
            rr.append(hd.ring(t, 0.016, a0, a1))
        hd.shell(b, rr, seg=3, thick=0.024, color=BLACK, var=0.04, back=False)
    # eyes (in the stripes), grumpy lids
    for s, _ in SIDES:
        az_e, t_e = 180 - s * 44, 0.115
        p, n = hd.pt(az_e, t_e, 0.02), hd.normal(az_e, t_e)
        eye(b, p, n, 0.056, [dict(r=1.0, color='white', sy=0.86),
                             dict(r=0.6, color='eye', dx=-s * 0.1, dy=-0.05)],
            bulge=0.36, hl='white', hl_r=0.24)
        q0 = hd.pt(180 - s * 26, 0.14, 0.04)
        q1 = hd.pt(180 - s * 60, 0.105, 0.036)
        sweep(b, [q0, (q0 + q1) / 2 + n * 0.012, q1], [(0.016, 0.02), (0.02, 0.026), (0.012, 0.016)],
              seg=4, color=BLACK)
        # small round ears
        pe, ne = hd.pt(180 - s * 72, -0.11, 0.0), hd.normal(180 - s * 72, -0.11)
        ne = (ne + V(0, 0.3, 0.8)).normalized()
        lens(b, pe - ne * 0.02, ne, 0.056, 0.05, seg=8, color=WHITE, rings=2)
        lens(b, pe + ne * 0.004, ne, 0.04, 0.03, seg=8, color=BLACK, rings=2)
    # nose + mouth
    b.sphere(r=1, seg=8, rings=5, loc=hd.pt(0, 0.312, 0) + V(0, 0, 0.06), scale=(0.048, 0.035, 0.036),
             color=blend('black', 'fur_dark', 0.3))
    sweep(b, [hd.pt(-30, 0.27, 0.002), hd.pt(0, 0.285, 0.004), hd.pt(30, 0.27, 0.002)], 0.006, seg=3,
          color=BLACK)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms: rolled sleeves, thick fur forearms, sooty paws ----
    for s, sfx in SIDES:
        b = Builder(seed=310 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp + V(-s * 0.012, 0, -0.005), scale=(0.078, 0.08, 0.07), color=SHIRT)
        el = sp + V(s * 0.004, 0, -0.17)
        sweep(b, [sp + V(0, 0, -0.01), el], [0.074, 0.07], seg=8, color=SHIRT, cap_start=False)
        lathe(b, [(0.07, -0.03), (0.086, -0.022), (0.09, 0.012), (0.074, 0.022)], seg=8, M=M4(el),
              color=blend('linen', 'wood_light', 0.3), jitter=0.004)
        wr = el + V(s * 0.004, 0, -0.17)
        sweep(b, [el + V(0, 0, -0.01), el + V(0, 0, -0.1), wr], [0.074, 0.084, 0.07], seg=8, color=FUR,
              jitter=0.004)
        paw(b, wr, s, FUR, soot=SOOT, size=1.4, down=0.065)
        grip = wr + V(s * 0.004, -0.005, -0.075)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: dark trousers + heavy boots -----------------------
    for s, sfx in SIDES:
        b = Builder(seed=320 + s)
        hp = V(s * 0.12, 0, hip.z)
        b.sphere(r=1, seg=6, rings=4, loc=hp + V(0, 0, -0.02), scale=(0.11, 0.11, 0.1), color=TROU)
        sweep(b, [hp + V(0, 0, -0.04), hp + V(0, 0.0, -0.22)], [0.108, 0.094], seg=8, color=TROU,
              jitter=0.003)
        boot(b, hp, s, ank_z=0.2, color=blend('leather_dk', 'leather', 0.3), cuff=blend('leather', 'leather_dk', 0.3),
             toe=0.17, r=0.095)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# Mothwyn the moth - shy lamplighter (1.40 m)
# ===========================================================================
def build_mothwyn():
    NAME, H = 'npc_mothwyn', 1.40
    root = make_root(NAME, col_r=0.35)
    FUR = blend('fur_cream', 'fur_white', 0.45)
    FUR2 = blend('fur_cream', 'wool', 0.5, 0.95)
    RUFF = blend('fur_white', 'linen', 0.3, 1.02)
    LILAC = blend('purple', 'white', 0.52, 1.0)
    LILAC_D = blend('purple', 'white', 0.3, 0.95)
    WING = blend('purple', 'fur_grey', 0.35, 1.45)
    WING2 = blend('purple', 'fur_grey', 0.55, 1.3)
    SPOT_O = blend('purple', 'black', 0.3)
    SPOT_M = blend('ochre', 'fur_cream', 0.35)
    DARK = blend('fur_dark', 'purple', 0.35, 1.2)
    EYEC = blend('eye', 'purple', 0.3)
    ANT = blend('wood_light', 'ochre', 0.3, 0.92)

    hip = V(0, 0, 0.32)
    neck = V(0, 0.0, 0.775)
    sh = V(0.228, 0.0, 0.672)

    # ---------------- body -----------------------------------------------------
    b = Builder(seed=401)
    rings = [(0.25, 0.14, 0.13, 0, 0.008), (0.3, 0.19, 0.175, 0, 0.004), (0.38, 0.215, 0.2, 0, 0.0),
             (0.44, 0.216, 0.2, 0, -0.003), (0.5, 0.212, 0.198, 0, -0.006),
             (0.62, 0.195, 0.182, 0, -0.004), (0.72, 0.158, 0.148, 0, 0.0), (0.78, 0.1, 0.1, 0, 0.0),
             (0.79, 0.0, 0.0, 0, 0.0)]
    pr = Prof(rings)
    tor = loft(b, rings, seg=10, color=FUR, jitter=0.008, var=0.06)
    paint(b, tor, lambda c, f: FUR2 if (0.33 < c.z < 0.37 or 0.42 < c.z < 0.46) else FUR)
    # shawl draped over the shoulders, open at the back for the wings
    shw = [pr.ring(0.575, 0.022), pr.ring(0.64, 0.026), pr.ring(0.7, 0.028), pr.ring(0.75, 0.03)]
    f = shell(b, shw, -150, 150, seg=12, thick=0.022, color=LILAC, jitter=0.003)

    def dip(v):
        if v.z < 0.6:
            a = abs(math.degrees(math.atan2(v.x, -v.y)))
            v = V(v.x * 1.04, v.y - 0.006, v.z - 0.12 * max(0.0, 1 - a / 80))
        return v
    deform(f, dip)
    paint(b, f, lambda c, f_: LILAC_D if c.z < 0.575 else None)
    # little knot / brooch at the front
    b.sphere(r=1, seg=6, rings=4, loc=pr.pt(0, 0.66, 0.045), scale=(0.035, 0.025, 0.03), color=LILAC_D)
    lens(b, pr.pt(0, 0.66, 0.068), (0, -1, 0), 0.018, 0.01, seg=6, color='gold', mat='metal')
    # fluffy collar ruff (petalled)
    ruff = lathe(b, [(0.1, 0.72), (0.18, 0.722), (0.245, 0.76), (0.25, 0.795), (0.205, 0.835),
                     (0.12, 0.85)], seg=14, color=RUFF, jitter=0.01, var=0.05)

    def petals(v):
        a = math.atan2(v.y, v.x)
        r = math.hypot(v.x, v.y)
        k = 1.0 + 0.1 * math.cos(7 * a)
        return V(v.x * k, v.y * k, v.z + 0.012 * math.cos(7 * a) * (r > 0.17))
    deform(ruff, petals)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- wings (upper + lower on each side) ----------------------
    fore = [(0.0, 0.03), (0.05, 0.15), (0.14, 0.28), (0.26, 0.37), (0.36, 0.39), (0.42, 0.33),
            (0.41, 0.21), (0.33, 0.1), (0.18, 0.02)]
    hind = [(0.0, -0.02), (0.13, -0.03), (0.24, -0.09), (0.28, -0.18), (0.23, -0.27), (0.12, -0.26),
            (0.03, -0.14)]
    for s, sfx in SIDES:
        b = Builder(seed=410 + s)
        wroot = V(s * 0.05, 0.175, 0.655)
        R = rotz(s * 22) @ rotx(90)
        for outline, cen, spot, sr in ((fore, (0.04, 0.06), (0.29, 0.28), 0.058),
                                       (hind, (0.04, -0.05), (0.17, -0.16), 0.046)):
            ol = [(s * u, v) for (u, v) in outline]
            M = M4(wroot + V(0, 0.012, 0), R)
            flat(b, ol, M, thick=0.014, color=WING, centre=(s * cen[0], cen[1]),
                 seg_color=lambda i, n, mid: WING if i % 2 else WING2, rim=LILAC_D)
            nrm = (R @ V(0, 0, 1)).normalized()
            for side in (1, -1):
                pc = M @ V(s * spot[0], spot[1], side * 0.007)
                eye(b, pc, nrm * side, sr, [dict(r=1.0, color=SPOT_O, seg=9, rings=1),
                                           dict(r=0.62, color=SPOT_M, seg=8, rings=1),
                                           dict(r=0.3, color=SPOT_O, seg=5, rings=1)], bulge=0.05, embed=0.0)
        part(b, f'wing_{sfx}', wroot, body, H, prefix=NAME)

    # ---------------- head -----------------------------------------------------
    b = Builder(seed=402)
    hc, hr = V(0, 0.0, 1.015), (0.235, 0.215, 0.228)
    f = b.sphere(r=1, seg=12, rings=8, loc=hc, scale=hr, color=FUR, jitter=0.006, var=0.05)
    paint(b, f, mottle([FUR, FUR, FUR2], 13))
    b.cyl(r1=0.12, r2=0.12, h=0.12, seg=6, loc=(0, 0.0, 0.76), color=FUR2, cap=False)
    # fluffy forehead tuft
    for dx, dz in ((-0.05, 0.0), (0.05, 0.0), (0.0, 0.03)):
        b.sphere(r=1, seg=6, rings=4, loc=hc + V(dx, -0.12, 0.17 + dz), scale=(0.07, 0.06, 0.05),
                 color=RUFF, jitter=0.006)
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 40, 2)
        eye(b, p, n, 0.098, [dict(r=1.0, color=EYEC, sy=1.12, seg=12)], bulge=0.4,
            hl='white', hl_r=0.26, hl_pos=(-0.3, 0.42))
        q, qn = ell_pt(hc, hr, s * 40, 2)
        lens(b, q + qn * 0.02 + (qn.cross(V(0, 0, 1))).normalized() * 0.0 + V(s * 0.012, -0.006, 0.055),
             qn, 0.022, 0.012, seg=6, color='white', rings=1, var=0.0)
        # blush
        pb, nb = ell_pt(hc, hr, s * 26, -26)
        lens(b, pb, nb, 0.032, 0.008, seg=8, color=blend('turnip_top', 'fur_cream', 0.62), sy=0.7, rings=1)
    # tiny shy smile
    m0, mn = ell_pt(hc, hr, -9, -30)
    m1, _ = ell_pt(hc, hr, 0, -33)
    m2, _ = ell_pt(hc, hr, 9, -30)
    sweep(b, [m0 + mn * 0.004, m1 + mn * 0.006, m2 + mn * 0.004], 0.007, seg=3, color=DARK)
    head = part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- antennae: stalk + feathery (serrated) vane --------------
    for s, sfx in SIDES:
        b = Builder(seed=420 + s)
        base = hc + V(s * 0.075, -0.06, 0.205)
        tip = base + V(s * 0.13, 0.03, 0.2)
        mid = (base + tip) / 2 + V(-s * 0.01, -0.02, 0.02)
        sweep(b, [base + V(0, 0, -0.02), mid, tip], [0.012, 0.009, 0.006], seg=4, color=DARK)
        d = (tip - base)
        L = d.length
        ax = d.normalized()
        nrm = V(s * 0.35, -1, 0.1)
        nrm = (nrm - nrm.dot(ax) * ax).normalized()
        R3 = frame_z(nrm, ax)
        outline = []
        teeth = 10
        for k in range(teeth + 1):
            t = 0.22 + 0.78 * k / teeth
            w = 0.05 * math.sin(math.pi * min(1.0, (t - 0.15) / 0.9)) + 0.004
            outline.append((t * L + (0.012 if k % 2 == 0 else 0.0), w * (1.0 if k % 2 == 0 else 0.35)))
        for k in range(teeth, -1, -1):
            t = 0.22 + 0.78 * k / teeth
            w = 0.05 * math.sin(math.pi * min(1.0, (t - 0.15) / 0.9)) + 0.004
            outline.append((t * L + (0.012 if k % 2 == 0 else 0.0), -w * (1.0 if k % 2 == 0 else 0.35)))
        # local x along the stalk, local y across (in the vane plane)
        Mv = M4(base, R3 @ rotz(90))
        flat(b, outline, Mv, thick=0.01, color=ANT, var=0.06, centre=(0.6 * L, 0.0))
        part(b, f'antenna_{sfx}', base, head, H, prefix=NAME)

    # ---------------- arms: fluffy, with small dark hands ---------------------
    for s, sfx in SIDES:
        b = Builder(seed=430 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp, scale=(0.058, 0.06, 0.058), color=FUR, jitter=0.004)
        wr = sp + V(s * 0.012, 0, -0.215)
        sweep(b, [sp + V(0, 0, -0.01), sp + V(s * 0.006, 0, -0.12), wr + V(0, 0, 0.015)],
              [0.056, 0.058, 0.05], seg=7, color=FUR, jitter=0.006, cap_start=False)
        lathe(b, [(0.05, 0.0), (0.062, 0.012), (0.058, 0.04), (0.045, 0.05)], seg=7, M=M4(wr),
              color=RUFF, jitter=0.006, cap_top=False)
        b.sphere(r=1, seg=6, rings=4, loc=wr + V(0, 0, -0.03), scale=(0.036, 0.042, 0.04), color=DARK)
        for t in (-1, 0, 1):
            p0 = wr + V(s * 0.004, t * 0.024, -0.05)
            sweep(b, [p0, p0 + V(s * 0.004, t * 0.008, -0.045)], [0.014, 0.01], seg=4, color=DARK)
        grip = wr + V(s * 0.004, 0, -0.06)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: fluffy stubs, little dark feet --------------------
    for s, sfx in SIDES:
        b = Builder(seed=440 + s)
        hp = V(s * 0.09, 0, hip.z)
        sweep(b, [hp + V(0, 0, 0.02), hp + V(0, 0, -0.13), V(hp.x, 0.0, 0.08)], [0.075, 0.07, 0.06],
              seg=7, color=FUR, jitter=0.006)
        b.sphere(r=1, seg=8, rings=5, loc=(hp.x, -0.035, 0.045), scale=(0.058, 0.09, 0.048), color=DARK)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# Old Grenna the goat - herbalist / hedge-witch (1.50 m)
# ===========================================================================
def build_grenna():
    NAME, H = 'npc_grenna', 1.50
    root = make_root(NAME, col_r=0.35)
    FUR = blend('fur_white', 'wool', 0.4)
    FUR2 = blend('fur_grey', 'wool', 0.4, 1.05)
    DRESS = blend('wood_grey', 'soil', 0.35, 1.05)
    DRESS_D = blend('wood_grey', 'soil', 0.5, 0.85)
    SHAWL = blend('green', 'pine', 0.4, 1.05)
    EMB = blend('red', 'rust', 0.2, 1.1)
    HORN = blend('bone_dark', 'wood', 0.35)
    HORN2 = blend('bone_dark', 'wood', 0.55, 0.85)
    HOOF = blend('fur_dark', 'stone_dark', 0.4)
    STICK = blend('bark', 'wood', 0.4)

    hip = V(0, 0, 0.42)
    neck = V(0, -0.08, 0.88)
    sh = V(0.235, -0.04, 0.80)

    # ---------------- body: long dress, hunched back ---------------------------
    b = Builder(seed=501)
    rings = [(0.04, 0.26, 0.25, 0, 0.0), (0.1, 0.262, 0.252, 0, -0.002), (0.3, 0.228, 0.22, 0, -0.005),
             (0.5, 0.195, 0.19, 0, -0.008), (0.58, 0.19, 0.19, 0, -0.01), (0.68, 0.198, 0.205, 0, -0.008),
             (0.78, 0.192, 0.212, 0, -0.012), (0.85, 0.16, 0.19, 0, -0.03), (0.9, 0.1, 0.12, 0, -0.06),
             (0.915, 0.0, 0.0, 0, -0.07)]
    pr = Prof(rings)
    dr = loft(b, rings, seg=12, color=DRESS, jitter=0.004, var=0.06)
    paint(b, dr, lambda c, f: DRESS_D if c.z < 0.1 else None)
    # rope belt
    shell(b, [pr.ring(0.53, 0.008), pr.ring(0.56, 0.008)], -180, 180, seg=12, thick=0.014,
          color='rope', edge=False, back=False)
    # triangular shawl: over the shoulders, point hanging down the back
    shw = [(0.47, 0.19, 0.21, 0, 0.0, 168, 192), (0.56, 0.205, 0.225, 0, 0.0, 140, 220),
           (0.66, 0.222, 0.24, 0, -0.004, 100, 260), (0.76, 0.225, 0.245, 0, -0.01, 60, 300),
           (0.83, 0.2, 0.225, 0, -0.03, 34, 326), (0.89, 0.15, 0.17, 0, -0.058, 22, 338)]
    f = shell(b, shw, 0, 0, seg=10, thick=0.022, color=SHAWL, jitter=0.003, back=False)

    def emb(c, f_):
        # red embroidered border along the lower (V-shaped) edge of the back
        a = abs(math.degrees(math.atan2(c.x, -c.y)))
        zedge = 0.47 + (180 - a) / 120 * 0.36
        return EMB if (c.z - zedge) < 0.05 and a > 40 else None
    paint(b, f, emb)
    # shawl ends hanging down the front, red tips, bone pin
    for sgn in (-1, 1):
        a0, a1 = (8, 44) if sgn > 0 else (-44, -8)
        ends = [pr.ring(0.6, 0.03, a0 + sgn * 4, a1 - sgn * 8), pr.ring(0.7, 0.032, a0, a1),
                pr.ring(0.8, 0.034, a0 - sgn * 2, a1 + sgn * 6), pr.ring(0.88, 0.03, a0, a1 + sgn * 10)]
        fe = shell(b, ends, 0, 0, seg=3, thick=0.02, color=SHAWL, back=False)
        paint(b, fe, lambda c, f_: EMB if c.z < 0.63 else None)
    b.box((0.012, 0.012, 0.1), loc=pr.pt(0, 0.78, 0.055), rot=(0, 55, 0), color='bone')
    b.sphere(r=0.016, seg=5, rings=3, loc=pr.pt(12, 0.805, 0.06), color='bone')
    # faded linen apron
    ap = [pr.ring(z, 0.012, -w, w) for z, w in ((0.08, 50), (0.3, 50), (0.52, 48))]
    fa = shell(b, ap, 0, 0, seg=5, thick=0.014, color=blend('linen', 'straw', 0.35, 0.8), back=False)
    paint(b, fa, lambda c, f_: blend('linen', 'straw', 0.5, 0.7) if c.z < 0.12 else None)
    # satchel on the right hip, strap from the left shoulder, herbs peeking out
    sp_ = pr.pt(-80, 0.46, 0.075)
    b.box((0.09, 0.18, 0.15), loc=sp_, rot=(0, 0, -12), color='leather', bevel=0.02)
    b.box((0.096, 0.186, 0.07), loc=sp_ + V(-0.004, 0.0, 0.05), rot=(0, 0, -12), color='leather_dk', bevel=0.01)
    lens(b, sp_ + V(-0.05, -0.01, 0.03), (-1, 0, 0), 0.015, 0.008, seg=5, color='bronze', mat='metal')
    strap = [pr.pt(-78, 0.53, 0.035), pr.pt(-40, 0.68, 0.035), pr.pt(0, 0.76, 0.045), pr.pt(40, 0.85, 0.035),
             pr.pt(90, 0.88, 0.0) + V(0.02, 0, 0.03), pr.pt(140, 0.84, 0.03), pr.pt(-150, 0.68, 0.035),
             pr.pt(-105, 0.55, 0.035)]
    sweep(b, strap, [(0.008, 0.02)] * len(strap), seg=4, color='leather_dk', up=(0, 0, 1))
    for k, (dy, h, lean, c) in enumerate(((-0.05, 0.11, -0.02, 'leaf'), (0.0, 0.14, -0.035, 'leaf_light'),
                                          (0.05, 0.1, -0.01, 'turnip_top'))):
        base = sp_ + V(0.0, dy, 0.07)
        tip = base + V(lean, dy * 0.3, h)
        sweep(b, [base, tip], [0.008, 0.005], seg=3, color='leaf_dark')
        for j in range(3):
            q = base + (tip - base) * (0.5 + 0.22 * j)
            b.cone(r=0.016 - j * 0.003, h=0.045, seg=4, loc=q, rot=((-1) ** j * 50, 0, 0), color=c)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- head -----------------------------------------------------
    b = Builder(seed=502)
    hd = Head((0, -0.13, 1.155), [
        (-0.2, 0, 0, 0, 0.03), (-0.188, 0.075, 0.08, 0, 0.03), (-0.155, 0.14, 0.15, 0, 0.03),
        (-0.09, 0.19, 0.2, 0, 0.025),
        (0.0, 0.205, 0.212, 0, 0.015), (0.07, 0.19, 0.192, 0, 0.0), (0.13, 0.152, 0.158, 0, -0.03),
        (0.2, 0.116, 0.122, 0, -0.05), (0.255, 0.096, 0.1, 0, -0.058), (0.278, 0, 0, 0, -0.062)], pitch=14)
    f = hd.build(b, seg=12, color=FUR, jitter=0.005, var=0.06)
    paint(b, f, mottle([FUR, FUR, FUR2], 21))
    b.cyl(r1=0.13, r2=0.12, h=0.16, seg=6, loc=(0, -0.08, 0.86), color=FUR2, jitter=0.008, cap=False)
    # shaggy fur collar around the neck
    fc = lathe(b, [(0.1, 0.87), (0.17, 0.88), (0.19, 0.93), (0.15, 0.99), (0.09, 1.0)], seg=10,
               M=M4((0, -0.085, 0)), color=FUR, jitter=0.012, var=0.08)

    def tufts(v):
        a = math.atan2(v.y + 0.085, v.x)
        k = 1.0 + 0.13 * math.cos(5 * a)
        return V(v.x * k, (v.y + 0.085) * k - 0.085, v.z - 0.02 * (1 + math.cos(5 * a)) * (v.z < 0.9))
    deform(fc, tufts)
    # eyes: amber with goat pupils, heavy lids
    for s, _ in SIDES:
        az, t = 180 - s * 54, 0.065
        p, n = hd.pt(az, t, 0.004), hd.normal(az, t)
        eye(b, p, n, 0.064, [dict(r=1.0, color=blend('ochre', 'gold', 0.5, 1.05)),
                             dict(r=0.5, color='eye', sx=1.8, sy=0.42)], bulge=0.34, hl='white', hl_r=0.22)
        q0, q1 = hd.pt(180 - s * 34, 0.09, 0.024), hd.pt(180 - s * 80, 0.05, 0.02)
        sweep(b, [q0, (q0 + q1) / 2 + n * 0.028, q1], [(0.022, 0.032), (0.026, 0.038), (0.014, 0.02)],
              seg=4, color=FUR2)
        # floppy ear, sticking out sideways under the horn
        e0 = hd.pt(180 - s * 100, -0.035, -0.01)
        e1 = e0 + V(s * 0.15, 0.03, -0.08)
        sweep(b, [e0, (e0 + e1) / 2 + V(0, 0, 0.012), e1], [(0.035, 0.012), (0.045, 0.012), (0.012, 0.008)],
              seg=4, color=FUR2, up=(0, 0, 1))
        # curled ram horn
        base = hd.pt(180 - s * 38, 0.0, -0.012)
        cen = hd.pt(180 - s * 96, -0.07, 0.0) + V(s * 0.02, 0.0, 0.03)
        ram_horn(b, base, cen, s, r1=0.05, turns=0.96, thick=(0.052, 0.015), out=0.07,
                 color=HORN, ridge=HORN2, n=11, yaw=40)
    # shaggy tufts over the back of the head
    for k, (az, t, ln) in enumerate(((180, -0.17, 0.13), (145, -0.12, 0.11), (215, -0.12, 0.11))):
        p0, n0 = hd.pt(az, t, -0.01), hd.normal(az, t)
        d = (n0 * 0.2 + V(0, 0.15, -1)).normalized()
        sweep(b, [p0, p0 + n0 * 0.012 + d * ln * 0.5, p0 + d * ln], [(0.02, 0.05), (0.02, 0.045), 0.0], seg=4,
              color=FUR if k % 2 else FUR2, up=n0, jitter=0.004)
    # forelock tuft
    b.cone(r=0.07, h=0.12, seg=5, loc=hd.pt(180, 0.04, -0.02), rot=(-120, 0, 0), color=FUR, jitter=0.01)
    # nose + mouth
    lens(b, hd.pt(0, 0.265, 0.002) + V(0, -0.012, 0.022), hd.normal(10, 0.27), 0.04, 0.012, seg=7,
         color=blend('fur_dark', 'turnip_top', 0.2, 1.4), sy=0.7)
    sweep(b, [hd.pt(-26, 0.215, 0.003), hd.pt(0, 0.235, 0.004), hd.pt(26, 0.215, 0.003)], 0.006, seg=3,
          color=blend('fur_dark', 'fur_grey', 0.3))
    # long beard
    c0 = hd.pt(0, 0.16, -0.03)
    sweep(b, [c0 + V(0, 0.02, 0.02), c0 + V(0, -0.012, -0.08), c0 + V(0, -0.01, -0.2), c0 + V(0, 0.0, -0.32)],
          [(0.075, 0.045), (0.085, 0.05), (0.055, 0.035), 0.0], seg=6, color=FUR, jitter=0.008)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms (stick in the left hand) ---------------------------
    for s, sfx in SIDES:
        b = Builder(seed=510 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp + V(0, 0, -0.005), scale=(0.058, 0.062, 0.058), color=DRESS)
        el = sp + V(s * 0.006, 0, -0.16)
        sweep(b, [sp + V(0, 0, -0.01), el], [0.056, 0.06], seg=7, color=DRESS, cap_start=False)
        lathe(b, [(0.06, -0.01), (0.07, 0.0), (0.066, 0.03), (0.056, 0.036)], seg=7, M=M4(el + V(0, 0, -0.02)),
              color=FUR, jitter=0.008, cap_top=False)
        wr = el + V(s * 0.004, 0, -0.14)
        sweep(b, [el + V(0, 0, -0.02), wr], [0.048, 0.042], seg=6, color=FUR, jitter=0.006)
        # hoof-hand: two blunt dark fingers + thumb
        b.sphere(r=1, seg=6, rings=4, loc=wr + V(0, 0, -0.03), scale=(0.046, 0.052, 0.046), color=HOOF)
        for t in (-1, 1):
            p0 = wr + V(0, t * 0.022, -0.055)
            sweep(b, [p0, p0 + V(0, t * 0.006, -0.045)], [0.024, 0.02], seg=5, color=HOOF)
        grip = wr + V(s * 0.004, -0.004, -0.06)
        if s > 0:
            top = grip + V(0.0, -0.03, 0.22)
            pts = [top + V(0.015, 0.01, 0.03), top, grip + V(0.004, -0.012, 0.08), grip,
                   grip + V(-0.01, -0.02, -0.18), grip + V(0.01, -0.035, -0.34), V(grip.x - 0.005, grip.y - 0.05, 0.005)]
            sweep(b, pts, [0.03, 0.028, 0.022, 0.022, 0.021, 0.019, 0.017], seg=6, color=STICK, jitter=0.004)
            b.ico(r=0.045, sub=1, loc=top + V(0.01, 0.0, 0.04), color=blend('bark', 'bark_dark', 0.5), jitter=0.01)
            # charm: red-tied bundle of feathers and a little bone
            ch = top + V(-0.03, -0.03, -0.02)
            sweep(b, [top + V(-0.02, -0.02, 0.0), ch], 0.004, seg=3, color=EMB)
            b.box((0.02, 0.02, 0.02), loc=ch, color=EMB)
            for k, (dx, dz) in enumerate(((-0.02, -0.08), (0.0, -0.1), (0.02, -0.075))):
                sweep(b, [ch, ch + V(dx, -0.01, dz)], [(0.014, 0.004), 0.0], seg=4,
                      color='feather_blk' if k == 1 else 'feather_owl', up=(0, -1, 0))
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: hidden by the dress, hooves peek out --------------
    for s, sfx in SIDES:
        b = Builder(seed=520 + s)
        hp = V(s * 0.1, 0, hip.z)
        sweep(b, [hp + V(0, 0, 0.02), V(hp.x, -0.01, 0.1)], [0.07, 0.05], seg=6, color=FUR2)
        for t in (-1, 1):
            b.sphere(r=1, seg=6, rings=4, loc=(hp.x + t * 0.028, -0.07, 0.035), scale=(0.03, 0.06, 0.035),
                     color=HOOF)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# Fennick the fox - ex-sailor fisherman (1.55 m)
# ===========================================================================
def build_fennick():
    NAME, H = 'npc_fennick', 1.55
    root = make_root(NAME, col_r=0.35)
    FOX = tint('fur_fox', 1.0)
    FOX_D = blend('fur_fox', 'rust', 0.5, 0.85)
    CREAM = blend('fur_cream', 'fur_white', 0.3)
    DARK = blend('fur_dark', 'leather_dk', 0.3)
    COAT = blend('blue', 'blue_dark', 0.25, 1.12)
    COAT_D = blend('blue_dark', 'blue', 0.3)
    BRASS = blend('bronze', 'gold', 0.45)
    TROU = blend('wood_grey', 'sand', 0.3, 0.9)
    CAP = blend('red', 'rust', 0.25, 1.05)
    CAP_D = blend('red_dark', 'red', 0.3)

    hip = V(0, 0, 0.44)
    neck = V(0, 0.0, 0.915)
    sh = V(0.232, 0.0, 0.832)

    # ---------------- body: double-breasted pea coat --------------------------
    b = Builder(seed=601)
    rings = [(0.34, 0.215, 0.2, 0, 0.012), (0.37, 0.212, 0.198, 0, 0.01), (0.46, 0.2, 0.188, 0, 0.0),
             (0.56, 0.195, 0.182, 0, -0.006), (0.66, 0.198, 0.178, 0, -0.008), (0.76, 0.2, 0.17, 0, -0.004),
             (0.83, 0.192, 0.155, 0, 0.004), (0.88, 0.15, 0.13, 0, 0.008), (0.92, 0.1, 0.095, 0, 0.01),
             (0.93, 0.0, 0.0, 0, 0.01)]
    pr = Prof(rings)
    coat = loft(b, rings, seg=12, color=COAT, jitter=0.003, var=0.05)
    paint(b, coat, lambda c, f: COAT_D if c.z < 0.37 else None)
    # cream chest fur in the V between the lapels
    vz = (0.7, 0.78, 0.86, 0.905)
    vw = lambda z: 5 + (z - 0.7) / 0.2 * 30
    shell(b, [pr.ring(z, 0.006, -vw(z), vw(z)) for z in vz], 0, 0, seg=4, thick=0.01, color=CREAM,
          back=False, jitter=0.003)
    # lapels
    for sgn in (-1, 1):
        lr = []
        for z, w0, w1 in ((0.66, 3, 16), (0.74, 14, 40), (0.82, 26, 52), (0.88, 34, 50)):
            a0, a1 = (w0, w1) if sgn > 0 else (-w1, -w0)
            lr.append(pr.ring(z, 0.018, a0, a1))
        shell(b, lr, 0, 0, seg=3, thick=0.02, color=COAT_D, back=False)
    # turned-up collar at the back
    shell(b, [(0.86, 0.17, 0.15, 0, 0.012), (0.915, 0.162, 0.146, 0, 0.02), (0.965, 0.172, 0.158, 0, 0.03)],
          55, 305, seg=7, thick=0.022, color=COAT)
    # brass buttons: two rows
    for z in (0.47, 0.555, 0.64):
        for sgn in (-1, 1):
            lens(b, pr.pt(sgn * 22, z, 0.004), pr.normal(sgn * 22, z), 0.019, 0.014, seg=6, color=BRASS,
                 mat='metal')
    # slanted pockets
    for sgn in (-1, 1):
        shell(b, [pr.ring(0.42, 0.01, sgn * 40 - 18, sgn * 40 + 18), pr.ring(0.45, 0.012, sgn * 40 - 14, sgn * 40 + 22)],
              0, 0, seg=2, thick=0.012, color=COAT_D, back=False)
    # half-belt with two brass buttons at the back
    shell(b, [pr.ring(0.535, 0.012, 150, 210), pr.ring(0.575, 0.012, 150, 210)], 0, 0, seg=3, thick=0.014,
          color=COAT_D, back=False)
    for sgn in (-1, 1):
        lens(b, pr.pt(180 + sgn * 24, 0.555, 0.016), pr.normal(180 + sgn * 24, 0.555), 0.016, 0.012, seg=6,
             color=BRASS, mat='metal')
    # back vent where the tail comes out
    sweep(b, [pr.pt(180, 0.34, 0.004), pr.pt(180, 0.47, 0.004)], [(0.006, 0.012)] * 2, seg=3, color=COAT_D)
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- tail: big and bushy, white tip ---------------------------
    b = Builder(seed=603)
    tb = V(0, 0.15, 0.43)
    tp = [tb, V(0.0, 0.25, 0.31), V(0.07, 0.38, 0.27), V(0.17, 0.47, 0.33), V(0.24, 0.5, 0.45),
          V(0.27, 0.48, 0.57)]
    f = sweep(b, tp, [0.05, 0.085, 0.11, 0.11, 0.085, 0.0], seg=7, color=FOX, jitter=0.012, var=0.08)
    paint(b, f, lambda c, f_: CREAM if c.z > 0.44 and c.x > 0.2 else None)
    part(b, 'tail', tb, body, H, prefix=NAME)

    # ---------------- head -----------------------------------------------------
    b = Builder(seed=602)
    hd = Head((0, 0.0, 1.14), [
        (-0.2, 0, 0, 0, 0.02), (-0.18, 0.12, 0.12, 0, 0.02), (-0.1, 0.205, 0.2, 0, 0.02),
        (0.0, 0.232, 0.212, 0, 0.008), (0.07, 0.214, 0.186, 0, -0.008), (0.13, 0.155, 0.135, 0, -0.035),
        (0.21, 0.092, 0.084, 0, -0.052), (0.285, 0.052, 0.05, 0, -0.06), (0.315, 0, 0, 0, -0.062)])
    f = hd.build(b, seg=12, color=FOX, var=0.05)

    def face(c, f_):
        az, t, x, y = hd.local(c)
        lower = az < 72 or az > 288
        if t > 0.24 and 150 < az < 210:
            return DARK if t > 0.285 else None
        if lower and t > -0.08:
            return CREAM
        if (az < 100 or az > 260) and t > -0.02 and y < -0.07:
            return CREAM
        return None
    paint(b, f, face)
    b.cyl(r1=0.13, r2=0.12, h=0.14, seg=6, loc=(0, 0.01, 0.89), color=CREAM, cap=False)
    # fluffy cheek tufts
    for s, _ in SIDES:
        c0 = hd.pt(180 - s * 108, 0.02, -0.02)
        sweep(b, [c0, c0 + V(s * 0.07, 0.02, -0.04)], [(0.04, 0.03), 0.0], seg=4, color=CREAM, up=(0, 0, 1))
        c1 = hd.pt(180 - s * 120, -0.04, -0.02)
        sweep(b, [c1, c1 + V(s * 0.06, 0.03, -0.02)], [(0.035, 0.025), 0.0], seg=4, color=CREAM, up=(0, 0, 1))
    # left eye (amber), right eye under a patch
    az_l, t_e = 180 - 48, 0.075
    p, n = hd.pt(az_l, t_e, 0.003), hd.normal(az_l, t_e)
    eye(b, p, n, 0.058, [dict(r=1.0, color=blend('ochre', 'gold', 0.4, 1.1)),
                         dict(r=0.55, color='eye', sx=0.8, dx=-0.08)], bulge=0.34, hl='white', hl_r=0.24)
    q0, q1 = hd.pt(180 - 28, 0.085, 0.03), hd.pt(180 - 66, 0.05, 0.026)
    sweep(b, [q0, (q0 + q1) / 2 + n * 0.02, q1], [(0.014, 0.02), (0.016, 0.024), (0.01, 0.014)], seg=4, color=FOX_D)
    az_r = 180 + 48
    pp, pn = hd.pt(az_r, t_e, 0.006), hd.normal(az_r, t_e)
    lens(b, pp, pn, 0.066, 0.02, seg=8, color=blend('black', 'leather_dk', 0.3), sy=0.9)
    strap = [hd.pt(az, t, 0.012) for az, t in ((205, 0.1), (190, 0.075), (172, 0.03), (150, -0.04),
                                                 (128, -0.12), (118, -0.17))]
    sweep(b, strap, [(0.006, 0.014)] * len(strap), seg=4, color=blend('black', 'leather_dk', 0.3), up=(0, 0, 1))
    strap2 = [hd.pt(az, t, 0.01) for az, t in ((256, 0.07), (262, 0.0), (250, -0.1), (236, -0.17))]
    sweep(b, strap2, [(0.006, 0.014)] * len(strap2), seg=4, color=blend('black', 'leather_dk', 0.3), up=(0, 0, 1))
    # nose + grin
    b.sphere(r=1, seg=6, rings=4, loc=hd.pt(180, 0.305, 0.0) + V(0, -0.006, -0.012), scale=(0.034, 0.03, 0.026),
             color=blend('black', 'fur_dark', 0.3))
    sweep(b, [hd.pt(-40, 0.19, 0.002), hd.pt(-12, 0.235, 0.004), hd.pt(12, 0.235, 0.004), hd.pt(40, 0.19, 0.002)],
          0.006, seg=3, color=DARK)
    # knit watch cap with a rolled brim
    ctop = hd.pt(180, -0.045, 0.0)
    R = rotx(-16)
    cap = lathe(b, [(0.0, -0.02), (0.168, -0.02), (0.182, 0.0), (0.182, 0.045), (0.166, 0.06),
                    (0.158, 0.11), (0.132, 0.17), (0.08, 0.21), (0.0, 0.222)], seg=12,
                M=M4(ctop + V(0, 0.015, -0.085), R), color=CAP, jitter=0.003, var=0.05)
    paint(b, cap, lambda c, f_: CAP_D if (c - ctop).z < -0.03 else None)
    head = part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- ears (separate so they can twitch) ----------------------
    for s, sfx in SIDES:
        b = Builder(seed=620 + s)
        az_e, t_ear = 180 - s * 50, -0.02
        base = hd.pt(az_e, t_ear, -0.02)
        tip = base + V(s * 0.09, 0.025, 0.23)
        f = sweep(b, [base, base + (tip - base) * 0.45 + V(s * 0.01, 0, 0), tip],
                  [(0.082, 0.03), (0.062, 0.026), 0.0], seg=5, color=FOX, up=(s * 0.3, -1, 0))
        paint(b, f, lambda c, f_: DARK if (c - base).dot((tip - base).normalized()) > 0.13 else None)
        d = (tip - base).normalized()
        nf = V(0, -1, 0)
        nf = (nf - nf.dot(d) * d).normalized()
        lens(b, base + (tip - base) * 0.38 + nf * 0.018, nf, 0.042, 0.012, seg=6, color=CREAM, sy=1.9,
             up=d)
        part(b, f'ear_{sfx}', base, head, H, prefix=NAME)

    # ---------------- arms: navy sleeves, turned cuffs, dark paws -------------
    for s, sfx in SIDES:
        b = Builder(seed=610 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp + V(-s * 0.005, 0, -0.005), scale=(0.058, 0.06, 0.058), color=COAT)
        wr = sp + V(s * 0.012, 0, -0.29)
        sweep(b, [sp + V(0, 0, -0.01), sp + V(s * 0.006, 0, -0.15), wr + V(0, 0, 0.03)], [0.056, 0.053, 0.058],
              seg=7, color=COAT, cap_start=False)
        lathe(b, [(0.058, -0.005), (0.068, 0.005), (0.068, 0.04), (0.06, 0.046)], seg=7, M=M4(wr),
              color=COAT_D, cap_top=False)
        paw(b, wr + V(0, 0, 0.005), s, DARK, size=0.95, fingers=3, down=0.07)
        grip = wr + V(s * 0.004, -0.004, -0.07)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: rolled trousers, dark fox feet ---------------------
    for s, sfx in SIDES:
        b = Builder(seed=630 + s)
        hp = V(s * 0.1, 0, hip.z)
        b.sphere(r=1, seg=6, rings=4, loc=hp + V(0, 0, -0.03), scale=(0.08, 0.08, 0.08), color=TROU)
        sweep(b, [hp + V(0, 0, -0.04), V(hp.x, 0.0, 0.16)], [0.078, 0.066], seg=7, color=TROU)
        lathe(b, [(0.066, 0.13), (0.076, 0.14), (0.076, 0.175), (0.066, 0.185)], seg=7, M=M4((hp.x, 0, 0)),
              color=blend('wood_grey', 'sand', 0.5), cap_top=False)
        sweep(b, [V(hp.x, 0.0, 0.14), V(hp.x, -0.005, 0.05)], [0.052, 0.046], seg=6, color=DARK)
        b.sphere(r=1, seg=7, rings=4, loc=(hp.x, -0.045, 0.04), scale=(0.058, 0.1, 0.045), color=DARK)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


# ===========================================================================
# The player - hooded wanderer (1.65 m)
# ===========================================================================
def build_player():
    NAME, H = 'player', 1.65
    root = make_root(NAME, col_r=0.35)
    SKIN = tint('skin')
    STUB = blend('skin', 'wood', 0.12, 0.93)
    HAIR = blend('wood', 'fur_brown', 0.5, 0.9)
    WOOL = blend('moss', 'green', 0.45, 1.05)
    WOOL_D = blend('green', 'pine', 0.5, 0.85)
    LINEN = blend('linen', 'wool', 0.35, 0.97)
    TROU = blend('wood_dark', 'slate', 0.45, 1.05)
    BOOT = blend('leather', 'leather_dk', 0.45)
    FURT = blend('fur_cream', 'fur_grey', 0.35)

    hip = V(0, 0, 0.71)
    neck = V(0, 0.0, 1.215)
    sh = V(0.215, 0.0, 1.14)

    # ---------------- body: linen tunic, belt, pouch --------------------------
    b = Builder(seed=701)
    rings = [(0.54, 0.19, 0.17, 0, 0.004), (0.58, 0.186, 0.166, 0, 0.003), (0.7, 0.172, 0.15, 0, 0.0),
             (0.82, 0.162, 0.136, 0, -0.004), (0.86, 0.162, 0.136, 0, -0.004), (0.96, 0.168, 0.14, 0, -0.008),
             (1.06, 0.174, 0.138, 0, -0.006), (1.13, 0.17, 0.128, 0, 0.0), (1.18, 0.138, 0.11, 0, 0.004),
             (1.22, 0.08, 0.075, 0, 0.006), (1.23, 0.0, 0.0, 0, 0.006)]
    pr = Prof(rings)
    tun = loft(b, rings, seg=12, color=LINEN, jitter=0.003, var=0.05)
    paint(b, tun, lambda c, f: WOOL_D if c.z < 0.58 else None)
    # belt, buckle, pouch, knife
    shell(b, [pr.ring(0.815, 0.01), pr.ring(0.865, 0.012)], -180, 180, seg=12, thick=0.02,
          color='leather_dk', edge=False, back=False)
    b.box((0.05, 0.02, 0.046), loc=pr.pt(0, 0.84, 0.014), color='bronze', mat='metal')
    pp = pr.pt(-62, 0.79, 0.045)
    b.box((0.075, 0.1, 0.1), loc=pp, rot=(0, 0, 28), color='leather', bevel=0.018)
    b.box((0.078, 0.104, 0.04), loc=pp + V(0, 0, 0.035), rot=(0, 0, 28), color='leather_dk', bevel=0.008)
    kp = pr.pt(66, 0.8, 0.03)
    b.box((0.03, 0.05, 0.16), loc=kp + V(0, 0, -0.04), rot=(0, 12, -20), color='leather_dk')
    b.cyl(r1=0.013, h=0.07, seg=5, loc=kp + V(0, 0, 0.03), rot=(0, 12, 0), color='wood_dark')
    # neckline laces
    for z in (1.12, 1.16):
        sweep(b, [pr.pt(-10, z, 0.004), pr.pt(10, z + 0.02, 0.004)], 0.005, seg=3, color='leather_dk')
    body = part(b, 'body', hip, root, H, prefix=NAME)

    # ---------------- cloak: short cape over the shoulders --------------------
    b = Builder(seed=702)
    cr = [(0.9, 0.23, 0.2, 0, 0.03, 52, 308), (0.98, 0.215, 0.188, 0, 0.025, 50, 310),
          (1.08, 0.2, 0.172, 0, 0.012, 46, 314), (1.16, 0.19, 0.155, 0, 0.004, 40, 320),
          (1.215, 0.15, 0.128, 0, 0.004, 34, 326)]
    f = shell(b, cr, 0, 0, seg=10, thick=0.022, color=WOOL, jitter=0.004)

    def ragged(v):
        if v.z < 0.92:
            a = math.atan2(v.x, -v.y)
            v = V(v.x, v.y, v.z - 0.035 * max(0.0, math.cos(4 * a)))
        return v
    deform(f, ragged)
    paint(b, f, lambda c, f_: WOOL_D if c.z < 0.93 else None)
    lens(b, pr.pt(0, 1.2, 0.035), (0, -1, 0.3), 0.028, 0.014, seg=7, color='bronze', mat='metal')
    part(b, 'cloak', V(0, 0.03, 1.2), body, H, prefix=NAME)

    # ---------------- head: face under a wool hood ----------------------------
    b = Builder(seed=703)
    hc, hr = V(0, 0.0, 1.415), (0.148, 0.155, 0.17)
    f = b.sphere(r=1, seg=12, rings=8, loc=hc, scale=hr, color=SKIN, var=0.03)

    def stubble(c, f_):
        d = c - hc
        return STUB if (d.z < -0.06 and d.y < 0.02) else None
    paint(b, f, stubble)
    b.cyl(r1=0.075, r2=0.07, h=0.12, seg=6, loc=(0, 0.01, 1.19), color=SKIN, cap=False)
    for s, _ in SIDES:
        p, n = ell_pt(hc, hr, s * 27, 3)
        eye(b, p, n, 0.03, [dict(r=1.0, color=blend('eye', 'wood_dark', 0.3), sy=1.3, seg=8)], bulge=0.4,
            hl='white', hl_r=0.3)
        q0, n0 = ell_pt(hc, hr, s * 14, 22)
        q1, n1 = ell_pt(hc, hr, s * 40, 20)
        sweep(b, [q0 + n0 * 0.006, q1 + n1 * 0.006], [(0.009, 0.014), (0.007, 0.01)], seg=4, color=HAIR)
        # ears peeking under the hood
        pe, ne = ell_pt(hc, hr, s * 90, 0)
        b.sphere(r=1, seg=6, rings=4, loc=pe + ne * 0.005, scale=(0.02, 0.035, 0.045), color=SKIN)
    pn, nn = ell_pt(hc, hr, 0, -8)
    b.cone(r=0.026, h=0.04, seg=5, loc=pn - nn * 0.012, rot=deg(frame_z(nn)), color=blend('skin', 'red', 0.1),
           scale=(1, 0.8, 1))
    m0, mn = ell_pt(hc, hr, -12, -30)
    m1, _ = ell_pt(hc, hr, 0, -33)
    m2, _ = ell_pt(hc, hr, 12, -30)
    sweep(b, [m0 + mn * 0.004, m1 + mn * 0.005, m2 + mn * 0.004], 0.0055, seg=3,
          color=blend('red_dark', 'skin', 0.3))
    # hair fringe under the hood edge
    for k, (az, el, ln) in enumerate(((-30, 34, 0.05), (-8, 40, 0.075), (18, 38, 0.06))):
        ph, nh = ell_pt(hc, hr, az, el)
        q1, n1 = ell_pt(hc, hr, az + 22, el - 16)
        sweep(b, [ph - nh * 0.004, (ph + q1) / 2 + nh * 0.014, q1 + n1 * 0.008],
              [(0.012, 0.03), (0.012, 0.028), 0.0], seg=4, color=HAIR, up=nh)
    # the hood (a shell in a forward-axis frame, open at the chin)
    hood = Head(hc + V(0, 0.012, 0.012), [
        (-0.228, 0.025, 0.025, 0, 0.055, 10, 350), (-0.215, 0.075, 0.075, 0, 0.05, 14, 346),
        (-0.19, 0.14, 0.165, 0, 0.035, 22, 338),
        (-0.1, 0.19, 0.212, 0, 0.018, 44, 316), (0.0, 0.198, 0.222, 0, 0.004, 52, 308),
        (0.08, 0.19, 0.212, 0, -0.006, 52, 308), (0.135, 0.178, 0.2, 0, -0.012, 54, 306)])
    hood.shell(b, hood.rings, seg=10, thick=0.03, color=WOOL, jitter=0.004)
    # thick rolled rim around the face opening
    rim = [hood.pt(a, 0.132, 0.004) for a in (60, 92, 124, 156, 180, 204, 236, 268, 300)]
    sweep(b, rim, 0.022, seg=4, color=WOOL_D)
    # neck drape down to the shoulders + liripipe tail
    shell(b, [(1.2, 0.165, 0.15, 0, 0.012, 64, 296), (1.3, 0.18, 0.165, 0, 0.022, 58, 302),
              (1.4, 0.19, 0.178, 0, 0.032, 50, 310)], 0, 0, seg=8, thick=0.024, color=WOOL, jitter=0.003)
    t0 = hood.pt(180, -0.17, -0.02)
    sweep(b, [t0, t0 + V(0, 0.08, -0.04), t0 + V(0, 0.11, -0.16)], [0.06, 0.035, 0.0], seg=5, color=WOOL,
          jitter=0.003)
    part(b, 'head', neck, body, H, prefix=NAME)

    # ---------------- arms: linen sleeves, leather bracers, hands -------------
    for s, sfx in SIDES:
        b = Builder(seed=710 + s)
        sp = V(s * sh.x, sh.y, sh.z)
        b.sphere(r=1, seg=8, rings=5, loc=sp + V(-s * 0.004, 0, -0.005), scale=(0.054, 0.056, 0.055), color=LINEN)
        wr = sp + V(s * 0.012, 0, -0.33)
        sweep(b, [sp + V(0, 0, -0.01), sp + V(s * 0.006, 0, -0.17), wr + V(0, 0, 0.07)], [0.052, 0.048, 0.047],
              seg=7, color=LINEN, cap_start=False)
        lathe(b, [(0.046, -0.005), (0.05, 0.0), (0.052, 0.075), (0.046, 0.08)], seg=7, M=M4(wr),
              color='leather', cap_top=False)
        b.sphere(r=1, seg=7, rings=5, loc=wr + V(0, 0, -0.035), scale=(0.036, 0.046, 0.046), color=SKIN)
        b.sphere(r=1, seg=5, rings=4, loc=wr + V(-s * 0.012, -0.03, -0.025), scale=(0.016, 0.022, 0.02), color=SKIN)
        grip = wr + V(0.0, 0.0, -0.04)
        arm = part(b, f'arm_{sfx}', sp, body, H, prefix=NAME)
        hand_socket(f'hand_{sfx}', grip, arm)

    # ---------------- legs: dark trousers, fur-trimmed boots ------------------
    for s, sfx in SIDES:
        b = Builder(seed=720 + s)
        hp = V(s * 0.088, 0, hip.z)
        b.sphere(r=1, seg=6, rings=4, loc=hp + V(0, 0, -0.03), scale=(0.075, 0.075, 0.08), color=TROU)
        sweep(b, [hp + V(0, 0, -0.04), V(hp.x, -0.005, 0.44), V(hp.x, 0.0, 0.28)], [0.074, 0.064, 0.058],
              seg=7, color=TROU)
        boot(b, hp, s, ank_z=0.3, color=BOOT, cuff=FURT, toe=0.15, r=0.066)
        part(b, f'leg_{sfx}', hp, body, H, prefix=NAME)
    return root


BUILDERS = [build_player, build_corvin, build_morrow, build_bramble, build_mothwyn, build_grenna,
            build_fennick]

# rig contract checked at build time (names the game code relies on)
_BIPED = ['body', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'hand_l', 'hand_r']
REQUIRED = {
    'player': _BIPED + ['cloak'],
    'npc_corvin': _BIPED + ['tail'],
    'npc_morrow': _BIPED + ['light'],
    'npc_bramble': _BIPED,
    'npc_mothwyn': _BIPED + ['antenna_l', 'antenna_r', 'wing_l', 'wing_r'],
    'npc_grenna': _BIPED,
    'npc_fennick': _BIPED + ['tail', 'ear_l', 'ear_r'],
}


def build(out_dir):
    reset_scene()
    roots = [fn() for fn in BUILDERS]
    problems = check_names(roots, REQUIRED)
    if problems:
        raise RuntimeError('rig contract broken: ' + '; '.join(problems))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'characters.glb')
    export_glb(path, roots)
    clean_glb_names(path)
    s = stats(roots)
    for k, v in s.items():
        print(f'  {k:16s} {v:5d} tris')
    return s


if __name__ == '__main__':
    build(os.path.normpath(os.path.join(HERE, '..', 'assets', 'models')))
