#!/usr/bin/env python3
"""
Juxtapose -- the sculpted Figment: the Magritte suit (haori over hakama, bowler,
red scarf, wooden egg head) from a Higgsfield image -> Tripo multiview model,
skinned to the procedural figure's own skeleton so every clip in figure.glb
drives it unchanged.

    python3 juxtapose/blender/build_figure_hero.py [--preview]

Source: art_src/figure/src/figment.glb (front, left and back views in
art_src/figure/*.png). Output: assets/figure_skin.glb, one skinned mesh whose
joints are named after the figure's bones.

How it meets the rig
  * turned to face Blender -Y, feet on z=0, hat top at 1.935 (the figure's height)
  * decimated to TRIS and baked (albedo + normal) like the hero props
  * weights are written by hand, not by bone heat: region rules from the
    silhouette and the baked colour (wooden hands and head, red scarf, black
    shoes), then a falloff along each limb. Coat skirts go to the cloth chain
    bones the game swings with springs; the split hakama follows the legs.
  * the sculpt stands in an A-pose (arms ~22 deg out, feet a little apart) but
    the rig rests with arms straight down. Rather than re-pose the mesh, the
    file carries a bind correction per bone (glTF extras "bind": a 4x4 in glTF
    space, bind = C @ rest). The game builds each bone's inverse from it, so at
    the rig's rest pose the sculpt's hands close onto the hand bones (where the
    gun hangs) and the sleeves fall with them.
"""
import bpy
import json
import math
import os
import sys
import time
import numpy as np
from mathutils import Vector as V, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hero as H  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'art_src', 'figure', 'src', 'figment.glb')
OUT = os.path.join(ROOT, 'assets', 'figure_skin.glb')
HEIGHT = 1.935
YAW = -90          # Tripo faced +X
TRIS = 16000
TEX = 2048

# the procedural figure's deforming bones (build_figure.BONES), heads in Blender space
BONES = [
    ('root', None, (0, 0, 0)),
    ('hips', 'root', (0, 0, 0.98)),
    ('spine', 'hips', (0, 0, 1.08)),
    ('chest', 'spine', (0, 0, 1.27)),
    ('neck', 'chest', (0, 0, 1.5)),
    ('head', 'neck', (0, 0, 1.6)),
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
    ('coatSideL1', 'hips', (0.2, -0.01, 0.995)),
    ('coatSideR1', 'hips', (-0.2, -0.01, 0.995)),
    ('coatBackL1', 'hips', (0.085, 0.15, 0.995)),
    ('coatBackL2', 'coatBackL1', (0.1, 0.215, 0.66)),
    ('coatBackR1', 'hips', (-0.085, 0.15, 0.995)),
    ('coatBackR2', 'coatBackR1', (-0.1, 0.215, 0.66)),
    ('sleeveL1', 'forearmL', (0.205, 0.07, 1.175)),
    ('sleeveR1', 'forearmR', (-0.205, 0.07, 1.175)),
]
HEAD = {n: np.array(h, float) for n, _, h in BONES}
ARM = ['upperarm', 'forearm', 'hand', 'sleeve']   # the chain a side's arm correction moves
LEG = ['thigh', 'shin', 'foot']


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# mesh
# --------------------------------------------------------------------------
def load_and_fit():
    H.reset()
    hi = H.join_all(H.import_glb(SRC))
    raw = H.tris(hi)
    hi.data.transform(Matrix.Rotation(math.radians(YAW), 4, 'Z'))
    mn, mx = H.world_bbox([hi])
    s = HEIGHT / (mx.z - mn.z)
    hi.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-V(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    hi.data.update()
    H.clean(hi)
    return hi, raw


def verts(ob):
    n = len(ob.data.vertices)
    P = np.empty(n * 3); ob.data.vertices.foreach_get('co', P)
    return P.reshape(-1, 3)


def vertex_colours(ob, img):
    """mean baked albedo under each vertex (sRGB 0..1), sampled at its loops' UVs"""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    me = ob.data
    uv = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    vi = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', vi)
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    c = px[y, x]
    out = np.zeros((len(me.vertices), 3)); cnt = np.zeros(len(me.vertices))
    np.add.at(out, vi, c); np.add.at(cnt, vi, 1)
    lin = out / np.maximum(cnt, 1)[:, None]
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)


