"""items_fauna - fish and bugs for items.glb (see build_items.py).

Fish are modelled upright along +X (head at -X, dorsal +Z) from a side
profile, then leaned back ~45 deg so their flank faces the front-top icon
camera.  Bugs are modelled flat with the head at -Y and wings spread along
X, then tilted (tail up) toward the camera.
"""
import math

import bpy  # noqa: F401

from ghlib import hexc
from items_kit import (DEG, TAU, V, Body, Builder, Part, circle2d, clamp, finish, flat, lerp, paint,
                       poly, rot_all, tube_path)


# ---------------------------------------------------------------------------
# Fish helper
# ---------------------------------------------------------------------------
class Fish:
    """Profile-built fish.  Positions along the body are given as t (0 = snout,
    1 = tail root); sizes in units of the body length L unless noted."""

    def __init__(self, seed, L, prof, n=8, base='stone', smooth=False):
        self.b = Builder(seed=seed)
        self.L = L
        self.body = Body([(t * L, zc * L, h * L, w * L) for (t, zc, h, w) in prof], n=n)
        self.faces = self.body.build(self.b, color=base, var=0.05, smooth=smooth)

    # -- geometry lookups ------------------------------------------------
    def x(self, t):
        return t * self.L

    def p(self, t):
        return self.body.params(t * self.L)

    def ridge(self, t, side=1, k=1.0):
        zc, h, w = self.p(t)
        return zc + side * h * k

    # -- colouring -------------------------------------------------------
    def shade(self, back, upper, lower, belly, cuts=(0.55, 0.0, -0.55), var=0.05, mat=None,
              mats=None):
        body = self.body

        def fn(f):
            c = f.calc_center_median()
            zc, h, w = body.params(c.x)
            rel = (c.z - zc) / max(h, 1e-6)
            if rel > cuts[0]:
                k = 0
            elif rel > cuts[1]:
                k = 1
            elif rel > cuts[2]:
                k = 2
            else:
                k = 3
            colr = (back, upper, lower, belly)[k]
            m = mats[k] if mats else mat
            return (colr, m) if m else colr
        paint(self.b, self.faces, fn, var=var)

    def paint_where(self, color, where, var=0.05, mat=None):
        paint(self.b, self.faces, color, var=var, mat=mat, where=where)

    # -- fins --------------------------------------------------------------
    def fin(self, pts_xz, color, back=None, mat='base', var=0.06, y=0.0):
        pts = [V((x, y, z)) for (x, z) in pts_xz]
        return flat(self.b, pts, color=color, back=back if back is not None else color, mat=mat,
                    var=var, facing=(0, -1, 0))

    def ridge_fin(self, top, t0, t1, color, back=None, side=1, inset=0.35, mat='base'):
        """Fin on the back (side=1) or belly (side=-1).  top: [(t, dz)] front->back."""
        L = self.L
        pts = [(t * L, self.ridge(t, side) + side * dz * L) for (t, dz) in top]
        for t in (t1, t0):
            pts.append((t * L, self.ridge(t, side, 1.0 - inset)))
        return self.fin(pts, color, back, mat)

    def tail(self, pts, color, back=None, mat='base', t=1.0):
        """Caudal fin; pts [(dt, dz)] relative to the tail root centre."""
        zc, h, w = self.p(t)
        L = self.L
        return self.fin([((t + dt) * L, zc + dz * L) for (dt, dz) in pts], color, back, mat)

    def side_fin(self, t, a, length, width, color, back=None, sweep=(1.0, 0.45, -0.35),
                 both=True, outline=None, mat='base'):
        """Paddle fin rooted on the flank at (t, angle a on the -Y side)."""
        L = self.L
        out = []
        for sgn in ((-1, 1) if both else (-1,)):
            aa = a if sgn < 0 else 180.0 - a
            root, n = self.body.surf(t * L, aa)
            root = root - n * 0.002
            D = V((sweep[0], sgn * sweep[1], sweep[2])).normalized()
            T = V((0, 0, 1)) - D * D.z
            T.normalize()
            ln, wd = length * L, width * L
            shape = outline or [(0.0, -0.3), (0.45, -0.5), (0.9, -0.32), (1.0, 0.0), (0.9, 0.3),
                                (0.45, 0.5), (0.0, 0.3)]
            pts = [root + D * (s * ln) + T * (q * wd) for (s, q) in shape]
            out += flat(self.b, pts, color=color, back=back if back is not None else color,
                        mat=mat, var=0.06, facing=(0, sgn, 0))
        return out

    # -- decals ------------------------------------------------------------
    def eyes(self, t, r, iris, pupil, a=162.0, pupil_k=0.55, both=True, mat='base',
             pupil_mat='base', n=6):
        L = self.L
        self.body.eye(self.b, t * L, a, r, iris, pupil, pupil_k, n=n, mat=mat, pupil_mat=pupil_mat)
        if both:
            self.body.eye(self.b, t * L, 180.0 - a, r, iris, pupil, pupil_k, n=n, mat=mat,
                          pupil_mat=pupil_mat)

    def gills(self, t, color, w=0.012, a0=118.0, a1=238.0, bow=0.03, both=True):
        L = self.L
        for sgn in ((-1, 1) if both else (-1,)):
            def A(a):
                return a if sgn < 0 else 180.0 - a
            am = (a0 + a1) * 0.5
            left = [(t * L, A(a0)), ((t - bow) * L, A(am)), (t * L, A(a1))]
            right = [(t * L + w, A(a0)), ((t - bow) * L + w, A(am)), (t * L + w, A(a1))]
            self.body.ribbon(self.b, left, right, color)

    def bar(self, t, w_top, w_bot, a0, a1, color, lean=0.0, both=True, mat='base', steps=1):
        """Vertical bar from angle a0 (top) to a1 on the -Y side (+ mirrored)."""
        L = self.L
        for sgn in ((-1, 1) if both else (-1,)):
            left, right = [], []
            for i in range(steps + 1):
                k = i / steps
                a = lerp(a0, a1, k)
                aa = a if sgn < 0 else 180.0 - a
                xc = (t + lean * k) * L
                w = lerp(w_top, w_bot, k) * L * 0.5
                left.append((xc - w, aa))
                right.append((xc + w, aa))
            self.body.ribbon(self.b, left, right, color, mat=mat)

    def dots(self, spots, color, both=True, mat='base', n=5):
        """spots: [(t, a, r_in_L)] on the -Y side (mirrored when both)."""
        L = self.L
        for (t, a, r) in spots:
            self.body.round_spot(self.b, t * L, a, r * L, color, n=n, mat=mat)
            if both:
                self.body.round_spot(self.b, t * L, 180.0 - a, r * L, color, n=n, mat=mat)

    # -- output --------------------------------------------------------------
    def finish(self, name, lean=45.0, yaw=14.0, ao=0.15):
        rot_all(self.b, rot=(-lean, 0, 0))
        rot_all(self.b, rot=(0, 0, yaw))
        return finish(self.b, name, ao=ao)


