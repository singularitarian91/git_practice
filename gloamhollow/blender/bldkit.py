"""
bldkit - construction helpers for Gloamhollow's buildings.glb and props.glb.

Everything here adds geometry to a ghlib.Builder (whose bmesh can hold many
primitives with per-face colours and material ids), so a whole building
still ends up as one or two meshes.  ghlib itself is shared and must not be
edited; this module only builds on top of it.

Conventions (same as ghlib): metres, Z-up, front / doors face -Y.

Contents
--------
* colour helpers      : paint(), tone(), WINDOW / FLAME ... emissive colours
* generic solids      : hexa(), loft(), sweep(), beam(), log(), torus(), disc()
* wall-local frames   : Frame (u = right seen from outside, v = up, w = out)
* walls               : plank_wall(), log_wall(), stone_wall()
* roofs               : Slope, slope_slab(), shingles(), turf(), tufts()
* openings            : window(), door()
* fire & light        : flame(), fire(), lantern()
* set dressing        : barrel(), crate(), sack(), shield(), rope_coil(),
                        dragon_head(), grass(), flowers()
* export              : fix_glb_names() - strips Blender's ".001" suffixes
                        so sockets keep their exact names in the .glb
"""
import json
import math
import re
import struct

import bpy  # noqa: F401  (must be imported before bmesh / mathutils)
import bmesh
from mathutils import Vector

from ghlib import col, mix, srgb_to_linear, MAT_INDEX, _matrix

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
# Emissive colours are multiplied by ~2.6 in-game without tone mapping, so a
# low green channel keeps warm glows amber instead of washing out to yellow.
WINDOW = (1.0, 0.50, 0.17)        # warm window glow
WINDOW_DIM = (0.85, 0.40, 0.13)
FLAME = (1.0, 0.42, 0.10)         # outer flame
FLAME_HOT = (1.0, 0.78, 0.36)     # inner / tip
EMBER = (1.0, 0.30, 0.07)         # glowing coals
LANTERN = (1.0, 0.62, 0.26)       # lantern glass
RUNE = col('rune', 0.85)          # bright gloam rune
RUNE_FAINT = col('rune', 0.42)    # faint carved rune lines

TIMBER = mix('wood', 'wood_dark', 0.35)      # dark wall timber
TIMBER_LT = mix('wood', 'wood_light', 0.25)
BEAM = mix('wood_dark', 'wood', 0.30)        # posts, frames, beams
WEATHERED = mix('wood_grey', 'wood', 0.35)   # grey sea-worn wood
IRON = mix('iron', 'iron_dark', 0.3)           # wrought iron (metal renders darker)


def tone(c, k=1.0, towards=None, t=0.0):
    """Palette colour scaled by k, optionally mixed towards another colour."""
    c = col(c)
    if towards is not None:
        o = col(towards)
        c = tuple(c[i] * (1 - t) + o[i] * t for i in range(3))
    return tuple(min(1.0, max(0.0, v * k)) for v in c)


def paint(b, faces, color, var=0.06, mat=None):
    """Recolour faces of a Builder (sRGB colour, per-face brightness var)."""
    base = col(color)
    for f in faces:
        k = 1.0 + b.rng.uniform(-var, var)
        c = tuple(min(1.0, max(0.0, base[i] * k)) for i in range(3))
        lin = tuple(srgb_to_linear(x) for x in c) + (1.0,)
        for loop in f.loops:
            loop[b.col_layer] = lin
        if mat is not None:
            f.material_index = MAT_INDEX[mat]


def orient(face, outward):
    """Flip a bmesh face if its normal points away from `outward`."""
    face.normal_update()
    if face.normal.dot(Vector(outward)) < 0:
        face.normal_flip()
    return face


def rvar(rng, c, amt=0.1):
    """Random brightness variant of a colour."""
    return tone(c, 1.0 + rng.uniform(-amt, amt))


