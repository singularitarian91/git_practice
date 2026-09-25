"""
Build buildings.glb - houses, village landmarks and ruins for Gloamhollow.

    python blender/build_buildings.py                 # all assets
    python blender/build_buildings.py --only=well,dock

Every asset: origin at the ground centre of its footprint, front / door
facing Blender -Y, sockets as empties (door, light / light_N, smoke) and
colliders as custom properties (col_box = [w, d] or col_r).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401
from mathutils import Vector  # noqa: E402

from ghlib import Builder, empty, export_glb, reset_scene, stats, mix  # noqa: E402
from bldkit import (  # noqa: E402
    BEAM, EMBER, FLAME, FLAME_HOT, IRON, LANTERN, RUNE, RUNE_FAINT,
    TIMBER_LT, WEATHERED, Frame, Slope, barrel, beam, blades, crate,
    door, embers, fire, fix_glb_names, flame, flower, flowers_on, grass, hexa,
    lantern, log, log_wall, loft, paint, pebble, plank_wall, rect_frames, rope_coil,
    rvar, sack, shield, shingles, slope_slab, stone_color, stone_wall, sweep,
    tone, torus, tufts_on, turf, window, dragon_head, PathFrame,
    ArcPath, ngon_prism, emblem, RAVEN_PROFILE, RAVEN_SPREAD, StoneSlab, grass_edge,
    anvil_on_stump, coal_pile, goat_skull, herb_bundle, bottle, rune_strokes, rune_line,
    moss_ring, stag_skull, candle, GLYPHS,
)


def finish(b, name, col_box=None, col_r=None, ao=0.22, ao_floor=None):
    """Build the Builder as the asset's root mesh and attach colliders."""
    root = b.build(name, ao=ao, ao_floor=ao_floor)
    if col_box is not None:
        root['col_box'] = [float(col_box[0]), float(col_box[1])]
    if col_r is not None:
        root['col_r'] = float(col_r)
    return root


def shingle_col(rng, row, s):
    """Weathered wooden shingles: warm browns with a few grey, sun-bleached ones."""
    c = mix('wood_dark', 'wood', rng.uniform(0.35, 0.95))
    if rng.random() < 0.18:
        c = tone(c, 1.0, 'wood_grey', rng.uniform(0.3, 0.6))
    return tone(c, rng.uniform(0.92, 1.06))


def slate_col(rng, row, s):
    c = mix('slate', 'stone_dark', rng.uniform(0.0, 0.6))
    if rng.random() < 0.15:
        c = tone(c, 1.0, 'moss', rng.uniform(0.2, 0.45))
    return tone(c, rng.uniform(0.9, 1.1))


# ---------------------------------------------------------------------------
# house_hut - the player's starting croft (5 x 4 m)
# ---------------------------------------------------------------------------
def house_hut():
    b = Builder(seed=101)
    W, D = 5.0, 4.0
    BASE_H = 0.3
    fr = rect_frames(W, D)
    t = 0.42
    for key, (F, L) in fr.items():
        u0, u1 = (-L / 2, L / 2) if key in ('front', 'back') else (-L / 2 + t, L / 2 - t)
        stone_wall(b, F, u0, u1, 0.0, BASE_H, thick=t, course=(BASE_H, BASE_H),
                   length=(0.45, 0.8), jitter=0.03, moss_top=0.3)
    b.box((W - 0.6, D - 0.6, BASE_H - 0.04), loc=(0, 0, BASE_H / 2), color='stone_dark')

    # --- log walls (hexagonal logs, notched corners with light end grain)
    R, STEP, WC = 0.14, 0.25, -0.2
    Ff, Fr, Fb, Fl = (fr[k][0] for k in ('front', 'right', 'back', 'left'))
    door_w, door_h = 0.95, 1.78
    win_u, win_v, win_w, win_h = 1.425, 1.565, 0.62, 0.44
    front_open = [(-0.5, 0.5, BASE_H, BASE_H + door_h),
                  (win_u - 0.325, win_u + 0.325, 1.40, 1.72)]
    log_wall(b, Ff, -(W / 2 - 0.2), W / 2 - 0.2, BASE_H, 8, r=R, step=STEP, w_c=WC,
             ext=0.18, openings=front_open)
    log_wall(b, Fb, -(W / 2 - 0.2), W / 2 - 0.2, BASE_H, 8, r=R, step=STEP, w_c=WC,
             ext=0.18)
    for F in (Fr, Fl):
        log_wall(b, F, -(D / 2 - 0.2), D / 2 - 0.2, BASE_H, 7, r=R, step=STEP, w_c=WC,
                 ext=0.18, offset=STEP / 2)
    z_wall = BASE_H + R + 7 * STEP + R          # top of the front/back walls

    # --- roof geometry (30 deg turf roof, ridge along X)
    tn = math.tan(math.radians(30))
    y_wall = D / 2 - 0.06
    ov, xg, th = 0.42, W / 2 + 0.25, 0.07
    dz = th / math.cos(math.radians(30))

    def z_under(y):
        return z_wall + (y_wall - abs(y)) * tn

    ye = y_wall + ov
    ze, zr = z_under(ye) + dz, z_under(0) + dz
    # gable planks on the side walls, up to the roof underside
    for F in (Fr, Fl):
        plank_wall(b, F, -y_wall, y_wall, z_wall - 0.26,
                   lambda u: z_under(u) - 0.005, w_out=-0.06, thick=0.06,
                   color=mix('wood', 'wood_dark', 0.25), pw=(0.24, 0.3))
    sag = 0.07
    Sf = Slope((-xg, -ye, ze), (xg, -ye, ze), (-xg, 0, zr), (xg, 0, zr), sag=sag,
               eave_wave=0.05, seed=1)
    Sb = Slope((xg, ye, ze), (-xg, ye, ze), (xg, 0, zr), (-xg, 0, zr), sag=sag,
               eave_wave=0.05, seed=2)
    for S in (Sf, Sb):
        slope_slab(b, S, thick=th, ns=6, color=BEAM)
        turf(b, S, nu=12, nt=5, thick=0.2, lump=0.045)
        tufts_on(b, S, 16, t_range=(0.12, 0.92), lift=0.2,
                 colors=('grass', 'leaf', 'turf', 'straw'))
    flowers_on(b, Sf, 5, t_range=(0.2, 0.8), lift=0.2, colors=('bone', 'mush_yellow'))
    # ridge roll of turf (follows the sag)
    pts = []
    for i in range(9):
        s = i / 8
        p = Sf.R(s)
        pts.append((p.x * (xg - 0.04) / xg, 0, p.z + 0.14))
    sweep(b, pts, [b.rng.uniform(0.17, 0.21) for _ in pts], seg=6, color='turf',
          jitter=0.02, var=0.08, phase=0.3)
    # barge boards crossing above the ridge
    for sx in (-1, 1):
        x = sx * (xg + 0.03)
        for sy in (-1, 1):
            p0 = (x, sy * (ye + 0.03), ze + 0.06)
            p1 = (x, -sy * 0.3, zr + 0.06 + 0.3 * tn)
            beam(b, p0, p1, 0.06, 0.28, color=BEAM, jitter=0.006)

    # --- chimney (stacked stones through the front slope)
    cx, cy = 1.55, -0.38
    z = 2.95
    for i in range(7):
        h = 0.22
        if i % 2:
            for sx in (-1, 1):
                b.box((0.3, 0.62, h - 0.01), loc=(cx + sx * 0.155, cy, z + h / 2),
                      color=stone_color(b.rng, 'stone'), jitter=0.02)
        else:
            for sy in (-1, 1):
                b.box((0.62, 0.3, h - 0.01), loc=(cx, cy + sy * 0.155, z + h / 2),
                      color=stone_color(b.rng, 'stone'), jitter=0.02)
        z += h
    b.box((0.76, 0.76, 0.08), loc=(cx, cy, z + 0.04), color='stone_dark', jitter=0.015)
    b.box((0.36, 0.36, 0.12), loc=(cx, cy, z + 0.14), color='stone', jitter=0.02)
    smoke = (cx, cy, z + 0.3)

    # --- door, step and window
    door(b, Ff, 0.0, door_w, door_h, w_face=-0.08, v0=BASE_H, recess=0.1, planks=4)
    b.box((1.15, 0.42, 0.14), loc=(0, -D / 2 - 0.17, 0.07), color='stone', jitter=0.02)
    glow = window(b, Ff, win_u, win_v, win_w, win_h, w_face=-0.08, depth=0.16)

    # --- woodpile left of the door (logs end-on to the camera)
    for row in range(3):
        for i in range(6 - row):
            x = -2.2 + 0.075 + row * 0.075 + i * 0.15
            z = 0.075 + row * 0.13
            log(b, (x, -D / 2 - 0.02, z), (x + b.rng.uniform(-0.02, 0.02), -D / 2 - 0.44, z),
                0.07, seg=5, color='bark', end_color='wood_light', jitter=0.006)
    barrel(b, (2.05, -D / 2 - 0.3, 0), r=0.26, h=0.7, color='wood')
    grass_edge(b, W, D, 11, margin=0.4, skip=lambda x, y: abs(x) < 0.75 and y < 0)

    root = finish(b, 'house_hut', col_box=(W, D))
    empty('door', (0, -D / 2 - 0.5, 0), root)
    empty('light', tuple(glow), root)
    empty('smoke', smoke, root)
    return root


# ---------------------------------------------------------------------------
# house_longhouse - upgraded Norse longhouse (11 x 6 m)
# ---------------------------------------------------------------------------
def house_longhouse():
    b = Builder(seed=202)
    L2, HD0, BOW = 5.35, 2.7, 0.26     # half length, half depth at ends, wall bow
    SILL = 0.22

    def hd(x):
        return HD0 + BOW * max(0.0, 1.0 - (x / L2) ** 2)

    Pf = PathFrame(lambda u: Vector((u, -hd(u), 0.0)))
    Pb = PathFrame(lambda u: Vector((-u, hd(-u), 0.0)))
    Fr, Fl = Frame((L2, 0, 0), 90), Frame((-L2, 0, 0), 270)

    # --- roof: bowed eaves, convex (hogback) ridge, 42 deg
    tn = math.tan(math.radians(42))
    OV, RX, th = 0.42, L2 + 0.45, 0.08
    z_plate = 2.62
    dz = th / math.cos(math.radians(42))
    ze = z_plate - OV * tn + dz
    zr = z_plate + HD0 * tn + dz
    HOG = 0.32
    Sf = Slope((-RX, -(HD0 + OV), ze), (RX, -(HD0 + OV), ze), (-RX, 0, zr), (RX, 0, zr),
               bow=BOW, bow_dir=(0, -1, 0), sag=-HOG)
    Sb = Slope((RX, HD0 + OV, ze), (-RX, HD0 + OV, ze), (RX, 0, zr), (-RX, 0, zr),
               bow=BOW, bow_dir=(0, 1, 0), sag=-HOG)

    def under_z(x, y):
        S, s = (Sf, (x + RX) / (2 * RX)) if y < 0 else (Sb, (RX - x) / (2 * RX))
        E, R = S.E(s), S.R(s)
        t = (y - E.y) / (R.y - E.y)
        n = S.N(s, t)
        return E.lerp(R, t).z - th / max(0.3, n.z)

    # --- stone sill
    for P_ in (Pf, Pb):
        stone_wall(b, P_, -L2 - 0.12, L2 + 0.12, 0.0, SILL, w_out=0.08, thick=0.42,
                   course=(SILL, SILL), length=(0.6, 1.0), jitter=0.03, moss_top=0.25)
    for F in (Fr, Fl):
        stone_wall(b, F, -HD0 + 0.34, HD0 - 0.34, 0.0, SILL, w_out=0.08, thick=0.42,
                   course=(SILL, SILL), length=(0.6, 1.0), jitter=0.03, moss_top=0.25)
    b.box((2 * L2 - 0.6, 2 * HD0 - 0.4, SILL - 0.04), loc=(0, 0, SILL / 2), color='stone_dark')

    # --- stave walls
    DW, DH = 1.6, 1.92
    WX, WV, WW, WH = 3.35, 1.5, 0.62, 0.5
    front_open = [(-DW / 2, DW / 2, SILL, SILL + DH)]
    for sx in (-1, 1):
        front_open.append((sx * WX - 0.34, sx * WX + 0.34, WV - 0.28, WV + 0.28))
    wall_c = mix('wood', 'wood_dark', 0.3)
    plank_wall(b, Pf, -L2, L2, SILL, lambda u: under_z(u, -hd(u)) - 0.01, thick=0.09,
               pw=(0.34, 0.44), color=wall_c, openings=front_open)
    plank_wall(b, Pb, -L2, L2, SILL, lambda u: under_z(-u, hd(-u)) - 0.01, thick=0.09,
               pw=(0.38, 0.5), color=wall_c)
    plank_wall(b, Fr, -HD0, HD0, SILL, lambda u: under_z(L2, u) - 0.01, thick=0.09,
               pw=(0.32, 0.42), color=wall_c)
    plank_wall(b, Fl, -HD0, HD0, SILL, lambda u: under_z(-L2, -u) - 0.01, thick=0.09,
               pw=(0.32, 0.42), color=wall_c)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (L2 - 0.06), sy * (HD0 - 0.06)
            top = under_z(x, y) - 0.02
            b.box((0.26, 0.26, top - SILL), loc=(x, y, SILL + (top - SILL) / 2),
                  color=BEAM, jitter=0.008)

    # --- roof
    for S in (Sf, Sb):
        slope_slab(b, S, thick=th, ns=8, color=BEAM)
        shingles(b, S, rows=10, cols=14, lift=0.055, jitter=0.012,
                 col_fn=shingle_col)
    ridge = [Sf.R(i / 8) + Vector((0, 0, 0.07)) for i in range(9)]
    ridge[0].x += 0.1
    ridge[-1].x -= 0.1
    sweep(b, ridge, 0.13, seg=6, color=BEAM, jitter=0.01)
    # smoke louvre on the ridge
    zt = Sf.R(0.5).z + 0.1
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.1, 0.1, 0.4), loc=(sx * 0.45, sy * 0.16, zt + 0.1), color=BEAM)
    for sy in (-1, 1):
        beam(b, (-0.66, sy * 0.25, zt + 0.37), (0.66, sy * 0.25, zt + 0.37), 0.58, 0.05,
             color=shingle_col(b.rng, 0, 0), roll=sy * 28)
    b.box((1.36, 0.12, 0.1), loc=(0, 0, zt + 0.5), color=BEAM)
    smoke = (0, 0, zt + 0.65)

    # --- gable details: tie beam, small dark vent and a hanging shield
    for F, sx in ((Fr, 1), (Fl, -1)):
        zt = under_z(sx * L2, 0.0) + 0.0
        F.box(b, (2 * HD0 + 0.3, 0.16, 0.18), (0.0, z_plate - 0.05, 0.06), color=BEAM, jitter=0.006)
        F.box(b, (0.46, 0.36, 0.06), (0.0, z_plate + 1.35, 0.02), color=mix('coal', 'wood_dark', 0.6))
        for dv in (-0.2, 0.2):
            F.box(b, (0.56, 0.06, 0.1), (0.0, z_plate + 1.35 + dv, 0.05), color=BEAM)
        for du in (-0.26, 0.26):
            F.box(b, (0.06, 0.46, 0.1), (du, z_plate + 1.35, 0.05), color=BEAM)
        shield(b, F.p(0.0, 1.45, 0.06), F.W, r=0.42, colors=('bone', 'red_dark'), sectors=4, seg=8,
               phase=0.2)
        for d in (-1, 1):
            p0, p1 = F.p(-0.55 * d, 1.0, 0.1), F.p(0.55 * d, 1.95, 0.1)
            beam(b, p0, p1, 0.04, 0.04, color='wood_light')
            dd = (p1 - p0).normalized()
            beam(b, p1 - dd * 0.02, p1 - dd * 0.2, 0.2, 0.025, color='iron', mat='metal', up=F.W)
    # --- barge boards + dragon heads on both gables
    for sx in (-1, 1):
        x = sx * (RX + 0.02)
        s = 1.0 if sx > 0 else 0.0
        for S, sgn in ((Sf, 1), (Sb, -1)):
            ss = s if S is Sf else 1.0 - s
            e, r = S.P(ss, 0.0), S.P(ss, 1.0)
            n = S.N(ss, 0.5)
            d = (r - e).normalized()
            p0 = e + n * 0.06 - d * 0.05
            p1 = r + n * 0.06 + d * 0.42
            beam(b, (x, p0.y, p0.z), (x, p1.y, p1.z), 0.08, 0.34, color=BEAM, jitter=0.006)
        top = Sf.P(s, 1.0)
        dragon_head(b, (x, 0.0, top.z + 0.22), (sx, 0, 0), s=1.05, color=BEAM,
                    accent='ochre')

    # --- double door, step, antlers
    F0 = Pf.frame_at(0.0)
    door(b, F0, 0.0, DW, DH, w_face=0.0, v0=SILL, double=True, recess=0.07, planks=6,
         fw=0.14)
    b.box((2.1, 0.5, 0.13), loc=(0, -hd(0) - 0.28, 0.065), color='stone', jitter=0.02)
    # --- windows
    lights = []
    for sx in (-1, 1):
        Fw = Pf.frame_at(sx * WX)
        lights.append(window(b, Fw, 0.0, WV, WW, WH, w_face=0.0, depth=0.16))
    # --- shields on the wall
    sh_cols = [('red', 'bone'), ('blue', 'ochre'), ('bone', 'green'), ('red_dark', 'ochre')]
    for i, u in enumerate((-4.75, -1.95, 1.95, 4.75)):
        T, W = Pf._tw(u)
        shield(b, Pf.p(u, 1.55, 0.05), W, r=0.36, colors=sh_cols[i], sectors=4, seg=8,
               phase=0.4 * i)

    grass_edge(b, 2 * L2 + 0.2, 2 * (HD0 + BOW) + 0.1, 6, margin=0.35, skip=lambda x, y: abs(x) < 1.2 and y < 0)
    root = finish(b, 'house_longhouse', col_box=(11.0, 6.0))
    empty('door', (0, -3.0 - 0.45, 0), root)
    empty('light_1', tuple(lights[0]), root)
    empty('light_2', tuple(lights[1]), root)
    empty('smoke', smoke, root)
    return root


