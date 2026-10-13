# Weblympics

Weblympics - A webcam-controlled sports game, played against a bot or another person over the web!

Currently: one event - TENNIS

The shape is built to hold more: a shared game registry, a server that owns the simulation, and a client that just renders whatever the server says. Tennis gets to prove that shape works before a second game joins it.

## Inspiration

As a kid, I grew up on Wii Sports and Kinect games, where your movement in the real world controlled your character in the game, giving a sense of 'life' and 'immersion' I have not seen much in games today.

As a sort of pay homage to these forms of games, Weblympics uses webcams and pose tracking to allow this level of immersion in a browser tab!

## How it actually works

Stand in front of your webcam. The game reads your body movement and turns them into events - sending these events (not the video) to the server as the action. The server holds the only copy of the match state. Each tick it steps one shared simulation with both players' inputs and broadcasts the result. The client borrows the same pure functions locally to preview a shot's arc, explain a miss, or draw the ball smoothly between updates, but it never decides a hit or a point: the next server snapshot always wins.

The ball is a shared state - exactly one of it, living on the server, not sync copies that can drift apart.

## When lag makes two screens disagree

Every player sees the ball slightly in the past, so a swing that looked on time can reach the server late. The rule: if the ball was hittable on your screen when you swung, it counts. The server checks that against its own record of that moment, never your word for it. It only looks back as far as your measured lag (at most 150 ms), and a point already scored stays scored. The cost falls on your opponent, who may see your return leave a moment late. Options and trade-offs are in [ADR 001](docs/adr/001-who-wins-under-lag.md). Status: decided, being built.

## Controls
In tennis specifically: shift your shoulders to move your player along the baseline. Pick one racket hand when you set up the camera — you swing with that same arm throughout — and it's how you turn that hand, not which arm you use, that decides forehand or backhand: palm to the screen is a forehand, the back of your hand is a backhand.

For the current state, movement was implemented with shoulders, rather than physically stepping to the side, to account for the user satying within the frame of the webcam for actions to be picked up, aswell as considering the amount of space a user may have in the real world to play.

## Why is it 'good'

Currently still working on making the user experience feel more clean. 'Good' here, is aiming to bring back the real-life immersive experience that Wii or Kinetic games used to have, in a simple, easy to run (in the browser) manner, so anyone can just join and play with their friends without hassle. 

