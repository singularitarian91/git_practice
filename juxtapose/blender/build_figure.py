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
  * The Figment wears an oversize Magritte overcoat cut like a haori over pleated
    hakama. The hanging coat panels and sleeve drapes ride their own chain bones
    (coatSide*/coatBack*/sleeve*): not keyed, hanging along local -Y from the bone
    head; +X swings a panel backward, +Z swings the left panels outward (-Z the
    right). The game drives them with springs; pose_cloth() mimics it for previews.
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
mat('TieRed', '#b3262b', rough=0.72)          # the red tie, and the scarf-tail that streams from the collar
mat('SuitCloth', '#2e3647', rough=0.9)         # Magritte's overcoat, cut like a haori; hakama beneath
mat('ShirtCloth', '#ebe6da', rough=0.82)
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
    def __init__(self, name, bone, tint=(1, 1, 1), axis=None):
        self.name, self.bone = name, bone
        self.bm = bmesh.new()
        self.mats = []
        self.tint = tint    # vertex-colour tint for cloth
        self.axis = axis    # (x, y) of the vertical axis the cloth wraps: faces pointing at it are the lining

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


def part(name, bone, tint=(1, 1, 1), axis=None):
    if name not in PARTS:
        PARTS[name] = Part(name, bone, tint, axis)
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


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def ss(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def keys(table, z):
    """Linear interpolation in a table of (z, a, b, ...) rows (any z order); returns (a, b, ...)."""
    rows = sorted(table)
    if z <= rows[0][0]:
        return rows[0][1:]
    if z >= rows[-1][0]:
        return rows[-1][1:]
    for r0, r1 in zip(rows, rows[1:]):
        if r0[0] <= z <= r1[0]:
            t = (z - r0[0]) / (r1[0] - r0[0])
            return tuple(lerp(a, b, t) for a, b in zip(r0[1:], r1[1:]))


def sheet(p, fn, nu, nv, m, thick=0.01, closed=False, out=None, smooth=True):
    """Cloth panel: fn(u, v) -> point for u, v in 0..1 (u around, v down). The surface is the
    outside of the cloth; it is given `thick`ness inward (hems and edges read as real fabric).
    out(point) -> a vector pointing away from the body, used to orient the faces."""
    bm = bmesh.new()
    cols = nu if closed else nu + 1
    grid = [[bm.verts.new(fn(i / nu, j / nv)) for i in range(cols)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            a, b = grid[j][i], grid[j][(i + 1) % cols]
            c, d = grid[j + 1][(i + 1) % cols], grid[j + 1][i]
            if len({a, b, c, d}) == 4:
                bm.faces.new((a, b, c, d))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    if out is not None:
        vote = sum(f.normal.dot(out(f.calc_center_median())) * f.calc_area() for f in bm.faces)
        if vote < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
    if thick:
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thick)
    p.merge(bm, m, smooth)


def radial(cx, cy):
    return lambda c: Vector((c.x - cx, c.y - cy, 0.0))


def pleat(ph, n, amp):
    """Knife pleats: a sawtooth around the tube (sharp fold, then the pressed face)."""
    f = (n * ph / (2 * math.pi)) % 1.0
    return amp * f


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
    # the scarf tail rises out of the coat collar at the nape and lies on the coat's back
    ('scarf1', 'chest', (0.02, 0.105, 1.56)),
    ('scarf2', 'scarf1', (0.03, 0.188, 1.38)),
    ('scarf3', 'scarf2', (0.035, 0.198, 1.22)),
    # cloth chains: hanging coat panels + kimono sleeve drapes (swung procedurally in game)
    ('coatSideL1', 'hips', (0.2, -0.01, 0.995)),
    ('coatSideR1', 'hips', (-0.2, -0.01, 0.995)),
    ('coatBackL1', 'hips', (0.085, 0.15, 0.995)),
    ('coatBackL2', 'coatBackL1', (0.1, 0.215, 0.66)),
    ('coatBackR1', 'hips', (-0.085, 0.15, 0.995)),
    ('coatBackR2', 'coatBackR1', (-0.1, 0.215, 0.66)),
    ('sleeveL1', 'forearmL', (0.205, 0.07, 1.175)),
    ('sleeveR1', 'forearmR', (-0.205, 0.07, 1.175)),
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

# --------------------------------------------------------------------------
# The suit: Magritte's overcoat, oversized and cut like a haori over wide
# pleated hakama. White shirt, red tie; the red scarf-tail still streams
# from the collar. Cloth is rigid too, so it is split across the bones that
# move it: the coat body rides chest/spine, sleeves ride the arm bones, the
# hakama legs ride thighs/shins, and the long hanging panels and sleeve
# drapes get their own chain bones (coat*/sleeve*) that the game swings
# with damped springs, like the scarf.
# --------------------------------------------------------------------------
TAU = 2 * math.pi
HAKAMA = (0.68, 0.69, 0.72)     # tint: the hakama read a shade darker/greyer than the coat
SASH = (0.5, 0.5, 0.54)
BODY = radial(0, 0)

# coat body cross-sections: (z, rx, ry, cy)  (outer surface, before lapel/fold offsets)
COAT = [(1.565, 0.068, 0.066, 0.018), (1.53, 0.086, 0.083, 0.016), (1.505, 0.16, 0.116, 0.012),
        (1.47, 0.235, 0.136, 0.008), (1.43, 0.245, 0.15, 0.005), (1.36, 0.228, 0.158, 0.0),
        (1.28, 0.212, 0.158, 0.0), (1.2, 0.202, 0.156, 0.0), (1.1, 0.197, 0.153, 0.0),
        (1.0, 0.2, 0.153, 0.0), (0.95, 0.204, 0.155, 0.0)]
# front edge angle from the centre line: the kimono-style wrap crosses (left over right) at the waist
EDGE = [(1.565, 0.95), (1.53, 0.8), (1.49, 0.56), (1.4, 0.33), (1.3, 0.14), (1.23, -0.05),
        (1.15, -0.28), (1.03, -0.26), (0.95, 0.12)]


def coat_pt(u, z, hem=False):
    e = keys(EDGE, z)[0]
    ph = e + u * (TAU - 2 * e)
    rx, ry, cy = keys(COAT, z)
    d_edge = min(ph - e, (TAU - e) - ph)
    off = 0.007 * (1 - ss(0.1, 0.2, d_edge))                     # the collar band (eri) down both fronts
    off += 0.014 * (1 - ss(0.35, 0.8, ph - e))                   # left panel laps over the right
    off += 0.008 * ss(1.5, 1.53, z)                              # standing collar all round
    back = max(0.0, -math.cos(ph))
    off += 0.006 * math.sin(7 * ph + 0.6) * ss(1.44, 1.22, z) * back   # drape folds down the back
    off += 0.004 * math.sin(3 * ph) * ss(1.44, 1.3, z)                 # soft sag under the arms
    off += 0.0035 * math.sin(z * 120 + ph * 2) * ss(1.26, 1.18, z) * (1 - ss(1.0, 0.97, z))  # bunching at the waist
    if hem:
        off += 0.004 * ss(0.975, 0.955, z)
    return Vector(((rx + off) * math.sin(ph), cy - (ry + off) * math.cos(ph), z))


# coat body on chest (collar to under the sash) and on spine (sash to the hip line)
ct = part('Fig_Coat', 'chest', axis=(0, 0))
sheet(ct, lambda u, v: coat_pt(u, lerp(1.565, 1.14, v)), 56, 18, 'SuitCloth', 0.01, out=BODY)
cw = part('Fig_CoatWaist', 'spine', axis=(0, 0))
sheet(cw, lambda u, v: coat_pt(u, lerp(1.2, 0.955, v), hem=True), 48, 6, 'SuitCloth', 0.01, out=BODY)
# sash (obi) over the seam, with a flat knot at the back
sa = part('Fig_Sash', 'spine', tint=SASH, axis=(0, 0))


def sash_pt(u, v):
    ph = u * TAU
    z = lerp(1.205, 1.085, v)
    rx, ry, cy = keys(COAT, z)
    o = 0.017 + 0.003 * math.sin(v * math.pi) + 0.0015 * math.sin(ph * 9)
    return Vector(((rx + o) * math.sin(ph), cy - (ry + o) * math.cos(ph), z))


sheet(sa, sash_pt, 40, 3, 'SuitCloth', 0.008, closed=True, out=BODY)
ellipsoid(sa, (-0.07, 0.18, 1.148), (0.055, 0.022, 0.042), 'SuitCloth', 16, 10)
for k, (x0, x1) in enumerate(((-0.085, -0.1), (-0.055, -0.045))):
    sheet(sa, lambda u, v, x0=x0, x1=x1, k=k: Vector((lerp(x0, x1, v) + (u - 0.5) * 0.045, 0.19 + 0.006 * v + 0.004 * math.sin(u * 6),
                                                    lerp(1.14, 1.03 - 0.02 * k, v))), 4, 4, 'SuitCloth', 0.006, out=lambda c: Vector((0, 1, 0)))


# hanging coat panels (skirt), split haori-style at the sides and centre back
def skirt_pt(ph, z, u, inner=0.0, zt=0.995, zb=0.335):
    t = clamp((zt - z) / (zt - zb))
    te = t ** 0.85
    rx, ry = 0.19 + 0.11 * te, 0.145 + 0.125 * te
    off = (0.003 + 0.016 * t) * math.sin(15 * ph + 1.3 * math.sin(3 * ph))   # gravity folds, wider toward the hem
    off += 0.004 * ss(0.94, 1.0, t)                                           # turned hem
    off += 0.006 * (1 - ss(0.0, 0.12, min(u, 1 - u))) * t                     # slit edges curl out a little
    off += inner
    return Vector(((rx + off) * math.sin(ph), -(ry + off) * math.cos(ph), z))


for side, sg in (('L', 1), ('R', -1)):
    def mir(ph, sg=sg):
        return ph if sg > 0 else TAU - ph
    sd = part('Fig_CoatSide' + side, 'coatSide%s1' % side, axis=(0, 0))
    sheet(sd, lambda u, v, mir=mir: skirt_pt(mir(lerp(0.95, 2.12, u)), lerp(0.995, 0.335, v), u), 20, 16, 'SuitCloth', 0.01, out=BODY)
    lap = 0.004 if sg > 0 else 0.0     # left back panel laps over the right at the centre-back slit
    b1 = part('Fig_CoatBack%s1' % side, 'coatBack%s1' % side, axis=(0, 0))
    sheet(b1, lambda u, v, mir=mir, lap=lap: skirt_pt(mir(lerp(2.02, math.pi + 0.04, u)), lerp(0.995, 0.64, v), u, 0.005 + lap),
          18, 8, 'SuitCloth', 0.01, out=BODY)
    b2 = part('Fig_CoatBack%s2' % side, 'coatBack%s2' % side, axis=(0, 0))
    sheet(b2, lambda u, v, mir=mir, lap=lap: skirt_pt(mir(lerp(2.02, math.pi + 0.04, u)), lerp(0.685, 0.335, v), u,
                                                      0.005 + lap - 0.007 * (1 - ss(0.0, 0.25, v))),
          18, 9, 'SuitCloth', 0.01, out=BODY)

# hakama: pleated waist on the hips, wide pleated legs on thighs + shins
HW = [(1.07, 0.178, 0.13), (1.0, 0.19, 0.138), (0.92, 0.208, 0.15), (0.845, 0.226, 0.16)]


def pleat_w(ph):
    return max(0.0, -math.cos(ph)) ** 0.5 + 0.6 * max(0.0, math.cos(ph)) ** 0.5


def hwaist_pt(u, v):
    ph = u * TAU
    z = lerp(1.07, 0.845, v)
    rx, ry = keys(HW, z)
    d = pleat(ph, 16, 0.008) * pleat_w(ph) * ss(1.02, 0.95, z)
    return Vector(((rx + d) * math.sin(ph), -(ry + d) * math.cos(ph), z))


hk = part('Fig_HakamaWaist', 'hips', tint=HAKAMA, axis=(0, 0))
sheet(hk, hwaist_pt, 48, 6, 'SuitCloth', 0.01, closed=True, out=BODY)
HL = [(0.98, 0.09, 0.112), (0.85, 0.1, 0.124), (0.7, 0.11, 0.135), (0.55, 0.12, 0.145),
      (0.4, 0.128, 0.153), (0.25, 0.136, 0.16), (0.115, 0.143, 0.166)]


def hleg_pt(cx, u, z, inner=0.0, hem=False):
    ph = u * TAU
    rx, ry = keys(HL, z)
    d = pleat(ph, 16, 0.008) * pleat_w(ph) + inner
    d += 0.004 * noise.noise(Vector((cx * 7, math.sin(ph) * 1.5, z * 5)))     # the cloth never hangs perfectly
    if hem:
        d += 0.004 * ss(0.14, 0.115, z)
    return Vector((cx + (rx + d) * math.sin(ph), -(ry + d) * math.cos(ph), z))


for side, sx in (('L', 0.118), ('R', -0.118)):
    th = part('Fig_HakamaThigh' + side, 'thigh' + side, tint=HAKAMA, axis=(sx, 0))
    sheet(th, lambda u, v, sx=sx: hleg_pt(sx, u, lerp(0.98, 0.455, v), 0.004 * ss(0.6, 0.455, lerp(0.98, 0.455, v))),
          48, 9, 'SuitCloth', 0.009, closed=True, out=radial(sx, 0))
    sh = part('Fig_HakamaShin' + side, 'shin' + side, tint=HAKAMA, axis=(sx, 0))
    sheet(sh, lambda u, v, sx=sx: hleg_pt(sx, u, lerp(0.565, 0.115, v), -0.006 * (1 - ss(0.0, 0.3, v)), hem=True),
          48, 10, 'SuitCloth', 0.01, closed=True, out=radial(sx, 0))

# sleeves: wide upper sleeve with a soft cap over the shoulder, a square kimono sleeve on the
# forearm (short on the gun arm), and the hanging sleeve bag (tamoto) on its own bone
US = [(1.525, 0.01, 0.01), (1.515, 0.045, 0.05), (1.495, 0.068, 0.078), (1.465, 0.083, 0.094), (1.4, 0.09, 0.1),
      (1.3, 0.093, 0.106), (1.2, 0.098, 0.113), (1.135, 0.101, 0.118)]
FS = [(1.215, 0.084, 0.1), (1.16, 0.093, 0.112), (1.08, 0.099, 0.12), (1.0, 0.101, 0.123)]
for side, sx, sg in (('L', 0.205, 1), ('R', -0.205, -1)):
    cx = sx + sg * 0.01

    def us_pt(u, v, cx=cx, sg=sg):
        ph = u * TAU
        z = lerp(1.525, 1.135, v)
        rx, ry = keys(US, z)
        cx -= sg * 0.035 * ss(1.44, 1.525, z)             # the cap leans in to continue the shoulder line
        o = 0.004 * math.sin(5 * ph + 1) * ss(1.45, 1.3, z) + 0.005 * math.sin(z * 95) * ss(1.26, 1.16, z)
        return Vector((cx + (rx + o) * math.sin(ph), 0.005 - (ry + o) * math.cos(ph), z))
    ua = part('Fig_SleeveUpper' + side, 'upperarm' + side, axis=(cx, 0.005))
    sheet(ua, us_pt, 24, 12, 'SuitCloth', 0.009, closed=True, out=radial(cx, 0.005))

    cuff = 1.0 if sg > 0 else 1.075    # the gun hand's sleeve stops well above the wrist
    fcx = sx + sg * 0.006

    def fs_pt(u, v, fcx=fcx, cuff=cuff):
        ph = u * TAU
        z = lerp(1.215, cuff, v)
        rx, ry = keys(FS, z)
        o = 0.004 * math.sin(4 * ph + 2 + z * 30) + 0.005 * ss(0.85, 1.0, v)
        return Vector((fcx + (rx + o) * math.sin(ph), 0.02 - (ry + o) * math.cos(ph), z))
    fa = part('Fig_SleeveFore' + side, 'forearm' + side, axis=(fcx, 0.02))
    sheet(fa, fs_pt, 28, 8, 'SuitCloth', 0.009, closed=True, out=radial(fcx, 0.02))

    bottom = 0.88 if sg > 0 else 0.985

    def bag_pt(u, v, sx=sx, bottom=bottom):
        ph = u * TAU
        z = lerp(1.175, bottom, v)
        y0 = lerp(0.03, 0.05, v)
        y1 = lerp(0.11, 0.185, ss(0.0, 0.45, v)) - 0.075 * ss(0.62, 1.0, v) ** 1.6    # rounded back-bottom corner
        hx = 0.034 * (1 - 0.85 * ss(0.8, 1.0, v))
        k = (1 - math.cos(ph)) / 2                                                   # 0 at front edge, 1 at back
        hx *= 1 + 0.18 * math.sin(k * 3 * math.pi + v * 2)                          # soft vertical folds
        return Vector((sx + hx * math.sin(ph), lerp(y0, y1, k), z))
    bg = part('Fig_SleeveDrape' + side, 'sleeve%s1' % side, axis=(sx, 0.1))
    sheet(bg, bag_pt, 20, 10, 'SuitCloth', 0.006, closed=True, out=radial(sx, 0.1))

# shirt front, collar and red tie in the V of the coat
SH = [(1.52, 0.066), (1.49, 0.09), (1.45, 0.109), (1.4, 0.127), (1.3, 0.131), (1.19, 0.131)]
sr = part('Fig_Shirt', 'chest')
sheet(sr, lambda u, v: (lambda z, ph: Vector((0.16 * math.sin(ph), -keys(SH, z)[0] * math.cos(ph), z)))(lerp(1.52, 1.19, v), lerp(-0.8, 0.8, u)),
      12, 10, 'ShirtCloth', 0.004, out=lambda c: Vector((0, -1, 0)))
sheet(sr, lambda u, v: (lambda ph, z, r: Vector((r * math.sin(ph), 0.005 - r * math.cos(ph), z)))(u * TAU, lerp(1.545, 1.49, v), lerp(0.05, 0.056, v)),
      24, 3, 'ShirtCloth', 0.004, closed=True, out=radial(0, 0.005))
for sg in (1, -1):   # collar points
    A, B = Vector((sg * 0.006, -0.057, 1.51)), Vector((sg * 0.042, -0.048, 1.515))
    D, C = Vector((sg * 0.016, -0.092, 1.462)), Vector((sg * 0.055, -0.083, 1.458))
    sheet(sr, lambda u, v, A=A, B=B, C=C, D=D: (A.lerp(B, u)).lerp(D.lerp(C, u), v) + Vector((0, -0.006 * math.sin(math.pi * v), 0)),
          3, 3, 'ShirtCloth', 0.004, out=lambda c: Vector((0, -1, 0.3)))
ti = part('Fig_Tie', 'chest')
ellipsoid(ti, (0, -0.068, 1.483), (0.02, 0.016, 0.023), 'TieRed', 14, 8)


def tie_pt(u, v):
    z = lerp(1.468, 1.235, v)
    w = 0.02 + 0.021 * v
    x = (u - 0.5) * 2 * w
    z -= 0.03 * (1 - abs(u - 0.5) * 2) * v ** 10       # pointed tip
    y = -keys(SH, z)[0] - 0.009 - 0.004 * math.sin(v * math.pi) - 0.004 * (1 - abs(u - 0.5) * 2)
    return Vector((x, y, z))


sheet(ti, tie_pt, 4, 10, 'TieRed', 0.006, out=lambda c: Vector((0, -1, 0)))
# haori himo: a cream cord knot where the coat crosses
hm = part('Fig_Himo', 'chest')
ellipsoid(hm, (0.0, -0.19, 1.232), (0.019, 0.012, 0.014), 'ShirtCloth', 12, 8)
for sg in (1, -1):
    cylinder(hm, (sg * 0.006, -0.19, 1.225), (sg * 0.02, -0.192, 1.17), 0.004, 'ShirtCloth', 6)
    ellipsoid(hm, (sg * 0.021, -0.192, 1.162), (0.008, 0.008, 0.014), 'ShirtCloth', 8, 6)


# scarf tail: three red ribbon segments rising out of the collar (animated procedurally in game)
def ribbon(p, a, b, w0, w1, bow, m, twist=0.0):
    a, b = Vector(a), Vector(b)

    def f(u, v):
        c = a.lerp(b, v) + Vector((0, bow * math.sin(math.pi * v), 0))
        tw = twist * v
        return c + Vector((math.cos(tw), math.sin(tw) * 0.4, 0)) * ((u - 0.5) * lerp(w0, w1, v))
    sheet(p, f, 3, 6, m, 0.008, out=lambda c: Vector((0, 1, 0)))


SCARF = [('scarf1', (0.02, 0.105, 1.575), (0.03, 0.188, 1.37), 0.066, 0.068, 0.016, 0.1),
         ('scarf2', (0.03, 0.188, 1.39), (0.035, 0.198, 1.21), 0.068, 0.062, 0.006, 0.12),
         ('scarf3', (0.035, 0.198, 1.23), (0.04, 0.204, 1.06), 0.062, 0.056, 0.005, -0.1)]
for i, (b, a, e, w0, w1, bow, tw) in enumerate(SCARF):
    sp = part('Fig_Scarf%d' % (i + 1), b)
    ribbon(sp, a, e, w0, w1, bow, 'TieRed', tw)
    if i == 2:
        for k in range(4):  # frayed end tassels
            x = e[0] - 0.024 + k * 0.016
            cylinder(sp, (x, e[1], e[2] + 0.01), (x + 0.002, e[1] + 0.003, e[2] - 0.035), 0.004, 'TieRed', 6)


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
# Vertex colours: subtle wood grain + fake AO on the wooden parts; on the cloth
# a faint weave, darker fold valleys, and a darker lining on the inside faces
# --------------------------------------------------------------------------
CLOTH = {'SuitCloth', 'ShirtCloth', 'TieRed'}


def cloth_shade(me):
    """Per-vertex fold shading: concave (valley) vertices darken, ridges catch a little light."""
    n = len(me.vertices)
    acc = [Vector() for _ in range(n)]
    cnt = [0] * n
    elen = [0.0] * n
    for e in me.edges:
        a, b = e.vertices
        ca, cb = me.vertices[a].co, me.vertices[b].co
        acc[a] += cb; acc[b] += ca
        cnt[a] += 1; cnt[b] += 1
        L = (ca - cb).length
        elen[a] += L; elen[b] += L
    out = [1.0] * n
    for i, v in enumerate(me.vertices):
        if not cnt[i]:
            continue
        lap = acc[i] / cnt[i] - v.co
        conc = lap.dot(v.normal) / max(1e-5, elen[i] / cnt[i])
        out[i] = clamp(1.0 - 1.6 * conc, 0.62, 1.1)
    return out


def add_vcols(me, part_obj_mats, p=None):
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    fold = cloth_shade(me) if any(m in CLOTH for m in part_obj_mats) else None
    for poly in me.polygons:
        mname = part_obj_mats[poly.material_index] if poly.material_index < len(part_obj_mats) else ''
        lining = False
        if mname in CLOTH and p is not None and p.axis is not None:
            c = poly.center
            lining = poly.normal.dot(Vector((c.x - p.axis[0], c.y - p.axis[1], 0))) < -0.2 * Vector((c.x - p.axis[0], c.y - p.axis[1], 0)).length
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            if mname == 'Wood':
                co = v.co
                g = noise.noise(Vector((co.x * 6, co.y * 6, co.z * 40)))
                n = noise.noise(co * 25) * 0.04
                k = 0.9 + 0.08 * g + n
                ao = 0.85 + 0.15 * max(0.0, min(1.0, v.normal.z * 0.5 + 0.6))
                c = (k * ao, k * ao * 0.98, k * ao * 0.95, 1)
            elif mname in CLOTH:
                co = v.co
                weave = 1.0 + 0.045 * noise.noise(co * 90) + 0.035 * noise.noise(co * 8)
                k = weave * fold[v.index] * (0.5 if lining else 1.0)
                k *= 0.9 + 0.1 * clamp(v.normal.z * 0.5 + 0.7)     # undersides a touch darker
                t = p.tint if p is not None else (1, 1, 1)
                c = (clamp(k * t[0]), clamp(k * t[1]), clamp(k * t[2]), 1)
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
    add_vcols(me, p.mats, p)
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

# cloth chain bones are not keyed: the game swings them procedurally (see pose_cloth)
CLOTH_BONES = ['coatSideL1', 'coatSideR1', 'coatBackL1', 'coatBackL2', 'coatBackR1', 'coatBackR2', 'sleeveL1', 'sleeveR1']
KEYED = [n for n, _, _ in BONES if n not in FA.PROCEDURAL_BONES and n not in CLOTH_BONES]
CLOTH_PREVIEW = [False]   # turned on after the clips are baked, so previews show the cloth hanging


def _q(rx, ry=0.0, rz=0.0):
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_quaternion()


def pose_cloth(pose):
    """Preview stand-in for the game's cloth springs. Same rules the game should use:
    gravity-compensate each panel toward the character's vertical, then swing it back
    (+X) by max(speed trail, thigh back-swing) and out (Z) by the thigh's abduction."""
    bpy.context.view_layer.update()
    lean = pose.get('spine', (0, 0, 0))[0]
    low = pose.get('hips@loc', (0, 0, 0))[1] < -0.3
    trail = 70.0 if low else clamp(lean * 1.4, 0.0, 35.0)
    R0 = arm.data.bones['hips'].matrix_local.to_quaternion()
    for n in CLOTH_BONES:
        pb = arm.pose.bones[n]
        if n.endswith('2'):          # second link: a little extra curl on top of its parent
            pb.rotation_quaternion = _q(0.3 * trail + 4)
            continue
        side = 'L' if 'L' in n[-2:] else 'R'
        sg = 1 if side == 'L' else -1
        thx, _, thz = pose.get('thigh' + side, (0, 0, 0))
        if n.startswith('sleeve'):
            qs, k = _q(0), 0.35
        elif n.startswith('coatBack'):
            qs, k = _q(max(trail, 0.85 * max(0.0, thx)) + 3), 1.0
        else:
            qs, k = _q(0.7 * trail, 0, sg * (4 + max(0.0, sg * thz))), 1.0
        qp = pb.parent.matrix.to_quaternion()
        qg = qp.inverted() @ R0 @ qs
        pb.rotation_quaternion = qs.slerp(qg, k)


def apply_pose(pose):
    for n in KEYED:
        pb = arm.pose.bones[n]
        rx, ry, rz = pose.get(n, FA.DEFAULTS.get(n, (0, 0, 0)))
        pb.rotation_quaternion = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_quaternion()
        pb.location = pose.get(n + '@loc', (0, 0, 0))
    if CLOTH_PREVIEW[0]:
        pose_cloth(pose)


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

CLOTH_PREVIEW[0] = True
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


def strip_channels(path, names):
    """Drop the exporter's constant rest-pose channels for bones the game drives itself (the cloth
    chains), then compact the binary chunk. Keeps the file well under budget."""
    import json, struct
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bin_ = d[20 + jl + 8:]
    drop = {i for i, n in enumerate(j['nodes']) if n.get('name') in names}
    for an in j['animations']:
        keep = [c for c in an['channels'] if c['target'].get('node') not in drop]
        used = sorted({c['sampler'] for c in keep})
        remap = {o: i for i, o in enumerate(used)}
        an['samplers'] = [an['samplers'][i] for i in used]
        for c in keep:
            c['sampler'] = remap[c['sampler']]
        an['channels'] = keep
    # which accessors are still referenced anywhere?
    refs = set()

    def walk(o, key=None):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('indices', 'input', 'output', 'inverseBindMatrices') and isinstance(v, int):
                    refs.add(v)
                elif k == 'attributes':
                    refs.update(v.values())
                else:
                    walk(v, k)
        elif isinstance(o, list):
            for v in o:
                walk(v, key)
    walk({k: v for k, v in j.items() if k not in ('accessors', 'bufferViews', 'buffers')})
    acc_map, accs = {}, []
    for i, a in enumerate(j['accessors']):
        if i in refs:
            acc_map[i] = len(accs)
            accs.append(a)
    views_used = sorted({a['bufferView'] for a in accs if 'bufferView' in a} |
                        {img['bufferView'] for img in j.get('images', []) if 'bufferView' in img})
    out, view_map, views = bytearray(), {}, []
    for vi in views_used:
        v = dict(j['bufferViews'][vi])
        chunk = bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        while len(out) % 4:
            out.append(0)
        v['byteOffset'] = len(out)
        out += chunk
        view_map[vi] = len(views)
        views.append(v)
    for a in accs:
        if 'bufferView' in a:
            a['bufferView'] = view_map[a['bufferView']]
    for img in j.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = view_map[img['bufferView']]
    j['accessors'], j['bufferViews'] = accs, views
    while len(out) % 4:
        out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]

    def fix(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('indices', 'input', 'output', 'inverseBindMatrices') and isinstance(v, int):
                    o[k] = acc_map[v]
                elif k == 'attributes':
                    for kk in v:
                        v[kk] = acc_map[v[kk]]
                else:
                    fix(v)
        elif isinstance(o, list):
            for v in o:
                fix(v)
    for k in j:
        if k not in ('accessors', 'bufferViews', 'buffers'):
            fix(j[k])
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(out), 0x004E4942) + bytes(out))


strip_channels(OUT, set(CLOTH_BONES))
print('stripped cloth channels ->', os.path.getsize(OUT) // 1024, 'KB')

# --------------------------------------------------------------------------
# Character sheet (optional): hero portrait, turnaround, moveset, gun
# --------------------------------------------------------------------------
if '--sheet' in sys.argv:
    import character_sheet
    parts = os.environ.get('SHEET_PARTS', '').split(',') if os.environ.get('SHEET_PARTS') else None
    character_sheet.render_character_sheet(arm, FA, apply_pose, os.path.join(ROOT, 'docs', 'character'), parts)