# ---------------------------------------------------------------------------
# small shared props used on several buildings
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# villager_house_a - Bramble's forge-house (5 x 5 m)
# ---------------------------------------------------------------------------
def villager_house_a():
    b = Builder(seed=303)
    X0, X1, Y0, Y1 = -2.45, 0.85, -1.95, 2.45
    W, D = X1 - X0, Y1 - Y0
    cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
    STONE_H, EAVE = 1.15, 2.55
    fr = rect_frames(W, D, cx, cy)
    Ff, Fr, Fb, Fl = (fr[k][0] for k in ('front', 'right', 'back', 'left'))
    tn = 1.0                          # 45 deg roof
    OV, th = 0.35, 0.07

    def under(x):
        return EAVE + (W / 2 - abs(x - cx)) * tn - th * 1.414

    # --- lower stone walls
    DW, DH = 1.0, 1.85
    WU, WV = -1.05, 1.62
    for key, (F, L) in fr.items():
        u0, u1 = (-L / 2, L / 2) if key in ('front', 'back') else (-L / 2 + 0.4, L / 2 - 0.4)
        opens = [(-DW / 2 - 0.02, DW / 2 + 0.02, 0.0, 3.0)] if key == 'front' else []
        big = key in ('back', 'right')
        stone_wall(b, F, u0, u1, 0.0, STONE_H, thick=0.4,
                   course=(0.36, 0.42) if big else (0.3, 0.4),
                   length=(0.7, 1.1) if big else (0.45, 0.8), jitter=0.025, moss_top=0.0,
                   openings=opens)
    b.box((W - 0.7, D - 0.7, STONE_H), loc=(cx, cy, STONE_H / 2), color='stone_dark')
    # --- timber upper walls and gables
    wall_c = mix('wood', 'wood_dark', 0.35)
    plank_wall(b, Ff, -W / 2 + 0.03, W / 2 - 0.03, STONE_H - 0.06, lambda u: under(cx + u) - 0.01,
               w_out=-0.06, thick=0.08, color=wall_c,
               openings=[(-DW / 2 - 0.02, DW / 2 + 0.02, 0.0, DH + 0.05),
                         (WU - 0.3, WU + 0.3, WV - 0.3, WV + 0.3)])
    plank_wall(b, Fb, -W / 2 + 0.03, W / 2 - 0.03, STONE_H - 0.06, lambda u: under(cx - u) - 0.01,
               w_out=-0.06, thick=0.08, color=wall_c)
    for F in (Fr, Fl):
        plank_wall(b, F, -D / 2 + 0.03, D / 2 - 0.03, STONE_H - 0.06, EAVE - 0.02,
                   w_out=-0.06, thick=0.08, color=wall_c)
    for sx in (X0 + 0.07, X1 - 0.07):
        for sy in (Y0 + 0.07, Y1 - 0.07):
            b.box((0.18, 0.18, EAVE - STONE_H + 0.05), loc=(sx, sy, (EAVE + STONE_H) / 2),
                  color=BEAM, jitter=0.006)
    # --- slate roof (ridge along Y)
    ze = EAVE - OV * tn + th * 1.414 - 0.02
    zr = EAVE + W / 2 * tn + th * 1.414 - 0.02
    oy = 0.3
    Sl = Slope((X0 - OV, Y1 + oy, ze), (X0 - OV, Y0 - oy, ze), (cx, Y1 + oy, zr), (cx, Y0 - oy, zr))
    Sr = Slope((X1 + OV, Y0 - oy, ze), (X1 + OV, Y1 + oy, ze), (cx, Y0 - oy, zr), (cx, Y1 + oy, zr))
    for S in (Sl, Sr):
        slope_slab(b, S, thick=th, color=BEAM)
        shingles(b, S, rows=9, cols=9, lift=0.04, jitter=0.01, col_fn=slate_col)
    sweep(b, [(cx, Y0 - oy - 0.05, zr + 0.05), (cx, Y1 + oy + 0.05, zr + 0.05)], 0.12, seg=4,
          color='slate', phase=math.pi / 4)
    for yy, sgn in ((Y0 - oy - 0.03, -1), (Y1 + oy + 0.03, 1)):
        for S, sx in ((Sl, -1), (Sr, 1)):
            e = Vector((cx + sx * (W / 2 + OV), yy, ze + 0.02))
            r = Vector((cx, yy, zr + 0.02))
            d = (r - e).normalized()
            beam(b, e - d * 0.04, r + d * 0.28, 0.07, 0.26, color=BEAM, up=(0, 1, 0))
    # --- door and window
    door(b, Ff, 0.0, DW, DH, w_face=-0.02, v0=0.0, recess=0.12, planks=4)
    win = window(b, Ff, WU, WV, 0.46, 0.46, w_face=-0.06, depth=0.14, shutters=False)
    b.box((1.2, 0.4, 0.1), loc=(cx, Y0 - 0.2, 0.05), color='stone_dark', jitter=0.015)

    # --- forge block, hood and chimney
    FX0, FX1, FY0, FY1 = 0.9, 2.45, -1.75, 0.35
    Fk = Frame(((FX0 + FX1) / 2, FY0, 0), 0)
    Fkr = Frame((FX1, (FY0 + FY1) / 2, 0), 90)
    fw_ = FX1 - FX0
    mouth = (-0.42, 0.42, 0.36, 0.92)
    stone_wall(b, Fk, -fw_ / 2, fw_ / 2, 0.0, 1.1, thick=0.35, course=(0.34, 0.4),
               length=(0.35, 0.6), jitter=0.02, moss_top=0.0, openings=[mouth],
               colors=lambda r: stone_color(r, 'stone'))
    stone_wall(b, Fkr, -(FY1 - FY0) / 2 + 0.35, (FY1 - FY0) / 2, 0.0, 1.1, thick=0.35,
               course=(0.5, 0.6), length=(0.6, 0.9), jitter=0.02, moss_top=0.0)
    b.box((fw_ - 0.3, FY1 - FY0 - 0.65, 1.08), loc=((FX0 + FX1) / 2, (FY0 + 0.5 + FY1 - 0.15) / 2, 0.54),
          color='stone_dark')
    mx = (FX0 + FX1) / 2
    # cavity, coals and glow
    b.box((0.86, 0.05, 0.58), loc=(mx, FY0 + 0.45, 0.64), color=mix('coal', 'stone_dark', 0.5))
    b.box((0.86, 0.5, 0.05), loc=(mx, FY0 + 0.22, 0.34), color='stone_dark')
    embers(b, (mx, FY0 + 0.28, 0.38), r=0.3, n=9, size=0.075)
    b.box((0.74, 0.03, 0.34), loc=(mx, FY0 + 0.42, 0.55), color=EMBER, mat='emit', var=0.1)
    b.box((0.4, 0.03, 0.16), loc=(mx, FY0 + 0.4, 0.5), color=FLAME, mat='emit', var=0.1)
    flame(b, (mx - 0.12, FY0 + 0.3, 0.4), h=0.34, r=0.1, color=FLAME)
    flame(b, (mx + 0.12, FY0 + 0.26, 0.4), h=0.24, r=0.07, color=FLAME_HOT)
    flame(b, (mx + 0.02, FY0 + 0.34, 0.4), h=0.2, r=0.07, color=EMBER)
    b.box((1.05, 0.4, 0.2), loc=(mx, FY0 + 0.12, 1.02), color='stone', jitter=0.015)
    b.box((1.8, 2.25, 0.12), loc=(mx, (FY0 + FY1) / 2, 1.14), color='stone_dark', jitter=0.02)
    # hood: tapering courses up to the shaft
    CX0, CX1, CY0, CY1 = 1.15, 2.25, -0.8, 0.3
    z0 = 1.2
    for k in range(4):
        t0, t1 = k / 4, (k + 1) / 4
        za, zb = z0 + t0 * 0.95, z0 + t1 * 0.95

        def rect(t):
            x0 = FX0 + 0.08 + (CX0 - FX0 - 0.08) * t
            x1 = FX1 - 0.08 + (CX1 - FX1 + 0.08) * t
            y0 = FY0 + 0.15 + (CY0 - FY0 - 0.15) * t
            y1 = FY1 - 0.05 + (CY1 - FY1 + 0.05) * t
            return x0, x1, y0, y1
        a0, a1, b0, b1 = rect(t0)
        c0, c1, d0, d1 = rect(t1)
        hexa(b, [(a0, b0, za), (a1, b0, za), (a1, b1, za), (a0, b1, za),
                 (c0, d0, zb), (c1, d0, zb), (c1, d1, zb), (c0, d1, zb)],
             stone_color(b.rng, 'stone'), jitter=0.03, var=0.12)
    z = z0 + 0.95
    k = 0
    while z < 5.3:
        h = b.rng.uniform(0.3, 0.38)
        if k % 3 == 2:
            b.box((CX1 - CX0, CY1 - CY0, h - 0.012), loc=((CX0 + CX1) / 2, (CY0 + CY1) / 2, z + h / 2),
                  color=stone_color(b.rng, 'stone'), jitter=0.025)
        elif k % 3 == 1:
            for sx in (-1, 1):
                b.box(((CX1 - CX0) / 2 - 0.01, CY1 - CY0, h - 0.012),
                      loc=((CX0 + CX1) / 2 + sx * (CX1 - CX0) / 4, (CY0 + CY1) / 2, z + h / 2),
                      color=stone_color(b.rng, 'stone'), jitter=0.02)
        else:
            for sy in (-1, 1):
                b.box((CX1 - CX0, (CY1 - CY0) / 2 - 0.01, h - 0.012),
                      loc=((CX0 + CX1) / 2, (CY0 + CY1) / 2 + sy * (CY1 - CY0) / 4, z + h / 2),
                      color=stone_color(b.rng, 'stone'), jitter=0.02)
        z += h
        k += 1
    ccx, ccy = (CX0 + CX1) / 2, (CY0 + CY1) / 2
    b.box((CX1 - CX0 + 0.16, CY1 - CY0 + 0.16, 0.1), loc=(ccx, ccy, z + 0.05), color='stone_dark', jitter=0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.2, 0.2, 0.26), loc=(ccx + sx * 0.4, ccy + sy * 0.38, z + 0.23), color='stone', jitter=0.015)
    b.box((CX1 - CX0 + 0.1, CY1 - CY0 + 0.1, 0.1), loc=(ccx, ccy, z + 0.41), color='stone_dark', jitter=0.02)
    smoke = (ccx, ccy, z + 0.3)

    # --- work area: anvil, quench barrel with tongs, coal
    anvil_on_stump(b, 0.82, -2.2, rot=-20)
    barrel(b, (0.1, -2.18, 0), r=0.27, h=0.6, color='wood', lid_color=mix('blue_dark', 'teal', 0.4))
    beam(b, (0.02, -2.16, 0.35), (-0.08, -2.24, 0.95), 0.025, 0.025, color='iron', mat='metal')
    beam(b, (0.08, -2.14, 0.35), (0.0, -2.26, 0.93), 0.025, 0.025, color='iron', mat='metal')
    coal_pile(b, 2.2, -2.15, r=0.26, n=7)
    # hanging sign: iron bracket + board with an anvil emblem
    bx, by = X0 + 0.05, Y0 - 0.02
    beam(b, (bx, by, 2.15), (bx, by - 0.75, 2.15), 0.04, 0.04, color=IRON, mat='metal')
    beam(b, (bx, by, 1.8), (bx, by - 0.45, 2.13), 0.03, 0.03, color=IRON, mat='metal')
    for dy in (-0.2, -0.62):
        b.box((0.015, 0.015, 0.14), loc=(bx, by + dy, 2.07), color=IRON, mat='metal')
    b.box((0.05, 0.56, 0.36), loc=(bx, by - 0.41, 1.82), color=TIMBER_LT, jitter=0.005)
    for sx in (-1, 1):
        Fs = Frame((bx + sx * 0.026, by - 0.41, 0), 90 if sx > 0 else 270)
        pts = [(-0.14, 0.05), (0.14, 0.05), (0.14, 0.09), (0.19, 0.11), (0.19, 0.14),
               (-0.11, 0.14), (-0.2, 0.11), (-0.06, 0.09), (-0.06, 0.05)]
        pts = [(u * sx, v + 1.66) for (u, v) in pts]
        if sx < 0:
            pts = list(reversed(pts))
        ngon_prism(b, pts, 0.012, frame=Fs, w0=-0.002, color='iron', mat='metal')

    grass_edge(b, 5.1, 5.1, 5, margin=0.3, skip=lambda x, y: -1.5 < x < 1.2 and y < 0)
    root = finish(b, 'villager_house_a', col_box=(5.0, 5.0))
    empty('door', (cx, -2.5 - 0.45, 0), root)
    empty('light_1', (mx, FY0 - 0.12, 0.62), root)
    empty('light_2', tuple(win), root)
    empty('smoke', smoke, root)
    return root


