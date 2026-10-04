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

// The pointer is a small rose firefly on every page, as on the home page
// ("make the pointer uniform across all pages", October 2026): a deep-rose
// dot with a pale hot centre in a soft flickering haze, and a trail of small
// glows fading behind it in about a second. The home page draws its own (in
// its scene, with other visitors' fireflies), and says so with html.firefly
// before this runs, so this stands aside there. Keep the look the same as
// the home page's drawFirefly / drawTrail if either changes.
//
// On a mouse or trackpad the arrow is hidden (html.firefly, styles below).
// Wherever the page shows a pointer of its own — links, buttons, fields, the
// guestbook, the words on "things i like" you can drag — that pointer comes
// back and the firefly steps aside, so what can be clicked still shows. A
// finger gets the firefly under it while it touches.
(() => {
  const root = document.documentElement;
  if (root.classList.contains('firefly')) return;            // the home page's own
  if (!window.requestAnimationFrame || !document.createElement('canvas').getContext) return;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine) {
    // The arrow hidden, and back over whatever can be clicked, typed in or
    // dragged. Here rather than in cafe.css so that any page loading this
    // gets it, with or without cafe.css (the garden, the typewriter pages).
    const st = document.createElement('style');
    st.textContent = 'html.firefly, html.firefly body { cursor: none; }'
      + ' html.firefly :is(a, button, [role="button"], summary, label, select, input[type="checkbox"], input[type="radio"]) { cursor: pointer; }'
      + ' html.firefly :is(input:not([type="checkbox"]):not([type="radio"]), textarea) { cursor: text; }'
      + ' html.firefly .vb { cursor: auto; }';
    document.head.appendChild(st);
    root.classList.add('firefly');
  }

  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:61';   // above the petals (petals.js, 60)
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

  const TRAIL_LIFE = 55;   // steps of a 60th of a second: about a second
  const trail = [];
  let x = -1e4, y = -1e4, lastX = null, lastY = null, dist = 0, over = false, clock = 0;
  let running = false, prev = 0, acc = 0;

  function frame(now) {
    acc += Math.min(now - prev, 100); prev = now;
    while (acc >= 1000 / 60) {   // steps of a 60th of a second, whatever the screen's rate
      acc -= 1000 / 60; clock += 0.02;
      for (let i = trail.length - 1; i >= 0; i--) if (++trail[i].age > TRAIL_LIFE) trail.splice(i, 1);
    }
    c.clearRect(0, 0, W, H);
    for (const q of trail) {
      const k = 1 - q.age / TRAIL_LIFE;
      glow(q.x, q.y, 4 * (0.5 + 0.5 * k), 0.6 * k * k, BODY);
    }
    const shown = x > -5000 && !over;
    if (shown) {
      const f = 0.5 + 0.5 * Math.sin(clock * 1.6);
      glow(x, y, 13 * (1 + 0.15 * f), 0.75 + 0.25 * f, HAZE);
      glow(x, y, 4.5, 1, BODY);
      glow(x, y, 1.8, 1, CORE);
    }
    // nothing left to draw: stop until the pointer moves again
    if (shown || trail.length) requestAnimationFrame(frame); else running = false;
  }
  function wake() {
    if (running) return;
    running = true; prev = performance.now(); acc = 0;
    requestAnimationFrame(frame);
  }

  function moveTo(nx, ny) {
    if (lastX !== null) {
      dist += Math.hypot(nx - lastX, ny - lastY);
      if (dist >= 8 && !over) {    // a glow left every few pixels travelled
        dist = 0;
        trail.push({ x: nx + (Math.random() * 2 - 1), y: ny + (Math.random() * 2 - 1), age: 0 });
        if (trail.length > 40) trail.shift();
      }
    }
    x = lastX = nx; y = lastY = ny;
    wake();
  }
  function away() { x = y = -1e4; lastX = lastY = null; }

  // Over anything that shows a pointer of its own, the firefly steps aside.
  // The page hides the arrow (cursor: none, inherited), so whatever isn't
  // "none" was set for that element: a link's hand, a field's caret, a
  // draggable word's grab, the guestbook's arrow.
  function showsOwnPointer(el) {
    if (!el || el.nodeType !== 1) return false;
    return getComputedStyle(el).cursor !== 'none';
  }

  function start() {
    resize();
    document.body.appendChild(cv);
    window.addEventListener('resize', resize);
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen' && e.buttons === 0) return;
      over = showsOwnPointer(e.target);
      moveTo(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { over = false; lastX = null; moveTo(e.clientX, e.clientY); } }, { passive: true });
    document.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') away(); }, { passive: true });
    document.addEventListener('pointercancel', away, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) away(); });
    window.addEventListener('blur', away);
    // closing the guestbook takes it out from under a pointer that may not
    // move again for a while
    document.addEventListener('vb-closed', () => { over = false; wake(); });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
