// Low-poly voxel mesh builders. Everything is built from boxes for the
// blocky aesthetic, merged where possible to keep draw calls down.
import * as THREE from "three";
import { CFG, getArenaWorld, getArenaHazard, isOnArenaWorld } from "./config.js";
import { CastAnimator } from "./animations.js";

function box(w, h, d, color, x = 0, y = 0, z = 0, flat = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({
    color,
    flatShading: flat,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function joint(x = 0, y = 0, z = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  return j;
}

// Shade a color by a factor (for cheap voxel "AO"/variation).
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, f);
  return c.getHex();
}

// Build a chunky low-poly warlock from stacked voxels.
// Returns a Group whose children we can recolor per player.
export function buildWarlock(color) {
  const g = new THREE.Group();

  const robe = shade(color, -0.05);
  const robeDark = shade(color, -0.18);
  const skin = 0xf0c8a0;

  const spine = joint(0, 0.6, 0);
  g.add(spine);
  spine.add(box(1.1, 0.6, 1.1, robeDark, 0, -0.30, 0));
  spine.add(box(0.9, 0.7, 0.9, robe, 0, 0.35, 0));
  spine.add(box(1.0, 0.3, 0.8, robe, 0, 0.80, 0));

  const neck = joint(0, 1.25, 0);
  spine.add(neck);
  neck.add(box(0.6, 0.6, 0.6, skin, 0, 0, 0));
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), eyeMat);
  const e2 = e1.clone();
  e1.position.set(-0.15, 0.05, 0.31);
  e2.position.set(0.15, 0.05, 0.31);
  neck.add(e1, e2);

  const hat = joint(0, 0.35, 0);
  neck.add(hat);
  const hat1 = box(0.75, 0.25, 0.75, robeDark, 0, 0.0, 0);
  const hat2 = box(0.5, 0.4, 0.5, robe, 0, 0.3, 0);
  const hat3 = box(0.22, 0.4, 0.22, robeDark, 0, 0.65, 0);
  hat.add(hat1, hat2, hat3);

  const shoulderL = joint(-0.62, 0.75, 0.1);
  const shoulderR = joint(0.62, 0.75, 0.1);
  spine.add(shoulderL, shoulderR);
  shoulderL.add(box(0.25, 0.6, 0.25, robe, 0, -0.3, 0));
  shoulderR.add(box(0.25, 0.6, 0.25, robe, 0, -0.3, 0));

  const hipL = joint(-0.24, 0.5, 0);
  const hipR = joint(0.24, 0.5, 0);
  g.add(hipL, hipR);
  hipL.add(box(0.26, 0.5, 0.26, robeDark, 0, -0.25, 0));
  hipR.add(box(0.26, 0.5, 0.26, robeDark, 0, -0.25, 0));

  g.userData.colorParts = [hat1, hat2, hat3];
  g.userData.rig = {
    spine, neck, hat,
    armL: shoulderL, armR: shoulderR,
    legL: hipL, legR: hipR,
  };
  g.userData.anim = { phase: 0, cast: 0, fall: 0 };
  // Body-cast archetype overlay (attack/slam/dash/buff/channel), shared with the
  // GLB rig via the same CastAnimator state machine.
  g.userData.castAnim = new CastAnimator();
  g.userData.triggerCast = (archetype) => g.userData.castAnim.trigger(archetype);
  g.scale.setScalar(0.9);
  return g;
}

const _lerp = (a, b, t) => a + (b - a) * t;

export function animateWarlock(group, state) {
  const rig = group.userData.rig;
  const anim = group.userData.anim;
  if (!rig || !anim) return;

  const dt = Math.min(0.05, Math.max(0.0001, state.dt || 0.016));
  const time = state.time || 0;
  const maxSpeed = state.maxSpeed || 9;
  const gait = Math.min(1, (state.speed || 0) / maxSpeed);
  const moving = gait > 0.06;

  anim.cast = _lerp(anim.cast, Math.min(1, state.charge || 0), 1 - Math.exp(-8 * dt));
  anim.fall = _lerp(anim.fall, state.falling ? 1 : 0, 1 - Math.exp(-10 * dt));
  anim.phase += dt * (moving ? 7 + gait * 6 : 2.0);

  const ph = anim.phase;
  const swing = Math.sin(ph) * (moving ? 0.35 + gait * 0.55 : 0);
  const idle = 1 - Math.min(1, gait * 4);
  const bob = moving
    ? Math.abs(Math.sin(ph)) * (0.06 + gait * 0.06)
    : Math.sin(time * 1.8) * 0.025;
  const lean = moving ? 0.06 + gait * 0.12 : 0;
  const cast = anim.cast;
  const fall = anim.fall;

  let armLx = -swing * 0.9 + Math.sin(time * 1.6) * 0.06 * idle;
  let armRx = swing * 0.9 + Math.sin(time * 1.6 + Math.PI) * 0.06 * idle;
  let legLx = swing;
  let legRx = -swing;

  armLx = _lerp(_lerp(armLx, -1.85, cast), -2.6, fall);
  armRx = _lerp(_lerp(armRx, -1.85, cast), -2.6, fall);
  legLx = _lerp(legLx, 0.5, fall);
  legRx = _lerp(legRx, -0.5, fall);

  rig.armL.rotation.x = armLx;
  rig.armR.rotation.x = armRx;
  rig.armL.rotation.z = _lerp(0, -0.5, fall);
  rig.armR.rotation.z = _lerp(0, 0.5, fall);
  rig.legL.rotation.x = legLx;
  rig.legR.rotation.x = legRx;
  rig.spine.position.y = 0.6 + bob;
  rig.spine.rotation.x = _lerp(lean, 0.9, fall) + cast * 0.15;
  rig.spine.rotation.z = _lerp(0, Math.sin(time * 2.2) * 0.04, idle);
  rig.neck.rotation.x = _lerp(0, -0.25, cast) - lean * 0.5;
  rig.hat.rotation.z = Math.sin(time * 2 + ph * 0.3) * 0.07;
  rig.hat.rotation.x = swing * 0.1;

  // Body-cast archetype overlay on top of the locomotion pose.
  const castAnim = group.userData.castAnim;
  if (castAnim) {
    castAnim.update(dt);
    applyVoxelCastOverlay(rig, castAnim, time);
  }
}

