/* ================================================================
   PETALS — the home page's cherry blossom, for every other page

   The home page (index.html) draws its petals on a canvas: heart-shaped,
   in the same pinks as its tree, tumbling as they fall, leaning with the
   pointer's wind, catchable, and settling on the title's letters. The
   subpages each had an older, blurrier CSS version that drifted apart
   over time. This is the home page's petal engine on its own, minus the
   tree and the ground, so a subpage looks like the page it came from.

   Include with `<script defer src="/petals.js"></script>`. It makes its
   own full-viewport canvas above the page (pointer-events: none). Petals
   settle on the elements matched by the script tag's `data-ledges`
   attribute (default: the page's `h1`); a word under the pointer sheds
   its petals. Keep this and the copy in index.html in step: shape,
   colours and physics are the same code, transcribed.
   ================================================================ */
(() => {
  const me = document.currentScript;
  const LEDGE_SEL = (me && me.dataset.ledges) || 'h1';

  const cv = document.createElement('canvas');
  cv.id = 'petals';
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:60;display:block;';
  document.body.appendChild(cv);
  const c = cv.getContext('2d');

  let W = 0, H = 0, dpr = 1, isMobile = false;
  let mx = 0, windX = 0;
  let px = -1e4, py = -1e4, ppx = -1e4, ppy = -1e4, pvx = 0, pvy = 0;
  let held = [];
  let haloPhase = 0;
  let t = 0;
  let airPetals = [];

  // The home page's petal pinks, as they are.
  const PETAL_SOFT = ['#F4A8BD','#EE92AB','#F0B8CC','#EBA3B8','#F5C0D0','#E8889E','#F2B0C2','#EFA0B6'];
  const PETAL_DEEP = ['#D85878','#C04866','#CE4F70','#B83C5E','#D9637D'];

  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rng = (a, b) => a + Math.random() * (b - a);
  const PI2 = Math.PI * 2;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    isMobile = W < 900;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- ledges: petals settle on the words ----------------
     Same idea as the home page: paint the element's text with its own font
     into a scratch canvas, scan each column for the first inked pixel, and
     that skyline is what a falling petal lands on. Block elements (an h1)
     have half-leading above the letters, so the baseline is placed from
     the line box rather than assumed to be one ascent down. */
  let ledges = [];
  let perched = [];
  const hotEls = new Set();
  const measC = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

  function measureLedge(el) {
    const rects = el.getClientRects();
    if (rects.length !== 1) return null;
    const r = rects[0];
    if (r.width < 8 || r.height < 8) return null;
    const cs = getComputedStyle(el);
    const w = Math.ceil(r.width), h = Math.ceil(r.height);
    let sky = null;
    try {
      measC.canvas.width = w; measC.canvas.height = h;
      measC.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ('letterSpacing' in measC) measC.letterSpacing = cs.letterSpacing;
      measC.textBaseline = 'alphabetic';
      measC.fillStyle = '#000';
      const text = el.textContent;
      const m = measC.measureText(text);
      const fs = parseFloat(cs.fontSize);
      const asc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || fs * 0.8;
      const desc = m.fontBoundingBoxDescent || fs * 0.2;
      const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
      const padL = parseFloat(cs.paddingLeft) || 0;
      const inner = h - padT - padB;
      let x0 = padL;
      if (cs.textAlign === 'center') x0 = (w - m.width) / 2;
      else if (cs.textAlign === 'right' || cs.textAlign === 'end') x0 = w - padL - m.width;
      measC.fillText(text, x0, padT + (inner - asc - desc) / 2 + asc);
      const data = measC.getImageData(0, 0, w, h).data;
      sky = new Int16Array(w).fill(-1);
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if (data[(y * w + x) * 4 + 3] > 40) { sky[x] = y; break; }
        }
      }
    } catch (e) { sky = null; }
    return { el, left: r.left, top: r.top, width: r.width, height: r.height, sky,
             cap: el.closest('h1') ? (isMobile ? 8 : 14) : 3 };
  }

  function measureLedges() {
    perched = [];
    ledges = [];
    document.querySelectorAll(LEDGE_SEL).forEach(el => {
      const L = measureLedge(el);
      if (L) ledges.push(L);
    });
  }

  function layoutLedges() {
    for (const L of ledges) {
      const r = L.el.getBoundingClientRect();
      L.left = r.left; L.top = r.top;
    }
  }

  function skyAt(L, x) {
    if (x < L.left || x >= L.left + L.width) return -1;
    if (!L.sky) return L.height * 0.3;
    return L.sky[Math.floor(x - L.left)];
  }

  function perchPetal(p, k, s) {
    const L = ledges[k];
    const mine = perched.filter(q => q.l === k);
    if (mine.length >= L.cap) releasePetal(mine[0], 0);
    perched.push({ l: k, ox: p.x - L.left, oy: s - p.r * 0.45, r: p.r,
      rot: p.rot + rng(-0.5, 0.5), color: p.color, alpha: p.alpha, age: 0 });
  }

  function releasePetal(q, gust) {
    const idx = perched.indexOf(q);
    if (idx < 0) return;
    perched.splice(idx, 1);
    const L = ledges[q.l];
    airPetals.push(newAirPetal(L.left + q.ox, L.top + q.oy,
      rng(-0.3, 0.3) + gust, rng(-0.12, 0.06), q));
  }

  function releaseLedge(el, gust) {
    const k = ledges.findIndex(L => L.el === el);
    if (k < 0) return;
    for (const q of perched.filter(q => q.l === k)) releasePetal(q, gust);
  }

  /* ---------------- pointer: catching petals ---------------- */
  const HALO_MAX = 60;
  function haloSpin(n) { return Math.min(0.24, 0.02 + 0.009 * n); }
  function haloRadius(n) { return Math.min(64, 15 + 2.4 * n); }
  function updatePointer() {
    pvx = px - ppx; pvy = py - ppy; ppx = px; ppy = py;
    if (px < -5000) { pvx = 0; pvy = 0; return; }
    const speed = Math.hypot(pvx, pvy);
    if (held.length && speed > 22) releaseHeld(true);
    if (held.length < HALO_MAX && speed < 6) {
      for (let i = airPetals.length - 1; i >= 0 && held.length < HALO_MAX; i--) {
        const p = airPetals[i];
        if (Math.hypot(p.x - px, p.y - py) < 14 + p.r) {
          airPetals.splice(i, 1);
          held.push({ p, ox: p.x - px, oy: p.y - py, wob: Math.random() * PI2 });
        }
      }
    }
    const n = held.length;
    if (n) {
      haloPhase += haloSpin(n);
      const R = haloRadius(n);
      held.forEach((h, i) => {
        const a = haloPhase + i * PI2 / n;
        const wob = Math.sin(t * 2 + h.wob) * 3;
        const tx = Math.cos(a) * (R + wob), ty = Math.sin(a) * (R + wob) * 0.85;
        h.ox += (tx - h.ox) * 0.14; h.oy += (ty - h.oy) * 0.14;
        h.p.x = px + h.ox; h.p.y = py + h.oy;
        h.p.rot = a + Math.PI / 2 + Math.sin(t * 3 + h.wob) * 0.25;
        h.p.tumble += 0.02;
      });
    }
  }

  function releaseHeld(flick) {
    const speed = Math.hypot(pvx, pvy);
    const n = held.length, w = haloSpin(n), R = haloRadius(n);
    held.forEach((h, i) => {
      const p = h.p;
      const a = haloPhase + i * PI2 / n;
      const sx = -Math.sin(a) * w * R, sy = Math.cos(a) * w * R * 0.85;
      const k = flick ? Math.min(0.32, 7 / Math.max(speed, 1)) : 0;
      p.vx = pvx * k + sx * (flick ? 0.8 : 0.45) + rng(-0.2, 0.2);
      p.vy = pvy * k + sy * (flick ? 0.8 : 0.45) + rng(-0.1, 0.05);
      p.drag = flick ? 90 : 40; p.noLand = 20;
      p.rotV = rng(-0.02, 0.02); p.tumSpd = rng(0.004, 0.01);
      airPetals.push(p);
    });
    held = [];
  }

  /* ---------------- physics ---------------- */
  function newAirPetal(x, y, vx, vy, keep) {
    return {
      x, y, vx, vy,
      r: keep ? keep.r : rng(5, 11), rot: keep ? keep.rot : rng(-0.6, 0.6), rotV: rng(-0.005, 0.005),
      tumble: Math.random() * PI2, tumSpd: rng(0.002, 0.007),
      swp: Math.random() * PI2, swSpd: rng(0.002, 0.005), swAmp: rng(0.12, 0.42),
      color: keep ? keep.color : (Math.random() < 0.40 ? pick(PETAL_DEEP) : pick(PETAL_SOFT)),
      alpha: keep ? keep.alpha : rng(0.55, 0.90),
      noLand: keep ? 45 : 0,
      drag: 0
    };
  }

  // No tree here: every petal arrives from above the top edge, the way the
  // home page's non-tree petals do.
  function spawnPetal() {
    airPetals.push(newAirPetal(rng(-W * 0.1, W * 1.1), rng(-60, -10), rng(-0.1, 0.1), rng(0.03, 0.06)));
  }

  function updatePetals() {
    windX += (mx * 0.7 - windX) * 0.006;
    for (let i = airPetals.length - 1; i >= 0; i--) {
      const p = airPetals[i];
      p.vx += windX * 0.0012 + Math.sin(t * 0.22 + p.swp) * 0.0007;
      p.vy += 0.00055;
      p.swp += p.swSpd;
      p.vx += Math.sin(p.swp) * p.swAmp * 0.0016;
      p.vx *= 0.998; p.vy *= 0.999;
      if (p.drag > 0) { p.drag--; p.vx *= 0.96; p.vy *= 0.96; }
      const foot0 = p.y + p.r * 0.5;
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV; p.tumble += p.tumSpd;

      if (p.noLand > 0) p.noLand--;
      else if (p.vy > 0 && ledges.length) {
        const foot1 = p.y + p.r * 0.5;
        let landed = false;
        for (let k = 0; k < ledges.length; k++) {
          if (hotEls.has(ledges[k].el)) continue;
          const s = skyAt(ledges[k], p.x);
          if (s < 0) continue;
          const yTop = ledges[k].top + s;
          if (foot0 < yTop && foot1 >= yTop) { perchPetal(p, k, s); landed = true; break; }
        }
        if (landed) { airPetals.splice(i, 1); continue; }
      }
      if (p.x < -100 || p.x > W + 100 || p.y < -150 || p.y > H + 40) airPetals.splice(i, 1);
    }
    for (let i = perched.length - 1; i >= 0; i--) {
      perched[i].age += 0.0001;
      if (perched[i].age > 1) perched.splice(i, 1);
    }
    if (airPetals.length < (isMobile ? 18 : 30) && Math.random() < 0.05) spawnPetal();
  }

  /* ---------------- drawing ---------------- */
  function drawPetalShape(x, y, sz, rot, color, alpha, tumble) {
    if (alpha < 0.015) return;
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    if (tumble !== undefined) c.scale(Math.cos(tumble) || 0.01, 1);
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -sz);
    c.bezierCurveTo(sz * 0.55, -sz * 0.65, sz * 0.50, sz * 0.33, 0, sz * 0.75);
    c.bezierCurveTo(-sz * 0.50, sz * 0.33, -sz * 0.55, -sz * 0.65, 0, -sz);
    c.fill();
    c.restore();
    c.globalAlpha = 1;
  }

  function draw() {
    c.clearRect(0, 0, W, H);
    for (const q of perched) {
      const L = ledges[q.l];
      const a = q.alpha * Math.max(0, 1 - q.age);
      if (a > 0.015) drawPetalShape(L.left + q.ox, L.top + q.oy, q.r, q.rot, q.color, a);
    }
    for (const p of airPetals) drawPetalShape(p.x, p.y, p.r, p.rot, p.color, p.alpha, p.tumble);
    for (const h of held) drawPetalShape(h.p.x, h.p.y, h.p.r, h.p.rot, h.p.color, h.p.alpha, h.p.tumble);
  }

  function frame() {
    t += 0.016;
    updatePointer();
    updatePetals();
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------------- events ---------------- */
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => { scrollTicking = false; layoutLedges(); });
  }, { passive: true });
  window.addEventListener('resize', () => { resize(); measureLedges(); });
  document.addEventListener('mousemove', e => {
    mx = (e.clientX / W - 0.5) * 2;
    px = e.clientX; py = e.clientY;
  });
  document.addEventListener('mouseleave', () => {
    if (held.length) releaseHeld(false);
    px = -1e4; py = -1e4;
  });
  document.addEventListener('click', () => { if (held.length) releaseHeld(false); });
  document.addEventListener('touchmove', e => {
    const tc = e.touches[0]; mx = (tc.clientX / W - 0.5) * 2;
    px = tc.clientX; py = tc.clientY;
  }, { passive: true });
  document.addEventListener('touchstart', e => {
    const tc = e.touches[0];
    px = ppx = tc.clientX; py = ppy = tc.clientY;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (held.length) releaseHeld(true);
    px = -1e4; py = -1e4;
  }, { passive: true });

  /* ---------------- init ---------------- */
  resize();
  measureLedges();
  if (document.fonts) {
    document.fonts.ready.then(measureLedges);
    document.fonts.addEventListener('loadingdone', measureLedges);
  }
  document.querySelectorAll(LEDGE_SEL).forEach(el => {
    el.addEventListener('mouseenter', () => {
      hotEls.add(el);
      releaseLedge(el, (Math.random() < 0.5 ? -1 : 1) * rng(0.5, 0.9));
    });
    el.addEventListener('mouseleave', () => hotEls.delete(el));
  });
  // already falling when the page opens
  for (let i = 0; i < (isMobile ? 10 : 16); i++) {
    spawnPetal();
    const p = airPetals[airPetals.length - 1];
    p.y = rng(0, H * 0.9); p.x = rng(0, W);
    p.noLand = 30;
  }
  frame();
})();
