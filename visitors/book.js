/* ======================================================================
   THE VISITORS' BOOK
   A page that opens over any café page that loads this (with book.css) and
   links to #visitors: garden.html, index.html.
   Sign your name and a handwriting network writes it out, in your browser
   (hand-worker.js — Alex Graves' 2013 handwriting synthesis, weights from
   X-rayLaser's pytorch-handwriting-synthesis-toolkit, MIT). The pen strokes
   are kept (api/guestbook.js) so everyone sees the same signature. The
   ~3.8 MB network loads only when someone starts writing; reading the book
   is just the saved strokes, drawn as SVG.
   Or "sign it myself" (October 2026): a pad to sign on, or draw a little
   doodle, with a mouse, a pen or a finger, no name needed; the drawing is
   smoothed into the same ink as the pen's and kept as drawn.
====================================================================== */
(() => {
  // its stylesheet and its page, added once to whichever page loads this
  // script, so a page needs only the script tag and a link to #visitors
  if (!document.querySelector('link[href="/visitors/book.css"]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/visitors/book.css';
    document.head.appendChild(css);
  }
  if (!document.getElementById('vb')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div class="vb" id="vb" hidden role="dialog" aria-modal="true" aria-labelledby="vb-title">
      <div class="vb-page">
        <button type="button" class="vb-close" id="vb-close" aria-label="close the guestbook">&times;</button>
        <h2 class="vb-title" id="vb-title">guestbook</h2>
        <div class="vb-tabs" role="tablist" aria-label="how to sign">
          <button type="button" class="vb-tab" role="tab" id="vb-tab-pen" aria-selected="true" aria-controls="vb-pen">write it for me</button>
          <button type="button" class="vb-tab" role="tab" id="vb-tab-hand" aria-selected="false" aria-controls="vb-hand" tabindex="-1">sign it myself</button>
        </div>
        <div id="vb-pen" role="tabpanel" aria-labelledby="vb-tab-pen">
        <form class="vb-form" id="vb-form" autocomplete="off">
          <label class="vb-hp" for="vb-name">your name</label>
          <input id="vb-name" name="name" maxlength="40" placeholder="your name" required enterkeyhint="go">
          <input class="vb-hp" id="vb-website" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button type="submit" class="vb-btn" id="vb-write">write it</button>
        </form>
        <div class="vb-preview" id="vb-preview" hidden>
          <svg class="vb-ink" id="vb-ink" aria-hidden="true"></svg>
          <p class="vb-status" id="vb-status" aria-live="polite"></p>
          <div class="vb-actions" id="vb-actions" hidden>
            <button type="button" class="vb-btn" id="vb-sign">sign the guestbook</button>
            <button type="button" class="vb-btn quiet" id="vb-again">write it again</button>
          </div>
        </div>
        </div>
        <div id="vb-hand" role="tabpanel" aria-labelledby="vb-tab-hand" hidden>
          <div class="vb-pad-wrap">
            <canvas class="vb-pad" id="vb-pad" role="img" aria-label="a space to sign your name, or draw a little doodle, with a mouse, a pen or a finger"></canvas>
            <p class="vb-pad-hint" id="vb-pad-hint" aria-hidden="true">sign your name or just draw a lil doodle :)</p>
          </div>
          <p class="vb-status" id="vb-hand-status" aria-live="polite"></p>
          <div class="vb-actions">
            <button type="button" class="vb-btn" id="vb-hand-sign" disabled>sign the guestbook</button>
            <button type="button" class="vb-btn quiet" id="vb-hand-undo" disabled>undo</button>
            <button type="button" class="vb-btn quiet" id="vb-hand-clear" disabled>start again</button>
          </div>
        </div>
        <p class="vb-count" id="vb-count" aria-live="polite"></p>
        <ol class="vb-list" id="vb-list"></ol>
      </div>
    </div>`);
  }
  const API = '/api/guestbook';
  const MODEL = '/visitors/hand-v1.bin';
  const $ = (id) => document.getElementById(id);
  const vb = $('vb'), list = $('vb-list'), countEl = $('vb-count'), form = $('vb-form'), nameIn = $('vb-name');
  const preview = $('vb-preview'), ink = $('vb-ink'), statusEl = $('vb-status'), actions = $('vb-actions');
  const writeBtn = $('vb-write'), signBtn = $('vb-sign'), againBtn = $('vb-again');
  const NS = 'http://www.w3.org/2000/svg';
  let worker = null, modelReady = false, job = 0, result = null, typedName = '', canRemove = false;
  let entries = null, lastFocus = null, parts = [], box = null, drawQueued = false;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---- open / close ----
  function open() {
    lastFocus = document.activeElement;
    vb.hidden = false;
    if (location.hash !== '#visitors') history.replaceState(null, '', '#visitors');
    setTimeout(() => { if (!penPanel.hidden) nameIn.focus({ preventScroll: true }); else sizePad(); }, 50);
    if (!entries) loadBook();
  }
  function close() {
    vb.hidden = true;
    job++;                                  // stop any writing in progress
    if (location.hash === '#visitors') history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    document.dispatchEvent(new Event('vb-closed'));   // the page under it may want to know (the home page's firefly)
  }
  // any link to #visitors opens the book
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href="#visitors"]');
    if (a) { e.preventDefault(); open(); }
  });
  // Taps and clicks inside the book stay in the book: the pages under it
  // shake their tree or ripple their water on a click or tap anywhere.
  for (const t of ['click', 'touchstart', 'touchend']) vb.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  $('vb-close').addEventListener('click', close);
  vb.addEventListener('click', (e) => { if (e.target === vb) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !vb.hidden) close(); });
  if (location.hash === '#visitors') open();
  window.addEventListener('hashchange', () => { if (location.hash === '#visitors' && vb.hidden) open(); });

  // ---- drawing a signature ----
  // smooth ink: quadratic curves through the midpoints of the saved points
  function pathData(strokes) {
    let d = '';
    for (const s of strokes) {
      const n = s.length / 2;
      if (n < 2) continue;
      d += 'M' + s[0] + ' ' + s[1];
      if (n === 2) { d += 'L' + s[2] + ' ' + s[3]; continue; }
      for (let i = 1; i < n - 1; i++) {
        const x = s[2 * i], y = s[2 * i + 1], mx = (x + s[2 * i + 2]) / 2, my = (y + s[2 * i + 3]) / 2;
        d += 'Q' + x + ' ' + y + ' ' + mx + ' ' + my;
      }
      d += 'L' + s[2 * n - 2] + ' ' + s[2 * n - 1];
    }
    return d;
  }
  // a signature drawn by hand needn't come with a name
  const who = (e) => e.name || 'a signature drawn by hand';
  function signature(e) {
    if (!e.strokes) {
      const span = document.createElement('span');
      span.className = 'vb-typed'; span.textContent = e.name;
      return span;
    }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'vb-sig');
    svg.setAttribute('viewBox', '0 0 ' + (e.w + 8) + ' ' + (e.h + 8));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', who(e));
    const t = document.createElementNS(NS, 'title'); t.textContent = who(e); svg.appendChild(t);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathData(e.strokes));
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke-width', String(Math.max(2.2, (e.h + 8) / 34)));
    svg.appendChild(path);
    return svg;
  }

  // ---- the book ----
  const mine = () => (store.get('vb-mine') || '').split(',').filter(Boolean);
  function row(e) {
    const li = document.createElement('li');
    li.dataset.id = e.id;
    if (mine().includes(e.id)) li.classList.add('you');
    li.appendChild(signature(e));
    const when = document.createElement('span');
    when.className = 'vb-when'; when.textContent = e.date || '';
    li.appendChild(when);
    if (canRemove) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'vb-remove'; x.textContent = 'remove';
      x.setAttribute('aria-label', 'remove ' + who(e));
      x.addEventListener('click', () => removeEntry(e, li));
      li.appendChild(x);
    }
    return li;
  }
  function showCount() {
    const n = entries.length;
    countEl.textContent = n === 0 ? 'no one has signed yet. be the first!'
      : n === 1 ? 'one person has signed the guestbook' : n + ' people have signed the guestbook';
  }
  // a signature stays unwritten until it scrolls into view, then writes itself
  const io = 'IntersectionObserver' in window && !reduceMotion ? new IntersectionObserver((seen) => {
    for (const s of seen) if (s.isIntersecting) { s.target.classList.replace('pending', 'draw'); io.unobserve(s.target); }
  }, { root: vb }) : null;
  function renderBook() {
    list.textContent = '';
    showCount();
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      const li = row(e);
      const svg = li.querySelector('.vb-sig');
      if (io && svg) { svg.classList.add('pending'); io.observe(svg); }
      frag.appendChild(li);
    }
    list.appendChild(frag);
  }
  async function loadBook() {
    countEl.textContent = 'opening the guestbook…';
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      entries = data.entries || []; canRemove = !!data.canRemove;
      renderBook();
    } catch (e) {
      countEl.textContent = '';
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'vb-btn quiet'; a.textContent = 'the guestbook wouldn\'t open, try again';
      a.addEventListener('click', loadBook);
      countEl.appendChild(a);
    }
  }
  async function removeEntry(e, li) {
    if (!confirm(e.name ? 'remove "' + e.name + '" from the guestbook?' : 'remove this drawn signature from the guestbook?')) return;
    const res = await fetch(API + '?id=' + encodeURIComponent(e.id), { method: 'DELETE' });
    if (res.ok) { entries = entries.filter((x) => x.id !== e.id); li.remove(); showCount(); }
    else alert('could not remove it (' + res.status + ')');
  }

  // ---- writing ----
  function ensureWorker() {
    if (worker) return;
    worker = new Worker('/visitors/hand-worker.js');
    worker.onmessage = onWorker;
    worker.onerror = () => { setStatus('the pen stopped working. reload the page to try again'); writeBtn.disabled = false; };
  }
  function setStatus(t) { statusEl.textContent = t; }
  // live ink: each part is drawn from its latest attempt as the points arrive
  function queueDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(drawLive); } }
  function drawLive() {
    drawQueued = false;
    let cursor = 0; const strokes = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of parts) {
      if (!pts || !pts.length) continue;
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
      let cur = [];
      for (const [x, y, up] of pts) {
        const X = x - lo + cursor, Y = y;          // the network's y points down already
        cur.push(X, Y);
        minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
        if (up) { if (cur.length >= 4) strokes.push(cur); cur = []; }
      }
      if (cur.length >= 4) strokes.push(cur);
      cursor += hi - lo + 26;
    }
    if (!strokes.length) { ink.textContent = ''; return; }
    // the box only grows, so the writing doesn't jump about as it goes
    box = box ? { x0: Math.min(box.x0, minX - 10), y0: Math.min(box.y0, minY - 10), x1: Math.max(box.x1, maxX + 10), y1: Math.max(box.y1, maxY + 10) }
              : { x0: minX - 10, y0: Math.min(minY - 10, -90), x1: Math.max(maxX + 10, 300), y1: Math.max(maxY + 10, 60) };
    ink.setAttribute('viewBox', box.x0 + ' ' + box.y0 + ' ' + (box.x1 - box.x0) + ' ' + (box.y1 - box.y0));
    ink.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    ink.innerHTML = '<path stroke-width="' + Math.max(2.2, (box.y1 - box.y0) / 34) + '" d="' + pathData(strokes) + '"/>';
  }
  function showResult(r) {
    result = r;
    const e = r.strokes ? measure(r.strokes) : null;
    ink.textContent = '';
    if (e) {
      ink.setAttribute('viewBox', '0 0 ' + (e.w + 8) + ' ' + (e.h + 8));
      ink.innerHTML = '<path stroke-width="' + Math.max(2.2, (e.h + 8) / 34) + '" d="' + pathData(r.strokes) + '"/>';
    } else {
      ink.setAttribute('viewBox', '0 0 300 60');
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '0'); t.setAttribute('y', '42'); t.setAttribute('font-size', '34'); t.setAttribute('fill', '#3a2f2f');
      t.textContent = typedName; ink.appendChild(t);
    }
    actions.hidden = false; writeBtn.disabled = false;
  }
  function measure(strokes) {
    let w = 0, h = 0;
    for (const s of strokes) for (let i = 0; i < s.length; i += 2) { w = Math.max(w, s[i]); h = Math.max(h, s[i + 1]); }
    return { w, h };
  }
  function onWorker(ev) {
    const m = ev.data;
    if (m.id !== undefined && m.id !== job) return;       // an old request
    if (m.type === 'ready') { modelReady = true; return; }
    if (m.type === 'ink') {
      modelReady = true;
      if (!parts[m.part] || parts[m.part].attempt !== m.attempt) { parts[m.part] = []; parts[m.part].attempt = m.attempt; }
      parts[m.part].push(...m.pts);
      if (!statusEl.dataset.again) setStatus('writing…');
      queueDraw();
    } else if (m.type === 'again') {
      parts[m.part] = [];
      statusEl.dataset.again = '1';
      setStatus('that came out wobbly, writing it again…');
      queueDraw();
    } else if (m.type === 'done') {
      delete statusEl.dataset.again;
      setStatus('like it? sign the guestbook, or have it written again');
      showResult({ strokes: m.strokes });
    } else if (m.type === 'typed') {
      setStatus('the pen only knows the latin alphabet so far, so your name goes in as you typed it');
      showResult({ strokes: null });
    } else if (m.type === 'fail') {
      delete statusEl.dataset.again;
      // don't leave them stuck: they can have another go, or sign it as typed
      setStatus('the pen couldn\'t manage that one. have it written again, or sign it as you typed it');
      showResult({ strokes: null });
    } else if (m.type === 'error') {
      setStatus('the pen could not be fetched. check your connection and try again');
      writeBtn.disabled = false;
    }
  }
  function startWriting() {
    typedName = nameIn.value.trim().replace(/\s+/g, ' ');
    if (!typedName) { nameIn.focus(); return; }
    ensureWorker();
    job++; result = null; parts = []; box = null; ink.textContent = '';
    preview.hidden = false; actions.hidden = true; signBtn.hidden = false; writeBtn.disabled = true;
    delete statusEl.dataset.again;
    setStatus(modelReady ? 'writing…' : 'fetching the pen (about 4 MB, just this once)…');
    worker.postMessage({ type: 'write', id: job, text: typedName, url: MODEL });
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); startWriting(); });
  againBtn.addEventListener('click', startWriting);
  nameIn.addEventListener('input', () => { if (result && nameIn.value.trim() !== typedName) { actions.hidden = true; setStatus('press "write it" to write the new name'); } });
  // Someone typing a name is about to write it: fetch the pen and warm it
  // up now (a couple of seconds' work, once), so it's ready when they press
  // "write it".
  nameIn.addEventListener('input', () => { if (!worker) { ensureWorker(); worker.postMessage({ type: 'load', url: MODEL }); } }, { once: true });

  // Sends a signature to the book; true once it's in.
  async function sendSignature(body) {
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, website: $('vb-website').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (data.entry) {
      store.set('vb-mine', mine().concat(data.entry.id).join(','));
      entries = [data.entry].concat(entries || []);
      renderBook();
    }
    countEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    countEl.textContent = 'thank you for signing ✿ ' + countEl.textContent;
  }

  signBtn.addEventListener('click', async () => {
    if (!result) return;
    signBtn.disabled = true; againBtn.disabled = true;
    setStatus('signing…');
    try {
      await sendSignature({ name: typedName, strokes: result.strokes });
      preview.hidden = true; nameIn.value = ''; result = null;
      setStatus('');
    } catch (e) {
      setStatus(String(e.message || e));
    } finally {
      signBtn.disabled = false; againBtn.disabled = false;
    }
  });

  // ---- two ways to sign: tabs ----
  const penTab = $('vb-tab-pen'), handTab = $('vb-tab-hand'), penPanel = $('vb-pen'), handPanel = $('vb-hand');
  function pickTab(hand, focus) {
    penTab.setAttribute('aria-selected', String(!hand)); handTab.setAttribute('aria-selected', String(hand));
    penTab.tabIndex = hand ? -1 : 0; handTab.tabIndex = hand ? 0 : -1;
    penPanel.hidden = hand; handPanel.hidden = !hand;
    if (hand) sizePad();
    if (focus) (hand ? handTab : penTab).focus();
  }
  penTab.addEventListener('click', () => pickTab(false));
  handTab.addEventListener('click', () => pickTab(true));
  for (const t of [penTab, handTab]) t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pickTab(t === penTab, true); }
  });

  // ---- signing by hand ----
  // The pad keeps what's drawn in its own pixels; it's saved in half-pixels,
  // each stroke simplified a little (the same as the pen's) and drawn in the
  // book with the same smoothing and the same ink.
  const pad = $('vb-pad'), padHint = $('vb-pad-hint'), handStatus = $('vb-hand-status');
  const handSign = $('vb-hand-sign'), handUndo = $('vb-hand-undo'), handClear = $('vb-hand-clear');
  const pc = pad.getContext('2d');
  const MAX_INK = 3500;   // points; the server takes 4000
  let drawing = [], stroke = null, padW = 0, padH = 0;
  const inkUsed = () => drawing.reduce((n, s) => n + s.length, 0);
  function sizePad() {
    const r = pad.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    padW = r.width; padH = r.height;
    pad.width = Math.round(padW * dpr); pad.height = Math.round(padH * dpr);
    pc.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawPad();
  }
  window.addEventListener('resize', () => { if (!handPanel.hidden && !vb.hidden) sizePad(); });
  function redrawPad() {
    pc.clearRect(0, 0, padW, padH);
    pc.strokeStyle = '#3a2f2f'; pc.lineWidth = 2.6; pc.lineCap = 'round'; pc.lineJoin = 'round';
    for (const s of drawing) {
      if (!s.length) continue;
      pc.beginPath(); pc.moveTo(s[0][0], s[0][1]);
      if (s.length < 3) { const e = s[s.length - 1]; pc.lineTo(e[0] + 0.01, e[1]); }   // a dot
      for (let i = 1; i < s.length - 1; i++) pc.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
      if (s.length >= 3) pc.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
      pc.stroke();
    }
    const any = drawing.length > 0;
    padHint.hidden = any;
    handSign.disabled = !any; handUndo.disabled = !any; handClear.disabled = !any;
  }
  function padPoint(e) {
    const r = pad.getBoundingClientRect();
    return [Math.max(0, Math.min(padW, e.clientX - r.left)), Math.max(0, Math.min(padH, e.clientY - r.top))];
  }
  pad.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (inkUsed() >= MAX_INK) { handStatus.textContent = 'that\'s all the ink this page holds: sign it, or start again'; return; }
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    stroke = [padPoint(e)];
    drawing.push(stroke);
    handStatus.textContent = '';
    redrawPad();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = padPoint(ev), q = stroke[stroke.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.8) continue;
      if (inkUsed() >= MAX_INK) break;
      stroke.push(p);
    }
    redrawPad();
  });
  const endStroke = () => { stroke = null; };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('lostpointercapture', endStroke);
  handUndo.addEventListener('click', () => { drawing.pop(); handStatus.textContent = ''; redrawPad(); });
  handClear.addEventListener('click', () => { drawing = []; handStatus.textContent = ''; redrawPad(); });

  // Ramer–Douglas–Peucker, as the pen's: keep the shape, drop what adds nothing
  function simplify(p, eps) {
    if (p.length < 3) return p;
    const [ax, ay] = p[0], [bx, by] = p[p.length - 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = 0, idx = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const d = Math.abs(dy * p[i][0] - dx * p[i][1] + bx * ay - by * ax) / len;
      if (d > far) { far = d; idx = i; }
    }
    if (far <= eps) return [p[0], p[p.length - 1]];
    return simplify(p.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(p.slice(idx), eps));
  }
  // the drawing -> strokes as the book keeps them: half-pixels, from near 0,0
  function drawnStrokes() {
    let minX = Infinity, minY = Infinity;
    for (const s of drawing) for (const [x, y] of s) { minX = Math.min(minX, x); minY = Math.min(minY, y); }
    return drawing.filter((s) => s.length).map((s) => {
      const pts = s.length === 1 ? [s[0], s[0]] : simplify(s, 0.5);
      return pts.flatMap(([x, y]) => [Math.round((x - minX) * 2) + 4, Math.round((y - minY) * 2) + 4]);
    });
  }
  handSign.addEventListener('click', async () => {
    if (!drawing.length) return;
    handSign.disabled = true; handUndo.disabled = true; handClear.disabled = true;
    handStatus.textContent = 'signing…';
    try {
      await sendSignature({ drawn: true, strokes: drawnStrokes() });
      drawing = []; redrawPad();
      handStatus.textContent = '';
    } catch (e) {
      handStatus.textContent = String(e.message || e);
      redrawPad();
    }
  });
})();
