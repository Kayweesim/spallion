import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LANDMARKS, UNIT, type LandmarkKind } from '../game/landmarks';
import { buildRocket, NOZZLE_Y } from './rocket';

const SPACE_BG = new THREE.Color(0x05010f);
const GROUND_FOG = new THREE.Color(0x240629);
const NEON = {
  magenta: 0xff2bd6,
  cyan: 0x00f0ff,
  yellow: 0xffe14d,
  violet: 0x8b5cff,
  green: 0x3dff9a,
  orange: 0xff7a2b,
  blue: 0x2b6bff,
};

const STAR_COUNT = 2400;
const STAR_SPAN = 2400; // vertical size of the recycled star volume
const EXHAUST_COUNT = 700;
const PAD_TOP = 4; // rocket base sits on top of the pad
const ATMOSPHERE_TOP = 60 * UNIT; // altitude where the sky has fully turned to space
const BASE_FOV = 62;
const CRUISE_THRUST = 0.3;
// Brightness knobs: lower = dimmer.
const LINE_OPACITY = 0.5;
const GLOW = { strength: 0.45, radius: 0.4, threshold: 0.3 };

/**
 * Neon launch site → open space. The rocket climbs along +y; `altitude` is
 * points × UNIT. Scoring tweens altitude so the world streams past below.
 */
