# Weblympics

Weblympics - A webcam-controlled sports game, played against a bot or another person over the web!

Currently: two events - TENNIS and ARCHERY

The shape is built to hold more: a shared game registry, a server that owns the simulation, and a client that just renders whatever the server says. Archery is the second game through it.

## Inspiration

As a kid, I grew up on Wii Sports and Kinect games, where your movement in the real world controlled your character in the game, giving a sense of 'life' and 'immersion' I have not seen much in games today.

As a sort of pay homage to these forms of games, Weblympics uses webcams and pose tracking to allow this level of immersion in a browser tab!

## How it actually works

Stand in front of your webcam. The game reads your body movement and turns them into events - sending these events (not the video) to the server as the action. The server holds the only copy of the match state. Each tick it steps one shared simulation with both players' inputs and broadcasts the result. The client borrows the same pure functions locally to preview a shot's arc, explain a miss, or draw the ball smoothly between updates, but it never decides a hit or a point: the next server snapshot always wins.

The ball is a shared state - exactly one of it, living on the server, not sync copies that can drift apart.

## When lag makes two screens disagree

Every player sees the ball slightly in the past, so an on-time swing can reach the server late. The rule: if the ball was hittable on your screen when you swung, it counts, checked against the server's own record, never your word. It looks back at most your measured lag (capped at 150 ms); a scored point stays scored. Your opponent pays: your return may leave late on their screen. At 150 ms, 100% of on-time swings hit, against 76% without. See [ADR 001](docs/adr/001-who-wins-under-lag.md).

## Playing together

Invite link or room code only; no public room list. Two seats, everyone else watches. The host picks one set, best of three or unlimited (no winner, unrated); both press Ready, camera optional, then a 3 s countdown. A mid-match drop pauses for 30 s: rejoin to resume, or the room closes.

## Controls
In tennis: by default the game walks you to the ball, slower than you can run, so a hard wide shot can still beat you. "Move: lean" under the camera preview lets you shift your shoulders instead. Pick one racket hand when you set up the camera; how you turn it decides the stroke: palm to the screen is a forehand, the back of your hand a backhand. "Train" teaches all this against a ball machine, entirely in your browser.

In archery: hold an imaginary bow. Your front hand aims, pulling the other back sets strength, snapping it forward shoots. A dot shows the landing without wind; reading the wind is up to you.

For the current state, movement was implemented with shoulders, rather than physically stepping to the side, to account for the user satying within the frame of the webcam for actions to be picked up, aswell as considering the amount of space a user may have in the real world to play.

## Why is it 'good'

Currently still working on making the user experience feel more clean. 'Good' here, is aiming to bring back the real-life immersive experience that Wii or Kinetic games used to have, in a simple, easy to run (in the browser) manner, so anyone can just join and play with their friends without hassle. 

