# fonts

The café pages' two handwriting faces, served from the site instead of
Google Fonts (see `/cafe.css`, part 1). Same files Google serves, latin
and latin-ext subsets, woff2.

- `unkempt-400.woff2`, `unkempt-700.woff2` — Unkempt by Sideshow, Apache License 2.0
- `princess-sofia-latin.woff2`, `princess-sofia-latin-ext.woff2` — Princess Sofia by Tart Workshop, SIL Open Font License 1.1

They are cached for a year as immutable (`vercel.json`), so a changed font
needs a new file name, not a replaced file.
