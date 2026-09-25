"""Build items.glb - inventory-icon / dropped-item models for Gloamhollow.

    python blender/build_items.py            (with `pip install bpy`)
    blender -b -P blender/build_items.py     (with a Blender install)
    python blender/build_items.py fish_ bug_ (dev: only matching assets, written
                                              to the temp dir, items.glb untouched)

Every asset is one mesh object named exactly as in ASSETS.md ("items.glb"),
origin at the bottom centre (tools: origin at the grip, handle along +Z,
working end up and facing -Y).  Builds are deterministic (byte-identical).
The modelling code lives in:

    items_kit.py    - extra helpers on top of ghlib (loft, Body, flat, ...)
    items_goods.py  - materials, crops, seeds, berries, meat, misc
    items_fauna.py  - fish and bugs
    items_gear.py   - relics, tools and food
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401  (must be imported before bmesh / mathutils users)

import ghlib as G  # noqa: E402
import items_fauna  # noqa: E402
import items_gear  # noqa: E402
import items_goods  # noqa: E402


def builders():
    return (items_goods.MATERIALS + items_goods.CROPS + items_goods.FORAGE
            + items_fauna.FISH + items_fauna.BUGS
            + items_gear.RELICS + items_gear.TOOLS + items_gear.FOOD
            + items_goods.MEAT + items_goods.MISC)


def build(out_dir, only=None):
    G.reset_scene()
    roots = []
    for fn in builders():
        if only and not fn.__name__.startswith(tuple(only)):
            continue
        roots.append(fn())
    if only:
        out_dir = tempfile.gettempdir()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'items.glb')
    G.export_glb(path, roots)
    st = G.stats(roots)
    for name, tris in st.items():
        print(f'  {name:28s} {tris:5d} tris')
    print(f'[items] {len(roots)} assets, {sum(st.values())} tris -> {path}')
    return roots


if __name__ == '__main__':
    PREFIXES = ('item_', 'fish_', 'bug_', 'relic_', 'tool_', 'food_')
    only = [a for a in sys.argv[1:] if a.startswith(PREFIXES)] or None
    build(os.path.normpath(os.path.join(HERE, '..', 'assets', 'models')), only)
