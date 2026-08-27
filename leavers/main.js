import * as THREE from 'three';

/* =========================================================================
   PRANSHUL BUBBLE ENGINE
   big, bouncy, squash-and-stretch soap bubbles with a Pranshul inside each.
   Images are pulled at random from ./images — see loadImageList().
   ========================================================================= */

/* ------------------------------ config ---------------------------------- */
const CFG = {
  minBubbles: 14,
  maxBubbles: 60,
  density: 1 / 58000,      // bubbles per px² of viewport — pack the screen
  radius: [0.62, 1.75],    // world units (visible height is ~11)
  detail: 4,               // icosahedron subdivision (plenty at this count)

  // motion — they cruise and bounce rather than sink, so they never pile up
  cruise: [1.3, 3.2],      // each bubble's happy speed (world units / s)
  bounce: 1.0,             // walls give back everything
  drift: 0.7,              // idle wander
  damping: 0.999,
  maxSpeed: 9,
  push: 2.0,               // cursor shove strength
  pushRadius: 2.6,         // reach of the cursor dent, in world units

  // jiggle spring (squash & stretch)
  springK: 78,             // stiffness — higher = faster wobble
  springC: 6.4,            // damping   — lower  = more oscillation
  stretchPerSpeed: 0.030,  // how much motion elongates them
  maxSquash: 0.40,

  // glass look — tuned so his face stays readable
  // exactly ONE photo stretched across each bubble — a radial lens warp,
  // bijective on the disk, so it can never tile or run off the edge.
  bend: [1.20, 1.75],      // >1 magnifies the middle (big nose). 1 = flat decal
  eta: [0.80, 0.92],       // glassiness of the rim
  aberration: 0.030,       // rainbow fringing
  gloss: 0.46,             // how much rim sheen sits over the face
};

const FALLBACK_IMAGES = [
  'images/pranshul-01.jpg', 'images/pranshul-02.jpg', 'images/pranshul-03.jpg',
  'images/pranshul-04.jpg', 'images/pranshul-05.jpg', 'images/pranshul-06.jpg',
  'images/pranshul-07.jpg', 'images/pranshul-08.jpg', 'images/pranshul-09.jpg',
  'images/pranshul-10.jpg', 'images/pranshul-11.jpg', 'images/pranshul-12.jpg',
  'images/pranshul-13.jpg',
];

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------- image directory loader ------------------------
   TO SWAP IN NEW PHOTOS: drop files into ./images/ .
     1. GET images/ with Accept: application/json -> Caddy `file_server browse`
     2. GET /api/images        -> { images: [...] }   (server.js, local dev)
     3. GET images/manifest.json                      (dumb static hosts)
     4. hard-coded fallback
-------------------------------------------------------------------------- */
const IS_IMG = /\.(jpe?g|png|webp|gif|avif)$/i;

