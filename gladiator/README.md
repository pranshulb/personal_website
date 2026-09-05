# gladiator.cx — rebuild

A polished rebuild of the satirical landing page at https://www.gladiator.cx/.
Same jokes, same copy, new everything else.

## What it is

Hand-written static HTML. No framework, no build step, no dependencies —
`index.html`, `login.html`, one stylesheet, one script. Open `index.html`
through any static server and it works.

```
index.html          the landing page
login.html          the (deliberately non-functional) login screen
robots.txt
vercel.json         cleanUrls + security headers + asset caching
assets/style.css    the whole design system
assets/app.js       reveal-on-scroll, rank ladder, pricing switch, FAQ, toasts
assets/fonts.css    @font-face for Cinzel + Inter, pinned to Google's own files
assets/favicon.svg  a galea
```

## What changed from the original

The original was a Next.js page in default Tailwind greys: `bg-gray-800`
cards, `rounded-3xl` everywhere, a stock condom-packet PNG scattered eight
times at 600px, and copy that never got a layout worthy of it.

- **Art direction.** Obsidian ground, imperial gold, arena red. Cinzel
  (Roman inscriptional caps) for display, Inter for text. Film grain over
  everything, a drawn colosseum arcade behind the hero, and the foil packet
  redrawn as a 1.5 KB SVG instead of a 350 KB bitmap.
- **The ranks actually work.** Eight tiers as a real tablist: click or hover
  to switch, arrow keys / Home / End to navigate, roving tabindex, and a
  detail panel that swaps glyph, description and progress meter. In the
  original only the first tier's description was ever shown.
- **The pricing toggle does something.** "Buying for myself" / "buying as a
  gift" now dims the plan you are not looking at, and on mobile shows only
  that one.
- **The FAQ is an accordion** instead of four permanently-open boxes.
- **The login form has a submit handler**, so pressing Enter no longer does a
  GET of the page with your password in the address bar. Every dead-end
  control answers rather than doing nothing.
- **Accessibility**: skip link, visible focus rings, labelled controls,
  `aria-selected` / `aria-expanded` / `aria-pressed` kept in sync, and a full
  `prefers-reduced-motion` path.
- **Weight**: ~100 KB of source total, one third-party origin (fonts).

## Social card

`og:image` is deliberately absent — the deploy path used here can only carry
text files, so there is no raster card to point at. To add one: drop a
1200×630 image at `assets/og.jpg` and restore the `og:image`,
`og:image:width`, `og:image:height` and `twitter:image` tags, switching
`twitter:card` back to `summary_large_image`.

## Deploying

Static; anything will serve it. On Vercel it is its own project, deliberately
separate from the personal site in this repo — `.vercelignore` at the repo
root keeps this directory out of the pranshul.cafe build.

## Content note

The copy is the original's, verbatim, because the copy is the joke. It is
adult-humour satire and says so in the footer.