# --------------------------------------------------------------------------
# landmarks: where the sculpt's joints are, so the binds can close them onto the rig's
# --------------------------------------------------------------------------
def landmarks(P, kind):
    L = {}
    for side, sg in (('L', 1), ('R', -1)):
        x = P[:, 0] * sg
        hand = (kind['wood']) & (x > 0.28) & (P[:, 2] < 1.15)
        hp = P[hand]
        # the wrist: top of the wooden hand, where it leaves the sleeve
        top = hp[hp[:, 2] > np.percentile(hp[:, 2], 90)]
        L['wrist' + side] = top.mean(0)
        L['handC' + side] = hp.mean(0)
        shoe = kind['shoe'] & (x > 0.02)
        sp = P[shoe]
        L['ankle' + side] = np.array([sp[:, 0].mean(), 0.0, 0.1])
    return L


def binds(L):
    """per-bone world-space (Blender) correction C, bind = C @ rest"""
    C = {n: Matrix.Identity(4) for n in HEAD}
    info = {}
    for side, sg in (('L', 1), ('R', -1)):
        S = HEAD['upperarm' + side]
        # palm to palm: the rig's wooden palm centre (build_figure's hand ellipsoid) and the sculpt's
        r = HEAD['hand' + side] + np.array([0, 0, -0.065]) - S
        s = L['handC' + side] - S
        s[1] = 0.0                            # the A-pose is in the frontal plane
        ang = math.atan2(r[2], r[0]) - math.atan2(s[2], s[0])   # rotate s onto r, about Blender Y
        k = np.linalg.norm(s) / np.linalg.norm(r)
        R = Matrix.Rotation(ang, 4, 'Y')      # rest -> bind: turns the rig's arm out onto the sculpt's
        for b in ARM:
            n = b + side + ('1' if b == 'sleeve' else '')
            hd = V(HEAD[n] - S)
            bind_head = V(S) + (R @ (hd * k))
            C[n] = Matrix.Translation(bind_head) @ R @ Matrix.Translation(-V(HEAD[n]))
        info['arm' + side] = {'deg': round(math.degrees(ang), 2), 'stretch': round(k, 3)}
        # legs: a little apart at the ankle
        T = HEAD['thigh' + side]
        r = HEAD['foot' + side] - T
        s = L['ankle' + side] - T; s[1] = 0.0
        ang = math.atan2(r[2], r[0]) - math.atan2(s[2], s[0])
        R = Matrix.Rotation(ang, 4, 'Y')
        for b in LEG:
            n = b + side
            C[n] = Matrix.Translation(V(T)) @ R @ Matrix.Translation(-V(T))
        info['leg' + side] = {'deg': round(math.degrees(ang), 2)}
    return C, info


def bind_head(C, n):
    return np.array(C[n] @ V(HEAD[n]))


# --------------------------------------------------------------------------
# weights
# --------------------------------------------------------------------------
def seg_param(P, a, b):
    d = b - a
    t = ((P - a) @ d) / (d @ d)
    q = a + np.clip(t, 0, 1)[:, None] * d
    return t, np.linalg.norm(P - q, axis=1)


