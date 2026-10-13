# Crit 9 — All at once

## What was the breakthrough that moved the work forward?

In a real-time game, network latency matters a lot to how the game feels, but it is hard to test by hand. The breakthrough was getting Claude to write tests that model the network and simulate games, so I could see how delays affect play and whether a countermeasure actually helps. One example is giving players some leeway to hit the ball when lag makes their swing arrive late. Having tests and results to point to gave me much more confidence in the approach than playing it and guessing.

## What did this work change about who I want to be as a software developer?

Test writing used to feel like a tedious task, though very important. With Claude I can generate them quickly, and the back and forth makes me think through more cases, so I cover more ground and become more confident that the feature is aligned to how I wanted it to behave. As a developer, with tests getting generated so fast, I want to, and have already found myself, spend more time actually considering behaviours to cover/look for.