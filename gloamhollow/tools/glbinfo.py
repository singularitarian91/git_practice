"""List the top-level assets inside a .glb: children, sockets, extras, triangles.

    python3 tools/glbinfo.py assets/models/props.glb
"""
import json
import struct
import sys


def load(path):
    data = open(path, 'rb').read()
    json_len = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + json_len])


def tri_count(j, mesh_idx):
    n = 0
    for p in j['meshes'][mesh_idx]['primitives']:
        acc = j['accessors'][p['indices']] if 'indices' in p else j['accessors'][p['attributes']['POSITION']]
        n += acc['count'] // 3
    return n


def walk(j, idx, depth, out):
    node = j['nodes'][idx]
    tris = tri_count(j, node['mesh']) if 'mesh' in node else 0
    out.append((depth, node.get('name', '?'), tris, node.get('extras')))
    for c in node.get('children', []):
        walk(j, c, depth + 1, out)


def main(path):
    j = load(path)
    roots = j['scenes'][j.get('scene', 0)]['nodes']
    print(f'{path}: {len(roots)} assets')
    for r in roots:
        rows = []
        walk(j, r, 0, rows)
        total = sum(t for _, _, t, _ in rows)
        name = rows[0][1]
        extras = rows[0][3]
        parts = [f"{'  ' * d}{n}{'(' + str(t) + ')' if t else ''}" for d, n, t, _ in rows[1:]]
        print(f'- {name}: {total} tris' + (f'  extras={extras}' if extras else ''))
        if parts:
            print('    ' + ', '.join(p.strip() for p in parts))


if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
