#!/usr/bin/env python3
"""
Juxtapose -- tileable PBR texture library.

Every material is a procedural Cycles node graph evaluated on a unit plane
(UV 0..1 = one tile) and baked with Cycles (EMIT passes) to 1024^2 images:

    <name>_albedo.jpg   sRGB base colour
    <name>_normal.jpg   tangent-space normal, OpenGL convention (+Y = +V = up)
    <name>_orm.jpg      R = ambient occlusion, G = roughness, B = metalness

written to juxtapose/assets/tex/ with manifest.json ({name: {tile: metres}})
and, once the whole library exists, an empty READY marker.

    python3 juxtapose/blender/texlib.py                 # everything
    python3 juxtapose/blender/texlib.py --only stucco   # one material
    python3 juxtapose/blender/texlib.py --sheet         # + docs/previews/town_textures.png
    python3 juxtapose/blender/texlib.py --sheet-only    # contact sheet from the JPEGs on disk
    python3 juxtapose/blender/texlib.py --check --res 256   # periodicity self-test

Tiling
  Nothing is tiled by blending.  Every procedural input is periodic by
  construction:
  * noise / voronoi are sampled in 4D on the flat (Clifford) torus
        (cos 2pi u, sin 2pi u, cos 2pi v, sin 2pi v) / 2pi
    so "scale" is simply features per tile, and warping u/v by periodic
    noise before the torus mapping stays periodic;
  * brick / tile / plank / roof-tile patterns use integer counts per tile and
    per-cell hashes of (cell index mod count);
  * the normal map and AO are derived from the baked height field with
    wrap-around (np.roll) finite differences.
  Each bake prints a seam metric: the mean step across the wrap edge divided
  by the mean step between neighbouring interior pixels (1.0 = seamless).

Game usage (three.js)
  texture.wrapS = wrapT = RepeatWrapping; texture.flipY = false;
  texture.repeat.set(1 / tile, 1 / tile)   (meshes are UV'd in metres)
  albedo.colorSpace = SRGBColorSpace; normal/orm stay linear.
  glTF meshes have no tangents, so like GLTFLoader use normalScale (s, -s).
"""
import bpy
import math
import os
import sys
import json
import time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, 'assets', 'tex')
SHEET = os.path.join(PROJ, 'docs', 'previews', 'town_textures.png')
TAU = math.tau


