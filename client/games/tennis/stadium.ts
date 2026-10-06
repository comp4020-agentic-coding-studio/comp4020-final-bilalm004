import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Fog,
  HemisphereLight,
  DirectionalLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COURT } from "../../../shared/games/tennis/sim.ts";

// The arena, built from primitives so there are no assets to ship. Repeated
// things (crowd, trees, clouds) are instanced: one draw call each.

const W = COURT.halfW;
const L = COURT.halfL;
// grass inside the low walls
const INNER = { halfW: W + 5, halfL: L + 6 };

const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

/** Seeded so the crowd and trees are the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Mown-grass bands across the court, `bands` of them over the plane's length. */
function stripes(light: string, dark: string, bands: number, widthRepeat = 1): CanvasTexture {
  const tex = canvasTexture(1, 2, (g) => {
    g.fillStyle = light;
    g.fillRect(0, 0, 1, 1);
    g.fillStyle = dark;
    g.fillRect(0, 1, 1, 1);
  });
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(widthRepeat, bands / 2);
  return tex;
}

function sky(scene: Scene): void {
  scene.background = canvasTexture(2, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#3d8fe0");
    grad.addColorStop(0.55, "#8cc8f5");
    grad.addColorStop(1, "#d8eefc");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
  });
  scene.fog = new Fog(0xcde8fa, 60, 140);

  // soft clouds: clusters of flattened puffs, high and far
  const rand = rng(7);
  const puff = new IcosahedronGeometry(1, 1);
  const clouds = new InstancedMesh(puff, new MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb8cc }), 40);
  const m = new Matrix4();
  const o = new Object3D();
  let i = 0;
  for (let c = 0; c < 8; c++) {
    const cx = (rand() - 0.5) * 140;
    const cy = 24 + rand() * 14;
    const cz = -70 - rand() * 30;
    for (let p = 0; p < 5; p++) {
      o.position.set(cx + (p - 2) * 3.2 + rand() * 2, cy + rand() * 1.5, cz + rand() * 3);
      const s = 2.6 + rand() * 2.2;
      o.scale.set(s * 1.4, s * 0.7, s);
      o.updateMatrix();
      clouds.setMatrixAt(i++, m.copy(o.matrix));
    }
  }
  clouds.count = i;
  scene.add(clouds);

  // distant hills
  const hills = new Mesh(
    mergeGeometries(
      [-60, -25, 15, 50, 85].map((x, k) => {
        const g = new IcosahedronGeometry(1, 1);
        g.scale(28 + k * 3, 9 + (k % 2) * 5, 14);
        g.translate(x - 15, -2, -95);
        return g;
      }),
    ),
    flat(0x6f9a6a),
  );
  scene.add(hills);
}

