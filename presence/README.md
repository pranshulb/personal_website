# presence — who else is under the tree

The small server behind "someone else is here too" on the home page. Each
visitor's page keeps one WebSocket to a room here; the room passes along
where each pointer is (relative to the tree), taps on the water, shakes of
the tree, and how many are in the room. Nothing is stored and no one is
named. See the comment at the top of `server.js` for the messages.

- `server.js` — the room: what comes in, what goes out, the limits.
- `worker.js` — runs it on Cloudflare: a Worker in front, a Durable Object
  per room holding its WebSockets. The page connects to `/party/<room>`.
- `wrangler.toml` — the Worker's settings.

It runs on Cloudflare because Vercel, which hosts the site, can't hold
WebSockets open. It started on PartyKit's hosted platform (September
2026); PartyKit shut that down on 23 October 2026 and deleted its
projects, so `pranshul-cafe-presence.pranshulb.partykit.dev` stopped
existing and nobody could see anybody. Since 16 November 2026 it is on
Pranshul's own Cloudflare account (free plan) at
`pranshul-cafe-presence.pranshulb.workers.dev`, which is `PRESENCE_HOST`
near the "COMPANY" block in `index.html` and `garden-home.html`.

## Deploying

    cd presence
    npx wrangler deploy

with a Cloudflare API token for his account ("Edit Cloudflare Workers"
template) in `CLOUDFLARE_API_TOKEN`; in a Claude cloud session the token
is saved on the environment for api.cloudflare.com and the proxy puts it
in, so the variable only needs a placeholder. A redeploy keeps the same
host. With `PRESENCE_HOST` empty the page never connects.

## Testing

- `npm run test:presence` (from the repo root) — the room against a fake one.
- `npx wrangler dev --port 8787` here, then open the home page locally with
  `?presence=ws://127.0.0.1:8787/party/home` in two windows. The page only
  takes a `?presence=` pointing at localhost.

This folder is kept off the website by `.vercelignore`.
