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
//
// It is a handful of small elements the browser only moves and fades (on
// the graphics card), never repaints. The first version drew it on a canvas
// the size of the window and redrew the whole of it every frame, even with
// the mouse still; that was what made the site feel slow on laptops and
// phones in November 2026 (the books list fell from 60 frames a second to
// 47, the garden from 55 to 40). Nothing here runs per frame: the pointer
// moving sets one transform, the flicker and the ring are CSS animations,
// and each glow of the trail is a little animation of its own.
(() => {
  const root = document.documentElement;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The firefly's look, and the arrow hidden everywhere, whatever a page sets
  // for its own buttons. Here rather than in cafe.css so that any page
  // loading this gets it (the garden, the typewriter pages have no cafe.css).
  // The glows are the canvas version's: rgba(r, g, b, a) at the centre,
  // 40% of a halfway out, nothing at the edge.
  const glowCss = (r, g, b, a) => `radial-gradient(circle closest-side, rgba(${r},${g},${b},${a}) 0%, rgba(${r},${g},${b},${a * 0.4}) 50%, rgba(${r},${g},${b},0) 100%)`;
  const ownStyle = document.createElement('style');
  ownStyle.textContent = (fine ? 'html.firefly, html.firefly * { cursor: none !important; }\n' : '') + `
.ff-layer { position: fixed; inset: 0; pointer-events: none; z-index: 61; overflow: hidden; contain: strict; }
.ff-layer > div { position: absolute; left: 0; top: 0; }
.ff { width: 0; height: 0; opacity: 0; transition: opacity 0.15s ease-out; will-change: transform; }
.ff.on { opacity: 1; }
.ff > i { position: absolute; display: block; border-radius: 50%; transition: scale 0.12s ease-out, opacity 0.12s ease-out; }
.ff .ff-haze { left: -13px; top: -13px; width: 26px; height: 26px; }
.ff .ff-haze > b { display: block; width: 100%; height: 100%; border-radius: 50%; background: ${glowCss(214, 51, 108, 0.45)}; }
.ff .ff-body { left: -4.5px; top: -4.5px; width: 9px; height: 9px; background: ${glowCss(200, 30, 90, 1)}; }
.ff .ff-core { left: -1.8px; top: -1.8px; width: 3.6px; height: 3.6px; background: ${glowCss(255, 236, 242, 1)}; }
.ff .ff-ring { left: -14px; top: -14px; width: 28px; height: 28px; box-sizing: border-box; border: 1.3px solid rgb(196, 40, 96); opacity: 0; scale: 0.57; }
.ff.hot .ff-haze { scale: 1.6; }
.ff.hot .ff-body { scale: 1.3; }
.ff.hot .ff-core { scale: 1.4; }
.ff.hot .ff-ring { opacity: 0.85; scale: 1; }
.ff.hot.press .ff-ring { scale: 0.7; transition-duration: 0.05s; }
.ff-dot { width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; opacity: 0; background: ${glowCss(200, 30, 90, 1)}; }
@keyframes ff-flicker { from { scale: 1; opacity: 0.75; } to { scale: 1.15; opacity: 1; } }
@keyframes ff-ring { from { transform: scale(0.95); } to { transform: scale(1.05); } }
.ff .ff-haze > b { animation: ff-flicker 1.65s ease-in-out infinite alternate; }
.ff .ff-ring { animation: ff-ring 0.65s ease-in-out infinite alternate; }
@media (prefers-reduced-motion: reduce) { .ff .ff-haze > b, .ff .ff-ring { animation: none; } }
`;
  document.head.appendChild(ownStyle);
  if (fine) root.classList.add('firefly');

  const layer = document.createElement('div');
  layer.className = 'ff-layer';
  layer.setAttribute('aria-hidden', 'true');
  const ff = document.createElement('div');
  ff.className = 'ff';
  // the haze's flicker is on an inner layer, so being lit up can scale the outer one
  ff.innerHTML = '<i class="ff-haze"><b></b></i><i class="ff-ring"></i><i class="ff-body"></i><i class="ff-core"></i>';
  // the trail: forty glows, each used again in turn
  const DOTS = 40, TRAIL_MS = 920;   // about a second, as the canvas version's 55 steps
  const dots = [], anims = [];
  for (let k = 0; k < DOTS; k++) { const d = document.createElement('div'); d.className = 'ff-dot'; dots.push(d); layer.appendChild(d); }
  layer.appendChild(ff);
  let nextDot = 0;
  function dropDot(px, py) {
    if (still) return;
    const k = nextDot; nextDot = (nextDot + 1) % DOTS;
    const d = dots[k];
    if (anims[k]) anims[k].cancel();
    // position and size in the animation itself, so nothing else is restyled
    const at = 'translate(' + (px + (Math.random() * 2 - 1)).toFixed(1) + 'px, ' + (py + (Math.random() * 2 - 1)).toFixed(1) + 'px) scale(';
    // opacity 0.6k² and size 0.5 + 0.5k as k runs from 1 to 0, as before
    anims[k] = d.animate([
      { opacity: 0.6, transform: at + '1)' },
      { opacity: 0.6 * 0.5625, transform: at + '0.875)', offset: 0.25 },
      { opacity: 0.6 * 0.25, transform: at + '0.75)', offset: 0.5 },
      { opacity: 0.6 * 0.0625, transform: at + '0.625)', offset: 0.75 },
      { opacity: 0, transform: at + '0.5)' },
    ], { duration: TRAIL_MS, easing: 'linear' });
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
      if (sh.ownerNode === ownStyle) continue;
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
    return r.width * r.height < 0.25 * window.innerWidth * window.innerHeight;
  }

  let x = -1e4, y = -1e4, lastX = null, lastY = null, dist = 0, under = null, queued = false, pressTimer = 0;
  // the pointer's position is applied once a frame at most, whatever the
  // mouse's own rate (some report 500 or 1000 times a second)
  function place() {
    queued = false;
    if (x < -5000) return;
    ff.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function moveTo(nx, ny) {
    if (lastX !== null) {
      dist += Math.hypot(nx - lastX, ny - lastY);
      if (dist >= 8) { dist = 0; dropDot(nx, ny); }   // a glow left every few pixels travelled
    }
    x = lastX = nx; y = lastY = ny;
    ff.classList.add('on');
    if (!queued) { queued = true; requestAnimationFrame(place); }
  }
  function away() { x = y = -1e4; lastX = lastY = null; under = null; ff.classList.remove('on', 'hot'); }
  function look(el) { if (el !== under) { under = el; ff.classList.toggle('hot', clickable(el)); } }

  function start() {
    document.body.appendChild(layer);
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen' && e.buttons === 0) return;
      if (!e.isPrimary) return;   // a second finger doesn't pull the firefly back and forth
      look(e.target);
      moveTo(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.isPrimary) { lastX = null; look(e.target); moveTo(e.clientX, e.clientY); }
      if (ff.classList.contains('hot')) {
        ff.classList.add('press');
        clearTimeout(pressTimer); pressTimer = setTimeout(() => ff.classList.remove('press'), 140);
      }
    }, { passive: true });
    document.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch' && e.isPrimary) away(); }, { passive: true });
    document.addEventListener('pointercancel', away, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) away(); });
    window.addEventListener('blur', away);
    // a page scrolling, or the guestbook closing, changes what is under a
    // pointer that hasn't moved (any scroll: the home page's words scroll in
    // a box of their own)
    let relookQueued = false;
    const relook = () => {
      if (relookQueued || x < -5000) return;
      relookQueued = true;
      requestAnimationFrame(() => { relookQueued = false; if (x > -5000) { under = null; look(document.elementFromPoint(x, y)); } });
    };
    document.addEventListener('scroll', relook, { passive: true, capture: true });
    document.addEventListener('vb-closed', relook);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
