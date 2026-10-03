import * as THREE from 'three';

/**
 * Retro "Stellar Voyager"-style rocket: rounded metal hull, glass canopy,
 * neon ring bands, swept fins with neon edges, triple engine cluster.
 * Built upright along +y with its lowest point (fin tips) at y = 0.
 */

const C = {
  magenta: 0xff2bd6,
  cyan: 0x00f0ff,
  green: 0x3dff9a,
  yellow: 0xffe14d,
  orange: 0xff7a2b,
  violet: 0xb14bff,
};

/** Height of the nozzle exits above the fin tips. */
export const NOZZLE_Y = 2.6;

export interface RocketParts {
  group: THREE.Group;
  /** One flame group per nozzle; scale them to show thrust. */
  flames: THREE.Group[];
  holoRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[];
  engineLight: THREE.PointLight;
}

// Hull silhouette as (radius, y) control points, engine skirt → nose tip.
const HULL: [number, number][] = [
  [4.0, 5], [4.5, 7], [4.9, 10], [5.15, 14], [5.2, 18], [5.05, 22],
  [4.6, 25.5], [3.9, 28.5], [2.9, 31], [1.7, 33.2], [0.6, 35], [0.01, 35.6],
];
const HULL_BOTTOM = HULL[0][1];
const HULL_TOP = HULL[HULL.length - 1][1];

const hullCurve = new THREE.SplineCurve(HULL.map(([r, y]) => new THREE.Vector2(r, y)));
const hullPoints = hullCurve.getPoints(90);

function hullRadiusAt(y: number): number {
  let best = hullPoints[0];
  for (const p of hullPoints) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
  return best.x;
}

// ---------------------------------------------------------------- materials

const metal = (color: number, roughness = 0.45, metalness = 0.5) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.18 });

const neonMat = (color: number) => new THREE.MeshBasicMaterial({ color });

const additive = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// ---------------------------------------------------------------- hull texture

/** Paints the hull: panel lines, vents and the glowing "SPALLION 01" decal. */
function hullTextures() {
  const S = 1024;
  const albedo = document.createElement('canvas');
  const glow = document.createElement('canvas');
  albedo.width = albedo.height = glow.width = glow.height = S;
  const a = albedo.getContext('2d')!;
  const g = glow.getContext('2d')!;

  // v runs bottom (hull skirt) → top (nose); canvas y is flipped.
  const yToPx = (y: number) => S - ((y - HULL_BOTTOM) / (HULL_TOP - HULL_BOTTOM)) * S;
  // u = 0.5 faces the front of the rocket.
  const uToPx = (u: number) => u * S;

  const draw = () => {
    a.fillStyle = '#97a3cb';
    a.fillRect(0, 0, S, S);
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);

    // Panel seams
    a.strokeStyle = '#7f8aad';
    a.lineWidth = 3;
    for (const y of [9, 12.4, 22.6, 26.5]) {
      a.beginPath();
      a.moveTo(0, yToPx(y));
      a.lineTo(S, yToPx(y));
      a.stroke();
    }
    for (const u of [0.18, 0.32, 0.68, 0.82]) {
      a.beginPath();
      a.moveTo(uToPx(u), yToPx(12.4));
      a.lineTo(uToPx(u), yToPx(22.6));
      a.stroke();
    }

    // Slatted vents on both flanks
    for (const u of [0.25, 0.75]) {
      const x = uToPx(u) - 34;
      const top = yToPx(11.8);
      a.fillStyle = '#39436a';
      a.fillRect(x, top, 68, yToPx(9.4) - top);
      a.strokeStyle = '#8d98bf';
      a.lineWidth = 3;
      for (let i = 1; i < 5; i++) {
        const yy = top + ((yToPx(9.4) - top) * i) / 5;
        a.beginPath();
        a.moveTo(x + 6, yy);
        a.lineTo(x + 62, yy);
        a.stroke();
      }
    }

    // Decal, written along the hull so it reads bottom → top.
    const cx = uToPx(0.5);
    const cy = (yToPx(10.5) + yToPx(21.8)) / 2;
    for (const ctx of [a, g]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 2);

      // Inverted triangle badge
      ctx.beginPath();
      ctx.moveTo(-185, -62);
      ctx.lineTo(185, -62);
      ctx.lineTo(0, 92);
      ctx.closePath();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ff2bd6';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 54px Orbitron, sans-serif';
      const grad = ctx.createLinearGradient(-180, 0, 180, 0);
      grad.addColorStop(0, '#5ff6ff');
      grad.addColorStop(1, '#ff6ad5');
      if (ctx === a) {
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#1a0830';
        ctx.strokeText('SPALLION', 0, -18);
      }
      ctx.fillStyle = grad;
      ctx.fillText('SPALLION', 0, -18);

      ctx.font = '700 34px Orbitron, sans-serif';
      ctx.fillStyle = '#ffe14d';
      ctx.fillText('01', 0, 34);
      ctx.restore();
    }
  };

  draw();
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const emissiveMap = new THREE.CanvasTexture(glow);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  // Redraw once the display font has loaded so the decal uses Orbitron.
  document.fonts?.load('900 54px Orbitron').then(() => {
    draw();
    map.needsUpdate = true;
    emissiveMap.needsUpdate = true;
  }).catch(() => {});

  return { map, emissiveMap };
}

