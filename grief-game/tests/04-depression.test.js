'use strict';
// Depression: walking gets nowhere; standing still lets small living things appear.
module.exports = [{
  name: 'stop four times, notice what appears, reach the Acceptance plate',
  timeout: 150000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch4' });
    for (let n = 0; n < 4; n++) {
      const x0 = await g.eval(() => G.scene.player.x);
      await g.walkRightUntil('G.scene.player.x > ' + (x0 + 420), 20000);
      // stand still: something should show itself nearby
      await g.waitFor('G.scene.lives.length > ' + n, null, 15000, 'a small life to appear');
      const life = await g.eval(k => ({ x: G.scene.lives[k].item.gx, y: G.scene.lives[k].item.gy, kind: G.scene.lives[k].kind }), n);
      if (n === 3) assert(life.kind === 'flower', 'the fourth is always the flower');
      await g.sleep(700);
      await g.clickWorld(life.x, life.y);
      if (n < 3) await g.waitFor('G.scene.noticed === ' + (n + 1), null, 15000, 'noticing it');
    }
    await g.waitFor(() => !!G.scene.ending, null, 15000, 'the light to break');
    await g.shot('depression-flower');
    await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 4, null, 15000, 'the Acceptance plate');
    g.assertNoErrors();
  }
}];
