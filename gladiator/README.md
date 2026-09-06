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
assets/style.css    the whole design system
assets/app.js       reveal-on-scroll, rank ladder, pricing switch, FAQ, toasts
assets/fonts.css    @font-face for Anton + Cinzel + Inter, pinned to Google's files
assets/favicon.svg  a galea
```

Every path in the markup is absolute and starts with `/gladiator` — asset
links, the nav, the login link. Relative paths would break the moment the URL
lost or gained a trailing slash, which `cleanUrls` makes easy to do.

## The idea

A fight bill for a Colosseum that doesn't exist. Black paper, red ink,
everything hung off one left rule with a gutter for the labels. Red is the
field, not an accent: the chant band, the selected rank, the prices, the
closing block are all red, and the hero is lit from below like the sand is
on fire.

Nothing is centred except the things meant to shout.

## What changed from the original

The original was a Next.js page in default Tailwind greys: `bg-gray-800`
cards, `rounded-3xl` everywhere, a stock condom-packet PNG scattered eight
times at 600px, and copy that never got a layout worthy of it.

- **Art direction.** Anton does the shouting, Cinzel handles anything meant
  to look carved, Inter carries the sentences. Newsprint grain over
  everything; a colosseum drawn as a black cut-out standing in front of the
  fire; the foil packet redrawn as a 1.5 KB SVG instead of a 350 KB bitmap.
- **No pill buttons, no glow.** Everything is squared off with a hard offset
  shadow, and pressing one moves it into its own shadow.
- **The ranks actually work.** Eight tiers as a real tablist: click or hover
  to switch, arrow keys / Home / End to navigate, roving tabindex, and a
  detail panel that swaps glyph, description and progress meter. In the
  original only the first tier's description was ever shown.
- **The pricing toggle does something.** "For myself" / "as a gift" dims the
  ticket you are not looking at, and on mobile shows only that one.
- **The FAQ is an accordion** instead of four permanently-open boxes, ruled
  rather than boxed.
- **The stats became a chant.** Four numbers in a four-up panel became a red
  marquee band that runs under the hero, and stops dead under
  `prefers-reduced-motion`.
- **The login form has a submit handler**, so pressing Enter no longer does a
  GET of the page with your password in the address bar. Every dead-end
  control answers rather than doing nothing.
- **Accessibility**: skip link, visible focus rings, labelled controls,
  `aria-selected` / `aria-expanded` / `aria-pressed` kept in sync, and a full
  `prefers-reduced-motion` path.
- **Analytics**: the site's Umami tag, same as every other content page here.
- **Weight**: ~100 KB of source total, one third-party origin (fonts).

## Social card

`og:image` is deliberately absent — the deploy path used here can only carry
text files, so there is no raster card to point at. To add one: drop a
1200×630 image at `assets/og.jpg` and restore the `og:image`,
`og:image:width`, `og:image:height` and `twitter:image` tags, switching
`twitter:card` back to `summary_large_image`.

## Where it lives

Served from the main site at **pranshul.cafe/gladiator**, off the repo root's
`vercel.json`, which now carries:

- two rewrites (`/gladiator` and `/gladiator/login`), the same shape the
  `/community` pages use;
- a CSP and the usual `nosniff` / `DENY` / referrer headers for
  `/gladiator` and `/gladiator/:path*`. The CSP allows inline script because
  `login.html` has one, and `fonts.gstatic.com` for the three woff2 files;
- a year-long immutable cache on `/gladiator/assets/:path*`.

`middleware.js` does not match these paths, so nothing here is behind the
auth cookie. Nothing on the site links to it — add a nav entry in the root
`index.html` if you want it findable.

There is no `robots.txt` here (it would sit at `/gladiator/robots.txt` and do
nothing) and no `vercel.json` (only the repo root's is read). `index.html`
is indexable; add `<meta name="robots" content="noindex">` if you would
rather it were not. `login.html` already carries one.

## Content note

The copy is the original's, verbatim, because the copy is the joke. It is
adult-humour satire and says so in the footer.
