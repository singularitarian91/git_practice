#!/usr/bin/env python3
"""
Juxtapose -- Cycles previews of the town kit (assets/town.glb) with the baked
texture library (assets/tex/) applied the way the game applies it:

  * TX_<name> materials get <name>_albedo (sRGB) x COLOR_0, <name>_orm
    (R ambient occlusion, G roughness, B metalness) and <name>_normal (OpenGL,
    tangent space) through UV * (1 / tile) from assets/tex/manifest.json;
  * other materials keep their colour x COLOR_0;
  * colliders (*_COL_*) and SLOT_ empties are hidden; SLOT_light empties get
    warm point lamps, as the game's lamps would.

    python3 juxtapose/blender/render_town.py                  # every shot
    python3 juxtapose/blender/render_town.py --only street,cottage --samples 32
    python3 juxtapose/blender/render_town.py --glb /tmp/t.glb --out /tmp/prev

Writes juxtapose/docs/previews/town_<shot>.png.
"""
import bpy
import math
import os
import sys
import json
import time
from mathutils import Vector as V, Euler, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
GLB = os.path.join(PROJ, 'assets', 'town.glb')
TEX = os.path.join(PROJ, 'assets', 'tex')
OUT_DIR = os.path.join(PROJ, 'docs', 'previews')


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
IMAGES = {}


def image(path, color):
    if path not in IMAGES:
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        IMAGES[path] = im
    return IMAGES[path]


def color_attr_name(mat):
    for o in bpy.data.objects:
        if o.type == 'MESH' and mat.name in [m.name for m in o.data.materials if m]:
            if len(o.data.color_attributes):
                return o.data.color_attributes[0].name
    return 'Color'


def principled_values(mat):
    """Read what the glTF importer put on the material."""
    vals = dict(color=(0.8, 0.8, 0.8, 1.0), metal=0.0, rough=0.5, alpha=1.0, emit=(0, 0, 0, 1), estr=0.0)
    if not mat.use_nodes:
        return vals
    b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        return vals
    vals['color'] = tuple(b.inputs['Base Color'].default_value)
    vals['metal'] = b.inputs['Metallic'].default_value
    vals['rough'] = b.inputs['Roughness'].default_value
    vals['alpha'] = b.inputs['Alpha'].default_value
    vals['emit'] = tuple(b.inputs['Emission Color'].default_value)
    vals['estr'] = b.inputs['Emission Strength'].default_value
    # base colour factor may sit on a mix/multiply node feeding Base Color
    for n in mat.node_tree.nodes:
        if n.type == 'MIX' and n.data_type == 'RGBA':
            for i in (6, 7):
                if not n.inputs[i].is_linked:
                    vals['color'] = tuple(n.inputs[i].default_value)
        if n.type == 'MIX_RGB':
            for i in (1, 2):
                if not n.inputs[i].is_linked:
                    vals['color'] = tuple(n.inputs[i].default_value)
    if not b.inputs['Base Color'].is_linked and any(n.type in ('MIX', 'MIX_RGB') for n in mat.node_tree.nodes) is False:
        vals['color'] = tuple(b.inputs['Base Color'].default_value)
    return vals