# ---------------------------------------------------------------------------
# Fish
# ---------------------------------------------------------------------------
F = {
    'eye_w': hexc('#e8e2cc'),
    'pupil': hexc('#111013'),
    'gold_eye': hexc('#d9b042'),
    'mouth': hexc('#3a2622'),
    # perch
    'perch_back': hexc('#3e4a22'), 'perch_up': hexc('#7f8b35'), 'perch_lo': hexc('#bba84a'),
    'perch_belly': hexc('#ddd3ae'), 'perch_bar': hexc('#2c3517'), 'perch_fin': hexc('#c9542b'),
    'perch_dfin': hexc('#6c6a52'),
    # pike
    'pike_back': hexc('#35432a'), 'pike_up': hexc('#5d6f38'), 'pike_lo': hexc('#8a9450'),
    'pike_belly': hexc('#d9d3a4'), 'pike_spot': hexc('#d8d49a'), 'pike_fin': hexc('#8a6b3c'),
    # eel
    'eel_back': hexc('#453f28'), 'eel_side': hexc('#76693c'), 'eel_belly': hexc('#c2ad62'),
    'eel_fin': hexc('#554d2c'),
    # ghost carp
    'carp_back': hexc('#a9bfd0'), 'carp_up': hexc('#cddbe6'), 'carp_lo': hexc('#e4ecf1'),
    'carp_belly': hexc('#f0f3f4'), 'carp_scale': hexc('#b6c9d8'), 'carp_fin': hexc('#356e84'),
    'carp_fin_hi': hexc('#4b8ca2'), 'carp_eye': hexc('#9fd8ee'),
    # herring
    'her_back': hexc('#34506e'), 'her_up': hexc('#7f97ae'), 'her_lo': hexc('#c7d0d8'),
    'her_belly': hexc('#e6e9ea'), 'her_fin': hexc('#8a9aa8'),
    # cod
    'cod_back': hexc('#5f5946'), 'cod_up': hexc('#857d62'), 'cod_lo': hexc('#b3ab8f'),
    'cod_belly': hexc('#ddd8c6'), 'cod_speck': hexc('#4a4232'), 'cod_line': hexc('#d8d2b8'),
    'cod_fin': hexc('#6f6851'),
    # mackerel
    'mack_back': hexc('#2c6a6c'), 'mack_up': hexc('#3f8a82'), 'mack_lo': hexc('#bcc8c8'),
    'mack_belly': hexc('#e8ecea'), 'mack_stripe': hexc('#152024'), 'mack_fin': hexc('#5a7a7c'),
    # hagfish
    'hag': hexc('#b38c8a'), 'hag_dk': hexc('#98706f'), 'hag_belly': hexc('#d2b2ac'),
    'hag_pore': hexc('#e6d2cc'), 'hag_barbel': hexc('#c9a09a'),
    # angler
    'ang_back': hexc('#3d3438'), 'ang_side': hexc('#4c4146'), 'ang_belly': hexc('#6a5a5c'),
    'ang_mottle': hexc('#5e5256'), 'ang_mouth': hexc('#5a1f24'), 'ang_tooth': hexc('#e6e0cc'),
    'ang_lure': hexc('#ffd36b'), 'ang_fin': hexc('#4a3e42'),
    # sovereign
    'sov_back': hexc('#243440'), 'sov_up': hexc('#2f4552'), 'sov_lo': hexc('#44606a'),
    'sov_belly': hexc('#7a8e90'), 'sov_fin': hexc('#3a5a66'), 'gold': hexc('#e0ac48'),
    'gold_dk': hexc('#b07e2c'),
}


def fish_perch():
    f = Fish(51, 0.32, [(0.0, 0.0, 0.03, 0.022), (0.07, 0.01, 0.1, 0.06),
                        (0.2, 0.035, 0.16, 0.085), (0.38, 0.045, 0.2, 0.095),
                        (0.56, 0.035, 0.18, 0.085), (0.73, 0.02, 0.12, 0.062),
                        (0.88, 0.012, 0.07, 0.038), (1.0, 0.012, 0.05, 0.024)])
    f.shade(F['perch_back'], F['perch_up'], F['perch_lo'], F['perch_belly'])
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    for i, t in enumerate((0.3, 0.41, 0.52, 0.63, 0.74, 0.84)):
        f.bar(t, 0.06, 0.028, 94, 205, F['perch_bar'], lean=0.02, both=False)
    # spiny first dorsal with the black rear spot, soft second dorsal
    f.ridge_fin([(0.3, 0.03), (0.33, 0.15), (0.37, 0.12), (0.41, 0.17), (0.45, 0.13),
                 (0.49, 0.15), (0.53, 0.1), (0.56, 0.03)], 0.3, 0.56, F['perch_dfin'])
    L = f.L
    zc, h, w = f.p(0.5)
    flat(f.b, [V((0.47 * L, 0, f.ridge(0.47) + 0.035 * L)),
               V((0.53 * L, 0, f.ridge(0.53) + 0.03 * L)),
               V((0.53 * L, 0, f.ridge(0.53) + 0.085 * L)),
               V((0.48 * L, 0, f.ridge(0.48) + 0.11 * L))],
         color=hexc('#1c1c16'), gap=0.004, facing=(0, -1, 0))
    f.ridge_fin([(0.59, 0.02), (0.62, 0.1), (0.7, 0.09), (0.79, 0.01)], 0.59, 0.79,
                F['perch_dfin'])
    f.tail([(-0.03, 0.035), (0.1, 0.15), (0.21, 0.17), (0.15, 0.0), (0.21, -0.15),
            (0.1, -0.13), (-0.03, -0.035)], F['perch_fin'])
    f.ridge_fin([(0.62, 0.01), (0.66, 0.1), (0.73, 0.08), (0.77, 0.01)], 0.62, 0.77,
                F['perch_fin'], side=-1)
    f.side_fin(0.3, 255, 0.16, 0.08, F['perch_fin'], sweep=(1.0, 0.25, -0.8))
    f.side_fin(0.24, 192, 0.17, 0.1, hexc('#d99a58'), sweep=(1.0, 0.5, -0.15))
    f.gills(0.22, F['perch_back'], w=0.01)
    f.eyes(0.12, 0.016, F['gold_eye'], F['pupil'], a=160)
    return f.finish('fish_perch')


def fish_pike():
    f = Fish(52, 0.51, [(0.0, -0.004, 0.012, 0.03), (0.08, 0.0, 0.024, 0.04),
                        (0.18, 0.004, 0.05, 0.052), (0.3, 0.008, 0.075, 0.058),
                        (0.5, 0.008, 0.082, 0.058), (0.68, 0.006, 0.07, 0.048),
                        (0.84, 0.004, 0.05, 0.032), (1.0, 0.004, 0.032, 0.018)])
    f.shade(F['pike_back'], F['pike_up'], F['pike_lo'], F['pike_belly'])
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    # pale bean spots in rows along the flank
    rng = f.b.rng
    spots = []
    for row, a in enumerate((128, 158, 190)):
        for t in [0.3 + 0.075 * k + (0.035 if row % 2 else 0.0) for k in range(8)]:
            if t < 0.9 and rng.random() < 0.9:
                spots.append((t, a + rng.uniform(-5, 5), 0.011 + rng.uniform(-0.002, 0.002)))
    f.dots(spots, F['pike_spot'], both=False, n=5)
    # duck-bill mouth line
    L = f.L
    f.body.ribbon(f.b, [(0.005 * L, 190), (0.12 * L, 192)], [(0.005 * L, 195), (0.12 * L, 196)],
                  hexc('#232018'))
    f.ridge_fin([(0.72, 0.02), (0.75, 0.09), (0.84, 0.07), (0.9, 0.01)], 0.72, 0.9, F['pike_fin'])
    f.ridge_fin([(0.74, 0.01), (0.77, 0.08), (0.85, 0.06), (0.9, 0.01)], 0.74, 0.9, F['pike_fin'],
                side=-1)
    f.tail([(-0.03, 0.03), (0.07, 0.1), (0.13, 0.11), (0.09, 0.0), (0.13, -0.11), (0.07, -0.1),
            (-0.03, -0.03)], F['pike_fin'])
    f.side_fin(0.2, 200, 0.1, 0.05, F['pike_fin'], sweep=(1.0, 0.5, -0.2))
    f.side_fin(0.5, 255, 0.08, 0.04, F['pike_fin'], sweep=(1.0, 0.25, -0.8))
    f.gills(0.16, F['pike_back'], w=0.008)
    f.eyes(0.1, 0.013, F['gold_eye'], F['pupil'], a=150)
    return f.finish('fish_pike', yaw=12)


def fish_herring():
    f = Fish(53, 0.26, [(0.0, 0.0, 0.02, 0.014), (0.08, 0.005, 0.07, 0.04),
                        (0.22, 0.01, 0.12, 0.055), (0.42, 0.012, 0.135, 0.058),
                        (0.62, 0.01, 0.11, 0.048), (0.82, 0.008, 0.07, 0.03),
                        (1.0, 0.008, 0.04, 0.018)])
    f.shade(F['her_back'], F['her_up'], F['her_lo'], F['her_belly'],
            mats=('base', 'metal', 'metal', 'base'))
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    f.ridge_fin([(0.4, 0.02), (0.44, 0.12), (0.56, 0.06), (0.6, 0.01)], 0.4, 0.6, F['her_fin'])
    f.tail([(-0.03, 0.03), (0.12, 0.16), (0.2, 0.18), (0.11, 0.0), (0.2, -0.18), (0.12, -0.16),
            (-0.03, -0.03)], F['her_fin'])
    f.ridge_fin([(0.66, 0.01), (0.7, 0.06), (0.8, 0.03), (0.84, 0.01)], 0.66, 0.84, F['her_fin'],
                side=-1)
    f.side_fin(0.25, 205, 0.14, 0.06, F['her_fin'], sweep=(1.0, 0.5, -0.2))
    f.gills(0.21, F['her_back'], w=0.007)
    f.eyes(0.12, 0.012, F['eye_w'], F['pupil'], a=172, pupil_k=0.6)
    return f.finish('fish_herring', yaw=16)


