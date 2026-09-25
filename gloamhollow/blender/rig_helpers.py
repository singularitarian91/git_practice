"""
rig_helpers - shared modelling helpers for Gloamhollow's animated models
(characters.glb and enemies.glb).  Built on top of ghlib (which is left
untouched); everything here works on a ghlib.Builder in model space.

Main pieces
-----------
* lathe()   - revolve a profile (correct winding also for r == 0 poles;
              ghlib.Builder.lathe flips the triangles of a bottom pole).
* loft()    - closed surface through stacked elliptical rings (torsos, robes).
* shell()   - open curved panel on top of a loft (aprons, lapels, capes,
              hoods, stripes); Prof interpolates the rings for details.
* Head      - a loft along the FORWARD axis (snouts, skulls, quadruped
              bodies) with pt()/normal()/local() lookups for markings.
* sweep()   - one continuous tube through points (horns, tails, limbs).
* flat()    - double-sided fan slab from a 2D outline (wings, antennae).
* lens()    - a shallow dome oriented along any normal (eyes, buttons, spots).
* eye()     - layered eye (sclera / iris / pupil / highlight) on a surface.
* paint() / deform() - recolour or move faces by position (bellies, hems).
* part()    - fake AO for a whole character + Builder.build.
* make_root(), socket(), hand_socket(), clean_glb_names(), check_names().
* shared limbs: bird_foot, feather_fingers, paw, boot, ram_horn, mottle.

Conventions: hand sockets are rotated 180 deg about X (see HAND_ROT); part
names inside every asset are exact after clean_glb_names() (three.js keeps
them in object.userData.name when it de-duplicates object.name).
"""
import json
import math
import re
import struct

import bpy  # noqa: F401  (must be imported before bmesh / mathutils)
import bmesh  # noqa: F401
from mathutils import Matrix, Vector

import ghlib
from ghlib import MAT_INDEX, col, empty, mix, srgb_to_linear

UP = Vector((0, 0, 1))


