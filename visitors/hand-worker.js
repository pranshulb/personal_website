// hand-worker.js — writes names by hand, off the page's main thread.
//
// The page sends { type: 'write', id, text }; this streams back the pen as it
// moves ({ type: 'ink', id, pts }), says when an attempt came out badly and is
// being redone ({ type: 'again', id, why }), and finishes with the strokes
// ({ type: 'done', id, strokes }) or gives up ({ type: 'fail', id }).
//
// The network is in hand-core.js; the checks that throw away bad attempts are
// in hand-checks.js (tuned by reading hundreds of samples back with a
// handwriting recogniser — see the notes there).

importScripts('hand-core.js', 'hand-checks.js');

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

async function write(id, text) {
  // a name in a script the network can't write goes in as typed
  if (!HandChecks.writable(text)) { postMessage({ type: 'typed', id }); return; }
  let batch = [], batchAttempt = 0, steps = 0;
  const flush = () => { if (batch.length) postMessage({ type: 'ink', id, part: 0, attempt: batchAttempt, pts: batch }); batch = []; };
  const r = await HandChecks.writeName(HandCore, model, net, text, {
    onPoint(x, y, up, attempt) {
      if (attempt !== batchAttempt) { flush(); batchAttempt = attempt; }
      batch.push([x, y, up]);
      if (++steps % 8 === 0) flush();
    },
    onAgain(why) { flush(); postMessage({ type: 'again', id, part: 0, why }); },
    pause: tick,                        // let a newer request in
    cancelled: () => id !== current,
  });
  if (!r) return;                       // a newer request took over
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
    try { await load(m.url); await write(m.id, m.text); }
    catch (err) { postMessage({ type: 'error', id: m.id, message: String(err) }); }
  }
};