def fish_cod():
    f = Fish(54, 0.44, [(0.0, -0.01, 0.05, 0.05), (0.08, 0.005, 0.12, 0.08),
                        (0.22, 0.02, 0.17, 0.1), (0.4, 0.02, 0.17, 0.095),
                        (0.58, 0.012, 0.13, 0.075), (0.75, 0.006, 0.09, 0.05),
                        (0.9, 0.004, 0.055, 0.03), (1.0, 0.004, 0.045, 0.02)])
    f.shade(F['cod_back'], F['cod_up'], F['cod_lo'], F['cod_belly'])
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    rng = f.b.rng
    specks = [(rng.uniform(0.12, 0.85), rng.uniform(100, 175), rng.uniform(0.008, 0.012))
              for _ in range(14)]
    f.dots(specks, F['cod_speck'], both=False, n=4)
    L = f.L
    # pale lateral line arching over the pectoral fin
    f.body.ribbon(f.b, [(0.22 * L, 150), (0.4 * L, 146), (0.6 * L, 158), (0.9 * L, 170)],
                  [(0.22 * L, 158), (0.4 * L, 154), (0.6 * L, 165), (0.9 * L, 176)],
                  F['cod_line'])
    for (t0, t1, hgt) in ((0.3, 0.46, 0.1), (0.5, 0.68, 0.08), (0.72, 0.88, 0.06)):
        f.ridge_fin([(t0, 0.01), (t0 + 0.03, hgt), (t1 - 0.04, hgt * 0.8), (t1, 0.01)], t0, t1,
                    F['cod_fin'])
    for (t0, t1, hgt) in ((0.48, 0.66, 0.07), (0.7, 0.86, 0.06)):
        f.ridge_fin([(t0, 0.01), (t0 + 0.03, hgt), (t1 - 0.04, hgt * 0.8), (t1, 0.01)], t0, t1,
                    F['cod_fin'], side=-1)
    f.tail([(-0.03, 0.035), (0.08, 0.11), (0.14, 0.11), (0.15, 0.0), (0.14, -0.11),
            (0.08, -0.11), (-0.03, -0.035)], F['cod_fin'])
    f.side_fin(0.26, 196, 0.15, 0.08, F['cod_fin'], sweep=(1.0, 0.5, -0.2))
    # chin barbel
    zc, h, w = f.p(0.06)
    tube_path(f.b, [(0.06 * L, 0.0, zc - h * 0.85), (0.07 * L, -0.004, zc - h * 1.25),
                    (0.1 * L, -0.006, zc - h * 1.6)], [0.004, 0.003, 0.0015], n=4,
              color=F['cod_lo'])
    f.gills(0.2, F['cod_back'], w=0.01)
    f.eyes(0.11, 0.015, F['gold_eye'], F['pupil'], a=148)
    return f.finish('fish_cod')


def fish_mackerel():
    f = Fish(55, 0.32, [(0.0, 0.0, 0.02, 0.016), (0.08, 0.004, 0.065, 0.045),
                        (0.22, 0.01, 0.105, 0.065), (0.42, 0.012, 0.115, 0.066),
                        (0.62, 0.008, 0.09, 0.052), (0.8, 0.005, 0.055, 0.032),
                        (0.92, 0.004, 0.03, 0.018), (1.0, 0.004, 0.02, 0.012)])
    f.shade(F['mack_back'], F['mack_up'], F['mack_lo'], F['mack_belly'],
            mats=('base', 'base', 'metal', 'base'))
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    # black wavy tiger stripes over the back
    L = f.L
    for i, t in enumerate([0.27 + 0.075 * k for k in range(8)]):
        w = 0.018 * L
        path = [(t, 92), (t + 0.035, 135), (t, 163)]
        left = [(tt * L - w, a) for (tt, a) in path]
        right = [(tt * L + w, a) for (tt, a) in path]
        f.body.ribbon(f.b, left, right, F['mack_stripe'])
    f.ridge_fin([(0.3, 0.02), (0.33, 0.09), (0.4, 0.05), (0.44, 0.01)], 0.3, 0.44, F['mack_fin'])
    f.ridge_fin([(0.58, 0.01), (0.61, 0.06), (0.66, 0.04), (0.68, 0.01)], 0.58, 0.68,
                F['mack_fin'])
    f.ridge_fin([(0.6, 0.01), (0.63, 0.05), (0.68, 0.03), (0.7, 0.01)], 0.6, 0.7, F['mack_fin'],
                side=-1)
    f.tail([(-0.03, 0.02), (0.1, 0.12), (0.2, 0.2), (0.1, 0.0), (0.2, -0.2), (0.1, -0.12),
            (-0.03, -0.02)], F['mack_fin'])
    f.side_fin(0.24, 188, 0.14, 0.05, F['mack_fin'], sweep=(1.0, 0.5, -0.1))
    f.gills(0.2, hexc('#2a4a50'), w=0.007)
    f.eyes(0.1, 0.012, F['eye_w'], F['pupil'], a=168, pupil_k=0.62)
    return f.finish('fish_mackerel', yaw=15)


def fish_carp():
    f = Fish(56, 0.36, [(0.0, 0.0, 0.03, 0.03), (0.07, 0.01, 0.1, 0.07),
                        (0.2, 0.03, 0.17, 0.1), (0.4, 0.035, 0.2, 0.11),
                        (0.6, 0.025, 0.17, 0.095), (0.78, 0.015, 0.11, 0.06),
                        (0.92, 0.01, 0.065, 0.035), (1.0, 0.01, 0.05, 0.025)], smooth=False)
    f.shade(F['carp_back'], F['carp_up'], F['carp_lo'], F['carp_belly'], var=0.07)
    f.paint_where(lambda fc: F['carp_scale'] if f.b.rng.random() < 0.3 else None,
                  lambda fc: fc.calc_center_median().z > f.p(fc.calc_center_median().x / f.L)[0])
    f.paint_where(hexc('#8a6a70'), lambda fc: fc.calc_center_median().x < 0.002)
    L = f.L
    # long flowing glowing fins (faint emit)
    f.ridge_fin([(0.3, 0.03), (0.34, 0.16), (0.5, 0.2), (0.68, 0.17), (0.82, 0.08),
                 (0.84, 0.01)], 0.3, 0.84, F['carp_fin'], mat='emit')
    f.tail([(-0.03, 0.04), (0.12, 0.2), (0.3, 0.28), (0.26, 0.1), (0.2, 0.0), (0.28, -0.12),
            (0.3, -0.26), (0.12, -0.18), (-0.03, -0.04)], F['carp_fin'], mat='emit')
    f.ridge_fin([(0.66, 0.01), (0.7, 0.12), (0.8, 0.1), (0.84, 0.01)], 0.66, 0.84,
                F['carp_fin'], side=-1, mat='emit')
    f.side_fin(0.25, 215, 0.28, 0.13, F['carp_fin_hi'], mat='emit', sweep=(1.0, 0.55, -0.45))
    f.side_fin(0.5, 258, 0.2, 0.09, F['carp_fin'], mat='emit', sweep=(1.0, 0.3, -0.8))
    # barbels
    for sgn in (-1, 1):
        zc, h, w = f.p(0.02)
        tube_path(f.b, [(0.02 * L, sgn * w * 0.6, zc - h * 0.3),
                        (0.0, sgn * (w + 0.012), zc - h * 1.3),
                        (0.03 * L, sgn * (w + 0.02), zc - h * 2.4)], [0.004, 0.003, 0.0015],
                  n=4, color=F['carp_lo'])
    f.gills(0.2, F['carp_scale'], w=0.009)
    f.eyes(0.11, 0.016, F['carp_eye'], hexc('#1a2a36'), a=165)
    return f.finish('fish_carp')


