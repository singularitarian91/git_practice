"""items_kit - extra modelling helpers used by build_items.py (items.glb).

Built on top of ghlib.Builder (which stays untouched):

* Part          - capture the verts made inside a `with` block so a group of
                  primitives can be moved / rotated / mirrored afterwards.
* loft          - skin a list of cross-section rings (tubes, bodies, roots).
* Body          - fish-like body along +X from a side profile, with a
                  surface lookup so decals (eyes, spots, stripes) sit
                  exactly on the flat-shaded facets.
* flat / poly   - flat shapes (fins, wings, leaves, decals).  `flat` makes
                  both sides (game materials are single-sided).
* paint         - recolour faces (optionally by a function of the face).
* Builder       - ghlib.Builder applying jitter / colour variation in a
                  geometry-defined order; with `canonicalize` (run by
                  `finish`) rebuilds are byte-identical.
* finish        - build the object with its origin at the bottom centre
                  (or a given point) and leave it at the world origin.
"""
import math

import bpy  # noqa: F401  (bpy must be imported before bmesh / mathutils)
import bmesh
from mathutils import Euler, Matrix, Vector

import ghlib as G
from ghlib import MAT_INDEX, col, srgb_to_linear

V = Vector
TAU = 2.0 * math.pi
DEG = math.pi / 180.0


# ---------------------------------------------------------------------------
# small math helpers
# ---------------------------------------------------------------------------
def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return a if x < a else (b if x > b else x)


def rotm(rot):
    return Euler(tuple(a * DEG for a in rot), 'XYZ').to_matrix().to_4x4()