function grounds(scene: Scene): void {
  const outside = new Mesh(new PlaneGeometry(220, 220), new MeshLambertMaterial({ color: 0x3f7f45 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.05;

  const inner = new Mesh(
    new PlaneGeometry(INNER.halfW * 2, INNER.halfL * 2),
    new MeshLambertMaterial({ map: stripes("#62b04f", "#55a044", Math.round(INNER.halfL)) }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = -0.02;

  // the court itself, a touch brighter so it stays the focus
  const court = new Mesh(
    new PlaneGeometry(W * 2 + 1.2, L * 2 + 1.2),
    new MeshLambertMaterial({ map: stripes("#6cc257", "#5db04b", 12) }),
  );
  court.rotation.x = -Math.PI / 2;
  court.position.y = -0.01;
  scene.add(outside, inner, court);

  // white lines, merged into one mesh
  const line = (w: number, d: number, x: number, z: number): BufferGeometry => {
    const g = new BoxGeometry(w, 0.02, d);
    g.translate(x, 0.005, z);
    return g;
  };
  const service = L * 0.55;
  const t = 0.1;
  const lines = mergeGeometries([
    line(W * 2 + t, t, 0, L),
    line(W * 2 + t, t, 0, -L),
    line(t, L * 2, -W, 0),
    line(t, L * 2, W, 0),
    line(W * 2, t, 0, service),
    line(W * 2, t, 0, -service),
    line(t, service * 2, 0, 0),
    line(t, 0.35, 0, L - 0.17),
    line(t, 0.35, 0, -L + 0.17),
  ]);
  scene.add(new Mesh(lines, new MeshBasicMaterial({ color: 0xffffff })));
}

function net(scene: Scene): void {
  const width = W * 2 + 0.8;
  const mesh = canvasTexture(64, 16, (g) => {
    g.clearRect(0, 0, 64, 16);
    g.strokeStyle = "rgba(20,24,28,0.85)";
    g.lineWidth = 1;
    for (let x = 0.5; x < 64; x += 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 16);
      g.stroke();
    }
    for (let y = 0.5; y < 16; y += 4) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(64, y);
      g.stroke();
    }
  });
  mesh.wrapS = mesh.wrapT = RepeatWrapping;
  mesh.repeat.set(width / 1.2, 1);
  const netPlane = new Mesh(
    new PlaneGeometry(width, COURT.netH - 0.08),
    new MeshBasicMaterial({ map: mesh, transparent: true, side: DoubleSide, depthWrite: false }),
  );
  netPlane.position.y = (COURT.netH - 0.08) / 2;

  const band = new Mesh(new BoxGeometry(width, 0.08, 0.04), new MeshBasicMaterial({ color: 0xffffff }));
  band.position.y = COURT.netH - 0.04;
  const post = new CylinderGeometry(0.06, 0.06, COURT.netH + 0.1, 8);
  const posts = new Mesh(
    mergeGeometries([post.clone().translate(-width / 2, (COURT.netH + 0.1) / 2, 0), post.translate(width / 2, (COURT.netH + 0.1) / 2, 0)]),
    flat(0x1f5f34),
  );
  scene.add(netPlane, band, posts);
}

interface Stand {
  /** centre of the stand's front edge */
  x: number;
  z: number;
  /** length along the wall */
  length: number;
  /** rotation about y: the stand rises away from the court */
  angle: number;
}

const TIERS = 6;
const TIER_DEPTH = 1.1;
const TIER_RISE = 0.6;
const WALL_H = 1;

function stands(scene: Scene): void {
  const list: Stand[] = [
    { x: -(INNER.halfW + 0.6), z: -2, length: INNER.halfL * 2 - 4, angle: Math.PI / 2 },
    { x: INNER.halfW + 0.6, z: -2, length: INNER.halfL * 2 - 4, angle: -Math.PI / 2 },
    { x: 0, z: -(INNER.halfL + 0.6), length: INNER.halfW * 2 - 2, angle: 0 },
  ];

  const steps: BufferGeometry[] = [];
  const trims: BufferGeometry[] = [];
  const roofs: BufferGeometry[] = [];
  const seats: Matrix4[] = [];
  const o = new Object3D();

  for (const s of list) {
    o.position.set(s.x, 0, s.z);
    o.rotation.set(0, s.angle, 0);
    o.updateMatrix();
    const base = o.matrix.clone();
    // local frame: x along the stand, -z away from the court, y up
    for (let t = 0; t < TIERS; t++) {
      const h = WALL_H + (t + 1) * TIER_RISE;
      const step = new BoxGeometry(s.length, h, TIER_DEPTH);
      step.translate(0, h / 2, -(t + 0.5) * TIER_DEPTH);
      steps.push(step.applyMatrix4(base));
      const trim = new BoxGeometry(s.length, 0.06, 0.08);
      trim.translate(0, h + 0.03, -t * TIER_DEPTH - 0.04);
      trims.push(trim.applyMatrix4(base));
      for (let x = -s.length / 2 + 0.4; x < s.length / 2 - 0.3; x += 0.62) {
        seats.push(new Matrix4().makeTranslation(x, h, -(t + 0.55) * TIER_DEPTH).premultiply(base));
      }
    }
    // a canopy over the top rows
    const top = WALL_H + TIERS * TIER_RISE;
    const roof = new BoxGeometry(s.length + 1, 0.15, TIERS * TIER_DEPTH * 0.7);
    roof.rotateX(-0.12);
    roof.translate(0, top + 3.2, -TIERS * TIER_DEPTH * 0.6);
    roofs.push(roof.applyMatrix4(base));
    for (const x of [-s.length / 2, -s.length / 6, s.length / 6, s.length / 2]) {
      const post = new BoxGeometry(0.18, 3.4, 0.18);
      post.translate(x, top + 1.6, -TIERS * TIER_DEPTH + 0.3);
      roofs.push(post.applyMatrix4(base));
    }
  }

  scene.add(new Mesh(mergeGeometries(steps), flat(0x2f8a4a)));
  scene.add(new Mesh(mergeGeometries(trims), new MeshBasicMaterial({ color: 0xf2f5e8 })));
  scene.add(new Mesh(mergeGeometries(roofs), flat(0x2a7a40)));

  // the low wall around the inner grass
  const wall = (w: number, d: number, x: number, z: number) => new BoxGeometry(w, WALL_H, d).translate(x, WALL_H / 2, z);
  const walls = mergeGeometries([
    wall(INNER.halfW * 2 + 0.6, 0.3, 0, -INNER.halfL - 0.15),
    wall(0.3, INNER.halfL * 2, -INNER.halfW - 0.15, 0),
    wall(0.3, INNER.halfL * 2, INNER.halfW + 0.15, 0),
  ]);
  const wallTop = mergeGeometries([
    new BoxGeometry(INNER.halfW * 2 + 0.6, 0.08, 0.34).translate(0, WALL_H, -INNER.halfL - 0.15),
    new BoxGeometry(0.34, 0.08, INNER.halfL * 2).translate(-INNER.halfW - 0.15, WALL_H, 0),
    new BoxGeometry(0.34, 0.08, INNER.halfL * 2).translate(INNER.halfW + 0.15, WALL_H, 0),
  ]);
  scene.add(new Mesh(walls, flat(0x1e6b38)), new Mesh(wallTop, new MeshBasicMaterial({ color: 0xd8f05a })));

  crowd(scene, seats);
}

const SHIRTS = [0xff5d5d, 0xffb347, 0xfff07a, 0x7ad8ff, 0x5d8bff, 0xc77dff, 0xff7ac8, 0xffffff, 0x7aff9b, 0xff9d5d];
const SKIN = [0xf6d2b0, 0xe8b48c, 0xc68a5e, 0x8d5a3b, 0xfbe0c8];

function crowd(scene: Scene, seats: Matrix4[]): void {
  const rand = rng(42);
  const filled = seats.filter(() => rand() < 0.82);
  const bodies = new InstancedMesh(new BoxGeometry(0.42, 0.55, 0.32), flat(0xffffff), filled.length);
  const heads = new InstancedMesh(new IcosahedronGeometry(0.17, 0), flat(0xffffff), filled.length);
  const color = new Color();
  const m = new Matrix4();
  const lift = new Matrix4();
  filled.forEach((seat, i) => {
    const bob = (rand() - 0.5) * 0.08;
    bodies.setMatrixAt(i, m.copy(seat).multiply(lift.makeTranslation(0, 0.3 + bob, 0)));
    heads.setMatrixAt(i, m.copy(seat).multiply(lift.makeTranslation(0, 0.72 + bob, 0)));
    bodies.setColorAt(i, color.setHex(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
    heads.setColorAt(i, color.setHex(SKIN[Math.floor(rand() * SKIN.length)]));
  });
  scene.add(bodies, heads);
}

function trees(scene: Scene): void {
  const rand = rng(99);
  const spots: [number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    spots.push([side * (INNER.halfW + 14 + rand() * 10), -INNER.halfL - 6 + rand() * (INNER.halfL * 2 + 6)]);
  }
  for (let i = 0; i < 16; i++) spots.push([(rand() - 0.5) * 60, -INNER.halfL - 14 - rand() * 12]);

  const leaves = new InstancedMesh(new ConeGeometry(1.6, 4.2, 7), flat(0x2f7a3a), spots.length);
  const crowns = new InstancedMesh(new IcosahedronGeometry(1.5, 0), flat(0x3d8f45), spots.length);
  const trunks = new InstancedMesh(new CylinderGeometry(0.2, 0.28, 1.6, 6), flat(0x6b4a2f), spots.length);
  const o = new Object3D();
  spots.forEach(([x, z], i) => {
    const s = 0.9 + rand() * 0.8;
    o.scale.setScalar(s);
    o.position.set(x, 0.8 * s, z);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    o.position.set(x, (1.6 + 2.1) * s, z);
    o.updateMatrix();
    leaves.setMatrixAt(i, o.matrix);
    o.position.set(x, (1.6 + 1.2) * s, z);
    o.updateMatrix();
    crowns.setMatrixAt(i, o.matrix);
  });
  scene.add(leaves, crowns, trunks);
}

export function buildStadium(scene: Scene): void {
  scene.add(new HemisphereLight(0xe6f4ff, 0x5a8a4a, 1.5));
  const sun = new DirectionalLight(0xfff6e6, 2.2);
  sun.position.set(8, 16, 10);
  scene.add(sun);
  sky(scene);
  grounds(scene);
  net(scene);
  stands(scene);
  trees(scene);
}