// Per-archetype arm/spine emphasis for the voxel fallback warlock, blended in by
// the CastAnimator weight so casts read distinctly from movement.
function applyVoxelCastOverlay(rig, cast, time) {
  const w = cast.weight;
  if (w <= 0.0001 || !cast.archetype) return;
  switch (cast.archetype) {
    case "attack": // both arms thrust forward
      rig.armL.rotation.x += -2.0 * w;
      rig.armR.rotation.x += -2.0 * w;
      rig.spine.rotation.x += 0.2 * w;
      break;
    case "slam": // arms overhead then down
      rig.armL.rotation.x += (-2.6 + Math.sin(time * 20) * 0.3) * w;
      rig.armR.rotation.x += (-2.6 + Math.sin(time * 20) * 0.3) * w;
      rig.spine.rotation.x += 0.3 * w;
      break;
    case "dash": // crouched lunge, arms back
      rig.armL.rotation.x += 0.9 * w;
      rig.armR.rotation.x += 0.9 * w;
      rig.spine.rotation.x += 0.4 * w;
      break;
    case "buff": // arms-up flourish
      rig.armL.rotation.x += -2.8 * w;
      rig.armR.rotation.x += -2.8 * w;
      rig.armL.rotation.z += -0.6 * w;
      rig.armR.rotation.z += 0.6 * w;
      break;
    case "channel": // braced pull, lean back
      rig.armL.rotation.x += -1.4 * w;
      rig.armR.rotation.x += -1.4 * w;
      rig.spine.rotation.x += -0.25 * w;
      break;
  }
}

// A glowing projectile. `kind` lets each spell get a distinct silhouette while
// reusing the same voxel-glow recipe (core box + translucent halo + light).
export function buildBolt(color, kind = "fireball") {
  const g = new THREE.Group();
  let coreSize = 0.5, haloSize = 0.8, haloOpacity = 0.25;
  switch (kind) {
    case "boomerang": coreSize = 0.65; haloSize = 1.0; break;
    case "homing": coreSize = 0.4; haloSize = 0.9; haloOpacity = 0.35; break;
    case "bouncer": coreSize = 0.55; haloSize = 0.85; break;
    case "splitter": coreSize = 0.6; haloSize = 0.95; break;
  }
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(coreSize, coreSize, coreSize),
    new THREE.MeshBasicMaterial({ color })
  );
  const halo = new THREE.Mesh(
    new THREE.BoxGeometry(haloSize, haloSize, haloSize),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: haloOpacity })
  );
  core.rotation.set(0.6, 0.6, 0);
  halo.rotation.set(0.6, 0.6, 0);
  g.add(halo, core);
  if (kind === "boomerang") {
    // Cross-blade so it reads as a spinning boomerang.
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.18, 0.18),
      new THREE.MeshBasicMaterial({ color })
    );
    g.add(blade);
  }
  const light = new THREE.PointLight(color, 1.2, 6);
  g.add(light);
  g.userData.kind = kind;
  return g;
}

export function buildRune(color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.25, 0.9),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 })
  );
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial({ color })
  );
  core.position.y = 0.55;
  core.rotation.set(0.5, 0.5, 0);
  const light = new THREE.PointLight(color, 1.2, 5);
  light.position.y = 1.0;
  g.add(base, core, light);
  g.userData.core = core;
  return g;
}

// A short-lived particle burst (used for hits, casts, impacts). Returns a group
// with a per-frame `update(dt)` and a `done` flag the renderer polls.
export function buildBurst(color, opts = {}) {
  const count = opts.count || 14;
  const speed = opts.speed || 6;
  const size = opts.size || 0.18;
  const life = opts.life || 0.5;
  const g = new THREE.Group();
  const parts = [];
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat.clone());
    const a = Math.random() * Math.PI * 2;
    const el = (Math.random() - 0.3) * 1.4;
    const sp = speed * (0.5 + Math.random());
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, el * sp * 0.6 + 2, Math.sin(a) * sp);
    g.add(m); parts.push(m);
  }
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    for (const m of parts) {
      m.position.addScaledVector(m.userData.v, dt);
      m.userData.v.y -= 14 * dt;
      m.userData.v.multiplyScalar(1 - 1.5 * dt);
      m.material.opacity = Math.max(0, 1 - k);
      m.scale.setScalar(Math.max(0.05, 1 - k));
    }
    if (k >= 1) g.userData.done = true;
  };
  return g;
}

