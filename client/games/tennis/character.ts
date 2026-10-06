import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import type { ArmPose } from "../../input/camera/pose.ts";

// A Mii-style player built from primitives: big round head with a drawn face,
// tapered torso and limbs, bright top, dark trousers, oval racket. Local
// forward is -z (toward the net for seat 0); the racket is in the right hand
// (+x), and a left-handed player is the mirror image.

const SKIN = 0xf3cfae;
const TROUSERS = 0x2b303b;
const SHOES = 0x4b5160;

const smooth = (color: number) => new MeshLambertMaterial({ color });

let faceTexture: CanvasTexture | null = null;
/** One shared face, drawn on the part of the sphere that faces -z. */
function face(): CanvasTexture {
  if (faceTexture) return faceTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#f3cfae";
  g.fillRect(0, 0, 256, 128);
  // a SphereGeometry's u = 0.75 faces -z
  const cx = 192;
  g.fillStyle = "#2a1d14";
  for (const dx of [-11, 11]) {
    g.beginPath();
    g.ellipse(cx + dx, 56, 3.2, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#5a3b25";
  g.lineWidth = 2.5;
  g.lineCap = "round";
  for (const dx of [-11, 11]) {
    g.beginPath();
    g.moveTo(cx + dx - 5, 46 + (dx < 0 ? 1 : 0));
    g.lineTo(cx + dx + 5, 46 + (dx < 0 ? 0 : 1));
    g.stroke();
  }
  g.strokeStyle = "#c9967a";
  g.beginPath();
  g.moveTo(cx, 60);
  g.lineTo(cx - 1.5, 67);
  g.stroke();
  g.strokeStyle = "#8a3a2c";
  g.lineWidth = 2.2;
  g.beginPath();
  g.arc(cx, 70, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  faceTexture = new CanvasTexture(canvas);
  faceTexture.colorSpace = SRGBColorSpace;
  return faceTexture;
}

let stringsTexture: CanvasTexture | null = null;
function strings(): CanvasTexture {
  if (stringsTexture) return stringsTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.strokeStyle = "rgba(245,245,245,0.9)";
  g.lineWidth = 1;
  for (let i = 2; i < 32; i += 4) {
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, 32);
    g.moveTo(0, i + 0.5);
    g.lineTo(32, i + 0.5);
    g.stroke();
  }
  stringsTexture = new CanvasTexture(canvas);
  stringsTexture.wrapS = stringsTexture.wrapT = RepeatWrapping;
  stringsTexture.repeat.set(2, 2);
  return stringsTexture;
}

function racket(frameColor: number): Group {
  const r = new Group();
  const head = new Mesh(new TorusGeometry(0.2, 0.025, 6, 20), smooth(frameColor));
  head.scale.set(0.82, 1.15, 1);
  head.position.y = 0.48;
  const face = new Mesh(
    new CircleGeometry(0.2, 20),
    new MeshBasicMaterial({ map: strings(), transparent: true, side: DoubleSide, depthWrite: false }),
  );
  face.scale.copy(head.scale);
  face.position.y = 0.48;
  const throat = new Mesh(new CylinderGeometry(0.018, 0.022, 0.2, 6), smooth(frameColor));
  throat.position.y = 0.2;
  const grip = new Mesh(new CylinderGeometry(0.03, 0.03, 0.18, 8), smooth(0x22252c));
  grip.position.y = 0.04;
  r.add(head, face, throat, grip);
  return r;
}

export interface Player {
  group: Group;
  /**
   * `swing` 0..1 through a stroke, or null at rest. `backhand` swings (or, at
   * rest, holds the racket) across the body. `side` 1 is right-handed. `aim`
   * (-1 left .. 1 right, as the player sees it) turns the ready arm toward it.
   */
  pose(swing: number | null, backhand: boolean, side: 1 | -1, aim?: number): void;
  /**
   * Copy a real arm (camera "follow" mode): upper arm and forearm point where
   * the player's do, smoothed between camera frames. The racket carries on
   * from the forearm; `backhand` turns its face over.
   */
  follow(arm: ArmPose, backhand: boolean, side: 1 | -1): void;
}

const DOWN = new Vector3(0, -1, 0);
// how far toward a new camera reading the arm moves each rendered frame
const FOLLOW_SMOOTHING = 0.45;

export function makePlayer(shirt: number, hair: number, racketColor: number): Player {
  const group = new Group();
  // everything that mirrors for a left-hander
  const body = new Group();
  group.add(body);

  const shadow = new Mesh(new CircleGeometry(0.45, 16), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);

  const trousers = smooth(TROUSERS);
  for (const x of [-0.11, 0.11]) {
    const leg = new Mesh(new CapsuleGeometry(0.085, 0.62, 4, 8), trousers);
    leg.position.set(x, 0.42, 0);
    const shoe = new Mesh(new CapsuleGeometry(0.07, 0.12, 4, 8), smooth(SHOES));
    shoe.rotation.x = Math.PI / 2;
    shoe.position.set(x, 0.06, -0.04);
    body.add(leg, shoe);
  }

  const top = smooth(shirt);
  const torso = new Mesh(new CylinderGeometry(0.2, 0.17, 0.62, 12), top);
  torso.position.y = 1.08;
  const shoulders = new Mesh(new SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), top);
  shoulders.position.y = 1.38;
  shoulders.scale.set(1, 0.45, 0.85);
  const neck = new Mesh(new CylinderGeometry(0.06, 0.07, 0.1, 8), smooth(SKIN));
  neck.position.y = 1.47;
  body.add(torso, shoulders, neck);

  const head = new Mesh(new SphereGeometry(0.3, 20, 14), new MeshLambertMaterial({ map: face() }));
  head.position.y = 1.78;
  head.scale.set(1, 1.08, 1);
  // hair: a cap over the top and the back of the head
  const hairMat = smooth(hair);
  const cap = new Mesh(new SphereGeometry(0.315, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.36), hairMat);
  cap.position.y = 1.79;
  cap.scale.copy(head.scale);
  const back = new Mesh(new SphereGeometry(0.312, 16, 10, 0, Math.PI, 0, Math.PI * 0.62), hairMat);
  back.position.y = 1.78;
  back.scale.copy(head.scale);
  body.add(head, cap, back);

  // the off arm hangs relaxed
  const offArm = new Group();
  offArm.position.set(-0.24, 1.36, 0);
  const offSleeve = new Mesh(new CapsuleGeometry(0.06, 0.46, 4, 8), top);
  offSleeve.position.y = -0.27;
  const offHand = new Mesh(new SphereGeometry(0.065, 8, 6), smooth(SKIN));
  offHand.position.y = -0.56;
  offArm.add(offSleeve, offHand);
  offArm.rotation.z = -0.12;
  body.add(offArm);

  // Racket arm: a shoulder pivot with the arm hanging along -y. Euler order
  // YXZ: x raises the arm forward (toward -z), then y turns it around the body
  // (positive y swings it across to the left), so a raised arm can sweep.
  const arm = new Group();
  arm.rotation.order = "YXZ";
  arm.position.set(0.24, 1.36, 0);
  const upperSleeve = new Mesh(new CapsuleGeometry(0.06, 0.2, 4, 8), top);
  upperSleeve.position.y = -0.14;
  // the elbow bends only when copying a real arm; canned strokes keep it straight
  const elbow = new Group();
  elbow.position.y = -0.27;
  const foreSleeve = new Mesh(new CapsuleGeometry(0.055, 0.18, 4, 8), top);
  foreSleeve.position.y = -0.13;
  const hand = new Mesh(new SphereGeometry(0.065, 8, 6), smooth(SKIN));
  hand.position.y = -0.29;
  // wrist: at rotation.x = PI the racket carries on along the arm; more than
  // PI tips the head up. `roll` spins it about its own shaft: 0 shows the
  // strings to the camera behind, PI/2 stands the face on edge for a swing.
  const wrist = new Group();
  wrist.position.y = -0.29;
  const roll = new Group();
  roll.add(racket(racketColor));
  wrist.add(roll);
  elbow.add(foreSleeve, hand, wrist);
  arm.add(upperSleeve, elbow);
  body.add(arm);

  const upperTarget = new Quaternion();
  const foreTarget = new Quaternion();
  const toLocal = (v: { out: number; up: number; fwd: number }) => new Vector3(v.out, v.up, -v.fwd).normalize();

  return {
    group,
    follow(pose, backhand, side) {
      body.scale.x = side;
      body.rotation.y = 0;
      upperTarget.setFromUnitVectors(DOWN, toLocal(pose.upper));
      // the forearm's direction relative to the upper arm
      foreTarget.setFromUnitVectors(DOWN, toLocal(pose.fore)).premultiply(upperTarget.clone().invert());
      arm.quaternion.slerp(upperTarget, FOLLOW_SMOOTHING);
      elbow.quaternion.slerp(foreTarget, FOLLOW_SMOOTHING);
      // racket carries on from the forearm, head tipped up a little
      wrist.rotation.x = Math.PI + 0.5;
      roll.rotation.y = backhand ? -Math.PI / 2 : Math.PI / 2;
    },
    pose(swing, backhand, side, aim = 0) {
      body.scale.x = side;
      elbow.quaternion.identity();
      if (swing === null) {
        // ready: arm down and forward, racket head up in front; a backhand
        // holds it across the body. Aim turns the arm a little toward it.
        const turn = -aim * side * 0.35;
        arm.rotation.set(0.75, (backhand ? 0.95 : -0.55) + turn, 0);
        // racket head up, tipped slightly forward
        wrist.rotation.x = Math.PI + 2.1;
        roll.rotation.y = 0;
        body.rotation.y = backhand ? 0.3 : -0.1;
        return;
      }
      const e = Math.sin((swing * Math.PI) / 2);
      // the arm sweeps level with the shoulder, racket carried out in front
      wrist.rotation.x = Math.PI + 0.35;
      roll.rotation.y = Math.PI / 2;
      if (!backhand) {
        // from back on the racket side, across the front to the other side
        arm.rotation.set(1.35, -2.1 + 3.0 * e, 0);
        body.rotation.y = -0.45 + 0.8 * e;
      } else {
        // from back across the body, out in front to the racket side
        arm.rotation.set(1.35, 2.0 - 2.9 * e, 0);
        body.rotation.y = 0.55 - 0.9 * e;
      }
    },
  };
}