def _serpent(pts, rad, n, colors, b, up=(0, 0, 1)):
    """Round snake-like body along pts; colours by facing (top/side/belly)."""
    with Part(b) as p:
        tube_path(b, pts, rad, n=n, up=up, color=colors[1], var=0.05, cap_start=True,
                  cap_end=True)
    paint(b, p.faces, lambda f: colors[0] if f.normal.z > 0.45 else
          (colors[2] if f.normal.z < -0.3 else None), var=0.06)
    return p


def _s_curve(n, L, amp, phase=0.0, turns=1.0):
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append(V((lerp(-L / 2, L / 2, t), amp * math.sin(TAU * turns * t * 0.5 * 2 + phase)
                       * (0.4 + 0.6 * t), 0.0)))
    return out


def fish_eel():
    b = Builder(seed=57)
    L = 0.54
    pts = []
    for i in range(11):
        t = i / 10
        pts.append(V((lerp(-L / 2, L / 2, t), 0.085 * math.sin(TAU * 0.9 * t + 0.5), 0.0)))
    rad = [0.026, 0.033, 0.035, 0.035, 0.034, 0.032, 0.028, 0.023, 0.017, 0.011, 0.003]
    for i, p in enumerate(pts):
        p.z = rad[i]
    body = _serpent(pts, rad, 7, (F['eel_back'], F['eel_side'], F['eel_belly']), b)
    paint(b, body.faces, lambda fc: F['eel_belly'] if fc.normal.y < -0.55 and fc.normal.z < 0.1
          else None, var=0.06)
    # continuous fin fold along the back half and around the tail tip
    top, bot = [], []
    for i in range(5, 11):
        p = pts[i]
        hgt = 0.01 + 0.02 * (i - 5) / 5
        top.append(V((p.x, p.y, p.z + rad[i] * 0.8 + hgt)))
        bot.append(V((p.x, p.y, p.z + rad[i] * 0.5)))
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.035
    for i in range(len(bot) - 1):
        flat(b, [bot[i], bot[i + 1], top[i + 1], top[i]], color=F['eel_fin'], var=0.06,
             facing=(0, -1, 0))
    flat(b, [bot[-1], tip + V((0, 0, 0.004)), top[-1]], color=F['eel_fin'], var=0.06,
         facing=(0, -1, 0))
    # head: eyes, pectoral fins, mouth slit
    h0 = pts[0]
    d = (pts[1] - pts[0]).normalized()
    side = V((-d.y, d.x, 0))
    for sgn in (-1, 1):
        e = h0 + d * 0.02 + side * (sgn * rad[0] * 0.7) + V((0, 0, rad[0] * 0.62))
        b.ico(r=0.0105, sub=1, loc=e, color=hexc('#e2c25a'), var=0.02)
        poly(b, [e + side * (sgn * 0.011) + q for q in
                 (V((0, 0, 0.0055)), d * 0.0055, V((0, 0, -0.0055)), -d * 0.0055)],
             F['pupil'], facing=side * sgn)
        root = pts[1] + side * (sgn * rad[1] * 0.9)
        flat(b, [root, root + d * 0.035 + side * (sgn * 0.026) + V((0, 0, 0.012)),
                 root + d * 0.042 + side * (sgn * 0.012) + V((0, 0, 0.004))],
             color=F['eel_fin'], var=0.05, facing=(0, 0, 1))
    mouth = h0 - d * 0.002
    poly(b, [mouth - side * 0.014 + V((0, 0, 0.012)), mouth + side * 0.014 + V((0, 0, 0.012)),
             mouth + V((0, 0, 0.003))], F['mouth'], facing=-d)
    rot_all(b, rot=(26, 0, 8))
    return finish(b, 'fish_eel', ao=0.12)


def fish_hagfish():
    b = Builder(seed=58)
    pts = []
    for i in range(10):
        t = i / 9
        a = lerp(200, -40, t) * DEG
        rr = lerp(0.12, 0.17, t)
        pts.append(V((rr * math.cos(a) * 1.25, rr * math.sin(a) * 0.9 + 0.02, 0.0)))
    rad = [0.024, 0.026, 0.027, 0.027, 0.026, 0.025, 0.023, 0.02, 0.016, 0.01]
    for i, p in enumerate(pts):
        p.z = rad[i] * 0.95
    _serpent(pts, rad, 7, (F['hag_dk'], F['hag'], F['hag_belly']), b)
    # flattened paddle tail fin fold
    p1, p0 = pts[-1], pts[-2]
    d = (p1 - p0).normalized()
    tip = p1 + d * 0.05
    flat(b, [p0 + V((0, 0, rad[-2] * 1.6)), tip + V((0, 0, 0.012)), tip + V((0, 0, -0.004)),
             p0 + V((0, 0, rad[-2] * 0.2))], color=F['hag_dk'], var=0.06, facing=(0, -1, 0))
    # blunt head with a ring of short barbels
    h0 = pts[0]
    dh = (pts[0] - pts[1]).normalized()
    side = V((-dh.y, dh.x, 0))
    for k, (s_, z_) in enumerate([(-0.7, 0.6), (0.7, 0.6), (-0.9, -0.1), (0.9, -0.1),
                                  (-0.4, -0.6), (0.4, -0.6)]):
        base = h0 + side * (s_ * rad[0] * 0.8) + V((0, 0, z_ * rad[0] * 0.8))
        tip_ = base + dh * 0.026 + side * (s_ * 0.012) + V((0, 0, z_ * 0.008))
        tube_path(b, [base, tip_], [0.0035, 0.0012], n=3, color=F['hag_barbel'], var=0.04)
    # slime pores along the side + tiny pale eye spots
    for i in range(2, 9):
        p = pts[i]
        d_ = (pts[i + 1] - pts[i - 1]).normalized()
        sd = V((-d_.y, d_.x, 0))
        for sgn in (-1, 1):
            c = p + sd * (sgn * rad[i] * 1.0) + V((0, 0, -rad[i] * 0.15))
            q = [c + sd * (sgn * 0.001) + V((0, 0, 0.004)) + d_ * 0.0,
                 c + sd * (sgn * 0.001) + d_ * 0.005,
                 c + sd * (sgn * 0.001) + V((0, 0, -0.004)),
                 c + sd * (sgn * 0.001) - d_ * 0.005]
            poly(b, q, F['hag_pore'], facing=sd * sgn)
    for sgn in (-1, 1):
        e = h0 - dh * 0.012 + side * (sgn * rad[0] * 0.55) + V((0, 0, rad[0] * 0.8))
        b.ico(r=0.005, sub=1, loc=e, color=F['hag_pore'], var=0.02)
    rot_all(b, rot=(18, 0, 0))
    return finish(b, 'fish_hagfish', ao=0.12)


