"""
nature_kit - organic primitives for nature.glb / crops.glb (built on ghlib).

ghlib.Builder gives boxes, cylinders and spheres.  Plants and rocks want a
few more shapes, so this module adds (as a Builder subclass, NB):

    mesh()      raw verts + faces
    tube()      smooth tube along a path (parallel-transport frames), with
                optional root-flare lobes, bark roughness and a pointed tip
    lathe2()    lathe with a per-vertex ring function (wavy rims, ribs, lobes)
    tier()      one drooping, star-outlined conifer "skirt"
    blob()      lumpy low-poly clump (icosphere or uv-sphere, radial noise,
                optional weeping droop)
    hull_rock() angular faceted stone (convex hull of a squashed / tilted
                point cloud, optional bevel)
    leaf()      folded broad leaf on a short stalk
    card()      2-triangle leaf for cheap leafy fringes
    blade()     curving grass / reed / onion strap (flat or 3-sided)
    frond()     arching fern-like frond with a serrated outline
    star()      flower head (petal star fan + cone eye)

plus face-colour helpers (paint / shade / light_from_above / radial_ao /
moss_top / tint_where) so a model gets fake crevice-AO and sky light before
Builder.build(), and clamp_z() to cap how deep anything is buried.

Only this module and the build scripts import it; ghlib stays untouched.
"""
import math

import bpy  # noqa: F401  (must precede bmesh/mathutils with the bpy wheel)
import bmesh
from mathutils import Euler, Vector

from ghlib import MAT_INDEX, Builder, col, srgb_to_linear


def lin(rgb):
    return tuple(srgb_to_linear(x) for x in rgb)


def lerp(a, b, t):
    return a + (b - a) * t


def v3(p):
    return Vector((p[0], p[1], p[2]))


def rot2(x, y, a):
    c, s = math.cos(a), math.sin(a)
    return x * c - y * s, x * s + y * c


def frames(points):
    """Parallel-transport frames along a polyline -> [(p, t, u, v)]."""
    pts = [v3(p) for p in points]
    n = len(pts)
    tans = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    t0 = tans[0]
    ref = Vector((1, 0, 0)) if abs(t0.x) < 0.9 else Vector((0, 1, 0))
    u = (ref - t0 * ref.dot(t0)).normalized()
    out = []
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i])
            u = q @ u
            u = (u - tans[i] * u.dot(tans[i])).normalized()
        v = tans[i].cross(u)
        out.append((pts[i], tans[i], u, v))
    return out


def bezier(p0, p1, p2, n):
    """Quadratic bezier sampled at n+1 points."""
    p0, p1, p2 = v3(p0), v3(p1), v3(p2)
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2)
    return out


