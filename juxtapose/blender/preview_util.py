"""Cycles contact-sheet renderer used by the Blender build scripts (--preview)."""
import bpy, math, os
from mathutils import Vector


def _setup(scene, res=(320, 420)):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('PreviewWorld')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.6
    scene.world = world
    sun = bpy.data.objects.new('PreviewSun', bpy.data.lights.new('PreviewSun', 'SUN'))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=30)
    ground = bpy.context.active_object
    ground.name = 'PreviewGround'
    gm = bpy.data.materials.new('PreviewGround')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.42, 0.28, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    ground.data.materials.append(gm)
    cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, [sun, ground, cam]


def _look(cam, pos, target, lens=50):
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


def render_pose_sheet(arm, FA, apply_pose, outdir, fps, cols=6, tag='figure', poses=None, focus=None):
    from PIL import Image, ImageDraw
    scene = bpy.context.scene
    cam, tmp = _setup(scene)
    os.makedirs(outdir, exist_ok=True)
    tiles = []
    views = [((-2.3, -3.4, 1.55), (0, 0, 0.9))]
    for clip, t in (poses or FA.PREVIEW):
        fn = FA.CLIPS[clip][0]
        apply_pose(fn(t))
        bpy.context.view_layer.update()
        if focus:
            c = arm.matrix_world @ arm.pose.bones[focus].head
            views = [(tuple(c + Vector((-0.5, -0.45, 0.25))), tuple(c + Vector((0, -0.15, 0.05))))]
        for vi, (pos, tgt) in enumerate(views):
            _look(cam, pos, tgt, 45)
            path = os.path.join(outdir, '_tile.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            im = Image.open(path).convert('RGB')
            ImageDraw.Draw(im).text((8, 6), '%s %.2f' % (clip, t), fill=(255, 255, 255))
            tiles.append(im)
    w, h = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (w * cols, h * rows), (30, 30, 30))
    for i, im in enumerate(tiles):
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    out = os.path.join(outdir, '%s_poses.png' % tag)
    sheet.save(out)
    os.remove(os.path.join(outdir, '_tile.png'))
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)
    print('wrote', out)