def fish_angler():
    f = Fish(59, 0.3, [(0.0, 0.03, 0.27, 0.25), (0.06, 0.04, 0.34, 0.3), (0.26, 0.05, 0.36, 0.3),
                       (0.5, 0.035, 0.27, 0.2), (0.72, 0.02, 0.15, 0.1), (0.9, 0.015, 0.085, 0.055),
                       (1.0, 0.015, 0.065, 0.04)])
    f.shade(F['ang_back'], F['ang_side'], F['ang_side'], F['ang_belly'], var=0.08)
    f.paint_where(lambda fc: F['ang_mottle'] if f.b.rng.random() < 0.3 else None,
                  lambda fc: True)
    L = f.L
    b = f.b
    # the gaping maw is the dark front cap, ringed with teeth
    f.paint_where(F['ang_mouth'], lambda fc: fc.calc_center_median().x < 0.002 and
                  abs(fc.normal.x) > 0.9)
    x0, zc0, h0, w0 = f.body.s[0]
    for k in range(14):
        a = TAU * k / 14 + 0.2
        ca, sa = math.cos(a), math.sin(a)
        base = V((x0 - 0.002, w0 * 0.93 * ca, zc0 + h0 * 0.93 * sa))
        ln = 0.024 if k % 2 else 0.017
        tip = base + V((-0.006, -ca * ln, -sa * ln))
        bw = V((0, -sa, ca)) * 0.0065
        flat(b, [base - bw, base + bw, tip], color=F['ang_tooth'], var=0.05, facing=(-1, 0, 0))
    # jutting lower lip
    b.cyl(r1=0.02, h=w0 * 1.9, seg=5, loc=(x0 - 0.004, -w0 * 0.95, zc0 - h0 * 0.95),
          rot=(-90, 0, 0), scale=(0.7, 1.0, 1.0), color=F['ang_side'], var=0.06)
    # illicium + glowing lure dangling in front of the maw
    top = f.ridge(0.12)
    stalk = [V((0.12 * L, 0, top - 0.004)), V((0.1 * L, 0, top + 0.06)),
             V((-0.08 * L, 0, top + 0.07)), V((-0.2 * L, 0, top + 0.03))]
    tube_path(b, stalk, [0.005, 0.0045, 0.004, 0.0035], n=4, color=F['ang_fin'], var=0.05)
    b.ico(r=0.019, sub=1, loc=stalk[-1] + V((-0.004, 0, -0.014)), color=F['ang_lure'],
          mat='emit', var=0.0)
    f.ridge_fin([(0.6, 0.01), (0.64, 0.09), (0.76, 0.07), (0.8, 0.01)], 0.6, 0.8, F['ang_fin'])
    f.ridge_fin([(0.62, 0.01), (0.66, 0.08), (0.78, 0.06), (0.82, 0.01)], 0.62, 0.82,
                F['ang_fin'], side=-1)
    f.tail([(-0.03, 0.05), (0.15, 0.16), (0.22, 0.07), (0.22, -0.07), (0.15, -0.16),
            (-0.03, -0.05)], F['ang_fin'])
    f.side_fin(0.46, 200, 0.22, 0.17, F['ang_fin'], sweep=(1.0, 0.8, -0.35))
    f.eyes(0.14, 0.012, hexc('#c8b060'), F['pupil'], a=122, pupil_k=0.6)
    return f.finish('fish_angler', lean=36, yaw=48)


def fish_sovereign():
    f = Fish(60, 0.56, [(0.0, 0.0, 0.035, 0.028), (0.07, 0.012, 0.1, 0.06),
                        (0.2, 0.03, 0.16, 0.085), (0.36, 0.035, 0.185, 0.09),
                        (0.52, 0.03, 0.17, 0.082), (0.68, 0.02, 0.125, 0.062),
                        (0.84, 0.012, 0.075, 0.038), (1.0, 0.012, 0.05, 0.024)], n=10)
    f.shade(F['sov_back'], F['sov_up'], F['sov_lo'], F['sov_belly'], var=0.06)
    f.paint_where(F['mouth'], lambda fc: fc.calc_center_median().x < 0.002)
    L = f.L
    # scattered gold scales
    rng = f.b.rng
    flecks = [(rng.uniform(0.25, 0.85), rng.uniform(110, 200), 0.009) for _ in range(9)]
    f.dots(flecks, F['gold'], both=False, n=4, mat='metal')
    # gold crown dorsal: a band with five spikes
    crown = [(0.24, 0.01)]
    for k in range(5):
        t0 = 0.26 + k * 0.1
        crown += [(t0, 0.06), (t0 + 0.05, 0.2 if k % 2 == 0 else 0.15), (t0 + 0.08, 0.06)]
    crown += [(0.76, 0.01)]
    f.ridge_fin(crown, 0.24, 0.76, F['gold'], back=F['gold_dk'], mat='metal')
    for k in range(5):
        t0 = 0.26 + k * 0.1 + 0.05
        zt = f.ridge(t0) + (0.2 if k % 2 == 0 else 0.15) * L
        f.b.ico(r=0.011, sub=1, loc=(t0 * L, 0.0, zt + 0.006), color=F['gold'], mat='metal',
                var=0.05)
    # regal flowing tail and fins, gold-rimmed
    f.tail([(-0.03, 0.04), (0.12, 0.16), (0.3, 0.27), (0.22, 0.08), (0.18, 0.0), (0.22, -0.08),
            (0.3, -0.27), (0.12, -0.16), (-0.03, -0.04)], F['sov_fin'])
    zc, h, w = f.p(1.0)
    for sgn in (1, -1):
        f.fin([((1.0 + 0.12) * L, zc + sgn * 0.16 * L), ((1.0 + 0.3) * L, zc + sgn * 0.27 * L),
               ((1.0 + 0.27) * L, zc + sgn * 0.22 * L), ((1.0 + 0.11) * L, zc + sgn * 0.13 * L)],
              F['gold'], mat='metal')
    f.ridge_fin([(0.62, 0.01), (0.66, 0.12), (0.78, 0.1), (0.82, 0.01)], 0.62, 0.82,
                F['sov_fin'], side=-1)
    f.side_fin(0.26, 200, 0.2, 0.1, F['sov_fin'], sweep=(1.0, 0.5, -0.25))
    f.side_fin(0.45, 258, 0.14, 0.07, F['gold'], sweep=(1.0, 0.3, -0.8), mat='metal')
    # barbel "beard"
    for sgn in (-1, 1):
        zc0, h0, w0 = f.p(0.03)
        tube_path(f.b, [(0.03 * L, sgn * w0 * 0.5, zc0 - h0 * 0.5),
                        (0.04 * L, sgn * (w0 + 0.01), zc0 - h0 * 1.6),
                        (0.09 * L, sgn * (w0 + 0.014), zc0 - h0 * 2.6)], [0.005, 0.004, 0.002],
                  n=4, color=F['gold_dk'], mat='metal')
    f.gills(0.2, F['gold_dk'], w=0.01)
    f.eyes(0.11, 0.022, F['gold'], F['pupil'], a=160, mat='metal', pupil_k=0.5)
    return f.finish('fish_sovereign')


FISH = [fish_perch, fish_pike, fish_eel, fish_carp, fish_herring, fish_cod, fish_mackerel,
        fish_hagfish, fish_angler, fish_sovereign]


# ---------------------------------------------------------------------------
# Bugs: built flat, head toward -Y, wings spread along X; tilted tail-up
# ---------------------------------------------------------------------------
B = {
    'moth': hexc('#8c7b66'), 'moth_hind': hexc('#a69580'), 'moth_band': hexc('#57483a'),
    'moth_pale': hexc('#cdbfa6'), 'moth_body': hexc('#6f604e'), 'moth_under': hexc('#9a8c78'),
    'dh_fore': hexc('#3f332b'), 'dh_streak': hexc('#6d5c49'), 'dh_hind': hexc('#cf9a30'),
    'dh_band': hexc('#2c211a'), 'dh_body': hexc('#35302c'), 'skull': hexc('#e2d8bf'),
    'ff_body': hexc('#35332d'), 'ff_shield': hexc('#9a5a36'), 'ff_wing': hexc('#bdb6a2'),
    'ff_glow': hexc('#8fdc3c'), 'ff_elytra': hexc('#454036'),
    'bb_shell': hexc('#23402f'), 'bb_hi': hexc('#3f6e52'), 'bb_leg': hexc('#2a2a24'),
    'gb_shell': hexc('#ddd3bb'), 'gb_groove': hexc('#9d9178'), 'gb_leg': hexc('#5a534a'),
    'df_body': hexc('#2f8a8c'), 'df_band': hexc('#1d4c54'), 'df_eye': hexc('#3a9fae'),
    'df_wing': hexc('#dce9ee'), 'df_vein': hexc('#aabfc9'), 'df_stigma': hexc('#3c4a52'),
    'df_base': hexc('#c9b07a'),
    'lf_fore': hexc('#bba696'), 'lf_spot': hexc('#1f1a18'), 'lf_red': hexc('#8a1c16'),
    'lf_red_emit': hexc('#7a1a12'), 'lf_white': hexc('#e2ddd2'), 'lf_body': hexc('#2c2724'),
    'mm_wing': hexc('#b6d0e4'), 'mm_edge': hexc('#e2eff7'), 'mm_inner': hexc('#8fb4d2'),
    'mm_ring': hexc('#2b8cb4'), 'mm_core': hexc('#9fe6ff'), 'mm_body': hexc('#e9eff2'),
    'eye': hexc('#141414'),
}


