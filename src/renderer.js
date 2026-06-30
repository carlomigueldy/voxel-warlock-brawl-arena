// Three.js renderer. Consumes simulation snapshots (whether produced locally by
// the host or received from the network) and draws the world. Also owns the
// camera that follows the local warlock.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CFG, SPELLS, isOnArenaWorld } from "./config.js";
import { Arena } from "./arena.js";
import {
  buildWarlock, buildBolt, animateWarlock,
  buildBurst, buildLightning, buildMeteor, buildRune, buildItemDrop,
  buildPlateau, buildRamp,
  buildMobByType, animateMob,
  buildStormClouds,
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
    this.itemMeshes = new Map();   // id -> group (Step 4 lootable items)
    this.mobMeshes = new Map();    // id -> { group, rx, rz, ry, ra, target, spd }
    this.mobChannelDecals = new Map(); // mob id -> THREE.Mesh; persistent telegraph under packet loss
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

  _makeHpBar(y) {
    const w = 1.4, h = 0.16;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x14121f, transparent: true, opacity: 0.8, depthTest: false })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h * 0.7),
      new THREE.MeshBasicMaterial({ color: 0x2ecc71, depthTest: false })
    );
    fill.position.z = 0.001;
    const g = new THREE.Group();
    g.add(bg);
    g.add(fill);
    g.position.y = y;
    g.userData.barWidth = w;
    g.renderOrder = 999;
    return { group: g, fill };
  }

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
      const hpBar = this._makeHpBar(labelY - 0.35);
      group.add(hpBar.group);
      this.scene.add(group);
      entry = {
        group, label, hpBar, color, usingGLB, character,
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

    // rune meshes: reserved / superseded by item system (Step 4) — kept for Step-7 test compat (source.test.mjs:310/334).
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
        const g = this.runeMeshes.get(id);
        g.userData.dispose?.();
        this.scene.remove(g);
        this.runeMeshes.delete(id);
      }
    }

    // Item drops — build-if-absent (uses buildItemDrop for shape/rarity visuals),
    // position from snapshot, prune when picked up or expired.
    const itemSeen = new Set();
    for (const it of snapshot.items || []) {
      itemSeen.add(it.id);
      let g = this.itemMeshes.get(it.id);
      if (!g) {
        g = buildItemDrop(it.shape || "orb", it.c || 0xffffff, { rarity: it.rarity });
        const label = this._makeLabel(it.name || "Item", it.c || 0xffffff, 1.65);
        g.add(label);
        g.userData.label = label;
        this.scene.add(g);
        this.itemMeshes.set(it.id, g);
      }
      g.position.set(it.x, 0.25, it.z);
    }
    for (const id of [...this.itemMeshes.keys()]) {
      if (!itemSeen.has(id)) {
        const g = this.itemMeshes.get(id);
        g.userData.dispose?.();
        this.scene.remove(g);
        this.itemMeshes.delete(id);
      }
    }

    // Mobs — build-if-absent, position from snapshot, prune unseen.
    const mobSeen = new Set();
    for (const mob of snapshot.mobs || []) {
      mobSeen.add(mob.id);
      let e = this.mobMeshes.get(mob.id);
      if (!e) {
        const grp = buildMobByType(mob.type, mob.color || 0xaaaaaa);
        this.scene.add(grp);
        // baseScale captures the builder's own uniform scale (varies per mob type)
        // so the entrance animation can lerp back to it after the window closes.
        e = { group: grp, rx: mob.x, rz: mob.z, ry: mob.y ?? 0, ra: mob.a ?? 0, target: mob, spd: 0, baseScale: grp.scale.x };
        this.mobMeshes.set(mob.id, e);
      }
      e.target = mob;
      // Scale the foreground health bar to reflect remaining HP.
      const hb = e.group.userData.healthBar;
      if (hb && mob.max > 0) hb.scale.x = Math.max(0.001, mob.hp / mob.max);

      // Packet-loss-resilient telegraph: maintain a persistent ground decal from the
      // mob's channel snapshot (mob.ch). This ensures late-joining observers and clients
      // that missed the one-shot mobTelegraph event still see the warning ring for the
      // full cast window. The one-shot event is kept only for its 'whoosh' SFX.
      if (mob.ch) {
        if (!this.mobChannelDecals.has(mob.id)) {
          const decal = this._buildChannelDecal(mob.ch);
          this.mobChannelDecals.set(mob.id, decal);
          this._addEffect(decal);
        } else {
          const decal = this.mobChannelDecals.get(mob.id);
          if (decal.userData.updateChannel) decal.userData.updateChannel(mob.ch);
        }
      } else if (this.mobChannelDecals.has(mob.id)) {
        // Channel over — mark for removal and untrack.
        const decal = this.mobChannelDecals.get(mob.id);
        decal.userData.done = true;
        this.mobChannelDecals.delete(mob.id);
      }
    }
    for (const id of [...this.mobMeshes.keys()]) {
      if (!mobSeen.has(id)) {
        this.scene.remove(this.mobMeshes.get(id).group);
        this.mobMeshes.delete(id);
        // Clean up any lingering channel decal if the mob was removed mid-channel.
        if (this.mobChannelDecals.has(id)) {
          const decal = this.mobChannelDecals.get(id);
          decal.userData.done = true;
          this.mobChannelDecals.delete(id);
        }
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

    // Shadow Veil (invisible): enemies see the caster nearly hidden; local player
    // stays fully opaque so they can see themselves while stealthed.
    if (ps.iv && ps.id !== this.localId) {
      e.group.traverse((o) => { if (o.material && "opacity" in o.material) { o.material.transparent = true; o.material.opacity = 0.1; } });
    } else if (e._wasInvis && !ps.iv) {
      e.group.traverse((o) => { if (o.material && "opacity" in o.material) { o.material.opacity = 1; } });
    }
    e._wasInvis = !!ps.iv;

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
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffcc44, { count: 26, speed: 10 }));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.6, this._shake + 0.22);
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
        case "death": {
          // Large colour-matched burst + ring pulse at the player's last position.
          const deadMesh = this.playerMeshes?.get(ev.id);
          const deadColor = deadMesh?.color ?? 0xffffff;
          const deadX = deadMesh ? deadMesh.position.x : 0;
          const deadZ = deadMesh ? deadMesh.position.z : 0;
          this._addEffect(this._burstAt(deadX, deadZ, deadColor, { count: 32, speed: 12, life: 0.9 }));
          this._addEffect(this._ringPulse(deadX, deadZ, 2.5, deadColor));
          this.audio?.play("death");
          this._shake = Math.min(0.8, this._shake + 0.3);
          break;
        }
        case "cast": {
          const col = { fireball: 0xff5a1e, boomerang: 0xffe14c, homing: 0xc04cff, bouncer: 0x4cff9c, splitter: 0xff4ca8, fireSpray: 0xff7a2e, disable: 0xbbbbbb }[ev.spell] || 0xffffff;
          this._addEffect(this._burstAt(ev.x, ev.z, col, { count: 14, speed: 6, life: 0.35 }));
          break;
        }
        case "lightning":
          for (const s of ev.segs || []) this._addEffect(buildLightning(s.x1, s.z1, s.x2, s.z2, ev.color || 0x9fe6ff));
          // SFX handled by the sfx relay (redundant direct play removed — C7).
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
          this.audio?.play("gravity", this._panFor(ev.x));
          break;
        case "meteorCast": {
          // Timed ground decal: a ring at the target that pulses faster as the meteor falls.
          const fallDur = ev.fall || 1.0;
          const decalR  = ev.radius || 7;
          const decalEff = new THREE.Group();
          let decalElapsed = 0;
          let decalNext = 0;
          decalEff.userData.done = false;
          decalEff.userData.update = (dt) => {
            decalElapsed += dt;
            const k = Math.min(1, decalElapsed / fallDur);
            const interval = 0.35 * (1 - k * 0.6); // pulses accelerate toward impact
            if (decalElapsed >= decalNext) {
              decalNext += interval;
              this._addEffect(this._ringPulse(ev.x, ev.z, decalR * (0.6 + 0.4 * k), 0xff3a1e));
            }
            if (decalElapsed >= fallDur + 0.05) decalEff.userData.done = true;
          };
          this._addEffect(decalEff);
          this.audio?.play("meteor", this._panFor(ev.x));
          break;
        }
        case "meteorImpact":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff3a1e, { count: 40, speed: 12, life: 0.7 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, 0xff3a1e));
          this.audio?.play("meteorImpact", this._panFor(ev.x));
          this._shake = Math.min(1.0, this._shake + 0.8);
          break;
        case "castStart":
          this._addEffect(this._ringPulse(ev.x ?? 0, ev.z ?? 0, 1.5, (SPELLS[ev.spell]?.color ?? 0x88ddff)));
          this.audio?.play("whoosh", this._panFor(ev.x ?? 0));
          break;
        case "castInterrupt":
          this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, 0xff4444, { count: 10, speed: 5, life: 0.35 }));
          this.audio?.play("hit", this._panFor(ev.x || 0));
          this._shake = Math.min(0.4, this._shake + 0.08);
          break;
        case "castFinish":
          this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, 0xffffff, { count: 6, speed: 4, life: 0.25 }));
          this.audio?.play("whoosh", this._panFor(ev.x ?? 0));
          break;
        case "explode":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff6a1e, { count: 40, speed: 12, life: 0.7 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, 0xff6a1e));
          this.audio?.play("meteorImpact", this._panFor(ev.x));
          this._shake = Math.min(1.0, this._shake + 0.6);
          break;
        case "vacuumTick":
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, 0x6c4cff));
          break;
        case "pull":
          this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, 0x8fffc4));
          break;
        case "drag":
          this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, 0x4cff9c));
          break;
        case "push":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xaef0ff, { count: 14, speed: 8, life: 0.4 }));
          break;
        case "target":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x9c2bff, { count: 16, speed: 7, life: 0.45 }));
          break;
        case "heal":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x7cff8a, { count: 6, speed: 3, life: 0.4 }));
          break;
        case "link": {
          // Link tether cast: burst at both ends (caster a and target b).
          const aMesh = this.playerMeshes?.get(ev.a);
          const bMesh = this.playerMeshes?.get(ev.b);
          if (aMesh) this._addEffect(this._burstAt(aMesh.position.x, aMesh.position.z, 0xff66cc, { count: 14, speed: 7, life: 0.45 }));
          if (bMesh) this._addEffect(this._burstAt(bMesh.position.x, bMesh.position.z, 0xff66cc, { count: 14, speed: 7, life: 0.45 }));
          break;
        }
        case "pocketwatch": {
          // Pocket Watch: golden burst at the caster.
          const pwMesh = this.playerMeshes?.get(ev.id);
          const pwX = pwMesh ? pwMesh.position.x : 0;
          const pwZ = pwMesh ? pwMesh.position.z : 0;
          this._addEffect(this._burstAt(pwX, pwZ, 0xffd23c, { count: 20, speed: 8, life: 0.5 }));
          this._addEffect(this._ringPulse(pwX, pwZ, 2.0, 0xffd23c));
          break;
        }
        case "timeshiftReturn":
          this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, 0x88ddff, { count: 10 }));
          this.audio?.play("timeshift", this._panFor(ev.x ?? 0));
          break;
        case "invisible":
        case "speed":
        case "summon":
        case "shield":
        case "windwalk":
        case "rush":
        case "timeshift":
          this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, 0x88ddff, { count: 10 }));
          break;
        case "runePickup":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x7cff5a, { count: 18, speed: 6 }));
          this.audio?.play("cast", this._panFor(ev.x || 0));
          break;
        case "itemPickup":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffd23c, { count: 20, speed: 7, life: 0.5 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 1.8, 0xffd23c));
          this.audio?.play("cast", this._panFor(ev.x || 0));
          break;
        case "runeDestroyed":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff3a1e, { count: 22, speed: 8, life: 0.6 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 2.5, 0xff3a1e));
          this.audio?.play("hit", this._panFor(ev.x || 0));
          break;
        case "statusApplied": {
          const statusCol = { slow: 0x66ccff, burn: 0xff7a2e, curse: 0x9c2bff, stun: 0xffe14c }[ev.status] || 0xffffff;
          this._addEffect(this._ringPulse(ev.x, ev.z, 1.8, statusCol));
          this.audio?.play(ev.status, this._panFor(ev.x));
          break;
        }
        case "dotTick":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff7a2e, { count: 5, speed: 3, life: 0.3 }));
          this.audio?.play("burn", this._panFor(ev.x));
          break;
        case "sfx":
          this.audio?.play(ev.sfx, this._panFor(ev.x || 0));
          break;
        // "mobSpawn" is now emitted ONLY by minions (big mobs emit "mobIncoming"
        // instead). This handler stays for the small burst+ring on minion spawn.
        case "mobSpawn":
          this._addEffect(this._burstAt(ev.x, ev.z, ev.color || 0xaaaaaa, { count: 16, speed: 7, life: 0.6 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 2.0, ev.color || 0xaaaaaa));
          this.audio?.play("whoosh", this._panFor(ev.x));
          break;
        // Big-mob cinematic entrance begins.  ev.entrance is the kind key from
        // CFG.MOB_TYPES[type].entrance.kind.
        case "mobIncoming": {
          switch (ev.entrance) {
            case "shatter": {
              // Stone Giant: rocky debris burst in grey/brown + dust ring.
              this._addEffect(this._burstAt(ev.x, ev.z, 0x888888, { count: 24, speed: 8, life: 0.9 }, 0.3));
              this._addEffect(this._burstAt(ev.x, ev.z, 0x553322, { count: 14, speed: 5, life: 1.1 }, 0.1));
              this._addEffect(this._ringPulse(ev.x, ev.z, 3.5, 0x888888));
              this.audio?.play("hit", this._panFor(ev.x));
              this._shake = Math.min(0.5, this._shake + 0.20);
              break;
            }
            case "storm": {
              // Storming Vortex: hovering storm clouds + two crossing lightning
              // strikes + ground ring with a blue electric accent.
              this._addEffect(buildStormClouds(ev.x, ev.z));
              this._addEffect(buildLightning(ev.x - 2, ev.z - 1, ev.x, ev.z + 0.5, 0x7adfff));
              this._addEffect(buildLightning(ev.x + 2, ev.z - 1, ev.x, ev.z + 0.5, 0x9fe6ff));
              this._addEffect(this._ringPulse(ev.x, ev.z, 3.0, 0x7adfff));
              this.audio?.play("lightning", this._panFor(ev.x));
              this._shake = Math.min(0.4, this._shake + 0.12);
              break;
            }
            case "summon": {
              // Giant Dwarf: repeating expanding ground ring pulses timed to the
              // entrance window, plus an initial debris burst.
              const summonDuration = ev.duration || CFG.MOB_ENTRANCE || 2.5;
              const pulseEff = new THREE.Group();
              let pElapsed = 0;
              let pNext = 0;
              const pInterval = 0.55;
              pulseEff.userData.done = false;
              pulseEff.userData.update = (dt) => {
                pElapsed += dt;
                if (pElapsed >= pNext) {
                  pNext += pInterval;
                  this._addEffect(this._ringPulse(ev.x, ev.z, 4.5, 0xffd23c));
                }
                if (pElapsed >= summonDuration + 0.2) pulseEff.userData.done = true;
              };
              this._addEffect(pulseEff);
              this._addEffect(this._burstAt(ev.x, ev.z, 0xc47a2e, { count: 18, speed: 6, life: 0.8 }, 0.1));
              this.audio?.play("whoosh", this._panFor(ev.x));
              this._shake = Math.min(0.45, this._shake + 0.15);
              break;
            }
            case "meteor": {
              // Fire Elemental: a falling flaming rock that descends toward the
              // spawn point over the full entrance duration, driven by elapsed time.
              const metDuration = ev.duration || CFG.MOB_ENTRANCE || 2.5;
              const metEff = buildMeteor(ev.x, ev.z, metDuration, 4, 0xff5a1e);
              let metElapsed = 0;
              const origMetUpdate = metEff.userData.update;
              metEff.userData.done = false;
              metEff.userData.update = (dt) => {
                metElapsed = Math.min(metElapsed + dt, metDuration);
                origMetUpdate(dt, metDuration - metElapsed);
                if (metElapsed >= metDuration) metEff.userData.done = true;
              };
              this._addEffect(metEff);
              this.audio?.play("meteorImpact", this._panFor(ev.x));
              this._shake = Math.min(0.3, this._shake + 0.10);
              break;
            }
          }
          break;
        }
        // Big-mob entrance window ends: shockwave impact at spawn point.
        case "mobArrive": {
          const arriveKind = CFG.MOB_TYPES?.[ev.mobType]?.entrance?.kind || "";
          const bigImpact  = arriveKind === "meteor" || arriveKind === "summon";
          const arriveColor =
            ev.mobType === "stoneGiant"     ? 0x888888 :
            ev.mobType === "stormingVortex" ? 0x7adfff :
            ev.mobType === "giantDwarf"     ? 0xffd23c :
            ev.mobType === "fireElemental"  ? 0xff5a1e : 0xaaaaaa;
          this._addEffect(this._burstAt(
            ev.x, ev.z, arriveColor,
            { count: bigImpact ? 32 : 20, speed: bigImpact ? 11 : 8, life: 0.7 },
            0.5
          ));
          this._addEffect(this._ringPulse(
            ev.x, ev.z,
            bigImpact ? Math.max(ev.radius || 0, 5) : 3.0,
            arriveColor
          ));
          this._shake = Math.min(1.0, this._shake + (bigImpact ? 0.50 : 0.30));
          this.audio?.play(bigImpact ? "meteorImpact" : "hit", this._panFor(ev.x));
          break;
        }
        case "mobHit":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffaa44, { count: 10, speed: 5 }));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.4, this._shake + 0.07);
          break;
        case "mobTelegraph": {
          // Growing ground-warning ring that persists for the ability's cast-time window,
          // giving players a visual chance to dodge before the ability resolves.
          const telDuration = ev.castTime || 1.0;
          const telColor    = ev.color || 0xff8800;
          const telRadius   = ev.radius || 4;
          const telEff      = new THREE.Group();
          let   telElapsed  = 0;
          telEff.userData.done   = false;
          telEff.userData.update = (dt) => {
            telElapsed += dt;
            const k = Math.min(1, telElapsed / telDuration);
            // Pulse a growing ring each 0.25 s during the windup.
            if (telElapsed % 0.25 < dt) {
              this._addEffect(this._ringPulse(ev.x, ev.z, telRadius * (0.4 + 0.6 * k), telColor));
            }
            if (telElapsed >= telDuration + 0.05) telEff.userData.done = true;
          };
          this._addEffect(telEff);
          this.audio?.play("whoosh", this._panFor(ev.x));
          break;
        }
        case "mobAbility": {
          this._addEffect(this._burstAt(ev.x, ev.z, ev.color || 0xff3a1e, { count: 22, speed: 9, life: 0.65 }, 0.6));
          this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius || 4, ev.color || 0xff3a1e));
          // Dispatch SFX by ability type for better audio feedback.
          const abilitySfx = { seismicStomp: "hit", vacuum: "gravity", fissureSlam: "meteorImpact", magmaEruption: "meteorImpact" }[ev.ability] || "meteorImpact";
          this.audio?.play(abilitySfx, this._panFor(ev.x));
          this._shake = Math.min(0.9, this._shake + 0.32);
          break;
        }
        case "mobDeath":
          this._addEffect(this._burstAt(ev.x, ev.z, ev.color || 0xaaaaaa, { count: 30, speed: 9, life: 0.8 }, 1.0));
          this._addEffect(this._ringPulse(ev.x, ev.z, 3.0, ev.color || 0xffffff));
          this.audio?.play("death", this._panFor(ev.x));
          this._shake = Math.min(0.8, this._shake + 0.28);
          break;
      }
    }
  }

  _burstAt(x, z, color, opts, y = 1.0) {
    const g = buildBurst(color, opts);
    g.position.set(x, y, z);
    return g;
  }

  // Build a persistent ground-ring decal for a mob's active channel (ch snapshot field).
  // Unlike the one-shot mobTelegraph event (used only for the 'whoosh' SFX), this decal
  // is maintained every snapshot tick — it is safe under packet loss and correct for
  // spectators / late-joining clients who miss the original event.
  _buildChannelDecal(ch) {
    const color = 0xff8800;
    const r = ch.r || 4;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.25, r + 0.25, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(ch.x, 0.12, ch.z);
    ring.userData.done = false;
    // Dispose GPU resources when this effect is culled from the effects array
    // (or removed via the mobChannelDecals removal paths).  Without this each
    // channel decal leaks a RingGeometry + MeshBasicMaterial on the GPU.
    ring.userData.dispose = () => {
      ring.geometry.dispose();
      ring.material.dispose();
    };
    // Called each snapshot tick with the latest ch object to sync position, radius,
    // and opacity.  Pulsing is driven by remaining cast time (ch.t).
    ring.userData.updateChannel = (newCh) => {
      const nr = newCh.r || 4;
      // Rebuild geometry only if radius changed (rare — but safe to do).
      if (Math.abs(nr - r) > 0.01) {
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(nr - 0.25, nr + 0.25, 48);
      }
      ring.position.set(newCh.x, 0.12, newCh.z);
      // Flash faster as the cast window closes.
      ring.material.opacity = 0.35 + 0.4 * Math.abs(Math.sin(newCh.t * 6));
    };
    return ring;
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

      if (e.hpBar) {
        const frac = e.target.mhp ? Math.max(0, Math.min(1, (e.target.hp ?? e.target.mhp) / e.target.mhp)) : 1;
        const w = e.hpBar.group.userData.barWidth;
        e.hpBar.fill.scale.x = frac;
        e.hpBar.fill.position.x = -w * (1 - frac) / 2; // anchor-left shrink
        e.hpBar.fill.material.color.setRGB(frac > 0.5 ? (1 - frac) * 2 : 1, frac > 0.5 ? 1 : frac * 2, 0.18);
        e.hpBar.group.quaternion.copy(this.camera.quaternion); // billboard
      }

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
          channel: e.target.ca ? 1 : 0,
        });
      } else {
        animateWarlock(e.group, {
          speed: e.spd,
          maxSpeed: CFG.MOVE_SPEED,
          charge: c,
          falling: !!e.target.f,
          time: t,
          dt,
          channel: e.target.ca ? 1 : 0,
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

    // Animate item drop meshes — drives the bob/spin via userData.update installed
    // by buildItemDrop's animatePickup callback.
    for (const g of this.itemMeshes.values()) {
      if (g.userData.update) g.userData.update(dt);
    }

    // Interpolate + animate mob meshes.
    for (const [, e] of this.mobMeshes) {
      if (!e.target) continue;
      const prevX = e.rx, prevZ = e.rz;
      e.rx += (e.target.x - e.rx) * lerp;
      e.rz += (e.target.z - e.rz) * lerp;
      e.ry += ((e.target.y ?? 0) - e.ry) * lerp;
      let da = (e.target.a ?? 0) - e.ra;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      e.ra += da * lerp;

      e.group.position.set(e.rx, e.ry, e.rz);
      e.group.rotation.y = -e.ra + Math.PI / 2;

      const inst = Math.hypot(e.rx - prevX, e.rz - prevZ) / dt;
      e.spd = e.spd + (inst - e.spd) * (1 - Math.exp(-8 * dt));

      // Entrance animation: big mobs rise from underground and scale up over
      // CFG.MOB_ENTRANCE seconds. Walk/locomotion is suppressed during this window.
      const ent = e.target.ent ?? 0;
      if (ent > 0) {
        const progress = Math.min(1, Math.max(0, 1 - ent / (CFG.MOB_ENTRANCE ?? 2.5)));
        // Rise 3 world-units from below ground to normal floor level.
        e.group.position.y = e.ry - (1 - progress) * 3.0;
        e.group.scale.setScalar(Math.max(0.05, progress) * (e.baseScale || 1));
        // No animateMob — mob is locked in its spawn pose during the cinematic.
      } else {
        // Restore full scale (needed in the first frame after entrance ends).
        e.group.scale.setScalar(e.baseScale || 1);
        animateMob(e.group, {
          type:     e.target.type,
          speed:    e.spd,
          maxSpeed: 5.0,
          falling:  !!e.target.f,
          dt,
          time:     t,
        });
      }
    }

    // Advance transient VFX and cull finished ones.
    for (const g of this.effects) {
      if (g.userData.update) g.userData.update(dt);
    }
    this.effects = this.effects.filter((g) => {
      if (g.userData.done) { g.userData.dispose?.(); this.scene.remove(g); return false; }
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
    for (const e of this.mobMeshes.values()) this.scene.remove(e.group);
    this.mobMeshes.clear();
    // Channel decals are also managed via this.effects (scene.remove happens there),
    // but clear the lookup map so stale entries don't block new decal creation.
    this.mobChannelDecals.clear();
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
