import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startTennis } from "./games/tennis/view.ts";
import { Connection } from "./net/socket.ts";
import { renderMenu } from "./ui/menu.ts";

const root = document.getElementById("app") as HTMLElement;
const conn = new Connection();

let disposeGame: (() => void) | null = null;
let currentRoom: string | null = null;
let error: string | null = null;

function showMenu(): void {
  disposeGame?.();
  disposeGame = null;
  currentRoom = null;
  conn.roomCode = null;
  renderMenu(root, conn.name, conn.matches, conn.demo, error, {
    onPractice: () => conn.send({ t: "create", game: "tennis", practice: true }),
    onCreate: () => conn.send({ t: "create", game: "tennis", practice: false }),
    onJoin: (code) => conn.send({ t: "join", room: code }),
    onSignInDemo: (n) => conn.signInDemo(n),
    onPlayAsGuest: () => conn.playAsGuest(),
  });
}

function leave(): void {
  conn.send({ t: "leave" });
  error = null;
  history.replaceState(null, "", location.pathname);
  showMenu();
}

function enterRoom(info: RoomInfo): void {
  disposeGame?.();
  currentRoom = info.room;
  error = null;
  history.replaceState(null, "", `#/room/${info.room}`);
  disposeGame = startTennis(root, conn, info, leave);
}

conn.on((msg) => {
  if (msg.t === "welcome" && currentRoom === null) showMenu();
  else if (msg.t === "room") {
    if (msg.room !== currentRoom) enterRoom(msg);
  } else if (msg.t === "error") {
    error = msg.message;
    if (currentRoom === null) showMenu();
  }
});

const invite = location.hash.match(/^#\/room\/([A-Za-z]{4})$/);
if (invite) conn.send({ t: "join", room: invite[1].toUpperCase() });
showMenu();
