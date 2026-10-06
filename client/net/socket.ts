import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";

const TOKEN_KEY = "tennis-token";
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

export class Connection {
  name = "";
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

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: loadToken() } satisfies ClientMsg));

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMsg;
      if (msg.t === "welcome") {
        saveToken(msg.token);
        this.name = msg.name;
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