class Bug:
    def __init__(self, seed):
        self.b = Builder(seed=seed)

    def wing(self, outline, z, color, back=None, decals=(), mirror=True, rot=None, pivot=None):
        """Right wing (+X) from a 2D outline (x out, y toward the tail) at height z.
        decals: [(outline2d, color, mat)] stacked on top.  Mirrored to the left."""
        b = self.b
        with Part(b) as w:
            flat(b, [V((x, y, z)) for (x, y) in outline], color=color,
                 back=back if back is not None else color, var=0.06, facing=(0, 0, 1))
            for k, dec in enumerate(decals):
                pts, c = dec[0], dec[1]
                mat = dec[2] if len(dec) > 2 else 'base'
                poly(b, [V((x, y, z + 0.0012 + 0.0006 * k)) for (x, y) in pts], c, mat=mat,
                     var=0.04, facing=(0, 0, 1))
        if rot is not None:
            w.xf(rot=rot, pivot=pivot or (0, 0, z))
        if mirror:
            w.mirrored(axis=0)
        return w

    def leg(self, root, knee, foot, r=0.0035, color='black'):
        tube_path(self.b, [root, knee, foot], [r, r * 0.8, r * 0.5], n=3, color=color, var=0.05,
                  cap_start=False, cap_end=False)

    def legs(self, roots, spread, color, r=0.0035, z=0.0):
        """Three pairs; roots [(x, y, z)], spread [(knee_dx, knee_dy, foot_dx, foot_dy)]."""
        for (rx, ry, rz), (kx, ky, fx, fy) in zip(roots, spread):
            for sgn in (-1, 1):
                self.leg(V((sgn * rx, ry, rz)), V((sgn * kx, ky, rz + 0.012)),
                         V((sgn * fx, fy, z)), r, color)

    def antennae(self, base, tip, color, r=0.0025, mid=None):
        for sgn in (-1, 1):
            p0 = V((sgn * base[0], base[1], base[2]))
            p2 = V((sgn * tip[0], tip[1], tip[2]))
            pm = p0.lerp(p2, 0.5) + V(mid or (0, 0, 0.01)) * 1.0
            pm.x = sgn * abs(pm.x)
            tube_path(self.b, [p0, pm, p2], [r, r * 0.8, r * 0.6], n=3, color=color, var=0.05,
                      cap_start=False, cap_end=False)

    def feathery(self, base, tip, color, width=0.012):
        for sgn in (-1, 1):
            p0 = V((sgn * base[0], base[1], base[2]))
            p2 = V((sgn * tip[0], tip[1], tip[2]))
            d = (p2 - p0)
            side = d.cross(V((0, 0, 1))).normalized()
            flat(self.b, [p0, p0.lerp(p2, 0.45) + side * width, p2,
                          p0.lerp(p2, 0.55) - side * width],
                 color=color, var=0.05, facing=(0, 0, 1))

    def abdomen(self, y0, y1, z, radii, color, n=6, flat_k=0.85):
        pts = [V((0.0, lerp(y0, y1, i / (len(radii) - 1)), z)) for i in range(len(radii))]
        with Part(self.b) as p:
            tube_path(self.b, pts, radii, n=n, flat=flat_k, color=color, var=0.06)
        return p

    def finish(self, name, tilt=24.0, yaw=0.0):
        rot_all(self.b, rot=(tilt, 0, 0))
        if yaw:
            rot_all(self.b, rot=(0, 0, yaw))
        return finish(self.b, name, ao=0.1)


def bug_moth():
    g = Bug(71)
    zw = 0.03
    fore = [(0.01, -0.024), (0.07, -0.045), (0.138, -0.05), (0.135, -0.018), (0.108, 0.018),
            (0.06, 0.03), (0.012, 0.012)]
    band = [(0.07, -0.043), (0.088, -0.047), (0.08, -0.02), (0.075, 0.022), (0.058, 0.027),
            (0.062, -0.012)]
    g.wing(fore, zw + 0.003, B['moth'], B['moth_under'],
           decals=[(band, B['moth_band']),
                   (circle2d(0.011, 6, 0.112, -0.03), B['moth_pale']),
                   (circle2d(0.006, 5, 0.045, -0.018), B['moth_band'])])
    hind = [(0.01, 0.0), (0.07, 0.008), (0.1, 0.036), (0.088, 0.072), (0.045, 0.08),
            (0.012, 0.042)]
    g.wing(hind, zw, B['moth_hind'], B['moth_under'],
           decals=[([(0.06, 0.02), (0.085, 0.04), (0.075, 0.066), (0.05, 0.07), (0.052, 0.04)],
                    B['moth_pale'])])
    b = g.b
    b.sphere(r=0.02, seg=6, rings=4, loc=(0, -0.012, zw), scale=(1.0, 1.2, 0.85),
             color=B['moth_body'], var=0.1)
    g.abdomen(0.0, 0.085, zw - 0.002, [0.017, 0.018, 0.015, 0.01, 0.003], B['moth_body'])
    b.ico(r=0.014, sub=1, loc=(0, -0.038, zw - 0.002), color=B['moth_body'], var=0.1)
    for sgn in (-1, 1):
        b.ico(r=0.006, sub=1, loc=(sgn * 0.01, -0.045, zw), color=B['eye'], var=0.0)
    g.feathery((0.006, -0.046, zw + 0.006), (0.04, -0.09, zw + 0.012), B['moth_band'], 0.009)
    return g.finish('bug_moth')


def bug_deathshead():
    g = Bug(72)
    zw = 0.034
    fore = [(0.012, -0.03), (0.08, -0.042), (0.165, -0.04), (0.15, -0.012), (0.1, 0.018),
            (0.04, 0.028), (0.012, 0.012)]
    g.wing(fore, zw + 0.003, B['dh_fore'], B['dh_band'],
           decals=[([(0.03, -0.028), (0.12, -0.036), (0.1, -0.026), (0.035, -0.018)],
                    B['dh_streak']),
                   ([(0.06, 0.004), (0.13, -0.014), (0.1, 0.008), (0.06, 0.016)], B['dh_streak']),
                   (circle2d(0.006, 5, 0.075, -0.012), B['skull'])])
    hind = [(0.012, 0.004), (0.075, 0.006), (0.098, 0.03), (0.08, 0.058), (0.035, 0.062),
            (0.012, 0.032)]
    g.wing(hind, zw, B['dh_hind'], B['dh_band'],
           decals=[([(0.035, 0.01), (0.09, 0.02), (0.092, 0.03), (0.035, 0.022)], B['dh_band']),
                   ([(0.03, 0.036), (0.084, 0.044), (0.078, 0.054), (0.03, 0.048)], B['dh_band'])])
    b = g.b
    b.sphere(r=0.026, seg=7, rings=4, loc=(0, -0.012, zw), scale=(1.0, 1.15, 0.8),
             color=B['dh_body'], var=0.08)
    ab = g.abdomen(0.006, 0.1, zw - 0.002, [0.021, 0.022, 0.019, 0.013, 0.004], B['dh_hind'])
    paint(b, ab.faces, lambda f: B['dh_band'] if int((f.calc_center_median().y - 0.006) / 0.014) % 2
          else None, var=0.05)
    b.ico(r=0.016, sub=1, loc=(0, -0.044, zw - 0.002), color=B['dh_body'], var=0.08)
    for sgn in (-1, 1):
        b.ico(r=0.006, sub=1, loc=(sgn * 0.011, -0.052, zw), color=B['eye'], var=0.0)
    g.antennae((0.006, -0.054, zw + 0.004), (0.03, -0.085, zw + 0.012), B['dh_body'], r=0.002)
    # the skull mark on the thorax (oriented for the viewer)
    zt = zw + 0.026 * 0.8 + 0.0015
    cy = -0.012
    skull = [(0.0, cy - 0.016), (0.013, cy - 0.012), (0.016, cy + 0.002), (0.01, cy + 0.012),
             (0.006, cy + 0.02), (-0.006, cy + 0.02), (-0.01, cy + 0.012), (-0.016, cy + 0.002),
             (-0.013, cy - 0.012)]
    poly(b, [V((x, -(y - cy) + cy, zt)) for (x, y) in skull], B['skull'], facing=(0, 0, 1))
    for sgn in (-1, 1):
        poly(b, [V((x + sgn * 0.0065, y, zt + 0.001)) for (x, y) in
                 circle2d(0.0045, 5, 0.0, cy + 0.0)], B['eye'], facing=(0, 0, 1))
    poly(b, [V((0.0, cy + 0.006, zt + 0.001)), V((0.003, cy + 0.011, zt + 0.001)),
             V((-0.003, cy + 0.011, zt + 0.001))], B['eye'], facing=(0, 0, 1))
    return g.finish('bug_deathshead')


