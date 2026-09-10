/* ================================================================
   TUNE — a panel of sliders and draggable curves for a page's motion

   A page that wants one sets window.TUNE before this loads:
     key      a name for the saved values ('things-i-like')
     values   the object the page reads its numbers from, changed in place
     EASE     the page's named curves
     apply()  what to recompute after a change (may be a no-op)
     controls a list, in order, of
        { section: 'heading' }
        { path: 'a.b', label, kind: 'number', min, max, step, unit }
        { path: 'a.b', label, kind: 'pair',   min, max, step, unit }   two numbers, low and high
        { path: 'a.b', label, kind: 'curve' }   a cubic-bezier: four numbers or an EASE name
   and loads this when the address ends in ?tune. Every move of a
   slider or a curve handle changes the page as you watch. "keep on this
   device" saves the values in the browser, and the page merges them in
   on every load (with or without ?tune); "forget" clears that. "copy"
   puts the values on the clipboard, to paste to whoever keeps the site.

   The panel is a column on the right on a desktop and a sheet that
   slides up from the bottom on a phone, with a pill to fold it away so
   the page can be seen while the values settle.
   ================================================================ */
(() => {
  const T = window.TUNE;
  if (!T || !T.values || !T.controls) return;
  const storeKey = 'tune:' + T.key;

  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), T.values);
  const set = (path, v) => { const ks = path.split('.'); let o = T.values; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; };
  const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, '');

  const css = `
    #tune-panel { position: fixed; z-index: 100000; background: rgba(250,245,239,0.96); color: #3a2f2f;
      box-shadow: 0 0 0 1px rgba(58,47,47,0.12), 0 12px 40px rgba(58,47,47,0.18); backdrop-filter: blur(8px);
      font-size: 0.95rem; line-height: 1.4; overflow-y: auto; -webkit-overflow-scrolling: touch;
      pointer-events: auto; transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
    #tune-panel * { box-sizing: border-box; }
    #tune-panel h2 { font-size: 1.15rem; font-weight: 400; margin: 0 0 0.2rem; }
    #tune-panel .tune-sub { color: #8a7060; font-size: 0.82rem; margin: 0 0 1rem; }
    #tune-panel h3 { font-size: 0.8rem; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; color: #c47a7a; margin: 1.3rem 0 0.5rem; }
    #tune-panel .tune-row { margin: 0.55rem 0; }
    #tune-panel label { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.9rem; color: #5a4a40; }
    #tune-panel label b { font-weight: 400; color: #3a2f2f; white-space: nowrap; }
    #tune-panel input[type=range] { width: 100%; margin: 0.2rem 0 0; accent-color: #c47a7a; height: 28px; }
    #tune-panel .tune-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 0.7rem; }
    #tune-panel .tune-pair small { color: #8a7060; font-size: 0.75rem; }
    /* the home page styles every canvas position: fixed; this one is in the flow */
    #tune-panel canvas.tune-curve { position: relative; top: auto; left: auto; z-index: auto;
      width: 100%; max-width: 220px; aspect-ratio: 1; display: block; margin: 0.3rem auto 0;
      border-radius: 6px; background: #fffaf4; touch-action: none; cursor: crosshair; }
    #tune-panel .tune-presets { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.35rem 0 0; }
    #tune-panel .tune-presets span { font-size: 0.72rem; padding: 0.1rem 0.5rem; border: 1px solid #d4c4b4; border-radius: 12px; color: #8a7060; cursor: pointer; }
    #tune-panel .tune-presets span:hover { border-color: #c47a7a; color: #c47a7a; }
    #tune-panel .tune-buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1.4rem 0 0.4rem; position: sticky; bottom: 0; padding: 0.6rem 0 0.2rem; background: linear-gradient(rgba(250,245,239,0), rgba(250,245,239,0.98) 30%); }
    #tune-panel button { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border-radius: 16px; border: 1px solid #d4a080; background: #fff; color: #3a2f2f; cursor: pointer; }
    #tune-panel button.primary { background: #c47a7a; border-color: #c47a7a; color: #fff; }
    #tune-panel button:active { transform: translateY(1px); }
    #tune-panel textarea { width: 100%; height: 6rem; font-size: 0.7rem; margin-top: 0.5rem; border: 1px solid #d4c4b4; border-radius: 6px; padding: 0.4rem; background: #fff; color: #5a4a40; }
    #tune-panel .tune-note { font-size: 0.78rem; color: #8a7060; margin: 0.4rem 0 0; }
    #tune-pill { position: fixed; z-index: 100001; left: 50%; transform: translateX(-50%); bottom: 0.7rem;
      background: #c47a7a; color: #fff; border: none; border-radius: 20px; padding: 0.5rem 1.1rem; font: inherit; font-size: 0.9rem;
      box-shadow: 0 6px 18px rgba(196,122,122,0.4); cursor: pointer; pointer-events: auto; }
    @media (min-width: 900px) {
      #tune-panel { top: 0; right: 0; bottom: 0; width: 340px; padding: 1.2rem 1.2rem 1rem; }
      #tune-panel.folded { transform: translateX(100%); }
      #tune-pill { left: auto; right: 356px; transform: none; bottom: 1rem; }
      #tune-pill.folded { right: 1rem; }
    }
    @media (max-width: 899px) {
      #tune-panel { left: 0; right: 0; bottom: 0; height: 58vh; border-radius: 18px 18px 0 0; padding: 1rem 1.1rem 1rem; }
      #tune-panel.folded { transform: translateY(100%); }
      #tune-pill { bottom: calc(58vh + 0.6rem); }
      #tune-pill.folded { bottom: 0.7rem; }
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'tune-panel';
  const pill = document.createElement('button');
  pill.id = 'tune-pill';
  pill.textContent = 'hide the sliders';
  let folded = false;
  pill.addEventListener('click', () => {
    folded = !folded;
    panel.classList.toggle('folded', folded);
    pill.classList.toggle('folded', folded);
    pill.textContent = folded ? 'show the sliders' : 'hide the sliders';
  });

  const changed = () => { try { T.apply && T.apply(); } catch (e) { console.error(e); } };

  const h2 = document.createElement('h2'); h2.textContent = 'tune this page';
  const sub = document.createElement('p'); sub.className = 'tune-sub';
  sub.textContent = 'move a slider or drag a curve’s handles and the page changes as you watch.';
  panel.append(h2, sub);

  // ---- a number: one slider
  function numberRow(ctl) {
    const row = document.createElement('div'); row.className = 'tune-row';
    const lab = document.createElement('label');
    const name = document.createElement('span'); name.textContent = ctl.label;
    const val = document.createElement('b');
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = ctl.min; inp.max = ctl.max; inp.step = ctl.step || 0.01;
    inp.value = get(ctl.path);
    const show = () => { val.textContent = fmt(parseFloat(inp.value)) + (ctl.unit || ''); };
    show();
    inp.addEventListener('input', () => { set(ctl.path, parseFloat(inp.value)); show(); changed(); });
    lab.append(name, val);
    row.append(lab, inp);
    return row;
  }

  // ---- a pair: the low and the high end of a range
  function pairRow(ctl) {
    const row = document.createElement('div'); row.className = 'tune-row';
    const lab = document.createElement('label');
    const name = document.createElement('span'); name.textContent = ctl.label;
    const val = document.createElement('b');
    lab.append(name, val);
    const grid = document.createElement('div'); grid.className = 'tune-pair';
    const cur = get(ctl.path).slice();
    const inputs = ['at least', 'at most'].map((t, i) => {
      const wrap = document.createElement('div');
      const small = document.createElement('small'); small.textContent = t;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = ctl.min; inp.max = ctl.max; inp.step = ctl.step || 0.01; inp.value = cur[i];
      wrap.append(small, inp);
      grid.appendChild(wrap);
      return inp;
    });
    const show = () => { val.textContent = fmt(cur[0]) + ' – ' + fmt(cur[1]) + (ctl.unit || ''); };
    show();
    inputs.forEach((inp, i) => inp.addEventListener('input', () => {
      cur[i] = parseFloat(inp.value);
      if (cur[0] > cur[1]) { cur[1 - i] = cur[i]; inputs[1 - i].value = cur[i]; }
      set(ctl.path, cur.slice()); show(); changed();
    }));
    row.append(lab, grid);
    return row;
  }

  // ---- a curve: a cubic-bezier with two handles to drag, like
  // cubic-bezier.com. Time runs left to right; the line is how far
  // along the change is at each moment.
  function curveRow(ctl) {
    const row = document.createElement('div'); row.className = 'tune-row';
    const lab = document.createElement('label');
    const name = document.createElement('span'); name.textContent = ctl.label;
    const val = document.createElement('b');
    lab.append(name, val);
    const cv = document.createElement('canvas'); cv.className = 'tune-curve';
    const N = 220, PAD = 26, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = N * dpr; cv.height = N * dpr;
    const c = cv.getContext('2d');
    let pts = toPoints(get(ctl.path));
    function toPoints(e) { const a = Array.isArray(e) ? e : (T.EASE && T.EASE[e]) || [0.25, 0.1, 0.25, 1]; return a.slice(); }
    const toX = (u) => PAD + u * (N - 2 * PAD), toY = (v) => N - PAD - v * (N - 2 * PAD);
    const fromX = (x) => (x - PAD) / (N - 2 * PAD), fromY = (y) => (N - PAD - y) / (N - 2 * PAD);
    function draw() {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, N, N);
      // the box: bottom-left is the start, top-right the end
      c.strokeStyle = 'rgba(58,47,47,0.12)'; c.lineWidth = 1;
      c.strokeRect(PAD, PAD, N - 2 * PAD, N - 2 * PAD);
      c.setLineDash([3, 4]); c.beginPath(); c.moveTo(toX(0), toY(0)); c.lineTo(toX(1), toY(1)); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(138,112,96,0.8)'; c.font = '11px sans-serif';
      c.fillText('start', PAD, N - 6); c.textAlign = 'right'; c.fillText('end', N - PAD, N - 6); c.textAlign = 'left';
      c.save(); c.translate(8, N - PAD); c.rotate(-Math.PI / 2); c.fillText('how far along', 0, 0); c.restore();
      // handle arms
      c.strokeStyle = 'rgba(196,122,122,0.5)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(toX(0), toY(0)); c.lineTo(toX(pts[0]), toY(pts[1])); c.stroke();
      c.beginPath(); c.moveTo(toX(1), toY(1)); c.lineTo(toX(pts[2]), toY(pts[3])); c.stroke();
      // the curve
      c.strokeStyle = '#3a2f2f'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(toX(0), toY(0));
      c.bezierCurveTo(toX(pts[0]), toY(pts[1]), toX(pts[2]), toY(pts[3]), toX(1), toY(1));
      c.stroke();
      // handles
      for (const [x, y] of [[pts[0], pts[1]], [pts[2], pts[3]]]) {
        c.fillStyle = '#c47a7a'; c.beginPath(); c.arc(toX(x), toY(y), 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(toX(x), toY(y), 3, 0, Math.PI * 2); c.fill();
      }
      val.textContent = pts.map((v) => v.toFixed(2)).join(', ');
    }
    let drag = -1;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * N / r.width, y: (e.clientY - r.top) * N / r.height }; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const d0 = Math.hypot(p.x - toX(pts[0]), p.y - toY(pts[1])), d1 = Math.hypot(p.x - toX(pts[2]), p.y - toY(pts[3]));
      drag = d0 < d1 ? 0 : 1;
      cv.setPointerCapture(e.pointerId);
      move(e);
    });
    function move(e) {
      if (drag < 0) return;
      const p = pos(e);
      const u = Math.max(0, Math.min(1, fromX(p.x)));          // time must stay inside the box
      const v = Math.max(-0.5, Math.min(1.5, fromY(p.y)));     // the line may overshoot a little
      pts[drag * 2] = Math.round(u * 100) / 100; pts[drag * 2 + 1] = Math.round(v * 100) / 100;
      set(ctl.path, pts.slice()); draw(); changed();
    }
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', () => { drag = -1; });
    cv.addEventListener('pointercancel', () => { drag = -1; });
    draw();
    // the named curves, one tap each
    const presets = document.createElement('div'); presets.className = 'tune-presets';
    const names = { linear: 'steady', inOut: 'soft both ends', outQuad: 'quick then settles', outCubic: 'quick then settles more', outExpo: 'rushes then drifts in', inQuad: 'slow then quick', outQuint: 'almost all at once' };
    for (const k of Object.keys(T.EASE || {})) {
      if (!names[k]) continue;
      const sp = document.createElement('span'); sp.textContent = names[k];
      sp.addEventListener('click', () => { pts = T.EASE[k].slice(); set(ctl.path, pts.slice()); draw(); changed(); });
      presets.appendChild(sp);
    }
    row.append(lab, cv, presets);
    return { row, reset: () => { pts = toPoints(get(ctl.path)); draw(); } };
  }

  const refreshers = [];
  for (const ctl of T.controls) {
    if (ctl.section) { const h = document.createElement('h3'); h.textContent = ctl.section; panel.appendChild(h); continue; }
    if (get(ctl.path) === undefined) continue;
    if (ctl.kind === 'curve') { const r = curveRow(ctl); panel.appendChild(r.row); refreshers.push(r.reset); }
    else if (ctl.kind === 'pair') panel.appendChild(pairRow(ctl));
    else panel.appendChild(numberRow(ctl));
  }

  // ---- keep, forget, copy
  const buttons = document.createElement('div'); buttons.className = 'tune-buttons';
  const keep = document.createElement('button'); keep.className = 'primary'; keep.textContent = 'keep on this device';
  const forget = document.createElement('button'); forget.textContent = 'forget';
  const copy = document.createElement('button'); copy.textContent = 'copy the settings';
  const note = document.createElement('p'); note.className = 'tune-note';
  const box = document.createElement('textarea'); box.readOnly = true; box.hidden = true;
  const only = () => {
    // only what the controls cover, so the copy is short
    const out = {};
    for (const ctl of T.controls) {
      if (!ctl.path) continue;
      const ks = ctl.path.split('.'); let o = out;
      for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {};
      o[ks[ks.length - 1]] = get(ctl.path);
    }
    return JSON.stringify(out, null, 1);
  };
  keep.addEventListener('click', () => {
    try { localStorage.setItem(storeKey, only()); note.textContent = 'kept. this browser will use these values from now on, with or without ?tune.'; }
    catch (e) { note.textContent = 'could not save here.'; }
  });
  forget.addEventListener('click', () => {
    try { localStorage.removeItem(storeKey); } catch (e) {}
    note.textContent = 'forgotten. reload to get the page’s own values back.';
  });
  copy.addEventListener('click', async () => {
    const text = `${T.key} settings:\n` + only();
    box.value = text;
    try { await navigator.clipboard.writeText(text); note.textContent = 'copied. paste it to whoever keeps the site and they can make it permanent.'; }
    catch (e) { box.hidden = false; box.select(); note.textContent = 'select the text below and copy it.'; }
  });
  buttons.append(keep, forget, copy);
  panel.append(buttons, note, box);

  document.body.append(panel, pill);
  try { if (localStorage.getItem(storeKey)) note.textContent = 'this browser has kept values; the sliders show them.'; } catch (e) {}
})();
