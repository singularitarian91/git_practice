'use strict';
// Upright phone (390x844, touch only): the stage turns sideways; taps and holds still land.
module.exports = [
  {
    name: 'upright phone: turned stage, taps reach the right things',
    run: async ({ open, assert }) => {
      const g = await open({ phone: true });
      const view = await g.eval(() => ({ rotated: G.rotated, touch: G.touch, s: G.view.s }));
      assert(view.touch && view.rotated, 'an upright touch phone turns the stage');
      assert(view.s > 0.5, 'the turned stage is large enough to read (scale ' + view.s.toFixed(2) + ')');
      await g.shot('phone-title');
      await g.tap(120, 530);
      await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 0, null, 8000, 'the Denial plate');
      await g.sleep(1200);
      await g.tap(640, 360);
      await g.waitFor(() => G.scene.player, null, 8000, 'Denial to start');
      await g.tapWorld(905, 436);
      await g.sleep(400);
      await g.idle();
      assert((await g.line()) === 'Two cups. One still has tea in it.', 'tapping the cups walks there and looks');
      await g.shot('phone-denial');
      g.assertNoErrors();
    }
  },
  {
    name: 'upright phone: hold to walk, hold to untie',
    timeout: 180000,
    run: async ({ open, assert }) => {
      const g = await open({ phone: true, hash: '#ch2' });
      await g.touchHold(1180, 520, 'G.scene.player.x > 3700', 90000);
      assert((await g.eval(() => G.scene.player.x)) > 3700, 'holding a finger down walks toward it');
      for (const [i, y] of [[0, 860], [1, 760], [2, 660]]) {
        const s = await g.worldToStage(3996, y);
        await g.touchHold(s.x, s.y, 'G.scene.knots[' + i + '].done', 40000);
      }
      await g.waitFor(() => G.scene.gateOpen, null, 10000, 'the gate to open');
      g.assertNoErrors();
    }
  }
];