class NB(Builder):
    """ghlib.Builder + organic primitives and colour post-processing."""

    # ------------------------------------------------------------------
    # raw geometry
    # ------------------------------------------------------------------
    def mesh(self, verts, faces, color='leaf', mat='base', jitter=0.0, var=0.06,
             smooth=False):
        vs = [self.bm.verts.new(v3(v)) for v in verts]
        out = []
        for f in faces:
            try:
                out.append(self.bm.faces.new([vs[i] for i in f]))
            except ValueError:
                pass
        self._finish(vs, color, mat, jitter, var, smooth)
        return out

    # ------------------------------------------------------------------
    # tubes: trunks, branches, stems, roots
    # ------------------------------------------------------------------
    def tube(self, points, radii, seg=6, color='bark', mat='base', var=0.06,
             cap_start=False, cap_end=True, tip=False, lobes=None, rough=0.0,
             twist=0.0, phase=None, ring_fn=None, smooth=False):
        """Continuous tube through `points`.

        radii   - float or per-point list
        tip     - end in a single point instead of a cap
        lobes   - (k, amps) root-flare: radius *= 1 + amp_i * bump(k*angle)
                  where amps is a per-ring list (0 -> round)
        rough   - random radial noise (fraction of radius) per vertex
        twist   - degrees of twist per ring (gnarled trunks)
        ring_fn - optional f(ring_index, angle) -> radius multiplier
        """
        rng = self.rng
        n = len(points)
        if isinstance(radii, (int, float)):
            radii = [radii] * n
        fr = frames(points)
        if phase is None:
            phase = rng.uniform(0, 2 * math.pi)
        rings = []
        allv = []
        last = n - 1 if tip else n
        for k in range(last):
            p, t, u, v = fr[k]
            ring = []
            for i in range(seg):
                a = phase + 2 * math.pi * i / seg + math.radians(twist) * k
                r = radii[k]
                if lobes is not None:
                    kk, amps = lobes
                    amp = amps[k] if k < len(amps) else 0.0
                    if amp:
                        b = max(0.0, math.cos(kk * (a - phase))) ** 2
                        r *= 1.0 + amp * b
                if ring_fn is not None:
                    r *= ring_fn(k, a - phase)
                if rough:
                    r *= 1.0 + rng.uniform(-rough, rough)
                co = p + (u * math.cos(a) + v * math.sin(a)) * r
                ring.append(self.bm.verts.new(co))
            rings.append(ring)
            allv += ring
        faces = []
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                faces.append(self.bm.faces.new((a[i], a[j], b[j], b[i])))
        if tip:
            tv = self.bm.verts.new(fr[-1][0])
            allv.append(tv)
            a = rings[-1]
            for i in range(seg):
                faces.append(self.bm.faces.new((a[i], a[(i + 1) % seg], tv)))
        elif cap_end:
            faces.append(self.bm.faces.new(rings[-1]))
        if cap_start:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        self._finish(allv, color, mat, 0.0, var, smooth)
        return faces

    # ------------------------------------------------------------------
    # conifer tier
    # ------------------------------------------------------------------
    def tier(self, center, z_top, z_bot, R, n=8, droop=0.3, rot=0.0, notch=0.7,
             rvar=0.14, color='pine', mat='leaves', var=0.07, under=0.32,
             shoulder=0.5, skip=(), tip_up=0.0, tilt=None):
        """One drooping conifer skirt: apex -> shoulders -> star of branch
        tips (lower, outward) with notches between them, concave underside.

        6n triangles.  Returns (top_faces, tip_faces, under_faces).
        """
        rng = self.rng
        cx, cy = center[0], center[1]
        H = z_top - z_bot
        V = [(cx, cy, z_top)]
        # shoulders
        for i in range(n):
            a = rot + 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
            rr = R * shoulder * (1 + rng.uniform(-0.12, 0.12))
            z = z_top - H * (0.42 + rng.uniform(-0.06, 0.06))
            V.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
        # tips / notches
        for i in range(n):
            a = rot + 2 * math.pi * i / n + rng.uniform(-0.08, 0.08)
            short = 0.55 if i in skip else 1.0
            rr = R * (1 + rng.uniform(-rvar, rvar)) * short
            d = droop * (1 + rng.uniform(-0.35, 0.35)) * short
            V.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z_bot - d + tip_up))
            a2 = rot + 2 * math.pi * (i + 0.5) / n + rng.uniform(-0.05, 0.05)
            rr2 = R * notch * (1 + rng.uniform(-0.08, 0.08))
            V.append((cx + rr2 * math.cos(a2), cy + rr2 * math.sin(a2),
                      z_bot + H * (0.1 + rng.uniform(-0.03, 0.05))))
        # underside centre
        V.append((cx, cy, z_bot + H * under))
        c_idx = len(V) - 1
        if tilt:
            Rm = Euler((math.radians(tilt[0]), math.radians(tilt[1]), 0), 'XYZ').to_matrix()
            piv = Vector((cx, cy, z_bot))
            V = [piv + Rm @ (Vector(p) - piv) for p in V]
        S = lambda i: 1 + (i % n)                       # shoulder
        T = lambda i: 1 + n + 2 * (i % n)               # tip
        M = lambda i: 1 + n + 2 * (i % n) + 1           # notch
        top, tipf, und = [], [], []
        for i in range(n):
            top.append((0, S(i), S(i + 1)))
            tipf.append((S(i), T(i), M(i)))
            top.append((S(i), M(i), S(i + 1)))
            tipf.append((S(i + 1), M(i), T(i + 1)))
            und.append((c_idx, M(i), T(i)))
            und.append((c_idx, T(i + 1), M(i)))
        fs = self.mesh(V, top + tipf + und, color=color, mat=mat, var=var)
        nt, np_ = len(top), len(tipf)
        return fs[:nt], fs[nt:nt + np_], fs[nt + np_:]

    # ------------------------------------------------------------------
    # blobs / clumps
    # ------------------------------------------------------------------
    def blob(self, r=0.5, loc=(0, 0, 0), scale=(1, 1, 1), sub=1, uv=None,
             noise=0.18, color='leaf', mat='leaves', var=0.08, flat_z=None,
             rot=(0, 0, 0), smooth=False, droop=0.0):
        """Lumpy clump.  sub -> icosphere (Blender levels: 1 = 20 faces,
        2 = 80); uv=(seg, rings) -> uv sphere.  droop pulls the lower
        vertices down by random amounts (weeping foliage)."""
        tmp = bmesh.new()
        if uv:
            bmesh.ops.create_uvsphere(tmp, u_segments=uv[0], v_segments=uv[1], radius=1.0)
        else:
            bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=1.0)
        rng = self.rng
        R = Euler(tuple(math.radians(x) for x in rot), 'XYZ').to_matrix()
        verts = []
        for v in tmp.verts:
            d = v.co.normalized()
            k = 1.0 + rng.uniform(-noise, noise)
            p = d * r * k
            if droop and d.z < 0.2:
                p.z -= droop * r * (0.2 - d.z) ** 1.3 * rng.uniform(0.4, 1.3)
            p = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2]))
            p = R @ p + v3(loc)
            if flat_z is not None and p.z < flat_z:
                p.z = flat_z + (p.z - flat_z) * 0.15
            verts.append(p)
        idx = {v: i for i, v in enumerate(tmp.verts)}
        faces = [[idx[v] for v in f.verts] for f in tmp.faces]
        tmp.free()
        return self.mesh(verts, faces, color=color, mat=mat, var=var, smooth=smooth)

    # ------------------------------------------------------------------
    # rocks
    # ------------------------------------------------------------------
    def hull_rock(self, size=(1, 1, 0.7), loc=(0, 0, 0), n=18, sink=0.12, rot=0.0,
                  color='stone', var=0.1, bevel=0.0, squash_top=0.0, mat='base',
                  shape=None, pts=None, tilt=(0, 0), jag=(0.82, 1.08), dissolve=4.0):
        """Faceted stone: convex hull of a squashed random point cloud whose
        points are clamped at z >= -sink (flat buried base).

        shape(x, y, z) -> scale factor lets callers bias the cloud.
        """
        rng = self.rng
        sx, sy, sz = size
        cloud = []
        if pts is None:
            pts = []
            for i in range(n):
                # quasi-uniform directions (fibonacci) + noise, upper-biased
                t = (i + 0.5) / n
                zz = 1 - 2 * t
                rr = math.sqrt(max(0.0, 1 - zz * zz))
                a = i * 2.39996323 + rng.uniform(-0.35, 0.35)
                d = Vector((rr * math.cos(a), rr * math.sin(a), zz))
                k = rng.uniform(*jag)
                pts.append((d.x * k, d.y * k, d.z * k))
        Rt = Euler((math.radians(tilt[0]), math.radians(tilt[1]), 0), 'XYZ').to_matrix()
        for (x, y, z) in pts:
            f = shape(x, y, z) if shape else 1.0
            q = Rt @ Vector((x * sx * 0.5 * f, y * sy * 0.5 * f, z * sz * 0.5 * f))
            px, py = rot2(q.x, q.y, rot)
            pz = q.z + sz * 0.5 - sink
            if squash_top and pz > sz * (1 - squash_top):
                pz = sz * (1 - squash_top) + (pz - sz * (1 - squash_top)) * 0.35
            pz = max(-sink, pz)
            cloud.append(Vector((px + loc[0], py + loc[1], pz + loc[2])))
        tmp = bmesh.new()
        tv = [tmp.verts.new(c) for c in cloud]
        res = bmesh.ops.convex_hull(tmp, input=tv, use_existing_faces=False)
        inner = [g for g in res['geom_interior'] if isinstance(g, bmesh.types.BMVert)]
        if inner:
            bmesh.ops.delete(tmp, geom=inner, context='VERTS')
        unused = [g for g in res['geom_unused'] if isinstance(g, bmesh.types.BMVert)]
        if unused:
            bmesh.ops.delete(tmp, geom=[u for u in unused if u.is_valid], context='VERTS')
        # merge nearly coplanar tris into bigger facets for the chunky look
        bmesh.ops.dissolve_limit(tmp, angle_limit=math.radians(dissolve),
                                 verts=tmp.verts[:], edges=tmp.edges[:])
        if bevel:
            bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, segments=1,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        bmesh.ops.triangulate(tmp, faces=tmp.faces[:])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        idx = {v: i for i, v in enumerate(tmp.verts)}
        verts = [v.co.copy() for v in tmp.verts]
        faces = [[idx[v] for v in f.verts] for f in tmp.faces]
        tmp.free()
        return self.mesh(verts, faces, color=color, mat=mat, var=var)

    # ------------------------------------------------------------------
    # leaves, blades, fronds, flowers
    # ------------------------------------------------------------------
    def leaf(self, base, yaw, pitch, length, width, color='leaf', mat='leaves',
             fold=0.25, curl=0.0, var=0.07, stalk=0.0, stalk_col=None, tipw=0.0,
             shape=(0.35, 1.0, 0.75), roll=0.0):
        """Broad leaf lying along its local +X from `base`, rotated by yaw
        (deg about Z) and pitch (deg, up from horizontal).  `fold` raises
        the midrib (V cross-section), `curl` bends the tip down (m).
        Returns (blade_faces, stalk_faces).
        """
        b = v3(base)
        cy_, sy_ = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))

        def xf(x, y, z):
            # pitch about local Y, then yaw about Z
            x2 = x * cp - z * sp
            z2 = x * sp + z * cp
            y2 = y
            if roll:
                cr, sr = math.cos(math.radians(roll)), math.sin(math.radians(roll))
                y2, z2 = y2 * cr - z2 * sr, y2 * sr + z2 * cr
            return b + Vector((x2 * cy_ - y2 * sy_, x2 * sy_ + y2 * cy_, z2))

        st_f = []
        L0 = 0.0
        if stalk:
            L0 = stalk
        # midrib stations along the blade
        fr = [0.0, 0.3, 0.62, 1.0]
        ws = [shape[0] * 0.5, shape[1] * 0.5, shape[2] * 0.5, tipw]
        V = []
        for t, w in zip(fr, ws):
            x = L0 + t * length
            dz = -curl * (t ** 2)
            V.append(xf(x, 0, dz + fold * width * 0.5 * (1 - t)))     # midrib
            V.append(xf(x, -w * width, dz))                            # right edge
            V.append(xf(x, w * width, dz))                             # left edge
        F = []
        for k in range(3):
            m0, r0, l0 = 3 * k, 3 * k + 1, 3 * k + 2
            m1, r1, l1 = 3 * k + 3, 3 * k + 4, 3 * k + 5
            if k == 0:
                F.append((m0, r1, m1))
                F.append((m0, m1, l1))
            elif k == 2 and tipw == 0:
                F.append((m0, r0, m1))
                F.append((m0, m1, l0))
            else:
                F.append((m0, r0, r1, m1))
                F.append((m0, m1, l1, l0))
        fs = self.mesh(V, F, color=color, mat=mat, var=var)
        if stalk:
            p0 = xf(0, 0, 0)
            p1 = xf(L0 + 0.02, 0, 0.004)
            st_f = self.tube([p0, p1], [width * 0.07, width * 0.05], seg=3,
                             color=stalk_col or color, mat=mat, cap_end=False, var=var)
        return fs, st_f

    def blade(self, base, yaw, length, width, tilt=15, bend=0.5, segs=4,
              color='grass', mat='leaves', var=0.07, tube=False, tipw=0.0):
        """Curving grass/reed strap.  Starts `tilt` deg from vertical,
        curving outward by `bend` (0 straight .. 1 flops to horizontal).
        tube=True -> 3-sided hollow-looking spike (onion leaves)."""
        b = v3(base)
        yawr = math.radians(yaw)
        dirh = Vector((math.cos(yawr), math.sin(yawr), 0))
        side = Vector((-math.sin(yawr), math.cos(yawr), 0))
        pts = []
        p = b.copy()
        ang0 = math.radians(tilt)
        seglen = length / segs
        for k in range(segs + 1):
            pts.append(p.copy())
            t = k / segs
            a = ang0 + (math.pi / 2 - ang0) * bend * (t ** 1.4) * 1.1
            a = min(a, math.radians(115))
            d = dirh * math.sin(a) + Vector((0, 0, math.cos(a)))
            p = p + d * seglen
        if tube:
            radii = [width * 0.5 * (1 - k / segs) ** 0.8 for k in range(segs + 1)]
            return self.tube(pts, radii, seg=3, color=color, mat=mat, var=var, tip=True,
                             cap_end=False)
        V = []
        for k, q in enumerate(pts):
            t = k / segs
            w = width * 0.5 * (1 - t) + tipw * t
            if k == segs and tipw == 0:
                V.append(q)
            else:
                V.append(q - side * w)
                V.append(q + side * w)
        F = []
        for k in range(segs):
            i0 = 2 * k
            if k == segs - 1 and tipw == 0:
                F.append((i0, i0 + 1, i0 + 2))
            else:
                F.append((i0, i0 + 1, i0 + 3, i0 + 2))
        return self.mesh(V, F, color=color, mat=mat, var=var)

    def frond(self, base, yaw, length, width, rise=55, arch=0.6, segs=4,
              color='leaf', mat='leaves', var=0.07, fold=0.35, teeth=0.45):
        """Fern frond: continuous serrated strip along an arching spine.
        Each station has an inner edge vertex; a tooth sits between
        stations, so the outline is saw-toothed but the blade is solid.
        6 tris per segment."""
        b = v3(base)
        yawr = math.radians(yaw)
        dirh = Vector((math.cos(yawr), math.sin(yawr), 0))
        side = Vector((-math.sin(yawr), math.cos(yawr), 0))
        pts = []
        p = b.copy()
        seglen = length / segs
        for k in range(segs + 1):
            pts.append(p.copy())
            t = k / segs
            a = math.radians(90 - rise) + arch * math.pi * 0.62 * t
            d = dirh * math.sin(a) + Vector((0, 0, math.cos(a)))
            p = p + d * seglen
        env = lambda t: width * 0.5 * math.sin(math.pi * min(1.0, 0.12 + t * 0.88)) ** 0.8
        V = []
        S, L, R = [], [], []
        for k, q in enumerate(pts):
            t = k / segs
            w = env(t) if k < segs else 0.0
            S.append(len(V)); V.append(q + Vector((0, 0, fold * w)))
            if k < segs:
                L.append(len(V)); V.append(q + side * (w * (1 - teeth)))
                R.append(len(V)); V.append(q - side * (w * (1 - teeth)))
        F = []
        for k in range(segs):
            t = (k + 0.6) / segs
            w = env(t)
            q = pts[k].lerp(pts[k + 1], 0.75)
            tl = len(V); V.append(q + side * w - Vector((0, 0, w * 0.2)))
            tr = len(V); V.append(q - side * w - Vector((0, 0, w * 0.2)))
            nxt_l = L[k + 1] if k + 1 < segs else S[segs]
            nxt_r = R[k + 1] if k + 1 < segs else S[segs]
            # left half
            F.append((S[k], S[k + 1], nxt_l))
            F.append((S[k], nxt_l, tl))
            F.append((S[k], tl, L[k]))
            # right half (mirrored winding)
            F.append((S[k], nxt_r, S[k + 1]))
            F.append((S[k], tr, nxt_r))
            F.append((S[k], R[k], tr))
        return self.mesh(V, F, color=color, mat=mat, var=var)

    def card(self, p, d, L, w, color='leaf', mat='leaves', var=0.08, fold=0.3):
        """Cheap leaf: a diamond of 2 tris folded along its midrib, from p
        along direction d."""
        p = v3(p)
        d = v3(d).normalized()
        up = Vector((0, 0, 1))
        side = d.cross(up)
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        nrm = side.cross(d).normalized()
        m = p + d * (L * 0.42)
        V = [p, m + side * (w * 0.5) - nrm * (w * fold), p + d * L, m - side * (w * 0.5) - nrm * (w * fold)]
        return self.mesh(V, [(0, 1, 2), (0, 2, 3)], color=color, mat=mat, var=var)

    def lathe2(self, profile, seg=8, loc=(0, 0, 0), rot=(0, 0, 0), color='wood',
               mat='base', var=0.06, smooth=False, cap_bottom=True, cap_top=True,
               ring_fn=None, phase=0.0):
        """Lathe with an optional ring_fn(ring_index, angle) -> (dr_mul, dz)
        for wavy rims / lobes.  profile = [(r, z), ...] bottom -> top."""
        M = Euler(tuple(math.radians(a) for a in rot), 'XYZ').to_matrix()
        L = v3(loc)
        V = []
        rings = []
        for k, (r, z) in enumerate(profile):
            if r <= 1e-6:
                rings.append([len(V)])
                V.append(L + M @ Vector((0, 0, z)))
                continue
            ring = []
            for i in range(seg):
                a = phase + 2 * math.pi * i / seg
                rm, dz = (1.0, 0.0)
                if ring_fn is not None:
                    rm, dz = ring_fn(k, a - phase)
                ring.append(len(V))
                V.append(L + M @ Vector((r * rm * math.cos(a), r * rm * math.sin(a), z + dz)))
            rings.append(ring)
        F = []
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            for i in range(seg):
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    F.append((a[0], b[i], b[(i + 1) % seg]))
                elif len(b) == 1:
                    F.append((a[i], a[(i + 1) % seg], b[0]))
                else:
                    F.append((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
        if cap_bottom and len(rings[0]) > 2:
            F.append(tuple(reversed(rings[0])))
        if cap_top and len(rings[-1]) > 2:
            F.append(tuple(rings[-1]))
        return self.mesh(V, F, color=color, mat=mat, var=var, smooth=smooth)

    def star(self, center, r, n=5, inner=0.45, h=0.02, color='white', mid=None,
             mid_r=0.35, mat='base', var=0.06, tilt=(0, 0), rot=0.0, cup=0.0, under=False):
        """Flower head: n-petal star fan (cupped), optional underside, and
        a small cone "eye" of colour `mid`.  2n (+2n) (+4) tris."""
        c = v3(center)
        R = Euler((math.radians(tilt[0]), math.radians(tilt[1]), 0), 'XYZ').to_matrix()
        V = [c + R @ Vector((0, 0, h * 0.5))]
        for i in range(2 * n):
            a = rot + math.pi * i / n
            rr = r if i % 2 == 0 else r * inner
            z = cup if i % 2 == 0 else cup * 0.5
            V.append(c + R @ Vector((rr * math.cos(a), rr * math.sin(a), z)))
        F = [(0, 1 + i, 1 + (i + 1) % (2 * n)) for i in range(2 * n)]
        if under:
            V.append(c + R @ Vector((0, 0, -h * 0.5)))
            u = len(V) - 1
            F += [(u, 1 + (i + 1) % (2 * n), 1 + i) for i in range(2 * n)]
        fs = self.mesh(V, F, color=color, mat=mat, var=var)
        mf = []
        if mid:
            mf = self.cyl(r1=r * mid_r, r2=0.0, h=h * 1.2 + cup * 0.5, seg=4,
                          loc=tuple(c + R @ Vector((0, 0, h * 0.3))), rot=(tilt[0], tilt[1], 0),
                          color=mid, mat=mat, var=var, cap=False)
        return fs, mf

    # ------------------------------------------------------------------
    # colour post-processing
    # ------------------------------------------------------------------
    def paint(self, faces, color, var=0.06, mat=None):
        base = col(color)
        for f in faces:
            if not f.is_valid:
                continue
            k = 1.0 + self.rng.uniform(-var, var)
            tint = [self.rng.uniform(-var * 0.35, var * 0.35) for _ in range(3)]
            c = tuple(min(1.0, max(0.0, base[i] * k + tint[i] * base[i])) for i in range(3))
            lc = lin(c) + (1.0,)
            for loop in f.loops:
                loop[self.col_layer] = lc
            if mat is not None:
                f.material_index = MAT_INDEX[mat]

    def shade(self, faces, fn):
        """Multiply face colours by fn(face) (linear space)."""
        for f in faces:
            if not f.is_valid:
                continue
            k = fn(f)
            if k == 1.0:
                continue
            for loop in f.loops:
                c = loop[self.col_layer]
                loop[self.col_layer] = (min(1, c[0] * k), min(1, c[1] * k), min(1, c[2] * k), 1.0)

    def light_from_above(self, faces, up=1.12, down=0.72, side=0.95):
        """Cheap baked sky-light: brighten up-facing, darken down-facing."""
        def fn(f):
            nz = f.normal.z
            if nz >= 0:
                return lerp(side, up, nz)
            return lerp(side, down, -nz)
        for f in faces:
            if f.is_valid:
                f.normal_update()
        self.shade(faces, fn)

    def radial_ao(self, faces, center, r_in, r_out, k_in=0.7):
        """Darken faces close to a vertical axis (inside of a canopy)."""
        cx, cy = center

        def fn(f):
            c = f.calc_center_median()
            d = math.hypot(c.x - cx, c.y - cy)
            t = min(1.0, max(0.0, (d - r_in) / max(1e-4, r_out - r_in)))
            return lerp(k_in, 1.0, t)
        self.shade(faces, fn)

    def moss_top(self, faces, thresh=0.55, color='moss', var=0.1, chance=1.0,
                 zmin=None, noise_fn=None):
        """Re-colour up-facing faces with moss."""
        out = []
        for f in faces:
            if not f.is_valid:
                continue
            f.normal_update()
            if f.normal.z < thresh:
                continue
            if zmin is not None and f.calc_center_median().z < zmin:
                continue
            if noise_fn is not None and not noise_fn(f):
                continue
            if self.rng.random() > chance:
                continue
            out.append(f)
        self.paint(out, color, var=var)
        return out

    def clamp_z(self, zmin=-0.15):
        """Flatten anything buried deeper than zmin (keeps sinks <= 0.15 m)."""
        for v in self.bm.verts:
            if v.co.z < zmin:
                v.co.z = zmin

    def tint_where(self, faces, pred, color, var=0.08, mat=None):
        sel = [f for f in faces if f.is_valid and pred(f)]
        self.paint(sel, color, var=var, mat=mat)
        return sel


def finish(ob, **props):
    """Attach collider metadata (col_r / col_box) as custom properties."""
    for k, v in props.items():
        ob[k] = v
    return ob
