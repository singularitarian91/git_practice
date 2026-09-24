#!/usr/bin/env python3
"""
Juxtapose -- contact-sheet preview renders of props.glb.

Imports the exported GLB (so the previews show exactly what the game loads),
lays the assets out in groups on a sand ground under a sun and a sky, and
renders each group with Cycles (CPU) to juxtapose/docs/previews/props_*.png.

    python3 juxtapose/blender/render_previews.py
    python3 juxtapose/blender/render_previews.py --glb /tmp/x.glb --only enemies --samples 32
"""
import bpy
import math
import os
import sys
import time
from mathutils import Vector as V, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
GLB = os.path.join(PROJ, 'assets', 'props.glb')
OUT_DIR = os.path.join(PROJ, 'docs', 'previews')


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def setup_scene(samples, res):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 6
    sc.cycles.glossy_bounces = 3
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.compression = 100
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    # sky
    w = bpy.data.worlds.new('Sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_disc = False
    sky.sun_elevation = math.radians(28)
    sky.sun_rotation = math.radians(200)
    sky.air_density = 1.0
    sky.dust_density = 0.6
    sky.ozone_density = 1.0
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.22
    # sun
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.2
    sun.angle = math.radians(2.5)
    sun.color = (1.0, 0.9, 0.76)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = Euler((math.radians(52), 0, math.radians(-38)), 'XYZ')
    sc.collection.objects.link(so)
    # ground
    me = bpy.data.meshes.new('Ground')
    s = 6000
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('Ground', me)
    m = bpy.data.materials.new('GroundSand')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb('#d6b27c'), 1)
    b.inputs['Roughness'].default_value = 1.0
    me.materials.append(m)
    sc.collection.objects.link(g)
    return sc


def top_level():
    return [o for o in bpy.data.objects if o.parent is None and o.name not in ('Sun', 'Ground', 'Cam')]


def hierarchy(o):
    return [o] + list(o.children_recursive)