def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip('#')
    return tuple(srgb2lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# ----------------------------------------------------------------------------
# a tiny expression DSL over Cycles shader nodes
# ----------------------------------------------------------------------------
class F:
    """A float socket (or expression) in graph g."""
    __slots__ = ('g', 's')

    def __init__(self, g, s):
        self.g, self.s = g, s

    def _b(self, op, o, rev=False):
        return self.g.math(op, o, self) if rev else self.g.math(op, self, o)

    def __add__(self, o): return self._b('ADD', o)
    def __radd__(self, o): return self._b('ADD', o, True)
    def __sub__(self, o): return self._b('SUBTRACT', o)
    def __rsub__(self, o): return self._b('SUBTRACT', o, True)
    def __mul__(self, o): return self._b('MULTIPLY', o)
    def __rmul__(self, o): return self._b('MULTIPLY', o, True)
    def __truediv__(self, o): return self._b('DIVIDE', o)
    def __rtruediv__(self, o): return self._b('DIVIDE', o, True)
    def __pow__(self, o): return self._b('POWER', o)
    def __neg__(self): return self.g.math('MULTIPLY', self, -1.0)


class C:
    """A colour socket."""
    __slots__ = ('g', 's')

    def __init__(self, g, s):
        self.g, self.s = g, s


class G:
    def __init__(self, nt, shift=0.0):
        self.nt = nt
        self.N = nt.nodes
        tc = self.N.new('ShaderNodeTexCoord')
        sep = self.N.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['UV'], sep.inputs[0])
        self.u = F(self, sep.outputs[0])
        self.v = F(self, sep.outputs[1])
        if shift:
            # periodicity self-test: the same material sampled half a tile over
            self.u, self.v = self.u + shift, self.v + shift
        self._torus_cache = {}
        self._keep = []

    # -- plumbing ---------------------------------------------------------
    def _in(self, sock, val):
        if isinstance(val, (F, C)):
            self.nt.links.new(val.s, sock)
        elif isinstance(val, str):
            sock.default_value = (*hexlin(val), 1.0)
        elif isinstance(val, (tuple, list)):
            if len(sock.default_value) == 4 and len(val) == 3:
                sock.default_value = (*val, 1.0)
            else:
                sock.default_value = val
        else:
            sock.default_value = val

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.N.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        if c is not None:
            self._in(n.inputs[2], c)
        return F(self, n.outputs[0])

    def const(self, x):
        return self.math('ADD', float(x), 0.0)

    # -- scalar helpers ---------------------------------------------------
    def floor(self, x): return self.math('FLOOR', x)
    def fract(self, x): return self.math('FRACT', x)
    def abs(self, x): return self.math('ABSOLUTE', x)
    def sqrt(self, x): return self.math('SQRT', self.math('MAXIMUM', x, 0.0))
    def min(self, a, b): return self.math('MINIMUM', a, b)
    def max(self, a, b): return self.math('MAXIMUM', a, b)
    def mod(self, a, b): return self.math('FLOORED_MODULO', a, b)
    def sin(self, x): return self.math('SINE', x)
    def cos(self, x): return self.math('COSINE', x)
    def clamp(self, x): return self.math('ADD', x, 0.0, clamp=True)
    def smin(self, a, b, k): return self.math('SMOOTH_MIN', a, b, k)

    def lerp(self, a, b, t):
        return a + (b - a) * t if isinstance(a, F) or isinstance(b, F) else self.const(a) + (b - a) * t

    def remap(self, x, a, b, c=0.0, d=1.0, interp='LINEAR'):
        n = self.N.new('ShaderNodeMapRange')
        n.interpolation_type = interp
        n.clamp = True
        self._in(n.inputs['Value'], x)
        self._in(n.inputs['From Min'], a)
        self._in(n.inputs['From Max'], b)
        self._in(n.inputs['To Min'], c)
        self._in(n.inputs['To Max'], d)
        return F(self, n.outputs['Result'])

    def smooth(self, e0, e1, x):
        """smoothstep; e0 > e1 gives the falling edge."""
        if isinstance(e0, F) or isinstance(e1, F):
            t = self.clamp((x - e0) / (e1 - e0))
            return t * t * (3.0 - 2.0 * t)
        if e0 > e1:
            return 1.0 - self.remap(x, e1, e0, interp='SMOOTHSTEP')
        return self.remap(x, e0, e1, interp='SMOOTHSTEP')

    # -- periodic sampling ------------------------------------------------
    def torus(self, u, v, su=1.0, sv=1.0, seed=0):
        """4D point on the flat torus; 1 feature unit == 1/scale tile."""
        key = (id(u.s), id(v.s), su, sv)
        if key not in self._torus_cache:
            ru, rv = su / TAU, sv / TAU
            a, b = u * TAU, v * TAU
            cx, sx, cy, sy = self.cos(a) * ru, self.sin(a) * ru, self.cos(b) * rv, self.sin(b) * rv
            self._torus_cache[key] = (cx, sx, cy, sy)
            self._keep.append((u, v))          # keep the ids in the key alive
        cx, sx, cy, sy = self._torus_cache[key]
        o = (seed * 1.731, seed * 2.419, seed * 0.917, seed * 3.113)
        comb = self.N.new('ShaderNodeCombineXYZ')
        self._in(comb.inputs[0], cx + o[0] if seed else cx)
        self._in(comb.inputs[1], sx + o[1] if seed else sx)
        self._in(comb.inputs[2], cy + o[2] if seed else cy)
        return comb.outputs[0], (sy + o[3] if seed else sy)

    def noise(self, u, v, scale, detail=2.0, rough=0.5, su=1.0, sv=1.0, seed=0, lac=2.0, dist=0.0):
        vec, w = self.torus(u, v, su, sv, seed)
        n = self.N.new('ShaderNodeTexNoise')
        n.noise_dimensions = '4D'
        try:
            n.noise_type = 'FBM'
            n.normalize = True
        except (AttributeError, TypeError):
            pass
        self.nt.links.new(vec, n.inputs['Vector'])
        self._in(n.inputs['W'], w)
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Lacunarity'].default_value = lac
        n.inputs['Distortion'].default_value = dist
        return F(self, n.outputs['Fac'])

    def voronoi(self, u, v, scale, feature='F1', out='Distance', su=1.0, sv=1.0, seed=0,
                rand=1.0, detail=0.0, smooth=1.0):
        vec, w = self.torus(u, v, su, sv, seed)
        n = self.N.new('ShaderNodeTexVoronoi')
        n.voronoi_dimensions = '4D'
        n.feature = feature
        self.nt.links.new(vec, n.inputs['Vector'])
        self._in(n.inputs['W'], w)
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rand
        if 'Detail' in n.inputs:
            n.inputs['Detail'].default_value = detail
        if feature == 'SMOOTH_F1':
            n.inputs['Smoothness'].default_value = smooth
        s = n.outputs[out]
        return C(self, s) if out == 'Color' else F(self, s)

    def hash(self, a, b=0.0, seed=0.0):
        """Uniform 0..1 hash of integer cell coordinates."""
        n = self.N.new('ShaderNodeTexWhiteNoise')
        n.noise_dimensions = '3D'
        comb = self.N.new('ShaderNodeCombineXYZ')
        self._in(comb.inputs[0], a)
        self._in(comb.inputs[1], b)
        comb.inputs[2].default_value = seed * 0.6173 + 0.13
        self.nt.links.new(comb.outputs[0], n.inputs['Vector'])
        return F(self, n.outputs['Value'])

    # -- colour helpers -----------------------------------------------------
    def mix(self, t, a, b, blend='MIX'):
        n = self.N.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        n.clamp_factor = True
        self._in(n.inputs[0], t)
        self._in(n.inputs[6], a)
        self._in(n.inputs[7], b)
        return C(self, n.outputs[2])

    def cmul(self, c, k):
        """colour * scalar (k: float or F)."""
        n = self.N.new('ShaderNodeVectorMath')
        n.operation = 'SCALE'
        self._in(n.inputs[0], c)
        self._in(n.inputs['Scale'], k)
        return C(self, n.outputs[0])

    def ramp(self, t, stops, interp='LINEAR'):
        n = self.N.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        for i, (p, h) in enumerate(stops):
            e = cr.elements[0] if i == 0 else cr.elements.new(p)
            e.position = p
            e.color = (*hexlin(h), 1.0)
        self._in(n.inputs[0], t)
        return C(self, n.outputs[0])

    def combine(self, r, g, b):
        n = self.N.new('ShaderNodeCombineXYZ')
        self._in(n.inputs[0], r)
        self._in(n.inputs[1], g)
        self._in(n.inputs[2], b)
        return C(self, n.outputs[0])

    def emit(self, c):
        em = self.N.new('ShaderNodeEmission')
        self._in(em.inputs['Color'], c)
        em.inputs['Strength'].default_value = 1.0
        out = self.N.new('ShaderNodeOutputMaterial')
        self.nt.links.new(em.outputs[0], out.inputs['Surface'])
        return out


# ----------------------------------------------------------------------------
# the materials.  Each returns albedo (C), rough, metal, height (metres).
# ----------------------------------------------------------------------------
def warp(g, u, v, amt, scale, seed, detail=2.0):
    return (u + (g.noise(u, v, scale, detail, seed=seed) - 0.5) * amt,
            v + (g.noise(u, v, scale, detail, seed=seed + 50) - 0.5) * amt)


def cracks(g, u, v, scale, width, seed, cover=0.5):
    """Hairline cracks: jagged ridge lines of warped fbm, broken into runs."""
    wu, wv = warp(g, u, v, 0.004, scale * 8.0, seed + 3, 2.0)
    n = g.noise(wu, wv, scale, 2.5, 0.5, seed=seed)
    line = g.smooth(width, width * 0.2, g.abs(n - 0.5))
    mask = g.smooth(1.0 - cover - 0.05, 1.0 - cover + 0.05, g.noise(u, v, scale * 0.8, 3.0, seed=seed + 7))
    return line * mask


def sep(g, c, i=0):
    n = g.N.new('ShaderNodeSeparateXYZ')
    g.nt.links.new(c.s, n.inputs[0])
    return F(g, n.outputs[i])


