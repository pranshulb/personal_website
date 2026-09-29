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

const HandChecks = (() => {
  const CFG = {
    // neatness, one per attempt: neat first, looser when a name won't come out
    ladder: [2, 2, 2, 1.5, 1.5, 1, 1, 1, 0.5, 0.5],
    minSteps: 6,            // every letter holds the pen's attention for at least this many steps
    minWidthPerLetter: 80,  // network units; garbled attempts averaged 47, clean ones 160
    maxStepsPerLetter: 40,  // clean attempts averaged 33; scribbles 47
    // Give up on an attempt early (hand-core.js): clean attempts never held
    // one letter for more than 60 steps nor ran on past the end for more than
    // 74; stuck ones sat on a letter for 150-260. Saves seconds per retry.
    maxDwell: 75,
    maxAfterEnd: 90,
    scale: 0.25,            // saved signatures are in quarter units: a line is ~125 tall
  };

  // ASCII the network knows; anything else is folded (é → e) or dropped.
  const CHARSET = " !\"#%'()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[abcdefghijklmnopqrstuvwxyz";
  // letters that don't come apart into base + accent
  const LATIN = { 'Ł': 'L', 'ł': 'l', 'Ø': 'O', 'ø': 'o', 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe',
    'Đ': 'D', 'đ': 'd', 'Þ': 'Th', 'þ': 'th', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h', '&': ' and ',
    '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-' };
  function fold(text) {
    return Array.from(text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
      .map((ch) => (CHARSET.includes(ch) ? ch : (LATIN[ch] ?? ' ')))
      .join('').replace(/\s+/g, ' ').trim();
  }
  // true when the network can write the name (nearly all of its letters)
  function writable(text) {
    const letters = Array.from(text).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
    const kept = Array.from(fold(text)).filter((ch) => /[A-Za-z0-9]/.test(ch)).length;
    return letters > 0 && kept >= Math.ceil(letters * 0.8);
  }

  function plan(text) {
    return { parts: [fold(text)], ladder: CFG.ladder, attempts: CFG.ladder.length, maxDwell: CFG.maxDwell, maxAfterEnd: CFG.maxAfterEnd };
  }

  function check(text, out) {
    const { pts, path, done } = out;
    const U = text.length;
    if (!done) return 'never finished';
    const counts = new Array(U).fill(0);
    for (const a of path) if (a < U) counts[a]++;
    for (let i = 0; i < U; i++) if (text[i] !== ' ' && counts[i] < CFG.minSteps) return 'skipped a letter';
    const letters = Math.max(1, text.replace(/ /g, '').length);
    if (pts.length > CFG.maxStepsPerLetter * letters) return 'scribbled';
    let minX = Infinity, maxX = -Infinity;
    for (const [x] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if ((maxX - minX) / letters < CFG.minWidthPerLetter) return 'squashed';
    return '';
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

  // words: arrays of [x, y, penUp] in network units (y down). Returns strokes as
  // flat integer arrays [x0, y0, x1, y1, ...], y down, starting at 0,0.
  function layout(words) {
    const strokes = [];
    let cursor = 0;
    const gap = 26;
    for (const pts of words) {
      if (!pts.length) continue;
      let minX = Infinity, maxX = -Infinity;
      for (const [x] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      // each word starts where the network started it (its own baseline), shifted along
      const shift = cursor - minX;
      let cur = [];
      for (const [x, y, up] of pts) {
        cur.push([(x + shift) * CFG.scale, y * CFG.scale]);   // the network's y already points down, like the screen's
        if (up) { strokes.push(cur.length > 1 ? cur : [cur[0], cur[0]]); cur = []; }   // a lone point is a dot (the i's)
      }
      if (cur.length) strokes.push(cur.length > 1 ? cur : [cur[0], cur[0]]);
      cursor += (maxX - minX) + gap / CFG.scale;
    }
    let minX = Infinity, minY = Infinity;
    for (const s of strokes) for (const [x, y] of s) { minX = Math.min(minX, x); minY = Math.min(minY, y); }
    return strokes.map((s) => simplify(s, 0.8)
      .flatMap(([x, y]) => [Math.round(x - minX + 4), Math.round(y - minY + 4)]));
  }

  return { CFG, plan, check, layout, fold, writable, simplify };
})();

if (typeof module !== 'undefined') module.exports = HandChecks;