// A lightning bolt rendered as a jagged emissive tube between two points.
export function buildLightning(x1, z1, x2, z2, color) {
  const g = new THREE.Group();
  const y = 1.2;
  const start = new THREE.Vector3(x1, y, z1);
  const end = new THREE.Vector3(x2, y, z2);
  const segs = 8;
  const points = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = start.clone().lerp(end, t);
    if (i > 0 && i < segs) {
      p.x += (Math.random() - 0.5) * 1.2;
      p.z += (Math.random() - 0.5) * 1.2;
      p.y += (Math.random() - 0.5) * 0.8;
    }
    points.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  g.add(line);
  const light = new THREE.PointLight(color, 2, 12);
  light.position.copy(start.clone().lerp(end, 0.5));
  g.add(light);
  g.userData.t = 0; g.userData.life = 0.3; g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / g.userData.life;
    line.material.opacity = Math.max(0, 1 - k);
    light.intensity = Math.max(0, 2 * (1 - k));
    if (k >= 1) g.userData.done = true;
  };
  return g;
}

// A telegraphed meteor: a falling rock plus a ground ring marker.
export function buildMeteor(x, z, fall, radius, color) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x552211, emissive: 0xff3a1e, emissiveIntensity: 0.6, flatShading: true })
  );
  rock.position.set(x, 30, z);
  g.add(rock);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3a1e, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.1, z);
  g.add(ring);
  const light = new THREE.PointLight(0xff3a1e, 1.5, 14);
  light.position.set(x, 8, z);
  g.add(light);
  g.userData = { x, z, fall, total: fall, rock, ring, light, done: false };
  g.userData.update = (dt, tLeft) => {
    const k = 1 - tLeft / g.userData.total; // 0..1 as it falls
    rock.position.y = 30 * (1 - k);
    rock.rotation.x += dt * 4; rock.rotation.z += dt * 3;
    ring.material.opacity = 0.3 + 0.4 * k;
    ring.scale.setScalar(1 + 0.1 * Math.sin(k * 20));
    light.position.y = rock.position.y;
  };
  return g;
}

// Build the voxel platform mesh for a given radius using merged boxes.
// We rebuild it when the radius changes (shrinking arena).
export function buildPlatform(radius, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g = new THREE.Group();
  const step = 2; // voxel block size for the floor
  const world = getArenaWorld(worldId);

  // Use instancing for performance.
  const cells = [];
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) {
      if (isOnArenaWorld(world.id, radius, x, z)) cells.push([x, z]);
    }
  }

  const topGeo = new THREE.BoxGeometry(step, 1, step);
  const sideGeo = new THREE.BoxGeometry(step, 3, step);
  const topMat = new THREE.MeshLambertMaterial({ color: world.top, flatShading: true });
  const sideMat = new THREE.MeshLambertMaterial({ color: world.side, flatShading: true });

  const topMesh = new THREE.InstancedMesh(topGeo, topMat, cells.length);
  const sideMesh = new THREE.InstancedMesh(sideGeo, sideMat, cells.length);
  topMesh.receiveShadow = true;
  sideMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();

  cells.forEach(([x, z], i) => {
    // tiny deterministic height variation for texture
    const jitter = ((Math.abs(x * 13 + z * 7)) % 3) * 0.06;
    dummy.position.set(x, -0.5 + jitter, z);
    dummy.updateMatrix();
    topMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, -2.5, z);
    dummy.updateMatrix();
    sideMesh.setMatrixAt(i, dummy.matrix);
  });
  topMesh.instanceMatrix.needsUpdate = true;
  sideMesh.instanceMatrix.needsUpdate = true;

  g.add(sideMesh, topMesh);
  g.userData.radius = radius;
  g.userData.world = world.id;
  return g;
}

