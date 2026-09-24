#!/usr/bin/env python3
"""
Juxtapose -- Cycles preview sheets of the street and dressing props
(assets/street.glb), with the texture library applied the way the game applies
it (render_town.rebuild_material): TX_<name> -> tiled albedo x COLOR_0, ORM,
normal; other materials keep their colour x COLOR_0.  Colliders and SLOT_
empties are hidden; SLOT_light empties get a warm point lamp.

Each prop is framed on its own on the sand under warm late-afternoon sun,
next to a 1.75 m grey figure for scale, plus one tile with all fourteen
together; the tiles are laid out with PIL into one labelled contact sheet.

    python3 juxtapose/blender/render_street.py                    # contact sheet
    python3 juxtapose/blender/render_street.py --detail           # + close-up sheet
    python3 juxtapose/blender/render_street.py --only T_Well,T_Lamp --samples 16 --out /tmp/prev
    python3 juxtapose/blender/render_street.py --glb /tmp/s.glb --tiles /tmp/tiles
    python3 juxtapose/blender/render_street.py --reuse --tiles /tmp/tiles    # re-lay existing tiles

--samples (28) and --res (960x540) are per tile; tiles go to --tiles (default
<tmp>/street_tiles) and only the composed sheets to docs/previews.

Writes juxtapose/docs/previews/street_props.png (and street_props_detail.png).
Keep it modest: ~28 samples, 960 x 540 per tile (the machine is shared).
"""
import bpy
import math
import os
import sys
import json
import time
import tempfile
from mathutils import Vector as V, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def _import(name, tries=6, wait=60):
    """render_town.py may be mid-edit by the buildings artist: retry a few times."""
    import importlib
    for k in range(tries):
        try:
            return importlib.import_module(name)
        except Exception as e:          # noqa: BLE001
            sys.modules.pop(name, None)
            if k == tries - 1:
                raise
            print('%s.py failed to import (%s); retrying in %ds' % (name, str(e).split('\n')[0], wait))
            time.sleep(wait)


rt = _import('render_town')       # helpers only: material rebuild, sky, sand

GLB = os.path.join(PROJ, 'assets', 'street.glb')
TEX = os.path.join(PROJ, 'assets', 'tex')
OUT_DIR = os.path.join(PROJ, 'docs', 'previews')
ORDER = ['T_Well', 'T_Lamp', 'T_Bench', 'T_Crate', 'T_Barrel', 'T_Amphora', 'T_Cart', 'T_GardenWall', 'T_Cypress',
         'T_Olive', 'T_Egg', 'T_Gate', 'T_Boat', 'T_Stair']


# ----------------------------------------------------------------------------
# scene
# ----------------------------------------------------------------------------
def setup(samples, res):
    sc = rt.setup_scene(samples, res)          # Nishita sky, sun, rippled sand
    sky = next(n for n in sc.world.node_tree.nodes if n.type == 'TEX_SKY')
    sky.sun_elevation = math.radians(17)
    sky.sun_rotation = math.radians(200)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
    sun = bpy.data.objects['Sun']
    sun.data.energy = 4.2
    sun.data.color = (1.0, 0.8, 0.6)             # late afternoon
    sun.data.angle = math.radians(1.2)
    sun.rotation_euler = Euler((math.radians(90 - 17), 0, math.radians(-28)), 'XYZ')
    sc.view_settings.exposure = 0.15
    return sc


