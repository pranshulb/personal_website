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
- Umami analytics on every content page, self-hosted at
  `analytics.pranshul.cafe`, website id `fd5100ed-…`. Add the tag to new pages.

---

## 2. Deploying

Push to `main` → Vercel builds automatically. Roughly 30–90 seconds.

There is **no test suite and no CI**. Nothing stops a broken page reaching
production, so verify before pushing (see §5).

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
| `POST /api/community/bulk-add` | admin | paste many into the queue |
| `DELETE /api/community/places` | admin | remove one, or wipe all |
| `GET/POST /api/community/backups` | admin | list / restore snapshots |

`api/community/_store.js` is the core — storage, auth, validation, geocoding.
Everything else is a thin handler over it. **Read it first.**

### Storage

Vercel Blob, two keys: `community-places.json` and `community-pending.json`.
There is no database. `_seed.js` is used *only* when the store is empty.

Writes go through `appendPending` / `removePending` / `appendPlace`, which are
concurrency-safe. **Do not add new `readX` + `writeX` pairs** — see §4.

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
- Input is stripped of `<`/`>` and length-capped. URLs are validated to
  http(s) only, at ingest *and* again at render.
- Failed logins cost 500ms; rate limits are per-IP per-route (suggest 5/min,
  login 10/min, admin 30/min, public reads 60/min).

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

### Read-modify-write drops concurrent writes

A suggestion arriving while an approval is mid-flight used to vanish silently —
unrecoverable, and invisible. Use `appendPending` / `removePending` /
`appendPlace`, which re-check after writing and replay on fresh data.

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

No test runner is wired up. What has worked:

- **Node with a stubbed `@vercel/blob`** for API logic — write a stub into
  `node_modules/@vercel/blob` (gitignored), import the handlers directly, call
  them with fake `req`/`res` objects.
- **Playwright + the pre-installed Chromium** at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` for the pages. Install
  `playwright-core` only; do not run `playwright install`.
- Serve the repo with a small `node:http` script and stub the API routes.
- The sandbox blocks CDNs in the browser, so route `unpkg.com` (Leaflet),
  `basemaps.cartocdn.com` and the fonts to local fixtures.

**The most important lesson**: three separate bugs reached production because
the blob stub was more forgiving than the real service. If you stub something,
model the behaviour that actually bites — the per-URL edge cache, the
suffix-before-extension rule, `put` throwing on an existing pathname. A stub
that always succeeds will happily prove a broken implementation correct.

Also: when running several fixture servers, give each pass its own port. Stale
in-memory state between test passes produced three convincing false failures.

---

## 6. Current state

- The map is **live but empty** (0 entries) and unlinked from the site.
- The seed list is empty on purpose; the prototype's placeholder places were
  wiped.
- Nothing links to `/community` from `index.html` — Pranshul asked for it to
  stay unlisted while WIP.
- There may be leftover test entries in the pending queue (names containing
  `PROBE` or `AUDIT`); they are safe to reject.

### Sensible next steps

1. **Get real entries in.** The whole design — subject colours, the tally, area
   grouping, the staggered entrance — is keyed to real data and looks inert
   without it. `bulk-add` in the admin is the fast path.
2. **Ship it**: drop the `noindex` meta from the three community pages and add
   a nav link in `index.html`.
3. Consider editing an existing entry — currently you can only remove and
   re-add. It is the most obvious missing affordance.

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
