"""Post-process a Blender-exported .glb for the game (pure Python + numpy).

- The kit bakes ambient occlusion into a second vertex colour layer (COLOR_1),
  but the exporter writes an all-white COLOR_0 and three.js only reads COLOR_0.
  Move the bake into COLOR_0 as normalized RGBA8, with a gentle curve so sunlit
  walls are not grimy, and drop COLOR_1.
- Normals become normalized signed bytes (KHR_mesh_quantization): 12 -> 4 bytes.
- Collision boxes (*_COL*) keep only POSITION and indices.

usage: python3 pack_glb.py in.glb [out.glb]
"""
import json
import struct
import sys

import numpy as np

COMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
DT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5122: np.int16, 5121: np.uint8, 5120: np.int8}


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]
    binary = b[off + 8:off + 8 + bl]
    return j, binary


def read_accessor(j, binary, ai):
    A = j['accessors'][ai]
    V = j['bufferViews'][A['bufferView']]
    n, c = A['count'], COMP[A['type']]
    dt = np.dtype(DT[A['componentType']])
    start = V.get('byteOffset', 0) + A.get('byteOffset', 0)
    stride = V.get('byteStride', 0) or c * dt.itemsize
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (n - 1) + c * dt.itemsize, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(n, c * dt.itemsize), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dt).reshape(n, c)


def pack(src, dst):
    j, binary = load(src)
    out = bytearray()
    views, accs = [], []

    def add(arr, comp_type, typ, target, normalized=False, stride=None, minmax=False):
        while len(out) % 4:
            out.append(0)
        view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': arr.nbytes}
        if stride:
            view['byteStride'] = stride
        if target:
            view['target'] = target
        out.extend(arr.tobytes())
        views.append(view)
        acc = {'bufferView': len(views) - 1, 'componentType': comp_type, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(v) for v in arr.reshape(arr.shape[0], -1)[:, :3].min(0)]
            acc['max'] = [float(v) for v in arr.reshape(arr.shape[0], -1)[:, :3].max(0)]
        accs.append(acc)
        return len(accs) - 1

    remap = {}   # old accessor -> new, for accessors copied verbatim

    def copy(ai, target):
        if ai in remap:
            return remap[ai]
        A = j['accessors'][ai]
        arr = read_accessor(j, binary, ai)
        k = add(arr, A['componentType'], A['type'], target, A.get('normalized', False), minmax='min' in A)
        if 'min' in A:
            accs[k]['min'], accs[k]['max'] = A['min'], A['max']
        remap[ai] = k
        return k

    stats = {'col': 0, 'ao': 0}
    for mesh in j['meshes']:
        is_col = '_COL' in mesh.get('name', '')
        for p in mesh['primitives']:
            at = p['attributes']
            new = {}
            new['POSITION'] = copy(at['POSITION'], 34962)
            if not is_col:
                if 'NORMAL' in at:
                    nrm = read_accessor(j, binary, at['NORMAL']).astype(np.float32)
                    nrm /= np.maximum(1e-8, np.linalg.norm(nrm, axis=1, keepdims=True))
                    q = np.zeros((nrm.shape[0], 4), dtype=np.int8)
                    q[:, :3] = np.clip(np.round(nrm * 127.0), -127, 127).astype(np.int8)
                    new['NORMAL'] = add(q, 5120, 'VEC3', 34962, normalized=True, stride=4)
                if 'TEXCOORD_0' in at:
                    new['TEXCOORD_0'] = copy(at['TEXCOORD_0'], 34962)
                ao_src = at.get('COLOR_1', at.get('COLOR_0'))
                if ao_src is not None:
                    A = j['accessors'][ao_src]
                    c = read_accessor(j, binary, ao_src).astype(np.float32)
                    if A['componentType'] != 5126:
                        c /= float(np.iinfo(DT[A['componentType']]).max)
                    if c.shape[1] == 3:
                        c = np.concatenate([c, np.ones((c.shape[0], 1), np.float32)], 1)
                    if 'COLOR_1' in at:
                        # soften the bake: deep corners stay dark, open walls stay clean
                        c[:, :3] = 0.22 + 0.78 * np.power(np.clip(c[:, :3], 0, 1), 0.65)
                        stats['ao'] += 1
                    new['COLOR_0'] = add(np.clip(np.round(c * 255), 0, 255).astype(np.uint8), 5121, 'VEC4', 34962, normalized=True)
            else:
                stats['col'] += 1
            p['attributes'] = new
            if 'indices' in p:
                p['indices'] = copy(p['indices'], 34963)
    j['accessors'] = accs
    j['bufferViews'] = views
    while len(out) % 4:
        out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    for key in ('extensionsUsed', 'extensionsRequired'):
        s = set(j.get(key, []))
        s.add('KHR_mesh_quantization')
        j[key] = sorted(s)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out))
    print('packed %s -> %s: %.2f MB -> %.2f MB (%d AO layers moved, %d collision meshes stripped)'
          % (src, dst, len(binary) / 1e6, total / 1e6, stats['ao'], stats['col']))


if __name__ == '__main__':
    pack(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
