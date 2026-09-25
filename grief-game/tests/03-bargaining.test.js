'use strict';
// Bargaining: the thread starts as a loop; turning rooms leads it out to the boardwalk.
// Turning a lit room away puts its lamp out; the first time, that is all that is said.
const SOLUTION = [[1, 1, 2], [1, 2, 2], [2, 2, 1], [3, 2, 2], [3, 1, 1], [3, 0, 2], [4, 0, 1]]; // [col, row, turns]

module.exports = [{
  name: 'break the loop, lead the thread out, reach the Depression plate',
  timeout: 90000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch3' });
    assert(!(await g.eval(() => G.scene.reachExit)), 'the thread starts closed');
    assert((await g.eval(() => G.scene.reached.size)) === 5, 'the loop runs through five rooms');

    const lit = await g.eval(() => G.scene.tiles.filter(t => t.lamp > 0).length);
    assert(lit === 4, 'four rooms on the loop are lit');
    let first = true;
    for (const [c, r, n] of SOLUTION) {
      for (let i = 0; i < n; i++) {
        await g.click(265 + c * 150 + 75, 150 + r * 150 + 75);
        await g.waitFor(() => G.scene.tiles.every(t => t.turning === 0 && t.queue === 0), null, 5000, 'the room to finish turning');
        if (first) {
          first = false;
          assert(await g.eval(() => G.scene.lampsOut === 1), 'turning a lit room away puts its lamp out');
          assert((await g.line()) === 'The lamp goes out.', 'the first lamp going out is said plainly');
        }
      }
    }
    assert(await g.eval(() => G.scene.solved), 'the thread reaches the far door');
    await g.shot('bargaining-solved');

    await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 3, null, 30000, 'the Depression plate');
    g.assertNoErrors();
  }
}];
