import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Scene, SphereGeometry, Vector3 } from "three";
import type { AidArc, AidLanding, Point3, ShownStrength, Timing } from "./trajectory-aid.ts";

// The trajectory aid on the court: three timing arcs (the lit one bright,
// the others greyed), light/medium/hard depth ticks on the lit arc, and after
// your hit the real arc in their place. Instanced spheres and a few rings.

const ARC_MAX = 40;
const IN_COLOR = new Color(0xffffff);
const OUT_COLOR = new Color(0xff5a5a);
const DIM_COLOR = new Color(0x9aa6b2);
const TICK_COLOR = new Color(0xffffff);
const PICK_COLOR = new Color(0xffd23f);
const REAL_COLOR = new Color(0xffd23f);

export interface AidFx {
  /** Show the three timing arcs with `lit` bright and the others greyed, or hide them (null). Returns arcs drawn. */
  arcs(arcs: readonly AidArc[] | null, lit: Timing | null): number;
  /** Light, medium and hard landings with the shown strength picked, or hide them (null). */
  ticks(ticks: readonly AidLanding[] | null, strength: ShownStrength): void;
  /** Show the real arc of the shot just hit, or hide it (null). Returns points drawn. */
  real(path: readonly Point3[] | null): number;
}

export function createAidFx(scene: Scene): AidFx {
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();
  const dot = new SphereGeometry(0.07, 6, 4);

  const line = (color: Color) => {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new InstancedMesh(dot, mat, ARC_MAX);
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, mat };
  };
  const draw = (mesh: InstancedMesh, path: readonly Point3[] | null, scale = 1): number => {
    if (!path || path.length < 2) {
      mesh.count = 0;
      return 0;
    }
    const stepBy = Math.max(1, Math.ceil(path.length / ARC_MAX));
    let n = 0;
    for (let i = 0; i < path.length && n < ARC_MAX; i += stepBy) {
      const pt = path[i];
      m.compose(p.set(pt.x, Math.max(0.03, pt.y), pt.z), q, sc.setScalar(scale));
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    return n;
  };

  const three = [line(IN_COLOR), line(IN_COLOR), line(IN_COLOR)];
  const realLine = line(REAL_COLOR);

  const ring = (inner: number, outer: number) => {
    const mesh = new Mesh(new RingGeometry(inner, outer, 20), new MeshBasicMaterial({ color: TICK_COLOR, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };
  const ticks = [ring(0.16, 0.26), ring(0.16, 0.26), ring(0.16, 0.26)];
  // slides between the ticks with the peak speed of a camera swing in progress
  const slider = ring(0, 0.14);
  (slider.material as MeshBasicMaterial).color.copy(PICK_COLOR);

  const at = (l: AidLanding, mesh: Mesh) => mesh.position.set(l.x, 0.035, l.z);

  return {
    arcs(arcs, lit) {
      let drawn = 0;
      three.forEach(({ mesh, mat }, i) => {
        const arc = arcs?.[i];
        if (!arc) {
          mesh.count = 0;
          return;
        }
        const on = arc.timing === lit;
        mat.color.copy(on ? (arc.in ? IN_COLOR : OUT_COLOR) : DIM_COLOR);
        mat.opacity = on ? 0.95 : 0.45;
        // the lit arc on top of the greyed ones where they overlap near contact
        mesh.renderOrder = on ? 2 : 1;
        if (draw(mesh, arc.path, on ? 1.4 : 1) > 0) drawn++;
      });
      return drawn;
    },

    ticks(landings, strength) {
      if (!landings) {
        for (const t of ticks) t.visible = false;
        slider.visible = false;
        return;
      }
      landings.forEach((t, l) => {
        const mesh = ticks[l];
        at(t, mesh);
        mesh.visible = true;
        const picked = l === strength.level;
        (mesh.material as MeshBasicMaterial).color.copy(picked ? PICK_COLOR : t.in ? TICK_COLOR : OUT_COLOR);
        mesh.scale.setScalar(picked ? 1.5 : 1);
      });
      if (strength.live) {
        const i = Math.min(1, Math.floor(strength.position));
        const k = strength.position - i;
        const a = landings[i];
        const b = landings[i + 1];
        slider.position.set(a.x + (b.x - a.x) * k, 0.04, a.z + (b.z - a.z) * k);
        slider.visible = true;
      } else slider.visible = false;
    },

    real(path) {
      return draw(realLine.mesh, path, 1.2);
    },
  };
}