// Build the animated hazard surface that surrounds and underlies the platform.
// `hazard` is an entry from CFG.ARENA_HAZARDS; its `style`/color/amp drive both
// the look and the per-frame motion in animateHazard so each map reads as its
// own environment (lava sea, ocean, toxic swamp, sharp rocks, arcane abyss).
export function buildHazard(size, y, hazard) {
  const theme = hazard || getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
  const segs = theme.jagged ? 40 : 24;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Sharp rocks read as opaque flat-shaded stone; liquids glow without lighting.
  const mat = theme.jagged
    ? new THREE.MeshLambertMaterial({ color: theme.color, flatShading: true })
    : new THREE.MeshBasicMaterial({ color: theme.color });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.userData.base = geo.attributes.position.array.slice();
  mesh.userData.hazard = theme;

  // Pre-bake jagged spikes once; animateHazard leaves these static (just a tiny
  // shimmer) so the rocks feel solid rather than fluid.
  if (theme.jagged) {
    const pos = geo.attributes.position;
    const base = mesh.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      const spike = (Math.abs(Math.sin(x * 1.7) * Math.cos(z * 1.3)) ** 2) * 3.2;
      base[i * 3 + 1] = pos.array[i * 3 + 1] + spike;
      pos.array[i * 3 + 1] = base[i * 3 + 1];
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return mesh;
}

// Per-frame motion. The style decides the wave shape: lava churns, ocean rolls
// in clean swells, swamp oozes slowly, rocks barely shimmer, the void pulses.
export function animateHazard(mesh, t) {
  if (!mesh) return;
  const theme = mesh.userData.hazard || {};
  const style = theme.style || "lava";
  const amp = theme.amp ?? 0.4;
  const speed = theme.speed ?? 1.5;
  const pos = mesh.geometry.attributes.position;
  const base = mesh.userData.base;
  const tt = t * speed;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const z = base[i * 3 + 2];
    const baseY = base[i * 3 + 1];
    let h = 0;
    switch (style) {
      case "ocean":
        // Long directional swells layered with a cross-chop.
        h = Math.sin(x * 0.18 + tt) * amp + Math.sin((x + z) * 0.12 + tt * 0.7) * amp * 0.6;
        break;
      case "swamp":
        // Slow, sparse bubbling — mostly still with occasional rises.
        h = Math.sin(x * 0.5 + tt) * Math.cos(z * 0.5 + tt * 0.8) * amp;
        break;
      case "rocks":
        // Static jagged field, only a faint heat-haze shimmer.
        h = Math.sin(x * 2.0 + tt * 2) * amp;
        break;
      case "void":
        // Concentric arcane pulse radiating from the center.
        h = Math.sin(Math.hypot(x, z) * 0.4 - tt * 1.6) * amp;
        break;
      case "lava":
      default:
        h = Math.sin(x * 0.3 + tt) * amp + Math.cos(z * 0.4 + tt * 0.66) * amp;
        break;
    }
    pos.array[i * 3 + 1] = baseY + h;
  }
  pos.needsUpdate = true;
}

// Ambient detail props that float above the hazard surface (embers, spray,
// bubbles, dust, arcane shards). Returns a Group of instanced-ish small meshes,
// each carrying its own per-particle state. animateHazardDetails advances them
// and recycles any that rise past their ceiling, so the field loops forever.
export function buildHazardDetails(size, y, hazard) {
  const theme = hazard || getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
  const detail = theme.detail;
  const g = new THREE.Group();
  if (!detail) return g;

  const half = size * 0.5;
  const kind = detail.kind;
  const color = detail.color ?? theme.color;
  const baseSize = detail.size ?? 0.25;
  const rise = detail.rise ?? 4;
  const ceiling = (detail.ceiling ?? 9);

  // Shards (void) are opaque flat-shaded crystals; everything else is a soft
  // additive-looking translucent mote.
  const makeMesh = () => {
    if (kind === "shards") {
      return new THREE.Mesh(
        new THREE.OctahedronGeometry(baseSize),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
      );
    }
    return new THREE.Mesh(
      new THREE.BoxGeometry(baseSize, baseSize, baseSize),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
    );
  };

  for (let i = 0; i < detail.count; i++) {
    const m = makeMesh();
    const px = (Math.random() * 2 - 1) * half * 0.55;
    const pz = (Math.random() * 2 - 1) * half * 0.55;
    const startY = y + Math.random() * ceiling;
    m.position.set(px, startY, pz);
    m.userData.p = {
      x: px, z: pz,
      baseY: y,
      ceiling,
      vy: rise * (0.5 + Math.random()),
      drift: (Math.random() * 2 - 1) * 0.6,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() * 2 - 1) * 2,
      size: baseSize,
    };
    g.add(m);
  }
  g.userData.detail = detail;
  return g;
}

// Per-frame motion for the ambient detail props. Each particle rises, drifts,
// fades near its ceiling, then recycles to the surface — an endless loop.
export function animateHazardDetails(group, t, dt) {
  if (!group || !group.children.length) return;
  const detail = group.userData.detail || {};
  const kind = detail.kind;
  const step = Number.isFinite(dt) ? dt : 0.016;
  for (const m of group.children) {
    const p = m.userData.p;
    if (!p) continue;
    p.vy += 0; // constant rise (kept simple/cheap)
    m.position.y += p.vy * step;

    // Lateral motion: sway for light motes, gentle bob for bubbles/dust.
    const sway = Math.sin(t * 1.5 + p.phase) * p.drift;
    m.position.x = p.x + sway;
    m.position.z = p.z + Math.cos(t * 1.2 + p.phase) * p.drift * 0.6;

    const climbed = m.position.y - p.baseY;
    const k = Math.min(1, climbed / p.ceiling);
    if (m.material) m.material.opacity = Math.max(0, (1 - k) * 0.85);

    if (kind === "shards") {
      m.rotation.x += p.spin * step;
      m.rotation.y += p.spin * step * 0.7;
    } else if (kind === "embers") {
      // Embers shrink as they cool.
      m.scale.setScalar(Math.max(0.15, 1 - k));
    }

    // Recycle once it reaches the ceiling.
    if (climbed >= p.ceiling) {
      m.position.y = p.baseY;
      m.scale.setScalar(1);
      if (m.material) m.material.opacity = 0.85;
    }
  }
}

