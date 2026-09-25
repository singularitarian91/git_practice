'use strict';
// Acceptance: mend, plant beside the gardeners, give the chair its place, walk the river path.
module.exports = [{
  name: 'mend, plant, place the chair, walk to the end card',
  timeout: 180000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch5' });
    for (const [i, x, y] of [[0, 470, 186], [1, 650, 172], [2, 820, 190]]) {
      await g.holdWorld(x, y, 'G.scene.tears[' + i + '].done', 20000);
    }
    for (const [i, x] of [[0, 1030], [1, 1120], [2, 1210]]) {
      await g.clickWorld(x, 480);
      await g.waitFor('G.scene.seeds[' + i + '].planted && !G.scene.kneeling', null, 15000, 'planting seedling ' + (i + 1));
    }
    await g.waitFor(() => G.scene.phase === 'chair', null, 5000, 'the chair to be free to move');

    await g.clickWorld(540, 400);
    await g.waitFor(() => G.scene.chair.carried, null, 15000, 'picking up the chair');
    await g.clickWorld(2060, 470);
    await g.waitFor(() => G.scene.chair.placed, null, 20000, 'setting the chair down');
    assert(await g.eval(() => G.scene.chair.x === 2060), 'the chair stands by the fence');
    await g.waitFor(() => G.scene.phase === 'open', null, 15000, 'the river path to open');
    await g.shot('acceptance-chair');

    await g.walkRightUntil(() => G.scene.constructor.name === 'EndScene', 90000);
    g.assertNoErrors();
  }
}];