def weights(P, kind, C, L):
    n = len(P)
    W = {b: np.zeros(n) for b in HEAD}
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)

    # ---- torso column by height (also the base every other region blends from)
    def column(z):
        keys = [(0.98, 'hips'), (1.12, 'spine'), (1.32, 'chest'), (1.56, 'chest'), (1.63, 'neck'), (1.69, 'head')]
        out = {b: np.zeros(n) for b in ('hips', 'spine', 'chest', 'neck', 'head')}
        zc = np.clip(z, keys[0][0], keys[-1][0])
        for (z0, b0), (z1, b1) in zip(keys, keys[1:]):
            m = (zc >= z0) & (zc <= z1)
            t = (zc[m] - z0) / (z1 - z0)
            out[b0][m] += 1 - t
            out[b1][m] += t
        # the band edges were counted twice; renormalise
        s = sum(out.values())
        return {b: v / np.maximum(s, 1e-9) for b, v in out.items()}
    col = column(z)

    low = smooth(1.02, 0.94, z)                      # 0 above the waist, 1 below

    # ---- arms: sleeves and wooden hands, along the A-posed arm line
    arm_any = np.zeros(n)
    scarf = kind['red'] & (z < 1.45)                 # the hanging scarf ends ride the chest
    for side, sg in (('L', 1), ('R', -1)):
        S = bind_head(C, 'upperarm' + side)
        E = bind_head(C, 'forearm' + side)
        Wr = bind_head(C, 'hand' + side)
        xs = x * sg
        # armness: out past the coat body; lower down only the hands reach that far
        a = np.where(z > 0.97, smooth(0.19, 0.29, xs), smooth(0.31, 0.37, xs))
        a = a * (z > 0.72) * (z < 1.62) * ~scarf
        hand = kind['wood'] & (xs > 0.28) & (z < 1.2)
        a = np.maximum(a, hand.astype(float))
        t1, r1 = seg_param(P, S, E)
        t2, r2 = seg_param(P, E, Wr)
        # blend upper/fore around the elbow, fore/hand at the wrist
        tAll, _ = seg_param(P, S, Wr)
        tE = np.linalg.norm(E - S) / np.linalg.norm(Wr - S)
        fore = smooth(tE - 0.1, tE + 0.1, tAll)
        hw = np.where(hand, smooth(-0.02, 0.03, (Wr - P)[:, 2] + 0.0), 0.0)
        # kimono drape: cloth hanging well below the arm line goes to the sleeve bone
        rr = np.minimum(r1, r2)
        drape = smooth(0.07, 0.17, rr) * smooth(tE - 0.2, tE + 0.1, tAll) * ~hand
        body = 1 - hw
        W['hand' + side] += a * hw
        W['sleeve' + side + '1'] += a * body * drape
        W['forearm' + side] += a * body * (1 - drape) * fore
        W['upperarm' + side] += a * body * (1 - drape) * (1 - fore)
        arm_any = np.maximum(arm_any, a)

    rest = 1 - arm_any
    # ---- lower body (below the sash): split hakama on the legs, the haori skirt on the cloth bones
    # the haori skirt: everything below the waist except the hakama showing in the front opening
    front_gap = (ax < 0.1) & (y < -0.02)
    coat = (z > 0.52) & (z < 1.02) & ~front_gap & ~kind['shoe']
    legL = smooth(-0.06, 0.06, x)
    for side, sg, m in (('L', 1, legL), ('R', -1, 1 - legL)):
        T, K, F = (bind_head(C, b + side) for b in LEG)
        up = smooth(0.30, 0.62, z)                   # thigh above the knee, shin below
        hak = ~coat
        # hakama and shoes
        foot = kind['shoe'] & ((x * sg) > 0)
        W['foot' + side] += np.where(foot, rest, 0.0)
        leg = hak & ~foot & ~scarf & (z < 1.02)
        W['thigh' + side] += np.where(leg, (m * up * low) * rest, 0)
        W['shin' + side] += np.where(leg, (m * (1 - up) * low) * rest, 0)
        # haori skirt: half the thigh (so a stride does not come through it), half its cloth panel
        f = smooth(0.98, 0.62, z) * low             # how far down the skirt
        back = smooth(0.0, 0.08, y)                  # back panels vs the sides/front
        sk = coat & ~scarf & ((x >= 0) if side == 'L' else (x < 0))
        lower2 = smooth(0.74, 0.62, z)
        W['thigh' + side] += np.where(sk, (f * 0.35) * rest, 0)
        W['coatBack' + side + '1'] += np.where(sk, (f * 0.65 * back * (1 - lower2)) * rest, 0)
        W['coatBack' + side + '2'] += np.where(sk, (f * 0.65 * back * lower2) * rest, 0)
        W['coatSide' + side + '1'] += np.where(sk, (f * 0.65 * (1 - back)) * rest, 0)
        # the rest of the skirt near the sash stays on the hips (column below)
        W['hips'] += np.where(sk, ((1 - f) * low) * rest, 0)
        W['hips'] += np.where(leg, ((1 - low)) * rest, 0)

    # ---- the torso column gets what the arms and lower body did not take
    upper = rest * (1 - low)
    for b, v in col.items():
        W[b] += np.where(scarf, 0, v * upper)
    # the scarf ends hang from the collar: all chest, whatever their height
    W['chest'] += np.where(scarf, rest, 0)

    # normalise, keep the four strongest
    names = list(W)
    M = np.stack([W[b] for b in names], 1)
    M[M < 1e-4] = 0
    idx = np.argsort(-M, 1)[:, :4]
    top = np.take_along_axis(M, idx, 1)
    s = top.sum(1)
    bad = s < 1e-6
    if bad.any():
        print(f'  {bad.sum()} verts unweighted -> nearest column bone')
        top[bad, 0] = 1; idx[bad, 0] = names.index('hips'); s[bad] = 1
    top /= s[:, None]
    return names, idx, top


