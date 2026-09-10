# pranshul.cafe — working notes

Personal site of Pranshul Bohra. Static HTML on Vercel, deployed from `main`.
Live at **https://pranshul.cafe**.

This file is for whoever picks the repo up next. It covers how the site is put
together, the one non-trivial subsystem (the community map), and the traps that
have already cost real debugging time. Read the gotchas before touching
`api/community/`.

---

## 1. Shape of the site

Hand-written HTML pages, one file each, no build step, no framework. Styles and
scripts are inline in every page. That is deliberate — match it rather than
introducing a bundler.

```
index.html                  home (canvas cherry-blossom tree)
who-am-i / questions /      content pages, one file each
writings / books /
things-i-like /
things-ive-watched
*-typed.html                "typewriter" variants of the above
typewriter.html             index of the typed variants
garden.html, garden-home.html
examined/, examinedv2/      philosophy personality test
community/                  the community map (see §3)
gladiator/                  a self-contained satirical site at /gladiator
api/                        Vercel serverless functions
middleware.js               edge auth gate for private pages
vercel.json                 routing, headers, proxies
```

### Conventions worth preserving

- **Voice is lowercase and conversational** ("things i've been to and enjoyed",
  "know something i'd like?"). Keep it. It is the most distinctive thing about
  the site.
- **Fonts**: `Princess Sofia` for headings, `Unkempt` for body, `EB Garamond`
  for italic asides. A `<style id="enola-font-override">` block on 20 pages
  forces these with `!important` — new pages should include it to match.
- **Palette**: paper `#faf5ef`, ink `#3a2f2f`, muted `#6a5545` / `#b8a090`,
  accent rose `#c47a7a`, rule `#d4a080`. A fixed SVG-noise grain overlay sits at
  `body::before` on most pages.
- **Typewriter variants**: several pages have a `-typed.html` twin routed at
  `/typewriter/<page>`. If you add an entry to a list page, check whether its
  twin needs the same entry.

### Routing and hosting

- `vercel.json` holds 33 rewrites. `cleanUrls: true`, so `/foo.html` serves at
  `/foo`.
- Several paths proxy to a **self-hosted box at `89.167.65.46`** — `/bookmarks`
  (9090), `/london-events` (8080), `/monica` (9092), `/location-tool` (9093).
  Those apps are *not* in this repo. If one 502s, the box is down, not Vercel.
- `middleware.js` gates `/typeshit`, `/pdfs`, `/london-events` behind an
  HMAC-signed cookie (`pcafe_auth`), with the login form at `/login`.
- `gladiator/` is a self-contained static site served at `/gladiator` — its
  own type, palette and stylesheet, sharing nothing with the rest of the
  site. Every path in its markup is absolute and prefixed `/gladiator`.
  Nothing links to it. See `gladiator/README.md`.
- Umami analytics on every content page, self-hosted at
  `analytics.pranshul.cafe`, website id `fd5100ed-…`. Add the tag to new pages.

---

## 2. Deploying

Push to `main` → Vercel builds automatically. Roughly 30–90 seconds.

There is **no CI**. `npm test` (see §5) covers the community API and
`npm run test:pages` drives the three community pages in a browser, but
nothing runs them for you — run them before pushing.

Vercel project: `personal-website` under team `pranshulbs-projects`.

---

## 3. The community map (`/community`)

The only stateful part of the site. Pranshul's curated list of London places he
has been to and liked, on a map, with a public suggestion form and a private
moderation panel.

### Pages

| Path | What it is |
|---|---|
| `/community` | public map + list |
| `/community/suggest` | public suggestion form |
| `/community/admin` | private moderation panel |

All three carry `noindex, nofollow` and **nothing on the site links to them** —
this is intentional while the feature is WIP. Remove the meta tag and add a nav
link in `index.html` when it ships.

