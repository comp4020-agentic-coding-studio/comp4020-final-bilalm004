# Visual inspiration

Reference images are in `design/reference/` (local only, gitignored, not in the
Docker image: they are third-party screenshots). They show Wii Sports Tennis:
a gameplay frame, a court overview, a serve, and two Mii-style characters.
Take the look, not the assets: no Nintendo logos, sponsor panels, "Wii Sports"
text, or Mii likenesses.

## What to borrow

- **Camera:** raised and behind the near player, looking down the court at
  roughly 25-35 degrees. Near player sits in the lower third and is large; the
  net spans most of the screen width; the far player is small but readable.
  Ours is lower and flatter, so the far end is hard to read.
- **Court:** mown-grass stripes (alternating light and dark green bands along
  the length) with clean white lines. Ours is a flat green plane.
- **Surroundings:** low green walls and angled stands with blocky,
  multicoloured crowd patches, a bright sky with soft clouds. Keeps the court
  the brightest thing on screen.
- **Characters:** big round head, simple face (dot eyes, line nose and mouth,
  no ears detail), tapered torso and limbs, no fingers, bright top with dark
  trousers. Smooth shading with a soft highlight. Give each seat a clearly
  different top colour. Faces can be a small canvas texture.
- **Ball:** small, saturated yellow-orange, with a visible shadow on the court.
  The shadow is what lets players judge height.
- **Racket:** classic oval head (torus ring plus a translucent strings disc)
  and a short handle, frame in a solid colour. Ours is a flat box.
- **Net:** thin, slightly translucent with a white top band, not a solid slab.
- **Palette:** bright, saturated, friendly. Soft blob shadows under players.

## Constraints

- Stay low-poly and cheap: no post-processing, no heavy textures, small draw
  call count (mobile at 390x844 runs the camera model and the renderer).
- Everything built from primitives in code, so there are no asset files to ship.
- Visual work belongs to task 09, not task 03.