# --------------------------------------------------------------------------
# armature + export
# --------------------------------------------------------------------------
def armature():
    ad = bpy.data.armatures.new('FigureSkin')
    ob = bpy.data.objects.new('FigureSkin', ad)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    for n, p, h in BONES:
        b = ad.edit_bones.new(n)
        b.head = V(h); b.tail = V(h) + V((0, 0, 0.06)); b.roll = 0
        if p:
            b.parent = ad.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def to_gltf(M):
    """Blender (Z up, -Y front) -> glTF (Y up, +Z front) for a world-space matrix"""
    A = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    G = A @ M @ A.inverted()
    return [G[r][c] for c in range(4) for r in range(4)]   # column-major, as three's fromArray


CACHE = os.path.join(ROOT, 'art_src', 'figure', 'src', 'figment_lo.blend')


def main():
    t0 = time.time()
    if '--reuse' in sys.argv and os.path.exists(CACHE):
        # weights only: start from the last decimated, baked mesh
        bpy.ops.wm.open_mainfile(filepath=CACHE)
        lo = bpy.data.objects['FigmentSculpt']
        maps = {'albedo': bpy.data.images['Figment_albedo'], 'normal': bpy.data.images['Figment_normal']}
        return rig(lo, maps, t0)
    hi, raw = load_and_fit()
    lo = H.decimated_copy(hi, TRIS)
    for slot in hi.material_slots:
        m = slot.material
        bsdf = m and m.use_nodes and next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            for l in list(bsdf.inputs['Metallic'].links): m.node_tree.links.remove(l)
            bsdf.inputs['Metallic'].default_value = 0.0
    maps = {'albedo': H.bake(hi, lo, 'albedo', TEX, 'Figment'),
            'normal': H.bake(hi, lo, 'normal', TEX // 2, 'Figment')}
    for img in maps.values():
        img.file_format = 'JPEG'
    H.final_material(lo, 'Figment', maps, {'rough': 0.78})
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = lo.data.name = 'FigmentSculpt'
    print(f'  mesh {raw} -> {H.tris(lo)} tris ({time.time() - t0:.0f}s)')
    for img in maps.values():
        img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=CACHE)
    rig(lo, maps, t0)


def rig(lo, maps, t0):

    P = verts(lo)
    c = vertex_colours(lo, maps['albedo'])
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    lum = c.mean(1)
    kind = {
        'wood': (r > 0.45) & (r > b + 0.12) & (g > b) & (r - g < 0.25),
        'red': (r > 0.3) & (r > g * 1.8) & (r > b * 1.8),
        'shoe': (P[:, 2] < 0.09) | ((P[:, 2] < 0.14) & (lum < 0.3)),
    }
    low = P[:, 2] < 0.16
    print('  colour at the feet', np.round(np.percentile(lum[low], [5, 25, 50, 75, 95]), 3), 'n', int(low.sum()))
    print('  classes', {k: int(v.sum()) for k, v in kind.items()}, 'of', len(P))
    L = landmarks(P, kind)
    C, info = binds(L)
    print('  landmarks', {k: [round(float(q), 3) for q in v] for k, v in L.items()})
    print('  binds', info)
    for sd in 'LR':
        print(f'  bind palm{sd}', np.round(np.array(C['hand' + sd] @ V(HEAD['hand' + sd] + np.array([0, 0, -0.065]))), 3), 'sculpt palm', np.round(L['handC' + sd], 3))
    names, idx, wts = weights(P, kind, C, L)

    arm = armature()
    for nme in names:
        lo.vertex_groups.new(name=nme)
    groups = {nme: lo.vertex_groups[nme] for nme in names}
    for v in range(len(P)):
        for j in range(4):
            if wts[v, j] > 0:
                groups[names[idx[v, j]]].add([v], float(wts[v, j]), 'REPLACE')
    lo.parent = arm
    mod = lo.modifiers.new('arm', 'ARMATURE'); mod.object = arm
    arm['bind'] = json.dumps({n: to_gltf(C[n]) for n in HEAD if C[n] != Matrix.Identity(4)})
    arm['height'] = HEIGHT

    if '--preview' in sys.argv:
        preview(lo, arm, idx, wts, names)

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True); lo.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='JPEG',
                              export_jpeg_quality=86, export_yup=True, export_extras=True, export_skins=True,
                              export_animations=False, export_def_bones=False, export_influence_nb=4)
    print(f'wrote {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB, {time.time() - t0:.0f}s)')


