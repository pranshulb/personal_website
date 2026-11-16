/* ================================================================
   PRESENCE on Cloudflare — a Worker and one Durable Object per room

   The room ran on PartyKit's hosted platform until that shut down on
   23 October 2026 and took pranshul-cafe-presence.pranshulb.partykit.dev
   with it (the name stopped resolving; the page kept knocking on a door
   that wasn't there, and nobody saw anybody). Cloudflare's own successor
   to PartyKit is the same thing on your own account: a Worker in front,
   and a Durable Object per room that holds its WebSockets.

   server.js is the room itself, unchanged and still tested on its own
   (npm run test:presence). This file only gives it what PartyKit gave it:
   a room per name, the connections in it, and a way to broadcast. The
   page connects to wss://<host>/party/<room> exactly as before.
   ================================================================ */
import Presence from './server.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = pathname.match(/^\/party\/([a-z0-9-]{1,40})$/);
    if (!m) return new Response('presence: nothing here\n', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket\n', { status: 426 });
    const checked = await Presence.onBeforeConnect(request);   // other sites' pages are turned away
    if (checked instanceof Response) return checked;
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  },
};

export class PresenceRoom {
  constructor() {
    const conns = this.conns = new Map();   // id -> connection, as PartyKit's room kept them
    this.presence = new Presence({
      getConnections: () => conns.values(),
      broadcast(msg, without = []) { for (const c of conns.values()) if (!without.includes(c.id)) c.send(msg); },
    });
  }

  async fetch() {
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const conn = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      send(msg) { try { ws.send(msg); } catch (e) {} },
      close(code, reason) { try { ws.close(code, reason); } catch (e) {} },
    };
    this.conns.set(conn.id, conn);
    this.presence.onConnect(conn);
    if (!this.presence.state.has(conn.id)) this.conns.delete(conn.id);   // turned away: the room is full
    const leave = () => { if (this.conns.delete(conn.id)) this.presence.onClose(conn); };
    ws.addEventListener('message', (e) => this.presence.onMessage(e.data, conn));
    ws.addEventListener('close', () => { leave(); conn.close(1000); });
    ws.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: client });
  }
}