def _geo_key(e):
    """Stable sort key for a BMVert / BMFace (position based, independent of
    the face's loop start)."""
    if hasattr(e, 'co'):
        return (round(e.co.x, 5), round(e.co.y, 5), round(e.co.z, 5))
    c = e.calc_center_median()
    vs = sorted((round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in e.verts)
    return (round(c.x, 5), round(c.y, 5), round(c.z, 5), tuple(vs))


class Builder(ghlib.Builder):
    """ghlib.Builder with an order-stable _finish.

    ghlib iterates a Python set of BMFaces (hashed by memory address) when
    it hands out the per-face colour variation, so every rebuild shuffles
    the colours and the .glb bytes change.  This override is the same
    logic with verts visited in creation order and faces in a geometric
    order, which makes the exported files byte-identical between runs."""

    def _finish(self, verts, color, mat, jitter, var, smooth=False):
        if isinstance(verts, (set, frozenset)):      # ghlib's bevelled box
            verts = sorted(verts, key=_geo_key)
        verts = list(dict.fromkeys(verts))           # dedupe, keep order
        # bmesh's link_faces (disk cycle) order is not stable between runs
        faces = sorted(dict.fromkeys(f for v in verts for f in v.link_faces), key=_geo_key)
        if jitter:
            for v in verts:
                v.co += Vector((self.rng.uniform(-jitter, jitter),
                                self.rng.uniform(-jitter, jitter),
                                self.rng.uniform(-jitter, jitter)))
        base = col(color)
        for f in faces:
            k = 1.0 + self.rng.uniform(-var, var)
            t = [self.rng.uniform(-var * 0.35, var * 0.35) for _ in range(3)]
            c = tuple(min(1.0, max(0.0, base[i] * k + t[i] * base[i])) for i in range(3))
            lin = tuple(srgb_to_linear(x) for x in c) + (1.0,)
            for loop in f.loops:
                loop[self.col_layer] = lin
            f.material_index = MAT_INDEX[mat]
            f.smooth = smooth
        return faces


# ---------------------------------------------------------------------------
# small maths helpers
# ---------------------------------------------------------------------------
def V(x, y=None, z=None):
    if y is None:
        return Vector(x)
    return Vector((x, y, z))


def tint(name_or_rgb, mul=1.0):
    return col(name_or_rgb, mul)


def blend(a, b, t, mul=1.0):
    c = mix(a, b, t)
    return tuple(min(1.0, v * mul) for v in c)


def frame_z(n, up=UP):
    """3x3 matrix whose local +Z points along n (local +Y as close to `up`)."""
    z = Vector(n).normalized()
    u = Vector(up)
    if abs(u.normalized().dot(z)) > 0.98:
        u = Vector((0, -1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0))
    y = (u - u.dot(z) * z).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def frame_fwd(fwd, up=UP):
    """3x3 matrix whose local -Y points along fwd and local +Z toward up."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    u = (u - u.dot(f) * f).normalized()
    y = -f
    x = y.cross(u)
    return Matrix((x, y, u)).transposed()


def deg(M3):
    """Euler XYZ in degrees (for Builder `rot=` arguments)."""
    e = M3.to_euler('XYZ')
    return tuple(math.degrees(a) for a in e)


def M4(loc=(0, 0, 0), R=None, scale=(1, 1, 1)):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    T = Matrix.Translation(Vector(loc))
    Rm = (R if R is not None else Matrix.Identity(3)).to_4x4()
    S = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return T @ Rm @ S


def rotx(a):
    return Matrix.Rotation(math.radians(a), 3, 'X')


def roty(a):
    return Matrix.Rotation(math.radians(a), 3, 'Y')


def rotz(a):
    return Matrix.Rotation(math.radians(a), 3, 'Z')


def ell_pt(c, r, az, el):
    """Point and outward normal on an ellipsoid (centre c, radii r).
    az: degrees from the front (-Y) toward +X (character's left);
    el: degrees of elevation."""
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    p = Vector(c) + Vector((d.x * r[0], d.y * r[1], d.z * r[2]))
    n = Vector((d.x / r[0], d.y / r[1], d.z / r[2])).normalized()
    return p, n


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------
def lathe(b, profile, seg=10, M=None, color='wood', mat='base', jitter=0.0,
          var=0.06, smooth=False, cap_bottom=True, cap_top=True, sx=1.0, sy=1.0,
          phase=0.0):
    """Revolve [(r, z), ...] around local Z, listed so the outside is on the
    right when walking the profile (i.e. bottom -> top for a solid).  r == 0
    gives a pole.  sx/sy squash the rings; M places the result."""
    M = M if M is not None else Matrix.Identity(4)
    bm = b.bm
    rings, allv = [], []
    for (r, z) in profile:
        if r <= 1e-6:
            ring = [bm.verts.new(M @ Vector((0, 0, z)))]
        else:
            ring = []
            for i in range(seg):
                a = 2 * math.pi * i / seg + phase
                ring.append(bm.verts.new(M @ Vector((r * sx * math.cos(a), r * sy * math.sin(a), z))))
        rings.append(ring)
        allv += ring
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(A) == 1:
                bm.faces.new((A[0], B[j], B[i]))
            elif len(B) == 1:
                bm.faces.new((A[i], A[j], B[0]))
            else:
                bm.faces.new((A[i], A[j], B[j], B[i]))
    if cap_bottom and len(rings[0]) > 2:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    return b._finish(allv, color, mat, jitter, var, smooth)


def _ring(spec):
    """(z, rx, ry[, cx, cy]) -> tuple of 5 floats."""
    z, rx, ry = spec[0], spec[1], spec[2]
    cx = spec[3] if len(spec) > 3 else 0.0
    cy = spec[4] if len(spec) > 4 else 0.0
    return z, rx, ry, cx, cy


def az_pt(az, rx, ry, cx=0.0, cy=0.0, z=0.0):
    """Point on an elliptical ring; az 0 = front (-Y), +90 = +X (left)."""
    return Vector((cx + rx * math.sin(az), cy - ry * math.cos(az), z))


class Prof:
    """Linear interpolation of loft rings -> surface points for details."""

    def __init__(self, rings):
        self.r = [_ring(x) for x in rings]

    def at(self, z):
        r = self.r
        if z <= r[0][0]:
            return r[0]
        for a, c in zip(r[:-1], r[1:]):
            if a[0] <= z <= c[0]:
                t = (z - a[0]) / max(1e-9, c[0] - a[0])
                return tuple(a[i] + (c[i] - a[i]) * t for i in range(5))
        return r[-1]

    def ring(self, z, off=0.0, a0=None, a1=None):
        z, rx, ry, cx, cy = self.at(z)
        out = (z, rx + off, ry + off, cx, cy)
        if a0 is not None:
            out = out + (a0, a1)
        return out

    def pt(self, az, z, off=0.0):
        z, rx, ry, cx, cy = self.at(z)
        return az_pt(math.radians(az), rx + off, ry + off, cx, cy, z)

    def normal(self, az, z):
        z, rx, ry, cx, cy = self.at(z)
        a = math.radians(az)
        return Vector((math.sin(a) / max(rx, 1e-4), -math.cos(a) / max(ry, 1e-4), 0)).normalized()


class Head:
    """A head (or snout / body) lofted along the FORWARD axis.

    rings: (t, rx, ry, cx, cy) with t = distance forward (toward -Y) from
    `centre`, rx = half width (X), ry = half height (Z), cx/cy offsets
    (X, Z).  Azimuth convention for pt()/normal(): 0 = underside (chin),
    180 = top, +90 = character's left (+X)."""

    def __init__(self, centre, rings, pitch=0.0):
        self.c = Vector(centre)
        self.rings = rings
        self.prof = Prof(rings)
        self.R = rotx(90 + pitch)          # local +Z -> forward (-Y), local +Y -> up
        self.M = M4(self.c, self.R)

    def build(self, b, seg=12, **kw):
        return loft(b, self.rings, seg=seg, M=self.M, **kw)

    def ring(self, t, off=0.0, a0=None, a1=None):
        return self.prof.ring(t, off, a0, a1)

    def pt(self, az, t, off=0.0):
        return self.M @ self.prof.pt(az, t, off)

    def normal(self, az, t, d=0.01):
        pa = self.pt(az + 4, t)
        pb = self.pt(az - 4, t)
        pc = self.pt(az, t + d)
        pd = self.pt(az, t - d)
        n = (pa - pb).cross(pc - pd)
        if n.dot(self.pt(az, t, 0.01) - self.pt(az, t)) < 0:
            n = -n
        return n.normalized()

    def shell(self, b, rings, a0=0, a1=0, **kw):
        return shell(b, rings, a0, a1, M=self.M, **kw)

    def local(self, p):
        """World point -> (az degrees in 0..360, t, local x, local y)."""
        q = self.M.inverted() @ Vector(p)
        az = math.degrees(math.atan2(q.x, -q.y)) % 360.0
        return az, q.z, q.x, q.y


def loft(b, rings, seg=12, M=None, color='wood', mat='base', jitter=0.0, var=0.06,
         smooth=False, cap_bottom=True, cap_top=True, phase=0.0):
    """Closed surface through stacked elliptical rings (z, rx, ry[, cx, cy])
    listed bottom -> top along local Z.  rx <= 0 makes a pole.  With
    phase=0 there is a vertex straight in front (-Y) of every ring."""
    M = M if M is not None else Matrix.Identity(4)
    if rings[0][0] > rings[-1][0]:          # always build bottom -> top
        rings = list(reversed(rings))
        cap_bottom, cap_top = cap_top, cap_bottom
    bm = b.bm
    allr, allv = [], []
    for spec in rings:
        z, rx, ry, cx, cy = _ring(spec)
        if rx <= 1e-6:
            ring = [bm.verts.new(M @ Vector((cx, cy, z)))]
        else:
            ring = [bm.verts.new(M @ az_pt(2 * math.pi * i / seg + phase, rx, ry, cx, cy, z))
                    for i in range(seg)]
        allr.append(ring)
        allv += ring
    for k in range(len(allr) - 1):
        A, B = allr[k], allr[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(A) == 1:
                bm.faces.new((A[0], B[j], B[i]))
            elif len(B) == 1:
                bm.faces.new((A[i], A[j], B[0]))
            else:
                bm.faces.new((A[i], A[j], B[j], B[i]))
    if cap_bottom and len(allr[0]) > 2:
        bm.faces.new(list(reversed(allr[0])))
    if cap_top and len(allr[-1]) > 2:
        bm.faces.new(allr[-1])
    return b._finish(allv, color, mat, jitter, var, smooth)


def shell(b, rings, a0, a1, seg=6, thick=0.02, M=None, color='wood', mat='base',
          jitter=0.0, var=0.05, edge=True, back=True):
    """Open curved panel following elliptical rings (like loft) between the
    azimuths a0 -> a1 (degrees, 0 = front, +90 = +X).  Per-ring overrides:
    a ring may be (z, rx, ry, cx, cy, a0, a1).  The rings describe the OUTER
    surface; the inner one is `thick` further in.  Good for aprons, lapels,
    capes, shawls, masks."""
    M = M if M is not None else Matrix.Identity(4)
    if rings[0][0] > rings[-1][0]:          # always build bottom -> top
        rings = list(reversed(rings))
    bm = b.bm
    outer, inner, allv = [], [], []
    for spec in rings:
        z, rx, ry, cx, cy = _ring(spec)
        ra0 = math.radians(spec[5] if len(spec) > 5 else a0)
        ra1 = math.radians(spec[6] if len(spec) > 6 else a1)
        o, i_ = [], []
        for k in range(seg + 1):
            a = ra0 + (ra1 - ra0) * k / seg
            o.append(bm.verts.new(M @ az_pt(a, rx, ry, cx, cy, z)))
            i_.append(bm.verts.new(M @ az_pt(a, max(1e-3, rx - thick), max(1e-3, ry - thick), cx, cy, z)))
        outer.append(o)
        inner.append(i_)
        allv += o + i_
    for r in range(len(rings) - 1):
        A, B = outer[r], outer[r + 1]
        Ai, Bi = inner[r], inner[r + 1]
        for k in range(seg):
            bm.faces.new((A[k], A[k + 1], B[k + 1], B[k]))
            if back:
                bm.faces.new((Ai[k], Bi[k], Bi[k + 1], Ai[k + 1]))
        if edge:
            bm.faces.new((A[0], B[0], Bi[0], Ai[0]))
            bm.faces.new((A[-1], Ai[-1], Bi[-1], B[-1]))
    if edge:
        A, Ai = outer[0], inner[0]
        B, Bi = outer[-1], inner[-1]
        for k in range(seg):
            bm.faces.new((A[k], Ai[k], Ai[k + 1], A[k + 1]))
            bm.faces.new((B[k], B[k + 1], Bi[k + 1], Bi[k]))
    return b._finish(allv, color, mat, jitter, var)


def flat(b, outline, M, thick=0.015, color='white', mat='base', var=0.05,
         centre=None, seg_color=None, rim=None, jitter=0.0):
    """Double-sided slab from a 2D outline [(u, v), ...] (any winding) in the
    local UV plane, `thick` along local Z, placed by the 4x4 matrix M.
    Front/back are triangle fans from `centre` (default centroid) so each
    wedge can take its own colour: seg_color(i, n, (u, v)) -> colour."""
    bm = b.bm
    pts = [Vector((u, v)) for (u, v) in outline]
    area = sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y
               for i in range(len(pts)))
    if area < 0:
        pts = list(reversed(pts))
    n = len(pts)
    c = Vector(centre) if centre is not None else sum(pts, Vector((0, 0))) / n
    h = thick / 2
    top = [bm.verts.new(M @ Vector((p.x, p.y, h))) for p in pts]
    bot = [bm.verts.new(M @ Vector((p.x, p.y, -h))) for p in pts]
    ct = bm.verts.new(M @ Vector((c.x, c.y, h)))
    cb = bm.verts.new(M @ Vector((c.x, c.y, -h)))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        ft = bm.faces.new((ct, top[i], top[j]))
        fb = bm.faces.new((cb, bot[j], bot[i]))
        fs = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        faces.append((i, ft, fb, fs))
    allv = top + bot + [ct, cb]
    res = b._finish(allv, color, mat, jitter, var)
    if seg_color or rim:
        def fn(cen, f):
            for i, ft, fb, fs in faces:
                if f in (ft, fb) and seg_color:
                    mid = (pts[i] + pts[(i + 1) % n]) / 2
                    return seg_color(i, n, (mid.x, mid.y))
                if f is fs and rim:
                    return rim
            return None
        paint(b, res, fn, var=var)
    return res


def paint(b, faces, fn, var=0.04):
    """Recolour faces: fn(centre, face) -> palette key / rgb / (colour, mat)
    or None to keep.  Used for face markings, bellies, stripes..."""
    from ghlib import srgb_to_linear
    for f in faces:
        if not f.is_valid:
            continue
        res = fn(f.calc_center_median(), f)
        if res is None:
            continue
        mat = None
        if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], str):
            res, mat = res
        base = col(res)
        k = 1.0 + b.rng.uniform(-var, var)
        lin = tuple(srgb_to_linear(min(1.0, max(0.0, v * k))) for v in base) + (1.0,)
        for loop in f.loops:
            loop[b.col_layer] = lin
        if mat is not None:
            f.material_index = MAT_INDEX[mat]


