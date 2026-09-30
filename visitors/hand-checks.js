// hand-checks.js — what makes a handwritten name come out clean.
//
// The network on its own is glitchy the way calligrapher.ai is: it loses its
// place and skips or doubles a letter, trails off into a scribble, or never
// lifts the pen at the end. Measured on 816 samples read back with a
// handwriting recogniser (TrOCR), letters only:
//   - the original demo's way of stopping: 38-49% of samples garbled
//   - stopping when the pen's attention has passed the last letter and the
//     pen is up (hand-core.js): 12-15% garbled
//   - plus throwing away attempts that fail check() and writing them again:
//     0% of phrases and 3% of single short words garbled at bias 1
// The checks: the pen must finish, dwell on every letter for a few steps,
// make each letter a letter's width, and not wander (too many steps per
// letter is a scribble). Writing word by word was tried and was no better
// than whole names, which also keep one hand across the words.
//
// Then, the whole thing in JavaScript on 30 real names x 4 (September 2026):
//   - 8-bit weights write as well as full precision (letter error 9.6% vs 9.0%)
//   - neatness (bias) 2 is cleaner but gets stuck on some names (Zoe,
//     Lukasz, Jean-Luc: the pen never lifts) and gave up on 8-12% of names
//   - the ladder below, neat first and looser when a name won't come out:
//     letter error 6.9% (bias 1 alone: 9.6%), gave up on 2 of 120.
//     What's left is mostly rare capitals (Z, K, M) — "write it again".
//
// Then "if someone writes capital letters or multiple words it becomes very
// jangled" (Pranshul, September 2026). Measured the same way (TrOCR, and by
// eye on contact sheets), on 40 + 30 names chosen for it and 30 kept back:
//   - the pen started every name as if it were already on the paper
//     (hand-core.js): a line from nowhere, then lost. A name beginning with
//     E never came out (0 of 8), A, L, Y, W rarely. Now it starts lifted.
//   - the first letter of a name, with nothing written before it, was the
//     network's worst ("Hiro" -> "tiro", E like k, K like &, B like 3). So
//     every name is written as the continuation of a warm-up sample (PRIME),
//     which also puts every name in one steady hand, one size across words.
//   - ALL-CAPS names are written with a capital to each word (handCase).
//   - words the network ran together are spaced (spaceWords); stray marks
//     past the end dropped (trimStrays).
//   - the pace limit is set for the warm-up's hand (maxStepsPerLetter).
//     Picking the fastest of several attempts, or judging each letter's
//     time against its usual, did no better than taking the first good one.
//   On the 30 names kept back, 3 times each, old -> new: letters wrong 6.6%
//   -> 2.4%, read exactly 63/88 -> 77/90, gave up 2 -> 0, attempts 2.5 ->
//   1.0, 5.0s -> 2.0s. Still weak: a capital Z or X (the network barely
//   knows them) and sometimes L.

