// Three.js renderer. Consumes simulation snapshots (whether produced locally by
// the host or received from the network) and draws the world. Also owns the
// camera that follows the local warlock.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CFG, SPELLS, isOnArenaWorld } from "./config.js";
import { Arena } from "./arena.js";
import {
  buildWarlock, buildBolt, animateWarlock,
  buildBurst, buildLightning, buildMeteor, buildRune,
  buildPlateau, buildRamp,
} from "./voxel.js";
import { PROP_BUILDERS } from "./props.js";
import {
  loadCharacterTemplate,
  characterReady,
  buildCharacterInstance,
} from "./character.js";
import { archetypeForEvent } from "./animations.js";

export const MESHY_ASSETS = {
  rune: "assets/meshy/ability-rune.glb",
  projectiles: {
    fireball: "assets/meshy/projectile-fireball.glb",
    boomerang: "assets/meshy/projectile-boomerang.glb",
    homing: "assets/meshy/projectile-homing.glb",
    bouncer: "assets/meshy/projectile-bouncer.glb",
    splitter: "assets/meshy/projectile-splitter.glb",
    disable: "assets/meshy/projectile-disable.glb",
    meteor: "assets/meshy/projectile-meteor.glb",
  },
};

const MESHY_ASSET_OPTIONS = {
  projectile: { size: 1.15, lightY: 0, lightDistance: 7 },
  rune: { size: 1.25, lightY: 0.55, lightDistance: 5, core: true },
  meteor: { size: 2.2 },
};