async function loadImageList() {
  const norm = (d) => {
    const arr = Array.isArray(d) ? d : (d && d.images) || [];
    return arr
      .map((x) => (typeof x === 'string' ? x : x && (x.name || x.url)))
      .filter((s) => typeof s === 'string' && IS_IMG.test(s))
      .map((s) => s.replace(/^\.\//, ''))
      .map((s) => (s.includes('/') ? s : `images/${s}`));
  };
  const attempts = [
    ['images/', { Accept: 'application/json' }],
    ['/api/images', null],
    ['images/manifest.json', null],
  ];
  for (const [url, headers] of attempts) {
    try {
      const res = await fetch(url, { cache: 'no-store', headers: headers || {} });
      if (!res.ok) continue;
      if (!/json/i.test(res.headers.get('content-type') || '')) continue;
      const list = [...new Set(norm(await res.json()))];
      if (list.length) { console.log(`[bubbles] ${list.length} faces via ${url}`); return list; }
    } catch (_) { /* try next */ }
  }
  console.warn('[bubbles] using built-in fallback image list');
  return FALLBACK_IMAGES;
}

/* -------------------------------- three ---------------------------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.z = 12;

const geometry = new THREE.IcosahedronGeometry(1, CFG.detail);

/* ------------------------------- shaders ---------------------------------
   Deformation is deliberately *round*: a volume-preserving ellipsoid squash
   plus a smooth spherical-cap dent under the cursor. No noisy per-axis sine
   soup — that's what made them read as lumpy blobs.
--------------------------------------------------------------------------- */
const VERT = /* glsl */`
uniform float uTime, uSeed, uPush, uSquash, uPop, uGrab;
uniform vec3  uPointer;     // pointer position in this bubble's local unit space
uniform vec3  uAxis;        // squash / stretch axis (unit, local space)
varying vec3  vNormalV, vPosV, vLocal;

void main() {
  vec3 p = normalize(position);
  vec3 nrm = p;

  // --- slow organic breathing: two big smooth lobes, nothing jagged -------
  float s = uSeed * 6.2831;
  float breathe = 0.020 * sin(uTime * 1.05 + s + p.y * 1.7)
                + 0.014 * sin(uTime * 0.77 + s * 1.7 - p.x * 2.1);
  float r = 1.0 + breathe;

  // --- volume-preserving squash & stretch along uAxis ---------------------
  float k  = clamp(uSquash, -0.55, 0.75);
  float sa = 1.0 + k;                     // scale along the axis
  float sp = inversesqrt(max(sa, 0.08));  // scale perpendicular -> volume held
  float along = dot(p, uAxis);
  vec3  perp  = p - uAxis * along;
  p   = (uAxis * (along * sa) + perp * sp) * r;
  // exact ellipsoid normal, so lighting bends with the squash
  nrm = normalize(uAxis * (along / sa) + perp / sp);

  // --- cursor dent: a smooth spherical cap facing the pointer -------------
  vec3  pd  = normalize(uPointer + vec3(0.0, 0.0, 1e-4));
  float cap = smoothstep(0.30, 1.0, dot(normalize(p), pd)) * uPush;
  p   -= normalize(p) * cap * 0.30;
  p   *= 1.0 + uPush * 0.05;              // the rest of the skin bulges out
  nrm  = normalize(mix(nrm, normalize(p), cap * 0.7));

  // --- grabbed: a soft nervous pulse; popping: expand away ----------------
  p *= 1.0 + uGrab * 0.035 * sin(uTime * 9.0 + s);
  p *= 1.0 + uPop * 0.9;

  vLocal   = normalize(p);
  vNormalV = normalize(normalMatrix * nrm);
  vec4 mv  = modelViewMatrix * vec4(p, 1.0);
  vPosV    = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform float uTime, uSeed, uHover, uPop, uRoll, uBend, uEta, uAberr, uPush, uGloss;
varying vec3 vNormalV, vPosV, vLocal;

/* One photo, stretched to fill the whole bubble.
   The disk radius maps to the texture radius 1:1, so uv can never leave
   [0,1] — no tiling, no repeats. bend redistributes radius inside the
   disk: > 1 blows his face up in the middle and squeezes the photo's edges
   out toward the rim, which is the funhouse-lens bit. Refraction adds a
   swirl on top. */
vec2 faceUV(float bend, float roll, vec3 R) {
  vec2 d = vLocal.xy + R.xy * 0.10;          // slight glassy rim swirl
  float r = min(length(d), 1.0);
  vec2 dir = r > 1e-5 ? d / r : vec2(0.0, 1.0);
  float rr = pow(r, bend);                   // bijective on [0,1]
  vec2 q = dir * rr;
  float c = cos(roll), s = sin(roll);
  q = mat2(c, -s, s, c) * q;
  return q * 0.5 + 0.5;
}

void main() {
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vPosV);
  float ndv  = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.2);          // tight rim, clear middle

  // ---- refraction with a touch of chromatic aberration -------------------
  vec3 Rr = refract(-V, N, uEta);
  vec3 col;
  col.r = texture2D(uMap, faceUV(uBend - uAberr, uRoll, Rr)).r;
  col.g = texture2D(uMap, faceUV(uBend,          uRoll, Rr)).g;
  col.b = texture2D(uMap, faceUV(uBend + uAberr, uRoll, Rr)).b;

  col = pow(clamp(col, 0.0, 1.0), vec3(0.88)) * 1.12;

  // ---- shade the sphere so it reads as a ball, not a sticker -------------
  vec3 KEY = normalize(vec3(-0.45, 0.80, 0.80));
  float lam = 0.76 + 0.24 * max(dot(N, KEY), 0.0);
  float bounceLight = 0.10 * max(dot(N, normalize(vec3(0.2, -1.0, 0.35))), 0.0);
  col *= lam;
  col += vec3(1.0, 0.72, 0.48) * bounceLight;

  // ---- warm soap sheen, kept to the rim so the face stays readable -------
  vec3 iri = 0.62 + 0.38 * cos(6.28318 * (vec3(0.02, 0.20, 0.42) + fres * 1.5 + uSeed * 2.0 + uTime * 0.04));
  iri = mix(iri, vec3(1.0, 0.86, 0.68), 0.35);           // warm it up
  col = mix(col, col * 0.55 + iri * 0.72, fres * uGloss);

  // ---- highlights: one big soft key + one tiny sparkle --------------------
  vec3 L1 = normalize(vec3(-0.45, 0.80, 0.80));
  vec3 L2 = normalize(vec3(0.70, -0.35, 0.60));
  col += vec3(1.0, 0.97, 0.90) * pow(max(dot(reflect(-L1, N), V), 0.0), 48.0) * 0.55;
  col += vec3(1.0, 0.88, 0.78) * pow(max(dot(reflect(-L2, N), V), 0.0), 120.0) * 0.5;
  col += vec3(1.0, 0.80, 0.55) * uHover * (0.06 + fres * 0.30);
  col += vec3(1.0, 0.72, 0.50) * uPush * 0.10;
  col += vec3(1.0, 0.95, 0.90) * uPop * 1.1;

  // ---- soft warm contact edge so bubbles separate on a cream page ---------
  float edge = smoothstep(0.55, 0.98, fres);
  col = mix(col, col * 0.78 + vec3(0.40, 0.22, 0.12) * 0.26, edge * 0.42);

  float alpha = mix(0.97, 1.0, fres) * (1.0 - uPop);
  gl_FragColor = vec4(col, alpha);
}
`;

/* ------------------------------ textures --------------------------------- */
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function getTexture(url) {
  if (texCache.has(url)) return texCache.get(url);
  const t = texLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAniso;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(url, t);
  return t;
}

/* ------------------------------- bubbles --------------------------------- */
let IMAGES = FALLBACK_IMAGES;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const bounds = { w: 10, h: 10 };
function updateBounds() {
  const h = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
  bounds.h = h;
  bounds.w = h * camera.aspect;
}

class Bubble {
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      uniforms: {
        uMap: { value: null },
        uTime: { value: 0 }, uSeed: { value: Math.random() },
        uPush: { value: 0 }, uSquash: { value: 0 }, uPop: { value: 0 },
        uGrab: { value: 0 }, uHover: { value: 0 },
        uPointer: { value: new THREE.Vector3(0, 0, 99) },
        uAxis: { value: new THREE.Vector3(0, 1, 0) },
        uRoll: { value: rand(-0.35, 0.35) },
        uBend: { value: rand(...CFG.bend) },
        uEta: { value: rand(...CFG.eta) }, uAberr: { value: CFG.aberration },
        uGloss: { value: CFG.gloss },
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.mat);
    this.mesh.userData.bubble = this;

    this.vel = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);      // squash axis
    this.sq = 0; this.sqV = 0;                   // jiggle spring state
    this.hover = 0; this.push = 0; this.grab = 0;
    this.popT = -1;
    this.roll0 = rand(-0.22, 0.22);
    this.rollV = rand(0.25, 0.55);   // rocking speed
    this.wander = rand(0, 6.283);
    this.cruise = rand(...CFG.cruise);           // preferred speed
    this.grabbed = false;
    this.grabOffset = new THREE.Vector3();
    this.reset(true);
    scene.add(this.mesh);
  }

  face(url) {
    this.url = url || pick(IMAGES);
    this.mat.uniforms.uMap.value = getTexture(this.url);
  }

  reset(anywhere = false) {
    this.r = rand(CFG.radius[0], CFG.radius[1]);
    this.mesh.scale.setScalar(this.r);
    const hw = Math.max(0.2, bounds.w / 2 - this.r), hh = Math.max(0.2, bounds.h / 2 - this.r);
    this.mesh.position.set(
      rand(-hw, hw),
      anywhere ? rand(-hh, hh) : -bounds.h / 2 - this.r * 1.4,
      rand(-2.0, 1.4)
    );
    const a = rand(0, Math.PI * 2);
    this.cruise = rand(...CFG.cruise);
    this.vel.set(Math.cos(a) * this.cruise, Math.sin(a) * this.cruise, 0);
    this.sq = 0; this.sqV = 0;
    const u = this.mat.uniforms;
    u.uPop.value = 0;
    u.uSeed.value = Math.random();
    u.uBend.value = rand(...CFG.bend);
    u.uEta.value = rand(...CFG.eta);
    this.popT = -1;
    this.face();
  }

  /** compress along `normal` — the thing that makes impacts feel bouncy */
  impact(normal, strength) {
    if (strength < 0.05) return;
    this.axis.lerp(normal, 0.85).normalize();
    this.sqV -= Math.min(3.4, strength * 1.5);
  }

  pop() {
    if (this.popT >= 0) return false;
    this.popT = 0;
    burst(this.mesh.position, this.r);
    blip();
    return true;
  }
}