const HandChecks = (() => {
  const CFG = {
    // neatness, one per attempt: neat first, looser when a name won't come out
    ladder: [2, 2, 2, 1.5, 1.5, 1, 1, 1, 0.5, 0.5],
    minSteps: 6,            // every letter holds the pen's attention for at least this many steps
    minWidthPerLetter: 80,  // network units; garbled attempts averaged 47, clean ones 160
    // Pace, in pen steps per letter. In the warm-up's hand (PRIME) clean
    // attempts ran at 30 (median), up to 38; slower than 36, 13% of letters
    // came out wrong, against 4.5%. Plus a little for each space and for
    // starting and finishing, or a short name could never pass ("Sam"
    // failed ten times over).
    maxStepsPerLetter: 36,
    stepsPerSpace: 20,
    stepsToStartAndFinish: 40,
    maxPerChar: 60,         // the pen's whole budget per character
    // Give up on an attempt early (hand-core.js): clean warmed-up attempts
    // held one letter for up to 114 steps; stuck ones sit for 200 and more.
    maxDwell: 130,
    maxAfterEnd: 120,
    scale: 0.25,            // saved signatures are in quarter units: a line is ~125 tall
    // gaps between words, network units: run-together words are pushed
    // apart, far-flung ones brought in, anything between left as written
    minWordGap: 70,
    maxWordGap: 260,
  };

  // ASCII the network knows; anything else is folded (é → e) or dropped.
  const CHARSET = " !\"#%'()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[abcdefghijklmnopqrstuvwxyz";
  // letters that don't come apart into base + accent
  const LATIN = { 'Ł': 'L', 'ł': 'l', 'Ø': 'O', 'ø': 'o', 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe',
    'Đ': 'D', 'đ': 'd', 'Þ': 'Th', 'þ': 'th', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h', '&': ' and ',
    '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-' };
  function fold(text) {
    return Array.from(text.normalize('NFKD').replace(/[̀-ͯ]/g, ''))
      .map((ch) => (CHARSET.includes(ch) ? ch : (LATIN[ch] ?? ' ')))
      .join('').replace(/\s+/g, ' ').trim();
  }
  // true when the network can write the name (nearly all of its letters)
  function writable(text) {
    const letters = Array.from(text).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
    const kept = Array.from(fold(text)).filter((ch) => /[A-Za-z0-9]/.test(ch)).length;
    return letters > 0 && kept >= Math.ceil(letters * 0.8);
  }
  // A name typed all in capitals is written with a capital to each word
  // (JOHN SMITH -> John Smith): the network learned from ordinary writing
  // and all-capital names came out as scribbles (ZOE KRAVITZ read back as
  // "tube KRAVMs"). What was typed is still what the book keeps as the name.
  function handCase(text) {
    if (/[a-z]/.test(text) || !/[A-Z]{2}/.test(text)) return text;
    return text.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  // what the pen writes for a name
  function penText(name) { return fold(handCase(name)); }

  // '' when an attempt is good enough, else why not
  function check(text, out) {
    const { pts, path, done } = out;
    const U = text.length;
    if (!done) return 'never finished';
    const counts = new Array(U).fill(0);
    for (const a of path) if (a < U) counts[a]++;
    for (let i = 0; i < U; i++) if (text[i] !== ' ' && counts[i] < CFG.minSteps) return 'skipped a letter';
    const letters = Math.max(1, text.replace(/ /g, '').length), spaces = text.length - letters;
    if (pts.length > CFG.maxStepsPerLetter * letters + CFG.stepsPerSpace * spaces + CFG.stepsToStartAndFinish) return 'scribbled';
    let minX = Infinity, maxX = -Infinity;
    for (const [x] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if ((maxX - minX) / letters < CFG.minWidthPerLetter) return 'squashed';
    return '';
  }

  // points -> strokes (a stroke ends where the pen lifts)
  function strokesOf(pts) {
    const strokes = []; let cur = [];
    for (const p of pts) { cur.push(p); if (p[2]) { strokes.push(cur); cur = []; } }
    if (cur.length) strokes.push(cur);
    return strokes;
  }
  const extent = (s) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const q of s) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); }
    return [a, b, c, d];
  };
  const SMALL = 40;   // a stroke smaller than this (network units) is a dot or a cross

  // Strokes begun after the pen's attention had passed the last letter: an
  // i's dot or a t's cross belongs (it sits over the name); one further right
  // is a stray mark ("JOHN SMITH l", "Gonzzae -").
  function trimStrays(strokes, U) {
    let maxX = -Infinity;
    for (const s of strokes) if (s[0][3] === undefined || s[0][3] < U) maxX = Math.max(maxX, extent(s)[1]);
    return strokes.filter((s) => s[0][3] === undefined || s[0][3] < U || extent(s)[0] < maxX - 10);
  }

  // Evens out the gaps between words: the network sometimes leaves no space
  // at all ("KenjiWatanabe", "JohnSmith"). Each point knows the letter the
  // pen was on; a point on a space counts with the word the stroke goes on to
  // (the pen often starts a word's first letter while still on the space:
  // counting that with the word before tore capitals in two, "Yusuf Ithan",
  // "Marco 1 Polo"). A stroke is cut where it runs on from one word into the
  // next, and each piece goes with the word most of it was written on. Dots,
  // crosses, and anything written past the end go with the word they sit
  // over, or failing that the nearest. Gaps under minWordGap or over
  // maxWordGap are brought to that; the rest are left as written.
  function spaceWords(strokes, text) {
    const wordOf = []; let w = 0;
    for (let i = 0; i < text.length; i++) { wordOf.push(text[i] === ' ' ? -1 : w); if (text[i] === ' ' && text[i + 1] && text[i + 1] !== ' ') w++; }
    const n = w + 1;
    if (n < 2) return strokes;
    // each point's word, spaces filled from what follows in the stroke
    const pieces = [];
    for (const s of strokes) {
      const ws = s.map((q) => (q[3] >= 0 && q[3] < text.length ? wordOf[q[3]] : -1));
      let next = -1;
      for (let i = ws.length - 1; i >= 0; i--) { if (ws[i] >= 0) next = ws[i]; else ws[i] = next; }
      let prev = -1;
      for (let i = 0; i < ws.length; i++) { if (ws[i] >= 0) prev = ws[i]; else ws[i] = prev; }
      let start = 0;
      for (let i = 1; i <= s.length; i++) {
        if (i === s.length || ws[i] !== ws[i - 1]) {
          const piece = s.slice(start, i);
          if (i < s.length) piece[piece.length - 1] = [piece[piece.length - 1][0], piece[piece.length - 1][1], 1, piece[piece.length - 1][3]];
          pieces.push({ s: piece, w: ws[start] });
          start = i;
        }
      }
    }
    for (const k of pieces) { k.e = extent(k.s); if (Math.max(k.e[1] - k.e[0], k.e[3] - k.e[2]) < SMALL) k.w = -1; }
    const range = Array.from({ length: n }, () => [Infinity, -Infinity]);
    for (const k of pieces) if (k.w >= 0) { range[k.w][0] = Math.min(range[k.w][0], k.e[0]); range[k.w][1] = Math.max(range[k.w][1], k.e[1]); }
    if (range.some((r) => r[0] === Infinity)) return strokes;   // a word with no letter of its own: leave it be
    for (const k of pieces) if (k.w < 0) {
      const cx = (k.e[0] + k.e[1]) / 2;
      let best = 0, bd = Infinity;
      range.forEach((r, j) => { const d = cx < r[0] ? r[0] - cx : cx > r[1] ? cx - r[1] : 0; if (d < bd) { bd = d; best = j; } });
      k.w = best;
    }
    const shift = new Array(n).fill(0);
    let right = range[0][1];
    for (let j = 1; j < n; j++) {
      const gap = range[j][0] - range[j - 1][1];
      shift[j] = right + Math.min(CFG.maxWordGap, Math.max(CFG.minWordGap, gap)) - range[j][0];
      right = Math.max(right, range[j][1] + shift[j]);
    }
    return pieces.map((k) => k.s.map((q) => [q[0] + shift[k.w], q[1], q[2], q[3]]));
  }

  // Ramer–Douglas–Peucker: keep the shape, drop points that add nothing
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

  // The pen's points for `text` -> strokes as flat integer arrays
  // [x0, y0, x1, y1, ...], y down (the network's y already points down, like
  // the screen's), starting at 0,0, in saved (quarter) units.
  function layout(pts, text) {
    let strokes = strokesOf(pts);
    strokes = spaceWords(trimStrays(strokes, text.length), text);
    strokes = strokes.map((s) => (s.length > 1 ? s : [s[0], s[0]]));   // a lone point is a dot (the i's)
    let minX = Infinity, minY = Infinity;
    for (const s of strokes) for (const q of s) { minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); }
    return strokes.map((s) => simplify(s.map((q) => [(q[0] - minX) * CFG.scale, (q[1] - minY) * CFG.scale]), 0.8)
      .flatMap(([x, y]) => [Math.round(x + 4), Math.round(y + 4)]));
  }

  // Writes a name: warmed up on PRIME, neat first and looser when it won't
  // come out, each attempt checked and, if it fails, written again. Shared by
  // the page's worker and the tests, so both run exactly this.
  //   hooks.onPoint(x, y, penUp, attempt), hooks.onAgain(why, attempt),
  //   await hooks.pause() between attempts (the worker lets a newer request
  //   in), hooks.cancelled() -> true to stop, hooks.seed(attempt) for tests.
  // Returns { strokes, text, attempts, log } or { strokes: null, ... }.
  let primed = null;
  // the warm-up, done once (the worker does it as soon as the pen has loaded)
  function warmUp(core, model, net) { if (!primed) primed = core.primeState(model, net, PRIME); }
  async function writeName(core, model, net, name, hooks = {}) {
    const text = penText(name);
    warmUp(core, model, net);
    const log = [];
    for (let attempt = 0; attempt < CFG.ladder.length; attempt++) {
      if (hooks.cancelled && hooks.cancelled()) return null;
      const out = core.write(model, net, text, {
        primed, bias: CFG.ladder[attempt], maxPerChar: CFG.maxPerChar, maxDwell: CFG.maxDwell, maxAfterEnd: CFG.maxAfterEnd,
        seed: hooks.seed ? hooks.seed(attempt) : undefined,
        onPoint: hooks.onPoint ? (x, y, up) => hooks.onPoint(x, y, up, attempt) : undefined,
      });
      const why = check(text, out);
      log.push({ bias: CFG.ladder[attempt], why, steps: out.pts.length, stop: out.stop });
      if (!why) return { strokes: layout(out.pts, text), text, attempts: attempt + 1, log };
      if (hooks.onAgain) hooks.onAgain(why, attempt);
      if (hooks.pause) await hooks.pause();
    }
    return { strokes: null, text, attempts: CFG.ladder.length, log };
  }

  // The hand the pen writes in: "Alice Lee Kent", written by the network
  // itself at neatness 2.5. Every name is written as its continuation, so
  // every name is in this one hand, and none starts from a blank page (the
  // first capital of a name, with nothing before it, was the network's worst
  // letter: "Hiro" came out "tiro", "Esther" "kesther"). Chosen from ten
  // samples that read back exactly, by writing 70 names twice after each:
  // letters wrong, one attempt each, 4.0% after this one; 5.3-12% after the
  // others ("Sam Kate Brown" 8.5-12%, "Laura Eve King", "Tom Allen"); 29%
  // with no warm-up at all. Pen offsets, normalised: dx, dy, penUp.
  const PRIME = (() => {
    const v = [2.647,1.679,0,-0.182,-0.019,0,-0.19,-0.12,0,-0.147,-0.39,0,-0.082,-0.611,0,-0.029,-0.75,0,0.013,-0.896,0,0.032,-0.973,0,0.027,-0.983,0,0.009,-0.929,0,-0.003,-0.778,0,-0.045,-0.646,0,-0.083,-0.399,0,-0.149,-0.134,0,-0.208,0.004,0,-0.208,0.059,0,-0.16,0.257,0,-0.137,0.679,0,-0.165,0.848,0,-0.173,1.031,0,-0.183,1.152,0,-0.193,1.151,0,-0.142,0.967,0,-0.104,0.738,0,-0.081,0.443,1,-0.132,-3.22,0,-0.195,0.015,0,-0.201,-0.013,0,-0.169,0.027,0,-0.064,0.033,0,0.023,-0.007,0,0.087,-0.037,0,0.077,-0.046,0,0.068,-0.061,1,1.074,-0.045,0,-0.212,0.055,0,-0.199,0.033,0,-0.189,0.213,0,-0.178,0.414,0,-0.167,0.567,0,-0.196,0.609,0,-0.194,0.589,0,-0.152,0.434,1,0.006,-5.055,0,-0.253,-0.029,0,-0.202,-0.021,0,-0.197,-0.002,0,-0.191,0.02,1,2.92,2.321,0,-0.22,-0.036,0,-0.295,-0.08,0,-0.364,-0.067,0,-0.421,-0.027,0,-0.469,0.071,0,-0.509,0.181,0,-0.511,0.299,0,-0.48,0.385,0,-0.397,0.439,0,-0.283,0.494,0,-0.172,0.436,0,-0.023,0.373,0,0.086,0.245,0,0.211,0.151,0,0.288,0.011,0,0.335,-0.128,1,1.468,-1.086,0,-0.181,0.023,0,-0.162,-0.008,0,-0.11,-0.032,0,-0.024,-0.051,0,0.022,-0.186,0,0.052,-0.267,0,0.048,-0.319,0,-0.006,-0.326,0,-0.085,-0.278,0,-0.176,-0.201,0,-0.263,-0.116,0,-0.346,-0.071,0,-0.413,0.022,0,-0.501,0.125,0,-0.536,0.255,0,-0.52,0.371,0,-0.478,0.424,0,-0.394,0.453,0,-0.268,0.46,0,-0.131,0.391,0,0.011,0.305,0,0.151,0.207,0,0.278,0.102,0,0.356,-0.029,1,7.145,-6.261,0,-0.189,0.055,0,-0.208,0.101,0,-0.198,0.237,0,-0.172,0.403,0,-0.226,0.5,0,-0.238,0.653,0,-0.27,0.744,0,-0.278,0.776,0,-0.285,0.683,0,-0.261,0.58,0,-0.222,0.443,0,-0.196,0.269,0,-0.161,0.109,0,-0.151,0.023,0,-0.15,-0.021,0,-0.068,-0.026,0,-0.03,-0.101,0,0.063,-0.149,0,0.114,-0.133,0,0.151,-0.074,0,0.151,-0.011,0,0.133,-0.007,0,0.114,0.045,0,0.137,0.045,0,0.121,0.004,0,0.109,-0.033,0,0.086,-0.064,0,0.058,-0.084,0,-0.013,-0.115,0,-0.03,-0.139,0,-0.112,-0.175,0,-0.146,-0.223,0,-0.19,-0.248,0,-0.236,-0.257,0,-0.286,-0.234,0,-0.322,-0.189,0,-0.343,-0.12,0,-0.385,-0.082,0,-0.362,0.006,0,-0.359,0.056,0,-0.365,0.11,0,-0.337,0.205,0,-0.314,0.284,0,-0.254,0.378,0,-0.156,0.412,0,-0.083,0.366,0,0.012,0.344,0,0.106,0.266,0,0.189,0.148,0,0.246,0.054,0,0.272,-0.068,0,0.27,-0.17,1,0.718,-0.966,0,-0.177,0.01,0,-0.106,-0.007,0,-0.073,-0.076,0,-0.016,-0.185,0,-0.001,-0.268,0,0.005,-0.307,0,-0.056,-0.316,0,-0.12,-0.268,0,-0.209,-0.184,0,-0.263,-0.083,0,-0.329,-0.028,0,-0.437,0.022,0,-0.474,0.153,0,-0.479,0.265,0,-0.48,0.363,0,-0.416,0.444,0,-0.326,0.444,0,-0.197,0.408,0,-0.033,0.358,0,0.093,0.272,0,0.226,0.154,0,0.33,0.044,0,0.369,-0.106,0,0.406,-0.176,1,5.123,-4.968,0,-0.195,0.037,0,-0.19,0.013,0,-0.199,0.029,0,-0.166,0.124,0,-0.163,0.221,0,-0.15,0.364,0,-0.185,0.511,0,-0.229,0.625,0,-0.25,0.731,0,-0.195,0.723,0,-0.177,0.63,0,-0.144,0.468,0,-0.071,0.365,0,-0.098,0.147,0,-0.079,0.052,0,-0.104,-0.148,1,1.99,-4.711,0,-0.241,-0.004,0,-0.216,0.02,0,-0.218,0.071,0,-0.255,0.136,0,-0.419,0.189,0,-0.471,0.332,0,-0.544,0.377,0,-0.585,0.434,0,-0.574,0.467,0,-0.533,0.415,0,-0.39,0.361,0,-0.268,0.245,0,-0.139,0.196,0,0.006,0.15,0,0.158,0.12,0,0.262,0.034,0,0.302,0.014,0,0.332,-0.062,0,0.33,-0.115,0,0.308,-0.174,1,0.741,0.009,0,-0.157,0.004,0,-0.075,-0.019,0,-0.035,-0.123,0,0.027,-0.249,0,0.055,-0.33,0,0.031,-0.366,0,-0.035,-0.356,0,-0.13,-0.291,0,-0.217,-0.174,0,-0.292,-0.081,0,-0.376,-0.029,0,-0.425,0.049,0,-0.454,0.167,0,-0.455,0.276,0,-0.442,0.374,0,-0.38,0.428,0,-0.286,0.43,0,-0.162,0.394,0,-0.041,0.33,0,0.085,0.249,0,0.177,0.117,0,0.234,-0.012,0,0.259,-0.136,0,0.242,-0.242,1,0.828,-2.142,0,-0.23,0.037,0,-0.21,0.127,0,-0.203,0.254,0,-0.189,0.344,0,-0.192,0.396,0,-0.207,0.383,0,-0.186,0.332,0,-0.168,0.243,0,-0.163,0.097,0,-0.16,0.001,0,-0.162,-0.043,0,-0.148,-0.171,0,-0.113,-0.334,0,-0.09,-0.477,0,-0.033,-0.519,0,0.022,-0.464,0,0.033,-0.348,0,0.035,-0.208,0,0.01,-0.091,0,-0.045,0.005,0,-0.02,0.179,0,-0.095,0.282,0,-0.101,0.444,0,-0.157,0.51,0,-0.194,0.484,0,-0.179,0.445,0,-0.154,0.321,0,-0.115,0.181,1,1.502,-5.419,0,-0.217,0.02,0,-0.194,0.117,0,-0.191,0.278,0,-0.177,0.425,0,-0.189,0.544,0,-0.191,0.635,0,-0.228,0.672,0,-0.192,0.694,0,-0.19,0.607,0,-0.171,0.531,0,-0.161,0.382,0,-0.146,0.225,1,-0.947,-2.07,0,-0.194,-0.002,0,-0.162,-0.006,0,-0.115,0.005,0,0.018,0.031,0,0.086,0.015,0,0.148,-0.008,0,0.178,-0.028,0,0.179,-0.041,1];
    const offs = [];
    for (let i = 0; i < v.length; i += 3) offs.push([v[i], v[i + 1], v[i + 2]]);
    return { text: 'Alice Lee Kent', offs };
  })();

  return { CFG, PRIME, penText, handCase, fold, writable, check, layout, trimStrays, spaceWords, simplify, warmUp, writeName };
})();

if (typeof module !== 'undefined') module.exports = HandChecks;