def mat_stucco(g):
    u, v = g.u, g.v
    wu, wv = warp(g, u, v, 0.035, 3.0, 11)
    # trowel work: overlapping shallow scallops + ridges where strokes met
    sc = g.voronoi(wu, wv, 6.0, 'F1', su=1.3, sv=1.0, seed=3)
    scallop = g.smooth(0.15, 0.85, sc)
    sw = g.noise(wu, wv, 9.0, 3.0, 0.55, seed=4)
    ridge = g.smooth(0.8, 1.0, 1.0 - g.abs(sw * 2.0 - 1.0))
    grain = g.noise(u, v, 150.0, 2.0, 0.6, seed=5)
    pock = g.smooth(0.72, 0.8, g.noise(u, v, 70.0, 1.0, seed=6))
    crack = cracks(g, u, v, 2.2, 0.0032, 21, cover=0.4)
    h = 0.0016 * scallop + 0.0009 * ridge + 0.0003 * grain - 0.0006 * pock - 0.001 * crack
    # colour: patchy lime wash over a greyer base coat
    wash = g.noise(u, v, 3.5, 4.0, 0.55, seed=8)
    base = g.mix(wash, '#f2ede3', '#ddd2bd')
    thin = g.smooth(0.56, 0.72, g.noise(wu, wv, 5.0, 4.0, 0.6, seed=9))
    base = g.mix(thin * 0.6, base, '#cbbfa7')
    # rain streaks: long vertical runs, in patches
    st = g.noise(u, v, 1.0, 3.0, 0.6, su=34.0, sv=1.2, seed=12)
    smask = g.smooth(0.4, 0.66, g.noise(u, v, 2.0, 2.0, seed=13))
    streak = g.smooth(0.5, 0.74, st) * smask
    base = g.mix(streak * 0.45, base, '#a3977f')
    # grime blotches, specks, cracks
    dirt = g.smooth(0.5, 0.8, g.noise(u, v, 2.6, 5.0, 0.62, seed=14))
    base = g.mix(dirt * 0.35, base, '#b8ab92')
    base = g.mix(pock * 0.35, base, '#b8ae9c')
    base = g.mix(crack * 0.6, base, '#6e6456')
    rough = g.clamp(0.86 + 0.08 * (wash - 0.5) - 0.07 * ridge + 0.12 * crack + 0.05 * streak)
    return base, rough, 0.0, h


def mat_plaster(g):
    u, v = g.u, g.v
    wu, wv = warp(g, u, v, 0.03, 2.5, 31)
    sc = g.voronoi(wu, wv, 5.0, 'F1', su=1.2, sv=1.0, seed=33)
    scallop = g.smooth(0.2, 0.9, sc)
    sw = g.noise(wu, wv, 7.0, 3.0, 0.5, seed=34)
    ridge = g.smooth(0.85, 1.0, 1.0 - g.abs(sw * 2.0 - 1.0))
    grain = g.noise(u, v, 120.0, 2.0, 0.5, seed=35)
    crack = cracks(g, u, v, 1.8, 0.005, 41, cover=0.25)
    h = 0.0011 * scallop + 0.0006 * ridge + 0.00015 * grain - 0.0008 * crack
    mott = g.noise(u, v, 3.0, 4.0, 0.55, seed=36)
    base = g.mix(mott, '#ead8b9', '#d3b891')
    warmth = g.smooth(0.52, 0.75, g.noise(wu, wv, 1.6, 3.0, seed=37))
    base = g.mix(warmth * 0.5, base, '#d6a676')
    soot = g.smooth(0.58, 0.85, g.noise(u, v, 2.0, 4.0, 0.6, seed=38))
    base = g.mix(soot * 0.25, base, '#9c8468')
    base = g.mix(g.smooth(0.7, 1.0, ridge) * 0.12, base, '#f3e6cc')
    base = g.mix(crack * 0.45, base, '#8a765e')
    rough = g.clamp(0.78 + 0.08 * (mott - 0.5) - 0.06 * ridge + 0.12 * crack)
    return base, rough, 0.0, h


def mat_stone(g):
    """Coursed rubble: 6 irregular courses per 2 m tile, 4-7 stones per course."""
    u, v = g.u, g.v
    NR = 6.0
    vw = v + (g.noise(u, v, 1.5, 2.0, seed=51) - 0.5) * 0.06 \
        + (g.noise(u, v, 1.0, 2.0, su=7.0, sv=3.0, seed=52) - 0.5) * 0.035
    R = vw * NR
    row = g.mod(g.floor(R), NR)
    fy = g.fract(R)
    nr = 4.0 + g.floor(g.hash(row, 1.0, 1) * 3.999)
    ph = g.hash(row, 2.0, 2)
    uw = u + (g.noise(u, v, 1.0, 2.0, su=4.0, sv=9.0, seed=53) - 0.5) * 0.045
    X = uw * nr + ph
    col = g.mod(g.floor(X), nr)
    fx = g.fract(X)
    slen = 2.0 / nr
    dx = g.min(fx, 1.0 - fx) * slen
    dy = g.min(fy, 1.0 - fy) * (2.0 / NR)
    e = g.smin(dx, dy, 0.06) + (g.noise(u, v, 11.0, 3.0, 0.55, seed=54) - 0.5) * 0.055 \
        + (g.noise(u, v, 45.0, 2.0, seed=61) - 0.5) * 0.012
    sid = g.hash(col, row, 3)
    sid2 = g.hash(col, row, 4)
    mortar = g.smooth(0.02, 0.006, e)
    body = g.smooth(0.0, 0.035, e)
    rock = g.noise(u, v, 30.0, 5.0, 0.6, seed=55)
    facet = sep(g, g.voronoi(u, v, 16.0, 'F1', out='Color', seed=56))
    hs = 0.02 * body + 0.012 * sid2 + 0.007 * facet + 0.006 * rock
    hm = -0.014 + 0.004 * g.noise(u, v, 60.0, 2.0, seed=57)
    h = g.lerp(hs, hm, mortar)
    scol = g.ramp(sid, [(0.0, '#8e8472'), (0.16, '#a4927a'), (0.3, '#6c6255'), (0.46, '#b39c7a'),
                        (0.6, '#747069'), (0.74, '#9d8266'), (0.88, '#a9a194'), (1.0, '#7f6a55')])
    mott = g.noise(u, v, 12.0, 4.0, 0.6, seed=62)
    scol = g.mix(g.smooth(0.35, 0.8, mott) * 0.4, scol, '#5f574c')
    scol = g.mix(g.smooth(0.3, 0.6, facet) * g.smooth(0.55, 0.9, rock) * 0.25, scol, '#c2b59c')
    scol = g.mix(g.smooth(0.6, 0.2, body) * 0.3, scol, '#554c42')
    lich = g.smooth(0.74, 0.78, g.noise(u, v, 16.0, 3.0, seed=58)) * g.smooth(0.55, 0.7, g.noise(u, v, 3.0, 2.0, seed=59))
    scol = g.mix(lich * 0.6, scol, '#a9a58a')
    mcol = g.mix(g.noise(u, v, 8.0, 3.0, seed=60), '#b9ab91', '#948670')
    base = g.mix(mortar, scol, mcol)
    rough = g.clamp(g.lerp(0.8 + 0.12 * rock - 0.05 * sid2, 0.96, mortar))
    return base, rough, 0.0, h


