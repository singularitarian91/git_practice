"""Character sheet renders for the Figment (called from build_figure.py --sheet).

Renders into juxtapose/docs/character/:
  portrait.png    hero shot in the Soft Desert at golden hour (with a melting clock on a dead tree)
  turnaround.png  front / three-quarter / side / back on a studio backdrop
  actions.png     the moveset: wall-run, slash, deflect, pogo, deathblow, focus
  gun.png         close-up of the Juxtaposition Gun, bayonet out
"""
import bpy, math, os
from mathutils import Vector, Euler

SAMPLES = 96


def _look(cam, pos, target, lens):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


def _mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def _engine(scene, res, samples=SAMPLES):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'


class Stage:
    """Everything temporary we add, so it can be removed between shots."""
    def __init__(self):
        self.objs = []

    def add(self, o):
        bpy.context.scene.collection.objects.link(o) if o.name not in bpy.context.scene.collection.objects else None
        self.objs.append(o)
        return o

    def clear(self):
        for o in self.objs:
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
        self.objs = []


def _light(stage, kind, name, energy, color, loc=None, rot=None, size=None, angle=None):
    L = bpy.data.lights.new(name, kind)
    L.energy = energy
    L.color = color
    if size is not None:
        L.size = size
    if angle is not None:
        L.angle = math.radians(angle)
    o = bpy.data.objects.new(name, L)
    if loc:
        o.location = loc
    if rot:
        o.rotation_euler = rot
    return stage.add(o)


def _desert_world(scene):
    w = bpy.data.worlds.new('SheetDesert')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(11)
    sky.sun_rotation = math.radians(210)
    sky.altitude = 200
    sky.air_density = 1.4
    sky.dust_density = 3.0
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.22
    scene.world = w


def _studio_world(scene, color=(0.2, 0.17, 0.2)):
    w = bpy.data.worlds.new('SheetStudio')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*color, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    scene.world = w


def _ground(stage, color, size=80, dunes=True):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=120, y_subdivisions=120, size=size)
    g = bpy.context.active_object
    g.name = 'SheetGround'
    if dunes:
        tex = bpy.data.textures.new('SheetDunes', 'CLOUDS')
        tex.noise_scale = 6
        d = g.modifiers.new('Dunes', 'DISPLACE')
        d.texture = tex
        d.strength = 1.2
        d.mid_level = 0.75
        g.modifiers.new('Smooth', 'SUBSURF').levels = 1
    bpy.ops.object.shade_smooth()
    g.data.materials.append(_mat('SheetSand', color, 0.95))
    stage.objs.append(g)
    return g


def _import_props(stage, names):
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'props.glb')
    got = {}
    if not os.path.exists(path):
        return got
    before = set(bpy.data.objects.keys())
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:  # the kit may be mid-rebuild; the sheet works without props
        print('props import failed:', e)
        return got
    new = [bpy.data.objects[n] for n in set(bpy.data.objects.keys()) - before]
    for o in new:
        root = o
        while root.parent is not None:
            root = root.parent
        if root.name.split('.')[0] in names:
            got.setdefault(root.name.split('.')[0], root)
    keep = set()
    for r in got.values():
        keep.add(r.name)
        for c in r.children_recursive:
            keep.add(c.name)
    for o in new:
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            stage.objs.append(o)
    return got


def hero_pose(FA):
    """Contrapposto, gun resting on the right shoulder, blade folded, head turned to us."""
    p = {}
    FA.stand(p)
    FA.add(p, 'hips', 0, 6, -3)
    FA.add(p, 'thighL', -8, 12, 10)
    FA.add(p, 'shinL', 10)
    FA.add(p, 'footL', -4, 0, -6)
    FA.add(p, 'thighR', 4, -10, -6)
    FA.add(p, 'spine', -4, 0, 3)
    FA.add(p, 'chest', -3, 10, 0)
    FA.add(p, 'neck', 0, -8, 0)
    FA.add(p, 'head', -8, -16, 4)
    FA.add(p, 'upperarmR', *HERO_ARM[0])
    FA.add(p, 'forearmR', *HERO_ARM[1])
    FA.add(p, 'handR', *HERO_ARM[2])
    FA.add(p, 'upperarmL', 4, 0, 16)
    FA.add(p, 'forearmL', -52, 20, 0)
    FA.add(p, 'handL', 0, 0, 20)
    p['gunBlade'] = (0, 0, 0)
    return p