// --- Map layout geometry builders -----------------------------------------
// These are called by the renderer once per round when the host broadcasts a
// new mapLayout.  They share the world top/side palette and flatShading style
// of buildPlatform so the elevation layer feels like a seamless extension of
// the existing arena tiles.

/**
 * Build the elevated body + top cap for one plateau footprint.
 * Meshes are positioned in world-space so the Group can be added directly
 * to the scene without an extra transform.
 *
 * @param {{ x:number, z:number, w:number, d:number, height:number }} pl
 * @param {string} worldId
 * @returns {THREE.Group}
 */
export function buildPlateau(pl, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g     = new THREE.Group();
  const world = getArenaWorld(worldId);

  // Body: spans from PLATFORM_TOP to the plateau surface; uses world.side color
  // to match the vertical edges of buildPlatform tiles.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(pl.w, pl.height, pl.d),
    new THREE.MeshLambertMaterial({ color: world.side, flatShading: true })
  );
  body.position.set(pl.x, CFG.PLATFORM_TOP + pl.height * 0.5, pl.z);
  body.castShadow    = true;
  body.receiveShadow = true;
  g.add(body);

  // Top cap: a thin slab proud of the surface so it reads as the walkable top
  // (mirrors the single-step top tiles in buildPlatform).
  const capH = 0.35;
  const top  = new THREE.Mesh(
    new THREE.BoxGeometry(pl.w, capH, pl.d),
    new THREE.MeshLambertMaterial({ color: world.top, flatShading: true })
  );
  top.position.set(pl.x, CFG.PLATFORM_TOP + pl.height + capH * 0.5, pl.z);
  top.castShadow    = true;
  top.receiveShadow = true;
  g.add(top);

  return g;
}

/**
 * Build the stacked-step ramp that connects ground level to a plateau face.
 * Uses one box per step so the geometry reads as voxel blocks (same aesthetic
 * as buildPlatform's grid tiles).  Positions are in world-space.
 *
 * Side conventions (from mapgen.js):
 *   0 = +x face: ramp extends in +x; head (high) at ramp.x − ramp.w/2.
 *   1 = −x face: ramp extends in −x; head (high) at ramp.x + ramp.w/2.
 *   2 = +z face: ramp extends in +z; head (high) at ramp.z − ramp.d/2.
 *   3 = −z face: ramp extends in −z; head (high) at ramp.z + ramp.d/2.
 *
 * @param {{ side:number, x:number, z:number, w:number, d:number }} ramp
 * @param {number} plateauHeight  – height of the parent plateau above PLATFORM_TOP
 * @param {string} worldId
 * @returns {THREE.Group}
 */
export function buildRamp(ramp, plateauHeight, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g     = new THREE.Group();
  const world = getArenaWorld(worldId);

  const isX    = ramp.side <= 1;         // slope direction: x-axis or z-axis
  const rampLen = isX ? ramp.w : ramp.d; // length along the slope
  const rampWid = isX ? ramp.d : ramp.w; // perpendicular width

  // One step per world-unit; min 2 so even a short ramp reads as stairs.
  const N       = Math.max(2, Math.ceil(rampLen));
  const stepLen = rampLen / N;
  const stepH   = plateauHeight / N;

  const topMat  = new THREE.MeshLambertMaterial({ color: world.top,  flatShading: true });
  const sideMat = new THREE.MeshLambertMaterial({ color: world.side, flatShading: true });

  for (let i = 0; i < N; i++) {
    // Each step grows taller toward the head (plateau edge).
    const h   = (i + 1) * stepH;
    // The topmost step uses world.top to blend into the plateau top cap.
    const mat = (i === N - 1) ? topMat : sideMat;
    const bw  = isX ? stepLen : rampWid;
    const bd  = isX ? rampWid : stepLen;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), mat);

    // Advance from the foot (low end) toward the head (plateau edge).
    let px, pz;
    if (ramp.side === 0) {        // foot at +x, head at −x
      px = ramp.x + ramp.w * 0.5 - (i + 0.5) * stepLen;
      pz = ramp.z;
    } else if (ramp.side === 1) { // foot at −x, head at +x
      px = ramp.x - ramp.w * 0.5 + (i + 0.5) * stepLen;
      pz = ramp.z;
    } else if (ramp.side === 2) { // foot at +z, head at −z
      px = ramp.x;
      pz = ramp.z + ramp.d * 0.5 - (i + 0.5) * stepLen;
    } else {                      // side 3: foot at −z, head at +z
      px = ramp.x;
      pz = ramp.z - ramp.d * 0.5 + (i + 0.5) * stepLen;
    }

    mesh.position.set(px, CFG.PLATFORM_TOP + h * 0.5, pz);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  return g;
}

// ── Mob mesh builders ────────────────────────────────────────────────────────
// Each builder returns a THREE.Group following the buildWarlock recipe:
//   userData.rig        — named joints for animateMob
//   userData.anim       — { phase, attack, flicker } accumulators
//   userData.healthBar  — foreground bar Mesh; renderer sets scale.x = hp/max
//
// Heights:  Stone Giant ≈ 5.8 wu (2.6× warlock);  vortex/dwarf/elemental ≈ 3–4 wu;
//           minion ≈ 0.7× warlock (group scale 0.7, warlock-proportion geometry).