def mat_terracotta(g):
    """0.3 m square floor tiles (4 x 4 per 1.2 m tile), 5 mm grout."""
    u, v = g.u, g.v
    X, Y = u * 4.0, v * 4.0
    cx, cy = g.mod(g.floor(X), 4.0), g.mod(g.floor(Y), 4.0)
    fx, fy = g.fract(X), g.fract(Y)
    dx = g.min(fx, 1.0 - fx) * 0.3
    dy = g.min(fy, 1.0 - fy) * 0.3
    e = g.smin(dx, dy, 0.004) + (g.noise(u, v, 40.0, 2.0, seed=71) - 0.5) * 0.003
    tid = g.hash(cx, cy, 5)
    tid2 = g.hash(cx, cy, 6)
    grout = g.smooth(0.0035, 0.0015, e)
    edge = g.smooth(0.002, 0.011, e)
    pits = g.smooth(0.2, 0.05, g.voronoi(u, v, 90.0, 'F1', seed=72)) * g.smooth(0.5, 0.7, g.noise(u, v, 6.0, 2.0, seed=73))
    surf = g.noise(u, v, 25.0, 4.0, 0.55, seed=74)
    chip = g.smooth(0.7, 0.8, g.noise(u, v, 30.0, 3.0, seed=78)) * g.smooth(0.012, 0.004, e)
    h = g.lerp(0.0045 * edge + 0.0007 * (tid2 - 0.5) + 0.0004 * surf - 0.0008 * pits - 0.003 * chip, -0.001, grout)
    tcol = g.ramp(tid, [(0.0, '#9f4e2c'), (0.18, '#b5603a'), (0.4, '#c47650'), (0.55, '#a95636'),
                        (0.7, '#cb8659'), (0.86, '#8e4527'), (1.0, '#b86a44')])
    mott = g.noise(u, v, 10.0, 4.0, 0.6, seed=75)
    tcol = g.mix(g.smooth(0.35, 0.75, mott) * 0.4, tcol, '#7d3c22')
    flash = g.smooth(0.03, 0.0, g.min(dx, dy))
    tcol = g.mix(flash * 0.35, tcol, '#6e3620')
    wear = g.smooth(0.45, 0.75, g.noise(u, v, 1.6, 3.0, seed=76))
    tcol = g.mix(wear * 0.3, tcol, '#d9a07a')
    tcol = g.mix(pits * 0.5, tcol, '#5e3a28')
    tcol = g.mix(chip * 0.6, tcol, '#d59a73')
    dirt = g.smooth(0.55, 0.85, g.noise(u, v, 3.0, 4.0, 0.6, seed=79))
    tcol = g.mix(dirt * 0.3, tcol, '#5d4636')
    gcol = g.mix(g.noise(u, v, 12.0, 2.0, seed=77), '#8f8471', '#6f6555')
    base = g.mix(grout, tcol, gcol)
    rough = g.clamp(g.lerp(0.62 + 0.12 * mott - 0.14 * wear + 0.2 * pits, 0.95, grout))
    return base, rough, 0.0, h


def mat_rooftile(g):
    """Spanish curved tiles.  U runs along the eave (5 cap/channel pairs per
    2 m), V runs up the slope (4 courses per 2 m)."""
    u, v = g.u, g.v
    uw = u + (g.noise(u, v, 4.0, 2.0, seed=81) - 0.5) * 0.006
    P = uw * 5.0
    pcol = g.mod(g.floor(P), 5.0)
    p = g.fract(P)
    # caps (convex) over p 0..0.45, channels (concave) over 0.45..1
    qc = (p - 0.225) * (1.0 / 0.225)
    qn = (p - 0.725) * (1.0 / 0.275)
    capw = g.sqrt(1.0 - qc * qc)
    chan = 1.0 - g.sqrt(1.0 - qn * qn)
    is_cap = g.smooth(0.455, 0.445, p)
    shift = g.lerp(0.5, 0.0, is_cap) + g.hash(pcol, 0.0, 7) * 0.2
    T = v * 4.0 + shift + (g.noise(u, v, 1.0, 2.0, su=10.0, sv=4.0, seed=85) - 0.5) * 0.05
    course = g.mod(g.floor(T), 4.0)
    t = g.fract(T)
    lap = 0.026 * g.smooth(1.0, 0.0, t) + 0.006 * g.smooth(0.0, 0.03, t)
    taper = 1.0 - 0.12 * t
    hc = 0.045 + 0.05 * capw + lap
    hn = 0.038 * chan * taper + lap * 0.8
    h = g.lerp(hn, hc, is_cap)
    seam = g.smooth(0.03, 0.0, g.min(g.abs(p - 0.45), g.min(p, 1.0 - p)))
    under = g.smooth(0.9, 1.0, t)          # shadowed top end, under the next nose
    h = h - 0.02 * seam
    tid = g.hash(pcol * 2.0 + is_cap, course, 8)
    tcol = g.ramp(tid, [(0.0, '#a65a35'), (0.25, '#bd6c42'), (0.45, '#94502f'), (0.65, '#c8845a'),
                        (0.82, '#86472a'), (1.0, '#b3643d')])
    surf = g.noise(u, v, 18.0, 4.0, 0.6, seed=82)
    tcol = g.mix(g.smooth(0.4, 0.8, surf) * 0.35, tcol, '#6f3b22')
    crest = is_cap * g.smooth(0.75, 1.0, capw)
    tcol = g.mix(crest * 0.45, tcol, '#e0a878')
    depth = g.clamp((h - 0.01) / 0.1)
    tcol = g.cmul(tcol, 0.45 + 0.55 * depth)
    soot = (1.0 - is_cap) * g.smooth(0.3, 0.9, 1.0 - chan) * 0.25 + seam * 0.7 + under * 0.6
    tcol = g.mix(soot, tcol, '#2e1e15')
    lich = g.smooth(0.7, 0.74, g.noise(u, v, 22.0, 3.0, seed=83)) * g.smooth(0.5, 0.72, g.noise(u, v, 2.5, 2.0, seed=84))
    tcol = g.mix(lich * 0.8, tcol, '#b7a870')
    rough = g.clamp(0.72 + 0.12 * surf + 0.1 * lich)
    return tcol, rough, 0.0, h + 0.0015 * surf


