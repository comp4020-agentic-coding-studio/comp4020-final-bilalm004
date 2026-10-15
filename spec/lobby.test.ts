// Task 4: the room's rules as a pure state machine (server/lobby.ts), with
// the clock passed in, so the 3 s countdown and 30 s hold are checked
// without waiting for them.
import { describe, expect, it } from "vitest";
import { COUNTDOWN_MS, GRACE_MS, Lobby } from "../server/lobby.ts";

/** Two people seated in a fresh two-player room, at time 0. */
function twoSeated(format?: "oneSet" | "bestOfThree" | "unlimited"): Lobby {
  const l = new Lobby(false, format);
  l.sit(l.seatFor("a")!, "a", "Alice", 0);
  l.sit(l.seatFor("b")!, "b", "Bob", 0);
  return l;
}

/** Ready both and run the countdown out, so the match is playing. */
function playing(l: Lobby, now = 0): number {
  l.setReady(0, true, now);
  l.setReady(1, true, now);
  expect(l.tick(now + COUNTDOWN_MS)).toBe("start");
  return now + COUNTDOWN_MS;
}

describe("room phases: waiting -> ready-check -> countdown -> playing", () => {
  it("waits for a second player, then checks readiness, counts down 3 s, then plays", () => {
    const l = new Lobby(false);
    expect(l.phase()).toBe("waiting");
    l.sit(l.seatFor("a")!, "a", "Alice", 0);
    expect(l.phase()).toBe("waiting");
    l.sit(l.seatFor("b")!, "b", "Bob", 0);
    expect(l.phase()).toBe("ready-check");
    expect(l.seats.map((s) => s!.ready)).toEqual([false, false]);

    l.setReady(0, true, 100);
    expect(l.phase()).toBe("ready-check");
    l.setReady(1, true, 200);
    expect(l.phase()).toBe("countdown");
    expect(l.view(200).countdown).toBe(3);
    expect(l.view(1300).countdown).toBe(2);
    expect(l.tick(200 + COUNTDOWN_MS - 1)).toBeNull();
    expect(l.tick(200 + COUNTDOWN_MS)).toBe("start");
    expect(l.phase()).toBe("playing");
    expect(l.view(3300).countdown).toBeNull();
  });

  it("the third arrival is a spectator: no seat, no queue", () => {
    const l = twoSeated();
    expect(l.seatFor("c")).toBeNull();
  });

  it("un-readying cancels the countdown", () => {
    const l = twoSeated();
    l.setReady(0, true, 0);
    l.setReady(1, true, 0);
    expect(l.phase()).toBe("countdown");
    l.setReady(1, false, 1000);
    expect(l.phase()).toBe("ready-check");
    expect(l.tick(10_000)).toBeNull();
    expect(l.phase()).toBe("ready-check");
    // readying again starts a fresh 3 s, not the rest of the old one
    l.setReady(1, true, 10_000);
    expect(l.tick(10_000 + COUNTDOWN_MS - 1)).toBeNull();
    expect(l.tick(10_000 + COUNTDOWN_MS)).toBe("start");
  });

  it("a disconnect before the match un-readies the seat (it is freed) and cancels the countdown", () => {
    const l = twoSeated();
    l.setReady(0, true, 0);
    l.setReady(1, true, 0);
    expect(l.leave(1, 500, true)).toBe("freed");
    expect(l.phase()).toBe("waiting");
    expect(l.tick(10_000)).toBeNull();
    // back again: seated, not ready
    l.sit(l.seatFor("b")!, "b", "Bob", 11_000);
    expect(l.seats[1]!.ready).toBe(false);
    expect(l.phase()).toBe("ready-check");
  });

  it("the host's format change clears both ready flags and cancels the countdown", () => {
    const l = twoSeated();
    expect(l.host).toBe(0);
    l.setReady(0, true, 0);
    l.setReady(1, true, 0);
    expect(l.setFormat(0, "bestOfThree", 1000)).toBe("ok");
    expect(l.format).toBe("bestOfThree");
    expect(l.seats.map((s) => s!.ready)).toEqual([false, false]);
    expect(l.phase()).toBe("ready-check");
    expect(l.tick(10_000)).toBeNull();
  });

  it("only the host picks the format, only before the match, and the same format changes nothing", () => {
    const l = twoSeated();
    l.setReady(0, true, 0);
    expect(l.setFormat(1, "unlimited", 0)).toBe("not host");
    expect(l.setFormat(0, "oneSet", 0)).toBe("same");
    expect(l.seats[0]!.ready).toBe(true);
    playing(l);
    expect(l.setFormat(0, "unlimited", 5000)).toBe("started");
    expect(l.format).toBe("oneSet");
  });

  it("if the host leaves before the match, the other player becomes host", () => {
    const l = twoSeated();
    l.leave(0, 0, false);
    expect(l.host).toBe(1);
  });

  it("ready can't change once the match is playing", () => {
    const l = twoSeated();
    const t = playing(l);
    expect(l.setReady(0, false, t)).toBe(false);
    expect(l.phase()).toBe("playing");
  });

  it("after a finished match the room goes back to the ready check, nobody ready", () => {
    const l = twoSeated();
    playing(l);
    l.endMatch();
    expect(l.phase()).toBe("ready-check");
    expect(l.seats.map((s) => s!.ready)).toEqual([false, false]);
  });
});

