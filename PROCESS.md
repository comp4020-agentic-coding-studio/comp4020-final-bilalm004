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
