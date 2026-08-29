// Fake req/res in the shape Vercel's Node runtime hands to a function.
export function makeReq({ method = 'GET', url = '/', query = {}, body, headers = {} } = {}) {
  return {
    method,
    url,
    query,
    body,
    headers: { host: 'pranshul.cafe', ...headers },
  };
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    status(code) { res.statusCode = code; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    getHeader(k) { return res.headers[k.toLowerCase()]; },
    json(obj) { res.body = obj; res.ended = true; return res; },
    end(s) { if (s !== undefined) res.body = s; res.ended = true; return res; },
    send(s) { res.body = s; res.ended = true; return res; },
  };
  return res;
}

export async function call(handler, opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// Unique per call, so the per-IP rate limits never trip in the middle of a
// test that isn't about rate limits.
let ipSeq = 0;
export const freshIp = () => '10.0.' + Math.floor(ipSeq / 250) + '.' + (++ipSeq % 250);