def preview(lo, arm, idx, wts, names):
    """weight paint as vertex colours: one hue per bone, rendered front and side"""
    import colorsys
    hue = {n: (i * 0.61803) % 1 for i, n in enumerate(names)}
    me = lo.data
    ca = me.color_attributes.new('W', 'FLOAT_COLOR', 'POINT')
    for v in range(len(me.vertices)):
        col = np.zeros(3)
        for j in range(4):
            col += wts[v, j] * np.array(colorsys.hsv_to_rgb(hue[names[idx[v, j]]], 0.8, 0.9))
        ca.data[v].color = (*col, 1)
    m = bpy.data.materials.new('wp'); m.use_nodes = True
    at = m.node_tree.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'W'
    m.node_tree.links.new(at.outputs[0], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    keep = me.materials[0]
    me.materials[0] = m
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 6; sc.cycles.device = 'CPU'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.82, 1)
    sc.render.resolution_x = 360; sc.render.resolution_y = 520
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.1
    out = os.environ.get('PREVIEW_DIR', '/tmp')
    for i, a in enumerate([0, 90, 180]):
        rr = math.radians(a)
        cam.location = (3 * math.sin(rr), -3 * math.cos(rr), 0.97); cam.rotation_euler = (math.pi / 2, 0, rr)
        sc.render.filepath = os.path.join(out, f'wp_{i}.png')
        bpy.ops.render.render(write_still=True)
    # and a posed check: arms to the rig's rest (the A-pose closed), one stride
    me.materials[0] = keep
    pb = arm.pose.bones
    from mathutils import Euler
    pb['thighL'].rotation_mode = pb['shinL'].rotation_mode = pb['upperarmR'].rotation_mode = 'XYZ'
    pb['thighL'].rotation_euler = Euler((math.radians(35), 0, 0))
    pb['shinL'].rotation_euler = Euler((math.radians(-40), 0, 0))
    pb['upperarmR'].rotation_euler = Euler((math.radians(70), 0, 0))
    lamp = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); lamp.data.energy = 3
    lamp.rotation_euler = (0.8, 0.2, 0.6); sc.collection.objects.link(lamp)
    for i, a in enumerate([0, 90]):
        rr = math.radians(a)
        cam.location = (3 * math.sin(rr), -3 * math.cos(rr), 0.97); cam.rotation_euler = (math.pi / 2, 0, rr)
        sc.render.filepath = os.path.join(out, f'pose_{i}.png')
        bpy.ops.render.render(write_still=True)
    for n in ('thighL', 'shinL', 'upperarmR'):
        pb[n].rotation_euler = Euler((0, 0, 0))


if __name__ == '__main__':
    main()