def mat_wood(g):
    """Weathered vertical planks (10 per 1.5 m) in chipped blue-green paint."""
    u, v = g.u, g.v
    X = u * 10.0
    pk = g.mod(g.floor(X), 10.0)
    fx = g.fract(X)
    ph = g.hash(pk, 0.0, 9)
    dx = g.min(fx, 1.0 - fx) * 0.15
    groove = g.smooth(0.004, 0.0015, dx)
    warpg = g.noise(u, v, 1.0, 3.0, su=3.0, sv=2.0, seed=91)
    k = 70.0 + g.floor(ph * 60.0)
    grain = g.sin((u * k + warpg * 5.0 + ph * 7.0) * TAU) * 0.5 + 0.5
    streak = g.noise(u, v, 1.0, 4.0, 0.6, su=160.0, sv=3.0, seed=92)
    fine = grain * 0.35 + streak * 0.65
    chip = g.noise(u, v, 9.0, 6.0, 0.62, seed=93) + g.smooth(0.03, 0.0, dx) * 0.14 \
        + (g.noise(u, v, 1.0, 2.0, su=10.0, sv=1.0, seed=94) - 0.5) * 0.2
    paint = g.smooth(0.515, 0.535, chip)
    fade = g.noise(u, v, 2.0, 3.0, seed=95)
    pcol = g.mix(fade, '#5e918c', '#8cb3a8')
    pcol = g.mix(g.smooth(0.45, 0.85, streak) * 0.3, pcol, '#4c7672')
    wcol = g.mix(fine, '#67625a', '#9b9587')
    wcol = g.mix(ph * 0.35, wcol, '#7d6f5e')
    base = g.mix(paint, wcol, pcol)
    base = g.mix(groove * 0.85, base, '#2c2721')
    h = 0.0004 * paint + 0.0005 * fine * (1.0 - paint) - 0.006 * groove + 0.0003 * streak
    rough = g.clamp(g.lerp(0.86 - 0.06 * fine, 0.62 + 0.08 * fade, paint) + 0.1 * groove)
    return base, rough, 0.0, h


def mat_oak(g):
    """Dark adzed interior oak; grain runs along U."""
    u, v = g.u, g.v
    warpg = g.noise(u, v, 1.0, 4.0, 0.55, su=2.0, sv=5.0, seed=101)
    rings = g.sin((v * 36.0 + warpg * 7.0) * TAU) * 0.5 + 0.5
    rings = g.smooth(0.2, 0.95, rings)
    streak = g.noise(u, v, 1.0, 5.0, 0.62, su=3.0, sv=70.0, seed=102)
    pores = g.smooth(0.64, 0.72, g.noise(u, v, 1.0, 1.0, su=24.0, sv=220.0, seed=103))
    chk = g.noise(u, v, 1.0, 3.0, su=2.5, sv=14.0, seed=104)
    check = g.smooth(0.006, 0.0, g.abs(chk - 0.5)) * g.smooth(0.62, 0.7, g.noise(u, v, 2.0, 2.0, seed=105))
    adze = g.voronoi(u, v, 1.0, 'F1', su=9.0, sv=6.0, seed=106)
    tone = g.noise(u, v, 1.5, 3.0, seed=107)
    base = g.mix(g.smooth(0.25, 0.75, streak), '#2a1c12', '#5c4029')
    base = g.mix(rings * 0.4, base, '#22160d')
    base = g.mix(g.smooth(0.45, 0.8, tone) * 0.35, base, '#6a4a2f')
    base = g.mix(pores * 0.45, base, '#1a110b')
    base = g.mix(check, base, '#100a06')
    h = 0.0014 * g.smooth(0.0, 0.8, adze) + 0.0002 * rings - 0.0004 * pores - 0.003 * check
    rough = g.clamp(0.58 + 0.12 * streak - 0.08 * tone + 0.25 * check)
    return base, rough, 0.0, h


def mat_schist(g):
    """Cap de Creus: folded dark schist broken into angular facets, with quartz
    lenses, rust and lichen.  Foliation runs along U (10 beds per 8 m tile)
    but stays subdued so big cliff faces do not read as striped."""
    u, v = g.u, g.v
    NL = 10.0
    fold = (g.noise(u, v, 1.4, 3.0, 0.5, su=1.0, sv=0.8, seed=111) - 0.5) * 3.0 \
        + (g.noise(u, v, 4.0, 3.0, 0.55, seed=112) - 0.5) * 0.9
    L = v * NL + fold
    li = g.mod(g.floor(L), NL)
    lf = g.fract(L)
    hard = g.hash(li, 0.0, 10)
    hard2 = g.hash(li, 1.0, 11)
    ero = (g.noise(u, v, 12.0, 4.0, 0.6, seed=122) - 0.5) * 0.4
    plate = g.smooth(0.0, 0.35, lf + ero) * g.smooth(1.0, 0.6, lf - ero)
    # angular fracture facets (joint-bounded blocks), stretched along the foliation
    fac = sep(g, g.voronoi(u, v, 6.0, 'F1', out='Color', su=1.6, sv=1.0, seed=127))
    fe = g.voronoi(u, v, 6.0, 'DISTANCE_TO_EDGE', su=1.6, sv=1.0, seed=127)
    fcrack = g.smooth(0.02, 0.0, fe) * g.smooth(0.5, 0.66, g.noise(u, v, 2.0, 2.0, seed=128))
    fac2 = sep(g, g.voronoi(u, v, 17.0, 'F1', out='Color', su=1.4, sv=1.0, seed=129))
    rough_r = g.noise(u, v, 24.0, 5.0, 0.62, seed=114)
    big = g.noise(u, v, 2.0, 3.0, seed=124)
    h = 0.025 * plate * (0.3 + 0.7 * hard) + 0.035 * fac + 0.012 * fac2 + 0.02 * rough_r - 0.02 * fcrack + 0.04 * big
    lcol = g.ramp(g.lerp(hard2, big, 0.55), [(0.0, '#3f3e3a'), (0.25, '#53524c'), (0.45, '#625f55'),
                                            (0.62, '#4b5044'), (0.8, '#5a5348'), (1.0, '#403f3b')])
    lcol = g.mix(g.smooth(0.3, 0.9, fac) * 0.3, lcol, '#7b766a')
    lcol = g.mix(g.smooth(0.5, 0.1, fac2) * 0.18, lcol, '#2e2c29')
    lcol = g.mix(g.smooth(0.35, 0.0, plate) * 0.14, lcol, '#2f2d2a')
    patch = g.noise(u, v, 1.5, 4.0, 0.6, seed=126)
    lcol = g.mix(g.smooth(0.45, 0.75, patch) * 0.3, lcol, '#8a857a')
    lcol = g.mix(g.smooth(0.55, 0.25, patch) * 0.25, lcol, '#2f2e2b')
    quartz = g.smooth(0.76, 0.81, g.noise(u, v, 1.0, 3.0, su=5.0, sv=22.0, seed=115)) * g.smooth(0.45, 0.6, hard)
    lcol = g.mix(quartz * 0.8, lcol, '#d9d1c1')
    rust = g.smooth(0.55, 0.8, g.noise(u, v, 1.0, 4.0, 0.6, su=4.0, sv=1.6, seed=116))
    lcol = g.mix(rust * 0.5, lcol, '#8a5733')
    lich_o = g.smooth(0.76, 0.8, g.noise(u, v, 40.0, 3.0, seed=117)) * g.smooth(0.55, 0.75, g.noise(u, v, 3.0, 2.0, seed=118))
    lich_g = g.smooth(0.74, 0.78, g.noise(u, v, 30.0, 3.0, seed=119)) * g.smooth(0.5, 0.7, g.noise(u, v, 2.5, 2.0, seed=120))
    lcol = g.mix(lich_o * 0.85, lcol, '#c98a3c')
    lcol = g.mix(lich_g * 0.7, lcol, '#a8aa98')
    lcol = g.mix(fcrack * 0.4, lcol, '#26231f')
    rough = g.clamp(0.8 - 0.15 * hard * fac + 0.1 * rough_r + 0.1 * fcrack)
    h = h + 0.004 * lich_o
    return lcol, rough, 0.0, h


