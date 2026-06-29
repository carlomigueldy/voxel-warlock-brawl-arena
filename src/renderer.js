// Three.js renderer. Consumes simulation snapshots (whether produced locally by
// the host or received from the network) and draws the world. Also owns the
// camera that follows the local warlock.
import * as THREE from "three";
import { CFG } from "./config.js";
import { Arena } from "./arena.js";
import { buildWarlock, buildBolt, animateWarlock } from "./voxel.js";
import {
  loadCharacterTemplate,
  characterReady,
  buildCharacterInstance,
} from "./character.js";

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0b1a);
    this.scene.fog = new THREE.Fog(0x0d0b1a, 40, 90);

    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 300
    );
    this.camera.position.set(0, 28, 24);
    this.camera.lookAt(0, 0, 0);

    this._initLights();
    this.arena = new Arena(this.scene);

    this.playerMeshes = new Map(); // id -> {group, label}
    this.boltMeshes = new Map();   // id -> group
    this.localId = null;
    this.clock = new THREE.Clock();

    // Smoothed camera target.
    this._camTarget = new THREE.Vector3(0, 0, 0);

    loadCharacterTemplate()
      .then(() => this._upgradePlayersToGLB())
      .catch((err) => console.warn("Character GLB unavailable, using voxel fallback:", err));

    window.addEventListener("resize", () => this._onResize());
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0x8a7bff, 0x2a1a3a, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0e0, 1.1);
    sun.position.set(20, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);
    // Lava glow from below.
    const glow = new THREE.PointLight(0xff3a1e, 0.8, 60);
    glow.position.set(0, -6, 0);
    this.scene.add(glow);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setLocalId(id) { this.localId = id; }

  _makeLabel(name, color, y = 3.4) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.font = "bold 36px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(name, 128, 44);
    ctx.fillStyle = "#" + new THREE.Color(color).getHexString();
    ctx.fillText(name, 128, 44);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(3, 0.75, 1);
    spr.position.y = y;
    return spr;
  }

  _ensurePlayerMesh(snap, meta) {
    let entry = this.playerMeshes.get(snap.id);
    if (!entry) {
      const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];
      let group = characterReady() ? buildCharacterInstance(color) : null;
      const usingGLB = !!group;
      if (!group) group = buildWarlock(color);
      const labelY = usingGLB ? CFG.PLAYER_HEIGHT + 0.55 : 3.4;
      const label = this._makeLabel(meta?.name || "warlock", color, labelY);
      group.add(label);
      this.scene.add(group);
      entry = {
        group, label, color, usingGLB,
        rx: snap.x, rz: snap.z, ry: snap.y, ra: snap.a,
      };
      this.playerMeshes.set(snap.id, entry);
    }
    return entry;
  }

  _upgradePlayersToGLB() {
    if (!characterReady()) return;
    for (const [id, e] of this.playerMeshes) {
      if (e.usingGLB) continue;
      const next = buildCharacterInstance(e.color);
      if (!next) continue;
      next.position.copy(e.group.position);
      next.rotation.copy(e.group.rotation);
      if (e.label) {
        e.group.remove(e.label);
        e.label.position.y = CFG.PLAYER_HEIGHT + 0.55;
        next.add(e.label);
      }
      this.scene.remove(e.group);
      this._disposeGroup(e.group);
      this.scene.add(next);
      e.group = next;
      e.usingGLB = true;
    }
  }

  _disposeGroup(group, materialsOnly = false) {
    group.traverse((o) => {
      if (!materialsOnly && o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
  }

  removePlayer(id) {
    const e = this.playerMeshes.get(id);
    if (e) {
      const char = e.group.userData.character;
      if (char?.mixer) char.mixer.stopAllAction();
      this.scene.remove(e.group);
      this._disposeGroup(e.group, e.usingGLB);
      this.playerMeshes.delete(id);
    }
  }

  // Apply a snapshot from the simulation/network.
  apply(snapshot, playerMeta) {
    if (!snapshot) return;
    this.arena.setRadius(snapshot.arenaR ?? CFG.ARENA_RADIUS);

    const seen = new Set();
    for (const ps of snapshot.players) {
      seen.add(ps.id);
      const e = this._ensurePlayerMesh(ps, playerMeta?.get(ps.id));
      e.target = ps; // store for interpolation in update()
      e.group.visible = ps.al;
    }
    // Remove meshes for players no longer present.
    for (const id of [...this.playerMeshes.keys()]) {
      if (!seen.has(id)) this.removePlayer(id);
    }

    // Bolts.
    const boltSeen = new Set();
    for (const b of snapshot.bolts) {
      boltSeen.add(b.id);
      let m = this.boltMeshes.get(b.id);
      if (!m) {
        m = buildBolt(b.c);
        this.scene.add(m);
        this.boltMeshes.set(b.id, m);
      }
      m.position.set(b.x, CFG.PLATFORM_TOP + 1.1, b.z);
    }
    for (const id of [...this.boltMeshes.keys()]) {
      if (!boltSeen.has(id)) {
        this.scene.remove(this.boltMeshes.get(id));
        this.boltMeshes.delete(id);
      }
    }
  }

  // Smoothly move meshes toward their target snapshot positions + follow cam.
  update() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.arena.update(t);

    const lerp = 1 - Math.exp(-18 * dt); // framerate-independent smoothing

    for (const [id, e] of this.playerMeshes) {
      if (!e.target) continue;
      const px = e.rx, pz = e.rz;
      e.rx += (e.target.x - e.rx) * lerp;
      e.rz += (e.target.z - e.rz) * lerp;
      e.ry += (e.target.y - e.ry) * lerp;
      // shortest-arc angle lerp
      let da = e.target.a - e.ra;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      e.ra += da * lerp;

      e.group.position.set(e.rx, e.ry, e.rz);
      e.group.rotation.y = -e.ra + Math.PI / 2;

      const inst = Math.hypot(e.rx - px, e.rz - pz) / dt;
      e.spd = (e.spd || 0) + (inst - (e.spd || 0)) * (1 - Math.exp(-10 * dt));

      const c = Math.min(1, (e.target.c || 0) / CFG.CHARGE_MAX);

      // Tint by charge: hotter = more charged (closer to white-hot).
      e.group.traverse((ch) => {
        if (ch.material && ch.material.emissive) {
          ch.material.emissive.setRGB(c * 0.6, c * 0.1, 0);
        }
      });

      const char = e.group.userData.character;
      if (char) {
        char.update({
          speed: e.spd,
          maxSpeed: CFG.MOVE_SPEED,
          charge: c,
          dt,
        });
      } else {
        animateWarlock(e.group, {
          speed: e.spd,
          maxSpeed: CFG.MOVE_SPEED,
          charge: c,
          falling: !!e.target.f,
          time: t,
          dt,
        });
      }
    }

    // Spin bolts for flair.
    for (const m of this.boltMeshes.values()) {
      m.rotation.y += dt * 6;
      m.rotation.x += dt * 4;
    }

    this._updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateCamera(dt) {
    // Follow the local player; fall back to arena center.
    const me = this.playerMeshes.get(this.localId);
    const focus = me && me.target && me.target.al
      ? new THREE.Vector3(me.rx, 0, me.rz)
      : new THREE.Vector3(0, 0, 0);

    this._camTarget.lerp(focus, 1 - Math.exp(-4 * dt));
    const desired = new THREE.Vector3(
      this._camTarget.x,
      26,
      this._camTarget.z + 22
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this._camTarget.x, 0, this._camTarget.z);
  }

  // Convert a screen point to a world aim angle from the local player.
  screenToAim(clientX, clientY) {
    const me = this.playerMeshes.get(this.localId);
    if (!me) return 0;
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // Intersect the ground plane y=0.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    ray.ray.intersectPlane(plane, hit);
    if (!hit) return me.ra;
    return Math.atan2(hit.z - me.rz, hit.x - me.rx);
  }

  reset() {
    for (const id of [...this.playerMeshes.keys()]) this.removePlayer(id);
    for (const id of [...this.boltMeshes.keys()]) {
      this.scene.remove(this.boltMeshes.get(id));
    }
    this.boltMeshes.clear();
    this.arena.reset();
  }
}