def figure():
    """A 1.75 m grey stand-in for the player, for scale."""
    import bmesh
    m = bpy.data.materials.new('PV_Figure')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.32, 0.34, 0.38, 1)
    b.inputs['Roughness'].default_value = 0.7
    bm = bmesh.new()
    for (c, r, sz) in (((0, 0, 1.1), 0.2, (1.0, 0.75, 1.9)), ((0, 0, 1.63), 0.12, (1, 1, 1.05)),
                       ((0.09, 0, 0.45), 0.075, (1, 1, 5.8)), ((-0.09, 0, 0.45), 0.075, (1, 1, 5.8))):
        t = bmesh.new()
        bmesh.ops.create_uvsphere(t, u_segments=16, v_segments=10, radius=r)
        bmesh.ops.scale(t, vec=V(sz), verts=t.verts)
        bmesh.ops.translate(t, vec=V(c), verts=t.verts)
        me = bpy.data.meshes.new('_f')
        t.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        t.free()
    me = bpy.data.meshes.new('PV_Figure')
    bm.to_mesh(me)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(m)
    o = bpy.data.objects.new('PV_Figure', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def hierarchy(o):
    return [o] + list(o.children_recursive)


def visible_meshes(o):
    return [h for h in hierarchy(o) if h.type == 'MESH' and '_COL' not in h.name]


def bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi, pts


def hide_all():
    for o in list(bpy.data.objects):
        if o.name.startswith('PVL_'):
            bpy.data.objects.remove(o)
    for o in bpy.data.objects:
        if o.name in ('Sun', 'Cam', 'PV_Ground'):
            continue
        o.hide_render = True


def show(name, loc=(0, 0, 0), rz=0.0, lamp=60.0):
    o = bpy.data.objects[name]
    o.location = V(loc)
    o.rotation_euler = (0, 0, math.radians(rz))
    bpy.context.view_layer.update()
    for h in hierarchy(o):
        h.hide_render = '_COL' in h.name or h.type == 'EMPTY'
        if h.type == 'EMPTY' and h.name.startswith('SLOT_light'):
            L = bpy.data.lights.new('PVL_' + h.name, 'POINT')
            L.energy = lamp
            L.color = (1.0, 0.72, 0.42)
            L.shadow_soft_size = 0.12
            lo = bpy.data.objects.new('PVL_' + h.name, L)
            lo.location = h.matrix_world.translation
            bpy.context.scene.collection.objects.link(lo)
    return o


def frame(sc, pts, azim=-38.0, elev=13.0, lens=50.0, margin=1.1, target=None, aspect=16 / 9):
    """Camera looking at the points from (azim, elev) degrees (azim 0 = from -Y,
    positive toward +X), pulled back until every point is in frame."""
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.clip_start = 0.05
    cam.data.clip_end = 3000
    sc.camera = cam
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    tgt = V(target) if target is not None else (lo + hi) / 2
    a, e = math.radians(azim), math.radians(elev)
    fwd = -V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))     # camera -> target
    right = fwd.cross(V((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    tx = 18.0 / lens                         # tan(half horizontal fov), 36 mm sensor
    ty = tx / aspect
    dist = 0.0
    for p in pts:
        d = p - tgt
        x, y, z = d.dot(right), d.dot(up), d.dot(fwd)
        dist = max(dist, abs(x) / (tx / margin) - z, abs(y) / (ty / margin) - z)
    cam.location = tgt - fwd * dist
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    return cam


def sample_pts(pts, n=4000):
    step = max(1, len(pts) // n)
    return pts[::step]


# ----------------------------------------------------------------------------
# shots
# ----------------------------------------------------------------------------
VIEW = {   # per prop: camera azimuth / elevation / lens, where the figure stands
    'T_Well': dict(azim=34, elev=14, fig=(1.7, 0.4)),
    'T_Lamp': dict(azim=48, elev=10, fig=(1.1, 0.5)),
    'T_Bench': dict(azim=32, elev=16, fig=(1.6, 0.4)),
    'T_Crate': dict(azim=36, elev=24, fig=(1.1, 0.3)),
    'T_Barrel': dict(azim=36, elev=18, fig=(0.95, 0.3)),
    'T_Amphora': dict(azim=40, elev=16, fig=(0.9, 0.3)),
    'T_Cart': dict(azim=58, elev=16, fig=(1.7, 0.6)),
    'T_GardenWall': dict(azim=28, elev=12, fig=(2.8, -0.4)),
    'T_Cypress': dict(azim=34, elev=8, fig=(1.9, 0.3)),
    'T_Olive': dict(azim=34, elev=10, fig=(2.9, -0.8)),
    'T_Egg': dict(azim=36, elev=12, fig=(1.3, 0.3)),
    'T_Gate': dict(azim=30, elev=10, fig=(0.9, -1.4)),
    'T_Boat': dict(azim=-58, elev=22, fig=(1.6, 1.8)),
    'T_Stair': dict(azim=-52, elev=24, fig=(-1.2, -1.6)),
}

# the lineup: every prop together, like a corner of the village
LINEUP = [('T_Gate', (0.0, 7.5), 0), ('T_GardenWall', (5.3, 6.4), 0), ('T_Stair', (-5.4, 7.2), 0),
          ('T_Cypress', (-8.6, 10.0), 0), ('T_Olive', (9.2, 10.0), 0), ('T_Well', (0.0, 1.2), 0),
          ('T_Lamp', (-2.8, 3.2), 20), ('T_Bench', (2.9, 3.0), -10), ('T_Cart', (4.9, -0.4), -35),
          ('T_Crate', (-4.7, 0.9), 10), ('T_Barrel', (-5.5, 1.7), 0), ('T_Amphora', (-4.1, 2.0), 0),
          ('T_Egg', (-7.2, -0.3), 20), ('T_Boat', (-1.5, -4.2), 78)]

DETAIL = [   # close-ups: (name, camera azim, elev, lens, focus point, radius of interest)
    ('T_Well', 20, 20, 50, (0.0, 0.0, 1.95), 0.75),
    ('T_Lamp', 60, 6, 60, (0.0, -0.45, 2.85), 0.5),
    ('T_Cart', 80, 18, 50, (0.0, 0.0, 0.5), 1.0),
    ('T_Gate', 24, 8, 50, (0.0, 0.0, 4.3), 1.6),
    ('T_Boat', -42, 30, 50, (0.0, -0.9, 0.8), 1.35),
    ('T_Olive', 30, 6, 45, (0.0, 0.0, 1.2), 1.4),
]


REUSE = False                  # --reuse: keep tiles already rendered in the tiles folder


def render_to(sc, path, res):
    if REUSE and os.path.exists(path):
        print('reusing %s' % path)
        return
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print('rendered %s in %.1fs' % (path, time.time() - t))
    sys.stdout.flush()


def shoot_prop(sc, name, fig, path, res):
    hide_all()
    o = show(name)
    lo, hi, pts = bounds(visible_meshes(o))
    v = VIEW.get(name, dict(azim=-35, elev=14, fig=(1.5, 0.3)))
    fx, fy = v['fig']
    fig.location = V((hi.x + fx if fx > 0 else lo.x + fx, fy, 0.0))
    fig.hide_render = False
    fpts = [fig.matrix_world @ V(c) for c in fig.bound_box]
    frame(sc, sample_pts(pts) + fpts, azim=v['azim'], elev=v['elev'], lens=v.get('lens', 50.0))
    render_to(sc, path, res)


def shoot_lineup(sc, fig, path, res):
    hide_all()
    pts = []
    for name, (x, y), rz in LINEUP:
        if name not in bpy.data.objects:
            continue
        o = show(name, (x, y, 0.0), rz)
        pts += sample_pts(bounds(visible_meshes(o))[2], 600)
    fig.location = V((1.4, -0.8, 0.0))
    fig.hide_render = False
    frame(sc, pts, azim=6, elev=19, lens=35, margin=1.0)
    render_to(sc, path, res)
    for name, _, _ in LINEUP:
        if name in bpy.data.objects:
            o = bpy.data.objects[name]
            o.location = (0, 0, 0)
            o.rotation_euler = (0, 0, 0)


def shoot_detail(sc, spec, path, res):
    name, azim, elev, lens, focus, rad = spec
    hide_all()
    show(name, lamp=40)
    f = V(focus)
    pts = [f + V((sx * rad, sy * rad, sz * rad)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    frame(sc, pts, azim=azim, elev=elev, lens=lens, margin=1.0, target=f)
    render_to(sc, path, res)


# ----------------------------------------------------------------------------
# contact sheet
# ----------------------------------------------------------------------------
def stats(name):
    o = bpy.data.objects[name]
    vis = visible_meshes(o)
    tris = sum(len(p.vertices) - 2 for m in vis for p in m.data.polygons)
    cols = len([h for h in hierarchy(o) if h.type == 'MESH' and '_COL' in h.name])
    lo, hi, _ = bounds(vis)
    return tris, cols, hi - lo


def sheet(tiles, out, cols=4, tile_w=640, title=None):
    from PIL import Image, ImageDraw, ImageFont
    fnt = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', s)
    try:
        f1, f2, f3 = fnt(19), fnt(15), fnt(26)
    except OSError:
        f1 = f2 = f3 = ImageFont.load_default()
    ims = [(Image.open(p).convert('RGB'), a, b) for (p, a, b) in tiles]
    w0, h0 = ims[0][0].size
    tile_h = round(tile_w * h0 / w0)
    lab = 30
    head = 48 if title else 0
    rows = math.ceil(len(ims) / cols)
    W, H = cols * tile_w, head + rows * (tile_h + lab)
    S = Image.new('RGB', (W, H), (24, 22, 20))
    d = ImageDraw.Draw(S)
    if title:
        d.text((14, 10), title, font=f3, fill=(236, 226, 206))
    for i, (im, a, b) in enumerate(ims):
        x, y = (i % cols) * tile_w, head + (i // cols) * (tile_h + lab)
        S.paste(im.resize((tile_w, tile_h), Image.LANCZOS), (x, y))
        d.text((x + 10, y + tile_h + 5), a, font=f1, fill=(240, 232, 214))
        d.text((x + tile_w - 10 - d.textlength(b, font=f2), y + tile_h + 8), b, font=f2, fill=(170, 160, 142))
    S.save(out, optimize=True)
    print('wrote %s (%d x %d, %.1f MB)' % (out, W, H, os.path.getsize(out) / 1e6))


def main():
    global REUSE
    argv = sys.argv[1:]
    arg = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
    REUSE = '--reuse' in argv
    glb = os.path.abspath(arg('--glb', GLB))
    out_dir = os.path.abspath(arg('--out', OUT_DIR))
    samples = int(arg('--samples', 28))
    res = tuple(int(v) for v in arg('--res', '960x540').split('x'))
    only = set(arg('--only').split(',')) if '--only' in argv else None
    tiles_dir = os.path.abspath(arg('--tiles', os.path.join(tempfile.gettempdir(), 'street_tiles')))
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(tiles_dir, exist_ok=True)
    manifest = json.load(open(os.path.join(TEX, 'manifest.json')))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in bpy.data.objects:
        o.rotation_mode = 'XYZ'
    for m in bpy.data.materials:
        if m.use_nodes:
            rt.rebuild_material(m, manifest)
    sc = setup(samples, res)
    fig = figure()
    names = [n for n in ORDER if n in bpy.data.objects and (not only or n in only)]
    tiles = []
    for name in names:
        p = os.path.join(tiles_dir, '%s.png' % name)
        shoot_prop(sc, name, fig, p, res)
        tris, cols, size = stats(name)
        tiles.append((p, name, '%d tris  %d col  %.1f x %.1f x %.1f m' % (tris, cols, size.x, size.y, size.z)))
    if not only or 'lineup' in only:
        p = os.path.join(tiles_dir, 'lineup.png')
        shoot_lineup(sc, fig, p, res)
        tiles.append((p, 'all fourteen', 'grey figure 1.75 m'))
    if tiles and '--no-sheet' not in argv:
        name = 'street_props.png' if not only else 'street_props_partial.png'
        sheet(tiles, os.path.join(out_dir, name), title='Juxtapose - street & dressing props (assets/street.glb)')
    if '--detail' in argv:
        dt = []
        for spec in DETAIL:
            if spec[0] not in bpy.data.objects or (only and spec[0] not in only):
                continue
            p = os.path.join(tiles_dir, 'detail_%s.png' % spec[0])
            shoot_detail(sc, spec, p, res)
            dt.append((p, spec[0], 'close-up'))
        if dt:
            sheet(dt, os.path.join(out_dir, 'street_props_detail.png'), cols=3, tile_w=800,
                  title='Juxtapose - street props, close-ups')


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