# ---------------------------------------------------------------------------
# villager_house_b - Mothwyn's lantern cottage (4.5 x 4.5 m, round)
# ---------------------------------------------------------------------------
def villager_house_b():
    b = Builder(seed=404)
    R = 1.85                      # wall outer radius
    BASE = 0.2
    TOP = 2.3
    front = -90.0

    def polar(a_deg, r, z=0.0):
        a = math.radians(a_deg)
        return Vector((math.cos(a) * r, math.sin(a) * r, z))

    def wall_frame(a_deg, r=R):
        return Frame(polar(a_deg, r), a_deg + 90.0)

    # --- stone ring base
    n = 15
    for i in range(n):
        a = 360.0 * (i + 0.5) / n
        p = polar(a, R - 0.1)
        b.box((2 * math.pi * R / n - 0.04, 0.42, BASE + 0.04), loc=(p.x, p.y, BASE / 2),
              rot=(0, 0, a + 90), color=stone_color(b.rng, moss=0.25), jitter=0.025)
    # --- daub wall + timber ring beams + posts
    daub = mix('linen', 'sand', 0.45)
    fs = b.lathe([(R - 0.02, BASE - 0.02), (R - 0.004, 0.74), (R + 0.02, 1.1), (R - 0.01, TOP)], seg=18,
                 color=daub, var=0.06, cap_bottom=False, cap_top=True)
    for f in fs:
        if f.calc_center_median().z < 0.72 and len(f.verts) == 4:
            paint(b, [f], mix('bark', 'wood', 0.4), 0.08)
    # exposed wattle weave where the daub has worn away (front half, lower band)
    wat = mix('wood_light', 'bark', 0.35)
    for row, z in enumerate((0.3, 0.44, 0.58)):
        for (a0, a1) in ((-172.0, -106.0), (-74.0, -8.0)):
            pts = []
            n = 10
            for i in range(n):
                a = a0 + (a1 - a0) * i / (n - 1)
                r = R + 0.03 + 0.022 * math.sin(math.radians(a) * 9 + row * math.pi)
                p = polar(a, r, z + 0.01 * math.sin(i * 1.7))
                pts.append(p)
            sweep(b, pts, 0.028, seg=3, color=rvar(b.rng, wat, 0.06), phase=row)
    b.lathe([(R + 0.05, TOP - 0.16), (R + 0.06, TOP + 0.02)], seg=18, color=BEAM,
            cap_bottom=False, cap_top=False, var=0.08)
    b.lathe([(R + 0.035, BASE), (R + 0.045, BASE + 0.14)], seg=18, color=BEAM,
            cap_bottom=False, cap_top=False, var=0.08)
    door_a, win_as = front, (front - 46, front + 46)
    for i in range(9):
        a = 360.0 * i / 9 + 20
        if min(abs((a - door_a + 180) % 360 - 180), *[abs((a - w + 180) % 360 - 180) for w in win_as]) < 18:
            continue
        p = polar(a, R + 0.02)
        b.box((0.13, 0.1, TOP - BASE), loc=(p.x, p.y, (TOP + BASE) / 2), rot=(0, 0, a + 90),
              color=BEAM, jitter=0.01)
        # diagonal wattle braces showing through the daub
    # --- thatch: three layered tiers + ridge knot
    tiers = [(2.4, 2.02, 1.55, 3.42), (1.72, 3.17, 0.95, 4.55), (1.1, 4.3, 0.0, 5.8)]
    for k, (r_lip, z_lip, r_top, z_top) in enumerate(tiers):
        prof = [(r_lip - 0.35, z_lip + 0.12), (r_lip, z_lip), (r_lip - 0.02, z_lip + 0.2),
                ((r_lip + r_top) / 2 + 0.05, (z_lip + z_top) / 2 + 0.05), (r_top, z_top)]
        if r_top <= 0:
            prof[-1] = (0.0, z_top)
        fs = b.lathe(prof, seg=16, color='thatch', jitter=0.03, var=0.1,
                     cap_bottom=True, cap_top=False)
        for f in fs:
            c = mix('thatch', 'straw', b.rng.uniform(0.0, 0.5)) if k < 2 else mix('thatch', 'wood_grey', b.rng.uniform(0.1, 0.4))
            paint(b, [f], tone(c, b.rng.uniform(0.85, 1.05)), 0.05)
    # binding ring near the top + finial with a crescent moon
    b.cyl(0.2, 0.12, h=0.25, seg=8, loc=(0, 0, 5.5), color=mix('straw', 'thatch', 0.4), jitter=0.01)
    b.cyl(0.04, 0.03, h=0.75, seg=5, loc=(0, 0, 5.7), color=BEAM)
    moon = []
    for i in range(13):
        a = math.radians(-120 + 240 * i / 12)
        moon.append((math.cos(a) * 0.26, math.sin(a) * 0.26))
    for i in range(12, -1, -1):
        a = math.radians(-100 + 200 * i / 12)
        moon.append((math.cos(a) * 0.19 + 0.09, math.sin(a) * 0.2))
    Fm = Frame((0, 0.02, 0), 0)
    from bldkit import ngon_prism
    ngon_prism(b, [(u - 0.02, v + 6.48) for (u, v) in moon], 0.04, frame=Fm, w0=0.0,
               color=mix('gold', 'bone', 0.5), mat='metal')
    # --- small chimney through the back of the thatch
    cp = polar(60, 1.05)
    for i in range(4):
        b.box((0.36, 0.36, 0.26), loc=(cp.x, cp.y, 4.15 + i * 0.25 + 0.13), rot=(0, 0, 60 + i * 7),
              color=stone_color(b.rng, 'stone'), jitter=0.02)
    b.box((0.44, 0.44, 0.07), loc=(cp.x, cp.y, 5.18), rot=(0, 0, 60), color='stone_dark')
    smoke = (cp.x, cp.y, 5.35)

    # --- arched lilac door with a little canopy
    Fd = wall_frame(door_a, R + 0.14)
    lilac = mix('purple', 'wool', 0.5)
    door(b, Fd, 0.0, 0.92, 1.9, w_face=0.0, v0=BASE, recess=0.1, planks=4, arch=True,
         leaf_c=lilac, fw=0.13)
    b.box((1.2, 0.5, 0.12), loc=(0, -R - 0.38, 0.06), color='stone', jitter=0.02)
    # moth motif on the door (two pale wing pairs)
    for sx in (-1, 1):
        for (du, dv, s) in ((0.12, 1.25, 0.11), (0.1, 1.08, 0.08)):
            Fd.box(b, (s * 1.3, s, 0.02), (sx * du, BASE + dv, -0.1 + 0.01), rot=(0, sx * 25, 0),
                   color=mix('wool', 'bone', 0.5))
    # --- round windows
    lights = []
    for wa in win_as:
        Fw = wall_frame(wa, R + 0.1)
        window(b, Fw, 0.0, 1.45, 0.5, 0.5, w_face=0.0, depth=0.14, round_=True, seg=10,
               frame_c=BEAM)
    # --- hanging lanterns under the eave + a garland between the front two
    eave_r, hook_z = 2.5, 1.9
    lan_angles = (front - 60, front + 60, 42, 138)
    for a in lan_angles:
        p0, p1 = polar(a, R), polar(a, eave_r + 0.06)
        beam(b, (p0.x, p0.y, hook_z), (p1.x, p1.y, hook_z), 0.04, 0.04, color=IRON, mat='metal')
        q = polar(a, R + 0.35)
        beam(b, (p0.x, p0.y, hook_z - 0.4), (q.x, q.y, hook_z), 0.03, 0.03, color=IRON, mat='metal')
        p = polar(a, eave_r)
        b.box((0.025, 0.025, 0.14), loc=(p.x, p.y, hook_z - 0.07), color=IRON, mat='metal')
        g = lantern(b, (p.x, p.y, hook_z - 0.13), s=1.15)
        lights.append(g)
    a0, a1 = lan_angles[0], lan_angles[1]
    prev = None
    nb = 7
    for i in range(nb + 1):
        t = i / nb
        a = a0 + (a1 - a0) * t
        p = polar(a, eave_r - 0.02)
        z = hook_z - 0.02 - math.sin(math.pi * t) * 0.32
        cur = Vector((p.x, p.y, z))
        if prev is not None:
            beam(b, prev, cur, 0.012, 0.012, color='rope')
        if 0 < i < nb:
            b.ico(r=0.045, sub=0, loc=(cur.x, cur.y, cur.z - 0.05),
                  color=(LANTERN if i % 2 else mix('glow_purple', 'wool', 0.4)), mat='emit', var=0.05)
        prev = cur
    # --- lantern post by the door
    px, py = 1.35, -2.05
    sweep(b, [(px, py, -0.05), (px + 0.03, py, 1.0), (px - 0.02, py + 0.02, 1.9), (px, py, 2.25)],
          [0.07, 0.06, 0.055, 0.05], seg=6, color=BEAM, jitter=0.005)
    beam(b, (px, py, 2.1), (px - 0.5, py, 2.12), 0.05, 0.06, color=BEAM)
    beam(b, (px, py, 1.8), (px - 0.3, py, 2.1), 0.035, 0.04, color=BEAM)
    b.box((0.02, 0.02, 0.12), loc=(px - 0.42, py, 2.03), color=IRON, mat='metal')
    lights.append(lantern(b, (px - 0.42, py, 1.97), s=1.15))
    # --- pale moonflowers and grass around the front
    for i in range(10):
        a = front + b.rng.uniform(-110, 110)
        if abs(a - front) < 22:
            continue
        p = polar(a, R + b.rng.uniform(0.25, 0.5))
        blades(b, (p.x, p.y, 0), h=0.25, r=0.05, n=3, color='leaf_dark')
        flower(b, (p.x + 0.05, p.y, 0.0), color=b.rng.choice(('bone', 'wool', 'glow_purple')), h=0.3, r=0.06)
    # little wattle-fenced bed on the left
    fence = [polar(a, R + 0.62) for a in range(-172, -122, 7)]
    for p in fence:
        b.cyl(0.03, h=0.5, seg=4, loc=(p.x, p.y, -0.02), color=BEAM, jitter=0.008)
    for hz in (0.18, 0.34):
        for p0, p1 in zip(fence[:-1], fence[1:]):
            beam(b, (p0.x, p0.y, hz), (p1.x, p1.y, hz + 0.02), 0.04, 0.07, color=mix('bark', 'straw', 0.3))
    for i in range(6):
        a = b.rng.uniform(-168, -128)
        p = polar(a, R + b.rng.uniform(0.25, 0.45))
        blades(b, (p.x, p.y, 0), h=0.3, r=0.05, n=3, color='leaf')
        flower(b, (p.x, p.y + 0.04, 0), color=b.rng.choice(('glow_purple', 'bone', 'flax')), h=0.32, r=0.06)
    grass(b, (0, 0), 2.6, 5, avoid=lambda x, y: x * x + y * y < (R + 0.3) ** 2 or (abs(x) < 0.7 and y < 0))

    root = finish(b, 'villager_house_b', col_box=(4.5, 4.5))
    empty('door', (0, -2.25 - 0.45, 0), root)
    for i, g in enumerate(lights):
        empty(f'light_{i + 1}', tuple(g), root)
    empty('smoke', smoke, root)
    return root


# ---------------------------------------------------------------------------
# villager_house_c - Grenna's herb hut (5 x 4 m), Icelandic-style turf house
# ---------------------------------------------------------------------------
def villager_house_c():
    b = Builder(seed=505)
    PROF = [(-2.5, 0.0), (-2.4, 0.66), (-2.14, 1.3), (-1.5, 2.34), (-0.85, 3.38),
            (-0.2, 2.64), (0.48, 1.95), (0.98, 2.3), (1.45, 2.62), (1.84, 1.98),
            (2.2, 1.3), (2.42, 0.64), (2.5, 0.0)]
    TURF = 0.3
    YF, YB = -1.55, 2.0

    def prof_z(x):
        for (x0, z0), (x1, z1) in zip(PROF[:-1], PROF[1:]):
            if x0 <= x <= x1:
                return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
        return 0.0

    # --- turf mass: lofted M-profile, hipped down at the back
    fine = []
    for (x0, z0), (x1, z1) in zip(PROF[:-1], PROF[1:]):
        fine.append((x0, z0))
        fine.append(((x0 + x1) / 2, (z0 + z1) / 2))
    fine.append(PROF[-1])
    secs = [(YF + 0.12, 1.0, 1.0), (-1.05, 1.0, 1.0), (-0.6, 1.01, 1.0), (-0.1, 1.02, 1.0),
            (0.4, 1.01, 1.0), (0.85, 0.99, 1.0), (1.2, 0.95, 0.99), (1.5, 0.8, 0.97),
            (1.75, 0.58, 0.94), (1.92, 0.34, 0.9), (YB, 0.12, 0.86)]
    rings = []
    for k, (y, zk, xk) in enumerate(secs):
        ring = []
        for i, (x, z) in enumerate(fine):
            edge = i in (0, len(fine) - 1)
            jz = 0.0 if z <= 0.0 else b.rng.uniform(-0.07, 0.07)
            jx = 0.0 if edge else b.rng.uniform(-0.05, 0.05)
            jy = b.rng.uniform(-0.06, 0.06) if 0 < k < len(secs) - 1 else 0.0
            ring.append((x * xk + jx, y + jy, max(0.0, z * zk + jz)))
        rings.append(ring)
    fs, caps, _ = loft(b, rings, color='turf', closed=True, caps=True)
    for f in fs:
        f.normal_update()
        cz = f.calc_center_median().z
        if f in caps:
            paint(b, [f], mix('soil', 'turf', 0.3), 0.05)
        elif f.normal.z < -0.5:
            paint(b, [f], 'soil', 0.05)
        elif cz < 0.32:
            paint(b, [f], stone_color(b.rng, 'stone_dark'), 0.06)
        else:
            c = b.rng.choice(('turf', 'turf', 'moss', 'grass', 'leaf_dark'))
            paint(b, [f], tone(c, b.rng.uniform(0.86, 1.04)), 0.05)

    # --- timber gables (front), barge boards
    gable_c = mix('wood_grey', 'wood', 0.45)
    Fg = Frame((0, YF - 0.02, 0), 0)
    plank_wall(b, Fg, -2.16, 0.44, 0.0, lambda u: prof_z(u) - TURF, w_out=0.0, thick=0.08,
               color=gable_c, pw=(0.24, 0.3),
               openings=[(-1.3, -0.4, 0.0, 1.8), (-1.04, -0.66, 2.1, 2.46)])
    plank_wall(b, Fg, 0.52, 2.18, 0.0, lambda u: prof_z(u) - TURF, w_out=0.0, thick=0.08,
               color=gable_c, pw=(0.24, 0.3), openings=[(1.2, 1.7, 0.95, 1.45)])
    for (xa, xb, xr) in ((-2.14, 0.48, -0.85), (0.48, 2.2, 1.45)):
        for xe in (xa, xb):
            ze_, zr_ = prof_z(xe) - 0.12, prof_z(xr) - 0.1
            d = Vector((xr - xe, 0, zr_ - ze_)).normalized()
            beam(b, (xe, YF - 0.07, ze_), Vector((xr, YF - 0.07, zr_)) + d * 0.22, 0.07, 0.24,
                 color=mix('bone_dark', 'wood_grey', 0.4), up=(0, 1, 0))
    for x in (-2.14, 0.48, 2.2):
        top = prof_z(x) - 0.1
        b.box((0.16, 0.16, top), loc=(x, YF - 0.02, top / 2), color=BEAM, jitter=0.006)
    # --- door, windows
    green = mix('green', 'leaf', 0.35)
    door(b, Fg, -0.85, 0.86, 1.76, w_face=0.0, v0=0.0, recess=0.08, planks=3, leaf_c=green,
         fw=0.11)
    window(b, Fg, -0.85, 2.28, 0.34, 0.34, w_face=0.0, depth=0.12, round_=True, seg=8, fw=0.08)
    glow = window(b, Fg, 1.45, 1.2, 0.46, 0.46, w_face=0.0, depth=0.14, shutter_c=green)
    b.box((1.0, 0.36, 0.1), loc=(-0.85, YF - 0.24, 0.05), color='stone', jitter=0.02)
    # --- shelf of bottles right of the door
    sx0 = 0.02
    b.box((0.62, 0.2, 0.05), loc=(sx0, YF - 0.13, 1.12), color=BEAM)
    for dx in (-0.22, 0.22):
        beam(b, (sx0 + dx, YF - 0.03, 0.95), (sx0 + dx, YF - 0.2, 1.1), 0.04, 0.04, color=BEAM)
    for i, (c, h) in enumerate((('green', 0.22), ('ochre', 0.16), ('purple', 0.24), ('teal', 0.18))):
        bottle(b, (sx0 - 0.22 + i * 0.145, YF - 0.13, 1.145), h=h, r=0.045, color=c)
    # --- herb bundles drying under the gable eaves
    for (xe, xr) in ((-2.14, -0.85), (-0.85, 0.48), (0.48, 1.45), (1.45, 2.2)):
        for t in (0.3, 0.62):
            x = xe + (xr - xe) * t
            ztop = prof_z(x) - 0.16
            if ztop > 2.9 or ztop < 1.2:
                continue
            herb_bundle(b, (x, YF - 0.12, ztop), length=b.rng.uniform(0.22, 0.32),
                        color=b.rng.choice(('leaf', 'leaf_dark', 'moss', 'turnip_top', 'straw')))
    # drying pole across the valley between the gables
    beam(b, (-0.2, YF - 0.25, 1.7), (1.0, YF - 0.25, 1.72), 0.04, 0.04, color=BEAM)
    for x in (0.0, 0.25, 0.52, 0.8):
        herb_bundle(b, (x, YF - 0.25, 1.7), length=b.rng.uniform(0.22, 0.3),
                    color=b.rng.choice(('leaf', 'moss', 'turnip_top', 'straw')))
    # goat skull on the main gable
    goat_skull(b, (-0.85, YF - 0.12, prof_z(-0.85) - 0.02), s=1.0)
    # broom leaning by the door
    beam(b, (-1.52, YF - 0.28, 0.02), (-1.42, YF - 0.12, 1.45), 0.035, 0.035, color='wood_light')
    b.cyl(0.05, 0.13, h=0.42, seg=6, loc=(-1.53, YF - 0.3, 0.0), rot=(8, -4, 0), color='straw', jitter=0.02)
    # crooked stone chimney at the back
    cxp, cyp = -0.95, 0.9
    for i in range(5):
        b.box((0.38, 0.38, 0.24), loc=(cxp + i * 0.03, cyp + i * 0.01, 2.75 + i * 0.23 + 0.12),
              rot=(0, 0, i * 6), color=stone_color(b.rng, 'stone'), jitter=0.025)
    b.box((0.46, 0.46, 0.08), loc=(cxp + 0.15, cyp + 0.05, 3.94), rot=(0, 0, 20), color='stone_dark')
    smoke = (cxp + 0.15, cyp + 0.05, 4.1)

    # --- flowers and herbs on the turf
    placed = 0
    while placed < 30:
        x = b.rng.uniform(-2.3, 2.3)
        y = b.rng.uniform(YF + 0.15, 1.3)
        z = prof_z(x)
        if z < 0.8:
            continue
        if abs(x - cxp) < 0.35 and abs(y - cyp) < 0.35:
            continue
        if b.rng.random() < 0.55:
            flower(b, (x, y, z - 0.02), color=b.rng.choice(('bone', 'mush_yellow', 'flax', 'turnip_top', 'berry_red')),
                   h=b.rng.uniform(0.14, 0.24), r=0.05)
        else:
            blades(b, (x, y, z - 0.04), h=b.rng.uniform(0.2, 0.34), r=0.05, n=3,
                   color=b.rng.choice(('leaf_dark', 'leaf', 'moss')))
        placed += 1
    # herb bed by the side gable
    for i in range(5):
        x = 0.8 + i * 0.3
        blades(b, (x, YF - 0.4, 0.0), h=0.3, r=0.05, n=3, color='leaf')
        if i % 2 == 0:
            flower(b, (x + 0.05, YF - 0.38, 0.0), color='flax', h=0.28, r=0.05)
    for i in range(6):
        pebble(b, (0.72 + i * 0.28, YF - 0.62, 0), r=0.09)

    root = finish(b, 'villager_house_c', col_box=(5.0, 4.0))
    empty('door', (-0.85, -2.0 - 0.45, 0), root)
    empty('light', tuple(glow), root)
    empty('smoke', smoke, root)
    return root


