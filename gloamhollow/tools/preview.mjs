// Render .glb models to a PNG contact sheet using the game's materials.
//
//   node tools/preview.mjs <out.png> <file.glb>[,<file2.glb>] [--names a,b] [--cols 5]
//                          [--yaw 30] [--pitch 22] [--size 1400x900]
//
// Paths to .glb files are relative to the gloamhollow/ folder.
import { startServer } from './serve.mjs';
import { launchBrowser } from './browser.mjs';

const args = process.argv.slice(2);
const out = args[0];
const files = args[1];
const opt = {};
for (let i = 2; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
if (!out || !files) {
  console.error('usage: node tools/preview.mjs out.png assets/models/x.glb [--names a,b] [--cols n] [--yaw deg] [--pitch deg] [--size WxH]');
  process.exit(1);
}
const [w, h] = (opt.size || '1400x900').split('x').map(Number);

const { server, port } = await startServer(0);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const qs = new URLSearchParams({ file: files });
for (const k of ['names', 'cols', 'yaw', 'pitch']) if (opt[k]) qs.set(k, opt[k]);
await page.goto(`http://127.0.0.1:${port}/tools/preview.html?${qs}`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
} catch (e) {
  console.error('preview did not become ready:', errors.join('\n'));
}
await page.screenshot({ path: out });
if (errors.length) console.log('console messages:\n' + errors.join('\n'));
console.log('wrote', out);
await browser.close();
server.close();
