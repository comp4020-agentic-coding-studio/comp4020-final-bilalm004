# Process overview

Weblympics is a webcam-controlled sports game played over the web. Tennis is the first event, built so the server owns the real match state and the client only renders it. Built as a homage to Wii Sports/Kinetic related games that I grew up on, wanting to bring that style of immersive gameplay back to real life. ([`5a7e715`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/5a7e715)).

Added real-world movement controls - read from the webcam and turned into pose landmarks which become the actual game actions sent to the server
([`78a51fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/78a51fd)).

Because this game is built around how real-world movement feels, not just whether it technically works, I judged that by playing it myself rather than relying on Claude's own testing. I tried different swings and movement sensitivities until they felt right ([`01953da`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/01953da)),
and fixing swings that all looked the same regardless of forehand or backhand
([`e22647b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/e22647b)).

For the visual look, I gave Claude Wii Sports reference screenshots as well as Gemini-generated character and equipment images, rather than describing the look in prose, to help it get closer to what I had in mind.

Which model I used depended on the task. Sonnet 5.5 felt fast and effective for many tasks, but for the more complex task of turning webcam movement into game events, I switched to Opus 5.5
([`575e2fc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/575e2fc)).


Players connect to the server from their own devices, likely on different networks, so each has a different delay and sees the ball slightly in the past. This means that the players' views can disagree, and a swing that was on time from the hitter's point of view can reach the server late, using up part of the "hit window" (the short period in which the ball can be hit), so misses come from lag rather than timing. To make the game playable at higher latencies, I decided to add some leeway. After discussing the options with Claude, we wrote ADR 001 (an architecture decision record: a short document of the options considered, the choice made and what it costs). We chose to judge each swing at the tick the hitter saw, checked against the server's own history. How far back it goes is the player's measured round trip plus 50 ms for jitter, up to a maximum of 150 ms. We don't give everyone a flat 150 ms because then players with a good connection could hit balls that really were late. The cost to the opponent is small: a brief correction at the far end of their court, where the ball is smallest. In simulated tests (`spec/latency.test.ts`, with the network modelled), at a 150 ms round trip on-time swings hit 64.5% of the time without this and 97.8% with it. It was implemented in these commits, with tests at each step:

- [`99a1194`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/99a1194) ADR 001: under lag, judge a swing at the moment the hitter saw
- [`9bf5b0f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/9bf5b0f) Measure lag: per-client round trip, swing and rally logs
- [`3653fc2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/3653fc2) Rewind swings to the tick the player saw, capped by measured lag
- [`85a5e38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/85a5e38) Client sends the tick on screen with each swing, so real players get rewind

To see lag in the real game, the server now logs a `swing_resolve` line for every swing (how far back it was allowed to judge, how far it did, and the outcome) and a `rally` line for every point ([`9bf5b0f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/9bf5b0f)). I also updated `CLAUDE.md` with lessons from this work: restart `dev:server` before `pnpm check` because `node --watch` misses edits on this drive ([`9bf5b0f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/9bf5b0f)), and run e2e with `--workers=1` because parallel software-rendered browsers starve the frame rate and cause false failures ([`85a5e38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/85a5e38)).