def hull_ring(x, hb, d, zg, ns=4, lap=0.045, flip=False, fullness=0.6):
    """Cross-section of an (upturned) clinker hull at x.

    Points run from the -Y gunwale over the keel to the +Y gunwale; each
    strake laps outward on its keel-side edge.  With flip=True the hull is
    upright (keel down), for boats."""
    th = [k * (math.pi / 2) / ns for k in range(ns + 1)]
    sgn = -1.0 if flip else 1.0

    def pt(t, off):
        y = -hb * math.cos(t)
        z = d * (max(0.0, math.sin(t)) ** fullness)
        ny, nz = -math.cos(t) * max(d, 0.2), math.sin(t) * max(hb, 0.2)
        ln = math.hypot(ny, nz) or 1.0
        return (x, y + ny / ln * off, zg + sgn * (z + nz / ln * off))

    ring = []
    for k in range(ns):
        ring += [pt(th[k], 0.0), pt(th[k + 1], lap)]
    for k in range(ns - 1, -1, -1):
        a, c = pt(math.pi - th[k + 1], lap), pt(math.pi - th[k], 0.0)
        ring += [a, c]
    return ring


def paint_hull(b, bands, ns, colors):
    """colors[k] for strake k (0 = sheer strake at the gunwale)."""
    for band in bands:
        n = len(band)
        for i, f in enumerate(band):
            if n < 4 * ns:
                continue
            if i >= 4 * ns - 1:
                paint(b, [f], 'wood_dark', 0.05)
                continue
            half = i if i < 2 * ns else (4 * ns - 2 - i)
            k = half // 2
            paint(b, [f], rvar(b.rng, colors[min(k, len(colors) - 1)], 0.06), 0.03)


# ---------------------------------------------------------------------------
# villager_house_d - Fennick's boat-hut (5 x 4 m)
# ---------------------------------------------------------------------------
def villager_house_d():
    b = Builder(seed=606)
    A, B = 2.08, 1.5           # wall ellipse (outer) half axes
    ZG = 1.75                  # gunwale / wall top
    HL, HB, HD = 2.72, 1.74, 1.22

    def hb(x):
        return HB * max(0.0, 1.0 - abs(x / HL) ** 2.3) ** 0.85

    def hd(x):
        return HD * max(0.0, 1.0 - abs(x / HL) ** 3.0) ** 0.45

    # --- dry-stone walls on an elliptical plan
    pts = [(A * math.cos(math.radians(a)), B * math.sin(math.radians(a))) for a in range(-180, 180, 10)]
    path = ArcPath(pts, closed=True)
    u_door = path.nearest_u(-0.45, -B)
    u_port = path.nearest_u(1.0, -B)
    opens = [(u_door - 0.47, u_door + 0.47, 0.0, 1.62), (u_port - 0.28, u_port + 0.28, 0.8, 1.36)]
    stone_wall(b, path, 0.0, path.length * 0.5 + 0.2, 0.0, ZG, thick=0.42, course=(0.3, 0.42),
               length=(0.45, 0.8), jitter=0.03, moss_top=0.0, openings=opens)
    stone_wall(b, path, path.length * 0.5 + 0.2, path.length, 0.0, ZG, thick=0.42,
               course=(0.42, 0.5), length=(0.8, 1.2), jitter=0.03, moss_top=0.0)
    b.cyl(A - 0.4, h=ZG - 0.02, seg=10, loc=(0, 0, 0), scale=(1, B / A, 1), color='stone_dark')

    # --- upturned clinker hull
    NS = 6
    rings = [[(-HL, 0.0, ZG + 0.05)]]
    N = 14
    for i in range(1, N):
        t = i / N
        x = -HL * math.cos(math.pi * t)
        rings.append(hull_ring(x, hb(x), hd(x), ZG, ns=NS, lap=0.05, fullness=0.42))
    rings.append([(HL, 0.0, ZG + 0.05)])
    fs, _, bands = loft(b, rings, color=WEATHERED, closed=True, caps=False)
    wg = lambda t: mix('wood_grey', 'wood', t)
    hull_cols = [mix('red', 'wood_grey', 0.55), wg(0.3), mix('teal', 'wood_grey', 0.5),
                 wg(0.55), wg(0.25), wg(0.5)]
    paint_hull(b, bands, NS, hull_cols)
    for sy in (-1, 1):
        rail = []
        for i in range(1, N):
            x = -HL * math.cos(math.pi * i / N)
            rail.append((x, sy * (hb(x) + 0.03), ZG + 0.03))
        sweep(b, rail, 0.05, seg=4, color=BEAM, phase=math.pi / 4)
    keel = []
    for i in range(15):
        x = -HL * 0.9 + 2 * HL * 0.9 * i / 14
        keel.append((x, 0.0, ZG + hd(x) + 0.06))
    sweep(b, keel, 0.1, seg=4, color=mix('wood_dark', 'wood', 0.2), phase=math.pi / 4, jitter=0.004,
          sx=0.8)
    for sx in (-1, 1):
        x0 = sx * HL * 0.9
        stem = [(x0, 0, ZG + hd(x0) + 0.06), (sx * (HL - 0.02), 0, ZG + 0.34), (sx * (HL + 0.14), 0, ZG + 0.02),
                (sx * (HL + 0.2), 0, ZG - 0.28), (sx * (HL + 0.12), 0, ZG - 0.5), (sx * (HL - 0.02), 0, ZG - 0.52)]
        sweep(b, stem, [0.1, 0.1, 0.09, 0.08, 0.06, 0.035], seg=5, color=mix('wood_dark', 'wood', 0.2), sx=0.7)

    # --- door, porthole, lantern
    Fd = path.frame_at(u_door)
    door(b, Fd, 0.0, 0.86, 1.6, w_face=0.02, v0=0.0, recess=0.12, planks=4,
         leaf_c=mix('blue', 'wood_grey', 0.45), fw=0.11, lintel_extra=0.08)
    b.box((1.0, 0.36, 0.1), loc=(Fd.p(0, 0, 0.2).x, Fd.p(0, 0, 0.2).y, 0.05), color='stone', jitter=0.02)
    Fp = path.frame_at(u_port)
    window(b, Fp, 0.0, 1.08, 0.46, 0.46, w_face=0.02, depth=0.18, round_=True, seg=10,
           frame_c='bronze', fw=0.09)
    glow1 = Fp.p(0.0, 1.08, 0.2)
    lx, ly = -1.25, -hb(-1.25) + 0.12
    b.box((0.03, 0.03, 0.16), loc=(lx, ly, ZG - 0.08), color=IRON, mat='metal')
    glow2 = lantern(b, (lx, ly, ZG - 0.16), s=1.1)
    # --- oar leaning left of the door
    ox, oy = -1.62, -1.62
    beam(b, (ox - 0.12, oy - 0.3, 0.02), (ox + 0.05, oy + 0.08, 1.9), 0.05, 0.05, color='wood_light')
    beam(b, (ox - 0.13, oy - 0.33, 0.0), (ox - 0.09, oy - 0.25, 0.5), 0.16, 0.03, color='wood_light',
         up=(0, 1, 0))
    # --- net draped over the hull front with cork floats
    xs = [1.28 + i * 0.25 for i in range(5)]
    ths = [1.25, 0.95, 0.66, 0.38, 0.12, -0.05]

    def hull_pt(x, t, off=0.04):
        y = -hb(x) * math.cos(t)
        z = ZG + hd(x) * (max(0.0, math.sin(t)) ** 0.42)
        return Vector((x, y - (off + 0.05) * math.cos(t), z + (off + 0.05) * math.sin(t)))

    net_c = mix('rope', 'green', 0.35)
    jit = {(i, j): (b.rng.uniform(-0.05, 0.05), b.rng.uniform(-0.06, 0.06))
           for i in range(len(xs)) for j in range(len(ths))}

    def npt(i, j, off=0.05):
        dx, dt = jit[(i, j)]
        return hull_pt(xs[i] + dx, ths[j] + dt, off)

    for i, x in enumerate(xs):
        line = [npt(i, j) for j in range(len(ths))]
        line.append(Vector((x, -hb(x) - 0.08, ZG - 0.45 - b.rng.uniform(0, 0.08))))
        sweep(b, line, 0.013, seg=3, color=net_c)
    for j in range(1, len(ths) - 1):
        sweep(b, [npt(i, j, 0.06) for i in range(len(xs))], 0.011, seg=3, color=net_c)
    bot = [Vector((x, -hb(x) - 0.08, ZG - 0.42)) for x in xs]
    sweep(b, bot, 0.014, seg=3, color=net_c)
    for p in bot[::2]:
        b.cyl(0.05, h=0.1, seg=6, loc=(p.x, p.y - 0.02, p.z - 0.05), rot=(90, 0, 0), color='ochre')
    # --- buoy on the right stem, glass floats on the left
    sx = HL + 0.2
    beam(b, (sx, 0, ZG - 0.25), (sx + 0.02, -0.02, ZG - 0.6), 0.015, 0.015, color='rope')
    fsb = b.lathe([(0.0, 0.0), (0.12, 0.05), (0.16, 0.18), (0.12, 0.33), (0.0, 0.36)], seg=8,
                  loc=(sx + 0.02, -0.02, ZG - 0.98), color='red')
    for f in fsb:
        if f.calc_center_median().z > ZG - 0.98 + 0.12 and f.calc_center_median().z < ZG - 0.98 + 0.24:
            paint(b, [f], 'bone', 0.05)
    for (gx, gy, gz) in ((-HL - 0.12, -0.08, ZG - 0.55), (-HL - 0.05, 0.12, ZG - 0.75)):
        beam(b, (-HL - 0.1, 0, ZG - 0.3), (gx, gy, gz + 0.1), 0.012, 0.012, color='rope')
        b.ico(r=0.11, sub=1, loc=(gx, gy, gz), color=mix('teal', 'glow_green', 0.25), mat='metal', var=0.03)
    # --- iron stovepipe through the hull
    px, py = -1.0, 0.6
    b.cyl(0.09, h=1.15, seg=6, loc=(px, py, ZG + 0.7), color=IRON, mat='metal')
    b.cone(r=0.2, h=0.16, seg=6, loc=(px, py, ZG + 1.95), color=IRON, mat='metal')
    for i in range(3):
        b.box((0.03, 0.03, 0.12), loc=(px + 0.12 * math.cos(i * 2.1), py + 0.12 * math.sin(i * 2.1), ZG + 1.89),
              color=IRON, mat='metal')
    smoke = (px, py, ZG + 2.0)
    # --- two fish drying by the door
    for i, fx in enumerate((-1.02, -0.9)):
        fz = ZG - 0.25 - i * 0.08
        beam(b, (fx, -hb(fx) + 0.1, ZG), (fx, -hb(fx) + 0.1, fz), 0.01, 0.01, color='rope')
        sweep(b, [(fx, -hb(fx) + 0.1, fz), (fx, -hb(fx) + 0.1, fz - 0.18), (fx, -hb(fx) + 0.1, fz - 0.34)],
              [0.035, 0.06, 0.0], seg=5, color=mix('silver', 'blue', 0.3), sx=0.4, mat='metal')
    grass(b, (0, 0), 2.7, 7, avoid=lambda x, y: (x / (A + 0.2)) ** 2 + (y / (B + 0.2)) ** 2 < 1.0 or
          (abs(x + 0.45) < 0.6 and y < 0))
    for i in range(5):
        a = b.rng.uniform(0, 2 * math.pi)
        pebble(b, ((A + 0.35) * math.cos(a), (B + 0.35) * math.sin(a), 0), r=b.rng.uniform(0.08, 0.14))

    root = finish(b, 'villager_house_d', col_box=(5.0, 4.0))
    dp = Fd.p(0.0, 0.0, 0.0)
    empty('door', (dp.x, -2.0 - 0.45, 0), root)
    empty('light_1', tuple(glow1), root)
    empty('light_2', tuple(glow2), root)
    empty('smoke', smoke, root)
    return root


