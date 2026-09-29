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
      .then((buf) => { model = HandCore.parse(buf); net = HandCore.Network(model); });
  }
  return loading;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function write(id, text) {
  // a name in a script the network can't write goes in as typed
  if (!HandChecks.writable(text)) { postMessage({ type: 'typed', id }); return; }
  const plan = HandChecks.plan(text);
  const words = [];
  for (const part of plan.parts) {
    let best = null;
    for (let attempt = 0; attempt < plan.attempts; attempt++) {
      if (id !== current) return;
      let batch = [], steps = 0;
      const out = HandCore.write(model, net, part, {
        bias: plan.ladder[attempt], maxDwell: plan.maxDwell, maxAfterEnd: plan.maxAfterEnd,
        onPoint(x, y, up) {
          batch.push([x, y, up]);
          if (++steps % 8 === 0) { postMessage({ type: 'ink', id, part: words.length, attempt, pts: batch }); batch = []; }
        },
      });
      if (batch.length) postMessage({ type: 'ink', id, part: words.length, attempt, pts: batch });
      const why = HandChecks.check(part, out);
      if (!why) { best = out; break; }
      postMessage({ type: 'again', id, part: words.length, why });
      await tick();   // let a newer request in
    }
    if (!best) { postMessage({ type: 'fail', id }); return; }
    words.push(best.pts);
  }
  postMessage({ type: 'done', id, strokes: HandChecks.layout(words, plan) });
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
