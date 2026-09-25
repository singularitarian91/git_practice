'use strict';
// Denial: the room repeats until each change is noticed; the last door is a seam you pull open.
module.exports = [{
  name: 'notice each change, pull the seam, reach the Anger plate',
  timeout: 150000,
  run: async ({ open, assert }) => {
    const g = await open({ hash: '#ch1' });
    const state = () => g.eval(() => ({ copy: G.scene.copy, noticed: G.scene.noticed, loops: G.scene.loops }));
    const look = async (wx, wy) => { await g.clickWorld(wx, wy); await g.sleep(400); await g.idle(); };
    const throughDoor = async () => { await g.clickWorld(1160, 430); await g.sleep(400); await g.idle(20000); };

    await look(905, 436);
    assert((await g.line()) === 'Two cups. One still has tea in it.', 'the first room shows two cups');

    await throughDoor();
    assert((await state()).copy === 1, 'the door leads back into the room (copy 1)');

    await throughDoor();
    let s = await state();
    assert(s.copy === 1 && s.loops === 1, 'leaving without noticing brings back the same copy');

    await look(905, 436);
    assert((await state()).noticed === 1, 'the single cup is noticed');
    await throughDoor();
    await look(1045, 300);
    assert((await state()).noticed === 2, 'the bare hook is noticed');
    await throughDoor();
    await look(742, 520);
    assert((await state()).noticed === 3, 'the turned chair is noticed');
    await throughDoor();
    assert((await state()).copy === 4, 'the last copy has cloth walls');
    await g.shot('denial-seam');

    await g.holdWorld(1165, 400, 'G.scene.pull >= 1', 20000);
    await g.waitFor(() => G.scene.constructor.name === 'PlateScene' && G.scene.i === 1, null, 12000, 'the Anger plate');
    g.assertNoErrors();
  }
}];