def mat_marble(g):
    u, v = g.u, g.v
    f1 = g.noise(u, v, 2.0, 4.0, 0.55, seed=131)
    f2 = g.noise(u, v, 3.5, 3.5, 0.55, seed=132)
    s1 = g.abs(g.sin((u * 1.0 + v * 1.0) * TAU + (f1 - 0.5) * 14.0))
    s2 = g.abs(g.sin((u * 3.0 - v * 2.0) * TAU + (f2 - 0.5) * 16.0))
    wid = 0.03 + 0.07 * g.noise(u, v, 2.0, 2.0, seed=137)
    vein = g.smooth(wid, 0.0, s1)
    vein2 = g.smooth(0.02, 0.0, s2) * g.smooth(0.4, 0.6, g.noise(u, v, 3.0, 2.0, seed=133))
    halo = g.smooth(0.4, 0.0, s1)
    cloud = g.noise(u, v, 2.5, 5.0, 0.6, seed=134)
    base = g.mix(cloud, '#f0ece3', '#d8d2c4')
    base = g.mix(g.smooth(0.55, 0.8, cloud) * 0.4, base, '#bdb8ad')
    base = g.mix(halo * 0.35, base, '#c9c0ae')
    base = g.mix(vein * 0.8, base, '#716d67')
    base = g.mix(vein2 * 0.7, base, '#a68a5f')
    weather = g.smooth(0.45, 0.8, g.noise(u, v, 2.0, 4.0, 0.6, seed=135))
    base = g.mix(weather * 0.25, base, '#bdb5a3')
    pits = g.smooth(0.73, 0.8, g.noise(u, v, 90.0, 1.0, seed=136)) * weather
    base = g.mix(pits * 0.5, base, '#8d8676')
    h = -0.0003 * vein - 0.0005 * pits + 0.0002 * cloud
    rough = g.clamp(0.24 + 0.3 * weather + 0.2 * pits + 0.05 * vein)
    return base, rough, 0.0, h


def mat_sandstone(g):
    """Ashlar: 4 courses of 0.5 m, blocks 1.0 m, half-bond."""
    u, v = g.u, g.v
    Y = v * 4.0
    row = g.mod(g.floor(Y), 4.0)
    fy = g.fract(Y)
    X = u * 2.0 + g.mod(row, 2.0) * 0.5 + (g.hash(row, 3.0, 17) - 0.5) * 0.3
    col = g.mod(g.floor(X), 2.0)
    fx = g.fract(X)
    dx = g.min(fx, 1.0 - fx) * 1.0
    dy = g.min(fy, 1.0 - fy) * 0.5
    chipn = (g.noise(u, v, 14.0, 4.0, 0.6, seed=141) - 0.5) * 0.03
    e = g.min(dx, dy) + chipn
    bid = g.hash(col, row, 12)
    bid2 = g.hash(col, row, 13)
    joint = g.smooth(0.007, 0.003, e)
    arris = g.smooth(0.0, 0.012, e)
    tool = g.sin((u * 60.0 + v * 60.0) * TAU + (g.noise(u, v, 8.0, 2.0, seed=142) - 0.5) * 4.0) * 0.5 + 0.5
    alv = g.smooth(0.35, 0.05, g.voronoi(u, v, 36.0, 'F1', seed=143)) * g.smooth(0.6, 0.75, g.noise(u, v, 3.0, 3.0, seed=144))
    grit = g.noise(u, v, 90.0, 3.0, 0.6, seed=145)
    bump = g.noise(u, v, 8.0, 4.0, 0.6, seed=148)
    bed = g.sin((v * 24.0 + (g.noise(u, v, 2.0, 3.0, seed=146) - 0.5) * 2.5) * TAU) * 0.5 + 0.5
    h = g.lerp(0.005 * arris + 0.0005 * tool + 0.0008 * grit + 0.003 * bump - 0.005 * alv + 0.002 * bid2,
               -0.009, joint)
    bcol = g.ramp(bid, [(0.0, '#cf9f66'), (0.25, '#b98752'), (0.5, '#ddb680'), (0.72, '#a9794a'),
                        (0.88, '#c79a66'), (1.0, '#d6aa72')])
    bcol = g.mix(bed * 0.22, bcol, '#a97a47')
    bcol = g.mix(g.smooth(0.3, 0.8, grit) * 0.25, bcol, '#e6c894')
    bcol = g.mix(g.smooth(0.4, 0.75, bump) * 0.3, bcol, '#9c7449')
    bcol = g.mix(alv * 0.6, bcol, '#7d5a38')
    stain = g.smooth(0.55, 0.85, g.noise(u, v, 1.0, 3.0, su=6.0, sv=1.5, seed=147))
    bcol = g.mix(stain * 0.25, bcol, '#8e6a48')
    bcol = g.mix(g.smooth(0.02, 0.0, e) * 0.35, bcol, '#8d6a47')
    base = g.mix(joint, bcol, '#9d8768')
    rough = g.clamp(0.88 + 0.08 * grit - 0.05 * tool)
    return base, rough, 0.0, h


