// Three.js renderer. Consumes simulation snapshots (whether produced locally by
// the host or received from the network) and draws the world. Also owns the
// camera that follows the local warlock.
import * as THREE from "three";
import { CFG, SPELLS, ITEMS, isOnArenaWorld } from "./config.js";
import * as social from "./social.js";
import { Arena } from "./arena.js";
import {
  buildWarlock, animateWarlock,
  buildBurst, buildLightning, buildMeteor, buildRune, buildItemDrop,
  buildPlateau, buildRamp,
  buildMobByType, animateMob,
  buildStormClouds,
} from "./voxel.js";
import { acquireBolt, releaseBolt } from "./pool.js";
import { PROP_BUILDERS } from "./props.js";
import {
  loadCharacterTemplate,
  characterReady,
  buildCharacterInstance,
} from "./character.js";
import {
  MOB_MODEL_ASSETS,
  loadMobModelTemplate,
  mobModelReady,
  buildMobModelInstance,
} from "./mobModel.js";
import { archetypeForEvent, reactionForEvent } from "./animations.js";
import { effectPos } from "./renderer-util.js";
import { VFX_REGISTRY, getVfx } from "./vfx/duotone.js";
import { buildChainBeam } from "./vfx/beams.js";
import { getReticle } from "./vfx/reticles.js";

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
    this.runeMeshes = new Map();   // id -> group
    this.itemMeshes = new Map();   // id -> group (Step 4 lootable items)
    this.mobMeshes = new Map();    // id -> { group, rx, rz, ry, ra, target, spd }
    this.mobChannelDecals = new Map(); // mob id -> THREE.Mesh; persistent telegraph under packet loss
    this.effects = [];             // transient VFX groups with .userData.update
    this.linkLines = new Map();    // "a|b" -> line
    this.localId = null;
    // Per-spell targeting reticle (hold-to-aim / release-to-cast, src/input.js).
    // Persistent — NOT routed through this.effects (that array is for
    // one-shot transient VFX; the reticle lives for the duration of the hold).
    this._reticle = null;
    this._reticleSpellId = null;   // spell id the current _reticle was built for
    this._aimSpellId = null;       // set via setAimSpell(); null = no active aim
    this._cursorX = window.innerWidth / 2;
    this._cursorY = window.innerHeight / 2;
    this.clock = new THREE.Clock();
    this.audio = null;             // set via setAudio()
    this._lastSnapT = -1;          // dedupe events per snapshot
    this._shake = 0;

    // Map layout geometry (plateaus, ramps, obstacles) rebuilt once per round.
    this._mapVersion = -1;   // last snapshot.mapV applied
    this._mapMeshes  = [];   // Groups built from the current layout

    // Smoothed camera target.
    this._camTarget = new THREE.Vector3(0, 0, 0);

    // Social overlays: cached for showChatBubble (called directly by main.js,
    // outside the apply() snapshot loop) and for the reduced-motion gate on
    // the typing/speaking pulse animations (checked once, not per frame).
    this._playerMeta = null;
    this._reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // Preload every selectable character so any player's pick renders as a GLB
    // (falling back to the voxel warlock per-player only if its load fails).
    for (const ch of CFG.CHARACTERS) {
      loadCharacterTemplate(ch.id)
        .then(() => this._upgradePlayersToGLB())
        .catch((err) => console.warn(`Character GLB '${ch.id}' unavailable, using voxel fallback:`, err));
    }

    // Preload the 4 big-mob Meshy GLBs so mobs render as rigged models instead
    // of the procedural fallback. Mobs are built once and cached at spawn, so
    // any built before its template resolves gets upgraded in-place once ready.
    for (const type of Object.keys(MOB_MODEL_ASSETS)) {
      loadMobModelTemplate(type)
        ?.then(() => this._upgradeMobsToGLB())
        .catch((err) => console.warn(`Mob GLB '${type}' unavailable, using voxel fallback:`, err));
    }

    window.addEventListener("resize", () => this._onResize());
  }

  setAudio(audio) { this.audio = audio; }

  _panFor(x) { return Math.max(-1, Math.min(1, x / this.arena.radius)); }

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
    // Hazard glow from below (color is themed per map in _applyHazardTheme).
    const glow = new THREE.PointLight(0xff3a1e, 0.8, 60);
    glow.position.set(0, -6, 0);
    this.scene.add(glow);
    this._hazardGlow = glow;

    // Shared pool of dynamic point lights reused across active bolts, instead
    // of a per-bolt PointLight (expensive: each adds a full shadow-less light
    // to the render loop). Assigned to nearest bolts each frame in update().
    this._boltLightPool = [];
    for (let i = 0; i < CFG.LIGHT_POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6);
      this.scene.add(l);
      this._boltLightPool.push(l);
    }
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

  // Called by src/input.js when the local player begins/ends/switches
  // hold-to-aim on a spell. `id` is a spell id, or null/undefined to hide
  // the reticle (aim released or cancelled).
  setAimSpell(id) { this._aimSpellId = id || null; }

  // Called on every mousemove so _updateReticle() can raycast the current
  // cursor position each frame without re-reading DOM state (mirrors how
  // src/input.js's screenToPoint/screenToAim already consume clientX/clientY).
  setCursor(x, y) { this._cursorX = x; this._cursorY = y; }

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

  // =========================================================================
  // ---- Social overlays: chat bubble, typing dots, AFK badge, speak ring ---
  // =========================================================================

  // Shared rounded-rect canvas path (manual arcTo, matches every card overlay
  // below — avoids relying on the still-inconsistently-supported roundRect()).
  _roundedRectPath(ctx, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
  }

  // Greedy word-wrap capped at maxLines; ellipsizes the final line when text
  // overflows the line budget. ctx must already have its font set.
  _wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    let idx = 0;
    while (idx < words.length && lines.length < maxLines) {
      const word = words[idx];
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= maxWidth) {
        line = test;
        idx++;
      } else {
        lines.push(line);
        line = "";
      }
    }
    if (line && lines.length < maxLines) {
      lines.push(line);
    } else if (idx < words.length && lines.length > 0) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[lines.length - 1] = `${last}…`;
    }
    return lines.length ? lines : [""];
  }

  // Rounded speech-balloon sprite, player-color border, word-wrapped to ≤2
  // lines with an ellipsis on overflow. Reuses the canvas-sprite pattern from
  // _makeLabel above.
  _makeBubble(text, color) {
    const fontPx = 26, padX = 16, padY = 10, lineHeight = 30, maxLines = 2, maxTextWidth = 300;
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    ctx.font = `600 ${fontPx}px "Chakra Petch", sans-serif`;
    const lines = this._wrapText(ctx, text, maxTextWidth, maxLines);
    const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), 40);
    const w = Math.min(340, Math.ceil(textWidth) + padX * 2);
    const h = lines.length * lineHeight + padY * 2;
    cv.width = w;
    cv.height = h;
    // Resizing the canvas resets its 2D state, so font/align must be reapplied.
    ctx.font = `600 ${fontPx}px "Chakra Petch", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    this._roundedRectPath(ctx, w, h, 14);
    ctx.fillStyle = "rgba(13,11,26,0.88)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#" + new THREE.Color(color).getHexString();
    ctx.stroke();

    ctx.fillStyle = "#ece9ff";
    lines.forEach((l, i) => ctx.fillText(l, w / 2, padY + lineHeight * (i + 0.5)));

    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(w / 85, h / 85, 1);
    spr.renderOrder = 998;
    return spr;
  }

  // Spawns/refreshes a world-space chat bubble above a player's head. Called
  // directly by main.js on receipt of a CHAT relay (chat text is event-relayed,
  // never part of the snapshot). Skips entirely for locally-muted senders.
  showChatBubble(id, text, color) {
    const e = this.playerMeshes.get(id);
    if (!e) return;
    const meta = this._playerMeta?.get(id);
    if (social.isMuted(id, meta?.userId || null)) return;
    if (e.chatBubble) {
      e.group.remove(e.chatBubble);
      e.chatBubble.material?.dispose?.();
    }
    const spr = this._makeBubble(text, color);
    spr.position.y = (e.label?.position.y ?? 3.4) + 0.9;
    e.group.add(spr);
    e.chatBubble = spr;
    e._bubbleExpiry = performance.now() + CFG.SOCIAL.CHAT_BUBBLE_TTL_MS;
  }

  // Small pulsing "···" balloon shown above a player's head while typing.
  _makeDotsSprite() {
    const cv = document.createElement("canvas");
    cv.width = 96;
    cv.height = 48;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    this._roundedRectPath(ctx, w, h, 14);
    ctx.fillStyle = "rgba(13,11,26,0.85)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(124,108,196,0.6)";
    ctx.stroke();
    ctx.fillStyle = "#ece9ff";
    ctx.font = `700 30px "Chakra Petch", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("···", w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(w / 85, h / 85, 1);
    spr.renderOrder = 998;
    spr.userData.pulseSeed = Math.random() * Math.PI * 2;
    return spr;
  }

  // Adds/removes the animated typing indicator above a player's head.
  _setTyping(e, on) {
    if (on && !e.typingBubble) {
      const spr = this._makeDotsSprite();
      spr.position.y = (e.label?.position.y ?? 3.4) + 0.55;
      e.group.add(spr);
      e.typingBubble = spr;
    } else if (!on && e.typingBubble) {
      e.group.remove(e.typingBubble);
      e.typingBubble.material?.dispose?.();
      e.typingBubble = null;
    }
  }

  // "AFK 💤" badge shown above a player's head while marked away.
  _makeAfkBadge() {
    const cv = document.createElement("canvas");
    cv.width = 168;
    cv.height = 48;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    this._roundedRectPath(ctx, w, h, 12);
    ctx.fillStyle = "rgba(20,16,10,0.85)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffd23c";
    ctx.stroke();
    ctx.fillStyle = "#ffd23c";
    ctx.font = `700 24px "Chakra Petch", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AFK 💤", w / 2, h / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(w / 85, h / 85, 1);
    spr.renderOrder = 998;
    return spr;
  }

  // Desaturates (or restores) every material on a player's model to sell the
  // "away" state at a glance. Runs once per state transition, not per frame.
  // Only walks the character-model subtree — the label sprite, HP-bar
  // billboard, and social overlay sprites (chat bubble/typing dots/AFK badge/
  // speak ring) are direct children of e.group too, but must stay full-color
  // and are excluded here.
  _applyAfkDim(e, on) {
    const hsl = { h: 0, s: 0, l: 0 };
    const excluded = new Set(
      [e.label, e.hpBar?.group, e.chatBubble, e.typingBubble, e.afkBadge, e.speakRing].filter(Boolean)
    );
    for (const child of e.group.children) {
      if (excluded.has(child)) continue;
      child.traverse((o) => {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m.color) continue;
          if (on) {
            if (!m.userData._afkOrigColor) m.userData._afkOrigColor = m.color.clone();
            m.userData._afkOrigColor.getHSL(hsl);
            m.color.setHSL(hsl.h, hsl.s * 0.25, hsl.l * 0.7);
          } else if (m.userData._afkOrigColor) {
            m.color.copy(m.userData._afkOrigColor);
          }
        }
      });
    }
  }

  // Adds/removes the AFK badge + model desaturation. Never mute-gated (this
  // reflects the player's own state, not something a viewer can silence).
  _setAfk(e, on) {
    if (on && !e.afkBadge) {
      const spr = this._makeAfkBadge();
      spr.position.y = (e.label?.position.y ?? 3.4) + 0.55;
      e.group.add(spr);
      e.afkBadge = spr;
      this._applyAfkDim(e, true);
    } else if (!on && e.afkBadge) {
      e.group.remove(e.afkBadge);
      e.afkBadge.material?.dispose?.();
      e.afkBadge = null;
      this._applyAfkDim(e, false);
    }
  }

  // Adds/removes a glowing ring around a speaking player's feet.
  _setSpeaking(e, on) {
    if (on && !e.speakRing) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 0.95, 32),
        new THREE.MeshBasicMaterial({ color: 0x7cff5a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.userData.pulseSeed = Math.random() * Math.PI * 2;
      e.group.add(ring);
      e.speakRing = ring;
    } else if (!on && e.speakRing) {
      e.group.remove(e.speakRing);
      e.speakRing.geometry?.dispose?.();
      e.speakRing.material?.dispose?.();
      e.speakRing = null;
    }
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

  // Swap any procedural-fallback mob to its Meshy GLB body once the template
  // has loaded (mirrors _upgradePlayersToGLB). Preserves world transform and
  // the health-bar reference so per-frame HP scaling keeps working.
  _upgradeMobsToGLB() {
    for (const e of this.mobMeshes.values()) {
      if (e.usingGLB) continue;
      if (!e.target || !MOB_MODEL_ASSETS[e.target.type]) continue;
      if (!mobModelReady(e.target.type)) continue;
      const next = buildMobModelInstance(e.target.type, e.target.color || 0xaaaaaa);
      if (!next) continue;
      next.position.copy(e.group.position);
      next.rotation.copy(e.group.rotation);
      this.scene.remove(e.group);
      e.group.userData.dispose?.();
      this._disposeGroup(e.group);
      this.scene.add(next);
      e.group = next;
      e.baseScale = next.scale.x;
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

  // Removes + disposes the four social overlay sprites/mesh (chat bubble,
  // typing dots, AFK badge, speak ring) from a player entry, if present.
  // The group-wide _disposeGroup traversal in removePlayer would also catch
  // these (they're all group children), but this keeps teardown explicit and
  // safe to call independently (e.g. before rebuilding a bubble).
  _disposeSocialOverlays(e) {
    for (const key of ["chatBubble", "typingBubble", "afkBadge", "speakRing"]) {
      const obj = e[key];
      if (!obj) continue;
      e.group.remove(obj);
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
      e[key] = null;
    }
  }

  removePlayer(id) {
    const e = this.playerMeshes.get(id);
    if (e) {
      this._disposeSocialOverlays(e);
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
    // Cached so showChatBubble() (called directly by main.js on a chat event,
    // outside this per-frame pass) can resolve userId for the mute check.
    this._playerMeta = playerMeta;
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

    // Status auras on warlocks (wind walk fade, shield bubble, etc.), plus the
    // social presence overlays (typing/AFK/speaking). ty/afk/spk are
    // non-authoritative flags that ride the STATE snapshot (see player.js);
    // typing and speaking are suppressed per-viewer for locally-muted remotes
    // (AFK is the player's own state, so it is never mute-gated).
    for (const ps of snapshot.players) {
      const e = this.playerMeshes.get(ps.id);
      if (!e) continue;
      this._applyStatusVisuals(e, ps);
      const meta = playerMeta?.get(ps.id);
      const muted = social.isMuted(ps.id, meta?.userId || null);
      this._setTyping(e, !!ps.ty && !muted);
      this._setAfk(e, !!ps.afk);
      this._setSpeaking(e, !!ps.spk && !muted);
    }

    // Bolts (every projectile kind shares the renderer path).
    const boltSeen = new Set();
    for (const b of snapshot.bolts || []) {
      boltSeen.add(b.id);
      let m = this.boltMeshes.get(b.id);
      if (!m) {
        m = acquireBolt(b.c, b.k || "fireball");
        this.scene.add(m);
        this.boltMeshes.set(b.id, m);
      }
      m.position.set(b.x, b.y ?? (CFG.PLATFORM_TOP + 1.1), b.z);
    }
    for (const id of [...this.boltMeshes.keys()]) {
      if (!boltSeen.has(id)) {
        releaseBolt(this.boltMeshes.get(id));
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
        const mg = this.meteorMeshes.get(id);
        mg.userData.dispose?.();
        this.scene.remove(mg);
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
        e = { group: grp, rx: mob.x, rz: mob.z, ry: mob.y ?? 0, ra: mob.a ?? 0, target: mob, spd: 0, baseScale: grp.scale.x, usingGLB: !!grp.userData.mobModel };
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
        const eg = this.mobMeshes.get(id).group;
        eg.userData.dispose?.();
        this.scene.remove(eg);
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

  // Fire a GLB-backed big mob's bespoke attack clip on a melee/ranged hit
  // event (ev.by is the striking mob's id). No-ops for procedural mobs
  // (userData.mobModel is only set by mobModel.js's buildMobModelInstance).
  _triggerMobAttackModel(mobId) {
    const e = this.mobMeshes.get(mobId);
    const mobModel = e && e.group.userData.mobModel;
    if (mobModel) mobModel.triggerAttack();
  }

  // Ability casts don't carry a mob id (src/sim.js's "mobAbility" event only
  // has mobType/x/z), so find the nearest live mob of that type instead.
  _triggerMobAttackModelNear(mobType, x, z) {
    let best = null, bestD = Infinity;
    for (const e of this.mobMeshes.values()) {
      if (!e.target || e.target.type !== mobType) continue;
      const d = Math.hypot(e.rx - x, e.rz - z);
      if (d < bestD) { bestD = d; best = e; }
    }
    const mobModel = best && best.group.userData.mobModel;
    if (mobModel) mobModel.triggerAttack();
  }

  // Drive a victim's hit-reaction flinch from a "hit" sim event. Separate from
  // _triggerCast because a hit reaction is keyed by ev.victim (who got hit),
  // not ev.id/ev.a (who cast the ability) — see reactionForEvent's doc comment.
  _triggerReaction(ev) {
    const resolved = reactionForEvent(ev);
    if (!resolved) return;
    const e = this.playerMeshes.get(resolved.id);
    if (!e) return;
    const char = e.group.userData.character;
    if (char && char.triggerReaction) char.triggerReaction(resolved.reaction);
  }

  _processEvents(events) {
    for (const ev of events) {
      this._triggerCast(ev);
      this._triggerReaction(ev);
      switch (ev.type) {
        case "hit":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffcc44, { count: 26, speed: 10 }));
          this.audio?.play("hit", this._panFor(ev.x));
          this._shake = Math.min(0.6, this._shake + 0.22);
          this._triggerMobAttackModel(ev.by);
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
          // effectPos() reads through .group.position (the scene node), not the
          // raw entry itself, and gracefully falls back when the entry is absent.
          const deadMesh = this.playerMeshes?.get(ev.id);
          const { x: deadX, z: deadZ, color: deadColor } = effectPos(deadMesh);
          this._addEffect(this._burstAt(deadX, deadZ, deadColor, { count: 32, speed: 12, life: 0.9 }));
          this._addEffect(this._ringPulse(deadX, deadZ, 2.5, deadColor));
          this.audio?.play("death");
          this._shake = Math.min(0.8, this._shake + 0.3);
          break;
        }
        case "cast": {
          // Call the registry's bespoke cast() when VFX_REGISTRY has an entry
          // for this spell (getVfx()'s color already covers spells with no
          // bespoke entry yet, e.g. "projectile"); some entries deliberately
          // opt out of an extra cast burst (`cast: () => null` — fireball/
          // boomerang/homing/bouncer/splitter, whose rich duotone bolt core
          // is now the cast tell) so only the true no-entry case falls back
          // to the old generic burst.
          const vfx = getVfx(ev.spell);
          const entry = VFX_REGISTRY[ev.spell];
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color, y: ev.y }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 14, speed: 6, life: 0.35 }));
          }
          break;
        }
        case "lightning": {
          // Initial zap flare at the caster (first segment's origin), then
          // the jagged duotone chain-arc look for every hop — see
          // src/vfx/beams.js's buildChainBeam doc for why the chain-hop
          // visual is exported standalone rather than registry-keyed under
          // "lightning" (that key is PROJECTILE_VFX's traveling-bolt entry).
          const vfx = getVfx("lightning");
          const color = ev.color || vfx.color;
          const segs = ev.segs || [];
          const entry = VFX_REGISTRY.lightning;
          if (entry && segs.length) {
            const eff = entry.cast(this._vfxCtx(segs[0].x1, segs[0].z1, { color }));
            if (eff) this._addEffect(eff);
          }
          for (const s of segs) this._addEffect(buildChainBeam(s.x1, s.z1, s.x2, s.z2, color));
          // SFX handled by the sfx relay (redundant direct play removed — C7).
          break;
        }
        case "teleport": {
          // teleport and blink share this event (the sim doesn't distinguish
          // them here), so both always render as the "teleport" duotone —
          // matches the previous identical-burst-for-both behavior.
          const vfx = getVfx("teleport");
          const entry = VFX_REGISTRY.teleport;
          if (entry) {
            const departEff = entry.cast(this._vfxCtx(ev.x1, ev.z1, { color: vfx.color }));
            if (departEff) this._addEffect(departEff);
            const arriveEff = entry.impact(this._vfxCtx(ev.x2, ev.z2, { color: vfx.color }));
            if (arriveEff) this._addEffect(arriveEff);
          } else {
            this._addEffect(this._burstAt(ev.x1, ev.z1, vfx.color, { count: 14 }));
            this._addEffect(this._burstAt(ev.x2, ev.z2, vfx.color, { count: 14 }));
          }
          break;
        }
        case "thrust": {
          const vfx = getVfx("thrust");
          const entry = VFX_REGISTRY.thrust;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 8, speed: 5 }));
          }
          break;
        }
        case "swap": {
          const vfx = getVfx("swap");
          const entry = VFX_REGISTRY.swap;
          if (entry) {
            const effA = entry.cast(this._vfxCtx(ev.ax, ev.az, { color: vfx.color }));
            if (effA) this._addEffect(effA);
            const effB = entry.impact(this._vfxCtx(ev.bx, ev.bz, { color: vfx.color }));
            if (effB) this._addEffect(effB);
          } else {
            this._addEffect(this._burstAt(ev.ax, ev.az, vfx.color, { count: 12 }));
            this._addEffect(this._burstAt(ev.bx, ev.bz, vfx.color, { count: 12 }));
          }
          break;
        }
        case "drain": {
          const vfx = getVfx("drain");
          const entry = VFX_REGISTRY.drain;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
          }
          break;
        }
        case "gravity": {
          const vfx = getVfx("gravity");
          const entry = VFX_REGISTRY.gravity;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, vfx.color));
          }
          this.audio?.play("gravity", this._panFor(ev.x));
          break;
        }
        case "meteorCast": {
          // Timed ground decal: a ring at the target that pulses faster as the meteor falls.
          const vfx = getVfx("meteor");
          const entry = VFX_REGISTRY.meteor;
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
              this._addEffect(this._ringPulse(ev.x, ev.z, decalR * (0.6 + 0.4 * k), vfx.color));
            }
            if (decalElapsed >= fallDur + 0.05) decalEff.userData.done = true;
          };
          this._addEffect(decalEff);
          // Bespoke ignition-spark accent alongside the synced fall telegraph above.
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          }
          this.audio?.play("meteor", this._panFor(ev.x));
          break;
        }
        case "meteorImpact": {
          const vfx = getVfx("meteor");
          const entry = VFX_REGISTRY.meteor;
          if (entry) {
            const eff = entry.impact(this._vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 40, speed: 12, life: 0.7 }));
            this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, vfx.color));
          }
          this.audio?.play("meteorImpact", this._panFor(ev.x));
          this._shake = Math.min(1.0, this._shake + 0.8);
          break;
        }
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
        case "explode": {
          const vfx = getVfx("explode");
          const entry = VFX_REGISTRY.explode;
          if (entry) {
            const eff = entry.impact(this._vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 40, speed: 12, life: 0.7 }));
            this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, vfx.color));
          }
          this.audio?.play("meteorImpact", this._panFor(ev.x));
          this._shake = Math.min(1.0, this._shake + 0.6);
          break;
        }
        case "vacuumTick": {
          const vfx = getVfx("vacuum");
          const entry = VFX_REGISTRY.vacuum;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._ringPulse(ev.x, ev.z, ev.radius, vfx.color));
          }
          break;
        }
        case "pull": {
          const vfx = getVfx("pull");
          const entry = VFX_REGISTRY.pull;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
          }
          break;
        }
        case "drag": {
          const vfx = getVfx("drag");
          const entry = VFX_REGISTRY.drag;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
          }
          break;
        }
        case "push": {
          const vfx = getVfx("push");
          const entry = VFX_REGISTRY.push;
          if (entry) {
            const eff = entry.impact(this._vfxCtx(ev.x, ev.z, { color: vfx.color, angle: ev.dir }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 14, speed: 8, life: 0.4 }));
          }
          break;
        }
        case "target": {
          // Doom has no separate windup/telegraph event — the single
          // "target" event covers both the cast and the hit in one packet
          // — so fire the registry's cast() (the crosshair-reticle collapse,
          // the spell's signature icon echo) alongside impact() rather than
          // impact() alone; both simply ctx.addEffect() internally and
          // return null, so there is nothing to double-add here.
          const vfx = getVfx("target");
          const entry = VFX_REGISTRY.target;
          if (entry) {
            const ctx = this._vfxCtx(ev.x, ev.z, { color: vfx.color });
            entry.cast(ctx);
            const eff = entry.impact(ctx);
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 16, speed: 7, life: 0.45 }));
          }
          break;
        }
        case "heal": {
          const vfx = getVfx("heal");
          const entry = VFX_REGISTRY.heal;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(ev.x, ev.z, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x, ev.z, vfx.color, { count: 6, speed: 3, life: 0.4 }));
          }
          break;
        }
        case "link": {
          // Link tether cast: the registry's steady beam spans both ends
          // (caster a, target b) for the tether's actual duration; falls
          // back to the old twin-burst look when no live mesh exists yet.
          const vfx = getVfx("link");
          const entry = VFX_REGISTRY.link;
          const aMesh = this.playerMeshes?.get(ev.a);
          const bMesh = this.playerMeshes?.get(ev.b);
          if (entry && aMesh && bMesh) {
            const eff = entry.cast(this._vfxCtx(aMesh.group.position.x, aMesh.group.position.z, {
              color: vfx.color,
              x2: bMesh.group.position.x, z2: bMesh.group.position.z,
              duration: SPELLS.link?.duration,
            }));
            if (eff) this._addEffect(eff);
          } else {
            if (aMesh) this._addEffect(this._burstAt(aMesh.group.position.x, aMesh.group.position.z, vfx.color, { count: 14, speed: 7, life: 0.45 }));
            if (bMesh) this._addEffect(this._burstAt(bMesh.group.position.x, bMesh.group.position.z, vfx.color, { count: 14, speed: 7, life: 0.45 }));
          }
          break;
        }
        case "pocketwatch": {
          // Pocket Watch: golden clock-sweep at the caster.
          const vfx = getVfx("pocketWatch");
          const entry = VFX_REGISTRY.pocketWatch;
          const pwMesh = this.playerMeshes?.get(ev.id);
          const pwX = pwMesh ? pwMesh.group.position.x : 0;
          const pwZ = pwMesh ? pwMesh.group.position.z : 0;
          if (entry) {
            const eff = entry.cast(this._vfxCtx(pwX, pwZ, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(pwX, pwZ, vfx.color, { count: 20, speed: 8, life: 0.5 }));
            this._addEffect(this._ringPulse(pwX, pwZ, 2.0, vfx.color));
          }
          break;
        }
        case "timeshiftReturn": {
          const vfx = getVfx("timeShift");
          const entry = VFX_REGISTRY.timeShift;
          if (entry) {
            const eff = entry.impact(this._vfxCtx(ev.x ?? 0, ev.z ?? 0, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(ev.x ?? 0, ev.z ?? 0, vfx.color, { count: 10 }));
          }
          this.audio?.play("timeshift", this._panFor(ev.x ?? 0));
          break;
        }
        case "invisible":
        case "speed":
        case "summon":
        case "shield":
        case "windwalk":
        case "rush":
        case "timeshift": {
          // Casing note: a few event `type`s don't match their SPELLS/
          // VFX_REGISTRY key casing (windwalk -> windWalk, timeshift ->
          // timeShift) — map explicitly rather than assuming a shared name.
          const spellId = { windwalk: "windWalk", timeshift: "timeShift" }[ev.type] || ev.type;
          const vfx = getVfx(spellId);
          const entry = VFX_REGISTRY[spellId];
          const pos = this._posForId(ev.id, ev.x, ev.z);
          if (entry) {
            const eff = entry.cast(this._vfxCtx(pos.x, pos.z, { color: vfx.color }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._burstAt(pos.x, pos.z, vfx.color, { count: 10 }));
          }
          break;
        }
        case "runePickup":
          this._addEffect(this._burstAt(ev.x, ev.z, 0x7cff5a, { count: 18, speed: 6 }));
          this.audio?.play("cast", this._panFor(ev.x || 0));
          break;
        case "itemPickup": {
          this._addEffect(this._burstAt(ev.x, ev.z, 0xffd23c, { count: 20, speed: 7, life: 0.5 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 1.8, 0xffd23c));
          const rarity = ITEMS[ev.itemKey]?.rarity;
          if (rarity === "common") this.audio?.play("pickupCommon", this._panFor(ev.x || 0));
          else if (rarity === "rare") this.audio?.play("pickupRare", this._panFor(ev.x || 0));
          else this.audio?.play("cast", this._panFor(ev.x || 0));
          break;
        }
        case "jump":
          this.audio?.play("jump", this._panFor(ev.x || 0));
          break;
        case "land":
          this.audio?.play(ev.hard ? "landHard" : "landSoft", this._panFor(ev.x || 0));
          break;
        case "footstep":
          this.audio?.play("footstepStone", this._panFor(ev.x || 0));
          break;
        case "lowHealth":
          this.audio?.play("lowHealth", this._panFor(ev.x || 0));
          break;
        case "shieldBlock":
          this.audio?.play("shieldBlock", this._panFor(ev.x || 0));
          break;
        case "runeDestroyed":
          this._addEffect(this._burstAt(ev.x, ev.z, 0xff3a1e, { count: 22, speed: 8, life: 0.6 }));
          this._addEffect(this._ringPulse(ev.x, ev.z, 2.5, 0xff3a1e));
          this.audio?.play("hit", this._panFor(ev.x || 0));
          break;
        case "statusApplied": {
          const statusCol = { slow: 0x66ccff, burn: 0xff7a2e, curse: 0x9c2bff, stun: 0xffe14c }[ev.status] || 0xffffff;
          if (ev.status === "stun" && VFX_REGISTRY.stun) {
            // Hex Bash (and any mob ability applying the same "stun" status)
            // emits no dedicated cast/hit event of its own — this
            // statusApplied packet is the only signal — so route it through
            // the registry's converging zigzag echo of stun's icon instead
            // of a generic ring; it is otherwise dead code (see review
            // finding).
            const eff = VFX_REGISTRY.stun.impact(this._vfxCtx(ev.x, ev.z, { color: statusCol }));
            if (eff) this._addEffect(eff);
          } else {
            this._addEffect(this._ringPulse(ev.x, ev.z, 1.8, statusCol));
          }
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
          this._triggerMobAttackModelNear(ev.mobType, ev.x, ev.z);
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

  // Build the ctx object src/vfx/*.js's registry cast(ctx)/impact(ctx)
  // builders expect (see src/vfx/duotone.js's VFX_REGISTRY doc comment):
  // { x, z, addEffect, ringPulse, burstAt } plus whatever spell-specific
  // fields the caller supplies (`color`, `y`, `x2`/`z2` for two-endpoint
  // beams, `radius`, `angle`, `spread`, `duration`, ...). Undefined optional
  // fields are harmless — every registry builder reads them via `ctx.field
  // ?? default`.
  _vfxCtx(x, z, extra = {}) {
    return {
      x, z,
      addEffect: (e) => this._addEffect(e),
      ringPulse: this._ringPulse.bind(this),
      burstAt: this._burstAt.bind(this),
      ...extra,
    };
  }

  // Resolve a world position for a spell event that only carries a caster
  // id (buff casts like shield/rush/windwalk don't emit x/z) — prefers the
  // event's own x/z when present, otherwise looks up the caster's current
  // mesh position, otherwise falls back to the origin (matches the previous
  // hardcoded `ev.x ?? 0, ev.z ?? 0` behavior for ids with no live mesh).
  _posForId(id, x, z) {
    if (x !== undefined && z !== undefined) return { x, z };
    const mesh = this.playerMeshes?.get(id);
    return mesh ? { x: mesh.group.position.x, z: mesh.group.position.z } : { x: 0, z: 0 };
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

      // Social overlays: billboard the chat/typing/AFK sprites, expire the
      // chat bubble past its TTL, and advance the speak-ring pulse.
      if (e.chatBubble) {
        e.chatBubble.quaternion.copy(this.camera.quaternion);
        if (performance.now() > (e._bubbleExpiry || 0)) {
          e.group.remove(e.chatBubble);
          e.chatBubble.material?.dispose?.();
          e.chatBubble = null;
        }
      }
      if (e.typingBubble) {
        e.typingBubble.quaternion.copy(this.camera.quaternion);
        if (!this._reducedMotion) {
          e.typingBubble.material.opacity = 0.55 + 0.45 * Math.sin(t * 5 + (e.typingBubble.userData.pulseSeed || 0));
        }
      }
      if (e.afkBadge) {
        e.afkBadge.quaternion.copy(this.camera.quaternion);
      }
      if (e.speakRing) {
        if (this._reducedMotion) {
          e.speakRing.scale.setScalar(1);
          e.speakRing.material.opacity = 0.8;
        } else {
          const k = 0.5 + 0.5 * Math.sin(t * 6 + (e.speakRing.userData.pulseSeed || 0));
          e.speakRing.scale.setScalar(1 + k * 0.15);
          e.speakRing.material.opacity = 0.5 + k * 0.35;
        }
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
          alive: e.target.al !== false,
          stunned: (e.target.st || 0) > 0,
          // Remote players only expose interpolated position, not real velocity,
          // so approximate "being flung" as speed exceeding the normal movement
          // cap — normal locomotion is clamped to maxSpeed, a knockback isn't.
          knockSpeed: Math.max(0, e.spd - CFG.MOVE_SPEED),
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

    // Spin bolts for flair, and drive any registry-routed core's own
    // userData.update(dt) (e.g. a pooled TrailPool trail emitter attached by
    // src/vfx/projectiles.js's _withTrail, or homing's spinning reticle ring)
    // — legacy (non-registry) bolt Groups have no userData.update, so this
    // is a no-op for them.
    for (const m of this.boltMeshes.values()) {
      m.rotation.y += dt * 6;
      m.rotation.x += dt * 4;
      m.userData.update?.(dt);
    }

    // Assign the shared pool of dynamic point lights to the bolts nearest the
    // local player (fixed light count instead of one PointLight per bolt).
    {
      const localE = this.playerMeshes.get(this.localId);
      const origin = localE ? localE.group.position : this.camera.position;
      const active = [...this.boltMeshes.values()];
      active.sort((a, b) => a.position.distanceToSquared(origin) - b.position.distanceToSquared(origin));
      const pool = this._boltLightPool;
      for (let i = 0; i < pool.length; i++) {
        const light = pool[i];
        const bolt = active[i];
        if (bolt) {
          light.position.copy(bolt.position);
          // Registry-routed cores (src/vfx/duotone.js's facetedDuo) expose
          // userData.primary instead of userData.core — fall back to it.
          const core = bolt.userData.core || bolt.userData.primary;
          if (core && core.material && core.material.color) light.color.copy(core.material.color);
          light.intensity = 1.2;
        } else {
          light.intensity = 0;
        }
      }
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
        // No animateMob/mobModel update — mob is locked in its spawn pose
        // during the cinematic (procedural rig or GLB mixer alike).
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
        const mobModel = e.group.userData.mobModel;
        if (mobModel) {
          mobModel.update({ dt, speed: e.spd, maxSpeed: 5.0, falling: !!e.target.f });
        }
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
    this._updateReticle(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Position/hide the local player's hold-to-aim targeting reticle
  // (src/vfx/reticles.js). Rebuilds the reticle Group only when the aimed
  // spell changes (rare — a keypress, not a per-frame event); every other
  // frame just repositions/recolors the existing instance in place, so
  // holding a spell key costs no extra allocation beyond one raycast.
  _updateReticle(dt) {
    if (!this._aimSpellId) {
      if (this._reticle) this._reticle.visible = false;
      return;
    }
    const me = this.playerMeshes.get(this.localId);
    if (!me) {
      if (this._reticle) this._reticle.visible = false;
      return;
    }
    const entry = getReticle(this._aimSpellId);
    if (!this._reticle || this._reticleSpellId !== this._aimSpellId) {
      if (this._reticle) {
        this._reticle.userData.dispose?.();
        this.scene.remove(this._reticle);
      }
      this._reticle = entry.build(SPELLS[this._aimSpellId]?.color);
      this._reticleSpellId = this._aimSpellId;
      this.scene.add(this._reticle);
    }
    // SELF_BUFF reticles start hidden by design (src/vfx/reticles.js's
    // buildSelfBuff) since self-casts never enter the aim flow — don't force
    // them visible here, or selecting a self-buff spell would show a faint
    // ring around the player, contradicting that invariant.
    if (entry.archetype !== "SELF_BUFF") this._reticle.visible = true;

    const point = this.screenToPoint(this._cursorX, this._cursorY);

    // Best-effort nearest-enemy lookup for the target-lock/tether
    // archetypes so the reticle previews which foe would actually be
    // affected. Purely visual — no line-of-sight or cone check (those live
    // server-side in src/spells.js's nearestEnemy()/aimedEnemy()) — so this
    // is an approximation, never authoritative over the actual cast.
    let target = null;
    if (entry.archetype === "NEAREST_TARGET_LOCK" || entry.archetype === "TETHER_LOCK") {
      const range = SPELLS[this._aimSpellId]?.range ?? Infinity;
      let bestD = range * range;
      for (const [id, e] of this.playerMeshes) {
        if (id === this.localId || !e.target || e.target.al === false || e.target.f) continue;
        const dx = e.rx - me.rx, dz = e.rz - me.rz;
        const d = dx * dx + dz * dz;
        if (d <= bestD) { bestD = d; target = { x: e.rx, z: e.rz }; }
      }
    }

    this._reticle.userData.update({
      point,
      casterX: me.rx,
      casterZ: me.rz,
      casterAim: me.ra,
      range: SPELLS[this._aimSpellId]?.range,
      radius: SPELLS[this._aimSpellId]?.radius,
      target,
    });
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
    // releaseBolt() (not a bare scene.remove) so any live TrailPool trail
    // shards get flushed back to the shared pool instead of freezing in the
    // scene — see pool.js's releaseBolt() doc comment.
    for (const id of [...this.boltMeshes.keys()]) {
      releaseBolt(this.boltMeshes.get(id));
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
    // Dispose the persistent hold-to-aim reticle (not part of this.effects).
    if (this._reticle) {
      this._reticle.userData.dispose?.();
      this.scene.remove(this._reticle);
      this._reticle = null;
    }
    this._reticleSpellId = null;
    this._aimSpellId = null;
    // Clear map layout meshes (plateaus, ramps, obstacle props).
    this._rebuildMapMeshes(null, CFG.DEFAULT_ARENA_WORLD);
    this._mapVersion = -1;
    this.arena.reset();
  }
}