function _makeHealthBar(color, yPos = 3.5) {
  const g = new THREE.Group();
  g.position.y = yPos;
  const bg = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.18, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.18, 0.14),
    new THREE.MeshBasicMaterial({ color })
  );
  g.add(bg, bar);
  return { group: g, bar };
}

// Stone Giant — grey stone colossus, oversized fists, glowing red eye slits.
export function buildStoneGiant(color = 0x888888) {
  const g = new THREE.Group();
  const stone = color;
  const dark  = shade(stone, -0.15);
  const light = shade(stone, 0.08);

  // Torso (tall slab)
  const torso = joint(0, 2.0, 0);
  g.add(torso);
  torso.add(box(2.4, 1.6, 1.8, stone, 0, 0, 0));
  torso.add(box(2.6, 0.34, 2.0, dark, 0, -0.85, 0)); // belt ridge

  // Head (boulder)
  const head = joint(0, 1.2, 0);
  torso.add(head);
  head.add(box(1.6, 1.2, 1.4, light, 0, 0.2, 0));
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.08), glowMat);
  const eR = eL.clone();
  eL.position.set(-0.3, 0.35, 0.72);
  eR.position.set( 0.3, 0.35, 0.72);
  head.add(eL, eR);

  // Arms (huge, oversized fists)
  const armL = joint(-1.7, 0.3, 0.1);
  const armR = joint( 1.7, 0.3, 0.1);
  torso.add(armL, armR);
  armL.add(box(0.8, 1.8, 0.8, stone, 0, -0.9, 0));
  armL.add(box(1.3, 1.2, 1.3, dark,  0, -2.3, 0));
  armR.add(box(0.8, 1.8, 0.8, stone, 0, -0.9, 0));
  armR.add(box(1.3, 1.2, 1.3, dark,  0, -2.3, 0));

  // Legs
  const legL = joint(-0.65, 0, 0);
  const legR = joint( 0.65, 0, 0);
  g.add(legL, legR);
  legL.add(box(0.9, 1.8, 0.9, stone, 0, -0.9, 0));
  legR.add(box(0.9, 1.8, 0.9, stone, 0, -0.9, 0));

  const hb = _makeHealthBar(0xff3a1e, 5.2);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck: head, armL, armR, legL, legR, spineBaseY: 2.0 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  return g;
}

// Storming Vortex — translucent spinning shard ring with glowing core.
export function buildStormingVortex(color = 0x7adfff) {
  const g = new THREE.Group();
  const c1 = color;
  const c2 = shade(color, 0.2);

  // Inner shard ring
  const spin = new THREE.Group();
  g.add(spin);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const shard = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 1.4, 0.18),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? c1 : c2, transparent: true, opacity: 0.75 })
    );
    shard.position.set(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 0.9);
    shard.rotation.y = a;
    shard.rotation.x = 0.28;
    spin.add(shard);
  }

  // Core body
  const core = joint(0, 0.8, 0);
  g.add(core);
  core.add(box(0.8, 1.6, 0.8, c1, 0, 0, 0));
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), eyeM);
  eye.position.set(0, 0.35, 0.42);
  core.add(eye);

  // Outer orbiting shards
  const outerSpin = new THREE.Group();
  g.add(outerSpin);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const shard = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.8, 0.2),
      new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.5 })
    );
    shard.position.set(Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5);
    outerSpin.add(shard);
  }

  const glow = new THREE.PointLight(c1, 1.5, 8);
  glow.position.set(0, 1.2, 0);
  g.add(glow);

  const hb = _makeHealthBar(0x7adfff, 2.5);
  g.add(hb.group);
  g.userData.rig = { spine: core, spin, outerSpin, spineBaseY: 0.8 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.35);
  return g;
}

// Giant Dwarf — short/wide armoured figure, heavy stomp posture.
export function buildGiantDwarf(color = 0xc47a2e) {
  const g = new THREE.Group();
  const body  = shade(color, -0.05);
  const armor = shade(color, -0.2);
  const skin  = 0xf0c0a0;

  // Wide stocky torso
  const torso = joint(0, 1.1, 0);
  g.add(torso);
  torso.add(box(2.2, 1.2, 1.6, body,  0,  0,    0));
  torso.add(box(2.4, 0.3, 1.8, armor, 0, -0.6,  0)); // belt plate
  torso.add(box(2.4, 0.3, 1.8, armor, 0,  0.55, 0)); // chest plate

  // Broad head + beard
  const neck = joint(0, 0.9, 0);
  torso.add(neck);
  neck.add(box(1.2, 1.0, 1.0, skin,    0, 0.1,  0));
  neck.add(box(1.0, 0.5, 0.5, 0x884422, 0, -0.38, 0)); // beard
  neck.add(box(1.3, 0.32, 1.1, armor,   0,  0.62, 0)); // helmet brim
  neck.add(box(0.5, 0.38, 0.5, armor,   0,  0.84, 0)); // helmet top
  const em2 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.08), em2);
  const dR = dL.clone();
  dL.position.set(-0.22, 0.18, 0.52);
  dR.position.set( 0.22, 0.18, 0.52);
  neck.add(dL, dR);

  // Short stubby arms + gauntlets
  const armL = joint(-1.35, 0.25, 0.1);
  const armR = joint( 1.35, 0.25, 0.1);
  torso.add(armL, armR);
  armL.add(box(0.65, 1.2, 0.65, body,  0, -0.6, 0));
  armL.add(box(0.88, 0.9, 0.88, armor, 0, -1.4, 0));
  armR.add(box(0.65, 1.2, 0.65, body,  0, -0.6, 0));
  armR.add(box(0.88, 0.9, 0.88, armor, 0, -1.4, 0));

  // Short wide legs
  const legL = joint(-0.58, 0, 0);
  const legR = joint( 0.58, 0, 0);
  g.add(legL, legR);
  legL.add(box(0.78, 0.9, 0.78, body,  0, -0.45, 0));
  legL.add(box(0.9,  0.38, 1.0, armor, 0, -0.98, 0.08)); // boot
  legR.add(box(0.78, 0.9, 0.78, body,  0, -0.45, 0));
  legR.add(box(0.9,  0.38, 1.0, armor, 0, -0.98, 0.08));

  const hb = _makeHealthBar(0xffd23c, 3.8);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck, armL, armR, legL, legR, spineBaseY: 1.1 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.1);
  return g;
}