# ---------------------------------------------------------------------------
# Generic solids
# ---------------------------------------------------------------------------
_HEXA_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5),
               (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(b, pts, color='wood', mat='base', jitter=0.0, var=0.06):
    """Hexahedron from 8 corners: bottom quad then top quad (same order)."""
    vs = [b.bm.verts.new(Vector(p)) for p in pts]
    fs = [b.bm.faces.new([vs[i] for i in f]) for f in _HEXA_FACES]
    bmesh.ops.recalc_face_normals(b.bm, faces=fs)
    return b._finish(vs, color, mat, jitter, var)


def loft(b, rings, color='wood', mat='base', jitter=0.0, var=0.06,
         closed=True, caps=True, cyclic=False, smooth=False, recalc=True,
         flip=False):
    """Connect rings of points (equal length, or 1 = apex) into a surface.

    closed : each ring is a loop (tube) - otherwise an open polyline (sheet)
    cyclic : last ring connects back to the first (torus)
    Returns (faces, cap_faces, band_faces) where band_faces[k] lists the
    faces between ring k and k+1 in order.
    """
    vr = [[b.bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    fs, bands = [], []
    nr = len(vr)
    pairs = [(k, k + 1) for k in range(nr - 1)]
    if cyclic:
        pairs.append((nr - 1, 0))
    for (ka, kb) in pairs:
        A, B = vr[ka], vr[kb]
        band = []
        if len(A) == 1 and len(B) == 1:
            bands.append(band)
            continue
        n = max(len(A), len(B))
        rng_i = range(n) if closed else range(n - 1)
        for i in rng_i:
            j = (i + 1) % n
            if len(A) == 1:
                quad = (A[0], B[i], B[j])
            elif len(B) == 1:
                quad = (A[i], A[j], B[0])
            else:
                quad = (A[i], A[j], B[j], B[i])
            if flip:
                quad = tuple(reversed(quad))
            band.append(b.bm.faces.new(quad))
        fs += band
        bands.append(band)
    caps_f = []
    if closed and caps and not cyclic:
        if len(vr[0]) > 2:
            caps_f.append(b.bm.faces.new(list(reversed(vr[0]))))
        if len(vr[-1]) > 2:
            caps_f.append(b.bm.faces.new(vr[-1]))
        fs += caps_f
    if recalc and closed:
        bmesh.ops.recalc_face_normals(b.bm, faces=fs)
    allv = [v for r in vr for v in r]
    b._finish(allv, color, mat, jitter, var, smooth)
    return fs, caps_f, bands


def frames_along(pts, up=(0, 0, 1)):
    """Parallel-transport frames (p, T, N, B) along a polyline."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    out = []
    upv = Vector(up)
    n_prev = None
    for i in range(n):
        if i == 0:
            T = pts[1] - pts[0]
        elif i == n - 1:
            T = pts[-1] - pts[-2]
        else:
            T = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            if T.length < 1e-6:
                T = pts[i + 1] - pts[i]
        T.normalize()
        ref = n_prev if n_prev is not None else upv
        N = ref - T * ref.dot(T)
        if N.length < 1e-5:
            alt = Vector((1, 0, 0)) if abs(T.x) < 0.9 else Vector((0, 1, 0))
            N = alt - T * alt.dot(T)
        N.normalize()
        out.append((pts[i], T, N, T.cross(N)))
        n_prev = N
    return out


def sweep(b, pts, radii, seg=6, color='wood', mat='base', jitter=0.0,
          var=0.06, up=(0, 0, 1), sx=1.0, sy=1.0, caps=True, phase=0.0,
          smooth=False):
    """Tube through `pts` with per-point radius (0 = pointed end).

    sy scales the cross-section along the frame normal (initially `up`),
    sx along the binormal (sideways)."""
    fr = frames_along(pts, up)
    if isinstance(radii, (int, float)):
        radii = [radii] * len(fr)
    rings = []
    for (p, T, N, B), r in zip(fr, radii):
        if r <= 1e-6:
            rings.append([p.copy()])
            continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg + phase
            ring.append(p + B * (math.cos(a) * r * sx) + N * (math.sin(a) * r * sy))
        rings.append(ring)
    return loft(b, rings, color, mat, jitter, var, closed=True, caps=caps,
                smooth=smooth)


def beam(b, p0, p1, w, h, color='wood', mat='base', jitter=0.0, var=0.06,
         up=(0, 0, 1), roll=0.0):
    """Rectangular beam from p0 to p1; w = sideways width, h = height."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    upv = Vector(up)
    side = d.cross(upv)
    if side.length < 1e-5:
        side = d.cross(Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0)))
    side.normalize()
    u = side.cross(d).normalized()
    if roll:
        c, s = math.cos(math.radians(roll)), math.sin(math.radians(roll))
        side, u = side * c + u * s, u * c - side * s
    hw, hh = w / 2, h / 2
    ring = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    pts = [p0 + side * a + u * c for a, c in ring] + [p1 + side * a + u * c for a, c in ring]
    return hexa(b, pts, color, mat, jitter, var)


def log(b, p0, p1, r, seg=6, color=TIMBER, end_color='wood_light', jitter=0.0,
        var=0.06, phase=None, r1=None, mat='base'):
    """Round log between two points with lighter end grain."""
    ph = b.rng.uniform(0, 2 * math.pi) if phase is None else phase
    fs, caps, _ = sweep(b, [p0, p1], [r, r if r1 is None else r1], seg=seg,
                        color=color, jitter=jitter, var=var, phase=ph, mat=mat)
    if end_color is not None:
        paint(b, caps, end_color, 0.08)
    return fs


def torus(b, loc, R, r, seg=10, seg2=4, rot=(0, 0, 0), color='iron', mat='metal',
          jitter=0.0, var=0.05, arc=360.0, scale=(1, 1, 1)):
    """Ring (or arc) lying in the local XY plane."""
    M = _matrix(loc, rot, scale)
    full = abs(arc - 360.0) < 1e-6
    n = seg if full else seg + 1
    rings = []
    for i in range(n):
        a = math.radians(arc) * i / seg
        cdir = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for k in range(seg2):
            t = 2 * math.pi * k / seg2
            p = cdir * (R + math.cos(t) * r) + Vector((0, 0, math.sin(t) * r))
            ring.append(M @ p)
        rings.append(ring)
    return loft(b, rings, color, mat, jitter, var, closed=True, caps=not full,
                cyclic=full)


def disc(b, center, normal, r, thick=0.03, seg=8, color='wood', mat='base',
         var=0.05, dome=0.0, phase=0.0):
    """Flat round plate (fan-triangulated so sectors can be painted).

    Returns (front_fan_faces, all_faces); the front faces `normal`."""
    c = Vector(center)
    n = Vector(normal).normalized()
    ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((0, 1, 0))
    x = ref.cross(n).normalized()
    y = n.cross(x)
    back = c - n * (thick / 2)
    front = c + n * (thick / 2)
    rim_b, rim_f = [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg + phase
        d = x * math.cos(a) + y * math.sin(a)
        rim_b.append(back + d * r)
        rim_f.append(front + d * r)
    rings = [[back], rim_b, rim_f, [front + n * dome]]
    fs, _, bands = loft(b, rings, color, mat, 0.0, var, closed=True, caps=False,
                        recalc=True)
    return bands[2], fs


def ngon_prism(b, pts2d, h, frame=None, w0=0.0, color='wood', mat='base',
               jitter=0.0, var=0.06):
    """Extrude a 2D outline given in a Frame's (u, v) plane along w.

    The outline spans w0 .. w0 + h (outward).  Useful for arches, signs and
    silhouettes (e.g. a raven emblem)."""
    F = frame or Frame()
    ring0 = [F.p(u, v, w0) for (u, v) in pts2d]
    ring1 = [F.p(u, v, w0 + h) for (u, v) in pts2d]
    return loft(b, [ring0, ring1], color, mat, jitter, var, closed=True, caps=True)


# ---------------------------------------------------------------------------
# Wall-local frames
# ---------------------------------------------------------------------------
class Frame:
    """Local coordinates on a wall: u = right (seen from outside), v = up
    (world Z), w = outward normal.  yaw 0 = front wall (normal -Y),
    90 = right wall (+X), 180 = back (+Y), 270 = left (-X)."""

    def __init__(self, origin=(0, 0, 0), yaw=0.0):
        self.o = Vector(origin)
        self.yaw = yaw
        a = math.radians(yaw)
        self.U = Vector((math.cos(a), math.sin(a), 0.0))
        self.W = Vector((math.sin(a), -math.cos(a), 0.0))
        self.Z = Vector((0.0, 0.0, 1.0))

    def p(self, u, v=0.0, w=0.0):
        return self.o + self.U * u + self.Z * v + self.W * w

    def box(self, b, size, loc, rot=(0, 0, 0), **kw):
        """Box with size (su, sv, sw) centred at (u, v, w)."""
        su, sv, sw = size
        return b.box(size=(su, sw, sv), loc=self.p(*loc),
                     rot=(rot[0], rot[1], self.yaw + rot[2]), **kw)

    def beam(self, b, a, c, w, h, **kw):
        return beam(b, self.p(*a), self.p(*c), w, h, **kw)


class PathFrame:
    """Wall frame that follows a plan-view curve (e.g. a bowed longhouse wall).

    fn(u) -> Vector((x, y, 0)) on the wall's outer face, with u increasing to
    the right as seen from outside.  Offers the same p()/box() interface as
    Frame, so plank_wall / stone_wall / log_wall work on curves too."""

    def __init__(self, fn):
        self.fn = fn

    def _tw(self, u):
        a, c = self.fn(u - 0.01), self.fn(u + 0.01)
        T = (c - a).normalized()
        return T, Vector((T.y, -T.x, 0.0))

    def p(self, u, v=0.0, w=0.0):
        T, W = self._tw(u)
        return self.fn(u) + Vector((0.0, 0.0, v)) + W * w

    def yaw_at(self, u):
        T, _ = self._tw(u)
        return math.degrees(math.atan2(T.y, T.x))

    def box(self, b, size, loc, rot=(0, 0, 0), **kw):
        su, sv, sw = size
        u, v, w = loc
        return b.box(size=(su, sw, sv), loc=self.p(u, v, w),
                     rot=(rot[0], rot[1], self.yaw_at(u) + rot[2]), **kw)

    def frame_at(self, u):
        """Straight Frame tangent to the curve at u (its u = 0 is here)."""
        return Frame(self.p(u), self.yaw_at(u))


class ArcPath(PathFrame):
    """PathFrame over a plan-view polyline, parametrised by arc length.

    pts: [(x, y), ...] ordered so that u runs to the right as seen from
    outside (counter-clockwise seen from above).  closed=True wraps."""

    def __init__(self, pts, closed=True):
        self.pts = [Vector((p[0], p[1], 0.0)) for p in pts]
        if closed:
            self.pts.append(self.pts[0].copy())
        self.closed = closed
        self.cum = [0.0]
        for a, c in zip(self.pts[:-1], self.pts[1:]):
            self.cum.append(self.cum[-1] + (c - a).length)
        self.length = self.cum[-1]
        super().__init__(self._at)

    def _at(self, u):
        if self.closed:
            u = u % self.length
        else:
            u = min(max(u, 0.0), self.length)
        for i in range(len(self.cum) - 1):
            if self.cum[i] <= u <= self.cum[i + 1]:
                seg = self.cum[i + 1] - self.cum[i]
                t = 0.0 if seg < 1e-9 else (u - self.cum[i]) / seg
                return self.pts[i].lerp(self.pts[i + 1], t)
        return self.pts[-1].copy()

    def nearest_u(self, x, y, side=None):
        """Arc-length u of the path point nearest (x, y)."""
        best, bu = 1e9, 0.0
        n = 400
        for k in range(n):
            u = self.length * k / n
            p = self._at(u)
            d = (p.x - x) ** 2 + (p.y - y) ** 2
            if d < best:
                best, bu = d, u
        return bu


def rect_frames(W, D, cx=0.0, cy=0.0):
    """Frames for the four walls of a W x D rectangle (outer faces)."""
    return {
        'front': (Frame((cx, cy - D / 2, 0), 0), W),
        'right': (Frame((cx + W / 2, cy, 0), 90), D),
        'back': (Frame((cx, cy + D / 2, 0), 180), W),
        'left': (Frame((cx - W / 2, cy, 0), 270), D),
    }


# ---------------------------------------------------------------------------
# Walls
# ---------------------------------------------------------------------------
def _splits(rng, a, b, wmin, wmax, fixed=()):
    """Random breakpoints between a and b that include `fixed` positions."""
    marks = sorted(set([a, b] + [f for f in fixed if a < f < b]))
    out = [marks[0]]
    for m0, m1 in zip(marks[:-1], marks[1:]):
        x = m0
        while m1 - x > wmax:
            step = rng.uniform(wmin, wmax)
            if m1 - (x + step) < wmin:
                step = (m1 - x) / 2
            x += step
            out.append(x)
        out.append(m1)
    return out


def plank_wall(b, F, u0, u1, v0, top, w_out=0.0, thick=0.08, pw=(0.22, 0.32),
               color=TIMBER, openings=(), jitter=0.008, var=0.1, gap=0.0,
               bottom=None, mat='base'):
    """Vertical planks along a Frame from u0 to u1.

    top(u) / bottom(u) give the plank ends (numbers are allowed too);
    openings = [(ua, ub, va, vb), ...] are left empty (door/window holes).
    Planks get random colour and a small random outward offset so the
    joints read without any see-through gaps."""
    topf = top if callable(top) else (lambda u, t=top: t)
    botf = bottom if callable(bottom) else (lambda u, t=v0: t)
    fixed = []
    for (ua, ub, va, vb) in openings:
        fixed += [ua, ub]
    xs = _splits(b.rng, u0, u1, pw[0], pw[1], fixed)
    for ua, ub in zip(xs[:-1], xs[1:]):
        a, c = ua + gap / 2, ub - gap / 2
        segs = [(botf(a), botf(c), topf(a), topf(c))]
        for (oa, ob, va, vb) in openings:
            if ua >= oa - 1e-6 and ub <= ob + 1e-6:
                new = []
                for (b0, b1, t0, t1) in segs:
                    if va > max(b0, b1):
                        new.append((b0, b1, min(va, t0), min(va, t1)))
                    if vb < min(t0, t1):
                        new.append((max(vb, b0), max(vb, b1), t0, t1))
                segs = new
        wo = w_out + b.rng.uniform(-0.008, 0.012)
        cc = rvar(b.rng, color, var)
        for (b0, b1, t0, t1) in segs:
            if min(t0 - b0, t1 - b1) < 0.02:
                continue
            pts = [F.p(a, b0, wo - thick), F.p(c, b1, wo - thick),
                   F.p(c, b1, wo), F.p(a, b0, wo),
                   F.p(a, t0, wo - thick), F.p(c, t1, wo - thick),
                   F.p(c, t1, wo), F.p(a, t0, wo)]
            hexa(b, pts, cc, mat=mat, jitter=jitter, var=0.04)
    return xs


def log_wall(b, F, u0, u1, v0, n, r=0.14, step=0.25, w_c=0.0, ext=0.2,
             color=TIMBER, end_color='wood_light', openings=(), seg=6,
             jitter=0.012, offset=0.0, var=0.08):
    """Horizontal logs along a Frame (log centres at w = w_c).

    Logs run from u0 - ext to u1 + ext (crossing past the corners).  Rows
    whose centre lies inside an opening's v-range are split around it.
    Returns the z of the top of the last row."""
    for i in range(n):
        v = v0 + r + offset + i * step
        pieces = [(u0 - ext - b.rng.uniform(0, 0.05), u1 + ext + b.rng.uniform(0, 0.05))]
        for (oa, ob, va, vb) in openings:
            if va - 0.01 <= v <= vb + 0.01:
                new = []
                for (a, c) in pieces:
                    if oa > a:
                        new.append((a, min(c, oa)))
                    if ob < c:
                        new.append((max(a, ob), c))
                pieces = new
        rr = r * b.rng.uniform(0.93, 1.05)
        cc = rvar(b.rng, color, var)
        for (a, c) in pieces:
            if c - a < 0.05:
                continue
            log(b, F.p(a, v, w_c), F.p(c, v, w_c), rr, seg=seg, color=cc,
                end_color=end_color, jitter=jitter, phase=math.pi / 2)
    return v0 + r + offset + (n - 1) * step + r


STONE_COLS = ('stone', 'stone_dark', 'stone_light', 'slate')


def stone_color(rng, base=None, moss=0.0):
    c = base or rng.choice(('stone', 'stone', 'stone_dark', 'slate', 'stone_light'))
    k = rng.uniform(0.85, 1.12)
    out = tone(c, k)
    if moss and rng.random() < moss:
        out = tone(out, 1.0, 'moss', rng.uniform(0.25, 0.5))
    return out


def stone_wall(b, F, u0, u1, v0, v1, w_out=0.0, thick=0.4, course=(0.2, 0.3),
               length=(0.35, 0.7), jitter=0.025, openings=(), moss_top=0.35,
               colors=None, bevel=0.0, protrude=0.03, cap=True):
    """Dry-stone wall of irregular stones in courses (running bond)."""
    v = v0
    row = 0
    while v < v1 - 0.05:
        h = b.rng.uniform(*course)
        if v1 - (v + h) < course[0] * 0.7:
            h = v1 - v
        xs = _splits(b.rng, u0, u1, length[0], length[1],
                     [o[0] for o in openings] + [o[1] for o in openings])
        last_row = v + h >= v1 - 1e-4
        for ua, ub in zip(xs[:-1], xs[1:]):
            mid_u = (ua + ub) / 2
            pieces = [(v, v + h)]
            for (oa, ob, va, vb) in openings:
                if oa - 1e-4 <= mid_u <= ob + 1e-4:
                    new = []
                    for (p0, p1) in pieces:
                        if p0 < va:
                            new.append((p0, min(p1, va)))
                        if p1 > vb:
                            new.append((max(p0, vb), p1))
                    pieces = [(p0, p1) for (p0, p1) in new if p1 - p0 > 0.06]
            c = colors(b.rng) if colors else stone_color(b.rng)
            wo = w_out + b.rng.uniform(-0.01, protrude)
            for (p0, p1) in pieces:
                F.box(b, (ub - ua - 0.015, p1 - p0 - 0.012, thick),
                      (mid_u, (p0 + p1) / 2, wo - thick / 2), color=c, jitter=jitter,
                      bevel=bevel)
            if pieces and pieces[-1][1] < v + h - 1e-4:
                continue
            if cap and last_row and pieces and b.rng.random() < moss_top:
                F.box(b, (ub - ua - 0.06, 0.04, thick * 0.8),
                      (mid_u + b.rng.uniform(-0.03, 0.03), v + h + 0.005,
                       wo - thick / 2), color=tone('moss', b.rng.uniform(0.85, 1.1)),
                      jitter=0.012)
        v += h
        row += 1
    return v


# ---------------------------------------------------------------------------
# Roofs
# ---------------------------------------------------------------------------
class Slope:
    """One roof plane between an eave line and a ridge line.

    s in [0, 1] runs left -> right as seen from outside, t in [0, 1] from the
    eave to the ridge.  P(s, t) lies on the TOP of the roof deck.
    Optional `bow` pushes the eave outward in the middle (curved longhouse)
    and `sag` lowers the ridge in the middle."""

    def __init__(self, e0, e1, r0, r1, bow=0.0, bow_dir=(0, 0, 0), sag=0.0,
                 eave_wave=0.0, seed=0):
        self.e0, self.e1 = Vector(e0), Vector(e1)
        self.r0, self.r1 = Vector(r0), Vector(r1)
        self.bow = bow
        self.bow_dir = Vector(bow_dir)
        self.sag = sag
        self.wave = eave_wave
        self.seed = seed

    def E(self, s):
        p = self.e0.lerp(self.e1, s)
        k = 1.0 - (2 * s - 1) ** 2
        p = p + self.bow_dir * (self.bow * k)
        if self.wave:
            p.z += self.wave * math.sin(s * 7.3 + self.seed) * 0.5
        return p

    def R(self, s):
        p = self.r0.lerp(self.r1, s)
        k = 1.0 - (2 * s - 1) ** 2
        p.z -= self.sag * k
        return p

    def P(self, s, t):
        return self.E(s).lerp(self.R(s), t)

    def N(self, s=0.5, t=0.5):
        e = 0.01
        ds = self.P(min(1, s + e), t) - self.P(max(0, s - e), t)
        dt = self.P(s, min(1, t + e)) - self.P(s, max(0, t - e))
        return ds.cross(dt).normalized()


def slope_slab(b, S, thick=0.08, ns=1, color=BEAM, t0=0.0, t1=1.0, var=0.06,
               jitter=0.0):
    """Solid roof deck under a Slope (between t0 and t1)."""
    rings = []
    for i in range(ns + 1):
        s = i / ns
        n = S.N(s, 0.5)
        a, c = S.P(s, t0), S.P(s, t1)
        rings.append([a, c, c - n * thick, a - n * thick])
    fs, _, _ = loft(b, rings, color, 'base', jitter, var, closed=True, caps=True)
    return fs


def shingles(b, S, rows, cols, lift=0.05, colors=('wood', 'wood_dark'),
             stagger=True, jitter=0.012, t0=0.0, t1=1.0, var=0.12,
             col_fn=None, mat='base'):
    """Overlapping rows of shingles on a Slope (sawtooth sheet, 4 tris/cell).

    Each cell = sloped face (lower edge lifted by `lift`) + a butt face."""
    for k in range(rows):
        ta = t0 + (t1 - t0) * k / rows
        tb = t0 + (t1 - t0) * (k + 1) / rows
        off = (0.5 / cols) if (stagger and k % 2) else 0.0
        xs = [0.0]
        for i in range(1, cols + 1):
            x = (i - off) / cols
            if 0.0 < x < 1.0:
                xs.append(x)
        xs.append(1.0)
        xs = sorted(set(xs))
        for sa, sb in zip(xs[:-1], xs[1:]):
            if col_fn:
                c = col_fn(b.rng, k, sa)
            else:
                c = rvar(b.rng, b.rng.choice(colors), var)
            n = S.N((sa + sb) / 2, (ta + tb) / 2)
            li = lift * b.rng.uniform(0.75, 1.25)
            A0, B0 = S.P(sa, ta), S.P(sb, ta)
            A1, B1 = S.P(sa, tb), S.P(sb, tb)
            A0l, B0l = A0 + n * li, B0 + n * li
            vs = [b.bm.verts.new(p) for p in (A0, B0, B0l, A0l, A1, B1)]
            f1 = b.bm.faces.new((vs[3], vs[2], vs[5], vs[4]))   # face
            f2 = b.bm.faces.new((vs[0], vs[1], vs[2], vs[3]))   # butt
            b._finish(vs, c, mat, jitter, 0.03)
            del f1, f2


def turf(b, S, nu=8, nt=4, thick=0.2, lump=0.05, colors=('turf', 'turf', 'moss', 'grass'),
         edge='soil', t0=0.0, t1=1.0, ridge_over=0.0, fringe=True,
         fringe_colors=('turf', 'moss', 'grass'), var=0.05, shade=(0.9, 1.05),
         fringe_len=(0.07, 0.2), fringe_density=3.5):
    """Lumpy sod layer on a Slope: jittered grid top, soil edges, grass fringe."""
    rng = b.rng
    grid = []
    span = (t1 - t0 + ridge_over)
    for j in range(nt + 1):
        row = []
        for i in range(nu + 1):
            s = i / nu
            t = t0 + span * j / nt
            if 0 < i < nu:
                s += rng.uniform(-0.3, 0.3) / nu
            if 0 < j < nt:
                t += rng.uniform(-0.3, 0.3) * span / nt
            n = S.N(s, min(t, 1.0))
            h = thick + rng.uniform(-lump, lump)
            if j == 0:
                h = thick * 0.8 + rng.uniform(-lump, lump) * 0.4
            row.append((S.P(s, t) + n * h, s, t))
        grid.append(row)
    top_v = [[b.bm.verts.new(p) for (p, s, t) in row] for row in grid]
    top_faces = []
    for j in range(nt):
        for i in range(nu):
            f = b.bm.faces.new((top_v[j][i], top_v[j][i + 1],
                                top_v[j + 1][i + 1], top_v[j + 1][i]))
            top_faces.append(f)
    for f in top_faces:
        paint(b, [f], tone(rng.choice(colors), rng.uniform(*shade)), var)
        f.material_index = MAT_INDEX['base']
    bottoms = {}

    def low(j, i):
        key = (j, i)
        if key not in bottoms:
            _, s, t = grid[j][i]
            bottoms[key] = b.bm.verts.new(S.P(s, t) - S.N(s, min(t, 1.0)) * 0.01)
        return bottoms[key]

    skirt = []
    down = S.P(0.5, 0.0) - S.P(0.5, 1.0)
    left = S.P(0.0, 0.5) - S.P(1.0, 0.5)
    for i in range(nu):   # eave edge
        skirt.append(orient(b.bm.faces.new((low(0, i), low(0, i + 1), top_v[0][i + 1],
                                            top_v[0][i])), down))
    for j in range(nt):   # left edge (s = 0)
        skirt.append(orient(b.bm.faces.new((low(j, 0), low(j + 1, 0), top_v[j + 1][0],
                                            top_v[j][0])), left))
    for j in range(nt):   # right edge (s = 1)
        skirt.append(orient(b.bm.faces.new((low(j, nu), low(j + 1, nu), top_v[j + 1][nu],
                                            top_v[j][nu])), -left))
    paint(b, skirt, edge, 0.1)
    for f in skirt:
        f.material_index = MAT_INDEX['base']
    if fringe:
        e_len = (S.E(0.0) - S.E(1.0)).length
        n_f = max(3, int(e_len * fringe_density))
        for i in range(n_f):
            if rng.random() < 0.15:
                continue
            s = min(0.99, max(0.01, (i + rng.uniform(0.1, 0.9)) / n_f))
            e = S.P(s, t0)
            n = S.N(s, t0)
            down_out = (e - S.P(s, t0 + 0.2)).normalized()
            base = e + n * (thick * rng.uniform(0.35, 0.6))
            ln = rng.uniform(*fringe_len)
            tip = base + down_out * ln * 0.7 + Vector((0, 0, -ln))
            sweep(b, [base, tip], [rng.uniform(0.045, 0.075), 0.0], seg=3,
                  color=tone(rng.choice(fringe_colors), rng.uniform(0.75, 1.0)),
                  phase=rng.uniform(0, 3))
    return grid


def blades(b, loc, h=0.3, r=0.05, n=3, color='grass', spread=0.08, tilt=18.0,
           up=(0, 0, 1), mat='base'):
    """A small tuft of grass blades (3-sided cones)."""
    rng = b.rng
    upv = Vector(up).normalized()
    ref = Vector((1, 0, 0)) if abs(upv.x) < 0.9 else Vector((0, 1, 0))
    x = upv.cross(ref).normalized()
    y = upv.cross(x)
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0, spread)
        base = Vector(loc) + (x * math.cos(a) + y * math.sin(a)) * d
        lean = math.radians(rng.uniform(tilt * 0.3, tilt))
        dirv = (upv * math.cos(lean) + (x * math.cos(a) + y * math.sin(a)) * math.sin(lean))
        hh = h * rng.uniform(0.7, 1.15)
        sweep(b, [base - upv * 0.02, base + dirv * hh], [r * rng.uniform(0.8, 1.2), 0.0],
              seg=3, color=tone(color, rng.uniform(0.85, 1.15)), phase=rng.uniform(0, 3),
              mat=mat)


def tufts_on(b, S, count, t_range=(0.1, 0.9), s_range=(0.04, 0.96), lift=0.2,
             h=(0.18, 0.32), colors=('grass', 'turf', 'moss')):
    for _ in range(count):
        s = b.rng.uniform(*s_range)
        t = b.rng.uniform(*t_range)
        n = S.N(s, t)
        p = S.P(s, t) + n * (lift - 0.02)
        blades(b, p, h=b.rng.uniform(*h), r=0.05, n=3, color=b.rng.choice(colors),
               up=(n + Vector((0, 0, 1.5))).normalized())


def flowers_on(b, S, count, t_range=(0.1, 0.9), s_range=(0.05, 0.95), lift=0.2,
               colors=('bone', 'mush_yellow', 'flax', 'turnip_top')):
    for _ in range(count):
        s = b.rng.uniform(*s_range)
        t = b.rng.uniform(*t_range)
        n = S.N(s, t)
        p = S.P(s, t) + n * (lift + 0.02)
        flower(b, p, color=b.rng.choice(colors), h=b.rng.uniform(0.12, 0.22))


def flower(b, loc, color='bone', h=0.18, r=0.05, stem='leaf_dark'):
    x, y, z = loc
    b.box((0.015, 0.015, h), loc=(x, y, z + h / 2 - 0.02), color=stem, var=0.05)
    b.ico(r=r, sub=0, loc=(x, y, z + h), scale=(1, 1, 0.6),
          color=tone(color, b.rng.uniform(0.9, 1.1)), var=0.08)


# ---------------------------------------------------------------------------
# Openings
# ---------------------------------------------------------------------------
def window(b, F, u, v, width, height, w_face=0.0, depth=0.14, frame_c=BEAM,
           glow=WINDOW, shutters=True, shutter_c=None, mullion=True, sill=True,
           open_deg=115.0, fw=0.07, round_=False, seg=10):
    """Window centred at (u, v) in a wall whose outer face is at w = w_face.

    Returns the world position for a light socket (in front of the glass)."""
    g_w = w_face - depth * 0.55
    if round_:
        r = width / 2
        disc(b, F.p(u, v, g_w), F.W, r * 0.98, thick=0.03, seg=seg, color=glow,
             mat='emit', var=0.03)
        torus(b, F.p(u, v, w_face - 0.02), r + fw * 0.35, fw * 0.55, seg=seg,
              seg2=4, rot=_frame_rot(F), color=frame_c, mat='base', var=0.08)
        if mullion:
            F.box(b, (0.035, width, 0.03), (u, v, g_w + 0.025), color=frame_c)
            F.box(b, (width, 0.035, 0.03), (u, v, g_w + 0.025), color=frame_c)
        return F.p(u, v, w_face + 0.15)
    F.box(b, (width + 0.02, height + 0.02, 0.03), (u, v, g_w), color=glow,
          mat='emit', var=0.03)
    d = depth + 0.03
    wc = w_face - depth / 2 + 0.03
    F.box(b, (width + 2 * fw, fw, d), (u, v + height / 2 + fw / 2, wc), color=frame_c)
    F.box(b, (width + 2 * fw, fw, d), (u, v - height / 2 - fw / 2, wc), color=frame_c)
    F.box(b, (fw, height, d), (u - width / 2 - fw / 2, v, wc), color=frame_c)
    F.box(b, (fw, height, d), (u + width / 2 + fw / 2, v, wc), color=frame_c)
    if mullion:
        F.box(b, (0.035, height, 0.03), (u, v, g_w + 0.025), color=frame_c)
        F.box(b, (width, 0.035, 0.03), (u, v, g_w + 0.025), color=frame_c)
    if sill:
        F.box(b, (width + 0.24, 0.05, depth * 0.5 + 0.12),
              (u, v - height / 2 - fw - 0.02, w_face + 0.04), color=frame_c)
    if shutters:
        sc = shutter_c or TIMBER_LT
        a = math.radians(open_deg)
        for side in (-1, 1):
            hinge_u = u + side * (width / 2 + fw)
            du, dw = -side * math.cos(a), math.sin(a)
            p0 = F.p(hinge_u, v, w_face + 0.03)
            dirw = F.U * du + F.W * dw
            p1 = p0 + dirw * (width / 2 + fw * 0.5)
            beam(b, p0, p1, 0.035, height + 0.06, color=rvar(b.rng, sc, 0.08))
            for hv in (-0.3, 0.3):
                q0 = p0 + dirw * 0.03 + Vector((0, 0, height * hv))
                q1 = p1 - dirw * 0.03 + Vector((0, 0, height * hv))
                beam(b, q0, q1, 0.06, 0.07, color=BEAM)
    return F.p(u, v, w_face + 0.15)


def _frame_rot(F):
    """Euler rotation (deg) that maps local Z onto the frame's outward W."""
    return (90.0, 0.0, F.yaw)


def door(b, F, u, width, height, w_face=0.0, v0=0.0, recess=0.06, leaf_c=None,
         frame_c=BEAM, planks=4, double=False, arch=False, bands=True,
         handle=True, frame=True, fw=0.12, band_c=IRON, lintel_extra=0.12):
    """Planked door (optionally double / arched) with frame and iron straps."""
    lc = leaf_c or TIMBER_LT
    w_leaf = w_face - recess
    top = v0 + height

    def top_at(uu):
        if not arch:
            return top
        r = width / 2
        du = min(r, abs(uu - u))
        return top - r + math.sqrt(max(0.0, r * r - du * du))

    xs = [u - width / 2 + width * i / planks for i in range(planks + 1)]
    for i, (a, c) in enumerate(zip(xs[:-1], xs[1:])):
        cc = rvar(b.rng, lc, 0.1)
        pts = [F.p(a + 0.006, v0, w_leaf - 0.06), F.p(c - 0.006, v0, w_leaf - 0.06),
               F.p(c - 0.006, v0, w_leaf), F.p(a + 0.006, v0, w_leaf),
               F.p(a + 0.006, top_at(a), w_leaf - 0.06), F.p(c - 0.006, top_at(c), w_leaf - 0.06),
               F.p(c - 0.006, top_at(c), w_leaf), F.p(a + 0.006, top_at(a), w_leaf)]
        hexa(b, pts, cc, jitter=0.004, var=0.05)
    if bands:
        for hv in (0.22, 0.72) if not arch else (0.2, 0.62):
            vv = v0 + height * hv
            if double:
                for side in (-1, 1):
                    F.box(b, (width / 2 - 0.1, 0.07, 0.025),
                          (u + side * (width / 4 + 0.02), vv, w_leaf + 0.012),
                          color=band_c, mat='metal')
            else:
                F.box(b, (width * 0.82, 0.07, 0.025),
                      (u - width * 0.07, vv, w_leaf + 0.012), color=band_c, mat='metal')
    if handle:
        hv = v0 + min(1.0, height * 0.5)
        if double:
            for side in (-1, 1):
                torus(b, F.p(u + side * 0.12, hv, w_leaf + 0.03), 0.06, 0.012, seg=6,
                      seg2=3, rot=_frame_rot(F), color='iron', mat='metal')
        else:
            torus(b, F.p(u + width * 0.32, hv, w_leaf + 0.03), 0.05, 0.012, seg=6,
                  seg2=3, rot=_frame_rot(F), color='iron', mat='metal')
    if frame:
        d = recess + 0.1
        wc = w_face - recess / 2 + 0.02
        if arch:
            r = width / 2 + fw / 2
            pts = []
            for i in range(9):
                a = math.pi * i / 8
                pts.append(F.p(u + math.cos(a) * r, top - width / 2 + math.sin(a) * r, wc))
            F.box(b, (fw, height - width / 2, d), (u - width / 2 - fw / 2, v0 + (height - width / 2) / 2, wc), color=frame_c)
            F.box(b, (fw, height - width / 2, d), (u + width / 2 + fw / 2, v0 + (height - width / 2) / 2, wc), color=frame_c)
            for p0, p1 in zip(pts[:-1], pts[1:]):
                beam(b, p0, p1, fw, d, color=frame_c, up=F.W)
        else:
            F.box(b, (fw, height + 0.02, d), (u - width / 2 - fw / 2, v0 + height / 2, wc), color=frame_c, jitter=0.005)
            F.box(b, (fw, height + 0.02, d), (u + width / 2 + fw / 2, v0 + height / 2, wc), color=frame_c, jitter=0.005)
            F.box(b, (width + 2 * fw + lintel_extra * 2, fw * 1.2, d + 0.02),
                  (u, top + fw * 0.6, wc), color=frame_c, jitter=0.005)
    return F.p(u, 0.0, w_face + 0.55)


# ---------------------------------------------------------------------------
# Fire & light
# ---------------------------------------------------------------------------
def flame(b, loc, h=0.35, r=0.1, seg=5, color=FLAME, lean=(0.0, 0.0),
          phase=0.0):
    """Low-poly teardrop flame (emissive)."""
    x, y, z = loc
    prof = [(r * 0.55, 0.0), (r, h * 0.3), (r * 0.5, h * 0.66), (0.0, h)]
    rings = []
    for (rr, zz) in prof:
        t = zz / h
        cx, cy = x + lean[0] * t * t, y + lean[1] * t * t
        if rr <= 0:
            rings.append([(cx, cy, z + zz)])
            continue
        rings.append([(cx + rr * math.cos(2 * math.pi * k / seg + phase),
                       cy + rr * math.sin(2 * math.pi * k / seg + phase), z + zz)
                      for k in range(seg)])
    return loft(b, rings, color, 'emit', 0.0, 0.04, closed=True, caps=True)


def fire(b, loc, s=1.0, seg=5):
    """Cluster of three flames of different heat; returns the flame centre."""
    x, y, z = loc
    rng = b.rng
    flame(b, (x, y, z), h=0.5 * s, r=0.14 * s, seg=seg, color=FLAME,
          lean=(rng.uniform(-0.04, 0.04) * s, rng.uniform(-0.04, 0.04) * s),
          phase=rng.uniform(0, 1))
    flame(b, (x + 0.07 * s, y - 0.06 * s, z), h=0.36 * s, r=0.09 * s, seg=seg,
          color=FLAME_HOT, lean=(0.03 * s, -0.02 * s), phase=rng.uniform(0, 1))
    flame(b, (x - 0.08 * s, y + 0.02 * s, z), h=0.3 * s, r=0.08 * s, seg=seg,
          color=EMBER, lean=(-0.04 * s, 0.02 * s), phase=rng.uniform(0, 1))
    return (x, y, z + 0.22 * s)


def embers(b, loc, r=0.25, n=6, size=0.06, z_spread=0.03):
    x, y, z = loc
    for _ in range(n):
        a = b.rng.uniform(0, 2 * math.pi)
        d = b.rng.uniform(0, r)
        b.ico(r=size * b.rng.uniform(0.7, 1.3), sub=0,
              loc=(x + math.cos(a) * d, y + math.sin(a) * d, z + b.rng.uniform(0, z_spread)),
              scale=(1, 1, 0.6), color=b.rng.choice((EMBER, FLAME, EMBER)),
              mat='emit', var=0.1)


def lantern(b, top, s=1.0, glass=LANTERN, frame=IRON, hook=True):
    """Hanging lantern whose hook is at `top`; returns the glass centre."""
    x, y, z = top
    if hook:
        b.box((0.02 * s, 0.02 * s, 0.07 * s), loc=(x, y, z - 0.035 * s), color=frame, mat='metal')
    b.cone(r=0.12 * s, h=0.09 * s, seg=4, loc=(x, y, z - 0.16 * s), rot=(0, 0, 45),
           color=frame, mat='metal')
    b.box((0.16 * s, 0.16 * s, 0.025 * s), loc=(x, y, z - 0.17 * s), color=frame, mat='metal')
    b.box((0.12 * s, 0.12 * s, 0.17 * s), loc=(x, y, z - 0.265 * s), color=glass,
          mat='emit', var=0.03)
    for dx in (-1, 1):
        for dy in (-1, 1):
            b.box((0.024 * s, 0.024 * s, 0.19 * s),
                  loc=(x + dx * 0.066 * s, y + dy * 0.066 * s, z - 0.265 * s),
                  color=frame, mat='metal')
    b.box((0.16 * s, 0.16 * s, 0.03 * s), loc=(x, y, z - 0.365 * s), color=frame, mat='metal')
    return (x, y, z - 0.265 * s)


# ---------------------------------------------------------------------------
# Set dressing
# ---------------------------------------------------------------------------
def barrel(b, loc, r=0.3, h=0.8, seg=8, color='wood', hoop=IRON, rot=(0, 0, 0),
           lid_color=None, hoops=(0.14, 0.86), jitter=0.004):
    prof = [(r * 0.84, 0.0), (r * 0.97, h * 0.25), (r, h * 0.5), (r * 0.97, h * 0.75),
            (r * 0.84, h)]
    fs = b.lathe(prof, seg=seg, loc=loc, rot=rot, color=color, jitter=jitter, var=0.1)
    # lid = the top cap face (largest z normal after rotation)
    M = _matrix(loc, rot)
    up = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
    for f in fs:
        f.normal_update()
    cap = [f for f in fs if len(f.verts) == seg and f.normal.dot(up) > 0.9]
    if cap:
        paint(b, cap, lid_color or tone(color, 0.78), 0.05)
    for hz in hoops:
        z = h * hz
        t = 1.0 - abs(z / h - 0.5) * 2
        rr = r * (0.84 + 0.16 * math.sqrt(max(0.0, t))) + 0.012
        b.lathe([(rr, z - 0.035), (rr, z + 0.035)], seg=seg, loc=loc, rot=rot,
                color=hoop, mat='metal', cap_bottom=False, cap_top=False, var=0.04)
    return fs


def crate(b, loc, size=(0.6, 0.6, 0.5), rot_z=0.0, color='wood_light', edge=BEAM,
          brace=True, jitter=0.006):
    x, y, z = loc
    sx, sy, sz = size
    b.box((sx - 0.04, sy - 0.04, sz - 0.02), loc=(x, y, z + sz / 2), rot=(0, 0, rot_z),
          color=color, jitter=jitter, var=0.1)
    a = math.radians(rot_z)
    ca, sa = math.cos(a), math.sin(a)

    def P2(dx, dy):
        return (x + dx * ca - dy * sa, y + dx * sa + dy * ca)

    t = 0.06
    for dx in (-1, 1):
        for dy in (-1, 1):
            px, py = P2(dx * (sx / 2 - t / 2), dy * (sy / 2 - t / 2))
            b.box((t, t, sz), loc=(px, py, z + sz / 2), rot=(0, 0, rot_z), color=edge,
                  jitter=jitter * 0.5)
    for hz in (0.06, sz - 0.05):
        b.box((sx + 0.005, sy + 0.005, 0.07), loc=(x, y, z + hz), rot=(0, 0, rot_z),
              color=edge, jitter=jitter * 0.5)
    if brace:
        p0x, p0y = P2(-sx / 2 + 0.06, -sy / 2 - 0.004)
        p1x, p1y = P2(sx / 2 - 0.06, -sy / 2 - 0.004)
        beam(b, (p0x, p0y, z + 0.1), (p1x, p1y, z + sz - 0.1), 0.02, 0.07, color=edge)


def sack(b, loc, s=1.0, color='linen', rot=(0, 0, 0), tie='rope'):
    prof = [(0.0, 0.0), (0.2 * s, 0.02 * s), (0.25 * s, 0.14 * s), (0.22 * s, 0.3 * s),
            (0.1 * s, 0.42 * s), (0.055 * s, 0.46 * s), (0.1 * s, 0.53 * s), (0.0, 0.52 * s)]
    return b.lathe(prof, seg=7, loc=loc, rot=rot, color=color, jitter=0.012 * s, var=0.08)


def shield(b, center, normal, r=0.4, colors=('red', 'bone'), sectors=6, seg=None,
           boss='iron', rim=None, phase=0.0):
    """Round Norse shield: painted sectors, iron boss."""
    seg = seg or sectors
    front, allf = disc(b, center, normal, r, thick=0.04, seg=seg, color=colors[0],
                       dome=0.02, phase=phase)
    for i, f in enumerate(front):
        paint(b, [f], colors[(i * sectors // seg) % len(colors)], 0.06)
    if rim:
        side = [f for f in allf if f not in front]
        paint(b, side, rim, 0.05)
    n = Vector(normal).normalized()
    c = Vector(center) + n * 0.03
    q = Vector((0, 0, 1)).rotation_difference(n)
    e = q.to_euler('XYZ')
    b.cyl(r1=r * 0.22, r2=r * 0.08, h=r * 0.18, seg=6, loc=c,
          rot=tuple(math.degrees(a) for a in e), color=boss, mat='metal')


def rope_coil(b, loc, r=0.25, turns=3, thick=0.035, color='rope'):
    x, y, z = loc
    for k in range(turns):
        rr = r * (1.0 - 0.18 * k)
        torus(b, (x, y, z + thick + k * thick * 1.6), rr, thick, seg=9, seg2=4,
              color=tone(color, 1.0 - 0.05 * k), mat='base', var=0.05)


def dragon_head(b, base, fwd, s=1.0, color=BEAM, accent='ochre', tongue='red',
                eye='bone', seg=6):
    """Carved Norse dragon head on an S-curved neck rising from `base`.

    fwd = horizontal direction the snout faces.  Height ~0.95*s."""
    F = Vector(fwd).normalized()
    U = Vector((0, 0, 1))
    S_ = F.cross(U).normalized()
    o = Vector(base)

    def p(f, u, sd=0.0):
        return o + F * (f * s) + U * (u * s) + S_ * (sd * s)

    spine = [p(0.0, 0.0), p(-0.03, 0.22), p(0.0, 0.44), p(0.1, 0.62), p(0.26, 0.74),
             p(0.44, 0.79), p(0.62, 0.79), p(0.78, 0.75), p(0.9, 0.72)]
    radii = [0.1, 0.09, 0.085, 0.085, 0.09, 0.105, 0.095, 0.07, 0.04]
    sweep(b, spine, [r * s for r in radii], seg=seg, color=color, sx=0.72, sy=1.0,
          jitter=0.004 * s, up=-F)
    # lower jaw (open mouth)
    jaw = [p(0.42, 0.72), p(0.6, 0.66), p(0.76, 0.6), p(0.84, 0.6)]
    sweep(b, jaw, [0.065 * s, 0.055 * s, 0.035 * s, 0.015 * s], seg=5, color=color,
          sx=0.8, up=U)
    # tongue curling out
    tg = [p(0.56, 0.7), p(0.74, 0.67), p(0.9, 0.63), p(0.98, 0.67)]
    sweep(b, tg, [0.028 * s, 0.024 * s, 0.018 * s, 0.0], seg=4, color=tongue, up=U)
    # snout knob curling up
    kn = [p(0.86, 0.76), p(0.95, 0.82), p(0.93, 0.9), p(0.87, 0.9)]
    sweep(b, kn, [0.04 * s, 0.035 * s, 0.03 * s, 0.0], seg=5, color=color, up=-F)
    # eyes + horns / ears swept back
    for side in (-1, 1):
        b.ico(r=0.035 * s, sub=0, loc=p(0.56, 0.85, side * 0.062), color=eye, var=0.05)
        horn = [p(0.44, 0.84, side * 0.045), p(0.33, 0.98, side * 0.07),
                p(0.18, 1.04, side * 0.09), p(0.08, 1.02, side * 0.1)]
        sweep(b, horn, [0.045 * s, 0.035 * s, 0.022 * s, 0.0], seg=4, color=color, up=U)
    # crest fins along the back of the neck
    for (f, u, ln) in ((-0.07, 0.24, 0.12), (-0.04, 0.44, 0.12), (0.04, 0.62, 0.11),
                       (0.18, 0.76, 0.09)):
        a = p(f, u)
        tip = a - F * (ln * s) + U * (0.05 * s)
        sweep(b, [a + F * (0.04 * s), tip], [0.03 * s, 0.0], seg=4, color=accent, up=U)
    return p(0.5, 0.8)


def grass(b, center, radius, count, h=(0.15, 0.3), colors=('grass', 'turf', 'moss'),
          avoid=None, z=0.0):
    """Scatter small tufts on the ground around a point (avoid(x, y) -> bool)."""
    cx, cy = center[0], center[1]
    placed = 0
    tries = 0
    while placed < count and tries < count * 20:
        tries += 1
        a = b.rng.uniform(0, 2 * math.pi)
        d = radius * math.sqrt(b.rng.random())
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        if avoid and avoid(x, y):
            continue
        blades(b, (x, y, z), h=b.rng.uniform(*h), r=0.045, n=3, color=b.rng.choice(colors))
        placed += 1


def grass_edge(b, W, D, count, margin=0.45, cx=0.0, cy=0.0, skip=None,
               h=(0.15, 0.3), colors=('grass', 'turf', 'moss')):
    """Tufts hugging the outside of a W x D footprint (keeps bounds tight).

    skip(x, y) -> True rejects a spot (e.g. in front of a door)."""
    per = 2 * (W + D)
    placed, tries = 0, 0
    while placed < count and tries < count * 30:
        tries += 1
        t = b.rng.uniform(0, per)
        off = b.rng.uniform(0.06, margin)
        if t < W:
            x, y = cx - W / 2 + t, cy - D / 2 - off
        elif t < W + D:
            x, y = cx + W / 2 + off, cy - D / 2 + (t - W)
        elif t < 2 * W + D:
            x, y = cx + W / 2 - (t - W - D), cy + D / 2 + off
        else:
            x, y = cx - W / 2 - off, cy + D / 2 - (t - 2 * W - D)
        if skip and skip(x, y):
            continue
        blades(b, (x, y, 0.0), h=b.rng.uniform(*h), r=0.045, n=3, color=b.rng.choice(colors))
        placed += 1


def pebble(b, loc, r=0.1, color=None, scale=(1, 1, 0.6)):
    c = color or stone_color(b.rng)
    x, y, z = loc
    b.ico(r=r, sub=0, loc=(x, y, z + r * scale[2] * 0.6), scale=scale, color=c,
          jitter=r * 0.18, var=0.08)


class StoneSlab:
    """Weathered standing stone built from lofted rounded-rectangle sections.

    Local axes: x across (width W), y through (thickness T, front = -y),
    z up.  The stone is rotated by `yaw` (deg) and sheared by `lean`
    (dx, dy per metre of height).  front(u, v, off) returns a world point on
    the front face (for carvings)."""

    def __init__(self, b, base, H, W, T, yaw=0.0, lean=(0.0, 0.0), top=0.28, taper=0.18,
                 levels=7, seg=8, color=None, jitter=0.03, sink=0.1, shape=None):
        self.base = Vector(base)
        self.H, self.W, self.T = H, W, T
        self.yaw = math.radians(yaw)
        self.lean = lean
        self.top, self.taper = top, taper
        self.shape = shape
        c = color or stone_color(b.rng, 'stone')
        rings = []
        vs = [-sink] + [H * (k / (levels - 1)) ** 0.85 for k in range(1, levels)]
        for k, v in enumerate(vs):
            w, t = self.wt(v)
            if k == len(vs) - 1:
                w, t = max(w, W * 0.18), max(t, T * 0.3)
            ring = []
            for i in range(seg):
                a = 2 * math.pi * (i + 0.5) / seg
                ca, sa = math.cos(a), math.sin(a)
                x = w / 2 * math.copysign(abs(ca) ** 0.5, ca)
                y = t / 2 * math.copysign(abs(sa) ** 0.5, sa)
                j = jitter if 0 < k else jitter * 0.5
                ring.append(self.world(x + b.rng.uniform(-j, j), y + b.rng.uniform(-j, j) * 0.6,
                                       max(-sink, v) + (b.rng.uniform(-j, j) if 0 < k < len(vs) - 1 else 0.0)))
            rings.append(ring)
        self.faces, _, _ = loft(b, rings, color=c, closed=True, caps=True, var=0.08)

    def wt(self, v):
        H, W, T = self.H, self.W, self.T
        v0 = (1.0 - self.top) * H
        if self.shape:
            k = self.shape(max(0.0, v) / H)
            return W * k, T * (0.6 + 0.4 * k)
        w0 = W * (1.0 - self.taper * min(v, v0) / H)
        t0 = T * (1.0 - self.taper * 0.5 * min(v, v0) / H)
        if v <= v0:
            return w0, t0
        s = min(1.0, (v - v0) / (H - v0))
        return w0 * max(0.0, 1.0 - s * s) ** 0.5, t0 * max(0.0, 1.0 - s ** 1.5) ** 0.5

    def world(self, x, y, z):
        x += self.lean[0] * max(0.0, z)
        y += self.lean[1] * max(0.0, z)
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        return self.base + Vector((x * c - y * s, x * s + y * c, z))

    def front(self, u, v, off=0.0):
        w, t = self.wt(v)
        k = min(0.999, abs(u) / max(1e-3, w / 2))
        y = -t / 2 * (1.0 - k ** 4) ** 0.25 - off
        return self.world(u, y, v)

    def normal(self):
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        return Vector((s, -c, 0.0))


# Raven silhouettes in a unit box (u right, v up) for signs, brands, banners.
RAVEN_PROFILE = [(-0.50, 0.20), (-0.30, 0.26), (-0.20, 0.34), (-0.08, 0.34), (0.02, 0.26),
                 (0.12, 0.16), (0.30, 0.06), (0.50, -0.08), (0.46, -0.16), (0.22, -0.12),
                 (0.10, -0.22), (0.04, -0.24), (0.04, -0.46), (-0.10, -0.48), (-0.02, -0.42),
                 (-0.02, -0.26), (-0.16, -0.18), (-0.26, -0.02), (-0.28, 0.12), (-0.34, 0.16)]
RAVEN_SPREAD = [(0.00, -0.48), (0.09, -0.40), (0.17, -0.46), (0.13, -0.22), (0.20, -0.08),
                (0.36, -0.10), (0.33, 0.00), (0.47, 0.04), (0.40, 0.12), (0.52, 0.20),
                (0.42, 0.26), (0.50, 0.40), (0.26, 0.30), (0.12, 0.12), (0.08, 0.20),
                (0.08, 0.30), (0.02, 0.36), (-0.06, 0.34), (-0.20, 0.30), (-0.07, 0.25),
                (-0.06, 0.14), (-0.12, 0.12), (-0.26, 0.30), (-0.50, 0.40), (-0.42, 0.26),
                (-0.52, 0.20), (-0.40, 0.12), (-0.47, 0.04), (-0.33, 0.00), (-0.36, -0.10),
                (-0.20, -0.08), (-0.13, -0.22), (-0.17, -0.46), (-0.09, -0.40)]


def emblem(b, F, shape, u, v, size, w0=0.0, depth=0.012, color='black', mat='base',
           mirror=False):
    """Extruded silhouette (e.g. RAVEN_PROFILE) on a Frame's surface."""
    pts = [((-x if mirror else x) * size + u, y * size + v) for (x, y) in shape]
    return ngon_prism(b, pts, depth, frame=F, w0=w0, color=color, mat=mat, var=0.03)


# ---------------------------------------------------------------------------
# Shared set pieces (used by buildings and props)
# ---------------------------------------------------------------------------
# Elder futhark glyphs in a unit box (u in [-0.5, 0.5], v in [0, 1])
GLYPHS = {
    'kenaz': [((0.3, 1.0), (-0.3, 0.5)), ((-0.3, 0.5), (0.3, 0.0))],
    'sowilo': [((0.25, 1.0), (-0.25, 0.62)), ((-0.25, 0.62), (0.25, 0.38)), ((0.25, 0.38), (-0.25, 0.0))],
    'algiz': [((0.0, 0.0), (0.0, 1.0)), ((0.0, 0.55), (-0.35, 0.95)), ((0.0, 0.55), (0.35, 0.95))],
    'ingwaz': [((0.0, 0.0), (0.35, 0.5)), ((0.35, 0.5), (0.0, 1.0)), ((0.0, 1.0), (-0.35, 0.5)),
               ((-0.35, 0.5), (0.0, 0.0))],
    'dagaz': [((-0.4, 0.0), (-0.4, 1.0)), ((0.4, 0.0), (0.4, 1.0)), ((-0.4, 0.0), (0.4, 1.0)),
              ((-0.4, 1.0), (0.4, 0.0))],
    'fehu': [((-0.25, 0.0), (-0.25, 1.0)), ((-0.25, 0.55), (0.3, 0.85)), ((-0.25, 0.3), (0.3, 0.6))],
    'tiwaz': [((0.0, 0.0), (0.0, 1.0)), ((0.0, 1.0), (-0.35, 0.65)), ((0.0, 1.0), (0.35, 0.65))],
    'ansuz': [((-0.25, 0.0), (-0.25, 1.0)), ((-0.25, 1.0), (0.3, 0.7)), ((-0.25, 0.7), (0.3, 0.4))],
    'othala': [((-0.35, 0.0), (0.3, 0.55)), ((0.35, 0.0), (-0.3, 0.55)), ((0.3, 0.55), (0.0, 1.0)),
               ((-0.3, 0.55), (0.0, 1.0))],
    'raido': [((-0.25, 0.0), (-0.25, 1.0)), ((-0.25, 1.0), (0.25, 0.78)), ((0.25, 0.78), (-0.25, 0.55)),
              ((-0.25, 0.55), (0.28, 0.0))],
    'laguz': [((-0.2, 0.0), (-0.2, 1.0)), ((-0.2, 1.0), (0.25, 0.72))],
}


def anvil_on_stump(b, x, y, rot=0.0, s=1.0):
    """Stump + iron anvil (horn toward +X rotated by rot deg)."""
    b.cyl(0.25 * s, 0.27 * s, h=0.42 * s, seg=7, loc=(x, y, -0.02), color='bark',
          jitter=0.01)
    b.cyl(0.235 * s, h=0.02, seg=7, loc=(x, y, 0.4 * s), color='wood_light')
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)
    z = 0.42 * s

    def P2(dx, dy, dz):
        return (x + dx * ca - dy * sa, y + dx * sa + dy * ca, z + dz)

    b.box((0.3 * s, 0.2 * s, 0.06 * s), loc=P2(0, 0, 0.03 * s), rot=(0, 0, rot), color=IRON, mat='metal')
    b.box((0.16 * s, 0.12 * s, 0.1 * s), loc=P2(0, 0, 0.11 * s), rot=(0, 0, rot), color=IRON, mat='metal')
    b.box((0.4 * s, 0.17 * s, 0.1 * s), loc=P2(-0.03 * s, 0, 0.21 * s), rot=(0, 0, rot), color='iron', mat='metal', bevel=0.01)
    sweep(b, [P2(0.17 * s, 0, 0.225 * s), P2(0.32 * s, 0, 0.21 * s), P2(0.4 * s, 0, 0.2 * s)],
          [0.065 * s, 0.035 * s, 0.0], seg=5, color='iron', mat='metal', up=(0, 0, 1))


def coal_pile(b, x, y, r=0.3, n=9):
    for _ in range(n):
        a = b.rng.uniform(0, 2 * math.pi)
        d = r * math.sqrt(b.rng.random())
        h = (1 - d / r) * 0.12
        b.ico(r=b.rng.uniform(0.06, 0.1), sub=0,
              loc=(x + math.cos(a) * d, y + math.sin(a) * d, 0.05 + h),
              color=mix('coal', 'stone_dark', b.rng.uniform(0.3, 0.7)), jitter=0.015, var=0.1)


def goat_skull(b, loc, s=1.0, facing=(0, -1, 0)):
    """Goat skull with curled horns (bone + dark horn), facing `facing`."""
    F = Vector(facing).normalized()
    S_ = F.cross(Vector((0, 0, 1))).normalized()
    o = Vector(loc)

    def p(f, u, sd):
        return o + F * (f * s) + Vector((0, 0, u * s)) + S_ * (sd * s)

    sweep(b, [p(-0.08, 0.02, 0), p(0.04, 0.0, 0), p(0.16, -0.08, 0), p(0.22, -0.13, 0)],
          [0.1 * s, 0.1 * s, 0.065 * s, 0.035 * s], seg=6, color='bone', sx=0.9, up=(0, 0, 1))
    for sd in (-1, 1):
        b.ico(r=0.03 * s, sub=0, loc=p(0.08, 0.01, sd * 0.07), color='soil_wet')
        pts = [p(-0.02, 0.06, sd * 0.05), p(-0.1, 0.16, sd * 0.12), p(-0.2, 0.14, sd * 0.2),
               p(-0.22, 0.02, sd * 0.24), p(-0.14, -0.06, sd * 0.25), p(-0.07, -0.02, sd * 0.24)]
        sweep(b, pts, [0.05 * s, 0.045 * s, 0.038 * s, 0.03 * s, 0.022 * s, 0.0], seg=5,
              color=mix('wood_dark', 'bone_dark', 0.35), up=(0, 0, 1))


def herb_bundle(b, top, length=0.3, color='leaf'):
    x, y, z = top
    b.box((0.012, 0.012, 0.12), loc=(x, y, z - 0.06), color='rope', var=0.03)
    b.cyl(0.02, h=0.04, seg=4, loc=(x, y, z - 0.16), color='rope')
    c = tone(color, b.rng.uniform(0.85, 1.1))
    b.cyl(0.03, 0.1, h=length, seg=5, loc=(x, y, z - 0.14), rot=(180, 0, b.rng.uniform(0, 60)),
          color=c, jitter=0.012)


def bottle(b, loc, h=0.2, r=0.05, color='green', seg=5):
    x, y, z = loc
    b.lathe([(r * 0.85, 0), (r, h * 0.55), (r * 0.35, h * 0.8), (r * 0.3, h)], seg=seg,
            loc=(x, y, z), color=color, mat='metal', var=0.05)
    b.box((r * 0.55, r * 0.55, h * 0.14), loc=(x, y, z + h + h * 0.05), color='wood_light')


def rune_strokes(b, F, strokes, u0, v0, size, w, color=RUNE_FAINT, width=0.035, depth=0.02):
    """Draw glyph strokes [((u, v), (u, v)), ...] in a unit box onto a Frame."""
    for (a, c) in strokes:
        pa = F.p(u0 + a[0] * size, v0 + a[1] * size, w + depth / 2)
        pc = F.p(u0 + c[0] * size, v0 + c[1] * size, w + depth / 2)
        d = (pc - pa)
        if d.length < 1e-6:
            continue
        ext = d.normalized() * width * 0.5
        beam(b, pa - ext, pc + ext, width, depth, color=color, mat='emit', up=F.W, var=0.03)


def rune_line(b, F, u0, u1, v, h, w, rng, color=RUNE_FAINT, width=0.028):
    """A row of random runes between u0 and u1 (glyph height h)."""
    names = list(GLYPHS)
    u = u0 + h * 0.3
    while u < u1 - h * 0.3:
        g = GLYPHS[rng.choice(names)]
        rune_strokes(b, F, g, u, v, h, w, color=color, width=width)
        u += h * 0.8


def moss_ring(b, x, y, r, n=6, z=0.0):
    for i in range(n):
        a = 2 * math.pi * (i + b.rng.random() * 0.5) / n
        b.ico(r=b.rng.uniform(0.1, 0.16), sub=0, loc=(x + math.cos(a) * r, y + math.sin(a) * r, z + 0.03),
              scale=(1.3, 1.3, 0.45), color=tone(b.rng.choice(('moss', 'grass', 'turf')), 0.95), var=0.08)


def stag_skull(b, loc, s=1.0):
    """Antlered stag skull facing -Y."""
    x, y, z = loc
    b.ico(r=0.16 * s, sub=1, loc=(x, y + 0.02 * s, z + 0.12 * s), scale=(1.0, 1.2, 0.85), color='bone', jitter=0.01)
    sweep(b, [(x, y - 0.08 * s, z + 0.12 * s), (x, y - 0.26 * s, z + 0.07 * s), (x, y - 0.42 * s, z + 0.02 * s)],
          [0.1 * s, 0.07 * s, 0.04 * s], seg=6, color='bone', sx=0.9, up=(0, 0, 1))
    for sx in (-1, 1):
        b.ico(r=0.045 * s, sub=0, loc=(x + sx * 0.085 * s, y - 0.1 * s, z + 0.15 * s), color='soil_wet')
        beam_pts = [(x + sx * 0.08 * s, y + 0.06 * s, z + 0.22 * s), (x + sx * 0.28 * s, y + 0.1 * s, z + 0.42 * s),
                    (x + sx * 0.42 * s, y + 0.04 * s, z + 0.66 * s), (x + sx * 0.5 * s, y - 0.06 * s, z + 0.88 * s),
                    (x + sx * 0.48 * s, y - 0.1 * s, z + 1.02 * s)]
        sweep(b, beam_pts, [0.04 * s, 0.035 * s, 0.03 * s, 0.022 * s, 0.0], seg=5, color='bone_dark', up=(0, -1, 0))
        for (i, d, ln) in ((1, (0.0, -0.3, 0.25), 0.22), (2, (0.15, -0.2, 0.25), 0.2), (3, (0.2, 0.05, 0.15), 0.14)):
            p = Vector(beam_pts[i])
            q = p + Vector((sx * d[0], d[1], d[2])).normalized() * ln * s
            sweep(b, [p, q], [0.025 * s, 0.0], seg=4, color='bone_dark')


def candle(b, x, y, z, h, r=0.035):
    b.cyl(r, h=h, seg=5, loc=(x, y, z), color=b.rng.choice(('bone', 'linen', 'wool')), var=0.05)
    b.box((r * 0.8, r * 0.5, h * 0.4), loc=(x + r * 0.7, y, z + h * 0.7), color='bone', var=0.03)
    flame(b, (x, y, z + h), h=0.09, r=0.022, seg=4, color=FLAME_HOT)


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------
_SUFFIX = re.compile(r'\.\d{3}$')


def fix_glb_names(path):
    """Strip Blender's '.001' duplicate suffixes from node and mesh names.

    Blender forces unique object names, so the second 'door' socket becomes
    'door.001'.  The game looks sockets up by their exact name (three.js
    keeps the original glTF name in userData.name), so rewrite the names."""
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, version, _ = struct.unpack('<III', data[:12])
    jlen, jtype = struct.unpack('<II', data[12:20])
    j = json.loads(data[20:20 + jlen].decode('utf-8'))
    rest = data[20 + jlen:]
    changed = 0
    for key in ('nodes', 'meshes'):
        for item in j.get(key, []):
            name = item.get('name')
            if name and _SUFFIX.search(name):
                item['name'] = _SUFFIX.sub('', name)
                changed += 1
    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', magic, version, total))
        fh.write(struct.pack('<II', len(js), jtype))
        fh.write(js)
        fh.write(rest)
    return changed
