import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";

const TOKEN_KEY = "tennis-token";
// which demo account (if any) is currently signed in; kept separate from
// TOKEN_KEY so "play as guest" can restore the original identity rather than
// losing it
const DEMO_KEY = "tennis-demo";
const MAX_QUEUE = 20;

function loadToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable: the player just gets a fresh identity next visit
  }
}

function loadDemo(): 1 | 2 | undefined {
  try {
    const v = localStorage.getItem(DEMO_KEY);
    return v === "1" ? 1 : v === "2" ? 2 : undefined;
  } catch {
    return undefined;
  }
}

function saveDemo(demo: 1 | 2 | undefined): void {
  try {
    if (demo) localStorage.setItem(DEMO_KEY, String(demo));
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    // storage unavailable: sign-in just won't survive a reload
  }
}

export class Connection {
  name = "";
  matches = 0;
  /** the signed-in demo account, or null for the browser's own guest identity */
  demo: 1 | 2 | null = null;
  roomCode: string | null = null;
  private ws: WebSocket | null = null;
  private open = false;
  private queue: ClientMsg[] = [];
  private handlers = new Set<(msg: ServerMsg) => void>();

  constructor() {
    this.connect();
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    if (this.open && this.ws) this.ws.send(JSON.stringify(msg));
    else if (this.queue.length < MAX_QUEUE) this.queue.push(msg);
  }

  /** Switch identity on the already-open connection; the server replies with a fresh `welcome`. */
  signInDemo(n: 1 | 2): void {
    saveDemo(n);
    this.send({ t: "hello", demo: n });
  }

  playAsGuest(): void {
    saveDemo(undefined);
    this.send({ t: "hello", token: loadToken() });
  }

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: loadToken(), demo: loadDemo() } satisfies ClientMsg));

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMsg;
      if (msg.t === "welcome") {
        // a demo account's token isn't this browser's own identity: keep the
        // guest token intact so "play as guest" has something to return to
        if (!loadDemo()) saveToken(msg.token);
        this.name = msg.name;
        this.matches = msg.matches;
        this.demo = loadDemo() ?? null;
        this.open = true;
        if (this.roomCode) ws.send(JSON.stringify({ t: "join", room: this.roomCode } satisfies ClientMsg));
        for (const queued of this.queue.splice(0)) ws.send(JSON.stringify(queued));
      }
      if (msg.t === "room") this.roomCode = msg.room;
      for (const handler of this.handlers) handler(msg);
    };

    ws.onclose = () => {
      this.open = false;
      setTimeout(() => this.connect(), 1000);
    };
  }
}