export class SpaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();
  private raf = 0;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private motion = { altitude: 0, fovKick: 0, shake: 0, thrust: 0 };
  private lastAltitude = 0;
  private camY = 0;

  private rocket = new THREE.Group();
  private launchSite = new THREE.Group();
  private flames: THREE.Group[] = [];
  private holoRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private engineLight!: THREE.PointLight;
  private towerArm = new THREE.Group();

  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private fog = new THREE.Fog(GROUND_FOG.clone(), 200, 2600);
  private timeUniforms: { value: number }[] = [];

  private starData = new Float32Array(STAR_COUNT * 3);
  private streakGeo = new THREE.BufferGeometry();
  private headGeo = new THREE.BufferGeometry();
  private starMats: THREE.Material[] = [];

  private exhaust = {
    pos: new Float32Array(EXHAUST_COUNT * 3),
    vel: new Float32Array(EXHAUST_COUNT * 3),
    life: new Float32Array(EXHAUST_COUNT),
    col: new Float32Array(EXHAUST_COUNT * 3),
    geo: new THREE.BufferGeometry(),
    cursor: 0,
    carry: 0,
  };

  private spinners: { obj: THREE.Object3D; speed: THREE.Vector3 }[] = [];
  private dotTex = this.makeDotTexture();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene.fog = this.fog;

    // Only the rocket uses lit/metal materials; everything else is unlit neon.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.5; // materials without their own envMap use this, not envMapIntensity
    this.scene.add(new THREE.HemisphereLight(0x7b6cff, 0x1a0626, 0.35));
    const key = new THREE.DirectionalLight(0xe6dcff, 0.55);
    key.position.set(-140, 90, 10); // from the side, so the hull doesn't mirror it straight at the camera
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 1, 14000);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), GLOW.strength, GLOW.radius, GLOW.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sky = this.buildSky();
    this.buildSun();
    this.buildStars();
    this.buildRocket();
    this.buildExhaust();
    for (const l of LANDMARKS) this.buildLandmark(l.kind, l.points * UNIT);

    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  // ---------------------------------------------------------------- public API

  /** Burn to an absolute score. Bigger gains = longer, harder burns. */
  flyTo(points: number) {
    const target = points * UNIT;
    const gain = Math.max(0, target - this.motion.altitude) / UNIT;
    const fromPad = this.motion.altitude < 1;
    const duration = this.reduced ? 0.4 : 1.4 + (Math.min(gain, 100) / 100) * 1.6;
    const ignition = fromPad && !this.reduced ? 0.7 : 0.15;

    gsap.killTweensOf(this.motion, 'thrust,altitude,fovKick');
    if (fromPad) gsap.to(this.towerArm.rotation, { y: -Math.PI / 2.2, duration: 0.6, ease: 'power2.inOut' });

    gsap.timeline()
      .to(this.motion, { thrust: 1, duration: ignition, ease: 'power2.in' })
      .to(this.motion, { altitude: target, duration, ease: 'power3.inOut' })
      .to(this.motion, { thrust: CRUISE_THRUST, duration: 0.8, ease: 'power2.out' }, `-=${duration * 0.35}`);

    if (!this.reduced) {
      gsap.timeline({ delay: ignition })
        .to(this.motion, { fovKick: 5 + gain * 0.15, duration: duration * 0.45, ease: 'power2.out' })
        .to(this.motion, { fovKick: 0, duration: duration * 0.55, ease: 'power2.inOut' });
    }
  }

  /** Engine sputter for a missed round. */
  miss() {
    const base = this.motion.altitude > 1 ? CRUISE_THRUST : 0;
    gsap.killTweensOf(this.motion, 'thrust');
    gsap.to(this.motion, {
      keyframes: [{ thrust: 0.6, duration: 0.08 }, { thrust: 0, duration: 0.12 }, { thrust: 0.4, duration: 0.08 }, { thrust: 0, duration: 0.2 }, { thrust: base, duration: 0.5 }],
    });
    if (!this.reduced) gsap.fromTo(this.motion, { shake: 1 }, { shake: 0, duration: 0.7, ease: 'power2.out' });
  }

  /** Back on the pad for a new run (with a quick fade so the jump isn't jarring). */
  reset() {
    gsap.killTweensOf(this.motion);
    Object.assign(this.motion, { altitude: 0, fovKick: 0, shake: 0, thrust: 0 });
    this.lastAltitude = 0;
    this.camY = 0;
    this.exhaust.life.fill(0);
    gsap.killTweensOf(this.towerArm.rotation);
    this.towerArm.rotation.y = 0;
    if (!this.reduced) gsap.fromTo(this.canvas, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: 'power2.out' });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    gsap.killTweensOf(this.motion);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.dotTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- helpers

  private makeDotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /** Dark solid body + neon wireframe: the house style for every object. */
  private neon(geo: THREE.BufferGeometry, color: number, fill = 0x0a0320) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill, side: THREE.DoubleSide }));
    core.scale.setScalar(0.985);
    group.add(core, new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: LINE_OPACITY })));
    return group;
  }

  private edges(geo: THREE.BufferGeometry, color: number, fill = 0x0a0320) {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill })),
      new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: LINE_OPACITY })),
    );
    return group;
  }

  private lines(points: number[], color: number) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: LINE_OPACITY }));
  }

  private ringLines(inner: number, outer: number, count: number, color: number) {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const r = inner + ((outer - inner) * i) / Math.max(1, count - 1);
      const pts = new THREE.EllipseCurve(0, 0, r, r).getPoints(96).map((p) => new THREE.Vector3(p.x, p.y, 0));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: LINE_OPACITY })));
    }
    return group;
  }

  private particleCloud(count: number, colors: number[], place: (i: number) => THREE.Vector3, size: number, opacity = 0.5) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = colors.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      place(i).toArray(pos, i * 3);
      palette[i % palette.length].toArray(col, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: this.dotTex, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity,
    }));
  }

  private spin(obj: THREE.Object3D, x: number, y: number, z = 0) {
    this.spinners.push({ obj, speed: new THREE.Vector3(x, y, z) });
    return obj;
  }

  // ---------------------------------------------------------------- sky

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSpace: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uSpace;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 horizon = vec3(0.14, 0.025, 0.16);
          vec3 mid = vec3(0.10, 0.02, 0.22);
          vec3 zenith = vec3(0.03, 0.0, 0.08);
          vec3 atm = mix(horizon, mid, smoothstep(0.0, 0.2, h));
          atm = mix(atm, zenith, smoothstep(0.2, 0.75, h));
          atm += vec3(0.22, 0.03, 0.18) * exp(-abs(h) * 16.0);
          vec3 space = vec3(0.02, 0.004, 0.06);
          gl_FragColor = vec4(mix(atm, space, uSpace), 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 24), mat);
    sky.renderOrder = -2;
    this.scene.add(sky);
    return sky;
  }

  /** The striped synthwave sun, setting on the horizon behind the launch site. */
  private buildSun() {
    const uTime = { value: 0 };
    this.timeUniforms.push(uTime);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5);
          if (d > 0.5) discard;
          vec3 col = mix(vec3(1.0, 0.17, 0.84), vec3(1.0, 0.88, 0.3), smoothstep(0.1, 0.9, vUv.y));
          if (vUv.y < 0.55) {
            float band = fract(vUv.y * 16.0 - uTime * 0.25);
            if (band < (0.55 - vUv.y) * 1.6) discard;
          }
          gl_FragColor = vec4(col * 0.6, smoothstep(0.5, 0.48, d));
        }
      `,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(1300, 1300), mat);
    sun.position.set(-150, 180, -2600);
    sun.renderOrder = -1;
    this.launchSite.add(sun); // sets with the city once we're in space
    return sun;
  }

  private buildStars() {
    const palette = [new THREE.Color(0xffffff), new THREE.Color(NEON.cyan), new THREE.Color(NEON.magenta), new THREE.Color(NEON.violet)];
    const streakColors = new Float32Array(STAR_COUNT * 6);
    const headColors = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.starData[i * 3] = (Math.random() - 0.5) * 2400;
      this.starData[i * 3 + 1] = -200 + Math.random() * STAR_SPAN;
      this.starData[i * 3 + 2] = -150 - Math.random() * 1500;
      const c = Math.random() < 0.6 ? palette[0] : palette[1 + Math.floor(Math.random() * 3)];
      c.toArray(streakColors, i * 6);
      streakColors.set([c.r * 0.05, c.g * 0.05, c.b * 0.05], i * 6 + 3); // tail fades out
      c.toArray(headColors, i * 3);
    }
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 6), 3));
    this.streakGeo.setAttribute('color', new THREE.BufferAttribute(streakColors, 3));
    this.headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
    this.headGeo.setAttribute('color', new THREE.BufferAttribute(headColors, 3));

    const blend = { vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    const streakMat = new THREE.LineBasicMaterial(blend);
    const headMat = new THREE.PointsMaterial({ ...blend, size: 1.8, sizeAttenuation: false });
    this.starMats = [streakMat, headMat];
    const streaks = new THREE.LineSegments(this.streakGeo, streakMat);
    const heads = new THREE.Points(this.headGeo, headMat);
    streaks.frustumCulled = heads.frustumCulled = false;
    this.scene.add(streaks, heads);
  }

  // ---------------------------------------------------------------- rocket

  private buildRocket() {
    const parts = buildRocket();
    this.rocket.add(parts.group);
    this.flames = parts.flames;
    this.holoRings = parts.holoRings;
    this.engineLight = parts.engineLight;
    this.scene.add(this.rocket);
  }

  private buildExhaust() {
    const e = this.exhaust;
    e.geo.setAttribute('position', new THREE.BufferAttribute(e.pos, 3));
    e.geo.setAttribute('color', new THREE.BufferAttribute(e.col, 3));
    const pts = new THREE.Points(e.geo, new THREE.PointsMaterial({
      size: 7, map: this.dotTex, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  // ---------------------------------------------------------------- launch site

  private padTexture() {
    const S = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0a0418';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.lineWidth = 4;
    // Concentric rings
    g.strokeStyle = 'rgba(139, 92, 255, 0.55)';
    for (const r of [500, 470, 300]) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Nested diamonds and squares, like a landing glyph
    g.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    for (const [size, rot] of [[640, Math.PI / 4], [560, Math.PI / 4], [420, 0], [360, 0]] as const) {
      g.save();
      g.rotate(rot);
      g.strokeRect(-size / 2, -size / 2, size, size);
      g.restore();
    }
    g.strokeStyle = 'rgba(255, 43, 214, 0.4)';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * 300, Math.sin(a) * 300);
      g.lineTo(Math.cos(a) * 470, Math.sin(a) * 470);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private buildLaunchSite() {
    const site = this.launchSite;
    this.scene.add(site);
    // Ground: opaque floor + neon grid
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshBasicMaterial({ color: 0x07010f }));
    floor.rotation.x = -Math.PI / 2;
    site.add(floor);
    const grid = new THREE.GridHelper(8000, 160, NEON.magenta, NEON.violet);
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = 0.2;
    grid.position.y = 0.05;
    site.add(grid);

    // Pad: dark metal drum with a glowing circuit-pattern top
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 24, PAD_TOP, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1036, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.3 }),
    );
    pad.position.y = PAD_TOP / 2;
    const top = new THREE.Mesh(new THREE.CircleGeometry(21.6, 64), new THREE.MeshBasicMaterial({ map: this.padTexture() }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = PAD_TOP + 0.02;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(22, 0.3, 8, 96), new THREE.MeshBasicMaterial({ color: NEON.violet }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = PAD_TOP;
    site.add(pad, top, rim);
    const lights = this.particleCloud(16, [NEON.cyan, NEON.yellow], (i) => {
      const a = (i / 16) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * 21, PAD_TOP + 0.5, Math.sin(a) * 21);
    }, 5, 0.6);
    site.add(lights);

    // Lattice tower beside the rocket
    const tx = -15, h = 58, w = 3;
    const seg: number[] = [];
    const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
    for (const [x, z] of corners) seg.push(tx + x, 0, z, tx + x, h, z);
    for (let y = 0; y <= h; y += 6) {
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 4];
        seg.push(tx + x1, y, z1, tx + x2, y, z2);
        if (y + 6 <= h) seg.push(tx + x1, y, z1, tx + x2, y + 6, z2); // diagonal brace
      }
    }
    site.add(this.lines(seg, NEON.cyan));
    const beacon = this.particleCloud(1, [0xff3b5c], () => new THREE.Vector3(tx, h + 2, 0), 10, 0.7);
    site.add(beacon);
    gsap.to(beacon.material, { opacity: 0.15, duration: 0.6, repeat: -1, yoyo: true, ease: 'steps(1)' });

    // Service arm that swings away at ignition
    this.towerArm.position.set(tx + w, 30, 0);
    const arm = this.edges(new THREE.BoxGeometry(6.5, 1.6, 2.4), NEON.yellow);
    arm.position.x = 3.25;
    this.towerArm.add(arm);
    site.add(this.towerArm);

    // Cyberpunk skyline on the horizon
    for (let i = 0; i < 70; i++) {
      const bw = 30 + Math.random() * 70;
      const bh = 40 + Math.pow(Math.random(), 2) * 320;
      const color = [NEON.cyan, NEON.magenta, NEON.violet][i % 3];
      const b = this.edges(new THREE.BoxGeometry(bw, bh, bw), color, 0x080114);
      b.position.set((Math.random() - 0.5) * 3600, bh / 2, -700 - Math.random() * 1100);
      site.add(b);
    }
  }

  // ---------------------------------------------------------------- landmarks

  private buildLandmark(kind: LandmarkKind, y: number) {
    const add = <T extends THREE.Object3D>(o: T, x: number, dy: number, z: number) => {
      o.position.set(x, y + dy, z);
      this.scene.add(o);
      return o;
    };

    switch (kind) {
      case 'pad':
        this.buildLaunchSite();
        break;
      case 'clouds': {
        const clouds = this.particleCloud(450, [0xff6ad5, NEON.violet, 0x6a7dff, 0xffb3ec], () =>
          new THREE.Vector3((Math.random() - 0.5) * 1600, Math.random() * 260, -900 + Math.random() * 960), 110, 0.14);
        add(clouds, 0, -40, 0);
        break;
      }
      case 'stratosphere': {
        // Aurora curtains
        for (let i = 0; i < 3; i++) {
          const uTime = { value: 0 };
          this.timeUniforms.push(uTime);
          const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
            uniforms: { uTime, uPhase: { value: i * 1.7 } },
            vertexShader: /* glsl */ `
              uniform float uTime; uniform float uPhase;
              varying vec2 vUv;
              void main() {
                vUv = uv;
                vec3 p = position;
                p.z += sin(p.x * 0.006 + uTime * 0.6 + uPhase) * 80.0 + sin(p.x * 0.017 + uTime) * 25.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
              }
            `,
            fragmentShader: /* glsl */ `
              varying vec2 vUv;
              void main() {
                vec3 col = mix(vec3(0.24, 1.0, 0.6), vec3(1.0, 0.17, 0.84), vUv.y);
                float a = smoothstep(0.0, 0.25, vUv.y) * (1.0 - vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                gl_FragColor = vec4(col, a * 0.14);
              }
            `,
          });
          add(new THREE.Mesh(new THREE.PlaneGeometry(2200, 220, 96, 1), mat), (i - 1) * 300, i * 70, -500 - i * 200);
        }
        break;
      }
      case 'orbit': {
        const station = new THREE.Group();
        const hub = this.neon(new THREE.CylinderGeometry(6, 6, 30, 8, 2), NEON.cyan);
        hub.rotation.z = Math.PI / 2;
        station.add(hub);
        const truss = this.edges(new THREE.BoxGeometry(110, 2, 2), NEON.violet);
        station.add(truss);
        for (const sx of [-1, 1]) {
          for (const k of [0, 1]) {
            const panel = this.edges(new THREE.BoxGeometry(20, 0.5, 34), NEON.yellow, 0x10052a);
            panel.position.set(sx * (32 + k * 22), 0, 0);
            station.add(panel);
          }
        }
        add(station, 170, 50, -220);
        this.spin(station, 0.05, 0.15);
        for (let i = 0; i < 6; i++) {
          const sat = this.edges(new THREE.BoxGeometry(4, 4, 4), NEON.green);
          add(sat, (Math.random() - 0.5) * 900, (Math.random() - 0.3) * 200, -300 - Math.random() * 500);
          this.spin(sat, Math.random(), Math.random());
        }
        break;
      }
      case 'moon':
        this.spin(add(this.neon(new THREE.IcosahedronGeometry(55, 2), 0xd8d4ff), -230, 60, -300), 0.02, 0.1);
        break;
      case 'mars':
        this.spin(add(this.neon(new THREE.IcosahedronGeometry(70, 2), NEON.orange), 250, 70, -350), 0, 0.12);
        break;
      case 'belt':
        for (let i = 0; i < 90; i++) {
          const rock = new THREE.LineSegments(
            new THREE.WireframeGeometry(new THREE.DodecahedronGeometry(3 + Math.random() * 12, 0)),
            new THREE.LineBasicMaterial({ color: Math.random() < 0.5 ? NEON.yellow : 0xc9b8ff, transparent: true, opacity: LINE_OPACITY }),
          );
          const side = Math.random() < 0.5 ? -1 : 1;
          add(rock, side * (40 + Math.random() * 500), -100 + Math.random() * 400, -600 + Math.random() * 640);
          this.spin(rock, Math.random() - 0.5, Math.random() - 0.5);
        }
        break;
      case 'jupiter':
        this.spin(add(this.neon(new THREE.IcosahedronGeometry(170, 3), NEON.yellow), -340, 100, -520), 0, 0.06);
        break;
      case 'saturn': {
        const g = new THREE.Group();
        const planet = this.neon(new THREE.IcosahedronGeometry(95, 2), NEON.green);
        g.add(planet);
        const rings = this.ringLines(135, 210, 5, NEON.magenta);
        rings.rotation.x = Math.PI / 2.3;
        g.add(rings);
        g.rotation.z = 0.35;
        add(g, 330, 90, -450);
        this.spin(planet, 0, 0.08);
        break;
      }
      case 'neptune':
        this.spin(add(this.neon(new THREE.IcosahedronGeometry(80, 2), NEON.blue), -270, 70, -380), 0, 0.1);
        break;
      case 'nebula': {
        const cloud = this.particleCloud(3000, [NEON.magenta, NEON.violet, NEON.cyan, 0xff6ad5], () => {
          const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 600);
          v.z = v.z * 0.8 - 200;
          return v;
        }, 16);
        add(cloud, 0, 120, 0);
        this.spin(cloud, 0, 0.02);
        break;
      }
      case 'blackhole': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
        const disk = this.ringLines(80, 210, 9, NEON.orange);
        disk.children.forEach((l, i) => ((l as THREE.LineLoop).material as THREE.LineBasicMaterial).color.set(i % 2 ? NEON.magenta : NEON.orange));
        disk.rotation.x = Math.PI / 2.4;
        g.add(disk);
        add(g, 300, 90, -420);
        this.spin(disk, 0, 0, 0.4);
        break;
      }
      case 'core': {
        const arms = 4;
        const galaxy = this.particleCloud(7000, [0xffffff, NEON.yellow, NEON.magenta, NEON.cyan], (i) => {
          const t = Math.random();
          const r = Math.pow(t, 1.6) * 1000;
          const a = (i % arms) * ((Math.PI * 2) / arms) + r * 0.006 + (Math.random() - 0.5) * 0.5;
          return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 60 * (1 - t));
        }, 20);
        add(galaxy, 0, 380, -900);
        this.spin(galaxy, 0, 0, 0.05);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- frame

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const { altitude, thrust } = this.motion;

    const climbSpeed = (altitude - this.lastAltitude) / Math.max(dt, 1e-4);
    this.lastAltitude = altitude;
    const space = THREE.MathUtils.smoothstep(altitude, 0, ATMOSPHERE_TOP);

    // Rocket + camera (camera trails slightly so big burns pull the rocket up the screen).
    const rocketY = PAD_TOP + altitude;
    const jitter = thrust * (altitude < 1 ? 0.5 : 0.25);
    this.rocket.position.set((Math.random() - 0.5) * jitter, rocketY, (Math.random() - 0.5) * jitter);
    this.camY += (rocketY - this.camY) * (1 - Math.exp(-dt * 6));
    this.camY = THREE.MathUtils.clamp(this.camY, rocketY - 22, rocketY + 5); // keep the rocket on screen
    const shake = this.motion.shake * 5;
    this.camera.position.set(
      -32 + Math.sin(t * 0.3) * 3 + (Math.random() - 0.5) * shake,
      this.camY + 16 + Math.sin(t * 0.21) * 1.5 + (Math.random() - 0.5) * shake,
      118,
    );
    this.camera.lookAt(0, this.camY + 42, -80);
    this.camera.fov = BASE_FOV + this.motion.fovKick;
    this.camera.updateProjectionMatrix();

    // Engines: per-nozzle flames, rippling holo rings, orange light on the pad
    const lit = thrust > 0.02;
    for (const f of this.flames) {
      f.visible = lit;
      const flicker = 0.85 + Math.random() * 0.3;
      f.scale.set(0.55 + thrust * 0.5, (0.2 + thrust * 1.3) * flicker, 0.55 + thrust * 0.5);
    }
    this.holoRings.forEach((ring, i) => {
      const phase = (t * 1.1 + i / this.holoRings.length) % 1;
      ring.position.y = -phase * 12;
      ring.scale.setScalar(0.8 + phase * 1.1);
      ring.material.opacity = lit ? (1 - phase) * 0.45 * thrust : 0;
    });
    this.engineLight.intensity = thrust * (500 + Math.random() * 150);

    // Atmosphere → space (city + sun drop out of view once we're well above them)
    this.launchSite.visible = this.camera.position.y < ATMOSPHERE_TOP * 1.2;
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.uSpace.value = space;
    this.fog.color.copy(GROUND_FOG).lerp(SPACE_BG, space);
    this.fog.far = 2600 + space * 3000;
    for (const m of this.starMats) m.opacity = 0.2 + 0.4 * space;
    for (const u of this.timeUniforms) u.value = t;

    this.updateStars(dt, this.camera.position.y, Math.abs(climbSpeed), altitude);
    this.updateExhaust(dt, rocketY);

    for (const { obj, speed } of this.spinners) {
      obj.rotation.x += speed.x * dt;
      obj.rotation.y += speed.y * dt;
      obj.rotation.z += speed.z * dt;
    }

    this.composer.render();
  };

  private updateStars(dt: number, camY: number, speed: number, altitude: number) {
    const flow = Math.min(altitude / 100, 1) * 30; // gentle drift once airborne
    const streak = Math.min(1 + (speed + flow) * 0.12, 300);
    const L = this.streakGeo.attributes.position.array as Float32Array;
    const H = this.headGeo.attributes.position.array as Float32Array;
    const d = this.starData;
    const lo = camY - 500;

    for (let i = 0; i < STAR_COUNT; i++) {
      let y = d[i * 3 + 1] - flow * dt;
      if (y < lo) y += STAR_SPAN;
      else if (y > lo + STAR_SPAN) y -= STAR_SPAN;
      d[i * 3 + 1] = y;
      const x = d[i * 3];
      const z = d[i * 3 + 2];
      L[i * 6] = x; L[i * 6 + 1] = y; L[i * 6 + 2] = z;
      L[i * 6 + 3] = x; L[i * 6 + 4] = y + streak; L[i * 6 + 5] = z;
      H[i * 3] = x; H[i * 3 + 1] = y; H[i * 3 + 2] = z;
    }
    this.streakGeo.attributes.position.needsUpdate = true;
    this.headGeo.attributes.position.needsUpdate = true;
  }

  private updateExhaust(dt: number, rocketY: number) {
    const e = this.exhaust;
    const { thrust } = this.motion;

    // Emit
    e.carry += thrust * 380 * dt;
    while (e.carry >= 1) {
      e.carry -= 1;
      const i = e.cursor;
      e.cursor = (e.cursor + 1) % EXHAUST_COUNT;
      e.pos[i * 3] = this.rocket.position.x + (Math.random() - 0.5) * 5;
      e.pos[i * 3 + 1] = rocketY + NOZZLE_Y - 3;
      e.pos[i * 3 + 2] = (Math.random() - 0.5) * 5;
      e.vel[i * 3] = (Math.random() - 0.5) * 18;
      e.vel[i * 3 + 1] = -60 - thrust * 90 - Math.random() * 30;
      e.vel[i * 3 + 2] = (Math.random() - 0.5) * 18;
      e.life[i] = 1;
    }

    // Simulate: hot white → orange → magenta → gone; billow sideways off the pad.
    const hot = new THREE.Color(0xfff3b0), mid = new THREE.Color(NEON.orange), cool = new THREE.Color(NEON.magenta);
    const c = new THREE.Color();
    for (let i = 0; i < EXHAUST_COUNT; i++) {
      let life = e.life[i];
      if (life <= 0) {
        e.col[i * 3] = e.col[i * 3 + 1] = e.col[i * 3 + 2] = 0;
        continue;
      }
      life -= dt * 1.1;
      e.life[i] = life;
      e.pos[i * 3] += e.vel[i * 3] * dt;
      e.pos[i * 3 + 1] += e.vel[i * 3 + 1] * dt;
      e.pos[i * 3 + 2] += e.vel[i * 3 + 2] * dt;
      if (e.pos[i * 3 + 1] < PAD_TOP + 1) {
        e.pos[i * 3 + 1] = PAD_TOP + 1;
        e.vel[i * 3 + 1] = 4;
        e.vel[i * 3] *= 1.08;
        e.vel[i * 3 + 2] *= 1.08;
        if (Math.abs(e.vel[i * 3]) < 25) e.vel[i * 3] += (Math.random() - 0.5) * 60;
      }
      if (life > 0.7) c.copy(mid).lerp(hot, (life - 0.7) / 0.3);
      else c.copy(cool).lerp(mid, life / 0.7);
      c.multiplyScalar(Math.max(life, 0) * 0.45);
      c.toArray(e.col, i * 3);
    }
    e.geo.attributes.position.needsUpdate = true;
    e.geo.attributes.color.needsUpdate = true;
  }
}
