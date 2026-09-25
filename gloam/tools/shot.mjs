// Screenshot the game in headless Chromium.
//   node tools/shot.mjs out.png "hour=18&cam=..." [--size 1280x720] [--wait 2000] [--eval "js"]
import { startServer } from './serve.mjs';
import { launchBrowser } from './browser.mjs';

const args = process.argv.slice(2);
const out = args[0] || '/tmp/shot.png';
const query = args[1] || '';
const opt = {};
for (let i = 2; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
const [w, h] = (opt.size || '1280x720').split('x').map(Number);

const { server, port } = await startServer(0);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?${query}`);
try {
  await page.waitForFunction(() => window.__gh && window.__gh.ready, null, { timeout: Number(opt.timeout || 180000) });
} catch (e) {
  console.log('not ready:', e.message);
}
if (opt.eval) {
  try { console.log('eval ->', JSON.stringify(await page.evaluate(opt.eval))); } catch (e) { console.log('eval error', e.message); }
}
await page.waitForTimeout(Number(opt.wait || 1500));
await page.screenshot({ path: out });
console.log(`wrote ${out} in ${Date.now() - t0}ms`);
const important = logs.filter((l) => !l.includes('GPU stall') && !l.includes('WebGL-'));
if (important.length) console.log(important.slice(0, 40).join('\n'));
await browser.close();
server.close();
