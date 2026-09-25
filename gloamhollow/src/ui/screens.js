// Title screen and full-screen narration (intro / ending).
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function showTitle(ui, { hasSave, saveInfo, onNew, onContinue }) {
  const el = h('div', 'title-screen');
  el.innerHTML = `
    <div class="title-inner">
      <div class="logo">GLOAMHOLLOW</div>
      <div class="tagline">Tend the soil. Keep the fires lit. Pay the Raven.</div>
      <div class="title-menu">
        ${hasSave ? `<button class="btn big interactive" data-a="continue">Continue<small>${saveInfo || ''}</small></button>` : ''}
        <button class="btn big ${hasSave ? 'ghost' : ''} interactive" data-a="new">New Game</button>
        <button class="btn big ghost interactive" data-a="help">How to Play</button>
      </div>
      <div class="newgame">
        <label>What name shall the isle know you by?</label>
        <input type="text" maxlength="16" placeholder="Wanderer" class="interactive" spellcheck="false">
        <div class="ng-btns">
          <button class="btn big interactive" data-a="begin">Begin</button>
          <button class="btn ghost interactive" data-a="back">Back</button>
        </div>
        ${hasSave ? '<p class="warnline">Starting anew will overwrite your saved croft.</p>' : ''}
      </div>
      <div class="title-help"></div>
    </div>
    <div class="title-foot">A dark, cozy life-sim · models made in Blender · rendered with three.js · sound synthesised live</div>`;
  ui.root.appendChild(el);
  ui.overlayBusy = true;
  const menu = el.querySelector('.title-menu');
  const ng = el.querySelector('.newgame');
  const helpBox = el.querySelector('.title-help');
  const input = ng.querySelector('input');
  const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 1200); ui.overlayBusy = false; };
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => ui.audio.sfx('ui_hover', { volume: 0.25 })));
  el.querySelector('[data-a=new]').onclick = () => { ui.audio.init(); ui.audio.sfx('ui_click'); menu.style.display = 'none'; ng.classList.add('show'); input.focus(); };
  el.querySelector('[data-a=back]').onclick = () => { ui.audio.sfx('ui_click'); ng.classList.remove('show'); menu.style.display = ''; };
  const begin = () => {
    ui.audio.sfx('ui_click');
    const name = (input.value || 'Wanderer').trim().replace(/[<>&"]/g, '').slice(0, 16) || 'Wanderer';
    done();
    onNew(name);
  };
  el.querySelector('[data-a=begin]').onclick = begin;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') begin(); e.stopPropagation(); });
  const cont = el.querySelector('[data-a=continue]');
  if (cont) cont.onclick = () => { ui.audio.init(); ui.audio.sfx('ui_click'); done(); onContinue(); };
  el.querySelector('[data-a=help]').onclick = () => {
    ui.audio.init();
    ui.audio.sfx('ui_click');
    helpBox.classList.toggle('show');
    helpBox.innerHTML = `
      <p><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> dodge · <b>Left-click</b> use tool · <b>E</b> talk/pick/open · <b>1–0</b> hotbar · <b>Tab</b> pack · <b>C</b> craft · <b>J</b> journal · <b>M</b> map · <b>Right-drag</b> camera · <b>Wheel</b> zoom</p>
      <p>Farm by day, fish the black lake, befriend the animal folk, pay back the Raven — and keep near the fires when the Gloam rises at night.</p>`;
  };
  return el;
}

export function narrate(ui, pages, title) {
  return new Promise((resolve) => {
    const el = h('div', 'narration');
    el.innerHTML = `${title ? `<div class="nar-title">${title}</div>` : ''}<div class="nar-text"></div><div class="nar-hint">click to continue</div><button class="nar-skip interactive">Skip ›</button>`;
    ui.root.appendChild(el);
    ui.overlayBusy = true;
    const txt = el.querySelector('.nar-text');
    let i = 0;
    const show = () => {
      txt.classList.remove('in');
      void txt.offsetWidth;
      txt.textContent = pages[i];
      txt.classList.add('in');
    };
    const end = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 900);
      ui.overlayBusy = false;
      window.removeEventListener('keydown', onKey);
      resolve();
    };
    const next = () => {
      i++;
      ui.audio.sfx('ui_click', { volume: 0.3 });
      if (i >= pages.length) end(); else show();
    };
    const onKey = (e) => { if (['Space', 'Enter', 'KeyE'].includes(e.code)) { e.preventDefault(); next(); } if (e.code === 'Escape') end(); };
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); if (!e.target.classList.contains('nar-skip')) next(); });
    el.querySelector('.nar-skip').onclick = (e) => { e.stopPropagation(); end(); };
    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { el.classList.add('show'); show(); });
  });
}
