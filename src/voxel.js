// Low-poly voxel mesh builders. Everything is built from boxes for the
// blocky aesthetic, merged where possible to keep draw calls down.
import * as THREE from "three";
import { CFG, getArenaWorld, isOnArenaWorld } from "./config.js";

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

// Animated lava plane (cheap vertex wobble via a shader-free approach).
export function buildLava(size, y) {
  const geo = new THREE.PlaneGeometry(size, size, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3a1e });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  // store base positions for wobble
  mesh.userData.base = geo.attributes.position.array.slice();
  return mesh;
}

export function animateLava(mesh, t) {
  const pos = mesh.geometry.attributes.position;
  const base = mesh.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const z = base[i * 3 + 2];
    pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(x * 0.3 + t * 1.5) * 0.4 + Math.cos(z * 0.4 + t) * 0.4;
  }
  pos.needsUpdate = true;
}
