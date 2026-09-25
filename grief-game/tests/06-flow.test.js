'use strict';
// Title, saved progress, the pause menu, and the Return menu after finishing.
const inScene = (name, i) => 'G.scene.constructor.name === "' + name + '"' + (i == null ? '' : ' && G.scene.i === ' + i);
// one key press per frame or two, so each press is seen on its own
const key = async (g, name) => { await g.page.keyboard.press(name); await g.sleep(150); };

module.exports = [
  {
    name: 'begin from the title into Denial',
    run: async ({ open, assert }) => {
      const g = await open();
      assert((await g.scene()) === 'TitleScene', 'the game opens on the title');
      await g.shot('title');
      await g.click(120, 530);
      await g.waitFor(inScene('PlateScene', 0), null, 8000, 'the Denial plate');
      await g.sleep(1200);
      await g.click(640, 360);
      await g.waitFor(() => G.ui.label === '01 · Denial' && G.scene.player, null, 8000, 'Denial to start');
      g.assertNoErrors();
    }
  },
  {
    name: 'a chapter plate plays its painted loop, and the ending is painted',
    run: async ({ open, assert }) => {
      const g = await open();
      await g.eval(() => G.flow.plate(1));
      await g.waitFor(() => G.scene.vidA >= 1, null, 12000, 'the Anger plate to start moving');
      assert(await g.eval(() => /02-anger\.(mp4|webm)$/.test(G.scene.video.currentSrc)), 'it plays the Anger loop');
      await g.shot('plate-anger');
      await g.click(640, 360);
      await g.waitFor(() => G.ui.label === '02 · Anger' && G.scene.player, null, 12000, 'Anger to start');
      assert(await g.eval(() => !document.querySelector('video')), 'the plate lets go of its video');
      await g.eval(() => G.flow.complete(4));
      await g.waitFor(() => G.scene.constructor.name === 'EndScene', null, 8000, 'the end card');
      g.assertNoErrors();
    }
  },
  {
    name: 'continue from saved progress',
    run: async ({ open, assert }) => {
      const g = await open({ save: { reached: 3, done: false, sound: true } });
      const items = await g.eval(() => G.scene.items.map(i => i.label));
      assert(items[0] === 'Continue · 04 Depression', 'the title offers to continue at chapter 4, got ' + items[0]);
      await g.click(120, 530);
      await g.waitFor(inScene('PlateScene', 3), null, 8000, 'the Depression plate');
      await g.sleep(1200);
      await g.click(640, 360);
      await g.waitFor(() => G.ui.label === '04 · Depression', null, 8000, 'Depression to start');
      g.assertNoErrors();
    }
  },
  {
    name: 'pause menu restarts the chapter and returns to the title',
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch2' });
      await key(g, 'Escape');
      assert(await g.eval(() => G.paused && G.ui.menu.length === 4), 'Esc opens the pause menu');
      await g.shot('pause-menu');
      await key(g, 'ArrowDown');
      await key(g, 'ArrowDown');
      await key(g, 'Enter');
      await g.waitFor(() => !G.paused && !G.fx.active && G.ui.label === '02 · Anger' && G.scene.player && G.scene.player.x === 260, null, 8000, 'Anger to restart');
      await key(g, 'Escape');
      await key(g, 'ArrowUp');
      await key(g, 'Enter');
      await g.waitFor(inScene('TitleScene'), null, 8000, 'the title');
      g.assertNoErrors();
    }
  },
  {
    name: 'pausing holds the words and the timers',
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch1' });
      await g.waitFor(() => G.ui.line && G.ui.line.t > 0.2, null, 5000, 'the opening line');
      await g.eval(() => { window.__fired = false; G.after(0.4, () => { window.__fired = true; }); });
      await key(g, 'Escape');
      const before = await g.eval(() => G.ui.line.t);
      await g.sleep(1500);
      const during = await g.eval(() => ({ t: G.ui.line && G.ui.line.t, fired: window.__fired }));
      assert(during.t === before, 'the line waits while paused');
      assert(!during.fired, 'game-time delays wait while paused');
      await key(g, 'Escape');
      await g.waitFor(() => window.__fired === true, null, 3000, 'the delay to run after unpausing');
      g.assertNoErrors();
    }
  },
  {
    name: 'after finishing, return to any chapter',
    run: async ({ open, assert }) => {
      const g = await open({ save: { reached: 5, done: true, sound: false } });
      const items = await g.eval(() => G.scene.items.map(i => i.label));
      assert(items[0] === 'Return to a chapter', 'the title offers Return, got ' + items[0]);
      assert(await g.eval(() => G.audio.muted), 'the saved sound setting is kept');
      await g.click(120, 530);
      await g.waitFor(() => G.scene.sub === 'return', null, 3000, 'the chapter list');
      await g.shot('return-menu');
      await g.click(117 + 218 + 98, 300);
      await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 1 && G.scene.o.revisit, null, 8000, 'the Anger plate in Return mode');
      g.assertNoErrors();
    }
  }
];
