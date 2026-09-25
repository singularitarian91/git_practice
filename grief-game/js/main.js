/* main.js: boot. Loads save data, fonts and plates, then opens the title. */
(function () {
  'use strict';
  const G = window.G, M = G.M;

  G.save.load();
  G.audio.muted = G.save.data.sound === false;

  const files = ['01-denial', '02-anger', '03-bargaining', '04-depression', '05-acceptance'];
  G.plates = files.map(f => {
    const im = new Image();
    im.src = 'assets/plates/' + f + '.jpg';
    return im;
  });

  // A plain loading page while fonts arrive.
  const loading = {
    t: 0,
    finish: { vignette: 1, grain: 0.8 },
    pausable: false,
    update(dt) { this.t += dt; },
    draw(x) {
      x.fillStyle = G.C.char;
      x.fillRect(0, 0, G.W, G.H);
      x.globalAlpha = 0.4 + 0.3 * Math.sin(this.t * 3);
      x.fillStyle = G.C.tan;
      x.beginPath();
      x.arc(G.W / 2, G.H / 2, 3, 0, M.TAU);
      x.fill();
      x.globalAlpha = 1;
    }
  };

  G.paint.init();
  G.setScene(loading);
  G.startLoop();

  const wait = ms => new Promise(r => setTimeout(r, ms));
  let fonts = Promise.resolve();
  if (document.fonts && document.fonts.load) {
    fonts = Promise.race([
      Promise.all([
        document.fonts.load('84px "IM Fell English"'),
        document.fonts.load('italic 30px "IM Fell English"'),
        document.fonts.load('700 13px "Alegreya Sans"'),
        document.fonts.load('500 15px "Alegreya Sans"')
      ]).catch(() => null),
      wait(3000)
    ]);
  }

  // Straight into a chapter (a #ch link, or the page reloading mid-chapter) once its
  // painted scenery has arrived.
  function begin(i, o) {
    G.art.loadAll(G.art.shared.concat(G.flow.artFor(i, o))).then(() => G.flow.start(i, o));
  }

  function start(data) {
    data = data || {};
    const m = (location.hash || '').match(/^#ch([1-5])(r?)$/);
    if (m) { begin(+m[1] - 1, { revisit: m[2] === 'r' }); return; }
    if (data.ch != null && data.ch >= 0 && G.chapters[G.flow.CH[data.ch].ctor]) {
      begin(data.ch, { revisit: !!data.revisit });
      return;
    }
    // the title waits a little for its painting, then shows the drawn room if it's slow
    Promise.race([G.art.loadAll(G.art.shared.concat(G.TitleScene.art)), wait(6000)])
      .then(() => G.setScene(new G.TitleScene()));
  }

  fonts.then(() => {
    // Keep the player's place when the published page is updated while open.
    const hot = window.claude && window.claude.hot;
    try {
      if (hot && typeof hot.snapshot === 'function') {
        hot.snapshot(() => ({ ch: G.flow.current, revisit: G.flow.revisit }));
      }
    } catch (e) { /* not available */ }
    if (hot && typeof hot.ready === 'function') hot.ready(start);
    else start((hot && hot.data) || {});
  });
})();
