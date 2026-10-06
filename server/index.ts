import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { marked } from "marked";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { parseClientMsg } from "../shared/protocol.ts";
import { getOrCreatePlayer } from "./db.ts";
import { log } from "./log.ts";
import { createRoom, getRoom, leaveRoom, roomCount, send } from "./rooms.ts";
import type { Client } from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIR = resolve("dist/client");
const DOCS_DIR = resolve("docs");
const HEARTBEAT_MS = 25_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

const readmeHtml = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>README</title>
<style>
  body { margin: 0; font: 1rem/1.6 system-ui, sans-serif; background: #0f1720; color: #e6edf3; }
  main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  a { color: #7cc4ff; }
  img { max-width: 100%; height: auto; }
  pre, code { background: #1b2733; border-radius: 4px; }
  pre { padding: 0.75rem; overflow-x: auto; }
  code { padding: 0.1rem 0.3rem; }
</style>
</head>
<body>
<main>
<p><a href="/">&larr; Back to the game</a></p>
${marked.parse(readFileSync("README.md", "utf8"), { async: false })}
</main>
</body>
</html>`;

async function serveFile(res: ServerResponse, root: string, relPath: string, immutable = false): Promise<boolean> {
  const full = normalize(join(root, relPath));
  if (full !== root && !full.startsWith(root + sep)) return false;
  try {
    const body = await readFile(full);
    res.writeHead(200, {
      "content-type": MIME[extname(full)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }

  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
    return;
  }
  if (path === "/readme") {
    res.writeHead(301, { location: "/readme/" });
    res.end();
    return;
  }
  if (path === "/readme/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readmeHtml);
    return;
  }
  if (path.startsWith("/readme/docs/")) {
    if (await serveFile(res, DOCS_DIR, path.slice("/readme/docs/".length))) return;
    res.writeHead(404).end("not found");
    return;
  }

  const immutable = path.startsWith("/assets/");
  if (path !== "/" && (await serveFile(res, CLIENT_DIR, path, immutable))) return;
  if (extname(path) === "" && (await serveFile(res, CLIENT_DIR, "index.html"))) return;
  if (path === "/") {
    res.writeHead(503, { "content-type": "text/plain" }).end("client is not built: run `pnpm build`");
    return;
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

http.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

const alive = new WeakSet<WebSocket>();

wss.on("connection", (ws: WebSocket) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));

  const client: Client = { ws, token: "", name: "", room: null, seat: null };
  let hello = false;

  ws.on("message", (data) => {
    const msg = parseClientMsg(data.toString());
    if (!msg) {
      send(client, { t: "error", message: "bad message" });
      return;
    }
    if (msg.t === "hello") {
      const player = getOrCreatePlayer(msg.token);
      client.token = player.token;
      client.name = player.name;
      hello = true;
      send(client, { t: "welcome", token: player.token, name: player.name });
      log("hello", { name: player.name });
      return;
    }
    if (!hello) {
      send(client, { t: "error", message: "say hello first" });
      return;
    }
    switch (msg.t) {
      case "create": {
        leaveRoom(client);
        const room = createRoom(msg.game, msg.practice);
        if (!room) send(client, { t: "error", message: "unknown game" });
        else room.join(client);
        break;
      }
      case "join": {
        const room = getRoom(msg.room);
        if (!room) {
          send(client, { t: "error", message: "room not found" });
          break;
        }
        if (client.room !== room) {
          leaveRoom(client);
          room.join(client);
        }
        break;
      }
      case "swing":
        client.room?.swing(client, msg);
        break;
      case "move":
        client.room?.move(client, msg.x);
        break;
      case "leave":
        leaveRoom(client);
        break;
    }
  });

  ws.on("close", () => leaveRoom(client));
  ws.on("error", () => ws.terminate());
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS).unref();

http.listen(PORT, "0.0.0.0", () => log("listening", { port: PORT }));
