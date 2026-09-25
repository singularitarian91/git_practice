'use strict';
// Return versions: the loss stays, the pressure eases, and finishing goes back to the chapter list.
const backToList = () => G.scene.constructor.name === 'TitleScene' && G.scene.sub === 'return';

module.exports = [
  {
    name: 'Denial (return): the door simply opens',
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch1r' });
      assert((await g.eval(() => G.scene.state().cups)) === 1, 'still one cup');
      await g.clickWorld(1160, 430);
      await g.waitFor(backToList, null, 20000, 'the chapter list');
      g.assertNoErrors();
    }
  },
  {
    name: 'Anger (return): no gusts, the gate stands open',
    timeout: 150000,
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch2r' });
      assert(await g.eval(() => G.scene.gateOpen), 'the gate is already open');
      await g.walkRightUntil(() => G.scene.player.x > 3920, 90000);
      assert((await g.eval(() => G.scene.gust)) < 0.05, 'no gusts on return');
      await g.clickWorld(3950, 740);
      await g.waitFor(backToList, null, 15000, 'the chapter list');
      g.assertNoErrors();
    }
  },
  {
    name: 'Bargaining (return): the rooms are already connected',
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch3r' });
      assert(await g.eval(() => G.scene.reachExit), 'the thread already reaches the door');
      await g.waitFor(backToList, null, 40000, 'the chapter list');
      g.assertNoErrors();
    }
  },
  {
    name: 'Depression (return): lighter, and the flower is waiting',
    timeout: 150000,
    run: async ({ open }) => {
      const g = await open({ hash: '#ch4r' });
      await g.walkRightUntil(() => G.scene.player.x > 2400, 60000);
      const f = await g.eval(() => { const l = G.scene.lives.find(l => l.kind === 'flower'); return { x: l.item.gx, y: l.item.gy }; });
      await g.clickWorld(f.x, f.y);
      await g.waitFor(backToList, null, 25000, 'the chapter list');
      g.assertNoErrors();
    }
  },
  {
    name: 'Acceptance (return): the garden has come up',
    timeout: 150000,
    run: async ({ open, assert }) => {
      const g = await open({ hash: '#ch5r' });
      assert(await g.eval(() => G.scene.chair.placed && G.scene.seeds.every(s => s.planted)), 'the chair and garden are in place');
      await g.walkRightUntil(backToList, 90000);
      g.assertNoErrors();
    }
  }
];