def deform(faces, fn):
    """Move the verts of `faces` in place: fn(Vector) -> Vector."""
    vs = set()
    for f in faces:
        if f.is_valid:
            vs.update(f.verts)
    for v in vs:
        v.co = Vector(fn(v.co.copy()))


def sweep(b, pts, radii, seg=6, color='bark', mat='base', jitter=0.0, var=0.06,
          cap_start=True, cap_end=True, up=None, smooth=False, phase=0.0):
    """One continuous tube through `pts`.  radii: float, list of floats, or
    list of (r_normal, r_binormal) pairs for oval sections.  A radius of 0
    at an end makes a point."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    T = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        T.append(t.normalized())
    if up is None:
        ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.95 else Vector((0, -1, 0))
    else:
        ref = Vector(up)
    N = (ref - ref.dot(T[0]) * T[0]).normalized()
    Ns = [N]
    for i in range(1, n):
        q = T[i - 1].rotation_difference(T[i])
        N = q @ N
        N = (N - N.dot(T[i]) * T[i]).normalized()
        Ns.append(N)
    bm = b.bm
    rings, allv = [], []
    for i in range(n):
        r = radii[i]
        rn, rb = (r, r) if isinstance(r, (int, float)) else r
        t, nn = T[i], Ns[i]
        bn = t.cross(nn)
        if max(rn, rb) <= 1e-6:
            ring = [bm.verts.new(pts[i])]
        else:
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg + phase
                ring.append(bm.verts.new(pts[i] + nn * (math.cos(a) * rn) + bn * (math.sin(a) * rb)))
        rings.append(ring)
        allv += ring
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(A) == 1:
                bm.faces.new((A[0], B[k2], B[k]))
            elif len(B) == 1:
                bm.faces.new((A[k], A[k2], B[0]))
            else:
                bm.faces.new((A[k], A[k2], B[k2], B[k]))
    if cap_start and len(rings[0]) > 2:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    return b._finish(allv, color, mat, jitter, var, smooth)


def lens(b, p, n, r, h, seg=10, color='white', mat='base', var=0.03, sx=1.0,
         sy=1.0, up=UP, rings=2, spin=0.0):
    """Shallow dome whose flat base (radius r) is centred at p, bulging h
    along n.  sx/sy squash it in the surface plane (sy = toward `up`)."""
    R = frame_z(n, up) @ rotz(spin)
    if rings <= 1:
        prof = [(r, 0.0), (0.0, h)]
    elif rings == 2:
        prof = [(r, 0.0), (r * 0.72, h * 0.72), (0.0, h)]
    else:
        prof = [(r, 0.0), (r * 0.87, h * 0.5), (r * 0.5, h * 0.87), (0.0, h)]
    return lathe(b, prof, seg=seg, M=M4(p, R), color=color, mat=mat, var=var,
                 sx=sx, sy=sy, phase=math.pi / seg)


def disc(b, p, n, r, depth, seg=10, color='white', mat='base', var=0.03,
         sx=1.0, sy=1.0, up=UP, r2=None):
    """Flat cylinder (coin) centred at p, axis along n."""
    R = frame_z(n, up)
    r2 = r if r2 is None else r2
    prof = [(r, -depth / 2), (r2, depth / 2)]
    return lathe(b, prof, seg=seg, M=M4(p, R), color=color, mat=mat, var=var,
                 sx=sx, sy=sy, phase=math.pi / seg)


def eye(b, p, n, r, layers, bulge=0.3, up=UP, seg=10, embed=0.25, hl=None,
        hl_mat='base', hl_pos=(-0.32, 0.36), hl_r=0.2):
    """Layered eye on a surface point p with outward normal n.

    layers: list of dicts {r: rel radius, color, mat='base', sx, sy, dx, dy}
    (first entry is the eye ball itself, r=1).  dx/dy shift a layer inside
    the eye plane (dx toward the character's left for a front-facing eye).
    hl: highlight colour (None = no highlight).
    """
    n = Vector(n).normalized()
    Rm = frame_z(n, up)
    ex, ey = Rm.col[0], Rm.col[1]
    h0 = r * bulge
    base = -h0 * embed               # sclera base sits slightly inside
    apex_prev = base + h0
    prev_r, prev_h, prev_base, prev_c = r, h0, base, Vector((0, 0))
    top = None
    for i, L in enumerate(layers):
        lr = r * L.get('r', 1.0)
        sx, sy = L.get('sx', 1.0), L.get('sy', 1.0)
        c2 = Vector((L.get('dx', 0.0) * r, L.get('dy', 0.0) * r))
        if i == 0:
            zb, hh = base, h0
        else:
            # height of the previous dome at this layer's rim (ellipse approx)
            rho = min(prev_r * 0.999, (c2 - prev_c).length + lr * max(sx, sy))
            zr = prev_base + prev_h * math.sqrt(max(0.0, 1 - (rho / prev_r) ** 2)) * 0.9
            zb = zr - 0.002
            apex = apex_prev + h0 * 0.16 * max(0.35, L.get('r', 1.0)) + 0.002
            hh = max(0.004, apex - zb)
        pc = Vector(p) + ex * c2.x + ey * c2.y + n * zb
        lens(b, pc, n, lr, hh, seg=L.get('seg', seg), color=L['color'],
             mat=L.get('mat', 'base'), sx=sx, sy=sy, up=up,
             rings=L.get('rings', 2), var=L.get('var', 0.02))
        apex_prev = zb + hh
        prev_r, prev_h, prev_base, prev_c = lr * min(sx, sy), hh, zb, c2
        top = (pc, lr, hh)
    if hl is not None and top is not None:
        pc, lr, hh = top
        hp = pc + ex * (hl_pos[0] * lr) + ey * (hl_pos[1] * lr) + n * (hh * 0.55)
        lens(b, hp, n, lr * hl_r, hh * 0.6 + 0.004, seg=6, color=hl, mat=hl_mat,
             up=up, rings=1, var=0.0)


# ---------------------------------------------------------------------------
# shading + building
# ---------------------------------------------------------------------------
def ao_pass(b, H, amt=0.22, under=0.14, z0=0.0, gamma=0.6):
    """Fake AO in model space for a whole character: faces near the ground
    and faces pointing down are darkened (emissive faces untouched)."""
    bm = b.bm
    bm.normal_update()
    layer = b.col_layer
    emit = MAT_INDEX['emit']
    for f in bm.faces:
        if f.material_index == emit:
            continue
        c = f.calc_center_median()
        t = min(1.0, max(0.0, (c.z - z0) / max(1e-3, H)))
        k = 1.0 - amt * (1.0 - t ** gamma)
        nz = f.normal.z
        if nz < 0:
            k *= 1.0 - under * (-nz) ** 1.5
        for loop in f.loops:
            cc = loop[layer]
            loop[layer] = (cc[0] * k, cc[1] * k, cc[2] * k, 1.0)


def part(b, name, origin, parent, H, amt=0.22, under=0.14, z0=0.0, prefix=None):
    """AO + build a rig part.  `origin` (model space) becomes the pivot."""
    ao_pass(b, H, amt=amt, under=under, z0=z0)
    # stable triangle order -> reproducible .glb (bmesh wants numeric keys)
    rank = {f: i for i, f in enumerate(sorted(b.bm.faces, key=_geo_key))}
    b.bm.faces.sort(key=lambda f: rank[f])
    ob = b.build(name, origin=tuple(origin), parent=parent, ao=0)
    if prefix:
        ob.data.name = f'{prefix}_{name}'
    return ob


def make_root(name, col_r=None, **props):
    r = empty(name, (0, 0, 0))
    r.empty_display_size = 0.3
    if col_r is not None:
        r['col_r'] = float(col_r)
    for k, v in props.items():
        r[k] = v
    return r


def socket(name, loc, parent, rot=None):
    """Empty socket at model-space `loc`.  rot: Euler XYZ degrees."""
    e = empty(name, tuple(loc), parent)
    e.empty_display_size = 0.06
    if rot is not None:
        e.rotation_euler = tuple(math.radians(a) for a in rot)
    return e


# Hand sockets are turned 180 deg about X so a tool parented with an identity
# transform (origin = grip, handle along its +Z) points down the forearm when
# the arm hangs, and its working end (-Y) swings to face down/forward when the
# arm is raised forward.
HAND_ROT = (180.0, 0.0, 0.0)


def hand_socket(name, loc, parent):
    return socket(name, loc, parent, rot=HAND_ROT)


def clean_glb_names(path):
    """Blender forces unique object names (body, body.001 ...).  The rig
    contract wants exact part names inside every asset, so strip the numeric
    suffixes from node names in the exported .glb (three.js keeps the exact
    glTF name in `object.userData.name`)."""
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, ver, _total = struct.unpack('<III', data[:12])
    jlen, jtype = struct.unpack('<II', data[12:20])
    j = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    pat = re.compile(r'\.\d{3}$')
    for item in j.get('nodes', []):
        if 'name' in item:
            item['name'] = pat.sub('', item['name'])
    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = (struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest))
           + struct.pack('<II', len(js), jtype) + js + rest)
    with open(path, 'wb') as fh:
        fh.write(out)


# ---------------------------------------------------------------------------
# reusable limbs / details (shared by characters and enemies)
# ---------------------------------------------------------------------------
def bird_foot(b, ank, s, color, claw, toe=0.13, r=0.02, seg=4):
    """Three forward toes + one back toe, claws painted at the tips."""
    for ax, ln in ((-30, toe * 0.85), (0, toe), (30, toe * 0.85), (180, toe * 0.5)):
        a = math.radians(ax + s * 4)
        d = V(math.sin(a), -math.cos(a), 0)
        p1 = ank + d * ln + V(0, 0, -ank.z + 0.012)
        pc = p1 + d * 0.04 + V(0, 0, -0.008)
        f = sweep(b, [ank, p1, pc], [r, r * 0.75, 0.0], seg=seg, color=color, cap_start=False)
        paint(b, f, lambda c, f_, p1=p1, d=d: claw if (c - p1).dot(d) > -0.004 else None)


def feather_fingers(b, wr, s, color, n=4, ln=0.13, w=0.028, spread=34, out=0.1):
    """Fan of flat feathers hanging from a wrist point (wing 'hands')."""
    angs = [(-spread + 2 * spread * k / (n - 1)) for k in range(n)]
    for ax in angs:
        a = math.radians(ax)
        l2 = ln * (1.0 - 0.25 * abs(ax) / spread)
        d = V(s * out, math.sin(a) * 0.75, -1).normalized()
        p0 = wr + V(0, math.sin(a) * 0.03, 0.0)
        sweep(b, [p0, p0 + d * l2 * 0.55, p0 + d * l2], [(w, w * 0.4), (w * 1.1, w * 0.4), 0.0],
              seg=4, color=color, up=(s, 0, 0))


def mottle(cols, seed=1):
    import random
    rng = random.Random(seed)
    return lambda c, f: rng.choice(cols)


def paw(b, wr, s, color, soot=None, size=1.0, fingers=4, down=0.1, claw=None):
    """Chunky mitten paw hanging below the wrist (fingers point down)."""
    k = size
    b.sphere(r=1, seg=6, rings=4, loc=wr + V(0, 0, -0.035 * k), scale=(0.05 * k, 0.062 * k, 0.058 * k),
             color=soot or color)
    for i in range(fingers):
        t = (i - (fingers - 1) / 2) / max(1, fingers - 1)
        p0 = wr + V(s * 0.005, t * 0.075 * k, -0.06 * k)
        p1 = p0 + V(s * 0.008, t * 0.02 * k, -down * k * (1 - 0.25 * abs(t)))
        sweep(b, [p0, p1], [0.02 * k, 0.017 * k], seg=5, color=soot or color)
        if claw:
            lens(b, p1, (0, 0, -1), 0.014 * k, 0.018 * k, seg=4, color=claw, rings=1)
    # thumb, pointing forward-down
    p0 = wr + V(s * -0.015, -0.045 * k, -0.035 * k)
    sweep(b, [p0, p0 + V(-s * 0.01, -0.03 * k, -0.04 * k)], [0.022 * k, 0.017 * k], seg=5, color=soot or color)


def boot(b, hp, s, ank_z=0.2, color='leather_dk', cuff=None, toe=0.16, r=0.085, sole=None):
    """Chunky boot: shaft from ank_z down to a rounded foot pointing -Y."""
    x = hp.x
    b.cyl(r1=r * 0.95, r2=r, h=ank_z - 0.04, seg=8, loc=(x, 0.0, 0.04), color=color)
    if cuff:
        b.cyl(r1=r * 1.15, r2=r * 1.2, h=0.05, seg=8, loc=(x, 0.0, ank_z - 0.035), color=cuff, jitter=0.004)
    b.sphere(r=1, seg=8, rings=5, loc=(x, -toe * 0.45, 0.06), scale=(r * 0.95, toe * 0.7, 0.065), color=color)
    b.box((r * 1.9, toe * 1.35, 0.03), loc=(x, -toe * 0.38, 0.016), color=sole or blend('leather_dk', 'black', 0.4))


def ram_horn(b, base, centre, s, r1=0.045, turns=1.1, thick=(0.048, 0.012), out=0.07,
             color='bone_dark', ridge=None, n=12, yaw=35.0):
    """Spiral horn starting exactly at `base`, curling back / down / forward
    around `centre` in a plane turned `yaw` degrees toward the front, and
    drifting outward by `out`."""
    y = math.radians(yaw)
    back = V(s * math.sin(y), math.cos(y), 0)
    up = V(0, 0, 1)
    outv = V(s * math.cos(y), -math.sin(y), 0)
    d0 = V(base) - V(centre)
    phi0 = math.atan2(d0.dot(back), d0.dot(up))
    r0 = math.hypot(d0.dot(back), d0.dot(up))
    o0 = d0.dot(outv)
    pts, rad = [], []
    for k in range(n + 1):
        t = k / n
        phi = phi0 + t * turns * 2 * math.pi
        R = r0 + (r1 - r0) * t
        pts.append(V(centre) + back * (R * math.sin(phi)) + up * (R * math.cos(phi)) + outv * (o0 + out * t ** 0.8))
        rad.append(thick[0] + (thick[1] - thick[0]) * t)
    f = sweep(b, pts, rad, seg=5, color=color)
    if ridge:
        mids = [(pts[i] + pts[i + 1]) / 2 for i in range(n)]

        def fn(c, f_):
            k = min(range(n), key=lambda i: (mids[i] - c).length)
            return ridge if k % 2 else None
        paint(b, f, fn)
    return f


def check_names(roots, required):
    """Assert every root has the required direct/indirect children."""
    from ghlib import descendants
    problems = []
    for r in roots:
        names = {re.sub(r'\.\d{3}$', '', d.name) for d in descendants(r)}
        for req in required.get(r.name, []):
            if req not in names:
                problems.append(f'{r.name}: missing {req}')
    return problems
