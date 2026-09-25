'use strict';
// Denial: the room repeats until each change is noticed; the last door is a seam you pull open.
// The first door waits until you've looked around; from the second room on you can hold to remember.
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

    await g.clickWorld(1160, 430);
    await g.sleep(400);
    await g.idle();
    assert((await state()).copy === 0 && (await g.line()) === 'Not yet.', 'the first door stays shut until the room has been looked at');
    await look(770, 330);
    await g.clickWorld(1045, 330);
    await g.waitFor(() => !!G.ui.card, null, 8000, 'their coat to be taken down and looked at');
    assert((await g.line()) === 'Their coat, on its hook.', 'their coat is on its hook');
    await g.sleep(1400);
    await g.click(640, 360);
    await g.waitFor(() => !G.ui.card, null, 5000, 'the coat to be put back');
    await g.idle();
    await throughDoor();
    assert((await state()).copy === 1, 'the door leads back into the room (copy 1)');

    assert(await g.eval(() => !!G.ui.action && G.ui.action.key === 'remember'), 'a Remember control appears in the second room');
    await g.page.keyboard.down('KeyR');
    await g.sleep(1000);
    assert(await g.eval(() => G.scene.remember > 0.6), 'holding R brings back the room as it was');
    await g.shot('denial-remember');
    await g.page.keyboard.up('KeyR');
    await g.sleep(1000);
    assert(await g.eval(() => G.scene.remember < 0.2), 'letting go lets it fade again');

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
