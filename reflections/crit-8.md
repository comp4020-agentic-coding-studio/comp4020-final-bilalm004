# Crit 8 — It's alive!

## What was the breakthrough that moved the work forward?

Playtesting with my own webcam. On paper the camera layer was done: specs
green, swing detection unit-tested on synthetic landmarks. In my hands it
barely worked. Leaning never moved the player, because the first move was
compared against NaN (6a8a25b). Only forehands appeared, because taking the
racket back before a backhand looks like a forehand (e22647b). And the ball
was nearly unhittable: the hit window was a fixed 1.6 m, about 0.1 s at
rally speed, tighter than a webcam can time a swing (e6669a8). None of these
showed up in tests that only checked what I had thought to check. Each one
became a test that fails without its fix, and the window bug also got a miss
label ("too early", "out of reach") so the game tells you why you missed.

## What did this work change about who I want to be as a software developer?

I want to judge "done" by using the thing, not by a green tick. I also
learned to own the process as well as the code. I ran a second agent session
on the menu in parallel, and its unfinished work got swept into a commit and
made the e2e flaky, which nearly let a commit through on red. The fix was a
rule in CLAUDE.md (a49ca27): gate on the test command's exit code, stage
files by name, and verify against a clean build of HEAD. I want to keep
turning mistakes like that into rules the agents follow, rather than hoping
I remember next time.