# ---------------------------------------------------------------------------
# shop_stall - Corvin's Curios (4 x 3 m)
# ---------------------------------------------------------------------------
def shop_stall():
    b = Builder(seed=707)
    PX, PFY, PBY = 1.8, -0.85, 1.25
    ZF, ZB = 2.35, 2.95
    # --- posts, beams, back wall
    for sx in (-1, 1):
        b.cyl(0.09, 0.08, h=ZF + 0.05, seg=6, loc=(sx * PX, PFY, -0.05), color=BEAM, jitter=0.006)
        b.cyl(0.09, 0.08, h=ZB + 0.05, seg=6, loc=(sx * PX, PBY, -0.05), color=BEAM, jitter=0.006)
        beam(b, (sx * PX, PFY, ZF - 0.12), (sx * PX, PBY, ZB - 0.12), 0.1, 0.12, color=BEAM)
    beam(b, (-PX - 0.1, PFY, ZF - 0.1), (PX + 0.1, PFY, ZF - 0.1), 0.12, 0.14, color=BEAM)
    beam(b, (-PX - 0.1, PBY, ZB - 0.05), (PX + 0.1, PBY, ZB - 0.05), 0.12, 0.14, color=BEAM)
    Fbk = Frame((0, PBY + 0.1, 0), 0)
    plank_wall(b, Fbk, -PX + 0.08, PX - 0.08, 0.0, ZB - 0.1, w_out=0.0, thick=0.06,
               color=mix('wood', 'wood_dark', 0.2), pw=(0.26, 0.34))
    # --- striped awning with a pennant valance
    xs = [-PX - 0.15 + (2 * PX + 0.3) * i / 12 for i in range(13)]
    prof = [(PBY + 0.12, ZB + 0.04), (0.25, (ZB + ZF) / 2 + 0.03), (PFY, ZF + 0.04), (-1.45, ZF - 0.16)]
    rings = []
    for i, x in enumerate(xs):
        sag_x = 0.05 * math.sin(math.pi * i / 12)
        top = []
        for k, (y, z) in enumerate(prof):
            sag = sag_x * (1.0 if k in (1, 3) else 0.3)
            top.append((x, y, z - sag))
        bot = [(x, y, z - 0.025) for (x, y, z) in reversed(top)]
        rings.append(top + bot)
    fs, caps, bands = loft(b, rings, color='red_dark', closed=True, caps=True)
    for i, band in enumerate(bands):
        c = 'red' if i % 2 == 0 else 'red_dark'
        paint(b, band, tone(c, 0.95), 0.04)
    for i in range(12):
        x0, x1 = xs[i], xs[i + 1]
        yv = -1.45 - 0.012
        z0 = ZF - 0.16 - 0.06 * math.sin(math.pi * (i + 0.5) / 12) + 0.01
        Fv = Frame((0, yv, 0), 0)
        tri = [(x0 + 0.01, z0), (x1 - 0.01, z0), ((x0 + x1) / 2, z0 - 0.22)]
        ngon_prism(b, tri, 0.02, frame=Fv, w0=-0.01, color=('bone' if i % 2 else 'red'), var=0.04)
    # --- signboard with the raven on top of the back beam
    for sx in (-1, 1):
        b.box((0.07, 0.07, 0.72), loc=(sx * 0.62, PBY, ZB + 0.3), color=BEAM)
    b.box((1.55, 0.07, 0.52), loc=(0, PBY - 0.05, ZB + 0.42), color=mix('wood_dark', 'wood', 0.5), jitter=0.004)
    for dz in (-0.24, 0.24):
        b.box((1.6, 0.08, 0.05), loc=(0, PBY - 0.07, ZB + 0.42 + dz), color='gold', mat='metal')
    Fs = Frame((0, PBY - 0.09, 0), 0)
    emblem(b, Fs, RAVEN_PROFILE, -0.4, ZB + 0.42, 0.44, color=mix('black', 'blue_dark', 0.3))
    for i in range(5):
        Fs.box(b, (0.1 + 0.05 * (i % 2), 0.05, 0.012), (0.0 + i * 0.13, ZB + 0.47, 0.006), color='gold', mat='metal')
        Fs.box(b, (0.08, 0.04, 0.012), (0.03 + i * 0.12, ZB + 0.36, 0.006), color='gold', mat='metal')
    # --- counter with a hanging cloth
    CX, CY0, CY1, CH = 1.6, -1.08, -0.62, 1.0
    b.box((2 * CX, CY1 - CY0 - 0.06, CH - 0.08), loc=(0, (CY0 + CY1) / 2 + 0.03, (CH - 0.08) / 2),
          color=mix('wood', 'wood_dark', 0.3), jitter=0.005)
    b.box((2 * CX + 0.14, CY1 - CY0 + 0.1, 0.08), loc=(0, (CY0 + CY1) / 2, CH - 0.04),
          color=TIMBER_LT, jitter=0.004, bevel=0.01)
    Fc = Frame((0, CY0 - 0.01, 0), 0)
    for i in range(7):
        u0 = -1.3 + i * 0.3713
        Fc.box(b, (0.37, 0.6 + 0.06 * (i % 2), 0.02), (u0 + 0.18, CH - 0.38 - 0.03 * (i % 2), 0.0),
               color=('red_dark' if i % 2 else 'red'))
    Fc.box(b, (2.62, 0.06, 0.03), (0.0, CH - 0.1, 0.012), color='gold', mat='metal')
    emblem(b, Fc, RAVEN_SPREAD, 0.0, CH - 0.42, 0.34, w0=0.012, color='bone')
    # --- goods on the counter: brass scale, coins, ledger
    sx0 = -0.7
    b.cyl(0.1, 0.12, h=0.04, seg=6, loc=(sx0, -0.85, CH), color='bronze', mat='metal')
    b.cyl(0.02, h=0.42, seg=4, loc=(sx0, -0.85, CH + 0.04), color='bronze', mat='metal')
    beam(b, (sx0 - 0.25, -0.85, CH + 0.44), (sx0 + 0.25, -0.85, CH + 0.44), 0.025, 0.025, color='bronze', mat='metal')
    for dx in (-0.23, 0.23):
        for k in range(3):
            a = math.radians(90 + k * 120)
            beam(b, (sx0 + dx, -0.85, CH + 0.44), (sx0 + dx + 0.07 * math.cos(a), -0.85 + 0.07 * math.sin(a), CH + 0.2),
                 0.008, 0.008, color='bronze', mat='metal')
        b.cyl(0.1, 0.07, h=0.04, seg=6, loc=(sx0 + dx, -0.85, CH + 0.17), rot=(180, 0, 0), color='bronze', mat='metal')
    for i, (cx_, cy_, n) in enumerate(((0.25, -0.9, 4), (0.4, -0.78, 6), (0.52, -0.92, 3), (0.34, -1.0, 2))):
        b.cyl(0.05, h=0.02 * n, seg=6, loc=(cx_, cy_, CH), color='gold', mat='metal', var=0.08)
        b.cyl(0.052, h=0.006, seg=6, loc=(cx_ + 0.01, cy_, CH + 0.02 * n), color='gold', mat='metal', var=0.08)
    b.box((0.36, 0.26, 0.05), loc=(1.05, -0.83, CH + 0.025), rot=(0, 0, 8), color='red_dark')
    b.box((0.33, 0.24, 0.035), loc=(1.05, -0.83, CH + 0.06), rot=(0, 0, 8), color='linen')
    # --- lantern on the front beam
    b.box((0.025, 0.025, 0.14), loc=(0.35, PFY, ZF - 0.19), color=IRON, mat='metal')
    glow = lantern(b, (0.35, PFY, ZF - 0.26), s=1.2)
    # --- shelves of curios on the back wall
    for z in (0.95, 1.5, 2.05):
        b.box((2 * PX - 0.3, 0.36, 0.05), loc=(0, PBY - 0.12, z), color=TIMBER_LT, jitter=0.004)
    for sx in (-1, 1):
        b.box((0.06, 0.38, ZB - 0.2), loc=(sx * (PX - 0.18), PBY - 0.12, (ZB - 0.2) / 2), color=BEAM)
    rng = b.rng
    for z in (0.975, 1.525, 2.075):
        x = -PX + 0.4
        while x < PX - 0.4:
            kind = rng.random()
            y = PBY - 0.12 + rng.uniform(-0.05, 0.05)
            if kind < 0.35:
                bottle(b, (x, y, z), h=rng.uniform(0.16, 0.26), r=0.045,
                       color=rng.choice(('green', 'teal', 'purple', 'ochre', 'red_dark', 'blue')))
                x += 0.16 + rng.uniform(0, 0.08)
            elif kind < 0.6:
                h = rng.uniform(0.12, 0.2)
                b.cyl(0.07, 0.06, h=h, seg=5, loc=(x + 0.03, y, z), color=rng.choice(('bone_dark', 'rust', 'sand')))
                x += 0.24
            elif kind < 0.85:
                s = rng.uniform(0.16, 0.24)
                b.box((s, s * 0.8, s * 0.7), loc=(x + s / 2, y, z + s * 0.35), rot=(0, 0, rng.uniform(-10, 10)),
                      color=rng.choice(('wood_light', 'leather', 'red_dark')), jitter=0.004)
                x += s + 0.1
            else:
                b.ico(r=0.08, sub=0, loc=(x + 0.05, y, z + 0.08), scale=(1, 1, 0.9),
                      color=rng.choice(('bone', 'gold', 'copper_ore')), mat='metal' if rng.random() < 0.5 else 'base')
                x += 0.24
    # --- crates, sacks and a barrel around the stall
    crate(b, (-1.52, -1.25, 0), size=(0.62, 0.5, 0.45), rot_z=6, color='wood_light')
    for i in range(6):
        b.ico(r=0.07, sub=0, loc=(-1.52 + b.rng.uniform(-0.2, 0.2), -1.25 + b.rng.uniform(-0.14, 0.14), 0.47),
              color=b.rng.choice(('berry_red', 'turnip', 'carrot')), var=0.08)
    sack(b, (1.5, -1.22, 0), s=1.0, color='linen')
    sack(b, (1.72, -0.9, 0), s=0.85, color=mix('linen', 'sand', 0.5), rot=(0, 0, 40))
    barrel(b, (-1.62, 0.3, 0), r=0.28, h=0.75, color='wood')
    crate(b, (1.55, 0.35, 0), size=(0.55, 0.55, 0.5), rot_z=-8, color='wood_light')
    crate(b, (1.58, 0.33, 0.5), size=(0.45, 0.45, 0.38), rot_z=10, color=mix('wood_light', 'wood', 0.5))

    root = finish(b, 'shop_stall', col_box=(4.0, 3.0))
    empty('door', (0, -1.5 - 0.5, 0), root)
    empty('light', tuple(glow), root)
    return root


# ---------------------------------------------------------------------------
# shared landmark pieces
# ---------------------------------------------------------------------------


def brazier_stone(b, x, y, s=1.0):
    """Stone pedestal with an iron fire bowl; returns the flame centre."""
    for i, (w, h) in enumerate(((0.62, 0.2), (0.5, 0.5), (0.58, 0.14))):
        z0 = (0, 0.2, 0.7)[i]
        b.box((w * s, w * s, h * s), loc=(x, y, (z0 + h / 2) * s), rot=(0, 0, b.rng.uniform(-4, 4)),
              color=stone_color(b.rng, 'stone'), jitter=0.015, bevel=0.02)
    zt = 0.84 * s
    b.lathe([(0.12 * s, 0.0), (0.3 * s, 0.1 * s), (0.36 * s, 0.24 * s), (0.33 * s, 0.24 * s),
             (0.1 * s, 0.1 * s)], seg=8, loc=(x, y, zt), color=IRON, mat='metal')
    embers(b, (x, y, zt + 0.16 * s), r=0.2 * s, n=5, size=0.06 * s)
    return fire(b, (x, y, zt + 0.16 * s), s=0.75 * s)


# ---------------------------------------------------------------------------
# museum_barrow - the Barrow (diameter 10 m, 4 m tall)
# ---------------------------------------------------------------------------
def museum_barrow():
    b = Builder(seed=808)
    RD, HD = 4.8, 1.55                 # stone drum radius / height
    # --- stone drum (kerb wall) with the entrance gap
    pts = [(RD * math.cos(math.radians(a)), RD * math.sin(math.radians(a))) for a in range(-180, 180, 8)]
    path = ArcPath(pts, closed=True)
    uf = path.nearest_u(0.0, -RD)
    stone_wall(b, path, 0.0, path.length, 0.0, HD, thick=0.5, course=(0.5, 0.56),
               length=(1.1, 1.6), jitter=0.04, moss_top=0.25, openings=[(uf - 1.2, uf + 1.2, 0.0, 9.0)])
    # --- grassy dome
    prof = [(RD - 0.1, HD - 0.05), (RD - 0.35, HD + 0.55), (RD - 1.0, HD + 1.3), (RD - 1.9, HD + 1.85),
            (RD - 2.9, HD + 2.2), (RD - 3.7, HD + 2.38), (RD - 4.3, HD + 2.46), (0.0, HD + 2.5)]
    rings = []
    seg = 24
    for k, (r, z) in enumerate(prof):
        if r <= 0:
            rings.append([(0.0, 0.0, z)])
            continue
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg + (0.13 if k % 2 else 0.0)
            j = 0.0 if k == 0 else b.rng.uniform(-0.1, 0.1)
            ring.append((math.cos(a) * (r + j), math.sin(a) * (r + j), z + (b.rng.uniform(-0.08, 0.08) if k else 0)))
        rings.append(ring)
    rings.insert(0, [(p[0] * 0.95, p[1] * 0.95, HD - 0.3) for p in rings[0]])
    fs, caps, _ = loft(b, rings, color='grass', closed=True, caps=True)
    for f in fs:
        if f in caps:
            continue
        c = mix('turf', 'grass', b.rng.uniform(0.2, 0.8))
        if b.rng.random() < 0.2:
            c = mix(c, 'moss', 0.5)
        paint(b, [f], tone(c, b.rng.uniform(0.9, 1.03)), 0.04)
    for _ in range(18):
        a = b.rng.uniform(0, 2 * math.pi)
        r = b.rng.uniform(0.3, RD - 0.4)
        t = r / RD
        z = HD + 2.45 * (1 - t ** 2.2) - 0.02
        blades(b, (math.cos(a) * r, math.sin(a) * r, z), h=b.rng.uniform(0.2, 0.34), r=0.06, n=3,
               color=b.rng.choice(('grass', 'turf', 'straw')))
    # --- dolmen portal
    Fp = Frame((0, -RD - 0.15, 0), 0)
    for sx in (-1, 1):
        Fp.box(b, (0.62, 2.35, 0.7), (sx * 1.02, 1.175, -0.15), rot=(0, sx * 2, 0),
               color=stone_color(b.rng, 'stone'), jitter=0.015, bevel=0.05)
        Fp.box(b, (0.5, 2.2, 0.9), (sx * 0.98, 1.1, -0.95), color=stone_color(b.rng, 'stone_dark'), jitter=0.04)
    Fp.box(b, (3.0, 0.62, 0.85), (0.0, 2.62, -0.25), rot=(0, -1.5, 0), color=stone_color(b.rng, 'stone'),
           jitter=0.015, bevel=0.06)
    Fp.box(b, (2.3, 0.45, 1.1), (0.0, 2.38, -1.15), rot=(0, 1.5, 0), color=stone_color(b.rng, 'stone'),
           jitter=0.04, bevel=0.04)
    Fp.box(b, (1.5, 2.5, 0.1), (0.0, 1.2, -0.7), color=mix('coal', 'soil_wet', 0.5), var=0.02)
    Fp.box(b, (1.5, 0.08, 1.0), (0.0, 0.02, -0.3), color='stone_dark')
    # threshold stone + forecourt flags
    Fp.box(b, (1.8, 0.14, 0.5), (0.0, 0.07, 0.2), color='stone', jitter=0.02, bevel=0.03)
    for i in range(7):
        u = b.rng.uniform(-1.3, 1.3)
        w = b.rng.uniform(0.55, 1.3)
        Fp.box(b, (b.rng.uniform(0.5, 0.8), 0.07, b.rng.uniform(0.4, 0.6)), (u, 0.03, w),
               rot=(0, 0, b.rng.uniform(-20, 20)), color=stone_color(b.rng, 'stone'), jitter=0.02)
    # carved rune lines (faint glow) on the lintel and uprights
    rune_line(b, Fp, -1.3, 1.3, 2.52, 0.2, 0.2, b.rng, color=RUNE_FAINT, width=0.03)
    for sx in (-1, 1):
        for k in range(4):
            g = GLYPHS[b.rng.choice(list(GLYPHS))]
            rune_strokes(b, Fp, g, sx * 1.02, 0.45 + k * 0.42, 0.28, 0.215, color=RUNE_FAINT, width=0.03)
    # --- braziers flanking the entrance
    lights = []
    for sx in (-1, 1):
        lights.append(brazier_stone(b, sx * 1.9, -4.62, s=1.0))
    # --- scattered stones and grass around the base
    for i in range(10):
        a = b.rng.uniform(0, 2 * math.pi)
        if abs(math.degrees(a) + 90) < 30:
            continue
        r = RD + b.rng.uniform(0.2, 0.5)
        pebble(b, (math.cos(a) * r, math.sin(a) * r, 0), r=b.rng.uniform(0.12, 0.22))
    grass(b, (0, 0), 5.6, 10, avoid=lambda x, y: x * x + y * y < (RD + 0.1) ** 2 or (abs(x) < 2.2 and y < -4))

    root = finish(b, 'museum_barrow', col_r=5.0)
    empty('door', (0, -5.5, 0), root)
    empty('light_1', tuple(lights[0]), root)
    empty('light_2', tuple(lights[1]), root)
    return root


