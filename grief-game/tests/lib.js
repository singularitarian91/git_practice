/* Test helpers: a static server for the game folder, a Playwright browser, and input helpers
 * that go through the real mouse, keyboard and touch paths (including the turned phone view).
 * Network access is blocked, so the game runs with its fallback fonts and nothing external.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  throw new Error('Playwright is not installed. Run `npm install` and `npx playwright install chromium` in grief-game/.');
}

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(__dirname, 'output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

class Game {
  constructor(page, errors, base) {
    this.page = page;
    this.errors = errors;
    this.base = base;
  }

  // ---- state
  eval(fn, arg) { return this.page.evaluate(fn, arg); }
  scene() { return this.eval(() => G.scene.constructor.name + (G.scene.i != null ? ' ' + G.scene.i : '') + (G.scene.sub ? ':' + G.scene.sub : '')); }
  line() { return this.eval(() => (G.ui.line ? G.ui.line.text : null)); }
  async waitFor(fn, arg, ms, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      if (await this.page.evaluate(fn, arg)) return;
      await this.page.waitForTimeout(100);
    }
    throw new Error('Timed out waiting for ' + (what || fn.toString()));
  }
  // side-view scene settled: no animation, not walking, nothing pending
  idle(ms) {
    return this.waitFor(() => {
      const s = G.scene;
      return s && !s.anim && !s.locked && !s.pending && (!s.player || (s.player.target == null && Math.abs(s.player.vel) < 1));
    }, null, ms || 15000, 'the scene to settle');
  }
  sleep(ms) { return this.page.waitForTimeout(ms); }

  // ---- coordinates
  stageToPage(x, y) {
    return this.eval(([x, y]) => {
      const v = G.view, r = G.canvas.getBoundingClientRect();
      const vx = v.ox + x * v.s, vy = v.oy + y * v.s;
      if (!v.rot) return { x: r.left + vx, y: r.top + vy };
      return { x: r.left + (v.cw - vy), y: r.top + vx };
    }, [x, y]);
  }
  worldToStage(wx, wy) { return this.eval(([wx, wy]) => G.scene.cam.toScreen(wx, wy), [wx, wy]); }

  // ---- mouse
  async click(x, y) {
    const p = await this.stageToPage(x, y);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down();
    await this.sleep(60);
    await this.page.mouse.up();
  }
  async clickWorld(wx, wy) { const s = await this.worldToStage(wx, wy); await this.click(s.x, s.y); }
  // press and hold on a world point until `until` is true (or the time runs out)
  async holdWorld(wx, wy, until, ms) {
    const s = await this.worldToStage(wx, wy);
    const p = await this.stageToPage(s.x, s.y);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down();
    try { await this.waitFor(until, null, ms || 15000, 'a hold to finish'); } finally { await this.page.mouse.up(); }
  }

  // ---- keyboard
  async walkRightUntil(until, ms) {
    await this.page.keyboard.down('KeyD');
    try { await this.waitFor(until, null, ms || 60000, 'the walk to finish'); } finally { await this.page.keyboard.up('KeyD'); }
  }

  // ---- touch
  async tap(x, y) { const p = await this.stageToPage(x, y); await this.page.touchscreen.tap(p.x, p.y); }
  async tapWorld(wx, wy) { const s = await this.worldToStage(wx, wy); await this.tap(s.x, s.y); }
  async touchHold(x, y, until, ms) {
    const cdp = this._cdp || (this._cdp = await this.page.context().newCDPSession(this.page));
    const p = await this.stageToPage(x, y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < (ms || 15000)) {
        if (until && await this.page.evaluate(until)) break;
        await this.sleep(100);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 0.1, y: p.y }] });
      }
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  }

  // ---- output
  async shot(name) {
    fs.mkdirSync(OUTPUT, { recursive: true });
    await this.page.screenshot({ path: path.join(OUTPUT, name + '.png') });
  }
  assertNoErrors() {
    if (this.errors.length) throw new Error('Console errors:\n' + this.errors.join('\n'));
  }
}

let server = null;
let browser = null;
const opened = [];

async function setup() {
  server = await serve();
  const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  browser = await playwright.chromium.launch(launch);
}
async function teardown() {
  if (browser) await browser.close();
  if (server) server.close();
}

// Open the game. opts: { hash, save (object to preload), phone (true = upright touch phone), viewport, dpr }
async function open(opts) {
  opts = opts || {};
  const phone = opts.phone;
  const context = await browser.newContext({
    viewport: opts.viewport || (phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }),
    deviceScaleFactor: opts.dpr || (phone ? 3 : 1),
    isMobile: !!phone,
    hasTouch: !!phone
  });
  opened.push(context);
  const page = await context.newPage();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  // nothing leaves the machine: fonts fall back, no proxies involved
  await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|ERR_FAILED|fonts\.g/.test(text)) return; // blocked external fonts
    errors.push(text);
  });
  const save = opts.save;
  await page.addInitScript(s => {
    try {
      localStorage.clear();
      if (s) localStorage.setItem('a-world-the-size-of-grief/v1', JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }, save || null);
  await page.goto(base + 'index.html' + (opts.hash || ''));
  await page.waitForFunction(() => window.G && G.scene && G.scene.constructor.name !== 'Object', null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const game = new Game(page, errors, base);
  game.close = () => context.close();
  return game;
}

// Close every page a test opened (the runner calls this after each test).
async function closeAll() {
  while (opened.length) {
    try { await opened.pop().close(); } catch (e) { /* already closed */ }
  }
}

function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }

module.exports = { setup, teardown, open, closeAll, assert, OUTPUT };
