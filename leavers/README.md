# 🫧 Pranshul's Leavers Party

Live: **https://xide.quest/pranshul/**

A screen full of big bouncy soap bubbles, each with one Pranshul photo
stretched across it through a funhouse glass lens — plus a whole variety
show of other Pranshuls. Nothing on the page but the title and the RSVP
sticker.

**Cache busting:** `index.html` links `style.css?v=N` and `main.js?v=N`.
Caddy sends no `Cache-Control` here, so browsers happily keep stale copies —
bump the `?v=` number whenever you edit either file and every visitor gets
the new version on next page load.

## The face show (`main.js`, FACE SPRITES section)

Every non-bubble animation is a billboarded face disc with a chunky sticker
outline in a random palette colour:

| bit | what it does |
|---|---|
| **face confetti** | 22 little Pranshuls tumbling up the background, spinning and squashing, re-rolling face + ring colour each time they loop |
| **conga line** | 9 faces hopping across the bottom, squashing as they land, glowing on the up-beat |
| **comet** | every 2–4s one screams across the screen on a whoop-de-doo arc, stretched by speed, with a 7-face lag trail |
| **peeker** | every 3–7s a giant Pranshul leans in from a random edge, wobbles, and slides back out |
| **cursor trail** | move the mouse fast and tiny Pranshuls puff out behind it and shrink away |
| **moons** | 4 faces in slow tilted orbits over the top of everything |

Tune them in `initFaceShow()` / `stepFaceShow()`; poke them live via
`__PRANSHUL.show` (e.g. `__PRANSHUL.show.launchComet()`).

## RSVP link

The RSVP sticker under the title goes to `rsvp/`, which instantly forwards
to whatever URL is set in **`rsvp/index.html`** — one obvious
`const RSVP_URL = ""` line at the top of the file. While it's empty the page
shows a candy "RSVP OPENS SOON" holding screen instead. When the real RSVP
exists, paste its URL between the quotes and you're done; nothing else to
touch.

## Swapping the photos

Drop `.jpg / .png / .webp` files into `images/` and refresh. The page finds
them at runtime:

1. `GET images/` with `Accept: application/json` — Caddy's `file_server browse`
   JSON listing. **This is what production uses**, so new photos need no config.
2. `GET /api/images` — the local dev server (`node server.js`).
3. `GET images/manifest.json` — dumb static hosts (`./make-manifest.sh`).
4. Hard-coded fallback in `main.js`.

`crop-faces.py` turns raw cut-outs into bubble-ready textures: square crop
around the face, composited onto a warm backdrop, brightened, 1024². One
line per photo — face centre x/y as fractions, crop size, backdrop colour.

## Interactions

| do this | get this |
|---|---|
| move the cursor near a bubble | a smooth dent presses into the skin and it gets shoved |
| flick the cursor | bubbles inherit the flick |
| click + drag | grab one; it lags, stretches, and boings when released |
| click / double-click / right-click | POP — warm confetti burst, respawns from below |

Bubbles cruise at a steady speed, bounce elastically off every wall and off
each other, and squash along the impact normal with a damped spring so every
hit jiggles. They never pile up and never leave the screen.

## Tweaking

`CFG` at the top of `main.js`:

```js
density / radius        // how many, how big
cruise / bounce / drift // how lively
springK / springC       // jiggle speed and how long it rings out
maxSquash               // how far squash-and-stretch goes
bend:  [1.20, 1.75]     // >1 magnifies his face; 1.0 = flat decal; <1 zooms out
eta / aberration/ gloss // glassiness, rainbow fringe, rim sheen
```

The face mapping is a radial lens warp over the bubble's disk — bijective on
`[0,1]`, so **one** photo always fills **one** bubble. It cannot tile.

Live-tweak in the console: `__PRANSHUL.CFG`, `__PRANSHUL.setCount(40)`.

Look and feel (palette, sunburst, rings, dots, grain, title) is all in
`style.css`. Local preview: `node server.js` → http://localhost:4173