// Fire Elemental — emissive boxes with orbiting flame motes, per-frame flicker.
export function buildFireElemental(color = 0xff5a1e) {
  const g = new THREE.Group();
  const hot  = color;
  const core = 0xffcc44;

  // Body stack (emissive)
  const torso = joint(0, 1.2, 0);
  g.add(torso);
  const bodyM = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.0, 1.2),
    new THREE.MeshLambertMaterial({ color: hot, emissive: 0xff3300, emissiveIntensity: 0.8, flatShading: true })
  );
  bodyM.castShadow = true; bodyM.receiveShadow = true;
  torso.add(bodyM);
  const coreM = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.2, 0.7),
    new THREE.MeshLambertMaterial({ color: core, emissive: 0xffcc00, emissiveIntensity: 1.4, flatShading: true })
  );
  coreM.castShadow = true; coreM.position.y = 0.1;
  torso.add(coreM);

  // Head (flame crown)
  const head = joint(0, 1.2, 0);
  torso.add(head);
  const headM = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.0, 1.0),
    new THREE.MeshLambertMaterial({ color: hot, emissive: 0xff5500, emissiveIntensity: 1.0, flatShading: true })
  );
  headM.castShadow = true;
  head.add(headM);
  const em3 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const fL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), em3);
  const fR = fL.clone();
  fL.position.set(-0.22, 0.06, 0.52);
  fR.position.set( 0.22, 0.06, 0.52);
  head.add(fL, fR);

  // Flame tendril arms
  const armL = joint(-0.85, 0.5, 0.1);
  const armR = joint( 0.85, 0.5, 0.1);
  torso.add(armL, armR);
  const armMatL = new THREE.MeshLambertMaterial({ color: hot, emissive: 0xff3300, emissiveIntensity: 0.7, flatShading: true });
  const aML = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), armMatL);
  aML.position.y = -0.75; aML.castShadow = true;
  armL.add(aML);
  const aMR = aML.clone();
  armR.add(aMR);

  // Orbiting flame motes
  const motes = new THREE.Group();
  g.add(motes);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const mote = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.36, 0.22),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffcc44 : hot, transparent: true, opacity: 0.85 })
    );
    mote.position.set(Math.cos(a) * 0.85, 1.0, Math.sin(a) * 0.85);
    mote.userData.baseA = a;
    motes.add(mote);
  }

  const glow = new THREE.PointLight(hot, 2.0, 10);
  glow.position.set(0, 1.5, 0);
  g.add(glow);

  const hb = _makeHealthBar(0xff5a1e, 4.0);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck: head, armL, armR, motes, glow, spineBaseY: 1.2 };
  g.userData.anim = { phase: 0, attack: 0, flicker: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.1);
  return g;
}

// Minion — tiny warlock silhouette tinted to parent colour, 0.7× warlock.
export function buildMinion(color = 0x999999) {
  const g = new THREE.Group();
  const c     = color;
  const cDark = shade(c, -0.2);
  const skin  = 0xf0c8a0;

  const spine = joint(0, 0.6, 0);
  g.add(spine);
  spine.add(box(1.1, 0.6, 1.1, cDark, 0, -0.30, 0));
  spine.add(box(0.9, 0.7, 0.9, c,     0,  0.35, 0));

  const neck = joint(0, 1.25, 0);
  spine.add(neck);
  neck.add(box(0.6, 0.6, 0.6, skin, 0, 0, 0));
  const em4 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const me1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), em4);
  const me2 = me1.clone();
  me1.position.set(-0.15, 0.05, 0.31);
  me2.position.set( 0.15, 0.05, 0.31);
  neck.add(me1, me2);

  const hat = joint(0, 0.35, 0);
  neck.add(hat);
  hat.add(box(0.75, 0.25, 0.75, cDark, 0, 0.0,  0));
  hat.add(box(0.5,  0.4,  0.5,  c,     0, 0.3,  0));
  hat.add(box(0.22, 0.4,  0.22, cDark, 0, 0.65, 0));

  const armL = joint(-0.62, 0.75, 0.1);
  const armR = joint( 0.62, 0.75, 0.1);
  spine.add(armL, armR);
  armL.add(box(0.25, 0.6, 0.25, c, 0, -0.3, 0));
  armR.add(box(0.25, 0.6, 0.25, c, 0, -0.3, 0));

  const legL = joint(-0.24, 0.5, 0);
  const legR = joint( 0.24, 0.5, 0);
  g.add(legL, legR);
  legL.add(box(0.26, 0.5, 0.26, cDark, 0, -0.25, 0));
  legR.add(box(0.26, 0.5, 0.26, cDark, 0, -0.25, 0));

  const hb = _makeHealthBar(0xcccccc, 2.2);
  g.add(hb.group);
  g.userData.rig = { spine, neck, hat, armL, armR, legL, legR, spineBaseY: 0.6 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(0.7);
  return g;
}

