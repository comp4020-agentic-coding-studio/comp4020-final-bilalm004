// The archery range (task 22): grass, a lane, trees and the target, built
// from primitives like tennis's stadium. Flat-shaded, nothing loaded.
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from "three";
import { RINGS, TARGET } from "../../../shared/games/archery/sim.ts";

/** Ring colours from the outside in, in pairs: white, black, blue, red, gold. */
export const RING_COLOURS = [0xf5f5f5, 0xf5f5f5, 0x222222, 0x222222, 0x2f8be0, 0x2f8be0, 0xe03131, 0xe03131, 0xffd43b, 0xffd43b];

const lambert = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

/** The target face with its stand, its face centred at the origin facing +z. */
export function makeTarget(): Group {
  const g = new Group();
  const ring = TARGET.radius / RINGS;
  for (let i = 0; i < RINGS; i++) {
    const outer = TARGET.radius - i * ring;
    const geo = i === RINGS - 1 ? new CircleGeometry(outer, 32) : new RingGeometry(outer - ring, outer, 32);
    const m = new Mesh(geo, new MeshLambertMaterial({ color: RING_COLOURS[i] }));
    m.position.z = 0.002 * i;
    g.add(m);
  }
  // straw boss behind the face
  const boss = new Mesh(new CylinderGeometry(TARGET.radius * 1.15, TARGET.radius * 1.15, 0.3, 20), lambert(0xc9a25a));
  boss.rotation.x = Math.PI / 2;
  boss.position.z = -0.16;
  g.add(boss);
  const legMat = lambert(0x6b4f33);
  for (const sx of [-1, 1]) {
    const leg = new Mesh(new BoxGeometry(0.08, TARGET.centerY + 0.7, 0.08), legMat);
    leg.position.set(sx * 0.45, -TARGET.centerY / 2 + 0.05, -0.35);
    leg.rotation.x = -0.18;
    g.add(leg);
  }
  return g;
}

/** Grass, a mown lane to `farthest` metres, lights, sky and a ring of trees. */
export function buildRange(scene: Scene, farthest: number): void {
  scene.background = new Color(0x9fd3f5);
  scene.add(new HemisphereLight(0xdff2ff, 0x5a7a3a, 1.1));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  const grass = new Mesh(new PlaneGeometry(400, 400), lambert(0x6fbf4a));
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = -farthest / 2;
  scene.add(grass);
  const lane = new Mesh(new PlaneGeometry(6, farthest + 10), lambert(0x86d05e));
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.01, -farthest / 2 + 2);
  scene.add(lane);
  // distance markers every 10 m along the lane
  const markMat = lambert(0xffffff);
  for (let d = 10; d <= farthest; d += 10) {
    for (const sx of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.12, 0.5, 0.12), markMat);
      post.position.set(sx * 3.2, 0.25, -d);
      scene.add(post);
    }
  }

  // trees either side and behind the targets, instanced
  const trunk = new CylinderGeometry(0.15, 0.2, 1.4, 6);
  const crown = new ConeGeometry(1.1, 2.6, 7);
  const spots: Array<[number, number]> = [];
  for (let z = 0; z >= -farthest - 20; z -= 6) {
    spots.push([-9 - ((z * 7) % 5 + 5) % 5, z], [9 + ((z * 3) % 4 + 4) % 4, z - 3]);
  }
  for (let x = -20; x <= 20; x += 4) spots.push([x, -farthest - 18 - (((x * 5) % 3) + 3) % 3]);
  const trunks = new InstancedMesh(trunk, lambert(0x6b4f33), spots.length);
  const crowns = new InstancedMesh(crown, lambert(0x2f8a3a), spots.length);
  const m = new Matrix4();
  spots.forEach(([x, z], i) => {
    trunks.setMatrixAt(i, m.makeTranslation(x, 0.7, z));
    crowns.setMatrixAt(i, m.makeTranslation(x, 2.6, z));
  });
  scene.add(trunks, crowns);
}
