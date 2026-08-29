# tests for the community map

No framework — plain `node:assert` and a hand-rolled runner, to match the rest
of the repo. Nothing here touches the site build.

```
npm test               # api/community/* against the blob stub   (needs Node 22+)
npm run test:pages     # the three pages, driven in a real browser
```

Pass a substring to run one test: `npm test -- "double"`.

## what is in here

| file | what it is |
|---|---|
| `blob-stub.mjs` | stand-in for `@vercel/blob` — see below |
| `hooks.mjs`, `register.mjs` | Node loader hook that swaps the stub in for `@vercel/blob` |
| `fake.mjs` | fake `req` / `res` in the shape Vercel hands to a function |
| `api.test.mjs` | the API: sanitisers, auth, moderation, editing, concurrency, storage mechanics |
| `server.mjs` | serves the repo like Vercel would, routing `/api/community/*` to the real handlers |
| `pages.test.mjs` | Playwright against the map, the suggest form and the admin |

## the stub is deliberately unforgiving

Three bugs reached production because an earlier stub was kinder than the
real service. This one models the behaviour that actually bites:

- `addRandomSuffix` puts the suffix *before* the extension
- `put()` to an existing pathname throws (the write lock depends on this)
- blob URLs are served through a CDN: the first body fetched for a URL is
  what every later fetch of that URL returns
- `list`, `fetch` and `put` can be made to fail on demand (`__test.fail`)
- a little random latency, so concurrent callers actually interleave

`__test` on the stub exposes `reset()`, `seed()`, `advanceClock()`, the
Nominatim canned response, and the pathnames in the store.

## the page tests

`test:pages` needs `playwright-core` and a Chromium. It is not in
`package.json` on purpose (Vercel installs devDependencies too, and the site
doesn't need it):

```
npm install --no-save playwright-core
```

By default it launches Edge (`channel: msedge`). To use another binary:

```
PW_CHANNEL=chrome npm run test:pages
PW_BROWSER=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:pages
```

Leaflet comes from unpkg and tiles from tile.openstreetmap.org, so by default
the browser needs the network. In a sandbox that blocks CDNs, Leaflet never
loads and all five map tests time out waiting for a list that never renders —
which looks exactly like a broken page. Point `PW_FIXTURES` at a directory
holding `leaflet.js`, `leaflet.css` and `tile.png` and those origins (plus the
Google Fonts stylesheet) are served from disk instead:

```
PW_FIXTURES=/path/to/fixtures npm run test:pages
```

Screenshots land in `test/shots/` (gitignored).
