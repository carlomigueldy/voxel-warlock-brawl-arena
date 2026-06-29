// Three.js renderer. Consumes simulation snapshots (whether produced locally by
// the host or received from the network) and draws the world. Also owns the
// camera that follows the local warlock.
import * as THREE from "three";
import { CFG } from "./config.js";
import { Arena } from "./arena.js";
import {
  buildWarlock, buildBolt, buildBurst, buildLightning, buildMeteor,
} from "./voxel.js";

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
    this.meteorMeshes = new Map(); // id -> group
    this.effects = [];             // transient VFX groups with .userData.update
    this.linkLines = new Map();    // "a|b" -> line
    this.localId = null;
    this.clock = new THREE.Clock();
    this.audio = null;             // set via setAudio()
    this._lastSnapT = -1;          // dedupe events per snapshot
    this._shake = 0;

    // Smoothed camera target.
    this._camTarget = new THREE.Vector3(0, 0, 0);

    window.addEventListener("resize", () => this._onResize());
  }

  setAudio(audio) { this.audio = audio; }

  _panFor(x) { return Math.max(-1, Math.min(1, x / CFG.ARENA_RADIUS)); }

  _addEffect(group) {
    this.scene.add(group);
    this.effects.push(group);
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

  _makeLabel(name, color) {
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
    spr.position.y = 3.4;
    return spr;
  }

  _ensurePlayerMesh(snap, meta) {
    let entry = this.playerMeshes.get(snap.id);
    if (!entry) {
      const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];
      const group = buildWarlock(color);
      const label = this._makeLabel(meta?.name || "warlock", color);
      group.add(label);
      this.scene.add(group);
      entry = { group, label, color, rx: snap.x, rz: snap.z, ry: snap.y, ra: snap.a };
      this.playerMeshes.set(snap.id, entry);
    }
    return entry;
  }

  removePlayer(id) {
    const e = this.playerMeshes.get(id);
    if (e) {
      this.scene.remove(e.group);
      this.playerMeshes.delete(id);
    }
  }

  // Apply a snapshot from the simulation/network.
  apply(snapshot, playerMeta) {
    if (!snapshot) return;
    // Events fire once per distinct snapshot (the same snapshot may be drawn on
    // many frames on the client between network updates).
    const isNewSnap = snapshot.t !== this._lastSnapT;
    this._lastSnapT = snapshot.t;
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

    // Status auras on warlocks (wind walk fade, shield bubble, etc.).
    for (const ps of snapshot.players) {
      const e = this.playerMeshes.get(ps.id);
      if (e) this._applyStatusVisuals(e, ps);
    }

    // Bolts (every projectile kind shares the renderer path).
    const boltSeen = new Set();
    for (const b of snapshot.bolts || []) {
      boltSeen.add(b.id);
      let m = this.boltMeshes.get(b.id);
      if (!m) {
        m = buildBolt(b.c, b.k || "fireball");
        this.scene.add(m);
        this.boltMeshes.set(b.id, m);
      }
      m.position.set(b.x, b.y ?? (CFG.PLATFORM_TOP + 1.1), b.z);
    }
    for (const id of [...this.boltMeshes.keys()]) {
      if (!boltSeen.has(id)) {
        this.scene.remove(this.boltMeshes.get(id));
        this.boltMeshes.delete(id);
      }
    }

    // Meteors (falling rocks with telegraph rings).
    const metSeen = new Set();
    for (const mt of snapshot.meteors || []) {
      metSeen.add(mt.id);
      let g = this.meteorMeshes.get(mt.id);
      if (!g) {
        g = buildMeteor(mt.x, mt.z, mt.fall, mt.r, 0xff3a1e);
        this.scene.add(g);
        this.meteorMeshes.set(mt.id, g);
      }
      g.userData.update(0, mt.t);
    }
    for (const id of [...this.meteorMeshes.keys()]) {
      if (!metSeen.has(id)) {
        this.scene.remove(this.meteorMeshes.get(id));
        this.meteorMeshes.delete(id);
      }
    }

    // Link lines between linked warlocks.
    this._updateLinks(snapshot);

    // Transient events -> VFX + SFX (only for freshly-received snapshots).
    if (isNewSnap) this._processEvents(snapshot.events || []);
  }

  _applyStatusVisuals(e, ps) {
    // Wind Walk: enemies see them faint; the local player stays visible.
    if (ps.ww && ps.id !== this.localId) {
      e.group.traverse((o) => { if (o.material && "opacity" in o.material) { o.material.transparent = true; o.material.opacity = 0.25; } });
    } else if (e._wasWW) {
      e.group.traverse((o) => { if (o.material && "opacity" in o.material) { o.material.opacity = 1; } });
    }
    e._wasWW = !!ps.ww;

    // Shield bubble.
    if (ps.sh && !e.shield) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.25, wireframe: true })
      );
      bubble.position.y = 1.0;
      e.group.add(bubble); e.shield = bubble;
    } else if (!ps.sh && e.shield) {
      e.group.remove(e.shield); e.shield = null;
    }
  }

  _updateLinks(snapshot) {
    const wanted = new Map();
    for (const ps of snapshot.players) {
      if (ps.lk) {
        const key = [ps.id, ps.lk].sort().join("|");
        wanted.set(key, [ps.id, ps.lk]);
      }
    }
    for (const [key, line] of this.linkLines) {
      if (!wanted.has(key)) { this.scene.remove(line); this.linkLines.delete(key); }
    }
    for (const [key, [a, b]] of wanted) {
      const ea = this.playerMeshes.get(a), eb = this.playerMeshes.get(b);
      if (!ea || !eb) continue;
      let line = this.linkLines.get(key);
      if (!line) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff66cc, transparent: true, opacity: 0.7 }));
        this.scene.add(line); this.linkLines.set(key, line);
      }
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, ea.rx, 1.2, ea.rz);
      pos.setXYZ(1, eb.rx, 1.2, eb.rz);
      pos.needsUpdate = true;
    }
  }

  _processEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case "hit":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffcc44, { count: 16, speed: 7 }));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.6, this._shake + 0.15);
          break;
        case "death":
          this.audio?.play("death");
          this._shake = Math.min(0.8, this._shake + 0.3);
          break;
        case "cast": {
          const col = { fireball: 0xff5a1e, boomerang: 0xffe14c, homing: 0xc04cff, bouncer: 0x4cff9c, splitter: 0xff4ca8, fireSpray: 0xff7a2e, disable: 0xbbbbbb }[ev.spell] || 0xffffff;
          this._addEffect(this._burstAt(ev.x, ev.z, col, { count: 8, speed: 4, life: 0.35 }));
          break;
        }
        case "lightning":
          for (const s of ev.segs || []) this._addEffect(buildLightning(s.x1, s.z1, s.x2, s.z2, ev.color || 0x9fe6ff));
          this.audio?.play("lightning");
          break;
        case "teleport":
          this._addEffect(this._burstAt(ev.x1, ev.z1, 0x66ccff, { count: 14 }));
          this._addEffect(this._burstAt(ev.x2, ev.z2, 0x66ccff, { count: 14 }));
          break;
        case "thrust":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffffff, { count: 8, speed: 5 }));
          break;
        case "swap":
          this._addEffect(this._burstAt(ev.ax, ev.az, 0xc04cff, { count: 12 }));
          this._addEffect(this._burstAt(ev.bx, ev.bz, 0xc04cff, { count: 12 }));
          break;
        case "drain":
          this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, 0x9c2bff));
          break;
        case "gravity":
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, 0x6c4cff));
          break;
        case "meteorImpact":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff3a1e, { count: 24, speed: 9, life: 0.7 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, 0xff3a1e));
          this.audio?.play("meteorImpact", this._panFor(ev.x));
          this._shake = Math.min(1.0, this._shake + 0.5);
          break;
        case "shield":
        case "windwalk":
        case "rush":
        case "timeshift":
        case "timeshiftReturn":
          this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, 0x88ddff, { count: 10 }));
          break;
        case "sfx":
          this.audio?.play(ev.sfx, this._panFor(ev.x || 0));
          break;
      }
    }
  }

  _burstAt(x, z, color, opts) {
    const g = buildBurst(color, opts);
    g.position.set(x, 1.0, z);
    return g;
  }

  _ringPulse(x, z, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.5, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.15, z);
    ring.userData.t = 0; ring.userData.life = 0.6; ring.userData.done = false;
    ring.userData.update = (dt) => {
      ring.userData.t += dt;
      const k = ring.userData.t / ring.userData.life;
      ring.scale.setScalar(1 + k * radius * 2);
      ring.material.opacity = Math.max(0, 0.7 * (1 - k));
      if (k >= 1) ring.userData.done = true;
    };
    return ring;
  }

  // Smoothly move meshes toward their target snapshot positions + follow cam.
  update() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.arena.update(t);

    const lerp = 1 - Math.exp(-18 * dt); // framerate-independent smoothing

    for (const [id, e] of this.playerMeshes) {
      if (!e.target) continue;
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

      // Tint by charge: hotter = more charged (closer to white-hot).
      const c = Math.min(1, (e.target.c || 0) / CFG.CHARGE_MAX);
      e.group.children.forEach((ch) => {
        if (ch.material && ch.material.emissive) {
          ch.material.emissive.setRGB(c * 0.6, c * 0.1, 0);
        }
      });
    }

    // Spin bolts for flair.
    for (const m of this.boltMeshes.values()) {
      m.rotation.y += dt * 6;
      m.rotation.x += dt * 4;
    }

    // Advance transient VFX and cull finished ones.
    for (const g of this.effects) {
      if (g.userData.update) g.userData.update(dt);
    }
    this.effects = this.effects.filter((g) => {
      if (g.userData.done) { this.scene.remove(g); return false; }
      return true;
    });

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
    // Decaying screen shake for impacts.
    let sx = 0, sy = 0;
    if (this._shake > 0) {
      sx = (Math.random() - 0.5) * this._shake * 2;
      sy = (Math.random() - 0.5) * this._shake * 2;
      this._shake = Math.max(0, this._shake - dt * 1.8);
    }
    const desired = new THREE.Vector3(
      this._camTarget.x + sx,
      26 + sy,
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

  // Convert a screen point to a world ground point {x, z} (y=0 plane).
  screenToPoint(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  reset() {
    for (const id of [...this.playerMeshes.keys()]) this.removePlayer(id);
    for (const id of [...this.boltMeshes.keys()]) {
      this.scene.remove(this.boltMeshes.get(id));
    }
    this.boltMeshes.clear();
    for (const g of this.meteorMeshes.values()) this.scene.remove(g);
    this.meteorMeshes.clear();
    for (const g of this.effects) this.scene.remove(g);
    this.effects = [];
    for (const l of this.linkLines.values()) this.scene.remove(l);
    this.linkLines.clear();
    this.arena.reset();
  }
}