### API (`api/community/`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/community/places` | public | the live list behind the map |
| `POST /api/community/suggest` | public | adds to the pending queue |
| `POST /api/community/login` | — | password → signed cookie |
| `DELETE /api/community/login` | — | sign out |
| `GET /api/community/pending` | admin | the review queue |
| `POST /api/community/approve/<id>` | admin | queue → map (geocodes) |
| `POST /api/community/reject/<id>` | admin | drop from queue |
| `POST /api/community/edit/<id>` | admin | change an entry that is on the map |
| `POST /api/community/bulk-add` | admin | paste many into the queue |
| `DELETE /api/community/places` | admin | remove one (by `id`), or wipe all |
| `GET/POST /api/community/backups` | admin | list / restore snapshots |

`api/community/_store.js` is the core — storage, auth, validation, geocoding.
Everything else is a thin handler over it. **Read it first.**

### Data shape

Every place and every pending item has an `id` (a UUID minted at suggest /
bulk-add time). A place keeps the id of the suggestion it came from — that is
what makes approval idempotent (see §4). Entries written before ids existed
get a stable `legacy-…` id derived from their content on read, persisted on
the next write.

Place: `id, name, area, tags[], note, url, when, lat, lng` and `needsCoords:
true` when the geocoder found nothing. Pending item: the same minus
`when/lat/lng` (optional — bulk-add can supply them so approval skips the
geocoder), plus `city, submitted_by, submitted_at, source`.

### The note is Pranshul's, or it is empty

**Never write a `note` for him.** No model-generated descriptions, no "a
Victorian engine shed turned music venue" pulled from what you happen to know
about the place, not in `bulk-add`, not in `suggest`, not as a helpful
placeholder to be edited later. The whole point of the map is that he went and
he liked it; an invented note is a plausible-sounding claim about a place he
may remember completely differently, and once it is on the map it reads as his.

When adding places on his behalf, send `note: ''` and leave it. He fills them
in himself via **edit**, or they stay empty — both are fine. `.place.no-note`
in `community/index.html` promotes the name to the entry's headline so an
entry with no note reads as a normal entry rather than a caption with nothing
above it. Notes coming from the public suggest form are somebody's own words
about a place, which is a different thing, and they stay.

The same goes for `area`, `when` and `tags`: fill them from what he actually
told you or from his calendar, not from inference.

### Storage

Vercel Blob, two keys: `community-places.json` and `community-pending.json`.
There is no database.

`_seed.js` is merged into any map that holds **no seed entries** — never
written, wiped, or carrying only entries approved before the seed existed —
ahead of whatever is already there. It is not written on read; the first
approval, edit or removal after that persists the seed alongside its own
change, and from then on Blob is the source of truth and edits to `_seed.js`
change nothing until the map has no seed entries again. So the seed is the
one way to get a batch of entries onto the live map through git, and a wipe
puts the seed back rather than leaving nothing (the admin says so). For a
genuinely empty map, empty the seed. Seed entries carry `seed-…` ids, and
the API test suite checks the real file: every note empty, every `when`
empty, every pin inside London.

Every write takes a **lock** (`lock-community-<key>.txt`, see §4) and every
mutation goes through `appendPending` / `removePending` / `appendPlace` /
`replacePlace` / `removePlace`, or `overwrite` for wipe and restore. **Do not
add new `readX` + `writeX` pairs**, and do not call `writeBlob` directly.

A read that fails throws `StoreReadError` — it is never reported as an empty
list. Handlers turn that (and `StoreBusyError`, the lock timing out) into a
503 via `fail()`. The pages show "try again in a moment" for a 503.

### Config

Two things must be set in Vercel or the feature is dead:

1. A **Blob store** connected to the project (injects `BLOB_READ_WRITE_TOKEN`).
   Must be **public access** — reads fetch the blob's own URL.
2. `COMMUNITY_ADMIN_PASS` — the admin password. If unset, admin routes return
   **503 and stay shut** rather than falling open.

The admin cookie is signed with the password itself, so changing the password
invalidates every existing session. That is intended.

### Security posture

Built up over several passes; don't loosen it casually.

- Admin auth: HttpOnly signed cookie (30 days) **or** `X-Admin-Pass` header.
- Cross-origin admin requests are refused (403). Missing `Origin` (curl) passes
  — no ambient credentials to abuse.
- Admin routes do **not** send `Access-Control-Allow-Origin`. `GET /places` does,
  deliberately: it is a public read.
