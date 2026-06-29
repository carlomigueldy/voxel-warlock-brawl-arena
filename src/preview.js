// A small standalone Three.js viewer for the character-selection menu. It shows
// the currently-selected warlock on a turntable so the player can preview a full
// 360° before committing. It reuses the same rigged GLB templates as the game
// (character.js) and the same idle/locomotion animation update, so the preview
// matches what spawns in the arena.
import * as THREE from "three";
import { CFG, getCharacter } from "./config.js";
import {
  loadCharacterTemplate,
  characterReady,
  buildCharacterInstance,
} from "./character.js";

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 4.2);
    this.camera.lookAt(0, 0.95, 0);

    const hemi = new THREE.HemisphereLight(0x8a7bff, 0x2a1a3a, 1.0);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0e0, 1.4);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.PointLight(0x6c4cff, 0.8, 20);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);

    // A subtle turntable disc so the model isn't floating in the void.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.2, 0.18, 24),
      new THREE.MeshStandardMaterial({ color: 0x181433, roughness: 0.8, metalness: 0.1 })
    );
    disc.position.y = -0.09;
    disc.receiveShadow = true;
    this.scene.add(disc);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    this.clock = new THREE.Clock();
    this.current = null;       // active character mesh instance
    this.currentId = null;
    this.pendingId = CFG.DEFAULT_CHARACTER;
    this.running = false;
    this._raf = null;

    // Preload every selectable character so switching cards is instant.
    Promise.all(CFG.CHARACTERS.map((c) => loadCharacterTemplate(c.id).catch(() => null)))
      .then(() => this._ensureMesh());

    this._onResize = () => this._resize();
    window.addEventListener("resize", this._onResize);
    this._resize();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width || this.canvas.clientWidth || 280);
    const h = Math.max(1, rect.height || this.canvas.clientHeight || 280);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Select which character is shown. Safe to call before assets finish loading;
  // the mesh swaps in once its template is ready.
  select(characterId) {
    const ch = getCharacter(characterId);
    this.pendingId = ch.id;
    this._ensureMesh();
  }

  _ensureMesh() {
    const id = this.pendingId;
    if (this.currentId === id) return;
    if (!characterReady(id)) return; // not loaded yet; retry on next select/loop

    if (this.current) {
      this.turntable.remove(this.current);
      this.current = null;
    }
    const ch = getCharacter(id);
    const mesh = buildCharacterInstance(ch.color, id);
    if (!mesh) return;
    this.turntable.add(mesh);
    this.current = mesh;
    this.currentId = id;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta(); // reset delta so we don't jump
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this._tick();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    // Retry mesh swap in case assets just finished loading.
    if (this.currentId !== this.pendingId) this._ensureMesh();

    this.turntable.rotation.y += dt * 0.8; // full 360 spin

    // Drive the idle animation so the preview breathes like in-game.
    const char = this.current?.userData.character;
    if (char) char.update({ speed: 0, maxSpeed: CFG.MOVE_SPEED, charge: 0, falling: false, time: this.clock.elapsedTime, dt });

    this.renderer.render(this.scene, this.camera);
  }
}