describe("practice: the bot is always ready", () => {
  it("plays at once with no countdown, and the bot can't be un-readied or re-formatted", () => {
    const l = new Lobby(true);
    expect(l.seats[1]).toMatchObject({ name: "Bot", ready: true, bot: true });
    l.sit(l.seatFor("a")!, "a", "Alice", 0);
    expect(l.phase()).toBe("playing");
    expect(l.setReady(1, false, 0)).toBe(false);
    expect(l.seats[1]!.ready).toBe(true);
    expect(l.setFormat(0, "unlimited", 0)).toBe("not host");
    // nobody else gets the bot's seat
    expect(l.seatFor("b")).toBeNull();
  });
});

describe("a dropped player's seat is held for 30 s mid-match", () => {
  it("pauses, shows whose seat and the seconds left, and the same token reclaims it and resumes after a countdown", () => {
    const l = twoSeated();
    const t = playing(l);
    expect(l.leave(1, t, true)).toBe("held");
    expect(l.phase()).toBe("paused");
    expect(l.view(t).hold).toEqual({ seat: 1, name: "Bob", seconds: 30 });
    expect(l.view(t + 10_500).hold!.seconds).toBe(20);
    expect(l.seats[1]).toMatchObject({ connected: false, ready: false });
    // nobody else gets it
    expect(l.seatFor("c")).toBeNull();
    // the same token gets it back
    expect(l.seatFor("b")).toBe(1);
    expect(l.sit(1, "b", "Bob", t + 20_000)).toBe(true);
    expect(l.phase()).toBe("countdown");
    // a resume, not a new match: the ready panel stays away
    expect(l.view(t + 20_000).match).toBe(true);
    expect(l.tick(t + 20_000 + COUNTDOWN_MS)).toBe("resume");
    expect(l.phase()).toBe("playing");
    expect(l.view(t + 30_000).hold).toBeNull();
  });

  it("closes the room when the hold runs out", () => {
    const l = twoSeated();
    const t = playing(l);
    l.leave(0, t, true);
    expect(l.tick(t + GRACE_MS - 1)).toBeNull();
    expect(l.tick(t + GRACE_MS)).toBe("close");
  });

  it("uses an injected grace, so tests needn't wait 30 s", () => {
    const l = new Lobby(false, "oneSet", { graceMs: 50, countdownMs: 10 });
    l.sit(0, "a", "A", 0);
    l.sit(1, "b", "B", 0);
    l.setReady(0, true, 0);
    l.setReady(1, true, 0);
    expect(l.tick(10)).toBe("start");
    l.leave(1, 10, true);
    expect(l.tick(60)).toBe("close");
  });

  it("choosing to leave mid-match ends it (no hold) and frees the seat", () => {
    const l = twoSeated();
    const t = playing(l);
    expect(l.leave(1, t, false)).toBe("ended");
    expect(l.phase()).toBe("waiting");
    expect(l.inMatch).toBe(false);
    expect(l.tick(t + GRACE_MS * 2)).toBeNull();
  });

  it("one token on two tabs: the held seat goes to the tab that joins; a tab already seated stays put", () => {
    const l = new Lobby(false);
    // the same token takes both seats (allowed, for testing)
    expect(l.seatFor("same")).toBe(0);
    l.sit(0, "same", "Sam", 0);
    expect(l.seatFor("same")).toBe(1);
    l.sit(1, "same", "Sam", 0);
    expect(l.view(0).seats.map((s) => s!.name)).toEqual(["Sam", "Sam (2)"]);
    const t = playing(l);
    l.leave(1, t, true);
    // a new tab with that token joins: it gets the held seat 1
    expect(l.seatFor("same")).toBe(1);
  });
});
