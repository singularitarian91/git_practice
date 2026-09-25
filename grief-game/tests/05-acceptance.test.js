'use strict';
// Acceptance: mend, plant beside the gardeners, give the chair its place, walk the river path.
// The gardeners share the work: one holds the cloth, one hands over the seedlings, both walk to the fence.
module.exports = [{
  name: 'mend, plant, place the chair, walk to the end card',
  timeout: 180000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch5' });
    // in the throw of their chair, a seed packet
    await g.clickWorld(540, 400);
    await g.waitFor(() => !!G.ui.card, null, 10000, 'the seed packet');
    await g.sleep(1400);
    await g.click(640, 360);
    await g.waitFor(() => !G.ui.card, null, 5000, 'the packet to be put back');
    await g.idle();

    let held = false;
    for (const [i, x, y] of [[0, 470, 186], [1, 650, 172], [2, 820, 190]]) {
      await g.holdWorld(x, y, 'G.scene.tears[' + i + '].done || (G.scene.npcs[1].state === "hold" && G.scene.npcs[1].tear === G.scene.tears[' + i + '])', 20000);
      held = held || await g.eval(k => G.scene.npcs[1].state === 'hold' && G.scene.npcs[1].tear === G.scene.tears[k], i);
      await g.holdWorld(x, y, 'G.scene.tears[' + i + '].done', 20000);
    }
    assert(held, 'the gardener holds the other end of the cloth');
    for (const [i, x] of [[0, 1030], [1, 1120], [2, 1210]]) {
      await g.clickWorld(x, 480);
      await g.waitFor(() => G.scene.npcs[0].state === 'offer', null, 15000, 'the elder to bring a seedling');
      await g.waitFor('G.scene.seeds[' + i + '].planted && !G.scene.kneeling', null, 15000, 'planting seedling ' + (i + 1));
    }
    await g.waitFor(() => G.scene.phase === 'chair', null, 8000, 'the chair to be free to move');

    await g.clickWorld(540, 400);
    await g.waitFor(() => G.scene.chair.carried, null, 15000, 'picking up the chair');
    assert(await g.eval(() => G.scene.npcs.every(n => n.state === 'follow')), 'both gardeners come along');
    await g.clickWorld(2060, 470);
    await g.waitFor(() => G.scene.chair.placed, null, 20000, 'setting the chair down');
    assert(await g.eval(() => G.scene.chair.x === 2060), 'the chair stands by the fence');
    assert(await g.eval(() => G.scene.npcs.every(n => Math.abs(n.x - 2060) < 520)), 'the gardeners walked down to the fence too');
    await g.waitFor(() => G.scene.phase === 'open', null, 15000, 'the river path to open');
    await g.shot('acceptance-chair');

    await g.walkRightUntil(() => G.scene.constructor.name === 'EndScene', 90000);
    g.assertNoErrors();
  }
}];