// ---------------------------------------------------------------- parts

function ringBand(y: number, color: number, tube = 0.2, extra = 0.06) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(hullRadiusAt(y) + extra, tube, 10, 64), neonMat(color));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  return ring;
}

function buildHull() {
  const geo = new THREE.LatheGeometry(hullPoints, 64, Math.PI); // phiStart = π puts the UV seam at the back
  // Re-map v linearly by height so the painted texture isn't stretched.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) - HULL_BOTTOM) / (HULL_TOP - HULL_BOTTOM));
  uv.needsUpdate = true;

  const { map, emissiveMap } = hullTextures();
  const mat = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.4,
    roughness: 0.55, metalness: 0.35, envMapIntensity: 0.12,
  });
  return new THREE.Mesh(geo, mat);
}

function buildCanopy() {
  const group = new THREE.Group();
  const y = 25.4;
  const z = hullRadiusAt(y) - 0.45;
  const scale = new THREE.Vector3(1.1, 1.6, 0.8);

  // Dark cockpit interior so the hull doesn't show through the glass
  const back = new THREE.Mesh(new THREE.CircleGeometry(2.55, 32), new THREE.MeshBasicMaterial({ color: 0x120624 }));
  back.scale.set(scale.x, scale.y, 1);
  back.position.set(0, y, z + 0.4);
  group.add(back);

  // Glowing control panel lights
  const lights = [C.green, C.magenta, C.cyan, C.yellow, C.green, C.magenta];
  lights.forEach((color, i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.2), neonMat(color));
    b.position.set(-1.1 + (i % 3) * 1.1, y - 1.6 + Math.floor(i / 3) * 0.8, z + 0.6);
    group.add(b);
  });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.4), metal(0x2a1f4f, 0.6, 0.2));
  seat.position.set(0, y + 0.9, z + 0.55);
  group.add(seat);

  // Glass dome
  const domeGeo = new THREE.SphereGeometry(2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.rotateX(Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshPhysicalMaterial({
    color: 0x9b7bff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 0.5, depthWrite: false,
  }));
  dome.scale.copy(scale);
  dome.position.set(0, y, z);
  group.add(dome);

  // Metal frame + neon trim
  const frame = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.32, 10, 48), metal(0xa9b6dc));
  frame.scale.set(scale.x, scale.y, 1);
  frame.position.set(0, y, z);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.09, 6, 48), neonMat(C.magenta));
  trim.scale.copy(frame.scale);
  trim.position.set(0, y, z - 0.05);
  group.add(frame, trim);
  return group;
}