- CSP, `X-Frame-Options: DENY`, nosniff and Referrer-Policy on `/community/*`
  via `vercel.json`. Clickjacking matters here — the admin has a one-tap wipe.
- Input is stripped of `<`/`>` and control characters and length-capped. URLs
  are validated to http(s) only, at ingest *and* again at render.
- Failed logins cost 500ms; rate limits are per-IP per-route (suggest 5/min,
  login 10/min, admin 30/min, public reads 60/min).
- The suggest form has a honeypot field (`website`). A filled one gets a 200
  and nothing in the queue.

### The map itself

MapLibre GL (5.x, the UMD build from unpkg) over **OpenFreeMap** vector
tiles, drawn in the page's own palette by `paperStyle()` in
`community/index.html`: paper ground, ink-line roads, muted water and parks,
and low 3D building extrusions under a 52° camera on desktop (flat on
phones). No labels come from the tiles — the "corners of london" are drawn
from the entries' own areas as HTML markers, in EB Garamond, once you're
zoomed in enough. No key, no quota to watch.

The page fetches OpenFreeMap's published `positron` style only to take its
`sources` (so the tile URL is theirs to keep right), then swaps in our own
layers with `setStyle`. If that fetch fails it guesses the planet TileJSON;
if that fails too, the dots sit on plain paper and the page still works.
`#map-wrap` gets `map-ready` when MapLibre is up and `map-ground` once the
full style has drawn; the tests wait on those.

It replaced Leaflet over raster OSM tiles (a road atlas muted by a CSS
filter), which had replaced CARTO Voyager when CARTO started stamping "API
KEY REQUIRED" on anonymous tiles. Anything the map loads must be allowed in
**both** community CSP blocks in `vercel.json`: the style and the vector
tiles are *fetched*, so it is `connect-src` (not `img-src`) that needs
`tiles.openfreemap.org`, and MapLibre runs its worker from a blob URL, so
`worker-src blob:` is required — without it the map silently never draws.

### Backups

Every write leaves its predecessor in the blob store; the last **30 versions**
are kept and exposed under "history" in the admin, with restore. A restore
writes forward as a new version, so it is itself undoable. There is also
"download a copy" for an off-Vercel snapshot.

---

## 4. Gotchas — read before editing `api/community/`

Each of these shipped as a real bug. They are subtle and they all looked fine
in testing first.

### Blob writes must use `addRandomSuffix`

Blob URLs are CDN-cached with a **default max-age of one month**. Writing to a
fixed pathname means writing to a fixed URL, so the next read returns the
*pre-edit* copy — edits appear to save and then silently undo themselves.
`fetch(..., { cache: 'no-store' })` does not help; it governs the runtime's
cache, not the blob CDN's.

Every write therefore lands at a new pathname (a new URL, which cannot be
stale) and reads take the newest by `uploadedAt`.

### The read prefix is the extension-less base

`addRandomSuffix` inserts the suffix **before** the extension:
`community-pending.json` → `community-pending-XyZ123.json`. Listing with the
exact filename as prefix never matches, and every read silently falls through to
its default — an empty queue, forever, with no error anywhere. `baseOf(key)`
exists for this reason.

### The prune must never delete recent blobs

An earlier prune deleted "everything that isn't the blob I just wrote". Two
overlapping requests each deleted the other's write, leaving *nothing*, so reads
fell back to empty — two simultaneous suggestions lost **both**. The prune now
skips the newest and anything written in the last two minutes.

### Read-modify-write drops concurrent writes — and a check afterwards is not enough

A suggestion arriving while an approval is mid-flight used to vanish silently —
unrecoverable, and invisible. The first fix re-read after writing and
replayed on fresh data. That narrows the window but does not close it: a check
can pass and the list still be overwritten a moment later by a writer that
read *before* us. The test harness caught exactly that (a removal reported as
done, then undone by a concurrent approval), and also that under a burst of
nine simultaneous writers the old code gave up, **returned the wrong list, and
the handler said 200** — five suggestions lost with their senders told
otherwise.