// Shared mob animator — cloned from animateWarlock but handles:
//   stormingVortex  — spin rings, no arms/legs
//   fireElemental   — flicker glow + orbit motes
//   humanoid types  — idle bob + walk swing (stoneGiant, giantDwarf, minion)
// state: { type, speed, maxSpeed, dt, time, falling }
export function animateMob(group, state) {
  const rig  = group.userData.rig;
  const anim = group.userData.anim;
  if (!rig || !anim) return;

  const dt       = Math.min(0.05, Math.max(0.0001, state.dt  || 0.016));
  const time     = state.time     || 0;
  const maxSpeed = state.maxSpeed || 5.0;
  const gait     = Math.min(1, (state.speed || 0) / maxSpeed);
  const moving   = gait > 0.06;
  const type     = state.type || "minion";

  anim.phase += dt * (moving ? 5 + gait * 4 : 1.5);
  const ph    = anim.phase;
  const swing = Math.sin(ph) * (moving ? 0.28 + gait * 0.32 : 0);
  const bob   = moving
    ? Math.abs(Math.sin(ph)) * 0.07
    : Math.sin(time * 1.4) * 0.02;
  const baseY = rig.spineBaseY ?? 1.0;

  if (type === "stormingVortex") {
    if (rig.spin)      rig.spin.rotation.y      += dt * 3.8;
    if (rig.outerSpin) rig.outerSpin.rotation.y -= dt * 2.4;
    if (rig.spine) {
      rig.spine.position.y  = baseY + Math.sin(time * 2.2) * 0.14;
      rig.spine.rotation.y += dt * 0.8;
    }
    return;
  }

  if (type === "fireElemental") {
    anim.flicker  = (anim.flicker ?? 0) + dt * 11;
    if (rig.glow) {
      rig.glow.intensity = 1.7 + Math.sin(anim.flicker) * 0.5
                               + Math.sin(anim.flicker * 1.9) * 0.3;
    }
    if (rig.motes) {
      const children = rig.motes.children;
      for (let i = 0; i < children.length; i++) {
        const m  = children[i];
        const ba = m.userData.baseA ?? 0;
        const a  = ba + time * 2.6;
        const r  = 0.85 + Math.sin(time * 2.8 + ba) * 0.2;
        m.position.set(
          Math.cos(a) * r,
          1.0 + Math.sin(time * 2 + ba) * 0.35,
          Math.sin(a) * r
        );
        if (m.material) m.material.opacity = 0.65 + Math.sin(time * 4 + ba) * 0.22;
      }
    }
    if (rig.spine) rig.spine.position.y = baseY + bob;
    if (rig.armL)  rig.armL.rotation.x  = -swing * 0.7;
    if (rig.armR)  rig.armR.rotation.x  =  swing * 0.7;
    return;
  }

  // Generic humanoid: stoneGiant / giantDwarf / minion
  if (rig.legL) rig.legL.rotation.x  =  swing;
  if (rig.legR) rig.legR.rotation.x  = -swing;
  if (rig.armL) rig.armL.rotation.x  = -swing * 0.85;
  if (rig.armR) rig.armR.rotation.x  =  swing * 0.85;
  if (rig.spine) {
    rig.spine.position.y = baseY + bob;
    rig.spine.rotation.x = moving ? 0.06 : 0;
  }
  if (rig.neck) rig.neck.rotation.x = 0;
  if (rig.hat)  rig.hat.rotation.z  = Math.sin(time * 2 + ph * 0.3) * 0.07;
}

// Dispatcher used by the renderer to build the right mesh for a given type.
export function buildMobByType(type, color) {
  switch (type) {
    case "stoneGiant":     return buildStoneGiant(color);
    case "stormingVortex": return buildStormingVortex(color);
    case "giantDwarf":     return buildGiantDwarf(color);
    case "fireElemental":  return buildFireElemental(color);
    case "minion":         return buildMinion(color);
    default:               return buildMinion(color);
  }
}

// Back-compat aliases (older callers / any external refs).
export function buildLava(size, y) {
  return buildHazard(size, y, getArenaHazard(CFG.DEFAULT_ARENA_WORLD));
}
export function animateLava(mesh, t) {
  return animateHazard(mesh, t);
}
