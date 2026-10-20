import "./style.css";
import type { RoomInfo } from "../shared/protocol.ts";
import { startArcheryPractice } from "./games/archery/practice.ts";
import { startArchery } from "./games/archery/view.ts";
import { startTraining } from "./games/tennis/training.ts";
import { startTennis } from "./games/tennis/view.ts";
import { Connection } from "./net/socket.ts";
import { renderMenu } from "./ui/menu.ts";

const root = document.getElementById("app") as HTMLElement;
const conn = new Connection();

let disposeGame: (() => void) | null = null;
let currentRoom: string | null = null;
let training = false;
let error: string | null = null;
// the sport picked on the menu, so coming back keeps it
let sport = "tennis";

function showMenu(): void {
  disposeGame?.();
  disposeGame = null;
  currentRoom = null;
  training = false;
  conn.roomCode = null;
  renderMenu(
    root,
    conn.name,
    conn.matches,
    conn.demo,
    error,
    {
      onTrain: (s) => (s === "archery" ? practiseArchery() : train()),
      onPractice: (s) => conn.send({ t: "create", game: s, practice: true }),
      onCreate: (s) => conn.send({ t: "create", game: s, practice: false }),
      onJoin: (code) => conn.send({ t: "join", room: code }),
      onSignInDemo: (n) => conn.signInDemo(n),
      onPlayAsGuest: () => conn.playAsGuest(),
      onSelect: (s) => (sport = s),
    },
    sport,
  );
}

function leave(): void {
  conn.send({ t: "leave" });
  error = null;
  history.replaceState(null, "", location.pathname);
  showMenu();
}

// Training runs in the page against a ball machine: it sends nothing to the
// server, so leaving it needs no "leave" either.
function train(): void {
  disposeGame?.();
  training = true;
  error = null;
  history.replaceState(null, "", "#/train");
  disposeGame = startTraining(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

// Archery practice (task 22): in the page too, nothing sent to the server.
function practiseArchery(): void {
  disposeGame?.();
  training = true;
  sport = "archery";
  error = null;
  history.replaceState(null, "", "#/archery/practice");
  disposeGame = startArcheryPractice(root, () => {
    history.replaceState(null, "", location.pathname);
    showMenu();
  });
}

function enterRoom(info: RoomInfo): void {
  disposeGame?.();
  currentRoom = info.room;
  training = false;
  error = null;
  history.replaceState(null, "", `#/room/${info.room}`);
  sport = info.game;
  disposeGame = info.game === "archery" ? startArchery(root, conn, info, leave) : startTennis(root, conn, info, leave);
}

conn.on((msg) => {
  if (msg.t === "welcome" && currentRoom === null && !training) showMenu();
  else if (msg.t === "room") {
    if (msg.room !== currentRoom) enterRoom(msg);
  } else if (msg.t === "closed" && msg.room === currentRoom) {
    // a dropped player didn't come back in time: say why on the home screen
    error = `Room ${msg.room} closed: ${msg.reason}.`;
    history.replaceState(null, "", location.pathname);
    showMenu();
  } else if (msg.t === "error") {
    error = msg.message;
    if (currentRoom === null && !training) showMenu();
  }
});

const invite = location.hash.match(/^#\/room\/([A-Za-z]{4})$/);
if (invite) conn.send({ t: "join", room: invite[1].toUpperCase() });
if (location.hash === "#/train") train();
else if (location.hash === "#/archery/practice") practiseArchery();
else showMenu();