Blob has no compare-and-swap, but `put()` to an existing pathname **throws**
(the previous trap, put to use). That is a mutex: every writer takes
`lock-community-<key>.txt`, does its read-modify-write, and deletes it. A lock
older than 10s is treated as a dead writer and broken; a writer that cannot
get the lock within 8s throws `StoreBusyError` → 503, never a false 200. The
lock's name must not share the data's prefix, or `list()` would return it as
the newest version. Don't bypass `mutate` / `overwrite`.

### Approving twice must not add twice

Two tabs, a double tap, a retry after a timeout: the approve route used to
append a fresh place each time. Places now carry the suggestion's id and
`appendPlace` is a no-op when that id is already on the map (`alreadyOnMap:
true` in the response). The map is written *before* the queue is trimmed, so
a crash in between leaves the item in the queue where re-approving it is
harmless — the other order would lose the suggestion.

### The seed used to be inert after the first write

The original rule was "seed only when nothing has ever been written". The
prototype's placeholders were wiped, which *writes* `[]` — so from then on the
store was non-empty-but-empty and a seed pushed through git reached nothing,
with no error anywhere. The second rule, "an empty list shows the seed",
missed the live map the day it shipped: a couple of entries had been approved
before the deploy, so the list wasn't empty and the seed stayed hidden. The
rule is now "a list with no `seed-` ids gets the seed merged in", applied on
read and inside the place mutations (`withSeed`), and `removePlace` writes
the merged list minus the entry when it takes the last seed entry out, so the
check afterwards doesn't read the seed back as a failed write.

### A failed read is not an empty list

`readBlob` used to swallow every error and return the fallback (`[]`). A
transient `list()` failure inside a mutate therefore read as "the store is
empty", and the write that followed replaced the whole list with one item.
Reads now throw `StoreReadError`; nothing writes on top of a failed read.

### The map library owns the marker element's `transform` — and its opacity

`setMarkerVisible` used to set `transform: scale(…)` on the marker element to
animate filtering — which overwrote the `translate3d` Leaflet positioned the
marker with, so on first render every dot sat stacked at the map origin until
a zoom re-placed them. MapLibre places markers the same way (an inline
`translate` + `rotate`), so the rule stands: scale the `<svg>` inside the
marker, never the marker. The entrance animation is on the svg for the same
reason. MapLibre also re-applies its own opacity to the element on every
move, so hiding a dot goes through `marker.setOpacity()`, never an inline
style — and the area labels are markers too, so the same goes for them.

### Enter in the suggest form did a GET to itself

The submit control was a bare `<a>` with a click handler and no `submit`
handler on the form. Pressing Enter in any field fell through to the browser
default: a GET of the same page with everything typed in the address bar, and
an empty form. Any form needs a real `submit` handler and a real submit
button, not a link.

### `fitBounds` throws on an empty list

An empty map produced invalid bounds and took the whole page down before the
list rendered. The call is guarded; keep it that way.

### Absolutely-positioned cards need an explicit container height

The admin's swipe deck stacks `position: absolute` cards, so the container has
no natural height. Against a fixed `min-height` any taller card covered the
approve/reject controls. The height is set from the real card after each render.

### Mobile keyboards may not offer Enter

The admin login originally listened only for `keydown` Enter on a lone password
field, which left **no way in at all** from a phone. Any form needs a visible
submit control, not just a key handler.

---

## 5. Testing

`test/` — see `test/README.md`. No framework, plain `node:assert`.

- `npm test` — the API (Node 22+). `test/hooks.mjs` is a loader hook that
  resolves `@vercel/blob` to `test/blob-stub.mjs` (and the store's
  `./_seed.js` to `test/seed-stub.mjs`, an empty list a test can fill), so
  the handlers are imported exactly as written and nothing has to be planted
  in `node_modules`. Covers sanitisers, auth, every route, the concurrency
  cases in §4 (double approve, suggest-during-approve, remove-during-approve,
  a nine-writer burst), legacy ids, history, prune, the lock, the seed rule,
  and the shape of the real seed file.