# ---------------------------------------------------------------------------
# hearth_great - the Great Hearth (diameter 4 m)
# ---------------------------------------------------------------------------
def hearth_great():
    b = Builder(seed=909)
    # --- stepped stone plinth: rings of flagstones
    for (r0, r1, z0, h, n) in ((1.55, 2.0, 0.0, 0.22, 14), (1.05, 1.62, 0.22, 0.22, 12)):
        for i in range(n):
            a0 = 2 * math.pi * i / n + 0.012
            a1 = 2 * math.pi * (i + 1) / n - 0.012
            zz = z0 + h + b.rng.uniform(-0.015, 0.015)
            c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
            hexa(b, [(r0 * c0, r0 * s0, z0), (r1 * c0, r1 * s0, z0), (r1 * c1, r1 * s1, z0), (r0 * c1, r0 * s1, z0),
                     (r0 * c0, r0 * s0, zz), (r1 * c0, r1 * s0, zz), (r1 * c1, r1 * s1, zz), (r0 * c1, r0 * s1, zz)],
                 stone_color(b.rng, 'stone'), jitter=0.012)
    b.cyl(1.1, h=0.43, seg=12, loc=(0, 0, 0.0), color='stone_dark')
    # --- fire ring of chunky stones
    for i in range(11):
        a = 2 * math.pi * i / 11
        b.ico(r=0.22, sub=0, loc=(math.cos(a) * 0.88, math.sin(a) * 0.88, 0.58), scale=(1.2, 1.0, 0.85),
              rot=(0, 0, math.degrees(a)), color=stone_color(b.rng, 'stone'), jitter=0.04)
    # --- iron fire bowl on legs with logs and flames
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        beam(b, (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.44), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.72),
             0.07, 0.07, color=IRON, mat='metal')
    b.lathe([(0.2, 0.68), (0.55, 0.76), (0.66, 0.95), (0.6, 0.97), (0.2, 0.84)], seg=10,
            color='iron', mat='metal', var=0.05)
    b.lathe([(0.67, 0.93), (0.7, 0.98)], seg=10, color='iron', mat='metal', cap_bottom=False, cap_top=True)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        log(b, (math.cos(a) * 0.42, math.sin(a) * 0.42, 0.9), (math.cos(a + 0.4) * -0.2, math.sin(a + 0.4) * -0.2, 1.05),
            0.07, seg=5, color='bark', end_color='wood_light')
    embers(b, (0, 0, 0.9), r=0.4, n=9, size=0.07)
    glow = fire(b, (0, 0, 0.92), s=1.5)
    root = finish(b, 'hearth_great', col_r=2.0)
    # --- five rune stones (separate child meshes, glyphs emissive)
    names = ('kenaz', 'sowilo', 'algiz', 'ingwaz', 'dagaz')
    for k in range(5):
        ang = 90 + 72 * k
        a = math.radians(ang)
        cx, cy = math.cos(a) * 1.78, math.sin(a) * 1.78
        rb = Builder(seed=950 + k)
        F = Frame((cx, cy, 0.22), ang + 90)       # w = outward (radial)
        Fi = Frame((cx, cy, 0.22), ang - 90)      # w = inward (towards the fire)
        H = 1.35 + 0.1 * math.sin(k * 1.7)
        outline = [(-0.3, 0.0), (0.3, 0.0), (0.27, H * 0.7), (0.2, H * 0.9), (0.06, H), (-0.12, H * 0.97),
                   (-0.24, H * 0.85), (-0.28, H * 0.6)]
        ngon_prism(rb, outline, 0.3, frame=F, w0=-0.15, color=stone_color(rb.rng, 'stone'), jitter=0.015)
        for Fx in (F, Fi):
            rune_strokes(rb, Fx, GLYPHS[names[k]], 0.0, 0.35, 0.62, 0.15, color=RUNE, width=0.06, depth=0.025)
        rb.box((0.66, 0.4, 0.1), loc=(cx, cy, 0.22 + 0.04), rot=(0, 0, ang + 90), color='moss', jitter=0.02)
        rb.build(f'rune_{k + 1}', origin=(cx, cy, 0.22), parent=root, ao=0.15)
    empty('light', (glow[0], glow[1], glow[2] + 0.15), root)
    return root


# ---------------------------------------------------------------------------
# well - stone well with a little roof, crank and bucket (2 x 2 m)
# ---------------------------------------------------------------------------
def well():
    b = Builder(seed=1001)
    R = 0.78
    pts = [(R * math.cos(math.radians(a)), R * math.sin(math.radians(a))) for a in range(-180, 180, 15)]
    path = ArcPath(pts, closed=True)
    stone_wall(b, path, 0.0, path.length, 0.0, 0.72, thick=0.26, course=(0.22, 0.27), length=(0.3, 0.45),
               jitter=0.02, moss_top=0.0, colors=lambda r: stone_color(r, moss=0.15))
    n = 12
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n + 0.02, 2 * math.pi * (i + 1) / n - 0.02
        r0, r1, z0, z1 = R - 0.3, R + 0.04, 0.72, 0.84 + b.rng.uniform(-0.01, 0.01)
        c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
        hexa(b, [(r0 * c0, r0 * s0, z0), (r1 * c0, r1 * s0, z0), (r1 * c1, r1 * s1, z0), (r0 * c1, r0 * s1, z0),
                 (r0 * c0, r0 * s0, z1), (r1 * c0, r1 * s0, z1), (r1 * c1, r1 * s1, z1), (r0 * c1, r0 * s1, z1)],
             stone_color(b.rng, 'stone_light'), jitter=0.01)
    b.cyl(R - 0.22, h=0.02, seg=10, loc=(0, 0, 0.42), color=mix('blue_dark', 'teal', 0.35), mat='metal')
    b.cyl(R - 0.2, h=0.4, seg=10, loc=(0, 0, 0.02), color='stone_dark', cap=False)
    # --- posts, crossbeam, roof
    PX, PT = 0.72, 2.05
    for sx in (-1, 1):
        b.box((0.13, 0.13, PT), loc=(sx * PX, 0, PT / 2), color=BEAM, jitter=0.006)
        beam(b, (sx * PX, 0.0, 1.55), (sx * PX, 0.32, 1.95), 0.06, 0.06, color=BEAM)
        beam(b, (sx * PX, 0.0, 1.55), (sx * PX, -0.32, 1.95), 0.06, 0.06, color=BEAM)
    b.box((2 * PX + 0.4, 0.12, 0.12), loc=(0, 0, PT + 0.02), color=BEAM)
    for S in (Slope((-1.02, -0.72, PT - 0.12), (1.02, -0.72, PT - 0.12), (-1.02, 0.0, PT + 0.45), (1.02, 0.0, PT + 0.45)),
              Slope((1.02, 0.72, PT - 0.12), (-1.02, 0.72, PT - 0.12), (1.02, 0.0, PT + 0.45), (-1.02, 0.0, PT + 0.45))):
        slope_slab(b, S, thick=0.05, color=BEAM)
        shingles(b, S, rows=4, cols=6, lift=0.035, jitter=0.008, col_fn=shingle_col)
    b.box((2.1, 0.12, 0.1), loc=(0, 0, PT + 0.52), rot=(45, 0, 0), color=BEAM)
    # --- windlass with rope, crank handle and bucket
    ZA = 1.32
    log(b, (-PX - 0.02, 0, ZA), (PX + 0.02, 0, ZA), 0.07, seg=6, color='wood_light', end_color='wood_light')
    b.cyl(0.1, h=0.5, seg=6, loc=(-0.25, 0, ZA), rot=(0, 90, 0), color='rope')
    beam(b, (PX + 0.02, 0, ZA), (PX + 0.2, 0, ZA), 0.035, 0.035, color='iron', mat='metal')
    beam(b, (PX + 0.2, 0, ZA), (PX + 0.2, -0.28, ZA - 0.05), 0.035, 0.035, color='iron', mat='metal')
    beam(b, (PX + 0.2, -0.28, ZA - 0.05), (PX + 0.36, -0.28, ZA - 0.05), 0.045, 0.045, color='wood_dark')
    beam(b, (0.0, -0.1, ZA - 0.02), (0.0, -0.1, 1.02), 0.02, 0.02, color='rope')
    bx, by, bz = 0.0, -0.1, 0.72
    b.lathe([(0.12, 0.0), (0.15, 0.24)], seg=8, loc=(bx, by, bz), color='wood', cap_bottom=True, cap_top=False)
    b.cyl(0.13, h=0.02, seg=8, loc=(bx, by, bz + 0.19), color=mix('blue_dark', 'teal', 0.3))
    for hz in (0.04, 0.2):
        b.lathe([(0.125 + hz * 0.13, hz - 0.015), (0.126 + hz * 0.13, hz + 0.015)], seg=8, loc=(bx, by, bz),
                color=IRON, mat='metal', cap_bottom=False, cap_top=False)
    torus(b, (bx, by, bz + 0.26), 0.15, 0.01, seg=8, seg2=3, rot=(90, 0, 0), arc=180, color='iron', mat='metal')
    grass(b, (0, 0), 1.3, 6, avoid=lambda x, y: x * x + y * y < 0.9 ** 2)
    return finish(b, 'well', col_r=1.0)


# ---------------------------------------------------------------------------
# notice_board - village notice board (2 x 0.5 m)
# ---------------------------------------------------------------------------
def notice_board():
    b = Builder(seed=1101)
    for sx in (-1, 1):
        b.box((0.13, 0.13, 2.3), loc=(sx * 0.86, 0, 1.13), color=BEAM, jitter=0.006)
        b.box((0.24, 0.24, 0.1), loc=(sx * 0.86, 0, 0.05), color='stone', jitter=0.02)
    Fb = Frame((0, -0.03, 0), 0)
    plank_wall(b, Fb, -0.8, 0.8, 0.85, 1.95, w_out=0.0, thick=0.05, pw=(0.18, 0.24),
               color=mix('wood', 'wood_light', 0.4))
    b.box((1.78, 0.08, 0.08), loc=(0, -0.04, 1.97), color=BEAM)
    b.box((1.78, 0.08, 0.08), loc=(0, -0.04, 0.83), color=BEAM)
    for sy in (-1, 1):
        if sy < 0:
            S = Slope((-1.08, -0.42, 2.18), (1.08, -0.42, 2.18), (-1.08, 0.0, 2.48), (1.08, 0.0, 2.48))
        else:
            S = Slope((1.08, 0.42, 2.18), (-1.08, 0.42, 2.18), (1.08, 0.0, 2.48), (-1.08, 0.0, 2.48))
        slope_slab(b, S, thick=0.05, color=BEAM)
        shingles(b, S, rows=3, cols=7, lift=0.03, jitter=0.006, col_fn=shingle_col)
    b.box((2.2, 0.1, 0.1), loc=(0, 0, 2.52), rot=(45, 0, 0), color=BEAM)
    rng = b.rng
    papers = [(-0.52, 1.55, 0.36, 0.44), (-0.08, 1.62, 0.32, 0.36), (0.4, 1.5, 0.4, 0.5),
              (-0.45, 1.08, 0.3, 0.34), (0.02, 1.15, 0.38, 0.4), (0.5, 1.05, 0.28, 0.3)]
    for (u, v, w_, h_) in papers:
        rot = rng.uniform(-8, 8)
        c = rng.choice(('linen', 'bone', 'wool', mix('linen', 'sand', 0.4)))
        Fb.box(b, (w_, h_, 0.012), (u, v, 0.008), rot=(0, rot, 0), color=c, var=0.03)
        Fb.box(b, (0.035, 0.035, 0.02), (u, v + h_ / 2 - 0.05, 0.02), color='iron', mat='metal')
        for k in range(3):
            Fb.box(b, (w_ * rng.uniform(0.5, 0.75), 0.018, 0.004), (u - 0.02, v + h_ * 0.2 - k * 0.07, 0.016),
                   rot=(0, rot, 0), color=mix('wood_dark', 'soil', 0.5), var=0.02)
        if rng.random() < 0.5:
            Fb.box(b, (0.05, 0.05, 0.015), (u + w_ * 0.25, v - h_ * 0.32, 0.018), color='red')
    return finish(b, 'notice_board', col_box=(2.0, 0.5))


# ---------------------------------------------------------------------------
# dock - wooden pier from the origin toward -Y (3 x 10 m), walkable
# ---------------------------------------------------------------------------
def dock():
    b = Builder(seed=1201)
    L, W, DH, PT = 10.0, 3.0, 0.3, 0.07
    rng = b.rng
    y = -0.02
    while y > -L + 0.05:
        w = min(rng.uniform(0.26, 0.32), y + L)
        c = tone(mix('wood', 'wood_grey', rng.uniform(0.2, 0.7)), rng.uniform(0.9, 1.08))
        b.box((W + rng.uniform(-0.07, 0.07), w - 0.028, PT), loc=(rng.uniform(-0.03, 0.03), y - w / 2, DH - PT / 2),
              rot=(0, 0, rng.uniform(-1.0, 1.0)), color=c, jitter=0.005)
        y -= w
    for x in (-1.2, 0.0, 1.2):
        b.box((0.15, L - 0.1, 0.18), loc=(x, -L / 2, DH - PT - 0.09), color=BEAM)
    rows = (-0.35, -2.75, -5.15, -7.55, -9.85)
    pile_c = mix('wood_dark', 'wood_grey', 0.45)
    for i, y in enumerate(rows):
        b.box((W + 0.34, 0.2, 0.18), loc=(0, y, DH - PT - 0.27), color=BEAM)
        for x in (-1.45, 1.45):
            top = DH + (0.42 if (i in (2, 4) and x < 0) else 0.0) + (2.35 if (i == 4 and x > 0) else 0.0) - 0.08
            b.cyl(0.14, 0.12, h=top + 2.0, seg=6, loc=(x, y, -2.0), color=pile_c, jitter=0.008)
            b.cyl(0.145, h=0.3, seg=6, loc=(x, y, -0.32), color=mix('moss', 'teal', 0.4), cap=False)
        if i < len(rows) - 1:
            for x in (-1.5, 1.5):
                beam(b, (x, y - 0.15, DH - 0.45), (x, rows[i + 1] + 0.15, -0.9), 0.08, 0.12, color=BEAM)
    # rope wrapped on the bollards
    for (x, y) in ((-1.45, rows[2]), (-1.45, rows[4])):
        b.cyl(0.155, h=0.12, seg=6, loc=(x, y, DH + 0.15), color='rope')
    # lantern post at the end
    px, py = 1.45, rows[4]
    top = DH + 2.35 - 0.08
    beam(b, (px, py, top - 0.12), (px - 0.1, py - 0.55, top - 0.12), 0.07, 0.08, color=BEAM)
    beam(b, (px, py, top - 0.55), (px - 0.05, py - 0.35, top - 0.14), 0.05, 0.05, color=BEAM)
    b.box((0.025, 0.025, 0.14), loc=(px - 0.1, py - 0.5, top - 0.23), color=IRON, mat='metal')
    glow = lantern(b, (px - 0.1, py - 0.5, top - 0.3), s=1.2)
    # ladder down into the water
    for x in (-0.95, -0.55):
        b.box((0.06, 0.06, DH + 1.3), loc=(x, -L - 0.03, (DH - 1.3) / 2), color=BEAM)
    for k in range(4):
        b.box((0.46, 0.05, 0.05), loc=(-0.75, -L - 0.05, DH - 0.3 - k * 0.35), color=BEAM)
    # rope coils, crates, barrel, bucket
    rope_coil(b, (0.6, -3.6, DH), r=0.24, turns=3)
    rope_coil(b, (-0.9, -8.6, DH), r=0.2, turns=2)
    crate(b, (0.85, -8.9, DH), size=(0.6, 0.55, 0.5), rot_z=12, color='wood_light')
    barrel(b, (0.45, -9.45, DH), r=0.25, h=0.66, color='wood')
    b.lathe([(0.12, 0.0), (0.15, 0.24)], seg=7, loc=(-0.2, -9.3, DH), color='wood', cap_top=False)
    b.cyl(0.13, h=0.02, seg=7, loc=(-0.2, -9.3, DH + 0.18), color=mix('blue_dark', 'teal', 0.3))
    beam(b, (-1.1, -6.2, DH + 0.02), (-0.7, -8.0, DH + 0.07), 0.035, 0.035, color='wood_light')
    root = finish(b, 'dock', ao=0.15, ao_floor=-0.6)
    root['deck_h'] = float(DH)
    root['deck_len'] = float(L)
    root['deck_w'] = float(W)
    empty('light', tuple(glow), root)
    return root