def camera(sc, loc, target, lens=50):
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cd = bpy.data.cameras.new('Cam')
        cam = bpy.data.objects.new('Cam', cd)
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_end = 20000
    cam.location = V(loc)
    d = V(target) - V(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    return cam


def reset(obs0):
    for o in bpy.data.objects:
        if o.name.startswith('PV_'):
            bpy.data.objects.remove(o)
    for o in obs0:
        for h in hierarchy(o):
            h.hide_render = True
        o.location = (0, 0, 0)
        o.rotation_euler = (0, 0, 0)


def show(name, loc=(0, 0, 0), rz=0.0):
    o = bpy.data.objects[name]
    for h in hierarchy(o):
        h.hide_render = False
    o.location = V(loc)
    o.rotation_euler = (0, 0, math.radians(rz))
    return o


def explode(name, amount, center):
    o = bpy.data.objects[name]
    for c in o.children:
        d = c.location - V(center)
        c.location = c.location + d * amount


def clone(name, newname, loc, rz=0.0):
    src = bpy.data.objects[name]
    o = bpy.data.objects.new(newname, src.data)
    bpy.context.scene.collection.objects.link(o)
    o.location = V(loc)
    o.rotation_euler = (0, 0, math.radians(rz))
    return o


def rail(p0, p1, r=0.05):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r, depth=(V(p1) - V(p0)).length)
    me = bpy.data.meshes.new('PV_rail')
    bm.to_mesh(me)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new('PV_rail', me)
    bpy.context.scene.collection.objects.link(o)
    d = V(p1) - V(p0)
    o.location = (V(p0) + V(p1)) / 2
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    m = bpy.data.materials.get('PV_RailMat')
    if m is None:
        m = bpy.data.materials.new('PV_RailMat')
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb('#b98a3e'), 1)
        b.inputs['Metallic'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.35
    me.materials.append(m)
    return o


def pose_clock_hands():
    bpy.data.objects['Clock_HandHour'].rotation_euler = (0, math.radians(-60), 0)
    bpy.data.objects['Clock_HandMinute'].rotation_euler = (0, math.radians(60), 0)


def shot_sources_large():
    show('Bed', (-2.3, 1.0, 0), 22)
    show('Mirror', (0.2, 0.5, 0), -12)
    show('Clock', (1.75, -0.3, 0), -18)
    pose_clock_hands()
    show('Cloud', (0.2, 3.0, 2.9), 10)
    return dict(loc=(0.0, -7.2, 2.3), target=(-0.1, 0.6, 1.25), lens=36)


def shot_sources_small():
    show('Candle', (-0.95, 0.15, 0), 0)
    show('BowlerHat', (-0.5, -0.12, 0), 20)
    show('Birdcage', (0.05, 0.3, 0), 0)
    show('Pomegranate', (0.5, -0.12, 0), -10)
    show('Apple', (0.05, -0.38, 0), 30)
    show('Anvil', (1.05, 0.2, 0), -40)
    return dict(loc=(0.05, -3.1, 1.15), target=(0.07, 0.05, 0.27), lens=46)


def shot_architecture():
    show('Wall', (-5.0, 1.0, 0), 0)
    show('Wall_Fractured', (-0.6, 1.0, 0), 0)
    explode('Wall_Fractured', 0.12, (0, 0, 1.5))
    show('Column', (2.6, -0.6, 0), 0)
    show('Column_Fractured', (4.0, -0.6, 0), 0)
    explode('Column_Fractured', 0.07, (0, 0, 2.0))
    show('Arch', (8.0, 2.0, 0), -20)
    show('Door', (-3.8, -2.4, 0), 25)
    bpy.data.objects['Door_Leaf'].rotation_euler = (0, 0, math.radians(-55))
    return dict(loc=(0.5, -15.5, 4.0), target=(1.2, 0.5, 1.9), lens=30)


def shot_landscape():
    show('DeadTree', (-4.6, 2.2, 0), 0)
    show('Rock_C', (-1.9, 3.6, 0), 40)
    show('Rock_A', (1.3, 3.8, 0), 20)
    show('Rock_B', (5.4, 5.2, 0), -30)
    show('Platform', (3.4, 0.6, 2.5), 20)
    show('RailPost', (-2.6, -1.5, 0), 90)
    clone('RailPost', 'PV_post2', (0.4, -1.5, 0), 90)
    rail((-3.8, -1.5, 1.6), (1.6, -1.5, 1.6))
    show('Apple', (-1.0, -2.6, 0), 0)
    return dict(loc=(-0.4, -9.8, 2.7), target=(0.1, 2.0, 1.55), lens=30)


def shot_piazza():
    show('Arch', (-3.2, 3.0, 0), 0)
    show('Column', (1.2, -0.2, 0), 0)
    show('Wall', (4.6, 2.8, 0), 0)
    show('Train', (2.0, 18.0, 0), 0)
    show('Door', (-0.6, -1.2, 0), 10)
    bpy.data.objects['Door_Leaf'].rotation_euler = (0, 0, math.radians(-70))
    return dict(loc=(-1.0, -11.0, 2.2), target=(0.4, 4.0, 1.9), lens=30)


def shot_destructibles():
    show('Drawers', (-0.8, 0, 0), 12)
    show('Drawers_Fractured', (0.9, 0, 0), -12)
    explode('Drawers_Fractured', 0.35, (0, 0, 0.55))
    return dict(loc=(0.1, -4.0, 1.7), target=(0.05, 0, 0.55), lens=40)


def shot_enemies():
    show('Unwatched', (1.5, 5.5, 0), -10)
    show('Sleepwalker', (-2.2, -1.2, 0), 15)
    for side, s in (('L', 1), ('R', -1)):
        bpy.data.objects['SW_Arm' + side].rotation_euler = (math.radians(-82), 0, math.radians(-4 * s))
        bpy.data.objects['SW_Forearm' + side].rotation_euler = (math.radians(-6), 0, 0)
    bpy.data.objects['SW_Drawer'].location.y -= 0.07
    bpy.data.objects['SW_LegL'].rotation_euler = (math.radians(12), 0, 0)
    bpy.data.objects['SW_ShinL'].rotation_euler = (math.radians(-18), 0, 0)
    bpy.data.objects['SW_LegR'].rotation_euler = (math.radians(-14), 0, 0)
    bpy.data.objects['SW_Head'].rotation_euler = (math.radians(6), 0, math.radians(-8))
    return dict(loc=(-3.5, -13.5, 3.6), target=(0.2, 2.0, 3.4), lens=30)


def shot_sleepwalker():
    show('Sleepwalker', (0, 0, 0), 25)
    clone_hierarchy_sleepwalker()
    return dict(loc=(0.6, -4.6, 1.45), target=(0.58, 0, 0.98), lens=45)


def clone_hierarchy_sleepwalker():
    """Second, posed copy (linked meshes) beside the rest-pose one."""
    src = bpy.data.objects['Sleepwalker']
    mapping = {}
    for o in hierarchy(src):
        n = bpy.data.objects.new('PV_' + o.name, o.data)
        bpy.context.scene.collection.objects.link(n)
        mapping[o.name] = n
    for o in hierarchy(src):
        n = mapping[o.name]
        if o.parent:
            n.parent = mapping[o.parent.name]
        n.location = o.location.copy()
        n.rotation_euler = o.rotation_euler.copy()
    root = mapping['Sleepwalker']
    root.location = (1.15, 0.2, 0)
    root.rotation_euler = (0, 0, math.radians(-30))
    for side, s in (('L', 1), ('R', -1)):
        mapping['SW_Arm' + side].rotation_euler = (math.radians(-80), 0, math.radians(-5 * s))
    mapping['SW_Drawer'].location.y -= 0.075
    mapping['SW_LegR'].rotation_euler = (math.radians(20), 0, 0)
    mapping['SW_ShinR'].rotation_euler = (math.radians(-30), 0, 0)
    mapping['SW_LegL'].rotation_euler = (math.radians(-10), 0, 0)
    mapping['SW_Head'].rotation_euler = (math.radians(10), 0, math.radians(15))


def shot_detail_head():
    show('Sleepwalker', (0, 0, 0), 30)
    return dict(loc=(-0.45, -1.75, 1.8), target=(0.0, 0.0, 1.6), lens=55)


def shot_detail_eye():
    show('Unwatched', (0, 0, 0), -15)
    return dict(loc=(-1.2, -7.5, 7.2), target=(0.0, 0.0, 6.5), lens=50)


def shot_detail_props():
    show('Anvil', (-0.75, 0.0, 0), -35)
    show('RailPost', (0.25, 0.25, 0), 20)
    show('Pomegranate', (0.95, -0.2, 0), -5)
    show('Drawers', (-2.0, 1.0, 0), 20)
    return dict(loc=(-0.2, -3.7, 1.45), target=(0.05, 0.15, 0.8), lens=35)


SHOTS = [
    ('sources_large', shot_sources_large),
    ('sources_small', shot_sources_small),
    ('architecture', shot_architecture),
    ('landscape', shot_landscape),
    ('piazza', shot_piazza),
    ('destructibles', shot_destructibles),
    ('enemies', shot_enemies),
    ('sleepwalker', shot_sleepwalker),
    ('detail_head', shot_detail_head),
    ('detail_eye', shot_detail_eye),
    ('detail_props', shot_detail_props),
]


def main():
    argv = sys.argv[1:]
    glb = GLB
    only = None
    samples = 96
    res = (960, 540)
    out_dir = OUT_DIR
    if '--glb' in argv:
        glb = os.path.abspath(argv[argv.index('--glb') + 1])
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--samples' in argv:
        samples = int(argv[argv.index('--samples') + 1])
    if '--out' in argv:
        out_dir = os.path.abspath(argv[argv.index('--out') + 1])
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in bpy.data.objects:
        o.rotation_mode = 'XYZ'
    sc = setup_scene(samples, res)
    obs0 = top_level()
    for name, fn in SHOTS:
        if only and name not in only:
            continue
        reset(obs0)
        for o in bpy.data.objects:
            if o.parent is not None and o.name.split('_')[0] in ('SW', 'UW', 'Clock', 'Door'):
                o.rotation_euler = (0, 0, 0)
        # restore child rest locations (explode/pose may have moved them)
        for o in bpy.data.objects:
            if 'rest_loc' in o:
                o.location = V(o['rest_loc'])
            elif o.parent is not None:
                o['rest_loc'] = list(o.location)
        cam = fn()
        camera(sc, cam['loc'], cam['target'], cam.get('lens', 50))
        sc.render.filepath = os.path.join(out_dir, 'props_%s.png' % name)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print('rendered %s in %.1fs' % (sc.render.filepath, time.time() - t))


if __name__ == '__main__':
    main()
    # bpy-as-a-module can segfault in interpreter teardown after using the glTF
    # add-on; everything is written by now, so exit directly.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