- `npm run test:pages` — Playwright drives `/community`, `/community/suggest`
  and `/community/admin` against `test/server.mjs`, which serves the repo
  like Vercel would and runs the *real* handlers over the stub. Needs
  `npm install --no-save playwright-core` (deliberately not in
  `package.json`) and a Chromium: Edge by default, `PW_CHANNEL=chrome`, or
  `PW_BROWSER=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in the
  sandbox. Do not run `playwright install`. The browser needs the network
  for MapLibre (unpkg), the fonts and OpenFreeMap; with `PW_FIXTURES` set,
  MapLibre is served from disk and the style and tiles are stubbed (see
  `test/README.md`).
- `npm test -- "some words"` runs only tests whose name contains them.

**The most important lesson**: three separate bugs reached production because
an earlier blob stub was more forgiving than the real service. `test/blob-stub.mjs`
models the behaviour that actually bites — the per-URL edge cache, the
suffix-before-extension rule, `put` throwing on an existing pathname, failure
injection, random latency so concurrent callers interleave. Keep it that way.
A stub that always succeeds will happily prove a broken implementation correct.

Two things that cost time writing these:

- All page-test requests come from `127.0.0.1`, so the per-IP rate limiter
  would put every test in one bucket. `test/server.mjs` gives each request
  its own fake `x-forwarded-for` unless a test pins one with `T.ip`.
- Never `assert.equal(elementHandle, null)` in a Playwright test: on failure
  Node tries to `inspect` the handle for the message and runs out of heap.
  Assert on counts or text instead.

---

## 6. Current state

- The map is **live and seeded** with Pranshul's first list (September 2026,
  39 entries in `_seed.js`): 21 places with a door, 5 things that happen at a
  regular home (pinned at the venue — two of them at Newspeak House), 12
  things without a fixed address (pinless on purpose), 1 under `living`.
  Notes are all empty — his to write. Tags are a first sort he asked for.
  Every address and link was verified by web search in September 2026; pins
  were placed from the verified street address (two from published
  coordinates), so any that look off are a "look the pin up again" away.
  Mosaic and 59OG (nothing public about either) were left out at his word;
  Gabriella Ina likewise.
- Five directories he collects from (otherwise.london, social fabric, …) are
  links in the map page's footer, not entries: pointers, not places.
- The map is MapLibre over OpenFreeMap vector tiles in the page's own
  palette, with low 3D buildings (September 2026 — see "The map itself").
  It could only be checked with stubbed tiles from the sandbox; the real
  ground was first seen on the Vercel preview.
- Nothing links to `/community` from `index.html` — Pranshul asked for it to
  stay unlisted while WIP.
- There may be leftover test entries in the pending queue (names containing
  `PROBE` or `AUDIT`); they are safe to reject.

### Sensible next steps

1. **Glance at the 26 pins** — placed from verified addresses, not the
   geocoder; **edit → save and look the pin up again** re-places one from the
   name and area if it looks off.
2. **Death Cafe** is still the generic London search: pin whichever one he
   actually goes to (Bonnington Centre, Jamyang, 430 On the Go…).
3. **Ship it**: drop the `noindex` meta from the three community pages and add
   a nav link in `index.html`.
4. More entries go through `bulk-add` in the admin (the line format takes a
   link and a "month year" after the tags; the JSON form takes `when`, `lat`,
   `lng` too), or through the seed if they should arrive with a deploy.

---

## 7. Working style that fits this repo

- Verify in a real browser before pushing. Most of the site is visual and there
  is no CI to catch a broken page.
- Prefer small, self-contained edits to a page's inline `<style>`/`<script>`
  over introducing tooling.
- Commit messages here are explanatory — what broke, why, and what was ruled
  out. Worth continuing; the history has been genuinely useful for debugging.
- Do not create pull requests unless asked. Pranshul works directly on `main`
  or on a `claude/*` branch merged in.
- **`garden-home.html` goes straight to `main`, every time** (his standing
  instruction, September 2026): it is the sandbox for tree and canvas
  changes and he wants to see each one live at `/garden-home`, not on a
  preview. Resync it from `index.html` before starting an experiment so it
  differs only by the experiment. The home page itself still waits for his
  word.