def rebuild_material(mat, manifest):
    vc_name = color_attr_name(mat)
    vals = principled_values(mat)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = vc_name
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(vc.outputs['Color'], mul.inputs[6])
    nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    name = mat.name
    if name.startswith('TX_') and name[3:] in manifest:
        t = name[3:]
        tile = manifest[t]['tile']
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        ims = {}
        for kind, colr in (('albedo', True), ('normal', False), ('orm', False)):
            it = nt.nodes.new('ShaderNodeTexImage')
            it.image = image(os.path.join(TEX, '%s_%s.jpg' % (t, kind)), colr)
            it.extension = 'REPEAT'
            it.interpolation = 'Cubic' if kind == 'normal' else 'Linear'
            nt.links.new(mp.outputs['Vector'], it.inputs['Vector'])
            ims[kind] = it
        nt.links.new(ims['albedo'].outputs['Color'], mul.inputs[7])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(ims['orm'].outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs['Roughness'])
        nt.links.new(sep.outputs[2], b.inputs['Metallic'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'UVMap'
        nm.inputs['Strength'].default_value = 1.0
        nt.links.new(ims['normal'].outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    else:
        if mat.blend_method == 'BLEND' or name in ('Glass',):
            vals['alpha'] = min(vals['alpha'], 0.3)
        mul.inputs[7].default_value = vals['color']
        b.inputs['Metallic'].default_value = vals['metal']
        b.inputs['Roughness'].default_value = vals['rough']
        b.inputs['Alpha'].default_value = vals['alpha']
        b.inputs['Emission Color'].default_value = vals['emit']
        b.inputs['Emission Strength'].default_value = vals['estr']
        if vals['alpha'] < 1.0:
            b.inputs['Transmission Weight'].default_value = 0.0


# ----------------------------------------------------------------------------
# scene
# ----------------------------------------------------------------------------
def setup_scene(samples, res):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 6
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.compression = 90
    sc.render.threads_mode = 'AUTO'
    w = bpy.data.worlds.new('Sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_disc = False
    sky.sun_elevation = math.radians(30)
    sky.sun_rotation = math.radians(215)
    sky.air_density = 1.2
    sky.dust_density = 1.2
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.25
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.5
    sun.angle = math.radians(1.5)
    sun.color = (1.0, 0.9, 0.78)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = Euler((math.radians(58), 0, math.radians(-35)), 'XYZ')
    sc.collection.objects.link(so)
    # sand
    me = bpy.data.meshes.new('Ground')
    s = 3000
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('PV_Ground', me)
    m = bpy.data.materials.new('PV_Sand')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.95
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 0.35
    nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*srgb('#c9a676'), 1)
    ramp.color_ramp.elements[1].color = (*srgb('#e2c697'), 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], b.inputs['Base Color'])
    rip = nt.nodes.new('ShaderNodeTexWave')
    rip.inputs['Scale'].default_value = 1.4
    rip.inputs['Distortion'].default_value = 6
    nt.links.new(tc.outputs['Object'], rip.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.15
    nt.links.new(rip.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    me.materials.append(m)
    sc.collection.objects.link(g)
    return sc


def add_sea(sc, y0=60.0, z=-0.2):
    me = bpy.data.meshes.new('Sea')
    s = 3000
    me.from_pydata([(-s, y0, z), (s, y0, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('PV_Sea', me)
    m = bpy.data.materials.new('PV_SeaMat')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb('#1f4f5c'), 1)
    b.inputs['Roughness'].default_value = 0.08
    b.inputs['Specular IOR Level'].default_value = 0.6
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wv = nt.nodes.new('ShaderNodeTexNoise')
    wv.inputs['Scale'].default_value = 1.2
    wv.inputs['Detail'].default_value = 8
    nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.08
    nt.links.new(wv.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    me.materials.append(m)
    sc.collection.objects.link(o)
    return o


def roots():
    return [o for o in bpy.data.objects if o.parent is None and not o.name.startswith('PV_')
            and o.name not in ('Sun', 'Cam')]


def hierarchy(o):
    return [o] + list(o.children_recursive)


REST = {}


def reset():
    for o in list(bpy.data.objects):
        if o.name.startswith('PVL_') or o.name.startswith('PVC_'):
            bpy.data.objects.remove(o)
    for o in roots():
        for h in hierarchy(o):
            h.hide_render = True
            if h.name in REST:
                h.location = REST[h.name]
            elif h.parent is not None:
                REST[h.name] = h.location.copy()
        o.location = (0, 0, 0)
        o.rotation_euler = (0, 0, 0)
        o.scale = (1, 1, 1)


def fill_panels(o):
    """Put the breakable TP_Stucco panel into every SLOT_panel gap, as the game does."""
    src = bpy.data.objects.get('TP_Stucco')
    if src is None:
        return
    bpy.context.view_layer.update()
    for h in hierarchy(o):
        if h.type == 'EMPTY' and h.name.startswith('SLOT_panel'):
            c = bpy.data.objects.new('PVC_panel_%d' % len(bpy.data.objects), src.data)
            bpy.context.scene.collection.objects.link(c)
            c.matrix_world = h.matrix_world.copy()


def show(name, loc=(0, 0, 0), rz=0.0, lights=True, lamp=90.0, panels=True):
    o = bpy.data.objects[name]
    o.location = V(loc)
    o.rotation_euler = (0, 0, math.radians(rz))
    for h in hierarchy(o):
        if '_COL_' in h.name or h.type == 'EMPTY':
            h.hide_render = True
        else:
            h.hide_render = False
    bpy.context.view_layer.update()
    if panels:
        fill_panels(o)
    if lights:
        for h in hierarchy(o):
            if h.type == 'EMPTY' and h.name.startswith('SLOT_light'):
                L = bpy.data.lights.new('PVL_' + h.name, 'POINT')
                L.energy = lamp
                L.color = (1.0, 0.72, 0.42)
                L.shadow_soft_size = 0.15
                lo = bpy.data.objects.new('PVL_' + h.name, L)
                lo.location = h.matrix_world.translation
                bpy.context.scene.collection.objects.link(lo)
    return o


def clone(name, loc, rz=0.0):
    """Linked duplicate of a whole hierarchy (visual meshes only)."""
    src = bpy.data.objects[name]
    root = bpy.data.objects.new('PVC_' + name + '_%d' % len(bpy.data.objects), src.data)
    bpy.context.scene.collection.objects.link(root)
    root.location = V(loc)
    root.rotation_euler = (0, 0, math.radians(rz))
    for h in src.children_recursive:
        if h.type == 'MESH' and '_COL_' not in h.name:
            c = bpy.data.objects.new('PVC_' + h.name + '_%d' % len(bpy.data.objects), h.data)
            bpy.context.scene.collection.objects.link(c)
            c.parent = root
            c.matrix_parent_inverse = Matrix.Identity(4)
            c.matrix_basis = h.matrix_basis.copy()
    return root


def camera(sc, loc, target, lens=35):
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 5000
    cam.location = V(loc)
    cam.rotation_euler = (V(target) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam


def sun_dir(elev, azim):
    so = bpy.data.objects['Sun']
    so.rotation_euler = Euler((math.radians(90 - elev), 0, math.radians(azim)), 'XYZ')


def exists(n):
    return n in bpy.data.objects


# ----------------------------------------------------------------------------
# shots
# ----------------------------------------------------------------------------
def shot_cottage_ext():
    show('B_Cottage', (0, 0, 0), 0)
    return dict(loc=(9.5, -13.0, 4.2), target=(-0.5, 0.0, 2.6), lens=30, res=(960, 540))


def shot_cottage():
    show('B_Cottage', (0, 0, 0), 0, lamp=60)
    return dict(loc=(3.2, 2.9, 1.65), target=(-0.6, -2.3, 1.2), lens=20, res=(960, 540))


def shot_workshop_ext():
    show('B_Workshop', (0, 0, 0), 0)
    return dict(loc=(8.5, -15.0, 3.2), target=(-1.0, 0.0, 3.4), lens=28, res=(960, 540))


def shot_workshop():
    show('B_Workshop', (0, 0, 0), 0, lamp=80)
    return dict(loc=(4.4, -3.0, 1.7), target=(-2.0, 1.2, 2.2), lens=18, res=(960, 540))


def shot_house_ext():
    show('B_House', (0, 0, 0), 0)
    return dict(loc=(-9.5, -16.0, 5.0), target=(0.5, -1.0, 4.2), lens=28, res=(960, 540))


def shot_house():
    show('B_House', (0, 0, 0), 0, lamp=70)
    return dict(loc=(-3.0, -5.3, 1.7), target=(2.2, 0.6, 1.9), lens=18, res=(960, 540))


def shot_chapel_ext():
    show('B_Chapel', (0, 0, 0), 0)
    return dict(loc=(14.0, -26.0, 5.5), target=(-2.5, 0.0, 7.5), lens=26, res=(960, 540))


def shot_chapel():
    show('B_Chapel', (0, 0, 0), 0, lamp=150)
    return dict(loc=(1.2, -8.0, 1.8), target=(0.0, 9.0, 4.0), lens=20, res=(960, 540))


def shot_belfry():
    show('B_Chapel', (0, 0, 0), 0, lamp=60)
    return dict(loc=(-8.3, -8.3, 14.6), target=(-6.0, -6.0, 15.2), lens=16, res=(960, 540))


def shot_station_ext():
    show('B_Station', (0, 0, 0), 0)
    show('B_StationPlatform', (0, 6.2, 0), 0)
    return dict(loc=(9.0, -16.0, 3.4), target=(-1.0, 1.0, 3.0), lens=26, res=(960, 540))


def shot_station():
    show('B_Station', (0, 0, 0), 0, lamp=70)
    return dict(loc=(2.6, -2.2, 1.7), target=(-6.0, 1.5, 1.6), lens=20, res=(960, 540))


def shot_platform():
    show('B_Station', (0, 0, 0), 0)
    show('B_StationPlatform', (0, 6.2, 0), 0)
    return dict(loc=(12.5, 10.5, 2.7), target=(-4.0, 5.0, 2.6), lens=24, res=(960, 540))


def shot_tower_ext():
    show('B_Tower', (0, 0, 0), 0)
    return dict(loc=(13.0, -17.0, 3.5), target=(0.0, 0.0, 6.8), lens=24, res=(960, 540))


def shot_tower():
    show('B_Tower', (0, 0, 0), 0, lamp=40)
    return dict(loc=(1.2, -1.6, 1.6), target=(-0.6, 0.8, 6.5), lens=14, res=(960, 540))


def shot_boathouse_ext():
    show('B_Boathouse', (0, 0, 0), 0)
    return dict(loc=(-8.5, -13.5, 2.6), target=(0.5, 0.0, 2.4), lens=26, res=(960, 540))


def shot_boathouse():
    show('B_Boathouse', (0, 0, 0), 0, lamp=60)
    return dict(loc=(3.4, 3.2, 1.9), target=(-0.6, -1.8, 1.0), lens=20, res=(960, 540))


def shot_loggia_ext():
    show('B_Loggia', (0, 0, 0), 0)
    return dict(loc=(-9.0, -12.5, 3.0), target=(1.0, 0.0, 2.2), lens=24, res=(960, 540))


def shot_loggia():
    show('B_Loggia', (0, 0, 0), 0, lamp=50)
    return dict(loc=(-6.6, -1.2, 1.7), target=(3.0, 0.8, 1.6), lens=20, res=(960, 540))


def face_centre(x, y):
    """rz (degrees) that turns an asset's front (-Y) toward the origin."""
    return math.degrees(math.atan2(-x, y))


def ring_of_cliffs():
    for name, (x, y), s in (('H_Cliff_A', (0.0, 78.0), 1.1), ('H_Cliff_B', (-58.0, 58.0), 1.0),
                            ('H_Cliff_C', (60.0, 60.0), 1.15)):
        o = show(name, (x, y, -2.0), face_centre(x, y), lights=False)
        o.scale = (s, s, s)
    for name, (x, y), s in (('H_Cliff_B', (-88.0, 5.0), 1.2), ('H_Cliff_A', (86.0, 0.0), 1.05)):
        c = clone(name, (x, y, -2.0), face_centre(x, y))
        c.scale = (s, s, s)


def shot_cliffs():
    ring_of_cliffs()
    show('H_Islet', (-20.0, 210.0, -0.2), 20, lights=False)
    o = show('H_Ridge', (30.0, 330.0, -2.0), 0, lights=False)
    o.scale = (1.4, 1.0, 1.0)
    add_sea(bpy.context.scene, y0=125.0)
    show('B_Chapel', (-6.0, 28.0, 0), 200)
    show('B_House', (12.0, 22.0, 0), 190)
    return dict(loc=(4.0, -18.0, 2.2), target=(0.0, 70.0, 9.0), lens=24)


def shot_cliff_close():
    show('H_Cliff_C', (0.0, 38.0, -2.0), 0, lights=False)
    return dict(loc=(-8.0, -6.0, 2.0), target=(0.0, 38.0, 12.0), lens=24, res=(960, 540))


def shot_street():
    """A plaza of the half-buried village with the headlands closing the valley."""
    show('B_Workshop', (-10.0, 7.0, 0), 8)
    show('B_House', (5.5, 10.0, 0), -4)
    show('B_Cottage', (17.0, 3.0, 0), -28)
    show('B_Loggia', (-24.0, 1.0, 0), 38)
    show('B_Chapel', (-4.0, 34.0, 0), 4)
    show('B_Tower', (24.0, 26.0, 0), -20)
    for name, (x, y), s_ in (('H_Cliff_A', (0.0, 80.0), 1.1), ('H_Cliff_C', (-62.0, 60.0), 1.15),
                             ('H_Cliff_B', (60.0, 62.0), 1.0)):
        o = show(name, (x, y, -2.0), face_centre(x, y), lights=False)
        o.scale = (s_, s_, s_)
    return dict(loc=(1.0, -19.0, 1.9), target=(-1.0, 14.0, 5.2), lens=24)


def shot_kit():
    """Kit sheet: every building, the panel pair and the islet."""
    layout = [('B_Cottage', (-27.0, 0.0), 0), ('B_Workshop', (-13.0, 0.0), 0), ('B_House', (1.0, 0.0), 0),
              ('B_Boathouse', (14.0, 0.0), 0), ('B_Tower', (27.0, 0.0), 0),
              ('B_Station', (-20.0, 22.0), 0), ('B_StationPlatform', (-20.0, 30.0), 0), ('B_Loggia', (4.0, 24.0), 0),
              ('B_Chapel', (26.0, 26.0), 0), ('TP_Stucco', (-3.0, -12.0), 0), ('TP_Stucco_Fractured', (3.0, -12.0), 0)]
    for name, (x, y), r in layout:
        show(name, (x, y, 0), r, lights=False)
    fr = bpy.data.objects['TP_Stucco_Fractured']
    for c in fr.children:
        d = c.location - V((0, 0, 1.7))
        c.location = c.location + d * 0.18 + V((0, -0.25 * (1.0 - min(1.0, d.length / 2.5)), 0))
    return dict(loc=(0.0, -44.0, 30.0), target=(0.0, 10.0, 2.0), lens=30)


def shot_panel():
    show('TP_Stucco', (-2.6, 0, 0), 0, lights=False)
    show('TP_Stucco_Fractured', (2.6, 0, 0), 0, lights=False)
    fr = bpy.data.objects['TP_Stucco_Fractured']
    for c in fr.children:
        d = c.location - V((0, 0, 1.7))
        c.location = c.location + d * 0.16 + V((0, -0.35 * (1.0 - min(1.0, d.length / 2.5)), 0))
    return dict(loc=(1.8, -9.5, 2.6), target=(0.0, 0.0, 1.7), lens=32, res=(960, 540))


def shot_islet():
    add_sea(bpy.context.scene, y0=-50.0)
    show('H_Islet', (0.0, 60.0, -0.2), 30, lights=False)
    o = show('H_Ridge', (40.0, 240.0, -2.0), 0, lights=False)
    o.scale = (1.3, 1.0, 1.0)
    return dict(loc=(-10.0, -8.0, 3.0), target=(0.0, 60.0, 6.0), lens=30)


HERO = {'street', 'kit', 'cliffs'}

SHOTS = [
    ('street', shot_street),
    ('kit', shot_kit),
    ('cliffs', shot_cliffs),
    ('panel', shot_panel),
    ('cottage_ext', shot_cottage_ext),
    ('cottage', shot_cottage),
    ('workshop_ext', shot_workshop_ext),
    ('workshop', shot_workshop),
    ('house_ext', shot_house_ext),
    ('house', shot_house),
    ('chapel_ext', shot_chapel_ext),
    ('chapel', shot_chapel),
    ('belfry', shot_belfry),
    ('station_ext', shot_station_ext),
    ('station', shot_station),
    ('platform', shot_platform),
    ('tower_ext', shot_tower_ext),
    ('tower', shot_tower),
    ('boathouse_ext', shot_boathouse_ext),
    ('boathouse', shot_boathouse),
    ('loggia_ext', shot_loggia_ext),
    ('loggia', shot_loggia),
    ('cliff_close', shot_cliff_close),
    ('islet', shot_islet),
]


def main():
    argv = sys.argv[1:]
    glb = GLB
    only = None
    samples = 64
    res = (1280, 720)
    out_dir = OUT_DIR
    if '--glb' in argv:
        glb = os.path.abspath(argv[argv.index('--glb') + 1])
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--samples' in argv:
        samples = int(argv[argv.index('--samples') + 1])
    if '--out' in argv:
        out_dir = os.path.abspath(argv[argv.index('--out') + 1])
    if '--res' in argv:
        r = argv[argv.index('--res') + 1].split('x')
        res = (int(r[0]), int(r[1]))
    os.makedirs(out_dir, exist_ok=True)
    manifest = json.load(open(os.path.join(TEX, 'manifest.json')))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in bpy.data.objects:
        o.rotation_mode = 'XYZ'
    for m in bpy.data.materials:
        if m.use_nodes:
            rebuild_material(m, manifest)
    sc = setup_scene(samples, res)
    for name, fn in SHOTS:
        if only and name not in only:
            continue
        reset()
        for o in list(bpy.data.objects):
            if o.name.startswith('PV_Sea'):
                bpy.data.objects.remove(o)
        bpy.data.objects['PV_Ground'].hide_render = (name == 'islet')
        sun_dir(32, -35)
        cam = fn()
        if cam is None:
            continue
        camera(sc, cam['loc'], cam['target'], cam.get('lens', 35))
        r = cam.get('res', res)
        sc.render.resolution_x, sc.render.resolution_y = min(r[0], res[0]), min(r[1], res[1])
        # hero shots at the full sample count, detail shots at half (denoised)
        sc.cycles.samples = samples if name in HERO else max(16, samples // 2)
        sc.render.filepath = os.path.join(out_dir, 'town_%s.png' % name)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print('rendered %s in %.1fs' % (sc.render.filepath, time.time() - t))


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