function buildSidePipes() {
  const group = new THREE.Group();
  for (const angle of [-0.95, 0.95]) {
    const r = hullRadiusAt(14) + 0.75;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 10.5, 12), neonMat(C.magenta));
    pipe.position.set(x, 14.2, z);
    group.add(pipe);
    for (const y of [9.4, 19]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), metal(0x8e9bc4));
      cap.position.set(x, y, z);
      group.add(cap);
    }
  }
  return group;
}

function boltBadge() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CircleGeometry(1.15, 24), new THREE.MeshBasicMaterial({ color: 0x1b2a5c, side: THREE.DoubleSide })));
  const bolt = new THREE.Shape([
    new THREE.Vector2(0.15, 0.85), new THREE.Vector2(-0.45, -0.05), new THREE.Vector2(-0.02, -0.05),
    new THREE.Vector2(-0.2, -0.85), new THREE.Vector2(0.45, 0.1), new THREE.Vector2(0.03, 0.1),
  ]);
  const b = new THREE.Mesh(new THREE.ShapeGeometry(bolt), new THREE.MeshBasicMaterial({ color: C.yellow, side: THREE.DoubleSide }));
  b.position.z = 0.01;
  group.add(b);
  return group;
}

function buildFins() {
  const group = new THREE.Group();
  // Swept fin outline in (outward, up), rooted at the hull.
  const outline = [
    new THREE.Vector2(0, 15), new THREE.Vector2(2.5, 11.5), new THREE.Vector2(6.5, 4.5),
    new THREE.Vector2(7.5, 0), new THREE.Vector2(6.2, -0.9), new THREE.Vector2(4.8, 2.4), new THREE.Vector2(0, 4.4),
  ];
  const finGeo = new THREE.ExtrudeGeometry(new THREE.Shape(outline), {
    depth: 0.6, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2,
  });
  finGeo.translate(0, 0, -0.3);
  const edgeCurve = new THREE.CatmullRomCurve3(outline.slice(0, 5).map((p) => new THREE.Vector3(p.x + 0.1, p.y, 0)));
  const edgeGeo = new THREE.TubeGeometry(edgeCurve, 48, 0.3, 8, false);
  const edgeColors = [C.cyan, C.green, C.magenta, C.cyan];

  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI / 4 + (i * Math.PI) / 2;
    const fin = new THREE.Group();
    fin.position.set(3.7, 0.9, 0);
    fin.add(new THREE.Mesh(finGeo, metal(0x9fb0d8)));
    fin.add(new THREE.Mesh(edgeGeo, neonMat(edgeColors[i])));
    for (const side of [1, -1]) {
      const badge = boltBadge();
      badge.position.set(3.4, 6, side * 0.47);
      if (side < 0) badge.rotation.y = Math.PI;
      badge.scale.setScalar(0.9);
      fin.add(badge);
    }
    holder.add(fin);
    group.add(holder);
  }
  return group;
}

function buildEngines(): { group: THREE.Group; flames: THREE.Group[]; nozzles: THREE.Vector3[] } {
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 3.5, 2.6, 32), metal(0x3d4a78, 0.4, 0.7));
  housing.position.y = 3.7 + 0.1;
  group.add(housing, ringBand(5, C.cyan, 0.16));

  const bellProfile = [new THREE.Vector2(1.15, 3.4), new THREE.Vector2(1.35, 2.7), new THREE.Vector2(1.85, 1.2), new THREE.Vector2(2.15, 0)];
  const bellGeo = new THREE.LatheGeometry(bellProfile, 32);
  const bellMat = metal(0x59627f, 0.35, 0.8);
  bellMat.side = THREE.DoubleSide;

  const flames: THREE.Group[] = [];
  const nozzles: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const p = new THREE.Vector3(Math.sin(a) * 2.1, 0, Math.cos(a) * 2.1);
    nozzles.push(p);

    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.position.copy(p);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.15, 8, 40), neonMat(C.orange));
    lip.rotation.x = Math.PI / 2;
    lip.position.copy(p).setY(0.1);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.1, 6, 32), neonMat(C.magenta));
    collar.rotation.x = Math.PI / 2;
    collar.position.copy(p).setY(2.7);
    group.add(bell, lip, collar);

    // Layered flame: violet sheath, orange body, hot core (apex pointing down).
    const flame = new THREE.Group();
    flame.position.copy(p);
    const layers: [number, number, number, number][] = [
      [2.0, 17, C.violet, 0.4],
      [1.5, 11, C.orange, 0.5],
      [0.85, 6, 0xfff3b0, 0.65],
    ];
    for (const [radius, length, color, opacity] of layers) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 20, 1, true), additive(color, opacity));
      cone.rotation.x = Math.PI;
      cone.position.y = -length / 2;
      flame.add(cone);
    }
    flame.visible = false;
    flames.push(flame);
    group.add(flame);
  }
  return { group, flames, nozzles };
}

