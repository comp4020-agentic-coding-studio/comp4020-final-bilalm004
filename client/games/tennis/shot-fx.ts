import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Scene, SphereGeometry, Vector3 } from "three";

// Shot feedback drawn on the court: a fading trail behind the ball, a mark
// where it lands, and the predicted arc of your next shot. All cheap: two
// instanced meshes and a few rings.

const TRAIL_MS = 300;
const TRAIL_SAMPLE_MS = 18;
const TRAIL_MAX = Math.ceil(TRAIL_MS / TRAIL_SAMPLE_MS) + 1;
const ARC_MAX = 48;
const MARK_MS = 900;
const IN_COLOR = new Color(0xffffff);
const OUT_COLOR = new Color(0xff5a5a);
// the arc while you can't reach the ball yet
const UNREACHABLE_COLOR = new Color(0x9aa6b2);
const GO_HERE_COLOR = new Color(0xffd23f);
const READY_COLOR = new Color(0x4ade80);

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface ShotFx {
  /** Call every frame with the drawn ball position; `active` while the ball is in play. */
  trail(now: number, ball: Point3, active: boolean): number;
  /** The ball just touched down here. */
  bounce(now: number, x: number, z: number, good: boolean): void;
  /**
   * Your next shot's flight, or null to hide it. It starts where you'll meet
   * the ball; until you're within reach of that spot it is greyed out, and a
   * ring on your baseline shows where to go.
   */
  arc(path: readonly Point3[] | null, good: boolean, reachable: boolean): number;
  /** Fade the bounce marks; call every frame. */
  update(now: number): void;
}

export function createShotFx(scene: Scene): ShotFx {
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();

  const trailMesh = new InstancedMesh(
    new SphereGeometry(0.2, 8, 6),
    new MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.4, depthWrite: false }),
    TRAIL_MAX,
  );
  trailMesh.count = 0;
  trailMesh.frustumCulled = false;
  const samples: (Point3 & { t: number })[] = [];

  const arcMat = new MeshBasicMaterial({ color: IN_COLOR, transparent: true, opacity: 0.85, depthWrite: false });
  const arcMesh = new InstancedMesh(new SphereGeometry(0.055, 6, 4), arcMat, ARC_MAX);
  arcMesh.count = 0;
  arcMesh.frustumCulled = false;
  const contactMat = new MeshBasicMaterial({ color: GO_HERE_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
  const contact = new Mesh(new RingGeometry(0.28, 0.42, 24), contactMat);
  contact.rotation.x = -Math.PI / 2;
  contact.visible = false;
  scene.add(contact);

  const marks = Array.from({ length: 3 }, () => {
    const mesh = new Mesh(new RingGeometry(0.12, 0.3, 20), new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, at: -Infinity };
  });
  let nextMark = 0;

  scene.add(trailMesh, arcMesh);

  return {
    trail(now, ball, active) {
      if (!active) {
        samples.length = 0;
        trailMesh.count = 0;
        return 0;
      }
      const last = samples.at(-1);
      if (!last || now - last.t >= TRAIL_SAMPLE_MS) samples.push({ x: ball.x, y: ball.y, z: ball.z, t: now });
      while (samples.length && now - samples[0].t > TRAIL_MS) samples.shift();
      if (samples.length > TRAIL_MAX) samples.splice(0, samples.length - TRAIL_MAX);
      samples.forEach((s, i) => {
        // older samples shrink away
        const k = 0.15 + 0.85 * (1 - (now - s.t) / TRAIL_MS);
        m.compose(p.set(s.x, s.y, s.z), q, sc.setScalar(k));
        trailMesh.setMatrixAt(i, m);
      });
      trailMesh.count = samples.length;
      trailMesh.instanceMatrix.needsUpdate = true;
      return samples.length;
    },

    bounce(now, x, z, good) {
      const mark = marks[nextMark];
      nextMark = (nextMark + 1) % marks.length;
      mark.at = now;
      mark.mesh.position.set(x, 0.025, z);
      (mark.mesh.material as MeshBasicMaterial).color.copy(good ? IN_COLOR : OUT_COLOR);
      mark.mesh.visible = true;
    },

    arc(path, good, reachable) {
      if (!path || path.length < 2) {
        arcMesh.count = 0;
        contact.visible = false;
        return 0;
      }
      arcMat.color.copy(!reachable ? UNREACHABLE_COLOR : good ? IN_COLOR : OUT_COLOR);
      arcMat.opacity = reachable ? 0.85 : 0.45;
      contact.visible = true;
      contact.position.set(path[0].x, 0.03, path[0].z);
      contactMat.color.copy(reachable ? READY_COLOR : GO_HERE_COLOR);
      const step = Math.max(1, Math.ceil(path.length / ARC_MAX));
      let n = 0;
      for (let i = 0; i < path.length && n < ARC_MAX; i += step) {
        const pt = path[i];
        m.compose(p.set(pt.x, Math.max(0.03, pt.y), pt.z), q, sc.setScalar(1));
        arcMesh.setMatrixAt(n++, m);
      }
      arcMesh.count = n;
      arcMesh.instanceMatrix.needsUpdate = true;
      return n;
    },

    update(now) {
      for (const mark of marks) {
        if (!mark.mesh.visible) continue;
        const k = (now - mark.at) / MARK_MS;
        if (k >= 1) {
          mark.mesh.visible = false;
          continue;
        }
        mark.mesh.scale.setScalar(1 + 1.4 * k);
        (mark.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - k);
      }
    },
  };
}
