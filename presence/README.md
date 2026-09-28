# presence — who else is under the tree

The small server behind "someone else is here too" on the home page. Each
visitor's page keeps one WebSocket to a room here; the room passes along
where each pointer is (relative to the tree), taps on the water, shakes of
the tree, and how many are in the room. Nothing is stored and no one is
named. See the comment at the top of `server.js` for the messages.

It runs on [PartyKit](https://www.partykit.io) (Cloudflare underneath),
because Vercel, which hosts the site, can't hold WebSockets open.

## Deploying

    cd presence
    npx partykit login      # once, with the site owner's GitHub
    npx partykit deploy

Deploy prints the host, `pranshul-cafe-presence.<account>.partykit.dev`.
Put it in `PRESENCE_HOST` near the "COMPANY" block in `index.html` and push.
Until then that is empty and the page never connects.

## Testing

- `npm run test:presence` (from the repo root) — the server against a fake room.
- `npx partykit dev --port 1999` here, then open the home page locally with
  `?presence=ws://127.0.0.1:1999/party/home` in two windows. The page only
  takes a `?presence=` pointing at localhost.

This folder is kept off the website by `.vercelignore`.
