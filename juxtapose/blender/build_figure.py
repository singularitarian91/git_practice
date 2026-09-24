"""
Juxtapose - player character builder.

Builds "the Figment": a de Chirico wooden artist's mannequin in a Magritte
bowler hat, with an apple hovering in front of its face, a red scarf, and the
two-barrelled Juxtaposition Gun. Rigid body parts are bone-parented to an
armature, so the rig exports as a plain node hierarchy (no skinning). All
animation clips are authored procedurally in figure_anims.py and exported
as separate glTF animations.

Run:   python3 juxtapose/blender/build_figure.py            (build + export)
       python3 juxtapose/blender/build_figure.py --preview  (also render pose sheets)

Rig conventions (important for the game code):
  * Every bone points straight up (+Z in Blender) with roll 0, so each bone's
    local axes equal the glTF / three.js world axes in rest pose:
    X = character's left, Y = up, Z = forward (character faces +Z in three.js).
  * Rotations in figure_anims.py are therefore written as (pitch X, yaw Y, roll Z)
    in those axes.
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix, Euler, Quaternion, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import figure_anims as FA  # noqa: E402

OUT = os.path.join(ROOT, 'assets', 'figure.glb')
FPS = 30
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


MATS = {}


def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(color), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    MATS[name] = m
    return m


mat('Wood', '#d2a36c', rough=0.52, coat=0.2)
mat('WoodDark', '#5a3520', rough=0.45)
mat('Brass', '#d6a84e', metal=1.0, rough=0.28)
mat('Felt', '#16171b', rough=0.92)
mat('Ribbon', '#2b1d24', rough=0.6)
mat('Scarf', '#b3262b', rough=0.85)
mat('Apple', '#7cbc3a', rough=0.32, coat=0.4)
mat('Leaf', '#3f7f26', rough=0.6)
mat('Stem', '#4a321d', rough=0.7)
mat('Iron', '#2b2d33', metal=0.85, rough=0.32)
mat('Copper', '#c06b3e', metal=1.0, rough=0.3)
mat('Glass', '#dff6ff', rough=0.05, alpha=0.35)
mat('GunVial', '#9ffcff', rough=0.2, emit='#6ff0ff', strength=4.0)
mat('GunGlow', '#9ffcff', rough=0.3, emit='#6ff0ff', strength=3.0)
mat('Dark', '#0b0b0e', rough=0.8)
mat('Steel', '#c9ced6', metal=1.0, rough=0.18)


# --------------------------------------------------------------------------
# Geometry helpers. Each "part" is a bmesh that later becomes one object
# parented to one bone.
# --------------------------------------------------------------------------
class Part:
    def __init__(self, name, bone):
        self.name, self.bone = name, bone
        self.bm = bmesh.new()
        self.mats = []

    def slot(self, mname):
        if mname not in self.mats:
            self.mats.append(mname)
        return self.mats.index(mname)

    def merge(self, bm, mname, smooth=True):
        i = self.slot(mname)
        for f in bm.faces:
            f.material_index = i
            f.smooth = smooth
        me = bpy.data.meshes.new('tmp')
        bm.to_mesh(me)
        bm.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)


PARTS = {}


def part(name, bone):
    if name not in PARTS:
        PARTS[name] = Part(name, bone)
    return PARTS[name]


def align(a, b):
    d = (Vector(b) - Vector(a))
    return Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), d.length


def ellipsoid(p, center, radii, m, segs=24, rings=14, rot=None, smooth=True):
    bm = bmesh.new()
    M = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=M)
    p.merge(bm, m, smooth)


def lathe(p, a, b, profile, m, segs=20, smooth=True, cap=True):
    """profile: list of (t, r) with t in 0..1 along a->b."""
    R, L = align(a, b)
    M = Matrix.Translation(a) @ R
    bm = bmesh.new()
    rings = []
    for t, r in profile:
        if r <= 1e-5:
            rings.append([bm.verts.new(M @ Vector((0, 0, t * L)))])
            continue
        ring = []
        for i in range(segs):
            ang = 2 * math.pi * i / segs
            ring.append(bm.verts.new(M @ Vector((math.cos(ang) * r, math.sin(ang) * r, t * L))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            for i in range(segs):
                bm.faces.new((r0[0], r1[i], r1[(i + 1) % segs]))
        elif len(r1) == 1:
            for i in range(segs):
                bm.faces.new((r0[(i + 1) % segs], r0[i], r1[0]))
        else:
            for i in range(segs):
                bm.faces.new((r0[i], r0[(i + 1) % segs], r1[(i + 1) % segs], r1[i]))
    if cap:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            if len(ring) > 2:
                f = bm.faces.new(list(reversed(ring)) if flip else ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    p.merge(bm, m, smooth)


def capsule(p, a, b, r0, r1, m, segs=20, bulge=0.12):
    L = (Vector(b) - Vector(a)).length
    prof = [(-(r0 * 0.9) / L, 0.0)]
    for k in range(1, 5):
        ang = k / 5 * math.pi / 2
        prof.append((-(math.cos(ang) * r0 * 0.9) / L, r0 * math.sin(ang)))
    for k in range(0, 9):
        t = k / 8
        prof.append((t, (r0 + (r1 - r0) * t) * (1 + bulge * math.sin(math.pi * t))))
    for k in range(4, 0, -1):
        ang = k / 5 * math.pi / 2
        prof.append((1 + (math.cos(ang) * r1 * 0.9) / L, r1 * math.sin(ang)))
    prof.append((1 + (r1 * 0.9) / L, 0.0))
    lathe(p, a, b, prof, m, segs)


def cylinder(p, a, b, r, m, segs=20, smooth=True, r2=None):
    R, L = align(a, b)
    bm = bmesh.new()
    M = Matrix.Translation((Vector(a) + Vector(b)) / 2) @ R
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r2 is None else r2, depth=L, matrix=M)
    p.merge(bm, m, smooth)


def box(p, center, size, m, bevel=0.006, rot=None, segs=2):
    bm = bmesh.new()
    M = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect='EDGES')
    p.merge(bm, m, smooth=False)


def torus(p, center, R, r, m, axis=(0, 0, 1), segs=28, rsegs=10, arc=2 * math.pi, smooth=True):
    bm = bmesh.new()
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
    M = Matrix.Translation(center) @ rot
    closed = arc >= 2 * math.pi - 1e-6
    n = segs if closed else segs + 1
    rings = []
    for i in range(n):
        a = arc * i / segs
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for j in range(rsegs):
            b = 2 * math.pi * j / rsegs
            v = c + out * math.cos(b) * r + Vector((0, 0, math.sin(b) * r))
            ring.append(bm.verts.new(M @ v))
        rings.append(ring)
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(rsegs):
            bm.faces.new((r0[j], r1[j], r1[(j + 1) % rsegs], r0[(j + 1) % rsegs]))
    p.merge(bm, m, smooth)


# --------------------------------------------------------------------------
# Skeleton definition (name, parent, head position in Blender coords)
# Character faces -Y in Blender (= +Z in three.js). Left side is +X.
# --------------------------------------------------------------------------
HAND_R = Vector((-0.205, 0.0, 0.875))
GUN_S = 1.3
GUN_W = Matrix.Translation(HAND_R) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Diagonal((GUN_S, GUN_S, GUN_S, 1))


def G(x, y, z):
    """Gun-local point -> world (rest pose). Gun local: -Y forward, +Z up, origin at grip centre."""
    return (GUN_W @ Vector((x, y, z, 1.0))).to_3d()


BONES = [
    ('root', None, (0, 0, 0)),
    ('hips', 'root', (0, 0, 0.98)),
    ('spine', 'hips', (0, 0, 1.08)),
    ('chest', 'spine', (0, 0, 1.27)),
    ('neck', 'chest', (0, 0, 1.5)),
    ('head', 'neck', (0, 0, 1.6)),
    ('appleFace', 'head', (0, -0.19, 1.71)),
    ('upperarmL', 'chest', (0.205, 0, 1.45)),
    ('forearmL', 'upperarmL', (0.205, 0, 1.18)),
    ('handL', 'forearmL', (0.205, 0, 0.95)),
    ('upperarmR', 'chest', (-0.205, 0, 1.45)),
    ('forearmR', 'upperarmR', (-0.205, 0, 1.18)),
    ('handR', 'forearmR', (-0.205, 0, 0.95)),
    ('thighL', 'hips', (0.1, 0, 0.93)),
    ('shinL', 'thighL', (0.1, 0, 0.52)),
    ('footL', 'shinL', (0.1, 0, 0.1)),
    ('thighR', 'hips', (-0.1, 0, 0.93)),
    ('shinR', 'thighR', (-0.1, 0, 0.52)),
    ('footR', 'shinR', (-0.1, 0, 0.1)),
    ('scarf1', 'chest', (0.02, 0.085, 1.49)),
    ('scarf2', 'scarf1', (0.025, 0.1, 1.35)),
    ('scarf3', 'scarf2', (0.03, 0.11, 1.21)),
    ('gun', 'handR', tuple(G(0, 0, 0))),
    ('gunHammer', 'gun', tuple(G(0, 0.03, 0.095))),
    ('gunCylinder', 'gun', tuple(G(0, -0.062, 0.072))),
    ('gunBreak', 'gun', tuple(G(0, -0.1, 0.045))),
    ('gunVial', 'gun', tuple(G(0, -0.035, 0.104))),
    ('gunBlade', 'gunBreak', tuple(G(0, -0.392, 0.024))),
    ('muzzleTake', 'gunBreak', tuple(G(0, -0.37, 0.104))),
    ('muzzleGive', 'gunBreak', tuple(G(0, -0.395, 0.05))),
]
BONE_HEAD = {n: Vector(h) for n, _, h in BONES}

# --------------------------------------------------------------------------
# Body modelling
# --------------------------------------------------------------------------
# pelvis / hips
hp = part('Fig_Pelvis', 'hips')
ellipsoid(hp, (0, 0.005, 0.95), (0.155, 0.1, 0.1), 'Wood')
ellipsoid(hp, (0.1, 0, 0.92), (0.06, 0.06, 0.06), 'Brass', 16, 10)
ellipsoid(hp, (-0.1, 0, 0.92), (0.06, 0.06, 0.06), 'Brass', 16, 10)
# abdomen
ab = part('Fig_Abdomen', 'spine')
capsule(ab, (0, 0.005, 1.04), (0, 0.0, 1.22), 0.1, 0.125, 'Wood', 22, 0.08)
ellipsoid(ab, (0, 0, 1.06), (0.05, 0.05, 0.05), 'Brass', 16, 10)
# chest: tapered ribcage egg + shoulder balls + scarf collar
ch = part('Fig_Chest', 'chest')
ellipsoid(ch, (0, 0.01, 1.365), (0.185, 0.12, 0.155), 'Wood', 28, 16)
ellipsoid(ch, (0, -0.02, 1.38), (0.15, 0.1, 0.12), 'Wood', 24, 14)
for sx in (0.205, -0.205):
    ellipsoid(ch, (sx, 0, 1.45), (0.055, 0.055, 0.055), 'Brass', 18, 12)
torus(ch, (0, 0.008, 1.5), 0.072, 0.03, 'Scarf', axis=(0, 0.12, 1), segs=24, rsegs=10)
# scarf knot at front
ellipsoid(ch, (0.03, -0.075, 1.47), (0.035, 0.025, 0.035), 'Scarf', 12, 8)
# neck
nk = part('Fig_Neck', 'neck')
capsule(nk, (0, 0, 1.5), (0, 0, 1.62), 0.042, 0.038, 'Wood', 16, 0.0)
# head: faceless egg + bowler hat
hd = part('Fig_Head', 'head')
ellipsoid(hd, (0, -0.005, 1.72), (0.098, 0.112, 0.128), 'Wood', 28, 18,
          rot=Matrix.Rotation(math.radians(-8), 4, 'X'))
# bowler hat: crown (squashed dome) + curled brim + ribbon band
lathe(hd, (0, 0, 1.79), (0, 0, 1.935), [(0, 0.118), (0.25, 0.121), (0.55, 0.117), (0.75, 0.1),
                                          (0.9, 0.07), (0.98, 0.035), (1.0, 0.0)], 'Felt', 28)
lathe(hd, (0, 0, 1.805), (0, 0, 1.838), [(0, 0.1235), (1.0, 0.1235)], 'Ribbon', 28, cap=False)
torus(hd, (0, 0, 1.797), 0.148, 0.013, 'Felt', segs=36, rsegs=8)
lathe(hd, (0, 0, 1.788), (0, 0, 1.8), [(0, 0.148), (0.5, 0.15), (1.0, 0.122)], 'Felt', 36)
# the apple hovering before the face (Son of Man)
ap = part('Fig_Apple', 'appleFace')
lathe(ap, (0, -0.19, 1.645), (0, -0.19, 1.775),
      [(0, 0.0), (0.04, 0.03), (0.15, 0.055), (0.35, 0.068), (0.6, 0.069), (0.82, 0.058), (0.93, 0.035), (0.97, 0.018), (1.0, 0.0)],
      'Apple', 24)
cylinder(ap, (0, -0.19, 1.765), (0.004, -0.188, 1.8), 0.005, 'Stem', 8)
ellipsoid(ap, (0.03, -0.185, 1.79), (0.03, 0.012, 0.004), 'Leaf', 12, 6, rot=Matrix.Rotation(math.radians(25), 4, 'Y'))

# arms
for side, sx in (('L', 0.205), ('R', -0.205)):
    ua = part('Fig_UpperArm' + side, 'upperarm' + side)
    capsule(ua, (sx, 0, 1.42), (sx, 0, 1.21), 0.05, 0.042, 'Wood', 18)
    ellipsoid(ua, (sx, 0, 1.18), (0.042, 0.042, 0.042), 'Brass', 16, 10)
    fa = part('Fig_Forearm' + side, 'forearm' + side)
    capsule(fa, (sx, 0, 1.15), (sx, 0, 0.975), 0.042, 0.033, 'Wood', 18)
    ellipsoid(fa, (sx, 0, 0.952), (0.03, 0.03, 0.03), 'Brass', 14, 8)
    hn = part('Fig_Hand' + side, 'hand' + side)
    inward = -1 if sx > 0 else 1
    ellipsoid(hn, (sx, -0.005, 0.885), (0.028, 0.048, 0.062), 'Wood', 18, 12)
    capsule(hn, (sx + inward * 0.012, -0.035, 0.915), (sx + inward * 0.02, -0.05, 0.875), 0.014, 0.012, 'Wood', 10, 0)

# legs
for side, sx in (('L', 0.1), ('R', -0.1)):
    th = part('Fig_Thigh' + side, 'thigh' + side)
    capsule(th, (sx, 0, 0.89), (sx, 0, 0.55), 0.072, 0.052, 'Wood', 20)
    ellipsoid(th, (sx, 0, 0.52), (0.05, 0.05, 0.05), 'Brass', 16, 10)
    sh = part('Fig_Shin' + side, 'shin' + side)
    capsule(sh, (sx, 0, 0.49), (sx, 0, 0.14), 0.052, 0.038, 'Wood', 18, 0.14)
    ellipsoid(sh, (sx, 0, 0.1), (0.036, 0.036, 0.036), 'Brass', 14, 8)
    ft = part('Fig_Foot' + side, 'foot' + side)
    ellipsoid(ft, (sx, -0.045, 0.045), (0.05, 0.115, 0.045), 'Wood', 20, 12)
    box(ft, (sx, -0.045, 0.006), (0.09, 0.22, 0.012), 'WoodDark', 0.004)

# scarf tail: three ribbon segments that trail behind (animated procedurally in game)
for i, (b, a, z0, z1) in enumerate((('scarf1', 0.085, 1.49, 1.35), ('scarf2', 0.1, 1.35, 1.21), ('scarf3', 0.11, 1.21, 1.06))):
    sp = part('Fig_Scarf%d' % (i + 1), b)
    w = 0.075 - i * 0.008
    box(sp, (0.02 + i * 0.005, a + 0.008, (z0 + z1) / 2), (w, 0.018, (z0 - z1) + 0.02), 'Scarf', 0.007, segs=2)
    if i == 2:
        for k in range(4):  # frayed end tassels
            cylinder(sp, (0.0 + k * 0.018 - 0.01 + 0.035, a + 0.008, z1 + 0.01), (0.0 + k * 0.018 - 0.01 + 0.035, a + 0.01, z1 - 0.035), 0.004, 'Scarf', 6)

# --------------------------------------------------------------------------
# The Juxtaposition Gun (modelled in gun-local space, see G())
# --------------------------------------------------------------------------
def gl(p):
    return tuple(G(*p))


gun = part('Gun_Frame', 'gun')
S = GUN_S
# grip: walnut, raked back
capsule(gun, gl((0, 0.012, 0.035)), gl((0, 0.028, -0.055)), 0.022 * S, 0.02 * S, 'WoodDark', 16, 0.1)
ellipsoid(gun, gl((0, 0.03, -0.062)), (0.02 * S, 0.02 * S, 0.012 * S), 'Brass', 14, 8,
          rot=Matrix.Rotation(math.radians(90), 4, 'X'))
# frame
box(gun, gl((0, -0.04, 0.07)), (0.044 * S, 0.06 * S, 0.12 * S), 'Brass', 0.006,
    rot=Matrix.Rotation(math.radians(90), 4, 'X'))
box(gun, gl((0, 0.005, 0.075)), (0.04 * S, 0.05 * S, 0.035 * S), 'Brass', 0.005,
    rot=Matrix.Rotation(math.radians(90), 4, 'X'))
# trigger guard + trigger
torus(gun, gl((0, -0.035, 0.03)), 0.022 * S, 0.004 * S, 'Brass', axis=(1, 0, 0), segs=20, rsegs=6, arc=math.pi * 1.3)
cylinder(gun, gl((0, -0.03, 0.045)), gl((0, -0.035, 0.022)), 0.004 * S, 'Iron', 6)
# decorative side plates
for sx in (-1, 1):
    ellipsoid(gun, gl((sx * 0.023, -0.03, 0.07)), (0.004 * S, 0.02 * S, 0.02 * S), 'Copper', 12, 8)

ham = part('Gun_Hammer', 'gunHammer')
box(ham, gl((0, 0.035, 0.105)), (0.012 * S, 0.035 * S, 0.012 * S), 'Iron', 0.003,
    rot=Matrix.Rotation(math.radians(90 + 25), 4, 'X'))
ellipsoid(ham, gl((0, 0.05, 0.115)), (0.009 * S, 0.009 * S, 0.009 * S), 'Iron', 10, 6)

cyl = part('Gun_Cylinder', 'gunCylinder')
cylinder(cyl, gl((0, -0.03, 0.072)), gl((0, -0.094, 0.072)), 0.037 * S, 'Iron', 18)
for k in range(6):  # chamber mouths on the front face + flutes
    a = 2 * math.pi * k / 6
    cx, cz = math.cos(a) * 0.022, 0.072 + math.sin(a) * 0.022
    cylinder(cyl, gl((cx, -0.093, cz)), gl((cx, -0.097, cz)), 0.0075 * S, 'Brass', 10)
    a2 = a + math.pi / 6
    box(cyl, gl((math.cos(a2) * 0.036, -0.062, 0.072 + math.sin(a2) * 0.036)), (0.008 * S, 0.008 * S, 0.05 * S), 'Iron', 0.002,
        rot=Matrix.Rotation(math.radians(90), 4, 'X'))

brk = part('Gun_Barrels', 'gunBreak')
# barrel block
box(brk, gl((0, -0.118, 0.078)), (0.05 * S, 0.085 * S, 0.04 * S), 'Brass', 0.006,
    rot=Matrix.Rotation(math.radians(90), 4, 'X'))
# TAKE barrel (top): copper tube ending in a gramophone bell
cylinder(brk, gl((0, -0.13, 0.104)), gl((0, -0.31, 0.104)), 0.016 * S, 'Copper', 16)
lathe(brk, gl((0, -0.30, 0.104)), gl((0, -0.372, 0.104)),
      [(0, 0.017 * S), (0.4, 0.021 * S), (0.7, 0.03 * S), (0.9, 0.043 * S), (1.0, 0.05 * S)], 'Copper', 22, cap=False)
lathe(brk, gl((0, -0.366, 0.104)), gl((0, -0.372, 0.104)), [(0, 0.043 * S), (1, 0.047 * S)], 'Dark', 22)
torus(brk, gl((0, -0.372, 0.104)), 0.05 * S, 0.004 * S, 'Brass', axis=(0, 1, 0), segs=26, rsegs=6)
# GIVE barrel (bottom): long iron barrel with glowing glass rings
cylinder(brk, gl((0, -0.13, 0.05)), gl((0, -0.395, 0.05)), 0.019 * S, 'Iron', 18)
for y in (-0.2, -0.26, -0.32):
    torus(brk, gl((0, y, 0.05)), 0.021 * S, 0.0065 * S, 'GunGlow', axis=(0, 1, 0), segs=20, rsegs=8)
torus(brk, gl((0, -0.392, 0.05)), 0.02 * S, 0.006 * S, 'Brass', axis=(0, 1, 0), segs=20, rsegs=8)
# rib joining barrels
box(brk, gl((0, -0.22, 0.077)), (0.008 * S, 0.17 * S, 0.02 * S), 'Brass', 0.002,
    rot=Matrix.Rotation(math.radians(90), 4, 'X'))
# front sight
box(brk, gl((0, -0.29, 0.127)), (0.005 * S, 0.012 * S, 0.02 * S), 'Brass', 0.001,
    rot=Matrix.Rotation(math.radians(90), 4, 'X'))

# the palette-knife bayonet: hinged under the give barrel's muzzle, modelled deployed
blade = part('Gun_Blade', 'gunBlade')
cylinder(blade, gl((-0.012, -0.392, 0.024)), gl((0.012, -0.392, 0.024)), 0.009 * S, 'Brass', 12)
box(blade, gl((0, -0.415, 0.02)), (0.012 * S, 0.05 * S, 0.014 * S), 'Brass', 0.003, rot=Matrix.Rotation(math.radians(90), 4, 'X'))
# cranked neck then a long flexible trowel blade with a rounded tip
box(blade, gl((0, -0.445, 0.012)), (0.006 * S, 0.03 * S, 0.01 * S), 'Iron', 0.002, rot=Matrix.Rotation(math.radians(90 + 20), 4, 'X'))
bb = bmesh.new()
outline = []
L0, L1 = 0.46, 0.76
for k in range(0, 13):
    t = k / 12
    y = -(L0 + (L1 - L0) * t)
    w = 0.012 + 0.022 * max(0.0, math.sin(math.pi * min(1.0, t * 1.15))) ** 0.8
    if t > 0.85:
        w *= max(0.0, math.cos((t - 0.85) / 0.15 * math.pi / 2)) ** 0.5
    w = max(w, 0.002)
    outline.append((y, w))
top, bot = [], []
for y, w in outline:
    top.append(bb.verts.new(G(-w, y, 0.004)))
    bot.append(bb.verts.new(G(-w, y, -0.001)))
for y, w in reversed(outline):
    top.append(bb.verts.new(G(w, y, 0.004)))
    bot.append(bb.verts.new(G(w, y, -0.001)))
n = len(top)
bb.faces.new(top)
bb.faces.new(list(reversed(bot)))
for i in range(n):
    bb.faces.new((top[i], top[(i + 1) % n], bot[(i + 1) % n], bot[i]))
bmesh.ops.recalc_face_normals(bb, faces=bb.faces)
blade.merge(bb, 'Steel', smooth=False)

vial = part('Gun_Vial', 'gunVial')
lathe(vial, gl((0, -0.035, 0.104)), gl((0, -0.035, 0.18)),
      [(0, 0.0), (0.02, 0.016 * S), (0.1, 0.019 * S), (0.85, 0.019 * S), (0.95, 0.014 * S), (1, 0)], 'Glass', 18)
lathe(vial, gl((0, -0.035, 0.11)), gl((0, -0.035, 0.168)),
      [(0, 0.0), (0.05, 0.013 * S), (0.9, 0.013 * S), (1, 0)], 'GunVial', 14)
cylinder(vial, gl((0, -0.035, 0.1)), gl((0, -0.035, 0.113)), 0.022 * S, 'Brass', 16)
cylinder(vial, gl((0, -0.035, 0.175)), gl((0, -0.035, 0.186)), 0.018 * S, 'Brass', 16)
ellipsoid(vial, gl((0, -0.035, 0.19)), (0.008 * S, 0.008 * S, 0.008 * S), 'Brass', 10, 6)


# --------------------------------------------------------------------------
# Vertex colours: subtle wood grain + fake AO on the wooden parts
# --------------------------------------------------------------------------
def add_vcols(me, part_obj_mats):
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        mname = part_obj_mats[poly.material_index] if poly.material_index < len(part_obj_mats) else ''
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            if mname == 'Wood':
                co = v.co
                g = noise.noise(Vector((co.x * 6, co.y * 6, co.z * 40)))
                n = noise.noise(co * 25) * 0.04
                k = 0.9 + 0.08 * g + n
                ao = 0.85 + 0.15 * max(0.0, min(1.0, v.normal.z * 0.5 + 0.6))
                c = (k * ao, k * ao * 0.98, k * ao * 0.95, 1)
            else:
                c = (1, 1, 1, 1)
            attr.data[li].color = c


# --------------------------------------------------------------------------
# Armature
# --------------------------------------------------------------------------
arm_data = bpy.data.armatures.new('FigureRig')
arm = bpy.data.objects.new('Figure', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head in BONES:
    b = arm_data.edit_bones.new(name)
    b.head = head
    b.tail = Vector(head) + Vector((0, 0, 0.06))
    b.roll = 0.0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()

for p in PARTS.values():
    me = bpy.data.meshes.new(p.name)
    p.bm.to_mesh(me)
    p.bm.free()
    for mname in p.mats:
        me.materials.append(MATS[mname])
    add_vcols(me, p.mats)
    ob = bpy.data.objects.new(p.name, me)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = p.bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw
bpy.context.view_layer.update()

tris = 0
for ob in scene.objects:
    if ob.type == 'MESH':
        ob.data.calc_loop_triangles()
        tris += len(ob.data.loop_triangles)
print('figure triangles:', tris)

# --------------------------------------------------------------------------
# Animation clips
# --------------------------------------------------------------------------
arm.animation_data_create()
arm.rotation_mode = 'XYZ'
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

KEYED = [n for n, _, _ in BONES if n not in FA.PROCEDURAL_BONES]


def apply_pose(pose):
    for n in KEYED:
        pb = arm.pose.bones[n]
        rx, ry, rz = pose.get(n, FA.DEFAULTS.get(n, (0, 0, 0)))
        pb.rotation_quaternion = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_quaternion()
        pb.location = pose.get(n + '@loc', (0, 0, 0))


def bake_clip(name, fn, frames, loop):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    prev = {}
    for f in range(frames + 1):
        t = f / frames
        pose = fn(t)
        apply_pose(pose)
        for n in KEYED:
            pb = arm.pose.bones[n]
            q = pb.rotation_quaternion.copy()
            if n in prev and prev[n].dot(q) < 0:  # keep quaternion continuity
                q.negate()
                pb.rotation_quaternion = q
            prev[n] = q
            pb.keyframe_insert('rotation_quaternion', frame=f, group=n)
            pb.keyframe_insert('location', frame=f, group=n)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act.frame_range = (0, frames)
    arm.animation_data.action = None
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tr.mute = True
    return act


for name, (fn, seconds, loop) in FA.CLIPS.items():
    frames = max(2, round(seconds * FPS))
    bake_clip(name, fn, frames, loop)
    print('clip', name, frames, 'frames')

# rest pose for export
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)

# --------------------------------------------------------------------------
# Preview renders (optional)
# --------------------------------------------------------------------------
if '--preview' in sys.argv:
    import preview_util
    if '--combat' in sys.argv:
        preview_util.render_pose_sheet(arm, FA, apply_pose, os.path.join(ROOT, 'docs', 'previews'), FPS,
                                       cols=6, tag='combat', poses=FA.PREVIEW_COMBAT)
    elif '--gun' in sys.argv:
        preview_util.render_pose_sheet(arm, FA, apply_pose, os.path.join(ROOT, 'docs', 'previews'), FPS,
                                       cols=4, tag='gun', poses=FA.PREVIEW_GUN, focus='gun')
    else:
        preview_util.render_pose_sheet(arm, FA, apply_pose, os.path.join(ROOT, 'docs', 'previews'), FPS)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
    export_frame_step=1, export_def_bones=False, export_leaf_bone=False,
    export_optimize_animation_size=False, export_anim_single_armature=True,
    export_vertex_color='ACTIVE', export_cameras=False, export_lights=False,
    export_rest_position_armature=True, export_skins=True,
)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

# --------------------------------------------------------------------------
# Character sheet (optional): hero portrait, turnaround, moveset, gun
# --------------------------------------------------------------------------
if '--sheet' in sys.argv:
    import character_sheet
    parts = os.environ.get('SHEET_PARTS', '').split(',') if os.environ.get('SHEET_PARTS') else None
    character_sheet.render_character_sheet(arm, FA, apply_pose, os.path.join(ROOT, 'docs', 'character'), parts)