const bubbles = [];
function targetCount() {
  const n = Math.round(innerWidth * innerHeight * CFG.density * (reduceMotion ? 0.6 : 1));
  return Math.max(CFG.minBubbles, Math.min(CFG.maxBubbles, n));
}
function setCount(n) {
  n = Math.max(1, Math.min(CFG.maxBubbles, n));
  while (bubbles.length < n) bubbles.push(new Bubble());
  while (bubbles.length > n) {
    const b = bubbles.pop();
    scene.remove(b.mesh);
    b.mat.dispose();
  }
}

/* =========================================================================
   FACE SPRITES
   Flat billboard discs of Pranshul used for every non-bubble animation:
   confetti, the conga line, comets, the peeker, the cursor trail, moons.
   Camera never rotates, so a plain XY plane is already a billboard.
   ========================================================================= */
const PALETTE = [
  0xff3d8b, 0xff8a3d, 0xffd23d, 0x3de0a0, 0x3dbbff, 0xa45cff, 0xff5c5c, 0x2bd4c4,
];
const spriteGeo = new THREE.PlaneGeometry(1, 1);

const SPRITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3  uRing;
uniform float uSpin, uBend, uAlpha, uRingW, uSquish, uGlow;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  d.x /= max(uSquish, 0.05);
  float r = length(d);
  if (r > 1.0) discard;

  float c = cos(uSpin), s = sin(uSpin);
  vec2 q = mat2(c, -s, s, c) * d;
  float rr = pow(min(length(q), 1.0), uBend);
  vec2 uv = (length(q) > 1e-5 ? normalize(q) : vec2(0.0, 1.0)) * rr * 0.5 + 0.5;

  vec3 col = texture2D(uMap, uv).rgb;
  col = pow(clamp(col, 0.0, 1.0), vec3(0.88)) * 1.1;

  // chunky sticker outline + a white keyline inside it
  float ink   = smoothstep(1.0 - uRingW, 1.0 - uRingW * 0.55, r);
  float white = smoothstep(1.0 - uRingW * 1.8, 1.0 - uRingW * 1.3, r)
              * (1.0 - smoothstep(1.0 - uRingW * 1.1, 1.0 - uRingW * 0.8, r));
  col = mix(col, uRing, ink);
  col = mix(col, vec3(1.0), white * 0.85);
  col += uRing * uGlow * 0.35;

  gl_FragColor = vec4(col, uAlpha * (1.0 - smoothstep(0.975, 1.0, r)));
}`;

const SPRITE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

class FaceSprite {
  constructor({ size = 1, ring = null, bend = 1.0, ringW = 0.10, z = -3 } = {}) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        uMap: { value: null },
        uRing: { value: new THREE.Color(ring ?? pick(PALETTE)) },
        uSpin: { value: rand(-3, 3) }, uBend: { value: bend },
        uAlpha: { value: 1 }, uRingW: { value: ringW },
        uSquish: { value: 1 }, uGlow: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(spriteGeo, this.mat);
    this.mesh.position.z = z;
    this.setSize(size);
    this.newFace();
    scene.add(this.mesh);
  }
  setSize(s) { this.size = s; this.mesh.scale.set(s, s, 1); }
  newFace(url) { this.mat.uniforms.uMap.value = getTexture(url || pick(IMAGES)); }
  newRing() { this.mat.uniforms.uRing.value.setHex(pick(PALETTE)); }
  set visible(v) { this.mesh.visible = v; }
}

/* --- 1. face confetti: little Pranshuls tumbling up the background ------- */
const faceConfetti = [];
function initFaceConfetti(n = 22) {
  for (let i = 0; i < n; i++) {
    const f = new FaceSprite({ size: rand(0.30, 0.62), z: rand(-5.5, -3.0), ringW: rand(0.11, 0.17) });
    f.vx = rand(-0.5, 0.5); f.vy = rand(0.45, 1.5); f.spin = rand(-1.6, 1.6);
    f.mesh.position.set(rand(-bounds.w / 2, bounds.w / 2), rand(-bounds.h / 2, bounds.h / 2), f.mesh.position.z);
    faceConfetti.push(f);
  }
}
function stepFaceConfetti(dt, t) {
  const hw = bounds.w / 2 + 1.2, hh = bounds.h / 2 + 1.2;
  for (const f of faceConfetti) {
    const p = f.mesh.position;
    p.x += (f.vx + Math.sin(t * 0.7 + f.spin * 3) * 0.45) * dt;
    p.y += f.vy * dt;
    f.mat.uniforms.uSpin.value += f.spin * dt;
    f.mat.uniforms.uSquish.value = 1 + 0.22 * Math.sin(t * 2.4 + f.spin * 5);
    if (p.y > hh) { p.y = -hh; p.x = rand(-hw, hw); f.newFace(); f.newRing(); }
    if (p.x > hw) p.x = -hw; if (p.x < -hw) p.x = hw;
  }
}

/* --- 2. conga line: a bobbing parade across the bottom ------------------- */
const conga = [];
function initConga(n = 9) {
  for (let i = 0; i < n; i++) {
    const f = new FaceSprite({ size: 1.0, z: 2.2, ringW: 0.13, ring: PALETTE[i % PALETTE.length] });
    f.i = i;
    conga.push(f);
  }
}
function stepConga(dt, t) {
  const span = bounds.w + 3.5, gap = span / conga.length;
  for (const f of conga) {
    const x = ((t * 1.5 + f.i * gap) % span) - span / 2;
    const phase = t * 3.4 + f.i * 0.7;
    f.mesh.position.set(x, -bounds.h / 2 + 0.85 + Math.abs(Math.sin(phase)) * 0.85, 2.2);
    const hop = Math.abs(Math.sin(phase));
    f.setSize(0.82 + hop * 0.2);
    f.mat.uniforms.uSpin.value = Math.sin(phase * 0.5) * 0.35;
    f.mat.uniforms.uSquish.value = 1 + (1 - hop) * 0.28;   // squash on landing
    f.mat.uniforms.uGlow.value = hop * 0.5;
  }
}

/* --- 3. comet: a Pranshul screaming across the sky with a trail ---------- */
let comet = null, cometTrail = [], cometT = 0, cometNext = 3;
function initComet() {
  comet = new FaceSprite({ size: 1.5, z: 3.0, ringW: 0.11, bend: 1.3 });
  comet.visible = false;
  for (let i = 0; i < 7; i++) {
    const t = new FaceSprite({ size: 1.2, z: 2.9 - i * 0.02, ringW: 0.13 });
    t.visible = false;
    cometTrail.push(t);
  }
}
function launchComet() {
  const fromLeft = Math.random() < 0.5;
  const y = rand(-bounds.h * 0.35, bounds.h * 0.35);
  comet.p0 = new THREE.Vector3(fromLeft ? -bounds.w / 2 - 2 : bounds.w / 2 + 2, y, 3);
  comet.p1 = new THREE.Vector3(-comet.p0.x, y + rand(-2.5, 2.5), 3);
  comet.life = 0;
  comet.dur = rand(1.5, 2.4);
  comet.newFace(); comet.newRing();
  comet.setSize(rand(1.2, 1.9));
  cometTrail.forEach((t) => { t.mat.uniforms.uMap.value = comet.mat.uniforms.uMap.value; t.mat.uniforms.uRing.value.copy(comet.mat.uniforms.uRing.value); });
  comet.visible = true;
}
function stepComet(dt, t) {
  cometT += dt;
  if (!comet.visible && cometT > cometNext) { cometT = 0; cometNext = rand(2.2, 4.5); launchComet(); }
  if (!comet.visible) return;
  comet.life += dt;
  const k = comet.life / comet.dur;
  if (k >= 1) { comet.visible = false; cometTrail.forEach((s) => { s.visible = false; }); return; }
  const p = comet.mesh.position.lerpVectors(comet.p0, comet.p1, k);
  p.y += Math.sin(k * Math.PI * 3) * 0.7;               // whoop-de-doo
  comet.mat.uniforms.uSpin.value += dt * 7;
  comet.mat.uniforms.uSquish.value = 1.35;              // stretched by speed
  comet.mat.uniforms.uGlow.value = 0.6;
  cometTrail.forEach((s, i) => {
    const kk = Math.max(0, k - (i + 1) * 0.035);
    s.visible = kk > 0;
    s.mesh.position.lerpVectors(comet.p0, comet.p1, kk);
    s.mesh.position.y += Math.sin(kk * Math.PI * 3) * 0.7;
    s.setSize(comet.size * (1 - (i + 1) * 0.10));
    s.mat.uniforms.uAlpha.value = 0.5 * (1 - i / cometTrail.length);
    s.mat.uniforms.uSpin.value = comet.mat.uniforms.uSpin.value - (i + 1) * 0.5;
  });
}

/* --- 4. peeker: a giant Pranshul leans in from an edge, then leaves ------ */
let peeker = null, peekT = 0, peekNext = 5;
function initPeeker() {
  peeker = new FaceSprite({ size: 5.2, z: -1.2, ringW: 0.07, bend: 1.25 });
  peeker.visible = false;
}
function stepPeeker(dt, t) {
  peekT += dt;
  if (!peeker.visible) {
    if (peekT > peekNext) {
      peekT = 0; peekNext = rand(3.5, 7);
      peeker.newFace(); peeker.newRing();
      peeker.setSize(rand(4.2, 6.0));
      peeker.side = (Math.random() * 4) | 0;
      peeker.life = 0; peeker.dur = rand(2.6, 3.8);
      peeker.visible = true;
    }
    return;
  }
  peeker.life += dt;
  const k = peeker.life / peeker.dur;
  if (k >= 1) { peeker.visible = false; return; }
  const inOut = Math.sin(Math.min(1, k) * Math.PI);         // slide in and back out
  const hide = peeker.size * 0.62, hw = bounds.w / 2, hh = bounds.h / 2;
  const wob = Math.sin(t * 4) * 0.25;
  const P = peeker.mesh.position;
  if (peeker.side === 0) P.set(-hw - hide + inOut * hide * 1.15, wob, -1.2);
  else if (peeker.side === 1) P.set(hw + hide - inOut * hide * 1.15, wob, -1.2);
  else if (peeker.side === 2) P.set(wob, hh + hide - inOut * hide * 1.15, -1.2);
  else P.set(wob, -hh - hide + inOut * hide * 1.15, -1.2);
  peeker.mat.uniforms.uSpin.value = Math.sin(t * 2.2) * 0.22;
  peeker.mat.uniforms.uSquish.value = 1 + Math.sin(t * 5) * 0.06;
  peeker.mat.uniforms.uAlpha.value = Math.min(1, inOut * 3);
}

/* --- 5. cursor trail: tiny Pranshuls puffed out by fast mouse moves ------ */
const trail = [];
let trailHead = 0;
function initTrail(n = 14) {
  for (let i = 0; i < n; i++) {
    const f = new FaceSprite({ size: 0.5, z: 3.4, ringW: 0.15 });
    f.visible = false; f.life = 0;
    trail.push(f);
  }
}
function emitTrail(x, y) {
  const f = trail[trailHead = (trailHead + 1) % trail.length];
  f.mesh.position.set(x, y, 3.4);
  f.life = 1; f.visible = true;
  f.spin = rand(-6, 6);
  f.drift = new THREE.Vector2(rand(-0.8, 0.8), rand(0.4, 1.6));
  f.newFace(); f.newRing();
}
function stepTrail(dt) {
  for (const f of trail) {
    if (f.life <= 0) continue;
    f.life -= dt * 1.5;
    if (f.life <= 0) { f.visible = false; continue; }
    f.mesh.position.x += f.drift.x * dt;
    f.mesh.position.y += f.drift.y * dt;
    f.setSize(0.62 * f.life);
    f.mat.uniforms.uSpin.value += f.spin * dt;
    f.mat.uniforms.uAlpha.value = f.life;
  }
}

/* --- 6. moons: little Pranshuls in orbit around the middle of the page --- */
const moons = [];
function initMoons(n = 4) {
  for (let i = 0; i < n; i++) {
    const f = new FaceSprite({ size: rand(0.55, 0.95), z: 2.6, ringW: 0.14 });
    f.rad = rand(3.2, 6.2); f.spd = rand(0.25, 0.6) * (Math.random() < 0.5 ? -1 : 1);
    f.ph = rand(0, 6.283); f.tilt = rand(0.35, 0.85);
    moons.push(f);
  }
}
function stepMoons(dt, t) {
  for (const f of moons) {
    const a = t * f.spd + f.ph;
    f.mesh.position.set(Math.cos(a) * f.rad, Math.sin(a) * f.rad * f.tilt, 2.6 + Math.sin(a) * 0.4);
    f.mat.uniforms.uSpin.value = -a * 0.7;
    f.mat.uniforms.uSquish.value = 1 + 0.15 * Math.sin(t * 3 + f.ph);
  }
}

function initFaceShow() {
  initFaceConfetti(); initConga(); initComet(); initPeeker(); initTrail(); initMoons();
}
function stepFaceShow(dt, t) {
  stepFaceConfetti(dt, t); stepConga(dt, t); stepComet(dt, t);
  stepPeeker(dt, t); stepTrail(dt); stepMoons(dt, t);
}

/* --------------------------- ambient confetti ----------------------------
   Coloured specks tumbling behind and between the bubbles, forever. Purely
   decorative noise — the whole point is that the page never sits still.
-------------------------------------------------------------------------- */
const C_MAX = 340;
const cPos = new Float32Array(C_MAX * 3);
const cVel = new Float32Array(C_MAX * 3);
const cSeed = new Float32Array(C_MAX);
const cSize = new Float32Array(C_MAX);
const cGeo = new THREE.BufferGeometry();
cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
cGeo.setAttribute('aSeed', new THREE.BufferAttribute(cSeed, 1));
cGeo.setAttribute('aSize', new THREE.BufferAttribute(cSize, 1));
const cMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uPR: { value: 1 }, uTime: { value: 0 } },
  vertexShader: /* glsl */`
    attribute float aSeed, aSize; varying float vSeed; uniform float uPR, uTime;
    void main(){
      vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float twinkle = 0.72 + 0.28 * sin(uTime * 3.0 + aSeed * 40.0);
      gl_PointSize = aSize * uPR * 260.0 / max(-mv.z, 0.001) * twinkle;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vSeed;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      // alternate discs and little diamonds so it reads as confetti
      float m = vSeed > 0.5 ? step(length(d), 0.5)
                            : step(abs(d.x) + abs(d.y), 0.46);
      if (m < 0.5) discard;
      vec3 pal[6];
      pal[0] = vec3(1.00, 0.24, 0.55);   // hot pink
      pal[1] = vec3(1.00, 0.54, 0.24);   // tangerine
      pal[2] = vec3(1.00, 0.82, 0.24);   // sunshine
      pal[3] = vec3(0.24, 0.88, 0.63);   // mint
      pal[4] = vec3(0.24, 0.73, 1.00);   // sky
      pal[5] = vec3(0.64, 0.36, 1.00);   // grape
      int i = int(mod(vSeed * 97.0, 6.0));
      vec3 c = pal[0];
      if (i==1) c=pal[1]; else if (i==2) c=pal[2]; else if (i==3) c=pal[3];
      else if (i==4) c=pal[4]; else if (i==5) c=pal[5];
      gl_FragColor = vec4(c, 0.8);
    }`,
});
const confetti = new THREE.Points(cGeo, cMat);
confetti.frustumCulled = false;
scene.add(confetti);
function seedConfetti() {
  for (let i = 0; i < C_MAX; i++) {
    cPos[i * 3] = rand(-bounds.w / 2, bounds.w / 2);
    cPos[i * 3 + 1] = rand(-bounds.h / 2, bounds.h / 2);
    cPos[i * 3 + 2] = rand(-6, -2.5);
    cVel[i * 3] = rand(-0.5, 0.5);
    cVel[i * 3 + 1] = rand(0.25, 1.1);
    cVel[i * 3 + 2] = rand(-0.1, 0.1);
    cSeed[i] = Math.random();
    cSize[i] = rand(0.03, 0.085);
  }
  cGeo.attributes.aSeed.needsUpdate = true;
  cGeo.attributes.aSize.needsUpdate = true;
}
function stepConfetti(dt, t) {
  const hw = bounds.w / 2 + 1, hh = bounds.h / 2 + 1;
  for (let i = 0; i < C_MAX; i++) {
    cPos[i * 3] += (cVel[i * 3] + Math.sin(t * 0.8 + cSeed[i] * 30) * 0.35) * dt;
    cPos[i * 3 + 1] += cVel[i * 3 + 1] * dt;
    cPos[i * 3 + 2] += cVel[i * 3 + 2] * dt;
    if (cPos[i * 3 + 1] > hh) { cPos[i * 3 + 1] = -hh; cPos[i * 3] = rand(-hw, hw); }
    if (cPos[i * 3] > hw) cPos[i * 3] = -hw;
    if (cPos[i * 3] < -hw) cPos[i * 3] = hw;
  }
  cMat.uniforms.uTime.value = t;
  cGeo.attributes.position.needsUpdate = true;
}

/* ------------------------------ pop particles ---------------------------- */
const P_MAX = 420;
const pPos = new Float32Array(P_MAX * 3);
const pVel = new Float32Array(P_MAX * 3);
const pLife = new Float32Array(P_MAX);
const pSize = new Float32Array(P_MAX);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aLife', new THREE.BufferAttribute(pLife, 1));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uPR: { value: renderer.getPixelRatio() } },
  vertexShader: /* glsl */`
    attribute float aLife, aSize; varying float vLife; uniform float uPR;
    void main(){
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = aSize * uPR * 260.0 / max(-mv.z, 0.001) * (0.4 + aLife * 0.6);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vLife;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float r = length(d);
      if (r > 0.5 || vLife <= 0.0) discard;
      float ring = smoothstep(0.5, 0.36, r) * (0.30 + smoothstep(0.24, 0.47, r) * 0.9);
      vec3 c = mix(vec3(1.0, 0.90, 0.45), vec3(1.0, 0.30, 0.60), r * 1.4);
      gl_FragColor = vec4(c, ring * vLife * 0.95);
    }`,
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);
let pHead = 0;
function burst(pos, r) {
  for (let i = 0; i < 24; i++) {
    const k = pHead = (pHead + 1) % P_MAX;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(-1, 1)), sp = rand(1.4, 4.6) * (0.5 + r * 0.5);
    pPos[k * 3] = pos.x; pPos[k * 3 + 1] = pos.y; pPos[k * 3 + 2] = pos.z;
    pVel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
    pVel[k * 3 + 1] = Math.sin(ph) * Math.sin(th) * sp + 0.7;
    pVel[k * 3 + 2] = Math.cos(ph) * sp * 0.5;
    pLife[k] = 1; pSize[k] = rand(0.05, 0.15) * (0.6 + r * 0.4);
  }
}
function stepParticles(dt) {
  for (let i = 0; i < P_MAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt * 1.1;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pVel[i * 3] *= 0.97;
    pVel[i * 3 + 1] = pVel[i * 3 + 1] * 0.97 + 0.3 * dt;
    pVel[i * 3 + 2] *= 0.97;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.aLife.needsUpdate = true;
  pGeo.attributes.aSize.needsUpdate = true;
}

/* ------------------------------- pointer --------------------------------- */
const pointer = new THREE.Vector2(-10, -10);
const pointerWorld = new THREE.Vector3(999, 999, 0);
const pointerPrev = new THREE.Vector3(999, 999, 0);
const pointerVel = new THREE.Vector3();
let pointerActive = false, dragging = null, dragDist = 0;
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

const cursorEl = document.createElement('div');
cursorEl.id = 'cursor';
document.body.appendChild(cursorEl);

function toWorld(z = 0) {
  raycaster.setFromCamera(pointer, camera);
  dragPlane.constant = -z;
  raycaster.ray.intersectPlane(dragPlane, hitPoint);
  return hitPoint;
}
function hitBubble() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(bubbles.map((b) => b.mesh), false);
  return hits.length ? { b: hits[0].object.userData.bubble, p: hits[0].point } : null;
}

function onMove(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerActive = true;
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
}
window.addEventListener('pointermove', onMove, { passive: true });
window.addEventListener('pointerleave', () => { pointerActive = false; });
window.addEventListener('blur', () => { pointerActive = false; releaseDrag(); });

canvas.addEventListener('pointerdown', (e) => {
  dragDist = 0;
  canvas.setPointerCapture?.(e.pointerId);
  onMove(e);
  const hit = hitBubble();
  if (hit) {
    dragging = hit.b;
    dragging.grabbed = true;
    dragging.grabOffset.copy(dragging.mesh.position).sub(toWorld(dragging.mesh.position.z));
    cursorEl.classList.add('grab');
    unlockAudio();
  }
});
canvas.addEventListener('pointerup', () => {
  const wasDragging = dragging;
  releaseDrag();
  if (dragDist < 0.2) {                    // a tap, not a throw -> pop it
    const b = wasDragging || hitBubble()?.b;
    if (b) b.pop();
  }
});
canvas.addEventListener('pointercancel', releaseDrag);
canvas.addEventListener('dblclick', () => { const h = hitBubble(); if (h) h.b.pop(); });
canvas.addEventListener('contextmenu', (e) => { const h = hitBubble(); if (h) { e.preventDefault(); h.b.pop(); } });

function releaseDrag() {
  if (dragging) {
    dragging.grabbed = false;
    dragging.vel.copy(pointerVel).multiplyScalar(1.2).clampLength(0, CFG.maxSpeed * 1.6);
    dragging.sqV -= 1.0;                    // let go -> boing
    dragging = null;
  }
  cursorEl.classList.remove('grab');
}

/* ------------------------- sound (soft, on click) ------------------------ */
let audioCtx = null;
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  audioCtx?.resume?.();
}
function blip() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(rand(480, 820), t);
  o.frequency.exponentialRampToValueAtTime(rand(110, 190), t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t + 0.17);
}

/* ------------------------------- resize ---------------------------------- */
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  pMat.uniforms.uPR.value = renderer.getPixelRatio();
  cMat.uniforms.uPR.value = renderer.getPixelRatio();
  updateBounds();
}
addEventListener('resize', resize);

/* --------------------------------- loop ---------------------------------- */
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;

  if (pointerActive) {
    const wp = toWorld(0);
    pointerVel.copy(wp).sub(pointerPrev).divideScalar(Math.max(dt, 0.001)).multiplyScalar(0.18)
      .lerp(pointerVel, 0.5);
    if (pointerVel.length() > 0.55 && Math.random() < 0.45) emitTrail(wp.x, wp.y);
    pointerPrev.copy(wp);
    pointerWorld.copy(wp);
  } else {
    pointerWorld.set(9999, 9999, 0);
    pointerVel.multiplyScalar(0.9);
  }

  const hover = pointerActive ? hitBubble()?.b : null;
  const hw = bounds.w / 2, hh = bounds.h / 2;

  for (const b of bubbles) {
    const p = b.mesh.position;

    if (b.grabbed) {
      /* ---- dragging: spring toward the cursor so it lags and wobbles --- */
      tmpA.copy(toWorld(p.z)).add(b.grabOffset).sub(p);
      dragDist += tmpA.length();
      b.vel.copy(tmpA).multiplyScalar(0.40 / Math.max(dt, 0.001)).clampLength(0, 30);
      p.addScaledVector(b.vel, dt);
      b.grab = Math.min(1, b.grab + dt * 5);
    } else {
      b.grab = Math.max(0, b.grab - dt * 3.5);

      /* ---- drift: wander the heading, hold a steady cruising speed ----- */
      b.wander += dt * 0.55;
      const seed = b.mat.uniforms.uSeed.value;
      b.vel.x += Math.sin(b.wander * 1.31 + seed * 21.7) * CFG.drift * dt;
      b.vel.y += Math.cos(b.wander * 0.91 + seed * 11.3) * CFG.drift * dt;
      b.vel.z += Math.sin(b.wander * 0.61 + seed * 7.1) * 0.20 * dt;
      const sp = b.vel.length();
      if (sp > 0.001) b.vel.multiplyScalar(1 + (b.cruise - sp) / sp * Math.min(1, dt * 0.6));

      /* ---- cursor shove ----------------------------------------------- */
      if (pointerActive) {
        tmpA.copy(p).sub(pointerWorld); tmpA.z *= 0.3;
        const d = tmpA.length();
        const reach = CFG.pushRadius + b.r;
        if (d < reach) {
          const f = (1 - d / reach) ** 2;
          tmpA.normalize();
          b.vel.addScaledVector(tmpA, (f * CFG.push * 22 * dt) / (0.5 + b.r * 0.7));
          b.vel.addScaledVector(pointerVel, f * dt * 2.2);
          b.axis.lerp(tmpA, Math.min(1, dt * 5)).normalize();
          b.sqV -= f * dt * 5.5;
        }
      }

      b.vel.multiplyScalar(CFG.damping);
      b.vel.clampLength(0, CFG.maxSpeed);
      p.addScaledVector(b.vel, dt);
    }

    /* ---- bouncy walls (they squash on contact) ----------------------- */
    if (!b.grabbed && b.popT < 0) {
      if (p.x > hw - b.r)  { p.x = hw - b.r;  if (b.vel.x > 0) { b.impact(tmpN.set(1, 0, 0), Math.abs(b.vel.x)); b.vel.x *= -CFG.bounce; } }
      if (p.x < -hw + b.r) { p.x = -hw + b.r; if (b.vel.x < 0) { b.impact(tmpN.set(1, 0, 0), Math.abs(b.vel.x)); b.vel.x *= -CFG.bounce; } }
      if (p.y > hh - b.r)  { p.y = hh - b.r;  if (b.vel.y > 0) { b.impact(tmpN.set(0, 1, 0), Math.abs(b.vel.y)); b.vel.y *= -CFG.bounce; } }
      if (p.y < -hh + b.r) { p.y = -hh + b.r; if (b.vel.y < 0) { b.impact(tmpN.set(0, 1, 0), Math.abs(b.vel.y)); b.vel.y *= -CFG.bounce; } }
    }
    if (p.z > 1.5)  { p.z = 1.5;  b.vel.z *= -0.5; }
    if (p.z < -2.2) { p.z = -2.2; b.vel.z *= -0.5; }

    /* ---- pop --------------------------------------------------------- */
    if (b.popT >= 0) {
      b.popT += dt;
      b.mat.uniforms.uPop.value = Math.min(1, b.popT / 0.3);
      if (b.popT > 0.32) b.reset(false);
    }

    /* ---- jiggle spring: the thing that makes them feel alive ---------- */
    const stretch = THREE.MathUtils.clamp(b.vel.dot(b.axis) * CFG.stretchPerSpeed, -0.18, 0.22);
    b.sqV += (-CFG.springK * b.sq - CFG.springC * b.sqV) * dt;
    b.sq += b.sqV * dt;
    b.sq = THREE.MathUtils.clamp(b.sq, -CFG.maxSquash, CFG.maxSquash);
    if (!b.grabbed && b.vel.lengthSq() > 0.04) {
      tmpA.copy(b.vel).normalize();
      b.axis.lerp(tmpA, Math.min(1, dt * 1.4)).normalize();   // ease back to travel dir
    }

    /* ---- uniforms ----------------------------------------------------- */
    const u = b.mat.uniforms;
    u.uTime.value = t;
    u.uRoll.value = b.roll0 + 0.20 * Math.sin(t * b.rollV + b.mat.uniforms.uSeed.value * 6.28)
                  + b.vel.x * 0.035;
    u.uSquash.value += (b.sq + stretch - u.uSquash.value) * Math.min(1, dt * 20);
    u.uAxis.value.copy(b.axis);

    let push = 0;
    if (pointerActive) {
      tmpB.copy(pointerWorld).sub(p).divideScalar(b.r);
      const d = tmpB.length();
      push = Math.max(0, 1 - Math.max(0, d - 1) / (CFG.pushRadius / b.r));
      push = push * push * (b.grabbed ? 0.3 : 1);
      u.uPointer.value.copy(tmpB);
    }
    b.push += (push - b.push) * Math.min(1, dt * 11);
    u.uPush.value = b.push * 0.9;

    b.hover += ((hover === b ? 1 : 0) - b.hover) * Math.min(1, dt * 7);
    u.uHover.value = b.hover;
    u.uGrab.value = b.grab;
  }

  /* ---- bubble ↔ bubble: bouncy, and both of them wobble -------------- */
  for (let i = 0; i < bubbles.length; i++) {
    const a = bubbles[i];
    for (let j = i + 1; j < bubbles.length; j++) {
      const c = bubbles[j];
      if (a.popT >= 0 || c.popT >= 0) continue;
      tmpA.copy(a.mesh.position).sub(c.mesh.position);
      const min = a.r + c.r;
      const d2 = tmpA.lengthSq();
      if (d2 > min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      tmpA.divideScalar(d);
      const overlap = min - d;
      const wa = a.grabbed ? 0 : c.grabbed ? 1 : c.r / min;
      const wc = a.grabbed ? 1 : c.grabbed ? 0 : a.r / min;
      a.mesh.position.addScaledVector(tmpA, overlap * wa);
      c.mesh.position.addScaledVector(tmpA, -overlap * wc);
      const rel = tmpB.copy(a.vel).sub(c.vel).dot(tmpA);
      if (rel < 0) {
        const imp = -rel * (1 + CFG.bounce);
        if (!a.grabbed) a.vel.addScaledVector(tmpA, imp * wa);
        if (!c.grabbed) c.vel.addScaledVector(tmpA, -imp * wc);
        a.impact(tmpN.copy(tmpA), -rel * 0.55);
        c.impact(tmpN.copy(tmpA).negate(), -rel * 0.55);
      }
    }
  }

  stepParticles(dt);
  stepConfetti(dt, t);
  stepFaceShow(dt, t);
  renderer.render(scene, camera);
}

/* --------------------------------- boot ---------------------------------- */
(async function boot() {
  resize();
  seedConfetti();
  IMAGES = await loadImageList();
  IMAGES.slice(0, 14).forEach(getTexture);
  setCount(targetCount());
  initFaceShow();
  tick();
  window.__PRANSHUL = { CFG, bubbles, setCount, camera, screenOf,
    show: { faceConfetti, conga, moons, trail, comet: () => comet, peeker: () => peeker, launchComet } };
})();

/** world position of a bubble in css pixels — handy for debugging / tests */
function screenOf(b) {
  const v = b.mesh.position.clone().project(camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, r: b.r };
}
