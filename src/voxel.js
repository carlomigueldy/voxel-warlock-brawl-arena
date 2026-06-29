// Low-poly voxel mesh builders. Everything is built from boxes for the
// blocky aesthetic, merged where possible to keep draw calls down.
import * as THREE from "three";

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

// A glowing bolt projectile (icosahedron-ish voxel cluster).
export function buildBolt(color) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial({ color })
  );
  const halo = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 })
  );
  core.rotation.set(0.6, 0.6, 0);
  halo.rotation.set(0.6, 0.6, 0);
  g.add(halo, core);
  const light = new THREE.PointLight(color, 1.2, 6);
  g.add(light);
  return g;
}

// Build the voxel platform mesh for a given radius using merged boxes.
// We rebuild it when the radius changes (shrinking arena).
export function buildPlatform(radius) {
  const g = new THREE.Group();
  const step = 2; // voxel block size for the floor
  const top = 0x6c4cff;
  const side = 0x3a2a7a;
  const r2 = radius * radius;

  // Use instancing for performance.
  const cells = [];
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) {
      if (x * x + z * z <= r2) cells.push([x, z]);
    }
  }

  const topGeo = new THREE.BoxGeometry(step, 1, step);
  const sideGeo = new THREE.BoxGeometry(step, 3, step);
  const topMat = new THREE.MeshLambertMaterial({ color: top, flatShading: true });
  const sideMat = new THREE.MeshLambertMaterial({ color: side, flatShading: true });

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
