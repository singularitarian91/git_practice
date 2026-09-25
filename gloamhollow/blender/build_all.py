"""Build every Gloamhollow model and export the .glb files.

    python blender/build_all.py            (with `pip install bpy`)
    blender -b -P blender/build_all.py     (with a Blender install)

Each build_<category>.py exposes build(out_dir) and can also be run alone.
"""
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'models'))

CATEGORIES = ['characters', 'enemies', 'nature', 'crops', 'items', 'buildings', 'props']

if __name__ == '__main__':
    only = [a for a in sys.argv[1:] if a in CATEGORIES]
    os.makedirs(OUT, exist_ok=True)
    for cat in (only or CATEGORIES):
        t0 = time.time()
        mod = importlib.import_module('build_' + cat)
        mod.build(OUT)
        print(f'[build_all] {cat}.glb done in {time.time() - t0:.1f}s')