HERO_ARM = [(-30, -8, -20), (-60, 20, 0), (-20, 0, 0)]
HERO_CANDIDATES = [
    [(-22, 0, -16), (-46, 14, 0), (-12, 0, 0)],
    [(-30, -8, -20), (-60, 20, 0), (-20, 0, 0)],
    [(-12, 0, -40), (-150, -40, 0), (-30, 0, 0)],
]


def wood_grain():
    """Render-only wood grain on the mannequin (the exported asset keeps its flat colour)."""
    m = bpy.data.materials.get('Wood')
    if not m or m.get('grained'):
        return
    m['grained'] = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (30, 30, 4)
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 0.6
    wave.inputs['Distortion'].default_value = 3.5
    wave.inputs['Detail'].default_value = 6
    wave.inputs['Detail Roughness'].default_value = 0.7
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.52, 0.31, 0.15, 1)
    ramp.color_ramp.elements[1].color = (0.64, 0.41, 0.21, 1)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.75
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.45
    b.inputs['Coat Weight'].default_value = 0.35
    b.inputs['Coat Roughness'].default_value = 0.2


def render_character_sheet(arm, FA, apply_pose, outdir, parts=None):
    from PIL import Image, ImageDraw, ImageFont
    parts = set(parts or ['portrait', 'turnaround', 'actions', 'gun'])
    os.makedirs(outdir, exist_ok=True)
    wood_grain()
    scene = bpy.context.scene
    cam = bpy.data.objects.new('SheetCam', bpy.data.cameras.new('SheetCam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    stage = Stage()

    def shot(path):
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('wrote', path)

    # ---------------------------------------------------------- 1. hero portrait
    if 'portrait' in parts:
        _portrait(scene, cam, stage, arm, FA, apply_pose, outdir, shot)
    if 'turnaround' in parts:
        _turnaround(scene, cam, stage, arm, FA, apply_pose, outdir, shot, Image, ImageDraw)
    if 'actions' in parts:
        _actions(scene, cam, stage, arm, FA, apply_pose, outdir, shot, Image, ImageDraw)
    if 'gun' in parts:
        _gun(scene, cam, stage, arm, FA, apply_pose, outdir, shot)
    stage.clear()
    bpy.data.objects.remove(cam, do_unlink=True)
    arm.rotation_euler = (0, 0, 0)


def _portrait(scene, cam, stage, arm, FA, apply_pose, outdir, shot):
    _engine(scene, (1000, 1250))
    _desert_world(scene)
    _ground(stage, (0.62, 0.4, 0.22))
    _light(stage, 'SUN', 'SheetSun', 4.2, (1.0, 0.82, 0.62), rot=Euler((math.radians(79), 0, math.radians(210))), angle=1.5)
    _light(stage, 'AREA', 'SheetRim', 260, (0.55, 0.7, 1.0), loc=(1.6, 2.4, 2.4), rot=Euler((math.radians(-60), math.radians(20), math.radians(150))), size=2)
    _light(stage, 'AREA', 'SheetFill', 70, (1.0, 0.85, 0.7), loc=(-2.5, -3, 1.4), rot=Euler((math.radians(70), 0, math.radians(-40))), size=3)
    props = _import_props(stage, {'DeadTree', 'Clock', 'Cloud'})
    for o in props.values():
        o.rotation_mode = 'XYZ'
    if 'DeadTree' in props:
        props['DeadTree'].location = (2.4, 6.0, 0.25)
        props['DeadTree'].rotation_euler = (0, 0, math.radians(180))
    if 'Clock' in props:
        # melted over the branch
        props['Clock'].location = (0.65, 6.0, 2.05)
        props['Clock'].rotation_euler = (math.radians(-8), math.radians(4), math.radians(-12))
        props['Clock'].scale = (1.1, 1.1, 1.0)
    if 'Cloud' in props:
        props['Cloud'].location = (-3.5, 22, 9)
        props['Cloud'].scale = (3.5, 3.5, 3.5)
    arm.rotation_euler = (0, 0, math.radians(-14))
    apply_pose(hero_pose(FA))
    bpy.context.view_layer.update()
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = 3.8
    cam.data.dof.aperture_fstop = 4
    _look(cam, (-1.25, -3.55, 0.66), (0.08, 0.0, 1.0), 50)
    if os.environ.get('HERO_TEST'):
        from PIL import Image
        scene.cycles.samples = 16
        scene.render.resolution_x, scene.render.resolution_y = 360, 450
        tiles = []
        for i, arm_pose in enumerate(HERO_CANDIDATES):
            HERO_ARM[:] = arm_pose
            apply_pose(hero_pose(FA)); bpy.context.view_layer.update()
            p = os.path.join(outdir, '_h.png'); shot(p); tiles.append(Image.open(p).convert('RGB'))
        sheet = Image.new('RGB', (360 * len(tiles), 450))
        for i, im in enumerate(tiles):
            sheet.paste(im, (i * 360, 0))
        sheet.save(os.path.join(outdir, '_hero_test.png'))
        stage.clear()
        return
    shot(os.path.join(outdir, 'portrait.png'))
    stage.clear()
    cam.data.dof.use_dof = False


def _turnaround(scene, cam, stage, arm, FA, apply_pose, outdir, shot, Image, ImageDraw):
    _engine(scene, (420, 720), 64)
    _studio_world(scene, (0.13, 0.1, 0.14))
    floor = _ground(stage, (0.35, 0.3, 0.3), 30, dunes=False)
    _light(stage, 'AREA', 'Key', 420, (1.0, 0.9, 0.78), loc=(-2.5, -3, 3), rot=Euler((math.radians(55), 0, math.radians(-38))), size=2.5)
    _light(stage, 'AREA', 'Rim', 300, (0.6, 0.72, 1.0), loc=(2.2, 2.6, 2.6), rot=Euler((math.radians(-55), 0, math.radians(140))), size=2)
    _light(stage, 'AREA', 'Fill', 90, (1, 1, 1), loc=(3, -2.5, 1.2), rot=Euler((math.radians(75), 0, math.radians(50))), size=3)
    tiles = []
    for label, rz in (('FRONT', 0), ('THREE-QUARTER', 35), ('SIDE', 90), ('BACK', 180)):
        arm.rotation_euler = (0, 0, math.radians(rz))
        apply_pose(FA.CLIPS['Idle'][0](0.0))
        bpy.context.view_layer.update()
        _look(cam, (0, -6.2, 1.0), (0, 0, 0.98), 62)
        p = os.path.join(outdir, '_t.png')
        shot(p)
        im = Image.open(p).convert('RGB')
        ImageDraw.Draw(im).text((14, 12), label, fill=(233, 214, 170))
        tiles.append(im)
    sheet = Image.new('RGB', (420 * 4, 720), (20, 16, 22))
    for i, im in enumerate(tiles):
        sheet.paste(im, (i * 420, 0))
    sheet.save(os.path.join(outdir, 'turnaround.png'))
    os.remove(os.path.join(outdir, '_t.png'))

    stage.clear()


def _actions(scene, cam, stage, arm, FA, apply_pose, outdir, shot, Image, ImageDraw):
    _engine(scene, (420, 720), 64)
    _studio_world(scene, (0.13, 0.1, 0.14))
    _ground(stage, (0.35, 0.3, 0.3), 30, dunes=False)
    _light(stage, 'AREA', 'Key', 420, (1.0, 0.9, 0.78), loc=(-2.5, -3, 3), rot=Euler((math.radians(55), 0, math.radians(-38))), size=2.5)
    _light(stage, 'AREA', 'Rim', 300, (0.6, 0.72, 1.0), loc=(2.2, 2.6, 2.6), rot=Euler((math.radians(-55), 0, math.radians(140))), size=2)
    _light(stage, 'AREA', 'Fill', 90, (1, 1, 1), loc=(3, -2.5, 1.2), rot=Euler((math.radians(75), 0, math.radians(50))), size=3)
    moves = [('WALL-RUN', 'WallRunL', 0.25, (0, 0, 0.2)), ('SLASH', 'Slash2', 0.45, (0, 0, 0)), ('DEFLECT', 'Guard', 0.0, (0, 0, 0)),
             ('POGO', 'DownStrike', 0.5, (0, 0, 1.0)), ('DEATHBLOW', 'Deathblow', 0.3, (0, 0, 0)), ('FOCUS', 'Focus', 0.2, (0, 0, 0))]
    tiles = []
    for label, clip, t, off in moves:
        arm.rotation_euler = (0, math.radians(-24) if clip == 'WallRunL' else 0, math.radians(40))
        arm.location = off
        apply_pose(FA.CLIPS[clip][0](t))
        bpy.context.view_layer.update()
        lens = 48 if clip == 'Deathblow' else 58
        _look(cam, (0, -6.2, 1.2 + off[2] * 0.6), (0.35 if clip == 'Deathblow' else 0, 0, 1.0 + off[2] * 0.8), lens)
        p = os.path.join(outdir, '_m.png')
        shot(p)
        im = Image.open(p).convert('RGB')
        ImageDraw.Draw(im).text((14, 12), label, fill=(233, 214, 170))
        tiles.append(im)
    sheet = Image.new('RGB', (420 * 3, 720 * 2), (20, 16, 22))
    for i, im in enumerate(tiles):
        sheet.paste(im, ((i % 3) * 420, (i // 3) * 720))
    sheet.save(os.path.join(outdir, 'actions.png'))
    os.remove(os.path.join(outdir, '_m.png'))
    arm.location = (0, 0, 0)
    stage.clear()


def _gun(scene, cam, stage, arm, FA, apply_pose, outdir, shot):
    _engine(scene, (1000, 620), 80)
    _studio_world(scene, (0.13, 0.1, 0.14))
    _light(stage, 'AREA', 'GKey', 160, (1.0, 0.9, 0.78), loc=(-1.6, -1.8, 2.4), rot=Euler((math.radians(50), 0, math.radians(-40))), size=1.5)
    _light(stage, 'AREA', 'GRim', 140, (0.6, 0.72, 1.0), loc=(1.4, 1.2, 1.8), rot=Euler((math.radians(-50), 0, math.radians(140))), size=1.2)
    _light(stage, 'AREA', 'GFill', 50, (1, 1, 1), loc=(1.5, -2, 0.8), rot=Euler((math.radians(75), 0, math.radians(40))), size=2)
    arm.rotation_euler = (0, 0, 0)
    pose = FA.CLIPS['AimIdle'][0](0.0)
    pose['gunBlade'] = (0, 0, 0)
    apply_pose(pose)
    bpy.context.view_layer.update()
    g = arm.matrix_world @ arm.pose.bones['gun'].head
    _look(cam, tuple(g + Vector((-1.3, -0.62, 0.45))), tuple(g + Vector((0.0, -0.52, 0.02))), 38)
    shot(os.path.join(outdir, 'gun.png'))
    from PIL import Image
    Image.open(os.path.join(outdir, 'gun.png')).crop((0, 0, 890, 510)).save(os.path.join(outdir, 'gun.png'))
