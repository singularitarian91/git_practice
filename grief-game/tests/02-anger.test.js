'use strict';
// Anger: walk into the gusts, the gate won't give, untie three knots between gusts.
module.exports = [{
  name: 'cross the grove, untie the knots, reach the Bargaining plate',
  timeout: 180000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch2' });

    await g.clickWorld(440, 860);
    await g.sleep(400);
    await g.idle();
    assert(await g.eval(() => G.scene.chairUp), 'the knocked-over chair can be set upright');

    await g.walkRightUntil(() => G.scene.player.x >= 3925, 90000);
    await g.shot('anger-gate');

    await g.clickWorld(3880, 700);
    await g.sleep(400);
    await g.idle();
    assert((await g.line()) === 'It won’t give.', 'shoving the gate does nothing');

    for (const [i, y] of [[0, 860], [1, 760], [2, 660]]) {
      await g.holdWorld(3996, y, 'G.scene.knots[' + i + '].done', 40000);
    }
    await g.waitFor(() => G.scene.gateOpen && !G.scene.locked, null, 10000, 'the wind to open the gate');

    await g.clickWorld(3950, 740);
    await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 2, null, 12000, 'the Bargaining plate');
    g.assertNoErrors();
  }
}];
