// morph/pen-worker.js — the "write something in my hand" box on /morph.
//
// The guestbook's pen (visitors/hand-core.js, visitors/hand-checks.js and the
// same weights, visitors/hand-v1.bin), with one difference from
// visitors/hand-worker.js: the page's "legibility" slider picks how neat the
// first attempts are. The guestbook's own ladder of neatness follows, so a
// messy setting that won't come out still ends in something written.
//
// Same messages as hand-worker.js: the page sends { type: 'load', url } and
// { type: 'write', id, text, neat, url }; this sends back 'ready', 'ink'
// (points as the pen moves), 'again' (an attempt thrown away), 'done' (the
// cleaned-up strokes), 'typed' (a script the pen can't write), 'fail', 'error'.

importScripts('/visitors/hand-core.js', '/visitors/hand-checks.js');

const LADDER = HandChecks.CFG.ladder.slice();
let model = null, net = null, loading = null;
let current = 0;   // the id being written; a newer request cancels an older one

function load(url) {
  if (!loading) {
    loading = fetch(url)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((buf) => { model = HandCore.parse(buf); net = HandCore.Network(model); HandChecks.warmUp(HandCore, model, net); });
  }
  return loading;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function write(id, text, neat) {
  if (!HandChecks.writable(text)) { postMessage({ type: 'typed', id }); return; }
  const n = Math.max(0.15, Math.min(2.5, Number(neat) || 1));
  HandChecks.CFG.ladder = [n, n, n, n].concat(LADDER);
  let batch = [], batchAttempt = 0, steps = 0;
  const flush = () => { if (batch.length) postMessage({ type: 'ink', id, attempt: batchAttempt, pts: batch }); batch = []; };
  const r = await HandChecks.writeName(HandCore, model, net, text, {
    onPoint(x, y, up, attempt) {
      if (attempt !== batchAttempt) { flush(); batchAttempt = attempt; }
      batch.push([x, y, up]);
      if (++steps % 8 === 0) flush();
    },
    onAgain() { flush(); postMessage({ type: 'again', id }); },
    pause: tick,
    cancelled: () => id !== current,
  });
  if (!r) return;
  flush();
  if (!r.strokes) { postMessage({ type: 'fail', id }); return; }
  postMessage({ type: 'done', id, strokes: r.strokes });
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    try { await load(m.url); postMessage({ type: 'ready' }); }
    catch (err) { loading = null; postMessage({ type: 'error', message: String(err) }); }
  } else if (m.type === 'write') {
    current = m.id;
    try { await load(m.url); await write(m.id, m.text, m.neat); }
    catch (err) { if (!model) loading = null; postMessage({ type: 'error', id: m.id, message: String(err) }); }
  }
};
