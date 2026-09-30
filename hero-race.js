/* ================================================================
   Hero backdrop: light cycles racing on a 3D grid, seen from the side.
   Riders move node to node and turn at random. Hitting another rider's
   beam destroys you; meeting head on destroys both. The dead respawn.
   ================================================================ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const hero = document.querySelector(".hero");
const canvas = hero && hero.querySelector(".hero-race");
if (canvas) start();

function start() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CELL = 4;             // world units between grid nodes
  const COLS = 28, ROWS = 12; // arena size in cells
  const SPEED = 15;           // world units per second
  const TRAIL = 4.5;          // seconds a beam lingers
  const LETHAL = TRAIL * 0.8; // a beam stops killing once it has mostly faded
  const BEAM_H = 1.8;
  const RESPAWN = 1.8;        // seconds between death and respawn
  const MAX_PTS = 96;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const COLORS = ["#7FD8FF", "#FF8A96", "#7FD8FF", "#FF8A96", "#7FD8FF", "#FF8A96"];

  // The sky's cyan stops at the horizon; the far grid fades into a dark FOG instead,
  // so the two meet at a crisp line. The .hero CSS fallback uses the same colors.
  const HORIZON = new THREE.Color("#041A21");
  const FOG = new THREE.Color("#030E14");
  const GROUND = new THREE.Color("#01070C");
  const CLOUDS = 30;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    return; // no WebGL: the CSS sky gradient stays as the backdrop
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG.clone(), 70, 360);
  const camera = new THREE.PerspectiveCamera(46, 2, 1, 4000);

  /* ---------- sky: top glow, drifting rainclouds, lightning ---------- */
  // Drawn as a full-screen quad in screen space, before everything else.
  // Coordinates are drawing-buffer pixels measured from the top-left.
  const skyUniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uHorizon: { value: 1 },
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector3(0, 0, 0) }, // x, y, intensity
    uFlashR: { value: 1 },
    uHor: { value: new THREE.Vector3(...HORIZON.getStyle().match(/\d+/g).map((v) => v / 255)) }, // sRGB
    // One vec4 per cloud: x, y, radius (drawing-buffer px), seed. Sorted far to near.
    uClouds: { value: Array.from({ length: CLOUDS }, () => new THREE.Vector4()) },
  };
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.999, 1.0); }",
    fragmentShader: `
      uniform vec2 uRes;
      uniform float uHorizon, uTime, uFlashR;
      uniform vec3 uFlash, uHor;
      uniform vec4 uClouds[${CLOUDS}];
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
        return v;
      }
      // Signed "inside-ness" of one cloud in its local space (q = 0 at its center):
      // a round body roughened by noise into billows, with the base sliced flatter.
      float cloudShape(vec2 q, float seed) {
        float body = 1.0 - length(q);
        float lumps = fbm(q * 2.4 + vec2(seed * 7.31, seed * 3.17) + vec2(uTime * 0.015, 0.0)) - 0.5;
        float base = smoothstep(0.15, 0.55, q.y);
        return body + lumps * 1.1 - base * 1.2;
      }
      void main() {
        vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
        float t = clamp(px.y / uHorizon, 0.0, 1.0); // 0 at the top, 1 at the horizon

        // Brighter cyan overhead falling off to dark cyan at the horizon, plus a soft glow from the top center.
        vec3 col = mix(vec3(0.045, 0.175, 0.215), uHor, pow(t, 0.75));
        vec2 g = vec2((px.x - uRes.x * 0.5) / uRes.x * 1.9, t * 1.1);
        float glow = exp(-dot(g, g)) * (1.0 - t);
        col += vec3(0.025, 0.10, 0.12) * glow;

        // Lightning: brightness falls off with distance from the strike.
        vec2 f = (px - uFlash.xy) / uFlashR;
        float L = uFlash.z * exp(-dot(f, f));
        vec3 flashCol = vec3(0.50, 0.68, 0.85);
        col += flashCol * (L * 0.04 + uFlash.z * 0.015);

        // Individual clouds, painted far to near. Each one shades itself: points with more
        // cloud above them (toward the light) are in shadow, so tops are lit, bellies dark.
        for (int i = 0; i < ${CLOUDS}; i++) {
          vec4 c = uClouds[i];
          float depth = clamp(c.y / uHorizon, 0.0, 1.0); // 0 overhead, 1 at the horizon
          vec2 q = (px - c.xy) / c.z;
          q.y *= 1.9 + depth * 1.6; // wider than tall, flatter with distance
          if (dot(q, q) > 2.6) continue;
          float s = cloudShape(q, c.w);
          if (s <= 0.0) continue;
          float cover = smoothstep(0.0, 0.05, s);
          float light = 1.0 - clamp(cloudShape(q + vec2(0.0, -0.22), c.w) * 2.5, 0.0, 1.0);
          float belly = smoothstep(-0.2, 0.5, q.y);
          float detail = fbm(q * 6.0 + c.w * 11.0);
          vec3 shade = mix(vec3(0.030, 0.060, 0.075), vec3(0.11, 0.22, 0.25), light * (1.0 - belly * 0.7));
          shade *= 0.8 + detail * 0.4;
          shade += vec3(0.05, 0.13, 0.15) * light * (1.0 - smoothstep(0.0, 0.12, s)); // bright rim on lit edges
          shade += flashCol * L * (0.25 + 0.75 * light + detail * 0.2);
          shade = mix(shade, col, smoothstep(0.35, 1.0, depth) * 0.55); // distant clouds sink into the haze
          col = mix(col, shade, cover * 0.97);
        }

        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  // Clouds in relative units: x and r as fractions of the width, y as a fraction of the sky's height.
  // Higher clouds read as nearer, so they are larger and drift faster.
  const cloudState = Array.from({ length: CLOUDS }, (_, i) => {
    // Spread from overhead down to just above the horizon, bunching slightly toward the distance.
    const fy = Math.min(0.93, 0.06 + Math.pow(i / (CLOUDS - 1), 0.85) * 0.86 + (Math.random() - 0.5) * 0.05);
    return {
      fx: (i * 0.618 + Math.random() * 0.1) % 1, // golden-ratio spacing keeps them apart
      fy,
      fr: Math.max(0.03, 0.16 - fy * 0.14 + Math.random() * 0.025),
      seed: Math.random() * 10,
      speed: 0.006 * (1.15 - fy),
    };
  }).sort((a, b) => b.fy - a.fy);
  function tickClouds(dt) {
    const W = skyUniforms.uRes.value.x, hz = skyUniforms.uHorizon.value;
    cloudState.forEach((c, i) => {
      c.fx += c.speed * dt;
      if (c.fx > 1 + c.fr * 1.6) c.fx = -c.fr * 1.6; // wrap around once fully off screen
      skyUniforms.uClouds.value[i].set(c.fx * W, c.fy * hz, c.fr * W, c.seed);
    });
  }

  // Bolts: jagged camera-facing ribbons in world space, a soft wide glow under a thin bright core.
  // Per vertex: side (-1..1 across the ribbon), prog (how far along its leader, so the channel
  // can grow in) and fade (the top dissolves into the cloud base).
  const boltMat = (color) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uGrow: { value: 10 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `attribute float side, prog, fade; varying float vSide, vProg, vFade;
      void main() {
        vSide = side; vProg = prog; vFade = fade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uGrow; varying float vSide, vProg, vFade;
      void main() {
        if (vProg > uGrow) discard;
        gl_FragColor = vec4(uColor, pow(1.0 - abs(vSide), 1.5) * vFade * uOpacity);
      }`,
  });
  const bolts = [
    { px: 10, mesh: new THREE.Mesh(new THREE.BufferGeometry(), boltMat("#5FA8E8")) },
    { px: 1.8, mesh: new THREE.Mesh(new THREE.BufferGeometry(), boltMat("#EAF6FF")) },
  ];
  for (const b of bolts) { b.mesh.frustumCulled = false; b.mesh.visible = false; scene.add(b.mesh); }

  /* ---------- world ---------- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: GROUND }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const grid = new THREE.GridHelper(800, 800 / CELL, "#1E6F8C", "#1E6F8C");
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  const nodeX = (gx) => (gx - COLS / 2) * CELL;
  const nodeZ = (gz) => (gz - ROWS / 2) * CELL;
  const border = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(nodeX(0), 0.03, nodeZ(0)), new THREE.Vector3(nodeX(COLS), 0.03, nodeZ(0)),
    new THREE.Vector3(nodeX(COLS), 0.03, nodeZ(ROWS)), new THREE.Vector3(nodeX(0), 0.03, nodeZ(ROWS)),
  ]);
  scene.add(new THREE.LineLoop(border, new THREE.LineBasicMaterial({ color: "#4FB8E0", transparent: true, opacity: 0.55 })));

  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

  /* ---------- riders ---------- */
  const HULL = new THREE.Color("#050E14");
  const hull = new THREE.MeshBasicMaterial({ color: HULL });
  const litMats = []; // each rider's glowing parts, brightened during lightning
  function buildCycle(color) {
    const g = new THREE.Group();
    const lit = new THREE.MeshBasicMaterial({ color });
    litMats.push({ mat: lit, base: color.clone() });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.6), hull);
    body.position.y = 0.75;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 0.64), lit);
    stripe.position.y = 0.72;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.35) }));
    canopy.position.set(0.15, 1.2, 0);
    g.add(body, stripe, canopy);
    const wheels = [];
    for (const x of [-1.1, 1.1]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.14, 8, 24), lit);
      w.position.set(x, 0.64, 0);
      wheels.push(w);
      g.add(w);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, opacity: 0.55, ...additive }));
    glow.scale.set(7, 4, 1);
    glow.position.y = 0.8;
    g.add(glow);
    g.scale.setScalar(1.4);
    return { group: g, wheels };
  }

  function buildBeam() {
    const wall = new THREE.BufferGeometry();
    wall.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PTS * 18), 3));
    wall.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_PTS * 18), 3));
    const edge = new THREE.BufferGeometry();
    edge.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PTS * 6), 3));
    edge.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_PTS * 6), 3));
    const wallMesh = new THREE.Mesh(wall, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, ...additive }));
    const edgeMesh = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ vertexColors: true, fog: false, ...additive }));
    wallMesh.frustumCulled = edgeMesh.frustumCulled = false;
    scene.add(wallMesh, edgeMesh);
    return { wall, edge };
  }

  let clock = 0;
  const occupied = new Map(); // "gx,gz" -> { r, gen, t } for the last rider through each node
  const key = (gx, gz) => gx + "," + gz;
  const rand = (n) => Math.floor(Math.random() * n);

  const riders = COLORS.map((hex) => {
    const color = new THREE.Color(hex);
    const cycle = buildCycle(color);
    scene.add(cycle.group);
    return { color, ...cycle, beam: buildBeam(), gen: 0, dead: true, deadAt: -RESPAWN, trail: [], yaw: 0 };
  });

  const lethal = (e) => e && !e.r.dead && e.gen === e.r.gen && clock - e.t < LETHAL;
  const head = (r) => ({
    x: nodeX(r.gx) + DIRS[r.d][0] * r.prog,
    z: nodeZ(r.gz) + DIRS[r.d][1] * r.prog,
  });

  function spawn(r) {
    for (let tries = 0; tries < 40; tries++) {
      const gx = 2 + rand(COLS - 3), gz = 2 + rand(ROWS - 3);
      if (lethal(occupied.get(key(gx, gz)))) continue;
      const crowded = riders.some((o) => o !== r && !o.dead && Math.hypot(head(o).x - nodeX(gx), head(o).z - nodeZ(gz)) < CELL * 4);
      if (crowded && tries < 39) continue;
      r.gx = gx; r.gz = gz; r.d = rand(4); r.prog = 0;
      r.gen++; r.dead = false;
      r.trail = [{ x: nodeX(gx), z: nodeZ(gz), t: clock }];
      occupied.set(key(gx, gz), { r, gen: r.gen, t: clock });
      r.yaw = -Math.atan2(DIRS[r.d][1], DIRS[r.d][0]);
      r.group.visible = true;
      flash(nodeX(gx), nodeZ(gz), r.color, 5);
      return;
    }
  }

  function kill(r, x, z) {
    r.dead = true;
    r.deadAt = clock;
    r.group.visible = false;
    explode(x, z, r.color);
  }

  const offArena = (gx, gz) => gx < 1 || gz < 1 || gx > COLS - 1 || gz > ROWS - 1;
  function nextNode(r, d) {
    const gx = r.gx + DIRS[d][0], gz = r.gz + DIRS[d][1];
    return { gx, gz, e: occupied.get(key(gx, gz)) };
  }

  function arrive(r) {
    r.gx += DIRS[r.d][0];
    r.gz += DIRS[r.d][1];
    const here = occupied.get(key(r.gx, r.gz));
    if (here && here.r !== r && lethal(here)) { kill(r, nodeX(r.gx), nodeZ(r.gz)); return; }
    occupied.set(key(r.gx, r.gz), { r, gen: r.gen, t: clock });
    r.trail.push({ x: nodeX(r.gx), z: nodeZ(r.gz), t: clock });
    if (r.trail.length > MAX_PTS - 2) r.trail.shift();

    // Random turns as before, but riders mostly steer clear of beams they can see coming.
    const options = [r.d, (r.d + 1) % 4, (r.d + 3) % 4].filter((d) => {
      const n = nextNode(r, d);
      return !offArena(n.gx, n.gz);
    });
    if (!options.length) { kill(r, nodeX(r.gx), nodeZ(r.gz)); return; }
    const notOwn = options.filter((d) => { const { e } = nextNode(r, d); return !(e && e.r === r && lethal(e)); });
    const base = notOwn.length ? notOwn : options;
    const clear = base.filter((d) => !lethal(nextNode(r, d).e));
    const pool = clear.length && Math.random() < 0.7 ? clear : base;
    const turns = pool.filter((d) => d !== r.d);
    const straight = pool.includes(r.d) && (Math.random() > 0.28 || !turns.length);
    r.d = straight ? r.d : turns[rand(turns.length)];
  }

  /* ---------- explosions ---------- */
  const effects = [];
  function flash(x, z, color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, ...additive }));
    s.position.set(x, 1, z);
    scene.add(s);
    effects.push({ obj: s, born: clock, life: 0.45, tick(t) {
      const k = t / this.life;
      s.scale.setScalar(size * (0.4 + k * 1.6));
      s.material.opacity = 1 - k;
    } });
  }
  function explode(x, z, color) {
    const N = 110;
    const posArr = new Float32Array(N * 3), colArr = new Float32Array(N * 3), vel = [];
    const white = new THREE.Color("#FFFFFF");
    for (let i = 0; i < N; i++) {
      posArr.set([x, 0.9, z], i * 3);
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const sp = 4 + Math.random() * 14;
      vel.push([Math.cos(a) * sp * (1 - up * 0.5), 3 + up * 14, Math.sin(a) * sp * (1 - up * 0.5)]);
      const c = color.clone().lerp(white, Math.random() * 0.7);
      colArr.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.9, map: glowTex, vertexColors: true, ...additive }));
    pts.frustumCulled = false;
    scene.add(pts);
    let prev = 0;
    effects.push({ obj: pts, born: clock, life: 1.4, tick(t) {
      const dt = t - prev; prev = t;
      for (let i = 0; i < N; i++) {
        const v = vel[i], j = i * 3;
        v[1] -= 22 * dt;
        v[0] *= 1 - 1.2 * dt; v[2] *= 1 - 1.2 * dt;
        posArr[j] += v[0] * dt; posArr[j + 1] += v[1] * dt; posArr[j + 2] += v[2] * dt;
        if (posArr[j + 1] < 0.05) { posArr[j + 1] = 0.05; v[1] *= -0.35; v[0] *= 0.7; v[2] *= 0.7; }
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.pow(1 - t / this.life, 1.4);
    } });

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...additive }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    scene.add(ring);
    effects.push({ obj: ring, born: clock, life: 0.8, tick(t) {
      const k = t / this.life;
      ring.scale.setScalar(1 + k * 13);
      ring.material.opacity = Math.pow(1 - k, 2);
    } });

    flash(x, z, color.clone().lerp(white, 0.5), 14);
  }
  function tickEffects() {
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i], t = clock - fx.born;
      if (t >= fx.life) {
        scene.remove(fx.obj);
        fx.obj.geometry && fx.obj.geometry.dispose();
        fx.obj.material.dispose();
        effects.splice(i, 1);
      } else fx.tick(t);
    }
  }

  /* ---------- lightning ---------- */
  const buf = new THREE.Vector2();
  let horizonCss = 1, strikeAt = -10, nextStrike = 1.5 + Math.random() * 3;

  // Strikes form from both ends, like the real thing: a stepped leader works down from the
  // cloud while a streamer rises from the ground, and they join partway. Only then does the
  // return stroke light the whole channel.
  const LEAD = 0.16; // seconds for the two leaders to meet

  // Where the bolt touches down: a glow at the contact point and a pool of light on the grid.
  const impactGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#BFE3FF", fog: false, opacity: 0, ...additive }));
  const impactPool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTex, color: "#6FB4E8", fog: false, opacity: 0, ...additive }));
  impactPool.rotation.x = -Math.PI / 2;
  scene.add(impactGlow, impactPool);
  let boltDim = 1; // distant strikes read dimmer through the rain

  // Build both leaders in world space: down from the cloud (top) and up from the ground (foot),
  // steering toward a shared meeting point. Each point stores its growth progress, 0 to 1.
  function buildBolt(top, foot, meet, pxWorld) {
    const H = top.y - foot.y;
    const paths = [];
    const walk = (from, yEnd, steer, drift, depth, prog0, span) => {
      const dir = Math.sign(yEnd - from.y);
      const p = from.clone();
      const pts = [{ v: p.clone(), prog: prog0 }];
      while ((yEnd - p.y) * dir > 0) {
        p.y += dir * H * (0.03 + Math.random() * 0.03);
        if ((yEnd - p.y) * dir < 0) p.y = yEnd;
        p.x += (Math.random() - 0.5) * H * 0.05 + drift.x;
        p.z += (Math.random() - 0.5) * H * 0.03 + drift.z;
        if (steer) { p.x += (steer.x - p.x) * 0.12; p.z += (steer.z - p.z) * 0.12; }
        const prog = prog0 + Math.abs(p.y - from.y) / span;
        pts.push({ v: p.clone(), prog });
        if (depth < 2 && Math.random() < 0.12) {
          const a = Math.random() * Math.PI * 2, s = H * (0.015 + Math.random() * 0.02);
          const bEnd = Math.min(top.y, Math.max(foot.y, p.y + dir * H * (0.1 + Math.random() * 0.2)));
          walk(p.clone(), bEnd, null, { x: Math.cos(a) * s, z: Math.sin(a) * s }, depth + 1, prog, span);
        }
      }
      if (steer) pts[pts.length - 1].v.set(steer.x, steer.y, steer.z);
      paths.push({ pts, scale: depth ? 0.55 : 1 });
    };
    walk(top, meet.y, meet, { x: 0, z: 0 }, 0, 0, top.y - meet.y);   // stepped leader, cloud to meeting point
    walk(foot, meet.y, meet, { x: 0, z: 0 }, 0, 0, meet.y - foot.y); // streamer, ground to meeting point

    const cam = camera.position, n = new THREE.Vector3(), d = new THREE.Vector3(), view = new THREE.Vector3();
    for (const b of bolts) {
      const P = [], S = [], G = [], F = [];
      for (const { pts, scale } of paths) {
        const w = b.px * pxWorld * scale / 2;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], c = pts[i];
          // Face the camera: offset across the segment, perpendicular to the view direction.
          d.subVectors(c.v, a.v);
          view.subVectors(cam, a.v);
          n.crossVectors(d, view).normalize().multiplyScalar(w);
          const fa = Math.min(1, (top.y - a.v.y) / (H * 0.12)), fc = Math.min(1, (top.y - c.v.y) / (H * 0.12));
          const quad = [[a.v, 1, a.prog, fa], [a.v, -1, a.prog, fa], [c.v, 1, c.prog, fc],
                        [a.v, -1, a.prog, fa], [c.v, -1, c.prog, fc], [c.v, 1, c.prog, fc]];
          for (const [v, s, g, f] of quad) {
            P.push(v.x + n.x * s, v.y + n.y * s, v.z + n.z * s);
            S.push(s); G.push(g); F.push(f);
          }
        }
      }
      b.mesh.geometry.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute("side", new THREE.Float32BufferAttribute(S, 1));
      geo.setAttribute("prog", new THREE.Float32BufferAttribute(G, 1));
      geo.setAttribute("fade", new THREE.Float32BufferAttribute(F, 1));
      b.mesh.geometry = geo;
    }
  }

  function strike() {
    renderer.getDrawingBufferSize(buf);
    const cam = camera.position;
    // A ground point out past the arena, somewhere the camera can see.
    const gz = -110 - Math.random() * 270;
    const D = cam.z - gz;
    const halfW = D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * 0.9;
    const foot = new THREE.Vector3((Math.random() * 2 - 1) * halfW, 0, gz);
    // The top: straight up from the foot to where the view ray through a point in the clouds
    // crosses the same depth, so the bolt starts inside the storm on screen.
    const ndc = foot.clone().project(camera);
    const skyNdcY = 1 - 2 * (horizonCss * (0.05 + Math.random() * 0.28)) / hero.clientHeight;
    const ray = new THREE.Vector3(ndc.x + (Math.random() - 0.5) * 0.06, skyNdcY, 0.5).unproject(camera).sub(cam).normalize();
    const top = cam.clone().addScaledVector(ray, (gz - cam.z) / ray.z);
    top.y = Math.max(top.y, 40);
    const meet = new THREE.Vector3(
      THREE.MathUtils.lerp(foot.x, top.x, 0.4) + (Math.random() - 0.5) * 6,
      top.y * (0.2 + Math.random() * 0.2), // leaders meet closer to the ground
      gz + (Math.random() - 0.5) * 6,
    );
    // World size of one screen pixel at this depth, so ribbon widths start from pixel sizes.
    const pxWorld = 2 * D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / hero.clientHeight;
    const nearness = Math.sqrt(200 / D);
    buildBolt(top, foot, meet, pxWorld * nearness);
    boltDim = THREE.MathUtils.clamp(1.25 - D / 400, 0.55, 1);

    impactGlow.position.set(foot.x, 2, foot.z);
    impactGlow.scale.setScalar(30 * nearness * (D / 200));
    impactPool.position.set(foot.x, 0.05, foot.z);
    impactPool.scale.setScalar(110 * (D / 200));

    // Light the clouds where the bolt leaves them.
    const topPx = top.clone().project(camera);
    skyUniforms.uFlash.value.set((topPx.x + 1) / 2 * buf.x, (1 - topPx.y) / 2 * buf.y, 0);
    skyUniforms.uFlashR.value = buf.x * (0.09 + Math.random() * 0.08);
    strikeAt = clock;
  }

  function tickLightning() {
    if (!reduceMotion && clock >= nextStrike) {
      strike();
      nextStrike = clock + 2.5 + Math.random() * 6;
    }
    const t = clock - strikeAt;
    let k, opacity, grow;
    if (t < LEAD) {
      // Leaders: faint channels growing toward each other, a dim glow in the cloud.
      grow = t / LEAD;
      opacity = 0.35;
      k = 0.12 * grow;
    } else {
      // Return stroke: a bright hit, a dip, a second flicker, then a quick fade.
      const s = t - LEAD;
      grow = 10;
      opacity = s < 0.06 ? 1 : s < 0.11 ? 0.2 : s < 0.18 ? 0.8 : Math.exp(-(s - 0.18) * 7) * 0.6;
      k = s < 1.2 ? opacity : 0;
    }
    skyUniforms.uFlash.value.z = k * 0.85;
    const live = t < LEAD + 0.35;
    for (const b of bolts) {
      b.mesh.visible = live;
      b.mesh.material.uniforms.uOpacity.value = opacity * boltDim;
      b.mesh.material.uniforms.uGrow.value = grow;
    }
    // The contact point sparks faintly while the streamer rises, then blazes with the return stroke.
    const contact = t < LEAD ? 0.25 * grow : k;
    impactGlow.visible = impactPool.visible = t < LEAD + 1.2;
    impactGlow.material.opacity = contact * boltDim;
    impactPool.material.opacity = contact * 0.55 * boltDim;
    bakeFlash(t < LEAD ? 0 : k);
  }

  // Each flash lifts the whole world one tone: ground, grid, hulls, glowing parts, beams.
  const FLASH_TINT = new THREE.Color("#9CC4E4");
  let worldFlash = 0;
  function bakeFlash(k) {
    if (k === worldFlash) return;
    worldFlash = k;
    ground.material.color.copy(GROUND).lerp(FLASH_TINT, 0.06 * k);
    grid.material.color.setScalar(1 + 0.7 * k);
    grid.material.opacity = 0.45 + 0.2 * k;
    hull.color.copy(HULL).lerp(FLASH_TINT, 0.12 * k);
    for (const { mat, base } of litMats) mat.color.copy(base).multiplyScalar(1 + 0.3 * k);
    scene.fog.color.copy(FOG).lerp(FLASH_TINT, 0.05 * k);
  }

  /* ---------- simulation ---------- */
  function step(dt) {
    clock += dt;
    for (const r of riders) {
      if (r.dead) { if (clock - r.deadAt > RESPAWN) spawn(r); continue; }
      r.prog += SPEED * dt;
      while (!r.dead && r.prog >= CELL) { r.prog -= CELL; arrive(r); }
      while (r.trail.length > 1 && clock - r.trail[1].t > TRAIL) r.trail.shift();
    }
    // Head-on: two live riders meeting destroy each other.
    for (let i = 0; i < riders.length; i++) {
      for (let j = i + 1; j < riders.length; j++) {
        const a = riders[i], b = riders[j];
        if (a.dead || b.dead || (a.d + 2) % 4 !== b.d) continue;
        const ha = head(a), hb = head(b);
        if (Math.hypot(ha.x - hb.x, ha.z - hb.z) < CELL * 0.5) {
          kill(a, ha.x, ha.z);
          kill(b, hb.x, hb.z);
        }
      }
    }
    if (Math.random() < dt) {
      for (const [k, e] of occupied) if (clock - e.t > TRAIL) occupied.delete(k);
    }
    tickEffects();
    tickLightning();
    tickClouds(dt);
  }

  /* ---------- drawing ---------- */
  function drawBeam(r) {
    const { wall, edge } = r.beam;
    const fade = r.dead ? Math.max(0, 1 - (clock - r.deadAt) / 0.5) : 1;
    let n = 0;
    if (fade > 0 && r.trail.length) {
      const pts = r.trail.slice();
      if (!r.dead) {
        const back = Math.max(0, r.prog - 1.3); // beam leaves from the rear wheel
        pts.push({ x: nodeX(r.gx) + DIRS[r.d][0] * back, z: nodeZ(r.gz) + DIRS[r.d][1] * back, t: clock });
      }
      const P = wall.attributes.position.array, C = wall.attributes.color.array;
      const EP = edge.attributes.position.array, EC = edge.attributes.color.array;
      const c = r.color;
      const life = (t) => Math.pow(Math.max(0, 1 - (clock - t) / TRAIL), 1.3) * fade * (1 + 0.45 * worldFlash);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], la = life(a.t), lb = life(b.t);
        if (la <= 0 && lb <= 0) continue;
        const verts = [[a, 0, la], [b, 0, lb], [b, BEAM_H, lb], [a, 0, la], [b, BEAM_H, lb], [a, BEAM_H, la]];
        for (let v = 0; v < 6; v++) {
          const [p, y, l] = verts[v], o = (n * 6 + v) * 3, k = l * (y ? 0.18 : 0.5);
          P[o] = p.x; P[o + 1] = y; P[o + 2] = p.z;
          C[o] = c.r * k; C[o + 1] = c.g * k; C[o + 2] = c.b * k;
        }
        const eo = n * 6;
        EP[eo] = a.x; EP[eo + 1] = BEAM_H; EP[eo + 2] = a.z;
        EP[eo + 3] = b.x; EP[eo + 4] = BEAM_H; EP[eo + 5] = b.z;
        EC[eo] = c.r * la; EC[eo + 1] = c.g * la; EC[eo + 2] = c.b * la;
        EC[eo + 3] = c.r * lb; EC[eo + 4] = c.g * lb; EC[eo + 5] = c.b * lb;
        n++;
      }
      wall.attributes.position.needsUpdate = wall.attributes.color.needsUpdate = true;
      edge.attributes.position.needsUpdate = edge.attributes.color.needsUpdate = true;
    }
    wall.setDrawRange(0, n * 6);
    edge.setDrawRange(0, n * 2);
  }

  function draw(dt) {
    for (const r of riders) {
      drawBeam(r);
      if (r.dead) continue;
      const h = head(r);
      r.group.position.set(h.x, 0, h.z);
      const target = -Math.atan2(DIRS[r.d][1], DIRS[r.d][0]);
      let diff = target - r.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      r.yaw += diff * Math.min(1, dt * 18);
      r.group.rotation.y = r.yaw;
      for (const w of r.wheels) w.rotation.z -= SPEED * dt / 0.6;
    }
    skyUniforms.uTime.value = clock;
    renderer.render(scene, camera);
  }

  /* ---------- camera and sizing ---------- */
  function layout() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Wide shot: fit most of the arena's width, but don't pull back forever on tall screens.
    const halfW = (COLS * CELL) / 2 * 0.95;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const dist = Math.min(150, Math.max(70, halfW / tanH));
    camera.position.set(0, dist * 0.26, dist + (ROWS * CELL) / 2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(); // project() below needs the new view matrix
    // Shift the frame so the arena lands in the open strip between the hero copy and the stat tiles.
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const centerY = (1 - new THREE.Vector3(0, 0, 0).project(camera).y) / 2 * h;
    const top = hero.getBoundingClientRect().top;
    const above = hero.querySelector(".hero-actions"), below = hero.querySelector(".readout");
    const targetY = above && below
      ? (above.getBoundingClientRect().bottom + below.getBoundingClientRect().top) / 2 - top
      : h * 0.65;
    camera.setViewOffset(w, h, 0, centerY - targetY, w, h);
    camera.updateProjectionMatrix();
    // Tell the sky where the horizon landed so its glow and clouds have faded out by then.
    const horizonY = (1 - new THREE.Vector3(0, 0, -1e6).project(camera).y) / 2 * h;
    horizonCss = Math.max(1, horizonY);
    hero.style.setProperty("--horizon", Math.round(horizonCss) + "px");
    renderer.getDrawingBufferSize(buf);
    skyUniforms.uRes.value.copy(buf);
    skyUniforms.uHorizon.value = horizonCss * renderer.getPixelRatio();
    tickClouds(0);
  }

  let raf = 0, last = 0, visible = false;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw(dt);
    if (visible) raf = requestAnimationFrame(frame);
  }
  function still() {
    layout();
    for (let i = 0; i < 240; i++) step(1 / 60);
    for (const fx of effects.splice(0)) scene.remove(fx.obj);
    draw(1);
  }
  function kick() {
    if (reduceMotion) { still(); return; }
    if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  layout();
  if ("ResizeObserver" in window) new ResizeObserver(() => { layout(); if (reduceMotion) still(); else if (!raf) draw(0); }).observe(hero);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; kick(); }), { threshold: 0.02 }).observe(hero);
  } else { visible = true; kick(); }
  hero.classList.add("has-race");
}