def bug_firefly():
    g = Bug(73)
    zw = 0.03
    b = g.b
    # membranous hind wings spread wide, elytra lifted
    hind = [(0.008, -0.012), (0.06, -0.02), (0.1, -0.012), (0.095, 0.008), (0.05, 0.02),
            (0.008, 0.012)]
    g.wing(hind, zw, B['ff_wing'], B['ff_wing'],
           decals=[([(0.02, -0.01), (0.09, -0.012), (0.02, -0.004)], hexc('#9f988a'))],
           rot=(0, 0, -18), pivot=(0.008, 0, zw))
    ely = [(0.006, -0.018), (0.03, -0.022), (0.05, -0.01), (0.055, 0.02), (0.03, 0.03),
           (0.008, 0.012)]
    g.wing(ely, zw + 0.012, B['ff_elytra'], B['ff_body'],
           decals=[([(0.04, -0.012), (0.05, -0.006), (0.052, 0.018), (0.042, 0.02)],
                    hexc('#c8a050'))], rot=(0, -28, 12), pivot=(0.006, -0.018, zw + 0.012))
    ab = g.abdomen(-0.01, 0.075, zw - 0.002, [0.013, 0.016, 0.017, 0.015, 0.008], B['ff_body'])
    paint(b, ab.faces, lambda f: (B['ff_glow'], 'emit') if f.calc_center_median().y > 0.028
          else None, var=0.05)
    b.sphere(r=0.017, seg=6, rings=4, loc=(0, -0.018, zw + 0.002), scale=(1.0, 1.2, 0.7),
             color=B['ff_body'], var=0.08)
    # orange pronotum shield over the head
    b.sphere(r=0.014, seg=6, rings=3, loc=(0, -0.034, zw + 0.004), scale=(1.1, 0.9, 0.45),
             color=B['ff_shield'], var=0.06)
    b.ico(r=0.009, sub=1, loc=(0, -0.047, zw - 0.002), color=B['ff_body'], var=0.05)
    g.antennae((0.004, -0.052, zw), (0.022, -0.085, zw + 0.008), B['ff_body'], r=0.0018)
    g.legs([(0.008, -0.022, zw - 0.006), (0.009, -0.012, zw - 0.006), (0.009, -0.002, zw - 0.006)],
           [(0.03, -0.035, 0.045, -0.05), (0.035, -0.012, 0.055, -0.01),
            (0.03, 0.01, 0.048, 0.03)], B['ff_body'], r=0.0022, z=zw - 0.02)
    return g.finish('bug_firefly')


def _beetle_body(g, zb, L, W, H, shell, hi, seam, pron_col=None, pron_scale=0.62, n=7, mat='base'):
    b = g.b
    with Part(b) as el:
        b.sphere(r=1.0, seg=n, rings=5, loc=(0, L * 0.18, zb), scale=(W, L * 0.62, H),
                 color=shell, var=0.06, mat=mat)
    paint(b, el.faces, lambda f: hi if (f.normal.z > 0.55 and abs(f.normal.x) < 0.35) or
          (f.normal.z > 0.3 and b.rng.random() < 0.3) else None, var=0.05, mat=mat)
    # elytra seam
    top = zb + H + 0.0012
    poly(b, [V((-0.0018, -L * 0.2, top - 0.004)), V((0.0018, -L * 0.2, top - 0.004)),
             V((0.0018, L * 0.62, zb + H * 0.4)), V((-0.0018, L * 0.62, zb + H * 0.4))],
         seam, facing=(0, 0, 1))
    with Part(b) as pr:
        b.sphere(r=1.0, seg=n, rings=4, loc=(0, -L * 0.5, zb - H * 0.05),
                 scale=(W * pron_scale, L * 0.24, H * 0.72), color=pron_col or shell, var=0.06,
                 mat=mat)
    return el, pr


def bug_beetle():
    g = Bug(74)
    b = g.b
    zb = 0.022
    L, W, H = 0.13, 0.042, 0.026
    _beetle_body(g, zb, L, W, H, B['bb_shell'], B['bb_hi'], hexc('#10201a'), mat='metal')
    b.ico(r=0.014, sub=1, loc=(0, -L * 0.72, zb - 0.004), scale=(1.1, 0.9, 0.75),
          color=B['bb_shell'], mat='metal', var=0.05)
    for sgn in (-1, 1):
        tube_path(b, [(sgn * 0.007, -L * 0.78, zb - 0.006), (sgn * 0.012, -L * 0.87, zb - 0.006),
                      (sgn * 0.004, -L * 0.92, zb - 0.006)], [0.0038, 0.003, 0.001], n=3,
                  color=B['bb_leg'], var=0.04, cap_start=False)
        poly(b, [V((sgn * 0.0125 + x, -L * 0.72 + y, zb + 0.004)) for (x, y) in
                 circle2d(0.0035, 5)], hexc('#9fbf7a'), facing=(0, 0, 1))
    g.antennae((0.009, -L * 0.79, zb), (0.035, -L * 1.03, zb + 0.008), B['bb_leg'], r=0.0018,
               mid=(0.01, -0.01, 0.006))
    g.legs([(0.018, -0.048, zb - 0.008), (0.022, -0.022, zb - 0.01), (0.022, 0.01, zb - 0.01)],
           [(0.042, -0.062, 0.058, -0.088), (0.048, -0.02, 0.072, -0.01),
            (0.042, 0.03, 0.062, 0.066)],
           B['bb_leg'], r=0.0038, z=0.0)
    return g.finish('bug_beetle', tilt=20)


def bug_grave_beetle():
    g = Bug(75)
    b = g.b
    zb = 0.024
    L, W, H = 0.14, 0.04, 0.028
    _beetle_body(g, zb, L, W, H, B['gb_shell'], hexc('#efe8d6'), B['gb_groove'], pron_scale=0.85)
    # ridges on the wing cases
    for x in (-0.02, 0.02):
        poly(b, [V((x - 0.0022, -0.012, zb + H * 0.92)), V((x + 0.0022, -0.012, zb + H * 0.92)),
                 V((x * 0.6 + 0.0022, 0.09, zb + H * 0.52)),
                 V((x * 0.6 - 0.0022, 0.09, zb + H * 0.52))], B['gb_groove'], facing=(0, 0, 1))
    # dark "eye sockets" + nose on the pronotum: a skull
    zt = zb - H * 0.05 + H * 0.72 + 0.0012
    for sgn in (-1, 1):
        poly(b, [V((sgn * 0.0095 + x, -L * 0.5 + 0.002 + y, zt)) for (x, y) in
                 circle2d(0.0062, 5)], hexc('#3a3430'), facing=(0, 0, 1))
    poly(b, [V((0.0, -L * 0.5 - 0.008, zt)), V((0.0035, -L * 0.5 - 0.014, zt)),
             V((-0.0035, -L * 0.5 - 0.014, zt))], hexc('#3a3430'), facing=(0, 0, 1))
    b.ico(r=0.013, sub=1, loc=(0, -L * 0.72, zb - 0.004), scale=(1.1, 0.9, 0.75),
          color=B['gb_shell'], var=0.05)
    for sgn in (-1, 1):
        tube_path(b, [(sgn * 0.008, -L * 0.78, zb - 0.004), (sgn * 0.024, -L * 0.92, zb - 0.002),
                      (sgn * 0.02, -L * 1.06, zb), (sgn * 0.006, -L * 1.1, zb)],
                  [0.0055, 0.0045, 0.0032, 0.001], n=4, color=B['gb_shell'], var=0.05,
                  cap_start=False)
    g.antennae((0.011, -L * 0.8, zb + 0.002), (0.045, -L * 0.9, zb + 0.01), B['gb_leg'],
               r=0.0016)
    g.legs([(0.017, -0.05, zb - 0.008), (0.019, -0.025, zb - 0.01), (0.019, 0.005, zb - 0.01)],
           [(0.045, -0.07, 0.065, -0.095), (0.055, -0.025, 0.085, -0.015),
            (0.05, 0.03, 0.075, 0.075)], B['gb_leg'], r=0.0035, z=0.0)
    return g.finish('bug_grave_beetle', tilt=20)