def xform_matrix(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, pivot=(0, 0, 0)):
    """Scale + rotate about `pivot`, then translate by `loc`."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    S = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    pv = V(pivot)
    return Matrix.Translation(V(loc) + pv) @ rotm(rot) @ S @ Matrix.Translation(-pv)


def newell_normal(pts):
    n = V((0, 0, 0))
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    if n.length < 1e-12:
        return V((0, 0, 1))
    return n.normalized()


def frame_from(t, up=(0, 0, 1)):
    """Right-handed (u, v, t) frame for travel direction t with v ~ up."""
    t = V(t).normalized()
    up = V(up)
    v = up - t * up.dot(t)
    if v.length < 1e-6:
        v = V((1, 0, 0)) - t * t.x
    v.normalize()
    u = v.cross(t)
    return u, v, t


# ---------------------------------------------------------------------------
# 2D outlines
# ---------------------------------------------------------------------------
def circle2d(r, n, cx=0.0, cy=0.0, start=0.0, ry=None):
    ry = r if ry is None else ry
    return [(cx + r * math.cos(start + TAU * i / n), cy + ry * math.sin(start + TAU * i / n))
            for i in range(n)]


def star2d(r_out, r_in, points, start=90.0, cx=0.0, cy=0.0):
    out = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = (start + 180.0 * i / points) * DEG
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def leaf2d(length, width, n=4, tip=1.0, base=0.0, skew=0.0):
    """Leaf outline along +x from (0,0) to (length,0); CCW.  n = points per side."""
    upper, lower = [], []
    for i in range(1, n + 1):
        t = i / (n + 1)
        w = width * 0.5 * math.sin(math.pi * t ** 0.85) ** tip
        w = max(w, base * width * (1 - t))
        x = length * t
        upper.append((x, w * (1 + skew)))
        lower.append((x, -w * (1 - skew)))
    return [(0.0, 0.0)] + lower + [(length, 0.0)] + list(reversed(upper))


def to3d(pts2d, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 1, 0), bend=None):
    """Map 2D points into the plane origin + x*u + y*v (+ optional bend(x,y)*n)."""
    o, u, v = V(origin), V(u), V(v)
    n = u.cross(v)
    out = []
    for (x, y) in pts2d:
        p = o + u * x + v * y
        if bend is not None:
            p += n * bend(x, y)
        out.append(p)
    return out


# ---------------------------------------------------------------------------
# Deterministic builder
# ---------------------------------------------------------------------------
def _vkey(v):
    c = v.co
    return (round(c.x, 7), round(c.y, 7), round(c.z, 7))


def _fkey(f):
    c = f.calc_center_median()
    return (round(c.x, 7), round(c.y, 7), round(c.z, 7), len(f.verts),
            tuple(sorted(_vkey(v) for v in f.verts)))


def ordered_faces(faces):
    """Faces in a stable, geometry-based order (sets of BMFace iterate by address)."""
    return sorted(faces, key=_fkey)


class Builder(G.Builder):
    """ghlib.Builder whose per-vertex jitter and per-face colour variation are applied
    in a geometry-based order, so rebuilding produces byte-identical files."""

    def _finish(self, verts, color, mat, jitter, var, smooth=False):
        verts = sorted(dict.fromkeys(verts), key=_vkey)
        faces = set()
        for v in verts:
            faces.update(v.link_faces)
        faces = ordered_faces(faces)
        if jitter:
            for v in verts:
                v.co += Vector((self.rng.uniform(-jitter, jitter),
                                self.rng.uniform(-jitter, jitter),
                                self.rng.uniform(-jitter, jitter)))
        base = col(color)
        for f in faces:
            k = 1.0 + self.rng.uniform(-var, var)
            tint = [self.rng.uniform(-var * 0.35, var * 0.35) for _ in range(3)]
            c = tuple(min(1.0, max(0.0, base[i] * k + tint[i] * base[i])) for i in range(3))
            lin = tuple(srgb_to_linear(x) for x in c) + (1.0,)
            for loop in f.loops:
                loop[self.col_layer] = lin
            f.material_index = MAT_INDEX[mat]
            f.smooth = smooth
        return faces


# ---------------------------------------------------------------------------
# Part: capture + transform groups of geometry
# ---------------------------------------------------------------------------
class Part:
    def __init__(self, b, verts=None):
        self.b = b
        self.verts = list(verts or [])

    def __enter__(self):
        self._before = set(self.b.bm.verts)
        return self

    def __exit__(self, *exc):
        self.verts = [v for v in self.b.bm.verts if v not in self._before]
        del self._before
        return False

    @property
    def faces(self):
        fs = set()
        for v in self.verts:
            fs.update(v.link_faces)
        for f in fs:
            f.normal_update()
        return ordered_faces(fs)

    def transform(self, M):
        bmesh.ops.transform(self.b.bm, matrix=M, verts=self.verts)
        if M.to_3x3().determinant() < 0:
            bmesh.ops.reverse_faces(self.b.bm, faces=self.faces)
        return self

    def xf(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, pivot=(0, 0, 0)):
        return self.transform(xform_matrix(loc, rot, scale, pivot))

    def copy(self):
        faces = self.faces
        edges = set()
        for f in faces:
            edges.update(f.edges)
        res = bmesh.ops.duplicate(self.b.bm, geom=list(self.verts) + list(edges) + faces)
        return Part(self.b, [e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)])

    def mirrored(self, axis=0, at=0.0):
        """Duplicate mirrored across the plane <axis> = at."""
        p = self.copy()
        s = [1.0, 1.0, 1.0]
        s[axis] = -1.0
        off = [0.0, 0.0, 0.0]
        off[axis] = at
        M = Matrix.Translation(V(off)) @ Matrix.Diagonal((*s, 1.0)) @ Matrix.Translation(-V(off))
        return p.transform(M)


def bbox_of(verts):
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    return V((min(xs), min(ys), min(zs))), V((max(xs), max(ys), max(zs)))


def all_part(b):
    return Part(b, list(b.bm.verts))


# ---------------------------------------------------------------------------
# colour
# ---------------------------------------------------------------------------
def shade(b, rgb, var=0.06):
    k = 1.0 + b.rng.uniform(-var, var)
    tint = [b.rng.uniform(-var * 0.35, var * 0.35) for _ in range(3)]
    c = tuple(min(1.0, max(0.0, rgb[i] * k + tint[i] * rgb[i])) for i in range(3))
    return tuple(srgb_to_linear(x) for x in c) + (1.0,)


def paint(b, faces, color, var=0.06, mat=None, where=None):
    """Recolour faces.  `color` is a palette key / rgb or fn(face) -> key/rgb/None.
    fn may also return (color, mat)."""
    faces = ordered_faces(faces)
    for f in faces:
        f.normal_update()
    for f in faces:
        if where is not None and not where(f):
            continue
        c = color(f) if callable(color) else color
        m = mat
        if isinstance(c, tuple) and len(c) == 2 and isinstance(c[1], str):
            c, m = c
        if c is None:
            continue
        lin = shade(b, col(c), var)
        for loop in f.loops:
            loop[b.col_layer] = lin
        if m:
            f.material_index = MAT_INDEX[m]


# ---------------------------------------------------------------------------
# geometry builders
# ---------------------------------------------------------------------------
def ring(center, u, v, ru, rv, n, start=0.0, wob=None):
    """Points c + u*ru*cos(a) + v*rv*sin(a); CCW around u x v."""
    c, u, v = V(center), V(u), V(v)
    if ru <= 1e-7 and rv <= 1e-7:
        return [c]
    out = []
    for i in range(n):
        a = start + TAU * i / n
        k = 1.0 if wob is None else wob(i, a)
        out.append(c + u * (ru * k * math.cos(a)) + v * (rv * k * math.sin(a)))
    return out


def loft(b, rings, color='wood', mat='base', jitter=0.0, var=0.06, smooth=False,
         cap_start=True, cap_end=True):
    """Skin rings (lists of points, same count, or a single point for a tip).
    Rings must wind CCW around the travel direction (as `ring` does)."""
    bm = b.bm
    vr = []
    allv = []
    for r in rings:
        vs = [bm.verts.new(V(p)) for p in r]
        vr.append(vs)
        allv += vs
    n = max(len(r) for r in vr)
    for k in range(len(vr) - 1):
        a, c = vr[k], vr[k + 1]
        if len(a) == 1 and len(c) == 1:
            continue
        for i in range(n):
            j = (i + 1) % n
            if len(a) == 1:
                bm.faces.new((a[0], c[i], c[j]))
            elif len(c) == 1:
                bm.faces.new((a[i], a[j], c[0]))
            else:
                bm.faces.new((a[i], a[j], c[j], c[i]))
    if cap_start and len(vr[0]) > 2:
        bm.faces.new(list(reversed(vr[0])))
    if cap_end and len(vr[-1]) > 2:
        bm.faces.new(vr[-1])
    return b._finish(allv, color, mat, jitter, var, smooth)


def tube_path(b, pts, rad, n=6, up=(0, 0, 1), color='wood', mat='base', jitter=0.0,
              var=0.06, smooth=False, cap_start=True, cap_end=True, flat=1.0, start=None):
    """Continuous tube through `pts` (shared rings, so bends stay closed).
    rad: number or list (0 -> pointed tip).  flat scales the `up` radius."""
    pts = [V(p) for p in pts]
    if isinstance(rad, (int, float)):
        rad = [rad] * len(pts)
    rings = []
    m = len(pts)
    st = (math.pi / n) if start is None else start
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == m - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        u, v, t = frame_from(t, up)
        rings.append(ring(p, u, v, rad[i], rad[i] * flat, n, start=st))
    return loft(b, rings, color=color, mat=mat, jitter=jitter, var=var, smooth=smooth,
                cap_start=cap_start, cap_end=cap_end)


def poly(b, pts, color='wood', mat='base', var=0.06, offset=0.0, facing=None):
    """Single-sided polygon (CCW = front), optionally pushed along its normal.
    `facing`: flip the winding if needed so the front faces that direction."""
    pts = [V(p) for p in pts]
    n = newell_normal(pts)
    if facing is not None and n.dot(V(facing)) < 0:
        pts.reverse()
        n = -n
    vs = [b.bm.verts.new(p + n * offset) for p in pts]
    b.bm.faces.new(vs)
    return b._finish(vs, color, mat, 0.0, var)


def flat(b, pts, color='wood', mat='base', var=0.06, back=None, back_mat=None, gap=0.0008,
         facing=None):
    """Double-sided flat polygon.  Front = CCW side; back face sits `gap` behind.
    `facing`: orient so the front (`color`) side faces that direction."""
    pts = [V(p) for p in pts]
    n = newell_normal(pts)
    if facing is not None and n.dot(V(facing)) < 0:
        pts.reverse()
        n = -n
    f1 = poly(b, [p + n * (gap * 0.5) for p in pts], color, mat, var)
    f2 = poly(b, [p - n * (gap * 0.5) for p in reversed(pts)],
              back if back is not None else color, back_mat or mat, var)
    return f1 + f2


def slab(b, pts, thick, color='wood', mat='base', var=0.06, side=None, jitter=0.0):
    """Planar outline extruded symmetrically along its normal (both faces + rim)."""
    pts = [V(p) for p in pts]
    n = newell_normal(pts)
    top = [b.bm.verts.new(p + n * thick * 0.5) for p in pts]
    bot = [b.bm.verts.new(p - n * thick * 0.5) for p in pts]
    k = len(pts)
    b.bm.faces.new(top)
    b.bm.faces.new(list(reversed(bot)))
    rim = []
    for i in range(k):
        j = (i + 1) % k
        rim.append(b.bm.faces.new((bot[i], bot[j], top[j], top[i])))
    faces = b._finish(top + bot, color, mat, jitter, var)
    if side is not None:
        paint(b, rim, side, var)
    return faces


def leaf3d(b, base, d, s, length, width, n=4, curl=0.0, twist=0.0, color='leaf', back=None,
           mat='base', var=0.07, outline=None, midrib=None):
    """Flat double-sided leaf from `base` along unit dir d, width along s.
    curl bends it along d x s (negative = droops).  `outline` overrides leaf2d."""
    d, s = V(d).normalized(), V(s).normalized()
    nrm = d.cross(s)
    pts2 = outline if outline is not None else leaf2d(length, width, n)
    pts = []
    for (x, y) in pts2:
        t = x / max(1e-6, length)
        p = V(base) + d * x + s * y + nrm * (curl * t * t * length + twist * y * t)
        pts.append(p)
    faces = flat(b, pts, color=color, mat=mat, var=var, back=back)
    if midrib is not None:
        rib = []
        for (x, y) in ((0.0, 0.0012 * 4), (length * 0.85, 0.0), (0.0, -0.0012 * 4)):
            t = x / max(1e-6, length)
            rib.append(V(base) + d * x + s * y + nrm * (curl * t * t * length + 0.0012))
        faces += poly(b, rib, midrib, mat, 0.04, facing=nrm)
    return faces


def frond2d(length, width, lobes=4):
    """Pinnate (feathery) outline along +x, CCW."""
    upper, lower = [], []
    for i in range(lobes):
        t0 = (i + 0.35) / (lobes + 0.4)
        t1 = (i + 0.9) / (lobes + 0.4)
        w = width * 0.5 * (1.0 - 0.55 * t0)
        upper += [(length * t0, width * 0.08), (length * t1, w)]
        lower += [(length * t0, -width * 0.08), (length * t1, -w)]
    return [(0.0, 0.0)] + lower + [(length, 0.0)] + list(reversed(upper))


def bumpy_ico(b, r, loc, color, bump=0.14, scale=(1, 1, 1), var=0.1, smooth=False, mat='base',
              sub=2):
    """Icosphere whose 5-valent verts are pushed out: drupelet-like berries."""
    with Part(b) as p:
        b.ico(r=r, sub=sub, loc=loc, scale=scale, color=color, var=var, smooth=smooth, mat=mat)
    c = V(loc)
    for v in p.verts:
        k = (1.0 + bump) if len(v.link_edges) == 5 else (1.0 - bump * 0.25)
        v.co = c + (v.co - c) * k
    return p


# ---------------------------------------------------------------------------
# Body: profile-driven loft along +X with an exact surface lookup
# ---------------------------------------------------------------------------
class Body:
    """Sections (x, zc, h, w): centre height, half-height, half-width at x.
    Ring angle a: 0 = +Y side, 90 = top (dorsal), 180 = -Y side, 270 = belly.
    A section with h = w = 0 is a pointed tip."""

    def __init__(self, sections, n=8, start=0.0):
        self.s = [tuple(float(q) for q in s) for s in sections]
        self.n = n
        self.start = start

    # analytic ring vertex (on the mesh)
    def vert(self, k, i):
        x, zc, h, w = self.s[k]
        a = self.start + TAU * i / self.n
        return V((x, w * math.cos(a), zc + h * math.sin(a)))

    def build(self, b, color='stone', mat='base', var=0.06, smooth=False, jitter=0.0):
        rings = []
        for k, (x, zc, h, w) in enumerate(self.s):
            if h <= 1e-7 and w <= 1e-7:
                rings.append([V((x, 0.0, zc))])
            else:
                rings.append([self.vert(k, i) for i in range(self.n)])
        return loft(b, rings, color, mat, jitter, var, smooth)

    def params(self, x):
        """Interpolated (zc, h, w) at x."""
        s = self.s
        if x <= s[0][0]:
            return s[0][1:]
        for k in range(len(s) - 1):
            if s[k][0] <= x <= s[k + 1][0]:
                t = (x - s[k][0]) / max(1e-9, s[k + 1][0] - s[k][0])
                return tuple(lerp(s[k][q], s[k + 1][q], t) for q in (1, 2, 3))
        return s[-1][1:]

    def surf(self, x, a_deg):
        """Point + normal on the flat-shaded mesh surface at (x, angle)."""
        s = self.s
        x = clamp(x, s[0][0], s[-1][0])
        k = 0
        while k < len(s) - 2 and x > s[k + 1][0]:
            k += 1
        t = (x - s[k][0]) / max(1e-9, s[k + 1][0] - s[k][0])
        a = (a_deg * DEG - self.start) % TAU
        seg = TAU / self.n
        i = int(a // seg) % self.n
        u = (a - i * seg) / seg
        j = (i + 1) % self.n

        def rv(kk, ii):
            x0, zc, h, w = s[kk]
            if h <= 1e-7 and w <= 1e-7:
                return V((x0, 0.0, zc))
            return self.vert(kk, ii)

        p00, p01 = rv(k, i), rv(k, j)
        p10, p11 = rv(k + 1, i), rv(k + 1, j)
        p0 = p00.lerp(p01, u)
        p1 = p10.lerp(p11, u)
        p = p0.lerp(p1, t)
        n = (p10 - p00 + p11 - p01).cross(p01 - p00 + p11 - p10)
        if n.length < 1e-9:
            n = V((0, math.cos(a), math.sin(a)))
        n.normalize()
        # make sure it points outward
        zc, h, w = self.params(x)
        out = V((0, p.y, p.z - zc))
        if out.length > 1e-9 and n.dot(out) < 0:
            n = -n
        return p, n

    def decal(self, b, pts, color, mat='base', var=0.04, lift=0.0018):
        """Polygon from (x, angle_deg) pairs projected onto the surface.  If the
        polygon would dip under a facet ridge it is raised just enough."""
        out = []
        ns = V((0, 0, 0))
        for (x, a) in pts:
            p, n = self.surf(x, a)
            out.append(p + n * lift)
            ns += n
        # orient CCW as seen from outside
        if newell_normal(out).dot(ns) < 0:
            out.reverse()
        # raise if the centre of the surface pokes through the flat polygon
        xm = sum(q[0] for q in pts) / len(pts)
        am = sum(q[1] for q in pts) / len(pts)
        pc, nc = self.surf(xm, am)
        cen = sum(out, V((0, 0, 0))) / len(out)
        nrm = newell_normal(out)
        d = (pc + nc * lift - cen).dot(nrm)
        if d > 0:
            out = [q + nrm * d for q in out]
        vs = [b.bm.verts.new(p) for p in out]
        b.bm.faces.new(vs)
        return b._finish(vs, color, mat, 0.0, var)

    def _splits(self, p0, p1):
        """Parameters in (0,1) where segment p0->p1 crosses a facet boundary."""
        (x0, a0), (x1, a1) = p0, p1
        ts = set()
        seg = 360.0 / self.n
        st = self.start / DEG
        if abs(a1 - a0) > 1e-6:
            lo, hi = sorted((a0, a1))
            k = math.floor((lo - st) / seg) + 1
            while st + k * seg < hi:
                ts.add((st + k * seg - a0) / (a1 - a0))
                k += 1
        if abs(x1 - x0) > 1e-9:
            lo, hi = sorted((x0, x1))
            for sec in self.s:
                if lo < sec[0] < hi:
                    ts.add((sec[0] - x0) / (x1 - x0))
        return sorted(t for t in ts if 1e-4 < t < 1 - 1e-4)

    def spot(self, b, x, a, rx, ra, color, n=6, mat='base', lift=0.0018, rot=0.0):
        pts = []
        for i in range(n):
            t = TAU * i / n + rot
            pts.append((x + rx * math.cos(t), a + ra * math.sin(t)))
        return self.decal(b, pts, color, mat, lift=lift)

    def round_spot(self, b, x, a, r, color, n=6, mat='base', lift=0.0018, rot=0.0, sx=1.0):
        return self.spot(b, x, a, r * sx, r * self.deg_per_m(x, a), color, n, mat, lift, rot)

    def ribbon(self, b, left, right, color, mat='base', var=0.04, lift=0.0018):
        """Strip of decal quads between two (x, angle) polylines of equal length,
        split wherever the strip crosses a facet boundary so it never sinks."""
        faces = []
        for i in range(len(left) - 1):
            mid0 = ((left[i][0] + right[i][0]) * 0.5, (left[i][1] + right[i][1]) * 0.5)
            mid1 = ((left[i + 1][0] + right[i + 1][0]) * 0.5,
                    (left[i + 1][1] + right[i + 1][1]) * 0.5)
            ts = set(self._splits(mid0, mid1))
            ts.update(self._splits(left[i], left[i + 1]))
            ts.update(self._splits(right[i], right[i + 1]))
            ts = [0.0] + sorted(t for t in ts if 1e-4 < t < 1 - 1e-4) + [1.0]

            def lp(P, Q, t):
                return (lerp(P[0], Q[0], t), lerp(P[1], Q[1], t))
            for k in range(len(ts) - 1):
                t0, t1 = ts[k], ts[k + 1]
                q = [lp(left[i], left[i + 1], t0), lp(right[i], right[i + 1], t0),
                     lp(right[i], right[i + 1], t1), lp(left[i], left[i + 1], t1)]
                faces += self.decal(b, q, color, mat, var, lift)
        return faces

    def band(self, b, x0, x1, a0, a1, color, mat='base', lift=0.0018, steps=None):
        """Decal strip covering x0..x1 at angles a0..a1 (one quad per angle step)."""
        steps = steps or max(1, int(abs(a1 - a0) / (360.0 / self.n) + 0.999))
        left = [(x0, a0 + (a1 - a0) * i / steps) for i in range(steps + 1)]
        right = [(x1, a0 + (a1 - a0) * i / steps) for i in range(steps + 1)]
        return self.ribbon(b, left, right, color, mat, lift=lift)

    def deg_per_m(self, x, a):
        """Angular degrees per metre of surface at (x, a) - to make round decals."""
        zc, h, w = self.params(x)
        ar = a * DEG
        m = math.hypot(w * math.sin(ar), h * math.cos(ar))
        return 57.2958 / max(1e-4, m)

    def eye(self, b, x, a, r, iris, pupil, pupil_k=0.55, n=6, mat='base', pupil_mat='base',
            lift=0.0018, look=0.0):
        """Round eye decal (iris ring + pupil) centred at (x, a), radius r metres."""
        k = self.deg_per_m(x, a)
        f = self.spot(b, x, a, r, r * k, iris, n=n, mat=mat, lift=lift)
        f += self.spot(b, x + look * r * 0.3, a, r * pupil_k, r * pupil_k * k, pupil, n=n,
                       mat=pupil_mat, lift=lift * 2.0)
        return f


# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------
def canonicalize(b):
    """Put the bmesh in a geometry-defined order so rebuilds are byte-identical:
    merge doubles, sort verts, start every face at its lowest vertex, sort faces."""
    bm = b.bm
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    vr = {v: i for i, v in enumerate(sorted(bm.verts, key=_vkey))}
    bm.verts.sort(key=lambda v: vr[v])
    bm.verts.index_update()
    lay = b.col_layer
    for f in list(bm.faces):
        loops = list(f.loops)
        k = min(range(len(loops)), key=lambda i: loops[i].vert.index)
        if k == 0:
            continue
        vs = [lp.vert for lp in loops]
        cols = [tuple(lp[lay]) for lp in loops]
        mat, sm = f.material_index, f.smooth
        vs = vs[k:] + vs[:k]
        cols = cols[k:] + cols[:k]
        bm.faces.remove(f)
        nf = bm.faces.new(vs)
        for lp, c in zip(nf.loops, cols):
            lp[lay] = c
        nf.material_index = mat
        nf.smooth = sm
    for f in bm.faces:
        f.normal_update()
    fr = {f: i for i, f in enumerate(sorted(bm.faces, key=_fkey))}
    bm.faces.sort(key=lambda f: fr[f])


def finish(b, name, origin='bottom', ao=0.2, ao_floor=None):
    """Build the object; origin at the bottom centre (or explicit point);
    the object is left at the world origin."""
    canonicalize(b)
    lo, hi = bbox_of(b.bm.verts)
    if origin == 'bottom':
        o = ((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, lo.z)
    else:
        o = tuple(origin)
    ob = b.build(name, origin=o, ao=ao, ao_floor=ao_floor)
    ob.location = (0.0, 0.0, 0.0)
    return ob


def rot_all(b, rot=(0, 0, 0), pivot=(0, 0, 0), loc=(0, 0, 0), scale=1.0):
    all_part(b).xf(loc=loc, rot=rot, pivot=pivot, scale=scale)

