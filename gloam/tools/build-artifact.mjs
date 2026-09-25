// Build the single-page entry used when publishing Gloam as a Claude
// Artifact: the page body only (the host adds <html>/<head>/<body>), with
// styles.css inlined.  Scripts, vendor files and models are published
// alongside it under the same relative paths as in this folder.
//   node tools/build-artifact.mjs <out.html> [--files <files.json>]
//
// The artifact host only serves common web types, so with --files the .glb
// models are written next to <out.html> as base64 text (models-b64/) and the
// page sets a flag that makes the model loader read those instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'artifact.html'));
const filesOut = process.argv[3] === '--files' ? process.argv[4] : null;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const pick = (re) => { const m = html.match(re); if (!m) throw new Error('index.html is missing ' + re); return m[1].trim(); };

const title = pick(/<title>([\s\S]*?)<\/title>/);
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const importmap = pick(/(<script type="importmap">[\s\S]*?<\/script>)/);
const body = pick(/<body>([\s\S]*?)<script type="module"/);

const page = `<title>${title}</title>
<style>
${css}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
${importmap}
${body}
${filesOut ? '<script>globalThis.__GH_MODELS_B64 = true;</script>\n' : ''}<script type="module" src="src/main.js"></script>
`;
fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(1) + ' KB');

if (filesOut) {
  // every runtime file, keyed by its published path
  const list = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, f);
      const st = fs.statSync(path.join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(js|glb|txt)$/.test(f) || f === 'LICENSE') list.push(rel.split(path.sep).join('/'));
    }
  };
  for (const d of ['src', 'vendor', 'assets/models']) walk(d);
  const b64Dir = path.join(path.dirname(out), 'models-b64');
  fs.mkdirSync(b64Dir, { recursive: true });
  const map = {};
  for (const p of list) {
    if (p.endsWith('.glb')) {
      const src = path.join(b64Dir, path.basename(p) + '.b64.txt');
      fs.writeFileSync(src, fs.readFileSync(path.join(ROOT, p)).toString('base64'));
      map[p + '.b64.txt'] = src;
    } else if (!path.extname(p)) map[p + '.txt'] = p; // e.g. LICENSE
    else map[p] = p;
  }
  fs.writeFileSync(filesOut, JSON.stringify(map, null, 1));
  console.log('files:', list.length);
}