def bug_dragonfly():
    g = Bug(76)
    b = g.b
    zw = 0.03

    def dwing(length, width, sweep, y0):
        pts = []
        for k in range(7):
            t = k / 6
            x = 0.008 + length * t
            wd = width * math.sin(math.pi * clamp(t * 0.96 + 0.04)) ** 0.6
            pts.append((x, y0 + sweep * t - wd * 0.35))
        for k in range(6, -1, -1):
            t = k / 6
            x = 0.008 + length * t
            wd = width * math.sin(math.pi * clamp(t * 0.96 + 0.04)) ** 0.6
            pts.append((x, y0 + sweep * t + wd * 0.65))
        return pts
    for (y0, sweep, wd, ln, z) in ((-0.02, -0.012, 0.03, 0.15, zw + 0.002),
                                   (-0.004, 0.012, 0.034, 0.14, zw)):
        outline = dwing(ln, wd, sweep, y0)
        stig = [(0.008 + ln * 0.84, y0 + sweep * 0.84 - wd * 0.2),
                (0.008 + ln * 0.92, y0 + sweep * 0.92 - wd * 0.18),
                (0.008 + ln * 0.92, y0 + sweep * 0.92 + wd * 0.02),
                (0.008 + ln * 0.84, y0 + sweep * 0.84 + wd * 0.02)]
        vein = [(0.012, y0 - wd * 0.05), (0.008 + ln * 0.84, y0 + sweep * 0.84 - wd * 0.1),
                (0.008 + ln * 0.84, y0 + sweep * 0.84 - wd * 0.02), (0.012, y0 + wd * 0.06)]
        base = [(0.008, y0 - wd * 0.15), (0.02, y0 - wd * 0.2), (0.02, y0 + wd * 0.4),
                (0.008, y0 + wd * 0.35)]
        g.wing(outline, z, B['df_wing'], B['df_vein'],
               decals=[(vein, B['df_vein']), (stig, B['df_stigma']), (base, B['df_base'])])
    ab = g.abdomen(0.0, 0.17, zw - 0.001, [0.009, 0.007, 0.006, 0.0055, 0.005, 0.005, 0.0045],
                   B['df_body'], n=5)
    paint(b, ab.faces, lambda f: B['df_band'] if int(f.calc_center_median().y / 0.018) % 2
          else None, var=0.05)
    b.sphere(r=0.014, seg=6, rings=4, loc=(0, -0.01, zw), scale=(1.0, 1.35, 0.9),
             color=B['df_body'], var=0.08)
    for sgn in (-1, 1):
        b.ico(r=0.011, sub=1, loc=(sgn * 0.008, -0.034, zw + 0.002), color=B['df_eye'], var=0.08)
    b.ico(r=0.007, sub=1, loc=(0, -0.038, zw - 0.004), color=B['df_band'], var=0.05)
    return g.finish('bug_dragonfly', tilt=22)


def bug_lanternfly():
    g = Bug(77)
    b = g.b
    zw = 0.03
    hind = [(0.008, -0.004), (0.06, -0.01), (0.1, 0.012), (0.095, 0.05), (0.06, 0.066),
            (0.02, 0.05), (0.008, 0.02)]
    red = [(0.01, -0.002), (0.055, -0.006), (0.06, 0.03), (0.035, 0.045), (0.012, 0.03)]
    band = [(0.055, -0.006), (0.068, -0.006), (0.075, 0.035), (0.05, 0.058), (0.035, 0.045),
            (0.06, 0.03)]
    g.wing(hind, zw, B['lf_body'], B['lf_body'],
           decals=[(red, B['lf_red_emit'], 'emit'), (band, B['lf_white']),
                   (circle2d(0.006, 5, 0.03, 0.012), B['lf_spot']),
                   (circle2d(0.005, 5, 0.045, 0.028), B['lf_spot'])])
    fore = [(0.01, -0.026), (0.07, -0.04), (0.125, -0.03), (0.13, -0.008), (0.1, 0.012),
            (0.04, 0.018), (0.012, 0.008)]
    spots = [(0.03, -0.02), (0.05, -0.028), (0.045, -0.006), (0.07, -0.018), (0.065, 0.004),
             (0.028, 0.002)]
    g.wing(fore, zw + 0.004, B['lf_fore'], B['lf_fore'],
           decals=[([(0.095, -0.036), (0.125, -0.03), (0.13, -0.008), (0.1, 0.012),
                     (0.092, 0.01)], hexc('#6a5a50'))] +
                  [(circle2d(0.0055, 5, x, y), B['lf_spot']) for (x, y) in spots])
    b.sphere(r=0.017, seg=6, rings=4, loc=(0, -0.012, zw), scale=(1.0, 1.3, 0.8),
             color=B['lf_body'], var=0.08)
    g.abdomen(0.0, 0.06, zw - 0.002, [0.013, 0.014, 0.011, 0.004], hexc('#4a3a30'))
    b.ico(r=0.012, sub=1, loc=(0, -0.038, zw), scale=(1.0, 1.2, 0.9), color=B['lf_body'])
    b.cone(r=0.006, h=0.018, seg=4, loc=(0, -0.046, zw + 0.002), rot=(90, 0, 0),
           color=B['lf_body'])
    g.antennae((0.006, -0.044, zw + 0.004), (0.016, -0.058, zw + 0.008), hexc('#b03a2a'),
               r=0.0022)
    return g.finish('bug_lanternfly')


def bug_mistmoth():
    g = Bug(78)
    b = g.b
    zw = 0.03
    fore = [(0.01, -0.026), (0.07, -0.05), (0.13, -0.058), (0.13, -0.022), (0.1, 0.014),
            (0.05, 0.026), (0.012, 0.012)]
    g.wing(fore, zw + 0.003, B['mm_wing'], B['mm_edge'],
           decals=[([(0.012, -0.018), (0.05, -0.03), (0.07, -0.008), (0.05, 0.016),
                     (0.014, 0.008)], B['mm_inner']),
                   ([(0.1, -0.052), (0.13, -0.058), (0.13, -0.022), (0.108, 0.006),
                     (0.104, -0.02)], B['mm_edge']),
                   (circle2d(0.017, 6, 0.08, -0.018), B['mm_ring'], 'emit'),
                   (circle2d(0.008, 6, 0.08, -0.018), B['mm_core'], 'emit')])
    hind = [(0.01, 0.0), (0.06, 0.006), (0.085, 0.03), (0.07, 0.06), (0.05, 0.11), (0.042, 0.13),
            (0.035, 0.1), (0.02, 0.06), (0.01, 0.03)]
    g.wing(hind, zw, B['mm_wing'], B['mm_edge'],
           decals=[([(0.042, 0.1), (0.05, 0.11), (0.042, 0.13), (0.035, 0.1)], B['mm_edge']),
                   (circle2d(0.011, 6, 0.055, 0.032), B['mm_ring'], 'emit'),
                   (circle2d(0.005, 5, 0.055, 0.032), B['mm_core'], 'emit')])
    b.sphere(r=0.02, seg=6, rings=4, loc=(0, -0.012, zw), scale=(1.0, 1.2, 0.85),
             color=B['mm_body'], var=0.06)
    g.abdomen(0.0, 0.08, zw - 0.002, [0.016, 0.017, 0.014, 0.009, 0.003], B['mm_body'])
    b.ico(r=0.013, sub=1, loc=(0, -0.037, zw - 0.001), color=B['mm_body'], var=0.06)
    for sgn in (-1, 1):
        b.ico(r=0.006, sub=1, loc=(sgn * 0.009, -0.044, zw + 0.002), color=hexc('#20303a'))
    g.feathery((0.005, -0.046, zw + 0.006), (0.036, -0.088, zw + 0.012), B['mm_edge'], 0.009)
    return g.finish('bug_mistmoth')


BUGS = [bug_moth, bug_deathshead, bug_firefly, bug_beetle, bug_grave_beetle, bug_dragonfly,
        bug_lanternfly, bug_mistmoth]
