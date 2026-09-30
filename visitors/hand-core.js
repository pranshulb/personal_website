// hand-core.js — handwriting synthesis in plain JavaScript, no libraries.
//
// A recurrent network that writes text the way a hand does, one small pen
// movement at a time (Alex Graves, "Generating Sequences With Recurrent Neural
// Networks", 2013). The trained weights are X-rayLaser's
// pytorch-handwriting-synthesis-toolkit (MIT licence), packed by pack.py into
// hand.bin: the big matrices as 8-bit numbers with one scale per row.
//
// Runs in a Web Worker (see hand-worker.js) and in Node for the tests.

const HandCore = (() => {
  // ---- weights ----

  function parse(buffer) {
    const dv = new DataView(buffer);
    const headerLen = dv.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen)));
    const base = 4 + headerLen;
    const W = {};
    for (const t of header.tensors) {
      const n = t.shape.reduce((a, b) => a * b, 1);
      const out = new Float32Array(n);
      if (t.dtype === 'f32') {
        out.set(new Float32Array(buffer, base + t.offset, n));
      } else {
        const rows = t.shape[0], cols = t.shape[1];
        const scale = new Float32Array(buffer, base + t.offset, rows);
        const q = new Int8Array(buffer, base + t.offset + t.scaleBytes, n);
        for (let r = 0; r < rows; r++) {
          const s = scale[r], o = r * cols;
          for (let c = 0; c < cols; c++) out[o + c] = q[o + c] * s;
        }
      }
      W[t.name] = { data: out, shape: t.shape };
    }
    return { W, charset: header.charset, mu: header.mu, sd: header.sd };
  }

  // out[r] = rows[r] · v (+ b[r]); rows stored one output unit per row
  function matvec(rows, nOut, nIn, v, out, b) {
    for (let r = 0; r < nOut; r++) {
      let o = r * nIn, s0 = 0, s1 = 0, s2 = 0, s3 = 0, j = 0;
      const end = nIn - 3;
      for (; j < end; j += 4) {
        s0 += rows[o + j] * v[j];
        s1 += rows[o + j + 1] * v[j + 1];
        s2 += rows[o + j + 2] * v[j + 2];
        s3 += rows[o + j + 3] * v[j + 3];
      }
      let s = s0 + s1 + s2 + s3;
      for (; j < nIn; j++) s += rows[o + j] * v[j];
      out[r] = b ? s + b[r] : s;
    }
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // ---- the network ----

  function Network(model) {
    const W = model.W;
    const H = 400, A = 80, K = 10, M = 20;
    const g = (n) => W[n].data;
    const L = [1, 2, 3].map((i) => ({
      Wxh: g(`lstm${i}.W_xh`), nIn: W[`lstm${i}.W_xh`].shape[1],
      Wci: g(`lstm${i}.W_ci`), bi: g(`lstm${i}.b_i`), Wcf: g(`lstm${i}.W_cf`), bf: g(`lstm${i}.b_f`),
      bc: g(`lstm${i}.b_c`), Wco: g(`lstm${i}.W_co`), bo: g(`lstm${i}.b_o`),
    }));
    const z = new Float32Array(4 * H);
    const inBuf = new Float32Array(3 + H + A + H);
    const winOut = new Float32Array(K);
    const hh = new Float32Array(3 * H);
    const mix = {
      pi: new Float32Array(M), mu: new Float32Array(2 * M), sd: new Float32Array(2 * M),
      ro: new Float32Array(M), eos: new Float32Array(1),
    };

    function lstm(layer, input, nIn, h, c) {
      matvec(layer.Wxh, 4 * H, nIn, input, z);
      for (let u = 0; u < H; u++) {
        const i = sigmoid(z[u] + c[u] * layer.Wci[u] + layer.bi[u]);
        const f = sigmoid(z[H + u] + c[u] * layer.Wcf[u] + layer.bf[u]);
        const cu = f * c[u] + i * Math.tanh(z[2 * H + u] + layer.bc[u]);
        const o = sigmoid(z[3 * H + u] + cu * layer.Wco[u] + layer.bo[u]);
        c[u] = cu;
        h[u] = o * Math.tanh(cu);
      }
    }

    function initState() {
      return {
        w: new Float32Array(A), k: new Float32Array(K),
        h1: new Float32Array(H), c1: new Float32Array(H),
        h2: new Float32Array(H), c2: new Float32Array(H),
        h3: new Float32Array(H), c3: new Float32Array(H),
      };
    }

    // One step: pen offset x (dx, dy, penUp) in, next-pen distribution out.
    // codes: the text as character indices; phi receives the attention over them.
    function step(x, codes, st, bias, phi) {
      const U = codes.length;
      inBuf[0] = x[0]; inBuf[1] = x[1]; inBuf[2] = x[2];
      inBuf.set(st.w, 3); inBuf.set(st.h1, 3 + A);
      lstm(L[0], inBuf, 3 + A + H, st.h1, st.c1);

      // the soft window: which letter the pen is on
      matvec(g('window.alpha.weight'), K, H, st.h1, winOut, g('window.alpha.bias'));
      const alpha = Array.from(winOut, Math.exp);
      matvec(g('window.beta.weight'), K, H, st.h1, winOut, g('window.beta.bias'));
      const beta = Array.from(winOut, Math.exp);
      matvec(g('window.k.weight'), K, H, st.h1, winOut, g('window.k.bias'));
      for (let j = 0; j < K; j++) st.k[j] += Math.exp(winOut[j]);
      st.w.fill(0);
      for (let u = 0; u < U; u++) {
        let p = 0;
        for (let j = 0; j < K; j++) { const d = st.k[j] - u; p += alpha[j] * Math.exp(-beta[j] * d * d); }
        phi[u] = p;
        st.w[codes[u]] += p;
      }

      // layers 2 and 3 see [pen, layer below, window, their own previous output]
      inBuf[0] = x[0]; inBuf[1] = x[1]; inBuf[2] = x[2];
      inBuf.set(st.h1, 3); inBuf.set(st.w, 3 + H); inBuf.set(st.h2, 3 + H + A);
      lstm(L[1], inBuf, 3 + H + A + H, st.h2, st.c2);
      inBuf.set(st.h2, 3); inBuf.set(st.h3, 3 + H + A);
      lstm(L[2], inBuf, 3 + H + A + H, st.h3, st.c3);

      hh.set(st.h1, 0); hh.set(st.h2, H); hh.set(st.h3, 2 * H);
      matvec(g('mixture.pi.weight'), M, 3 * H, hh, mix.pi, g('mixture.pi.bias'));
      let mx = -Infinity;
      for (let j = 0; j < M; j++) { mix.pi[j] *= 1 + bias; if (mix.pi[j] > mx) mx = mix.pi[j]; }
      let sum = 0;
      for (let j = 0; j < M; j++) { mix.pi[j] = Math.exp(mix.pi[j] - mx); sum += mix.pi[j]; }
      for (let j = 0; j < M; j++) mix.pi[j] /= sum;
      matvec(g('mixture.mu.weight'), 2 * M, 3 * H, hh, mix.mu, g('mixture.mu.bias'));
      matvec(g('mixture.sd.weight'), 2 * M, 3 * H, hh, mix.sd, g('mixture.sd.bias'));
      for (let j = 0; j < 2 * M; j++) mix.sd[j] = Math.exp(mix.sd[j] - bias);
      matvec(g('mixture.ro.weight'), M, 3 * H, hh, mix.ro, g('mixture.ro.bias'));
      for (let j = 0; j < M; j++) mix.ro[j] = Math.tanh(mix.ro[j]);
      matvec(g('mixture.eos.weight'), 1, 3 * H, hh, mix.eos, g('mixture.eos.bias'));
      mix.eos[0] = sigmoid(mix.eos[0]);
      return mix;
    }

    return { step, initState };
  }

  // ---- sampling ----

  // small seeded generator, so a signature can be reproduced in tests
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function samplePoint(mix, rand) {
    const M = mix.pi.length;
    let r = rand(), j = 0;
    for (; j < M - 1; j++) { r -= mix.pi[j]; if (r <= 0) break; }
    const u1 = Math.max(rand(), 1e-12), u2 = rand();
    const n1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const n2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    const s1 = mix.sd[j], s2 = mix.sd[M + j], ro = mix.ro[j];
    const dx = mix.mu[j] + s1 * n1;
    const dy = mix.mu[M + j] + s2 * (ro * n1 + Math.sqrt(Math.max(0, 1 - ro * ro)) * n2);
    return [dx, dy, mix.eos[0] > 0.5 ? 1 : 0];
  }

  function encode(model, text) {
    const map = new Map();
    for (let i = 0; i < model.charset.length; i++) map.set(model.charset[i], i + 1);
    return Array.from(text, (ch) => map.get(ch) || 0);
  }

  function copyState(s) { const o = {}; for (const k in s) o[k] = Float32Array.from(s[k]); return o; }

  // Walks the network through a sample of handwriting (prime.offs: its pen
  // offsets, already normalised) and returns where that leaves it. A name
  // written after it (write's opts.primed) is written in the same hand, as
  // the sample's continuation. Done once; every name starts from a copy.
  function primeState(model, net, prime) {
    const codes = encode(model, prime.text + '  ');
    const st = net.initState(), phi = new Float32Array(codes.length);
    let x = [0, 0, 1];
    for (const o of prime.offs) { net.step(x, codes, st, 0, phi); x = o; }
    return { text: prime.text, st, x };
  }

  // Writes `text`. Pads it with two spaces so the pen can "read past" the last
  // letter: the model has finished when its attention sits beyond the text and
  // the pen is lifted. Returns absolute points [x, y, penUp, letter] (letter:
  // which letter of `text` the pen's attention was on), the attention path,
  // which the checks use to spot skipped letters and scribbles, and why it
  // stopped.
  //
  // opts.primed (from primeState) writes `text` as the continuation of a
  // sample, in that hand; only the continuation is returned.
  function write(model, net, text, opts = {}) {
    const bias = opts.bias ?? 2;
    const rand = opts.rand || rng(opts.seed ?? (Math.random() * 2 ** 32));
    const maxPerChar = opts.maxPerChar ?? 40;
    const primed = opts.primed;
    const start = primed ? primed.text.length + 1 : 0;
    const codes = encode(model, (primed ? primed.text + ' ' : '') + text + '  ');
    const U = text.length;
    const st = primed ? copyState(primed.st) : net.initState();
    const phi = new Float32Array(codes.length);
    // The pen starts lifted, as every sample the network learned from did.
    // It used to start down, as if in the middle of a stroke: the network
    // drew a line from nowhere and lost its place, and a name beginning with
    // E never came out at all (0 of 8; A 1, L 1, Y 2, W 4).
    let x = primed ? primed.x.slice() : [0, 0, 1], X = 0, Y = 0, done = false, begun = !primed;
    const pts = [], path = [];
    const limit = maxPerChar * U + 60;
    // a pen that has lost its way stays on one letter, or past the end without
    // lifting, for far longer than a clean one ever does: stop it early
    const maxDwell = opts.maxDwell ?? Infinity, maxAfterEnd = opts.maxAfterEnd ?? Infinity;
    let dwell = 0, afterEnd = 0, stop = 'limit';
    for (let t = 0; t < limit; t++) {
      const mix = net.step(x, codes, st, bias, phi);
      x = samplePoint(mix, rand);
      let a = 0;
      for (let u = 1; u < codes.length; u++) if (phi[u] > phi[a]) a = u;
      a -= start;
      if (!begun) { if (a < 0) continue; begun = true; }   // still finishing the prime
      dwell = path.length && a === path[path.length - 1] ? dwell + 1 : 1;
      if (a >= U) afterEnd++;
      path.push(a);
      X += x[0] * model.sd[0] + model.mu[0];
      Y += x[1] * model.sd[1] + model.mu[1];
      pts.push([X, Y, x[2], a]);
      if (opts.onPoint) opts.onPoint(X, Y, x[2]);
      if (a >= U && x[2]) { done = true; stop = 'done'; break; }
      if (dwell > maxDwell) { stop = 'stuck'; break; }
      if (afterEnd > maxAfterEnd) { stop = 'ran on'; break; }
    }
    return { pts, path, done, stop };
  }

  return { parse, Network, write, primeState, rng, encode, matvec };
})();

if (typeof module !== 'undefined') module.exports = HandCore;
