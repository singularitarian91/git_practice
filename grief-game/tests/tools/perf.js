#!/usr/bin/env node
/* Frame-time profile for each chapter on an emulated phone (844x390 landscape, 3x screen,
 * CPU slowed 4x; set THROTTLE=1 for no slowdown). Headless Chrome draws without a GPU, so
 * treat the numbers as a worst case and compare them before and after a change.
 *   npm run perf
 */
'use strict';
const lib = require('../lib');
const THROTTLE = +(process.env.THROTTLE || 4);

function stats(ts) {
  const d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  const q = p => d[Math.min(d.length - 1, Math.floor(p * d.length))] || 0;
  return { median: q(0.5), p95: q(0.95), worst: d[d.length - 1] || 0 };
}

(async () => {
  await lib.setup();
  console.log('Phone profile: 844x390 at 3x, CPU slowed ' + THROTTLE + 'x\n');
  console.log('chapter      | setup at start | worst frame at start | median frame | 95th pct | fps');
  for (let ch = 0; ch < 5; ch++) {
    const g = await lib.open({ phone: true, viewport: { width: 844, height: 390 } });
    const cdp = await g.page.context().newCDPSession(g.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await g.eval(() => {
      const set = G.setScene;
      window.__setup = [];
      G.setScene = function (s) { const t0 = performance.now(); set(s); window.__setup.push(performance.now() - t0); };
      window.__frames = [];
      const loop = t => { window.__frames.push(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await g.eval(i => G.flow.plate(i), ch);
    await g.sleep(2500);
    await g.eval(() => { window.__frames = []; window.__setup = []; });
    await g.click(640, 360);
    await g.sleep(1500);
    const start = stats(await g.eval(() => window.__frames.slice()));
    const setup = Math.max(0, ...(await g.eval(() => window.__setup)));
    await g.sleep(1000);
    await g.eval(() => { window.__frames = []; });
    await g.page.keyboard.down('KeyD');
    await g.sleep(5000);
    await g.page.keyboard.up('KeyD');
    const run = stats(await g.eval(() => window.__frames.slice()));
    const name = await g.eval(i => G.flow.CH[i].name, ch);
    console.log(
      name.padEnd(12) + ' | ' + (setup.toFixed(0) + ' ms').padStart(14) + ' | ' + (start.worst.toFixed(0) + ' ms').padStart(20) +
      ' | ' + (run.median.toFixed(0) + ' ms').padStart(12) + ' | ' + (run.p95.toFixed(0) + ' ms').padStart(8) + ' | ' + (1000 / run.median).toFixed(0).padStart(3)
    );
    await lib.closeAll();
  }
  await lib.teardown();
})().catch(async e => { console.error(e); await lib.teardown(); process.exit(1); });