# ---------------------------------------------------------------------------
# longship - moored Viking longship (12 x 3 m), dragon prow toward -Y
# ---------------------------------------------------------------------------
def longship():
    b = Builder(seed=1301)
    HL, HB = 4.9, 1.45
    NS = 6

    def zg(y):
        return 0.95 + 0.85 * (abs(y) / HL) ** 2.4

    def zk(y):
        return -0.55 + 0.6 * (abs(y) / HL) ** 3.5

    def hb(y):
        return HB * max(0.0, 1.0 - abs(y / HL) ** 2.3) ** 0.75

    def shell_ring(y):
        d = zg(y) - zk(y)
        outer = hull_ring(y, hb(y), d, zg(y), ns=NS, lap=0.05, flip=True, fullness=0.5)
        th = [k * (math.pi / 2) / NS for k in range(NS + 1)]
        inner = []
        ts = [t for t in th] + [math.pi - t for t in reversed(th[:-1])]
        for t in reversed(ts):
            yy = -max(hb(y) - 0.07, 0.02) * math.cos(t)
            zz = zg(y) - 0.02 - max(d - 0.07, 0.02) * (max(0.0, math.sin(t)) ** 0.5)
            inner.append((y, yy, zz))
        return [(p[1], p[0], p[2]) for p in outer + inner]

    rings = [[(0.0, -HL, zg(HL) - 0.05)]]
    N = 18
    for i in range(1, N):
        t = i / N
        y = -HL * math.cos(math.pi * t)
        rings.append(shell_ring(y))
    rings.append([(0.0, HL, zg(HL) - 0.05)])
    fs, _, bands = loft(b, rings, color=BEAM, closed=True, caps=False)
    wd = lambda t: mix('wood_dark', 'wood', t)
    cols = [mix('red_dark', 'wood_dark', 0.35), wd(0.45), wd(0.25), wd(0.5), wd(0.3), wd(0.4)]
    no = 4 * NS
    for band in bands:
        if len(band) < 2 * no:
            for f in band:
                paint(b, [f], wd(0.35), 0.05)
            continue
        for i, f in enumerate(band):
            if i < no - 1:
                half = i if i < 2 * NS else (no - 2 - i)
                paint(b, [f], rvar(b.rng, cols[min(half // 2, NS - 1)], 0.05), 0.03)
            elif i == no - 1 or i == 2 * no - 1:
                paint(b, [f], 'wood_light', 0.05)
            else:
                paint(b, [f], wd(0.2), 0.05)
    # deck planks
    for k in range(5):
        rings_d = []
        for i in range(9):
            y = -HL * 0.8 + 1.6 * HL * i / 8
            hw = max(0.25, hb(y) * 0.78)
            x0 = -hw + 2 * hw * k / 5 + 0.01
            x1 = -hw + 2 * hw * (k + 1) / 5 - 0.01
            z = 0.26
            rings_d.append([(x0, y, z - 0.06), (x1, y, z - 0.06), (x1, y, z), (x0, y, z)])
        loft(b, rings_d, color=tone(mix('wood', 'wood_light', 0.3), 0.92 + 0.06 * (k % 2)), closed=True, caps=True)
    # keel strip, stem with dragon head, curled stern
    stem = [(0.0, -HL + 0.35, -0.35), (0.0, -HL - 0.05, 0.25), (0.0, -HL - 0.3, 1.0), (0.0, -HL - 0.38, 1.7),
            (0.0, -HL - 0.36, 2.05)]
    sweep(b, stem, [0.12, 0.13, 0.13, 0.12, 0.11], seg=6, color=BEAM, sx=0.6, up=(0, -1, 0))
    dragon_head(b, (0.0, -HL - 0.36, 2.0), (0, -1, 0), s=1.2, color=mix('wood_dark', 'wood', 0.45),
                accent='ochre', tongue='red')
    tail = [(0.0, HL - 0.35, -0.35), (0.0, HL + 0.05, 0.3), (0.0, HL + 0.32, 1.1), (0.0, HL + 0.4, 1.85),
            (0.0, HL + 0.3, 2.35), (0.0, HL + 0.05, 2.5), (0.0, HL - 0.12, 2.32), (0.0, HL - 0.08, 2.1),
            (0.0, HL + 0.08, 2.08)]
    sweep(b, tail, [0.12, 0.13, 0.12, 0.11, 0.1, 0.08, 0.06, 0.05, 0.03], seg=6, color=BEAM, sx=0.6,
          up=(0, 1, 0))
    # mast, yard and furled striped sail
    my = 0.3
    b.cyl(0.13, 0.09, h=6.9, seg=6, loc=(0, my, 0.2), color=mix('wood', 'wood_light', 0.3))
    b.box((0.5, 0.36, 0.3), loc=(0, my, 0.35), color=BEAM)
    log(b, (-2.5, my - 0.14, 6.35), (2.5, my - 0.14, 6.35), 0.07, seg=6, color='wood_light', end_color='wood_light')
    sail = []
    radii = []
    for i in range(13):
        x = -2.3 + 4.6 * i / 12
        sail.append((x, my - 0.16, 6.12 + 0.04 * math.sin(i * 1.3)))
        radii.append(0.2 + 0.05 * math.sin(i * 2.1) * (1 - abs(x) / 2.6) + 0.04 * (1 - abs(x) / 2.3))
    radii[0] = radii[-1] = 0.1
    sfs, _, sb = sweep(b, sail, radii, seg=6, color='red_dark', jitter=0.01)
    for i, band in enumerate(sb):
        paint(b, band, 'red' if i % 2 == 0 else 'bone', 0.05)
    for x in (-1.5, 0.0, 1.5):
        b.cyl(0.25, h=0.06, seg=6, loc=(x - 0.03, my - 0.16, 6.12), rot=(0, 90, 0), color='rope')
    # rigging
    top = (0, my, 6.95)
    for (p, r) in (((0, -HL - 0.25, 1.4), 0.018), ((0, HL + 0.2, 1.7), 0.018)):
        beam(b, top, p, r, r, color='rope')
    for sx in (-1, 1):
        for dy in (-0.9, 0.9):
            y = my + dy
            beam(b, top, (sx * hb(y), y, zg(y)), 0.016, 0.016, color='rope')
    # shields along both rails
    sh = [('red', 'bone'), ('blue_dark', 'ochre'), ('bone', 'green'), ('ochre', 'red_dark'), ('bone', 'blue')]
    for sx in (-1, 1):
        for i in range(9):
            y = -3.55 + i * 0.89
            n = Vector((sx, 0.0, 0.08)).normalized()
            shield(b, (sx * (hb(y) + 0.05), y, zg(y) - 0.12), n, r=0.4,
                   colors=sh[(i + (2 if sx > 0 else 0)) % len(sh)], sectors=4, seg=8, phase=0.3 * i)
    # oars resting in the water
    for sx in (-1, 1):
        for y in (-2.65, -0.85, 1.0, 2.8):
            p0 = Vector((sx * (hb(y) - 0.6), y + 0.3, zg(y) + 0.25))
            p1 = Vector((sx * (hb(y) + 2.5), y - 0.4, -0.15))
            beam(b, p0, p1, 0.06, 0.06, color='wood_light')
            d = (p1 - p0).normalized()
            beam(b, p1 - d * 0.55, p1 + d * 0.1, 0.18, 0.035, color='wood_light', up=(0, 0, 1))
    # stern lantern on an iron arm
    ax, ay, az = 0.0, HL + 0.25, 1.75
    beam(b, (ax, ay - 0.1, az), (ax + 0.55, ay - 0.1, az + 0.05), 0.04, 0.04, color=IRON, mat='metal')
    b.box((0.025, 0.025, 0.12), loc=(ax + 0.5, ay - 0.1, az - 0.02), color=IRON, mat='metal')
    glow = lantern(b, (ax + 0.5, ay - 0.1, az - 0.08), s=1.1)
    # sea chests and a coil of rope on deck
    for (y, sxx) in ((-2.2, 0), (-0.9, 0), (1.6, 0), (2.9, 0)):
        for sx in (-1, 1):
            b.box((0.45, 0.62, 0.36), loc=(sx * 0.62, y, 0.44), rot=(0, 0, 90 + b.rng.uniform(-3, 3)),
                  color=b.rng.choice(('wood', 'wood_light', 'leather')), jitter=0.006)
    rope_coil(b, (0.0, -3.4, 0.26), r=0.22, turns=2)
    root = finish(b, 'longship', col_box=(3.0, 12.0), ao=0.2, ao_floor=-0.2)
    empty('light', tuple(glow), root)
    return root


# ---------------------------------------------------------------------------
# bridge - arched wooden footbridge spanning along Y (2.5 x 8 m), walkable
# ---------------------------------------------------------------------------
def bridge():
    b = Builder(seed=1401)
    L2, HE, HM, DW = 4.0, 0.14, 1.0, 2.0

    def h(y):
        return HE + (HM - HE) * (1.0 - (y / L2) ** 2)

    def dh(y):
        return -2.0 * (HM - HE) * y / L2 ** 2

    rng = b.rng
    y = -L2
    while y < L2 - 0.05:
        pw = rng.uniform(0.26, 0.31)
        dy = pw / math.sqrt(1.0 + dh(y) ** 2)
        dy = min(dy, L2 - y)
        yc = y + dy / 2
        ang = math.degrees(math.atan(dh(yc)))
        c = tone(mix('wood', 'wood_grey', rng.uniform(0.1, 0.6)), rng.uniform(0.9, 1.08))
        b.box((DW + rng.uniform(-0.06, 0.06), pw - 0.03, 0.07), loc=(rng.uniform(-0.03, 0.03), yc, h(yc) - 0.035),
              rot=(ang, 0, rng.uniform(-1.5, 1.5)), color=c, jitter=0.004)
        y += dy
    ys = [-L2 - 0.15 + (2 * L2 + 0.3) * i / 10 for i in range(11)]
    for x in (-0.8, 0.0, 0.8):
        sweep(b, [(x, yy, h(max(-L2, min(L2, yy))) - 0.18) for yy in ys], 0.11, seg=4, color=BEAM,
              phase=math.pi / 4)
    # railings
    posts = [-3.6 + 1.2 * i for i in range(7)]
    for sx in (-1, 1):
        x = sx * 1.08
        for yy in posts:
            b.box((0.1, 0.1, 1.08), loc=(x, yy, h(yy) + 0.44), color=BEAM, jitter=0.006)
        rail = [(x, yy, h(yy) + 0.96) for yy in [-3.75 + 7.5 * i / 10 for i in range(11)]]
        sweep(b, rail, 0.055, seg=4, color=mix('wood', 'wood_light', 0.3), phase=math.pi / 4)
        mid = [(x, yy, h(yy) + 0.5) for yy in [-3.7 + 7.4 * i / 10 for i in range(11)]]
        sweep(b, mid, 0.04, seg=4, color=BEAM, phase=math.pi / 4)
    # support legs into the stream and stone abutments
    for yy in (-1.8, 1.8):
        for sx in (-1, 1):
            b.cyl(0.1, h=h(yy) + 0.75, seg=6, loc=(sx * 0.8, yy, -0.9), color=mix('wood_dark', 'wood_grey', 0.4))
        beam(b, (-0.95, yy, h(yy) - 0.3), (0.95, yy, h(yy) - 0.3), 0.12, 0.14, color=BEAM)
    for sy in (-1, 1):
        for k in range(4):
            x = -1.05 + k * 0.7
            b.box((0.7, 0.55, 0.22), loc=(x + rng.uniform(-0.05, 0.05), sy * (L2 - 0.1), 0.06),
                  rot=(0, 0, rng.uniform(-6, 6)), color=stone_color(rng, 'stone'), jitter=0.025)
    root = finish(b, 'bridge', ao=0.18, ao_floor=0.0)
    root['deck_h'] = float(HM)
    root['deck_end_h'] = float(HE)
    root['deck_w'] = float(DW)
    return root


# ---------------------------------------------------------------------------
# carved stones, graves and ruins
# ---------------------------------------------------------------------------
PAINT_RED = mix('red', 'stone', 0.35)


def carved_band(b, st, path_uv, width=0.1, color=PAINT_RED, runes=True, rng=None, head=True,
                rune_color=RUNE_FAINT):
    """Serpent band following a (u, v) path on a StoneSlab's front face,
    with faint glowing rune strokes inside it."""
    pts = [st.front(u, v, 0.012) for (u, v) in path_uv]
    n = st.normal()
    sweep(b, pts, [width / 2] * (len(pts) - 1) + [width * 0.18], seg=4, color=color, sx=1.0, sy=0.3,
          up=n, phase=math.pi / 4)
    if head:
        (u1, v1), (u0, v0) = path_uv[-1], path_uv[-2]
        d = Vector((u1 - u0, v1 - v0)).normalized()
        hu, hv = u1 + d.x * 0.02, v1 + d.y * 0.02
        sweep(b, [st.front(u1 - d.x * 0.05, v1 - d.y * 0.05, 0.014), st.front(hu + d.x * 0.1, hv + d.y * 0.1, 0.014)],
              [width * 0.75, width * 0.25], seg=4, color=color, sy=0.35, up=n, phase=math.pi / 4)
    if runes:
        rng = rng or b.rng
        acc = 0.0
        for (ua, va), (uc, vc) in zip(path_uv[:-2], path_uv[1:-1]):
            seg_len = math.hypot(uc - ua, vc - va)
            d = Vector((uc - ua, vc - va)).normalized() if seg_len > 1e-6 else Vector((1, 0))
            nrm = Vector((-d.y, d.x))
            t = 0.0
            while t < seg_len:
                if acc > 0.1:
                    acc = 0.0
                    cu, cv = ua + d.x * t, va + d.y * t
                    k = rng.random()
                    if k < 0.5:
                        a, c = (cu - nrm.x * 0.032, cv - nrm.y * 0.032), (cu + nrm.x * 0.032, cv + nrm.y * 0.032)
                    elif k < 0.75:
                        a = (cu - nrm.x * 0.03 - d.x * 0.02, cv - nrm.y * 0.03 - d.y * 0.02)
                        c = (cu + nrm.x * 0.03 + d.x * 0.02, cv + nrm.y * 0.03 + d.y * 0.02)
                    else:
                        a = (cu - nrm.x * 0.03 + d.x * 0.02, cv - nrm.y * 0.03 + d.y * 0.02)
                        c = (cu + nrm.x * 0.03 - d.x * 0.02, cv + nrm.y * 0.03 - d.y * 0.02)
                    pa, pc = st.front(a[0], a[1], 0.022), st.front(c[0], c[1], 0.022)
                    beam(b, pa, pc, 0.018, 0.012, color=rune_color, mat='emit', up=n, var=0.03)
                step = 0.02
                t += step
                acc += step


def lichen(b, st, n=5, colors=('moss', 'ochre', 'leaf_light')):
    for _ in range(n):
        u = b.rng.uniform(-st.W * 0.3, st.W * 0.3)
        v = b.rng.uniform(0.2, st.H * 0.8)
        p = st.front(u, v, 0.004)
        nn = st.normal()
        q = __import__('mathutils').Vector((0, 0, 1)).rotation_difference(nn).to_euler('XYZ')
        b.cyl(b.rng.uniform(0.06, 0.12), h=0.008, seg=5, loc=p, rot=tuple(math.degrees(a) for a in q),
              color=tone(b.rng.choice(colors), 0.9), var=0.05)


def runestone_a():
    b = Builder(seed=1501)
    st = StoneSlab(b, (0, 0, 0), 2.45, 1.0, 0.42, yaw=0, lean=(0.0, 0.02), top=0.3, taper=0.12,
                   levels=8, seg=10, color=mix('stone', 'stone_light', 0.3), jitter=0.025)
    path = [(-0.2, 0.28), (-0.34, 0.5), (-0.36, 0.95), (-0.35, 1.45), (-0.3, 1.8), (-0.18, 2.06),
            (0.0, 2.16), (0.18, 2.06), (0.3, 1.8), (0.35, 1.45), (0.36, 0.95), (0.33, 0.55), (0.18, 0.36),
            (0.02, 0.34)]
    carved_band(b, st, path, width=0.11)
    # tail looping through the head end (knot)
    carved_band(b, st, [(-0.2, 0.28), (-0.06, 0.2), (0.12, 0.26), (0.2, 0.44)], width=0.08, runes=False, head=False)
    # triquetra knot in the middle
    knot = []
    for i in range(25):
        t = 2 * math.pi * i / 24
        r = 0.2 * (0.55 + 0.45 * math.cos(3 * t))
        knot.append((math.cos(t + math.pi / 2) * r, 1.3 + math.sin(t + math.pi / 2) * r))
    carved_band(b, st, knot, width=0.06, runes=False, head=False)
    rune_strokes(b, Frame(st.front(0.0, 0.0, 0.0), 0), GLYPHS['algiz'], 0.0, 0.58, 0.28, 0.02,
                 color=RUNE_FAINT, width=0.028)
    lichen(b, st, 6)
    moss_ring(b, 0, 0, 0.55, n=7)
    grass(b, (0, 0), 1.1, 5, avoid=lambda x, y: abs(x) < 0.55 and abs(y) < 0.3)
    return finish(b, 'runestone_a', col_r=0.5)


def runestone_b():
    b = Builder(seed=1601)
    st = StoneSlab(b, (0, 0, 0), 2.2, 1.2, 0.45, yaw=4, lean=(0.05, 0.035), top=0.4, taper=0.08,
                   levels=8, seg=10, color=mix('stone', 'slate', 0.4), jitter=0.035)
    ring = []
    for i in range(23):
        t = 2 * math.pi * i / 22 - math.pi / 2 + 0.25
        ring.append((math.cos(t) * 0.38, 1.12 + math.sin(t) * 0.5))
    carved_band(b, st, ring, width=0.12)
    rune_strokes(b, Frame(st.front(0.0, 0.0, 0.0), 4), GLYPHS['othala'], 0.0, 0.88, 0.46, 0.03,
                 color=RUNE_FAINT, width=0.035)
    carved_band(b, st, [(-0.48, 0.3), (-0.2, 0.42), (0.2, 0.36), (0.46, 0.46)], width=0.07, runes=True,
                head=False)
    lichen(b, st, 7)
    moss_ring(b, 0, 0, 0.62, n=7)
    grass(b, (0, 0), 1.2, 5, avoid=lambda x, y: abs(x) < 0.65 and abs(y) < 0.32)
    return finish(b, 'runestone_b', col_r=0.5)


def standing_stones():
    b = Builder(seed=1701)
    centres = []
    for k in range(7):
        a = 2 * math.pi * k / 7 + b.rng.uniform(-0.1, 0.1) + math.pi / 2
        r = 4.0 + b.rng.uniform(-0.15, 0.15)
        x, y = math.cos(a) * r, math.sin(a) * r
        H = b.rng.uniform(2.5, 3.4)
        yaw = math.degrees(a) + 90 + b.rng.uniform(-12, 12)
        lean = (b.rng.uniform(-0.04, 0.04), b.rng.uniform(-0.06, 0.03))
        StoneSlab(b, (x, y, 0), H, b.rng.uniform(0.75, 1.0), b.rng.uniform(0.45, 0.6), yaw=yaw, lean=lean,
                  top=b.rng.uniform(0.2, 0.4), taper=b.rng.uniform(0.1, 0.3), levels=6, seg=8,
                  color=stone_color(b.rng, b.rng.choice(('stone', 'slate', 'stone_dark'))), jitter=0.05)
        moss_ring(b, x, y, 0.5, n=5)
        centres += [round(x, 3), round(y, 3)]
    b.ico(r=0.7, sub=1, loc=(0.2, -0.3, 0.12), scale=(1.4, 1.0, 0.28), color=stone_color(b.rng, 'stone'), jitter=0.05)
    for i in range(6):
        a = b.rng.uniform(0, 2 * math.pi)
        r = b.rng.uniform(1.2, 4.6)
        pebble(b, (math.cos(a) * r, math.sin(a) * r, 0), r=b.rng.uniform(0.1, 0.2))
    grass(b, (0, 0), 4.8, 14)
    root = finish(b, 'standing_stones', ao=0.2)
    root['stones'] = [float(v) for v in centres]
    return root


def gravestone_a():
    b = Builder(seed=1801)
    c = mix('stone', 'stone_light', 0.25)
    rot = (0, 3, 2)
    b.box((0.5, 0.32, 0.16), loc=(0, 0, 0.06), color='stone_dark', jitter=0.02)
    b.box((0.19, 0.12, 0.8), loc=(0.01, 0, 0.53), rot=rot, color=c, jitter=0.01)
    b.box((0.64, 0.12, 0.17), loc=(0.03, 0, 0.8), rot=rot, color=c, jitter=0.01)
    b.box((0.18, 0.12, 0.2), loc=(0.035, 0, 1.0), rot=rot, color=c, jitter=0.01)
    torus(b, (0.03, 0, 0.8), 0.2, 0.035, seg=12, seg2=4, rot=(90, 2, 0), color=c, mat='base', jitter=0.004)
    for (u, v) in ((0.03, 0.8), (0.03, 0.55), (0.03, 0.34)):
        b.ico(r=0.04, sub=0, loc=(u, -0.07, v), color=mix('stone', 'stone_dark', 0.5))
    b.box((0.2, 0.13, 0.14), loc=(0.0, 0.0, 0.2), rot=(0, 5, 0), color='moss', jitter=0.02)
    b.ico(r=0.5, sub=1, loc=(0.0, -0.75, 0.0), scale=(0.7, 1.2, 0.26), color='turf', jitter=0.03, flatten_below=0.0)
    moss_ring(b, 0, 0, 0.25, n=4)
    grass(b, (0, -0.4), 0.9, 5, avoid=lambda x, y: abs(x) < 0.3 and y > -0.2)
    return finish(b, 'gravestone_a', col_r=0.3)


def gravestone_b():
    b = Builder(seed=1901)
    st = StoneSlab(b, (0, 0, 0), 0.95, 0.58, 0.15, yaw=-3, lean=(0.02, 0.1), top=0.35, taper=0.05,
                   levels=6, seg=8, color=mix('stone', 'slate', 0.3), jitter=0.012)
    for (a, c) in (((0.0, 0.45), (0.0, 0.78)), ((-0.1, 0.66), (0.1, 0.66))):
        beam(b, st.front(a[0], a[1], 0.004), st.front(c[0], c[1], 0.004), 0.04, 0.01,
             color=mix('stone_dark', 'coal', 0.3), up=st.normal())
    for i in range(2):
        beam(b, st.front(-0.16, 0.3 - i * 0.08, 0.004), st.front(0.16, 0.3 - i * 0.08, 0.004), 0.018, 0.008,
             color=mix('stone_dark', 'coal', 0.3), up=st.normal())
    lichen(b, st, 3)
    b.ico(r=0.5, sub=1, loc=(0.0, -0.72, 0.0), scale=(0.7, 1.2, 0.24), color='turf', jitter=0.03, flatten_below=0.0)
    moss_ring(b, 0, 0, 0.3, n=4)
    grass(b, (0, -0.4), 0.9, 5, avoid=lambda x, y: abs(x) < 0.35 and y > -0.2)
    return finish(b, 'gravestone_b', col_r=0.3)


def grave_cairn():
    b = Builder(seed=2001)
    for (n, r, z, s) in ((10, 0.58, 0.14, 0.24), (7, 0.36, 0.38, 0.21), (4, 0.16, 0.6, 0.17), (1, 0.0, 0.76, 0.15)):
        for i in range(n):
            a = 2 * math.pi * (i + b.rng.random() * 0.4) / max(1, n)
            b.ico(r=s * b.rng.uniform(0.85, 1.15), sub=0, loc=(math.cos(a) * r, math.sin(a) * r, z),
                  scale=(1.2, 1.0, 0.8), rot=(0, 0, b.rng.uniform(0, 90)),
                  color=stone_color(b.rng, moss=0.3), jitter=0.03)
    # sword thrust into the cairn
    tilt = Vector((0.08, 0.05, 1.0)).normalized()
    base = Vector((0.02, 0.0, 0.62))
    tip = base - tilt * 0.35
    guard = base + tilt * 0.55
    beam(b, tip, guard, 0.075, 0.018, color='iron', mat='metal', up=(0, 1, 0))
    beam(b, guard - Vector((0.17, 0.0, 0.0)), guard + Vector((0.17, 0.0, 0.0)), 0.05, 0.045, color='iron_dark',
         mat='metal')
    grip0 = guard + tilt * 0.02
    beam(b, grip0, grip0 + tilt * 0.17, 0.04, 0.04, color='leather_dk')
    b.ico(r=0.045, sub=0, loc=grip0 + tilt * 0.2, color='bronze', mat='metal')
    # an old shield leaning on the stones
    shield(b, (0.35, -0.55, 0.3), Vector((0.2, -1.0, 0.55)).normalized(), r=0.3, colors=('red_dark', 'wood'),
           sectors=4, seg=8)
    grass(b, (0, 0), 1.2, 6, avoid=lambda x, y: x * x + y * y < 0.5)
    return finish(b, 'grave_cairn', col_r=0.7)


def altar_offering():
    b = Builder(seed=2101)
    for (x, w) in ((-0.95, 0.62), (0.95, 0.6), (0.0, 0.42)):
        b.box((w, 0.95, 0.86), loc=(x, 0.0, 0.43), rot=(0, 0, b.rng.uniform(-4, 4)),
              color=stone_color(b.rng, 'stone_dark', moss=0.3), jitter=0.035, bevel=0.03)
    b.box((2.7, 1.35, 0.3), loc=(0, 0, 1.0), rot=(0, 0.8, 0.6), color=stone_color(b.rng, 'stone'), jitter=0.03,
          bevel=0.04)
    for i in range(5):
        b.box((b.rng.uniform(0.3, 0.6), b.rng.uniform(0.25, 0.5), 0.05),
              loc=(b.rng.uniform(-1.1, 1.1), b.rng.uniform(-0.45, 0.45), 1.16), rot=(0, 0, b.rng.uniform(0, 90)),
              color=tone('moss', b.rng.uniform(0.85, 1.05)), jitter=0.02)
    stag_skull(b, (0.0, 0.2, 1.15), s=1.05)
    # faint runes on the slab front and on the supports
    Fa = Frame((0, -0.69, 0), 0)
    rune_line(b, Fa, -1.2, 1.2, 0.92, 0.16, 0.0, b.rng, color=RUNE_FAINT, width=0.026)
    for x in (-0.95, 0.95):
        rune_strokes(b, Frame((0, -0.49, 0), 0), GLYPHS['algiz' if x < 0 else 'dagaz'], x, 0.25, 0.36, 0.02,
                     color=RUNE_FAINT, width=0.035)
    # candles on the slab and on the ground
    for (x, y, h) in ((-0.62, -0.35, 0.22), (-0.48, -0.42, 0.14), (0.55, -0.38, 0.26), (0.7, -0.3, 0.12),
                      (-1.05, 0.1, 0.18), (1.0, 0.2, 0.2), (0.35, -0.45, 0.1)):
        candle(b, x, y, 1.15, h)
    for (x, y, h) in ((-1.2, -0.85, 0.3), (-0.9, -0.95, 0.18), (1.1, -0.9, 0.24), (0.8, -0.98, 0.15)):
        candle(b, x, y, 0.0, h, r=0.045)
    # offering bowl with berries, bones on the ground
    b.lathe([(0.05, 0.0), (0.15, 0.04), (0.18, 0.1), (0.16, 0.1), (0.05, 0.05)], seg=8, loc=(-0.3, -0.25, 1.15),
            color='wood')
    for i in range(5):
        b.ico(r=0.035, sub=0, loc=(-0.3 + b.rng.uniform(-0.08, 0.08), -0.25 + b.rng.uniform(-0.08, 0.08), 1.25),
              color='berry_red')
    for (p, q) in (((0.4, -0.85, 0.03), (0.75, -0.7, 0.04)), ((-0.5, -0.9, 0.03), (-0.2, -1.0, 0.03))):
        sweep(b, [p, q], [0.025, 0.025], seg=4, color='bone')
        for e in (p, q):
            b.ico(r=0.035, sub=0, loc=e, color='bone')
    grass(b, (0, 0), 1.8, 7, avoid=lambda x, y: abs(x) < 1.45 and abs(y) < 0.75)
    root = finish(b, 'altar_offering', col_box=(3.0, 2.0))
    empty('light', (0.0, -0.3, 1.55), root)
    return root


def ruin_wall():
    b = Builder(seed=2201)
    prof = [(-2.0, 0.9), (-1.5, 2.2), (-0.9, 2.05), (-0.4, 1.25), (0.3, 0.85), (0.9, 1.75), (1.5, 1.5), (2.0, 0.55)]

    def top(x):
        for (x0, z0), (x1, z1) in zip(prof[:-1], prof[1:]):
            if x0 <= x <= x1:
                return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
        return 0.5

    F = Frame((0, -0.35, 0), 0)
    z = 0.0
    row = 0
    while z < 2.3:
        h = b.rng.uniform(0.3, 0.4)
        xs = [-2.0]
        while xs[-1] < 2.0:
            xs.append(min(2.0, xs[-1] + b.rng.uniform(0.4, 0.75)))
        for x0, x1 in zip(xs[:-1], xs[1:]):
            xc = (x0 + x1) / 2
            if z + h > top(xc) + b.rng.uniform(-0.1, 0.12):
                continue
            c = stone_color(b.rng, b.rng.choice(('stone', 'stone', 'slate')))
            F.box(b, (x1 - x0 - 0.02, h - 0.015, 0.7 + b.rng.uniform(-0.04, 0.04)),
                  (xc, z + h / 2, -0.35 + b.rng.uniform(-0.02, 0.02)), color=c, jitter=0.03)
            if z + h + 0.35 > top(xc) and b.rng.random() < 0.6:
                F.box(b, (x1 - x0 - 0.08, 0.05, 0.55), (xc, z + h + 0.01, -0.35), color=tone('moss', b.rng.uniform(0.85, 1.05)),
                      jitter=0.015)
        z += h
        row += 1
    for i in range(7):
        x = b.rng.uniform(-2.0, 2.0)
        y = b.rng.choice((-1, 1)) * b.rng.uniform(0.45, 0.85)
        s = b.rng.uniform(0.25, 0.45)
        b.box((s * 1.4, s, s * 0.8), loc=(x, y, s * 0.3), rot=(b.rng.uniform(-15, 15), b.rng.uniform(-15, 15),
              b.rng.uniform(0, 90)), color=stone_color(b.rng, moss=0.4), jitter=0.03)
    grass(b, (0, 0), 2.1, 9, avoid=lambda x, y: abs(x) < 2.0 and abs(y) < 0.4 or abs(y) > 1.0)
    return finish(b, 'ruin_wall', col_box=(4.0, 0.8))


def ruin_arch():
    b = Builder(seed=2301)
    D = 0.75
    for sx in (-1, 1):
        cx = sx * 1.55
        b.box((1.0, 1.0, 0.3), loc=(cx, 0, 0.15), color=stone_color(b.rng, 'stone_dark'), jitter=0.03)
        z = 0.3
        for k in range(5):
            h = 0.4 + b.rng.uniform(-0.04, 0.04)
            if z + h > 2.3:
                h = 2.3 - z
            b.box((0.8 + b.rng.uniform(-0.03, 0.03), D, h - 0.015), loc=(cx + b.rng.uniform(-0.03, 0.03), 0, z + h / 2),
                  rot=(0, 0, b.rng.uniform(-2, 2)), color=stone_color(b.rng, 'stone'), jitter=0.025)
            z += h
    # arch voussoirs (semicircle), the crown has fallen
    R0, R1, ZC = 1.15, 1.95, 2.3
    n = 9
    missing = {4, 5}
    for i in range(n):
        if i in missing:
            continue
        a0 = math.pi * (1 - i / n) - 0.006
        a1 = math.pi * (1 - (i + 1) / n) + 0.006
        pts = []
        for (r, a) in ((R0, a0), (R1, a0), (R1, a1), (R0, a1)):
            pts.append((r * math.cos(a), r * math.sin(a)))
        c = stone_color(b.rng, 'stone')
        hexa(b, [(p[0], -D / 2, ZC + p[1]) for p in pts] + [(p[0], D / 2, ZC + p[1]) for p in pts], c, jitter=0.02)
        if i == 3 or i == 6:
            mid = (pts[0][0] + pts[2][0]) / 2
            b.box((0.3, D * 0.8, 0.05), loc=(mid, 0, ZC + max(p[1] for p in pts) + 0.01), color='moss', jitter=0.02)
    # fallen voussoirs and rubble
    for (x, y, r) in ((0.9, -0.9, 25), (0.3, -1.3, 70), (1.2, 0.95, 110)):
        a = math.radians(r)
        pts = [(R0, -0.17), (R1, -0.17), (R1, 0.17), (R0, 0.17)]
        b.box((0.8, D, 0.42), loc=(x, y, 0.2), rot=(0, 8, r), color=stone_color(b.rng, moss=0.4), jitter=0.03)
    for i in range(6):
        pebble(b, (b.rng.uniform(-2.0, 2.0), b.rng.uniform(-1.2, 1.2), 0), r=b.rng.uniform(0.1, 0.2))
    moss_ring(b, -1.55, 0, 0.6, n=5)
    moss_ring(b, 1.55, 0, 0.6, n=5)
    grass(b, (0, 0), 2.4, 9, avoid=lambda x, y: abs(abs(x) - 1.55) < 0.6 and abs(y) < 0.6)
    return finish(b, 'ruin_arch', col_box=(4.0, 1.0))


ASSETS = [
    ('house_hut', house_hut),
    ('house_longhouse', house_longhouse),
    ('villager_house_a', villager_house_a),
    ('villager_house_b', villager_house_b),
    ('villager_house_c', villager_house_c),
    ('villager_house_d', villager_house_d),
    ('shop_stall', shop_stall),
    ('museum_barrow', museum_barrow),
    ('hearth_great', hearth_great),
    ('well', well),
    ('notice_board', notice_board),
    ('dock', dock),
    ('longship', longship),
    ('bridge', bridge),
    ('runestone_a', runestone_a),
    ('runestone_b', runestone_b),
    ('standing_stones', standing_stones),
    ('gravestone_a', gravestone_a),
    ('gravestone_b', gravestone_b),
    ('grave_cairn', grave_cairn),
    ('altar_offering', altar_offering),
    ('ruin_wall', ruin_wall),
    ('ruin_arch', ruin_arch),
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
    path = os.path.join(out_dir, 'buildings.glb')
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