def mat_iron(g):
    u, v = g.u, g.v
    dent = g.voronoi(u, v, 22.0, 'F1', seed=151)
    hammer = g.smooth(0.0, 0.9, dent)
    rn = g.noise(u, v, 9.0, 6.0, 0.65, seed=152) + (g.noise(u, v, 1.0, 3.0, su=16.0, sv=2.0, seed=156) - 0.5) * 0.25
    rust = g.smooth(0.56, 0.64, rn)
    speck = g.smooth(0.7, 0.76, g.noise(u, v, 70.0, 2.0, seed=157))
    rust = g.max(rust, speck * 0.8)
    flake = g.smooth(0.6, 0.7, g.noise(u, v, 60.0, 3.0, 0.6, seed=153))
    scale_ = g.noise(u, v, 30.0, 4.0, 0.6, seed=154)
    icol = g.mix(g.noise(u, v, 8.0, 3.0, seed=155), '#2a2927', '#3c3d3f')
    icol = g.mix(g.smooth(0.3, 0.9, hammer) * 0.25, icol, '#1c1b1a')
    rcol = g.ramp(scale_, [(0.0, '#5c2f18'), (0.4, '#7c4020'), (0.7, '#9a5a2b'), (1.0, '#b06e37')])
    edge = g.smooth(0.52, 0.56, rn) * (1.0 - rust)
    base = g.mix(rust, icol, rcol)
    base = g.mix(edge * 0.6, base, '#4a3020')
    h = 0.0006 * hammer + rust * (0.0004 + 0.0008 * flake + 0.0004 * scale_)
    rough = g.clamp(g.lerp(0.42 + 0.12 * hammer, 0.88 + 0.08 * flake, rust))
    metal = g.clamp(1.0 - rust * 1.1)
    return base, rough, metal, h


# name: (builder, tile metres, normal gain, AO strength, AO radius metres)
LIBRARY = {
    'stucco':     (mat_stucco, 3.0, 4.0, 0.9, 0.025),
    'plaster':    (mat_plaster, 3.0, 4.0, 0.7, 0.02),
    'stone':      (mat_stone, 2.0, 1.6, 1.2, 0.06),
    'terracotta': (mat_terracotta, 1.2, 2.2, 1.0, 0.02),
    'rooftile':   (mat_rooftile, 2.0, 1.4, 1.1, 0.1),
    'wood':       (mat_wood, 1.5, 2.5, 1.0, 0.02),
    'oak':        (mat_oak, 1.0, 2.5, 0.8, 0.015),
    'schist':     (mat_schist, 8.0, 1.2, 1.1, 0.25),
    'marble':     (mat_marble, 2.0, 3.0, 0.6, 0.01),
    'sandstone':  (mat_sandstone, 2.0, 2.0, 1.0, 0.05),
    'iron':       (mat_iron, 1.0, 3.0, 0.8, 0.01),
}


