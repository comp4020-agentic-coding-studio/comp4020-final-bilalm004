// The shooter's bow, seen from behind it (task 22): riser, two limbs, a
// string that comes back with the draw and a nocked arrow pointing down the
// range. Primitives only, flat-shaded. The view draws it in its own overlay
// scene so it keeps its size on screen.
//
// Model space: y up, -z down the range (away from the archer). The grip is
// at the origin; the limbs reach up and down and curve forward (-z), the
// string joins their tips behind the grip.
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
} from "three";

export interface BowModel {
  group: Group;
  /**
   * Draw 0..1 pulls the string and arrow back; `loaded`: an arrow is on the
   * string; `side`: the bow hand, -1 left or 1 right (the arrow rests on the
   * side away from the bow hand's thumb, so it swaps).
   */
  set(draw: number, loaded: boolean, side?: -1 | 1): void;
}

const HALF = 0.55; // tip height above (and below) the grip
const BRACE = 0.16; // string's distance behind the grip at rest
const PULL = 0.38; // extra pull at full draw
const ARROW = 0.72;

export function makeBow(): BowModel {
  const group = new Group();
  const wood = new MeshLambertMaterial({ color: 0x8b5a2b, flatShading: true });
  const dark = new MeshLambertMaterial({ color: 0x2b2b2b, flatShading: true });
  group.add(new Mesh(new BoxGeometry(0.045, 0.34, 0.06), wood));
  const grip = new Mesh(new BoxGeometry(0.055, 0.11, 0.075), dark);
  group.add(grip);

  // each limb: from the riser's end, out to the tip, curving forward (-z) and
  // back again at the end (a recurve), as a tube along a curve
  const tips: Vector3[] = [];
  for (const dir of [1, -1]) {
    const start = new Vector3(0, dir * 0.16, 0);
    const mid = new Vector3(0, dir * 0.42, -0.12);
    const tip = new Vector3(0, dir * HALF, 0.02);
    tips.push(tip);
    group.add(new Mesh(new TubeGeometry(new QuadraticBezierCurve3(start, mid, tip), 10, 0.016, 5), wood));
  }

  const stringGeo = new BufferGeometry();
  group.add(new Line(stringGeo, new LineBasicMaterial({ color: 0xf8f9fa })));

  // the arrow lies along -z, its nock at the origin of its group
  const arrow = new Group();
  const shaft = new Mesh(new CylinderGeometry(0.006, 0.006, ARROW, 6), new MeshLambertMaterial({ color: 0xd9b26f }));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -ARROW / 2;
  const head = new Mesh(new ConeGeometry(0.013, 0.05, 6), new MeshLambertMaterial({ color: 0x868e96 }));
  head.rotation.x = -Math.PI / 2;
  head.position.z = -ARROW - 0.02;
  const fletch = new Mesh(new ConeGeometry(0.02, 0.09, 3), new MeshLambertMaterial({ color: 0xffd43b }));
  fletch.rotation.x = -Math.PI / 2;
  fletch.position.z = -0.07;
  arrow.add(shaft, head, fletch);
  group.add(arrow);

  const set = (draw: number, loaded: boolean, side: -1 | 1 = -1) => {
    const d = Math.max(0, Math.min(1, draw));
    const nock = new Vector3(0, 0, BRACE + PULL * d);
    // a drawn bow's tips come in a little
    const bend = 1 - 0.08 * d;
    const top = new Vector3(0, tips[0].y * bend, tips[0].z + 0.04 * d);
    const bottom = new Vector3(0, tips[1].y * bend, tips[1].z + 0.04 * d);
    stringGeo.setFromPoints([top, nock, bottom]);
    arrow.visible = loaded;
    // resting on the grip's side, nock on the string
    // a left-hand bow rests the arrow on its right of the riser, and vice versa
    arrow.position.set(-0.03 * side, 0.01, nock.z);
  };
  set(0, true);
  return { group, set };
}
