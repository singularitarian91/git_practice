#!/usr/bin/env python3
"""
Juxtapose -- hero kit: sculpted replacements for procedural props.

Takes image-to-3D models (Higgsfield / Tripo / Meshy GLBs, usually 100k+
triangles with a 2k-4k texture atlas) and makes them fit the game's contracts,
then writes them all to juxtapose/assets/hero.glb. The game swaps each hero
mesh onto the procedural template of the same name, so the procedural kit keeps
supplying everything a sculpt cannot: named moving parts (Clock_HandHour,
Candle_Flame, ...), collider sizes and fracture templates.

    python3 juxtapose/blender/build_hero.py                 # everything in the manifest
    python3 juxtapose/blender/build_hero.py --only Clock,Bed
    python3 juxtapose/blender/build_hero.py --preview       # also render a contact sheet

Manifest: juxtapose/art_src/hero/manifest.json

    { "Clock": { "src": "clock.glb", "tris": 2500, "tex": 1024,
                 "yaw": 0, "fit": "height", "normal": true, "rough": 0.6 } }

  src     file in art_src/hero/src/ (the raw download)
  tris    triangle budget after decimation (verify fails above it)
  tex     texture edge in pixels (albedo, normal and ORM are all baked to it)
  yaw     degrees about Z to turn the model so its front faces Blender -Y
  fit     "height": match the procedural piece's height; "box": fit inside its
          whole bounding box (keeps footprints, so colliders still agree)
  normal  bake a tangent-space normal map from the full-detail source onto the
          decimated mesh, so the silhouette gets cheaper but the relief does not
  rough / metal   constants used when the source has no ORM texture
  hide    procedural child parts the sculpt already includes (e.g. Bed_Pillow);
          the game hides them (glTF extras "hide")

Per asset
  1. read the procedural piece from props.glb (root mesh only, children are
     the parts the game animates) for size and pivot
  2. import the source, join every mesh, apply transforms, turn by yaw
  3. scale and move it onto the procedural piece: same bottom centre, same
     height (or inside the same box)
  4. clean: merge by distance, drop loose bits under 0.5% of the volume
  5. decimate a copy to the budget (collapse keeps the source UV atlas)
  6. bake albedo (and normal, and ORM when present) from source to copy at
     `tex` px with Cycles, into the copy's own UVs
  7. one material HERO_<name>, JPEG textures embedded, exported as a top-level
     object named <name> at the origin (glTF +Z front, like the kit)
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time
from mathutils import Vector as V, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'art_src', 'hero')
PROPS = os.path.join(ROOT, 'assets', 'props.glb')
OUT = os.path.join(ROOT, 'assets', 'hero.glb')


def args():
    a = sys.argv[1:]
    opt = {'only': None, 'preview': '--preview' in a, 'out': OUT, 'manifest': os.path.join(SRC, 'manifest.json')}
    for k in ('only', 'out', 'manifest'):
        if '--' + k in a:
            opt[k] = a[a.index('--' + k) + 1]
    if opt['only']:
        opt['only'] = set(opt['only'].split(','))
    return opt


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes(objs):
    return [o for o in objs if o.type == 'MESH']


def world_bbox(obs):
    mn, mx = V((1e9,) * 3), V((-1e9,) * 3)
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ V(c)
            mn = V(map(min, mn, w)); mx = V(map(max, mx, w))
    return mn, mx


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def reference_boxes():
    """bounding box of every procedural root mesh in props.glb (Blender Z-up)"""
    reset()
    new = import_glb(PROPS)
    boxes = {}
    for o in new:
        if o.parent is None and o.type == 'MESH':
            boxes[o.name] = world_bbox([o])
    return boxes


def join_all(objs):
    ms = meshes(objs)
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    # unparent keeping transforms, then bake every transform into the mesh
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    if len(ms) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in objs:
        if o.name in bpy.data.objects and o != ob and o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return ob


def clean(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    # floating crumbs: islands far smaller than the whole
    islands, seen = [], set()
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop(); isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index); stack.append(h)
        islands.append(isl)
    if len(islands) > 1:
        area = [sum(f.calc_area() for f in isl) for isl in islands]
        total = sum(area)
        drop = [f for isl, a in zip(islands, area) if a < total * 0.005 for f in isl]
        bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(ob.data); bm.free()


def fit(ob, ref, how, yaw):
    ob.data.transform(Matrix.Rotation(math.radians(yaw), 4, 'Z'))
    ob.data.update()
    mn, mx = world_bbox([ob])
    size, rsize = mx - mn, ref[1] - ref[0]
    if how == 'box':
        s = min(rsize.x / max(size.x, 1e-6), rsize.y / max(size.y, 1e-6), rsize.z / max(size.z, 1e-6))
    else:
        s = rsize.z / max(size.z, 1e-6)
    base = V(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    rbase = V(((ref[0].x + ref[1].x) / 2, (ref[0].y + ref[1].y) / 2, ref[0].z))
    ob.data.transform(Matrix.Translation(rbase) @ Matrix.Scale(s, 4) @ Matrix.Translation(-base))
    ob.data.update()


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimated_copy(ob, budget):
    lo = ob.copy(); lo.data = ob.data.copy(); lo.name = ob.name + '_lo'
    bpy.context.collection.objects.link(lo)
    t = tris(ob)
    if t > budget:
        m = lo.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = budget / t * 0.97
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = lo
        bpy.ops.object.modifier_apply(modifier='dec')
    return lo


def source_maps(ob):
    """which texture channels the source material actually has"""
    have = {'albedo': False, 'normal': False, 'orm': False}
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        have['albedo'] |= bsdf.inputs['Base Color'].is_linked
        have['normal'] |= bsdf.inputs['Normal'].is_linked
        have['orm'] |= bsdf.inputs['Roughness'].is_linked or bsdf.inputs['Metallic'].is_linked
    return have


def bake(hi, lo, kind, size, name):
    """Cycles selected-to-active bake from the source onto the decimated copy"""
    img = bpy.data.images.new(f'{name}_{kind}', size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB' if kind == 'albedo' else 'Non-Color'
    # the bake target: an image node, active, in every material of the low mesh
    for slot in lo.material_slots:
        m = slot.material
        tn = m.node_tree.nodes.new('ShaderNodeTexImage')
        tn.image = img; tn.name = '_bake'
        m.node_tree.nodes.active = tn
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    bk = sc.render.bake
    bk.use_selected_to_active = True
    bk.use_cage = False
    diag = (V(hi.dimensions)).length
    bk.cage_extrusion = diag * 0.02
    bk.max_ray_distance = diag * 0.06
    bk.margin = 8
    bpy.ops.object.select_all(action='DESELECT')
    hi.select_set(True); lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    if kind == 'albedo':
        bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
        bpy.ops.object.bake(type='DIFFUSE')
    elif kind == 'normal':
        bk.normal_space = 'TANGENT'
        bpy.ops.object.bake(type='NORMAL')
    elif kind == 'rough':
        bpy.ops.object.bake(type='ROUGHNESS')
    for slot in lo.material_slots:
        nt = slot.material.node_tree
        nt.nodes.remove(nt.nodes['_bake'])
    return img


def orm_image(rough, size, name, metal=0.0):
    """glTF ORM: R occlusion (kept white; the game adds its own AO), G roughness, B metal"""
    import numpy as np
    img = bpy.data.images.new(f'{name}_orm', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((size, size, 4), np.float32)
    if rough is not None:
        r = np.empty(size * size * 4, np.float32); rough.pixels.foreach_get(r)
        px[..., 1] = r.reshape(size, size, 4)[..., 0]
    px[..., 2] = metal
    img.pixels.foreach_set(px.ravel())
    return img


def final_material(lo, name, maps, spec):
    m = bpy.data.materials.new('HERO_' + name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = spec.get('rough', 0.6)
    bsdf.inputs['Metallic'].default_value = spec.get('metal', 0.0)
    if 'albedo' in maps:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['albedo']
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if 'normal' in maps:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['normal']
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if 'orm' in maps:
        # the glTF exporter recognises Separate Color G -> roughness, B -> metallic
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['orm']
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    lo.data.materials.clear()
    lo.data.materials.append(m)
    for p in lo.data.polygons:
        p.material_index = 0
        p.use_smooth = True
    return m


def build(name, spec, ref):
    t0 = time.time()
    path = os.path.join(SRC, 'src', spec['src'])
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    hi = join_all(import_glb(path))
    raw = tris(hi)
    fit(hi, ref, spec.get('fit', 'height'), spec.get('yaw', 0))
    clean(hi)
    lo = decimated_copy(hi, spec.get('tris', 3000))
    size = spec.get('tex', 1024)
    have = source_maps(hi)
    maps = {}
    maps['albedo'] = bake(hi, lo, 'albedo', size, name)
    if spec.get('normal', True):
        maps['normal'] = bake(hi, lo, 'normal', size, name)
    if have['orm']:
        maps['orm'] = orm_image(bake(hi, lo, 'rough', size, name), size, name, spec.get('metal', 0.0))
    for img in maps.values():
        img.file_format = 'JPEG'
    final_material(lo, name, maps, spec)
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = name; lo.data.name = name
    lo.location = (0, 0, 0)
    if spec.get('hide'):
        lo['hide'] = ','.join(spec['hide'])
    print(f'  {name}: {raw} -> {tris(lo)} tris, {size}px {"+".join(maps)}  ({time.time() - t0:.1f}s)')
    return lo


def verify(out, manifest):
    reset()
    new = import_glb(out)
    ok = True
    for o in new:
        if o.parent is None and o.type == 'MESH':
            t = tris(o)
            cap = manifest[o.name].get('tris', 3000)
            flag = 'OK' if t <= cap * 1.02 else 'OVER'
            ok &= flag == 'OK'
            print(f'  verify {o.name}: {t}/{cap} tris {flag}')
    return ok


def main():
    opt = args()
    manifest = json.load(open(opt['manifest']))
    names = [n for n in manifest if not n.startswith('_') and (not opt['only'] or n in opt['only'])]
    boxes = reference_boxes()
    reset()
    done = []
    for n in names:
        if n not in boxes:
            print(f'  {n}: no procedural piece of that name in props.glb, skipped'); continue
        if not os.path.exists(os.path.join(SRC, 'src', manifest[n]['src'])):
            print(f'  {n}: source {manifest[n]["src"]} missing, skipped'); continue
        done.append(build(n, manifest[n], boxes[n]))
    if not done:
        print('nothing built'); return
    bpy.ops.object.select_all(action='DESELECT')
    for o in done:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=opt['out'], export_format='GLB', use_selection=True, export_image_format='JPEG',
                              export_jpeg_quality=86, export_yup=True, export_extras=True)
    print(f'wrote {opt["out"]} ({os.path.getsize(opt["out"]) / 1e6:.2f} MB)')
    if not verify(opt['out'], manifest):
        sys.exit(1)


if __name__ == '__main__':
    main()