function buildNoseGear() {
  const group = new THREE.Group();
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 4.4, 8), metal(0xb7c3e6));
  spike.position.y = HULL_TOP + 2;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), neonMat(C.magenta));
  tip.position.y = HULL_TOP + 4.3;
  group.add(spike, tip);

  // Coiled wire around the antenna
  const coil: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    coil.push(new THREE.Vector3(Math.cos(t * Math.PI * 8) * 0.55, HULL_TOP + 0.4 + t * 3, Math.sin(t * Math.PI * 8) * 0.55));
  }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 120, 0.05, 5), neonMat(C.magenta)));

  // Two little satellite dishes on the nose
  const dishGeo = new THREE.SphereGeometry(1.15, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2);
  dishGeo.translate(0, -1.15, 0);
  for (const side of [1, -1]) {
    const y = 30.5;
    const r = hullRadiusAt(y);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), metal(0xb7c3e6));
    mount.rotation.z = Math.PI / 2;
    mount.position.set(side * (r + 0.6), y, 0.6);
    const dish = new THREE.Mesh(dishGeo, Object.assign(metal(0x9fe9ff, 0.25, 0.5), { side: THREE.DoubleSide }));
    dish.position.set(side * (r + 1.5), y + 0.3, 0.6);
    dish.rotation.z = side * (Math.PI / 2 + 0.5);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 24), neonMat(C.cyan));
    rim.position.copy(dish.position);
    rim.rotation.copy(dish.rotation);
    rim.rotateX(Math.PI / 2);
    group.add(mount, dish, rim);
  }
  return group;
}

export function buildRocket(): RocketParts {
  const group = new THREE.Group();
  const ship = new THREE.Group();
  ship.position.y = NOZZLE_Y;
  ship.rotation.y = -0.27; // turn the decal and canopy toward the camera
  group.add(ship);

  ship.add(buildHull());
  ship.add(ringBand(8, C.cyan, 0.18), ringBand(13, C.magenta, 0.28), ringBand(27, C.green, 0.22), ringBand(30.2, C.magenta, 0.16));
  ship.add(buildCanopy(), buildSidePipes(), buildFins(), buildNoseGear());

  const engines = buildEngines();
  ship.add(engines.group);

  // Holo rings that ripple out of the engines under thrust
  const holoRings = [0, 1, 2].map((i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.6, 0.09, 6, 64),
      new THREE.MeshBasicMaterial({ color: i % 2 ? C.cyan : 0x6a7dff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ship.add(ring);
    return ring;
  });

  // Rim lights travel with the ship; the engine light washes the pad orange.
  const rimMagenta = new THREE.PointLight(C.magenta, 90, 0, 2);
  rimMagenta.position.set(14, 24, -10);
  const rimCyan = new THREE.PointLight(C.cyan, 70, 0, 2);
  rimCyan.position.set(-14, 12, -6);
  const engineLight = new THREE.PointLight(C.orange, 0, 0, 2);
  engineLight.position.set(0, -3, 0);
  ship.add(rimMagenta, rimCyan, engineLight);

  return { group, flames: engines.flames, holoRings, engineLight };
}
