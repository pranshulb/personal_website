// What every café page shares that needs a script (cafe.css has the rest).

// "← back" is pinned to the top left so it stays in reach down a long page,
// but on a short window the page scrolls and the title slid under it
// ("musings is hidden behind back button", October 2026). Scrolling down now
// slides it away, so it never sits on what's being read; scrolling up, or
// being back near the top, brings it back. html.back-away in cafe.css.
(() => {
  const root = document.documentElement;
  let lastY = window.scrollY, queued = false;
  function update() {
    queued = false;
    const y = window.scrollY, dy = y - lastY;
    if (y < 8) root.classList.remove('back-away');
    else if (dy > 4) root.classList.add('back-away');
    else if (dy < -4) root.classList.remove('back-away');
    else return;          // a few pixels of jitter (a trackpad settling) changes nothing
    lastY = y;
  }
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
})();

// The pointer is a small rose firefly on every page, the home page included
// ("make the pointer uniform across all pages", October 2026): a deep-rose
// dot with a pale hot centre in a soft flickering haze, and a trail of small
// glows fading behind it in about a second. The home page draws other
// visitors' fireflies in its scene with the same look (its drawFirefly /
// drawTrail): keep the two the same.
//
// It never turns back into the arrow or a hand ("i dont want it to convert
// to a cursor on links, but also it should be obvious when u r on a link",
// October 2026). Over anything that can be clicked it lights up: it swells,
// brightens and wears a thin rose ring that breathes, and the ring tightens
// for a moment when it is pressed. A finger gets the firefly under it while
// it touches.
(() => {
  const root = document.documentElement;
  if (!window.requestAnimationFrame || !document.createElement('canvas').getContext) return;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let ownStyle = null;
  if (fine) {
    // the arrow hidden everywhere, whatever a page sets for its own buttons.
    // Here rather than in cafe.css so that any page loading this gets it (the
    // garden, the typewriter pages have no cafe.css).
    ownStyle = document.createElement('style');
    ownStyle.textContent = 'html.firefly, html.firefly * { cursor: none !important; }';
    document.head.appendChild(ownStyle);
    root.classList.add('firefly');
  }

  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  // above everything: the petals (petals.js, 60) and the guestbook (50)
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:61';
  const c = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintGlow(r, g, b, a) {
    const n = 64, s = document.createElement('canvas');
    s.width = s.height = n;
    const x = s.getContext('2d'), gr = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a})`);
    gr.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${a * 0.4})`);
    gr.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    x.fillStyle = gr; x.fillRect(0, 0, n, n);
    return s;
  }
  const HAZE = paintGlow(214, 51, 108, 0.45), BODY = paintGlow(200, 30, 90, 1), CORE = paintGlow(255, 236, 242, 1);
  function glow(x, y, r, a, sprite) {
    if (a < 0.01) return;
    c.globalAlpha = a; c.drawImage(sprite, x - r, y - r, 2 * r, 2 * r); c.globalAlpha = 1;
  }

  // What can be clicked. Links, buttons, fields and the like by what they
  // are; anything else by the pointer a page's own styles gave it (the map's
  // places and markers, the filters, the questions' toggles, the words on
  // "things i like" you can drag), read from the stylesheets, which still say
  // so though the arrow is hidden. A page-wide area with a pointer isn't
  // counted, or the firefly would be lit up everywhere.
  const CLICKABLE = 'a[href], button:not(:disabled), [role="button"], [role="link"], summary, label, select, '
    + 'input:not([type="hidden"]):not(:disabled), textarea, [onclick], [style*="cursor: pointer"], [style*="cursor:pointer"]';
  const NOT_A_POINTER = /^(none|auto|default|text|inherit|initial|unset|revert|wait|progress|not-allowed)$/;
  let sheetsSeen = -1, pointerSel = '';
  function splitSelectors(text) {
    const out = []; let depth = 0, cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((t) => t.trim()).filter(Boolean);
  }
  function readPointerRules() {
    sheetsSeen = document.styleSheets.length;
    const sels = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }   // @media, @supports
        const cur = r.style && r.style.cursor;
        if (!r.selectorText || !cur || NOT_A_POINTER.test(cur)) continue;
        for (const sel of splitSelectors(r.selectorText)) {
          if (/::/.test(sel)) continue;                                      // ::before and the like
          try { root.matches(sel); sels.push(sel); } catch (e) { /* not a selector this browser knows */ }
        }
      }
    };
    for (const sh of document.styleSheets) {
      if (ownStyle && sh.ownerNode === ownStyle) continue;
      try { walk(sh.cssRules); } catch (e) { /* another site's stylesheet: can't be read, and needn't be */ }
    }
    pointerSel = sels.join(', ');
  }
  function clickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(CLICKABLE)) return true;
    if (document.styleSheets.length !== sheetsSeen) readPointerRules();   // a stylesheet arrived (the guestbook's)
    if (!pointerSel) return false;
    let m = null;
    try { m = el.closest(pointerSel); } catch (e) { pointerSel = ''; }
    if (!m || m === document.body || m === root) return false;
    const r = m.getBoundingClientRect();
    return r.width * r.height < 0.25 * W * H;
  }

  const TRAIL_LIFE = 55;   // steps of a 60th of a second: about a second
  const trail = [];
  let x = -1e4, y = -1e4, lastX = null, lastY = null, dist = 0, clock = 0;
  let hot = false, hotK = 0, press = 0, under = null;
  let running = false, prev = 0, acc = 0;

  function frame(now) {
    acc += Math.min(now - prev, 100); prev = now;
    while (acc >= 1000 / 60) {   // steps of a 60th of a second, whatever the screen's rate
      acc -= 1000 / 60; clock += 0.02;
      hotK += ((hot ? 1 : 0) - hotK) * 0.22;   // lights up in about a tenth of a second
      press *= 0.86;
      for (let i = trail.length - 1; i >= 0; i--) if (++trail[i].age > TRAIL_LIFE) trail.splice(i, 1);
    }
    c.clearRect(0, 0, W, H);
    for (const q of trail) {
      const k = 1 - q.age / TRAIL_LIFE;
      glow(q.x, q.y, 4 * (0.5 + 0.5 * k), 0.6 * k * k, BODY);
    }
    const shown = x > -5000;
    if (shown) {
      const f = 0.5 + 0.5 * Math.sin(clock * 1.6), k = hotK;
      // on something clickable: a wider, brighter haze, a bigger body ...
      glow(x, y, 13 * (1 + 0.15 * f) * (1 + 0.6 * k), (0.75 + 0.25 * f) * (1 - k) + 0.95 * k, HAZE);
      glow(x, y, 4.5 * (1 + 0.3 * k), 1, BODY);
      glow(x, y, 1.8 * (1 + 0.4 * k), 1, CORE);
      // ... and a thin rose ring round it that breathes, tightening when pressed
      if (k > 0.02) {
        const r = (8 + 6 * k + Math.sin(clock * 4) * 0.8) * (1 - 0.3 * press);
        c.globalAlpha = 0.85 * k;
        c.strokeStyle = 'rgb(196, 40, 96)';
        c.lineWidth = 1.3;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      }
    }
    // nothing left to draw: stop until the pointer moves again
    if (shown || trail.length || hotK > 0.01) requestAnimationFrame(frame); else running = false;
  }
  function wake() {
    if (running) return;
    running = true; prev = performance.now(); acc = 0;
    requestAnimationFrame(frame);
  }

  function moveTo(nx, ny) {
    if (lastX !== null) {
      dist += Math.hypot(nx - lastX, ny - lastY);
      if (dist >= 8) {    // a glow left every few pixels travelled
        dist = 0;
        trail.push({ x: nx + (Math.random() * 2 - 1), y: ny + (Math.random() * 2 - 1), age: 0 });
        if (trail.length > 40) trail.shift();
      }
    }
    x = lastX = nx; y = lastY = ny;
    wake();
  }
  function away() { x = y = -1e4; lastX = lastY = null; hot = false; under = null; }
  function look(el) { if (el !== under) { under = el; hot = clickable(el); } }

  function start() {
    resize();
    document.body.appendChild(cv);
    window.addEventListener('resize', resize);
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen' && e.buttons === 0) return;
      look(e.target);
      moveTo(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { lastX = null; look(e.target); moveTo(e.clientX, e.clientY); }
      if (hot) { press = 1; wake(); }
    }, { passive: true });
    document.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') away(); }, { passive: true });
    document.addEventListener('pointercancel', away, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) away(); });
    window.addEventListener('blur', away);
    // a page scrolling, or the guestbook closing, changes what is under a
    // pointer that hasn't moved
    // (any scroll: the home page's words scroll in a box of their own)
    let relookQueued = false;
    const relook = () => {
      if (relookQueued || x < -5000) return;
      relookQueued = true;
      requestAnimationFrame(() => { relookQueued = false; if (x > -5000) { under = null; look(document.elementFromPoint(x, y)); wake(); } });
    };
    document.addEventListener('scroll', relook, { passive: true, capture: true });
    document.addEventListener('vb-closed', relook);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