function projectileAssetPath(kind) {
  return MESHY_ASSETS.projectiles[kind] || MESHY_ASSETS.projectiles.fireball;
}

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
    this.gltfLoader = new GLTFLoader();
    this.meshyAssetCache = new Map();

    this.playerMeshes = new Map(); // id -> {group, label}
    this.boltMeshes = new Map();   // id -> group
    this.meteorMeshes = new Map(); // id -> group
    this.runeMeshes = new Map();   // id -> group
    this.effects = [];             // transient VFX groups with .userData.update
    this.linkLines = new Map();    // "a|b" -> line
    this.localId = null;
    this.clock = new THREE.Clock();
    this.audio = null;             // set via setAudio()
    this._lastSnapT = -1;          // dedupe events per snapshot
    this._shake = 0;

    // Map layout geometry (plateaus, ramps, obstacles) rebuilt once per round.
    this._mapVersion = -1;   // last snapshot.mapV applied
    this._mapMeshes  = [];   // Groups built from the current layout

    // Smoothed camera target.
    this._camTarget = new THREE.Vector3(0, 0, 0);

    // Preload every selectable character so any player's pick renders as a GLB
    // (falling back to the voxel warlock per-player only if its load fails).
    for (const ch of CFG.CHARACTERS) {
      loadCharacterTemplate(ch.id)
        .then(() => this._upgradePlayersToGLB())
        .catch((err) => console.warn(`Character GLB '${ch.id}' unavailable, using voxel fallback:`, err));
    }

    window.addEventListener("resize", () => this._onResize());
  }

  setAudio(audio) { this.audio = audio; }

  _panFor(x) { return Math.max(-1, Math.min(1, x / this.arena.radius)); }

  _addEffect(group) {
    this.scene.add(group);
    this.effects.push(group);
  }

  _loadMeshyAsset(path, opts) {
    if (!path) return Promise.resolve(null);
    if (!this.meshyAssetCache.has(path)) {
      const promise = this.gltfLoader.loadAsync(path)
        .then((gltf) => this._prepareMeshyAsset(gltf.scene, opts))
        .catch((err) => {
          console.warn(`Could not load Meshy asset ${path}`, err);
          return null;
        });
      this.meshyAssetCache.set(path, promise);
    }
    return this.meshyAssetCache.get(path).then((template) => template?.clone(true) || null);
  }

  _prepareMeshyAsset(source, opts = {}) {
    const model = source.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of materials) {
        if (mat && "flatShading" in mat) {
          mat.flatShading = true;
          mat.needsUpdate = true;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    model.position.sub(center);

    const root = new THREE.Group();
    root.add(model);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    root.scale.setScalar((opts.size || 1) / maxDim);
    root.position.y = opts.y || 0;
    return root;
  }

  _installMeshyAsset(group, path, opts = {}, color = 0xffffff) {
    group.userData.meshyPath = path;
    this._loadMeshyAsset(path, opts).then((asset) => {
      if (!asset || group.userData.meshyPath !== path || !group.parent) return;
      const label = group.userData.label;
      group.clear();
      group.add(asset);
      if (label) group.add(label);
      const light = new THREE.PointLight(color, 1.2, opts.lightDistance || 6);
      light.position.y = opts.lightY || 0;
      group.add(light);
      if (opts.core) group.userData.core = asset;
    });
  }

  _installMeshyMeteor(group) {
    this._loadMeshyAsset(MESHY_ASSETS.projectiles.meteor, MESHY_ASSET_OPTIONS.meteor)
      .then((asset) => {
        if (!asset || !group.parent) return;
        const rock = group.userData.rock;
        if (rock) rock.visible = false;
        if (rock) {
          asset.position.copy(rock.position);
          asset.rotation.copy(rock.rotation);
        }
        group.add(asset);
        const baseUpdate = group.userData.update;
        group.userData.update = (dt, tLeft) => {
          baseUpdate(dt, tLeft);
          if (!rock) return;
          asset.position.copy(rock.position);
          asset.rotation.copy(rock.rotation);
        };
      });
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
    // Hazard glow from below (color is themed per map in _applyHazardTheme).
    const glow = new THREE.PointLight(0xff3a1e, 0.8, 60);
    glow.position.set(0, -6, 0);
    this.scene.add(glow);
    this._hazardGlow = glow;
  }

  // Tint the under-glow light and the scene fog/background to match the active
  // hazard so each map feels like its own place (lava, ocean, swamp, etc.).
  _applyHazardTheme(hazard) {
    if (!hazard || this._hazardId === hazard.id) return;
    this._hazardId = hazard.id;
    if (this._hazardGlow) this._hazardGlow.color.setHex(hazard.glow ?? hazard.color);
    const fogHex = hazard.fog ?? 0x0d0b1a;
    this.scene.background = new THREE.Color(fogHex);
    if (this.scene.fog) this.scene.fog.color.setHex(fogHex);
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
      const character = meta?.character || undefined;
      let group = characterReady(character) ? buildCharacterInstance(color, character) : null;
      const usingGLB = !!group;
      if (!group) group = buildWarlock(color);
      const labelY = usingGLB ? CFG.PLAYER_HEIGHT + 0.55 : 3.4;
      const label = this._makeLabel(meta?.name || "warlock", color, labelY);
      group.add(label);
      this.scene.add(group);
      entry = {
        group, label, color, usingGLB, character,
        rx: snap.x, rz: snap.z, ry: snap.y, ra: snap.a,
      };
      this.playerMeshes.set(snap.id, entry);
    }
    return entry;
  }

  _upgradePlayersToGLB() {
    for (const [id, e] of this.playerMeshes) {
      if (e.usingGLB) continue;
      if (!characterReady(e.character)) continue;
      const next = buildCharacterInstance(e.color, e.character);
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
      char?.dispose?.(); // frees per-instance glyph texture + geometry + material
      this.scene.remove(e.group);
      this._disposeGroup(e.group, e.usingGLB);
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
    this.arena.setWorld(snapshot.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD);
    this.arena.setRadius(snapshot.arenaR ?? CFG.ARENA_RADIUS);
    this._applyHazardTheme(this.arena.hazard);

    // Rebuild map layout meshes (plateaus, ramps, obstacles) whenever the host
    // generates a new layout (each round start). mapV is an incrementing integer;
    // undefined during the lobby (treated as -1 → clear any existing meshes).
    // Also clear when mapLayout is explicitly null (returnToLobby / round reset)
    // even if mapV has not changed, so stale plateau/obstacle meshes don't linger
    // in the lobby. Omitted mapLayout (undefined) means "no change this frame".
    const snapMapV = snapshot.mapV ?? -1;
    const layoutCleared = snapshot.mapLayout === null && this._mapMeshes.length > 0;
    if (snapMapV !== this._mapVersion || layoutCleared) {
      this._mapVersion = snapMapV;
      this._rebuildMapMeshes(
        snapshot.mapLayout ?? null,
        snapshot.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD
      );
    }
    // Hide spread-out features the shrinking arena has dropped over the hazard.
    this._cullMapMeshes(
      snapshot.arenaR ?? CFG.ARENA_RADIUS,
      snapshot.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD
    );

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
        this._installMeshyAsset(
          m,
          projectileAssetPath(b.k || "fireball"),
          MESHY_ASSET_OPTIONS.projectile,
          b.c || 0xffffff
        );
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
        this._installMeshyMeteor(g);
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

    const runeSeen = new Set();
    for (const r of snapshot.runes || []) {
      runeSeen.add(r.id);
      let g = this.runeMeshes.get(r.id);
      if (!g) {
        g = buildRune(r.c || 0xffffff);
        const name = SPELLS[r.spell]?.name || r.spell || "Rune";
        const label = this._makeLabel(name, r.c || 0xffffff, 1.65);
        g.add(label);
        g.userData.label = label;
        this._installMeshyAsset(g, MESHY_ASSETS.rune, MESHY_ASSET_OPTIONS.rune, r.c || 0xffffff);
        this.scene.add(g);
        this.runeMeshes.set(r.id, g);
      }
      g.position.set(r.x, 0.25, r.z);
    }
    for (const id of [...this.runeMeshes.keys()]) {
      if (!runeSeen.has(id)) {
        this.scene.remove(this.runeMeshes.get(id));
        this.runeMeshes.delete(id);
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

    // Stun VFX: spinning yellow stars orbiting the player's head when stunned.
    // Keyed off the snapshot `st` field (stunned remaining seconds, like `hz`).
    if (ps.st > 0 && !e.stunEffect) {
      const stars = new THREE.Group();
      // Position the halo just above the label / top of the model.
      stars.position.y = e.usingGLB ? CFG.PLAYER_HEIGHT + 0.3 : 2.6;
      for (let i = 0; i < 5; i++) {
        const star = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.2, 0.2),
          new THREE.MeshBasicMaterial({ color: 0xffff44 })
        );
        const a = (i / 5) * Math.PI * 2;
        star.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
        stars.add(star);
      }
      e.group.add(stars);
      e.stunEffect = stars;
    } else if (ps.st <= 0 && e.stunEffect) {
      e.group.remove(e.stunEffect);
      e.stunEffect.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) o.material.dispose?.();
      });
      e.stunEffect = null;
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

  // Drive a caster's body-cast animation from a simulation event. Works for
  // both the GLB rig (character.triggerCast) and the voxel fallback
  // (group.userData.triggerCast).
  _triggerCast(ev) {
    const resolved = archetypeForEvent(ev);
    if (!resolved) return;
    const e = this.playerMeshes.get(resolved.id);
    if (!e) return;
    const char = e.group.userData.character;
    if (char && char.triggerCast) char.triggerCast(resolved.archetype);
    else if (e.group.userData.triggerCast) e.group.userData.triggerCast(resolved.archetype);
  }

  _processEvents(events) {
    for (const ev of events) {
      this._triggerCast(ev);
      switch (ev.type) {
        case "hit":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffcc44, { count: 16, speed: 7 }));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.6, this._shake + 0.15);
          break;
        case "boltFizzle":
          // Projectile dispersed against cover — burst at the impact point,
          // tinted to the projectile colour, at the bolt's height (y).
          this._addEffect(this._burstAt(ev.x, ev.z, ev.c || 0xffcc44, { count: 14, speed: 6, life: 0.4 }, ev.y ?? 1.0));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.4, this._shake + 0.08);
          break;
        case "projectileClash":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x9fe6ff, { count: 26, speed: 10, life: 0.45 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 2.2, 0xffffff));
          this.audio?.play("projectileClash", this._panFor(ev.x));
          this._shake = Math.min(0.7, this._shake + 0.2);
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
        case "runePickup":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x7cff5a, { count: 18, speed: 6 }));
          this.audio?.play("cast", this._panFor(ev.x || 0));
          break;
        case "runeDestroyed":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff3a1e, { count: 22, speed: 8, life: 0.6 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 2.5, 0xff3a1e));
          this.audio?.play("hit", this._panFor(ev.x || 0));
          break;
        case "sfx":
          this.audio?.play(ev.sfx, this._panFor(ev.x || 0));
          break;
      }
    }
  }

  _burstAt(x, z, color, opts, y = 1.0) {
    const g = buildBurst(color, opts);
    g.position.set(x, y, z);
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
    this.arena.update(t, dt);

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
          falling: !!e.target.f,
          time: t,
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

      // Rotate stun-star halo and bob each star individually.
      if (e.stunEffect) {
        e.stunEffect.rotation.y += dt * 5;
        for (let si = 0; si < e.stunEffect.children.length; si++) {
          e.stunEffect.children[si].position.y = Math.sin(t * 8 + si * 1.26) * 0.18;
        }
      }
    }

    // Spin bolts for flair.
    for (const m of this.boltMeshes.values()) {
      m.rotation.y += dt * 6;
      m.rotation.x += dt * 4;
    }

    for (const g of this.runeMeshes.values()) {
      g.rotation.y += dt * 1.8;
      if (g.userData.core) g.userData.core.position.y = 0.55 + Math.sin(t * 4) * 0.08;
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

  // Dispose the current map layout meshes and rebuild them from the new layout.
  // Called whenever snapshot.mapV increments (each round start) or becomes -1
  // (lobby / round end, layout = null → just dispose).
  _rebuildMapMeshes(layout, worldId) {
    for (const e of this._mapMeshes) {
      const g = e.g;
      this.scene.remove(g);
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose?.());
        }
      });
    }
    this._mapMeshes = [];
    if (!layout) return;

    // Each entry stores its footprint CENTRE (cx,cz) so we can hide features
    // once the shrinking arena no longer covers them (see _cullMapMeshes).
    // Plateaus and their ramps cull together by the plateau centre.
    for (const pl of layout.plateaus) {
      const pg = buildPlateau(pl, worldId);
      this.scene.add(pg);
      this._mapMeshes.push({ g: pg, cx: pl.x, cz: pl.z });
      for (const ramp of pl.ramps) {
        const rg = buildRamp(ramp, pl.height, worldId);
        this.scene.add(rg);
        this._mapMeshes.push({ g: rg, cx: pl.x, cz: pl.z });
      }
    }

    // Obstacle props (trees, stones, columns, etc.).
    for (const ob of layout.obstacles) {
      const builder = PROP_BUILDERS[ob.type];
      if (!builder) continue;
      const og = builder(ob);
      og.position.set(ob.x, CFG.PLATFORM_TOP, ob.z);
      og.rotation.y = ob.rot;
      this.scene.add(og);
      this._mapMeshes.push({ g: og, cx: ob.x, cz: ob.z });
    }
  }

  // Hide map features whose footprint centre has left the platform as the arena
  // shrinks, so spread-out geometry never floats over the hazard. Matches the
  // sim's query-layer culling (arena-query.js setActiveRadius) for visual parity.
  _cullMapMeshes(radius, worldId) {
    for (const e of this._mapMeshes) {
      e.g.visible = isOnArenaWorld(worldId, radius, e.cx, e.cz);
    }
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
    for (const g of this.runeMeshes.values()) this.scene.remove(g);
    this.runeMeshes.clear();
    for (const g of this.effects) this.scene.remove(g);
    this.effects = [];
    for (const l of this.linkLines.values()) this.scene.remove(l);
    this.linkLines.clear();
    // Clear map layout meshes (plateaus, ramps, obstacle props).
    this._rebuildMapMeshes(null, CFG.DEFAULT_ARENA_WORLD);
    this._mapVersion = -1;
    this.arena.reset();
  }
}