# ----------------------------------------------------------------------------
# baking
# ----------------------------------------------------------------------------
def scene_setup(samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.render.bake.margin = 0
    sc.render.threads_mode = 'AUTO'
    me = bpy.data.meshes.new('BakePlane')
    me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for lp, (x, y) in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        lp.uv = (x, y)
    ob = bpy.data.objects.new('BakePlane', me)
    sc.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    return sc, ob


def bake_pass(ob, mat, out_node_fn, res):
    """Rebuild the output of mat, bake EMIT into a float image, return HxWx3 (row 0 = v 0)."""
    img = bpy.data.images.new('_bake', res, res, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    nt = mat.node_tree
    for n in [n for n in nt.nodes if n.type in ('OUTPUT_MATERIAL', 'EMISSION', 'TEX_IMAGE')]:
        nt.nodes.remove(n)
    out_node_fn()
    it = nt.nodes.new('ShaderNodeTexImage')
    it.image = img
    nt.nodes.active = it
    bpy.ops.object.bake(type='EMIT', margin=0)
    buf = np.empty(res * res * 4, np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(res, res, 4)[..., :3].copy()


def seam_metric(a):
    """wrap step / interior step (per axis); ~1.0 means seamless."""
    a = a if a.ndim == 2 else a.mean(axis=2)
    iu = np.abs(np.diff(a, axis=1)).mean() + 1e-9
    iv = np.abs(np.diff(a, axis=0)).mean() + 1e-9
    return np.abs(a[:, 0] - a[:, -1]).mean() / iu, np.abs(a[0] - a[-1]).mean() / iv


def blur_wrap(a, r):
    """Separable box-ish blur (3 passes) with wrap-around."""
    for _ in range(3):
        for ax in (0, 1):
            acc = a.copy()
            for k in range(1, r + 1):
                acc += np.roll(a, k, axis=ax) + np.roll(a, -k, axis=ax)
            a = acc / (2 * r + 1)
    return a


def height_ao(h, texel, radius_m, strength):
    """Horizon-based cavity AO from a periodic height field (metres)."""
    n = h.shape[0]
    rmax = max(2, int(round(radius_m / texel)))
    steps = sorted({max(1, int(round(rmax * f))) for f in (0.06, 0.12, 0.2, 0.3, 0.45, 0.65, 0.85, 1.0)})
    occ = np.zeros_like(h)
    dirs = 8
    for k in range(dirs):
        a = TAU * (k + 0.5) / dirs
        best = np.zeros_like(h)
        for s in steps:
            dx, dy = int(round(math.cos(a) * s)), int(round(math.sin(a) * s))
            if dx == 0 and dy == 0:
                continue
            d = math.hypot(dx, dy) * texel
            sh = np.roll(np.roll(h, dy, axis=0), dx, axis=1)
            slope = (sh - h) / d
            # fade contributions with distance
            w = 1.0 - (math.hypot(dx, dy) / (rmax + 1)) ** 2
            best = np.maximum(best, slope * w)
        occ += best / np.sqrt(1.0 + best * best)
    occ /= dirs
    return np.clip(1.0 - occ * strength, 0.0, 1.0)


def normal_from_height(h, texel, gain):
    hs = blur_wrap(h, 1)
    dx = (np.roll(hs, -1, axis=1) - np.roll(hs, 1, axis=1)) / (2 * texel)
    dy = (np.roll(hs, -1, axis=0) - np.roll(hs, 1, axis=0)) / (2 * texel)   # +row = +V = up
    nx, ny, nz = -dx * gain, -dy * gain, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1)


def lin2srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_jpg(arr01, path, quality=88):
    from PIL import Image
    im = np.flipud(np.clip(arr01 * 255.0 + 0.5, 0, 255).astype(np.uint8))   # top row = v 1
    Image.fromarray(im, 'RGB').save(path, quality=quality, optimize=True)


def build_material(name, fn, shift=0.0):
    m = bpy.data.materials.new('TEX_' + name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    g = G(m.node_tree, shift)
    albedo, rough, metal, height = fn(g)
    return m, g, albedo, rough, metal, height


def bake_material(ob, name, res, keep):
    fn, tile, ngain, ao_str, ao_rad = LIBRARY[name]
    t0 = time.time()
    m, g, albedo, rough, metal, height = build_material(name, fn)
    ob.data.materials.clear()
    ob.data.materials.append(m)
    alb = bake_pass(ob, m, lambda: g.emit(albedo), res)
    data = bake_pass(ob, m, lambda: g.emit(g.combine(height + 0.5, rough, metal)), res)
    h = data[..., 0] - 0.5
    texel = tile / res
    ao = height_ao(h, texel, ao_rad, ao_str)
    nrm = normal_from_height(h, texel, ngain)
    # a touch of cavity in the albedo so relief survives flat lighting
    alb = alb * (0.72 + 0.28 * ao)[..., None]
    orm = np.stack([ao, np.clip(data[..., 1], 0.02, 1.0), np.clip(data[..., 2], 0.0, 1.0)], axis=-1)
    os.makedirs(OUT, exist_ok=True)
    save_jpg(lin2srgb(alb), os.path.join(OUT, name + '_albedo.jpg'))
    save_jpg(nrm * 0.5 + 0.5, os.path.join(OUT, name + '_normal.jpg'))
    save_jpg(orm, os.path.join(OUT, name + '_orm.jpg'))
    su, sv = seam_metric(alb)
    hu, hv = seam_metric(h)
    sizes = [os.path.getsize(os.path.join(OUT, name + s)) for s in ('_albedo.jpg', '_normal.jpg', '_orm.jpg')]
    print('%-11s tile %.1fm  nodes %4d  seam(albedo) %.2f/%.2f seam(height) %.2f/%.2f  '
          'h[%.4f..%.4f]  rough %.2f  metal %.2f  ao %.2f  %4.0f KB  %.1fs' % (
              name, tile, len(m.node_tree.nodes), su, sv, hu, hv, h.min(), h.max(),
              orm[..., 1].mean(), orm[..., 2].mean(), ao.mean(), sum(sizes) / 1024, time.time() - t0))
    if keep is not None:
        keep[name] = (lin2srgb(alb), nrm, orm)
    bpy.data.materials.remove(m)
    return max(su, sv, hu, hv)


def periodicity_check(ob, name, res):
    """Bake albedo+height with UV shifted by half a tile; a periodic material
    gives the unshifted bake rolled by res/2 (difference ~ sampling noise)."""
    fn = LIBRARY[name][0]
    out = []
    for shift in (0.0, 0.5):
        m, g, albedo, rough, metal, height = build_material(name, fn, shift)
        ob.data.materials.clear()
        ob.data.materials.append(m)
        a = bake_pass(ob, m, lambda: g.emit(albedo), res)
        d = bake_pass(ob, m, lambda: g.emit(g.combine(height + 0.5, rough, metal)), res)
        out.append((a, d[..., 0]))
        bpy.data.materials.remove(m)
    (a0, h0), (a1, h1) = out
    k = res // 2
    ra = np.abs(np.roll(np.roll(a0, -k, 0), -k, 1) - a1).mean() / (np.abs(a0 - a0.mean()).mean() + 1e-9)
    rh = np.abs(np.roll(np.roll(h0, -k, 0), -k, 1) - h1).mean() / (np.abs(h0 - h0.mean()).mean() + 1e-9)
    # a non-periodic control: compare against the unrolled image
    ctrl = np.abs(a0 - a1).mean() / (np.abs(a0 - a0.mean()).mean() + 1e-9)
    print('%-11s periodicity error: albedo %.3f height %.3f   (non-periodic control %.3f)' % (name, ra, rh, ctrl))
    return max(ra, rh)


def contact_sheet(keep, path):
    """2x2-tiled, relief-lit swatches (seams would show as lines across the middle)."""
    from PIL import Image, ImageDraw
    names = [n for n in LIBRARY if n in keep]
    cell, cols = 384, 4
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGB', (cell * cols, (cell + 22) * rows), (24, 22, 20))
    L = np.array([-0.45, 0.55, 0.7])
    L /= np.linalg.norm(L)
    for i, n in enumerate(names):
        alb, nrm, orm = keep[n]
        half = cell // 2
        idx = (np.arange(half) * alb.shape[0]) // half
        a = alb[idx][:, idx]
        nn = nrm[idx][:, idx]
        o = orm[idx][:, idx]
        lam = np.clip((nn * L).sum(-1), 0, 1)
        shade = (0.45 + 0.75 * lam) * (0.6 + 0.4 * o[..., 0])
        lit = np.clip(a * shade[..., None], 0, 1)
        tiled = np.tile(np.flipud(lit), (2, 2, 1))
        im = Image.fromarray((tiled * 255).astype(np.uint8), 'RGB')
        x, y = (i % cols) * cell, (i // cols) * (cell + 22)
        sheet.paste(im, (x, y + 22))
        ImageDraw.Draw(sheet).text((x + 6, y + 5), '%s  (tile %.1f m, shown 2x2)' % (n, LIBRARY[n][1]),
                                   fill=(235, 225, 205))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    print('wrote', path)


def sheet_from_disk(path):
    """Rebuild the contact sheet from the JPEGs already in assets/tex."""
    from PIL import Image
    keep = {}
    for n in LIBRARY:
        try:
            ld = lambda k: np.flipud(np.asarray(Image.open(os.path.join(OUT, '%s_%s.jpg' % (n, k))).convert('RGB'),
                                                np.float32) / 255.0)
            alb, nrm, orm = ld('albedo'), ld('normal') * 2.0 - 1.0, ld('orm')
        except FileNotFoundError:
            continue
        keep[n] = (alb, nrm, orm)
    contact_sheet(keep, path)


def write_manifest():
    man = {n: {'tile': LIBRARY[n][1]} for n in LIBRARY}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=2)
        f.write('\n')


def complete():
    return all(os.path.exists(os.path.join(OUT, n + s)) for n in LIBRARY
               for s in ('_albedo.jpg', '_normal.jpg', '_orm.jpg'))


def main():
    argv = sys.argv[1:]
    only = None
    res = 1024
    samples = 16
    if '--only' in argv:
        only = argv[argv.index('--only') + 1].split(',')
    if '--res' in argv:
        res = int(argv[argv.index('--res') + 1])
    if '--samples' in argv:
        samples = int(argv[argv.index('--samples') + 1])
    sheet = '--sheet' in argv
    if '--sheet-only' in argv:
        sheet_from_disk(SHEET)
        return 0
    names = [n for n in LIBRARY if not only or n in only]
    sc, ob = scene_setup(samples)
    if '--check' in argv:
        worst = max(periodicity_check(ob, n, res) for n in names)
        print('worst periodicity error %.3f' % worst)
        return 0
    keep = {} if sheet else None
    t0 = time.time()
    worst = 0.0
    for n in names:
        worst = max(worst, bake_material(ob, n, res, keep))
    write_manifest()
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print('library: %d materials baked in %.0fs, folder %.2f MB, worst seam ratio %.2f' % (
        len(names), time.time() - t0, total / 1e6, worst))
    if sheet and keep:
        contact_sheet(keep, SHEET)
    if complete() and res == 1024:
        open(os.path.join(OUT, 'READY'), 'w').close()
        print('wrote', os.path.join(OUT, 'READY'))
    return 0


if __name__ == '__main__':
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
