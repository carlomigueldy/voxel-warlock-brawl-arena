// Procedural SFX engine built on the Web Audio API. Synthesizing sounds at
// runtime keeps the build asset-free while still giving every spell, hit, death
// and round transition its own punchy, "juicy" voice. A light reverb bus and a
// generative ambient pad round out the immersive feel.
// Map of every generated real-audio SFX key to its file under assets/audio/sfx/.
// See assets/audio/sfx/manifest.json for the authoritative key-to-file mapping.
const SFX_BASE = "assets/audio/sfx/";
const SFX_FILES = {
  // T1
  cast: "t1-cast.mp3",
  slow: "t1-slow.mp3",
  shieldBlock: "t1-shield-block.mp3",
  lowHealth: "t1-low-health.mp3",
  jump: "t1-jump.mp3",
  landSoft: "t1-land-soft.mp3",
  landHard: "t1-land-hard.mp3",
  footstepStone1: "t1-footstep-stone-1.mp3",
  footstepStone2: "t1-footstep-stone-2.mp3",
  footstepStone3: "t1-footstep-stone-3.mp3",
  footstepStone4: "t1-footstep-stone-4.mp3",
  pickupCommon: "t1-pickup-common.mp3",
  pickupRare: "t1-pickup-rare.mp3",
  // T2
  fireball: "t2-fireball.mp3",
  lightning: "t2-lightning.mp3",
  boomerang: "t2-boomerang.mp3",
  homing: "t2-homing.mp3",
  fireSpray: "t2-fire-spray.mp3",
  bouncer: "t2-bouncer.mp3",
  splitter: "t2-splitter.mp3",
  meteor: "t2-meteor.mp3",
  teleport: "t2-teleport.mp3",
  thrust: "t2-thrust.mp3",
  swap: "t2-swap.mp3",
  windWalk: "t2-wind-walk.mp3",
  rush: "t2-rush.mp3",
  drain: "t2-drain.mp3",
  gravity: "t2-gravity.mp3",
  link: "t2-link.mp3",
  disable: "t2-disable.mp3",
  shield: "t2-shield.mp3",
  timeShift: "t2-time-shift.mp3",
  pocketWatch: "t2-pocket-watch.mp3",
  projectile: "t2-arcane-bolt.mp3",
  target: "t2-doom.mp3",
  explode: "t2-detonate.mp3",
  stun: "t2-hex-bash.mp3",
  push: "t2-force-wave.mp3",
  pull: "t2-hook.mp3",
  drag: "t2-tow.mp3",
  vacuum: "t2-maelstrom.mp3",
  heal: "t2-mend.mp3",
  invisible: "t2-shadow-veil.mp3",
  speed: "t2-haste.mp3",
  blink: "t2-blink.mp3",
  summon: "t2-conjure.mp3",
  // T3
  chatMessage: "t3-chat-message.mp3",
  copyConfirm: "t3-copy-confirm.mp3",
  playerJoin: "t3-player-join.mp3",
  playerLeave: "t3-player-leave.mp3",
  muteOn: "t3-mute-on.mp3",
  muteOff: "t3-mute-off.mp3",
};

let _instance = null;
export class AudioEngine {
  constructor() {
    _instance = this;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.musicOn = true;
    this._musicNodes = [];
    this._lastPlay = {}; // throttle identical sounds
    this._bufferCache = new Map(); // path -> AudioBuffer | Promise<AudioBuffer|null>
  }

  // Must be called from a user gesture (browser autoplay policy).
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // Simple feedback-delay "reverb" send.
    this.reverb = this.ctx.createGain();
    this.reverb.gain.value = 0.18;
    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = 0.16;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2600;
    this.reverb.connect(delay); delay.connect(lp); lp.connect(fb);
    fb.connect(delay); lp.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);
    this.sfxGain.connect(this.reverb);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic(); else this.stopMusic();
  }

  _now() { return this.ctx.currentTime; }

  // Low-level voice: oscillator with an ADSR-ish envelope and optional sweep.
  _tone({ type = "sine", f0 = 440, f1 = null, dur = 0.2, gain = 0.5, when = 0, pan = 0 }) {
    if (!this.ctx) return;
    const t = this._now() + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); node = p;
    }
    osc.connect(g); node.connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // Filtered noise burst (impacts, sprays, wind).
  _noise({ dur = 0.2, gain = 0.4, type = "bandpass", freq = 1200, q = 1, when = 0, pan = 0, sweep = null }) {
    if (!this.ctx) return;
    const t = this._now() + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    if (sweep != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); node = p;
    }
    src.connect(filt); filt.connect(g); node.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // Lazily fetch+decode a real audio file and play it through the sfx bus,
  // layered on top of the procedural synthesis. Caches decoded buffers by
  // path so repeated plays are instant after the first fetch/decode.
  _playFile(path, pan = 0, gain = 0.7) {
    if (!this.ctx || !path) return;
    const full = SFX_BASE + path;
    const play = (buffer) => {
      if (!buffer || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      let node = g;
      if (pan && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p); node = p;
      }
      src.connect(g); node.connect(this.sfxGain);
      src.start();
    };
    const cached = this._bufferCache.get(full);
    if (cached instanceof AudioBuffer) { play(cached); return; }
    if (cached) { cached.then(play); return; } // already loading, chain onto it
    const pending = fetch(full)
      .then((r) => r.arrayBuffer())
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this._bufferCache.set(full, buf); return buf; })
      .catch(() => { this._bufferCache.delete(full); return null; });
    this._bufferCache.set(full, pending);
    pending.then(play);
  }

  // Play the file mapped to a SFX_FILES key, layered on the procedural voice.
  _playKeyFile(key, pan = 0, gain = 0.7) {
    const path = SFX_FILES[key];
    if (path) this._playFile(path, pan, gain);
  }

  // Randomly pick one of several SFX_FILES keys and play its file — used for
  // spells that share one procedural sfx name but each have their own
  // generated audio file (varies which file plays call to call).
  _playRandomKeyFile(keys, pan = 0, gain = 0.7) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    this._playKeyFile(key, pan, gain);
  }

  // Public: play a named sound. `pan` in [-1,1] from world x position.
  play(name, pan = 0) {
    if (!this.enabled || !this.ctx) return;
    // Throttle to avoid machine-gun stacking of identical sounds.
    const now = this._now();
    if (this._lastPlay[name] && now - this._lastPlay[name] < 0.03) return;
    this._lastPlay[name] = now;

    switch (name) {
      case "cast":
        this._tone({ type: "sine", f0: 500, f1: 900, dur: 0.15, gain: 0.25, pan });
        this._playKeyFile("cast", pan);
        break;
      case "fireball":
        this._tone({ type: "sawtooth", f0: 320, f1: 120, dur: 0.22, gain: 0.4, pan });
        this._noise({ dur: 0.18, gain: 0.25, freq: 900, sweep: 300, pan });
        // fireball, splitter and projectile (Arcane Bolt) share sfx: "fireball".
        this._playRandomKeyFile(["fireball", "splitter", "projectile"], pan);
        break;
      case "lightning":
        this._noise({ dur: 0.25, gain: 0.5, type: "highpass", freq: 2000, sweep: 6000, pan });
        this._tone({ type: "square", f0: 1800, f1: 400, dur: 0.18, gain: 0.2, pan });
        this._playKeyFile("lightning", pan);
        break;
      case "whoosh":
        this._noise({ dur: 0.3, gain: 0.3, type: "bandpass", freq: 700, sweep: 1800, q: 0.7, pan });
        // boomerang, bouncer, thrust and push share sfx: "whoosh".
        this._playRandomKeyFile(["boomerang", "bouncer", "thrust", "push"], pan);
        break;
      case "homing":
        this._tone({ type: "triangle", f0: 500, f1: 900, dur: 0.3, gain: 0.3, pan });
        // homing and target (Doom) share sfx: "homing".
        this._playRandomKeyFile(["homing", "target"], pan);
        break;
      case "spray":
        for (let i = 0; i < 5; i++)
          this._noise({ dur: 0.12, gain: 0.18, freq: 800 + i * 200, sweep: 300, when: i * 0.04, pan });
        this._playKeyFile("fireSpray", pan);
        break;
      case "meteor":
        this._tone({ type: "sawtooth", f0: 90, f1: 40, dur: 0.9, gain: 0.45, pan });
        this._noise({ dur: 0.9, gain: 0.3, type: "lowpass", freq: 400, sweep: 80, pan });
        // meteor and explode (Detonate) share sfx: "meteor".
        this._playRandomKeyFile(["meteor", "explode"], pan);
        break;
      case "meteorImpact":
        this._tone({ type: "sine", f0: 70, f1: 30, dur: 0.6, gain: 0.6, pan });
        this._noise({ dur: 0.5, gain: 0.5, type: "lowpass", freq: 1200, sweep: 120, pan });
        break;
      case "teleport":
        this._tone({ type: "sine", f0: 200, f1: 1400, dur: 0.25, gain: 0.35, pan });
        this._tone({ type: "sine", f0: 1400, f1: 300, dur: 0.2, gain: 0.2, when: 0.1, pan });
        // teleport, swap and blink share sfx: "teleport".
        this._playRandomKeyFile(["teleport", "swap", "blink"], pan);
        break;
      case "drain":
        this._tone({ type: "sawtooth", f0: 600, f1: 140, dur: 0.5, gain: 0.3, pan });
        // drain, pull (Hook) and drag (Tow) share sfx: "drain".
        this._playRandomKeyFile(["drain", "pull", "drag"], pan);
        break;
      case "gravity":
        this._tone({ type: "sine", f0: 120, f1: 60, dur: 0.7, gain: 0.4, pan });
        // gravity and vacuum (Maelstrom) share sfx: "gravity".
        this._playRandomKeyFile(["gravity", "vacuum"], pan);
        break;
      case "link":
        this._tone({ type: "triangle", f0: 400, f1: 800, dur: 0.3, gain: 0.25, pan });
        this._tone({ type: "triangle", f0: 600, f1: 1000, dur: 0.3, gain: 0.2, when: 0.05, pan });
        this._playKeyFile("link", pan);
        break;
      case "disable":
        this._tone({ type: "square", f0: 300, f1: 80, dur: 0.35, gain: 0.3, pan });
        // disable and stun (Hex Bash) share sfx: "disable".
        this._playRandomKeyFile(["disable", "stun"], pan);
        break;
      case "shield":
        this._tone({ type: "sine", f0: 300, f1: 700, dur: 0.4, gain: 0.3, pan });
        // shield and heal (Mend) share sfx: "shield".
        this._playRandomKeyFile(["shield", "heal"], pan);
        break;
      case "windwalk":
        this._noise({ dur: 0.6, gain: 0.25, type: "bandpass", freq: 500, sweep: 2000, q: 0.5, pan });
        // windWalk and invisible (Shadow Veil) share sfx: "windwalk".
        this._playRandomKeyFile(["windWalk", "invisible"], pan);
        break;
      case "rush":
        this._tone({ type: "sawtooth", f0: 200, f1: 500, dur: 0.4, gain: 0.3, pan });
        // rush and speed (Haste) share sfx: "rush".
        this._playRandomKeyFile(["rush", "speed"], pan);
        break;
      case "timeshift":
        this._tone({ type: "sine", f0: 800, f1: 200, dur: 0.6, gain: 0.3, pan });
        this._playKeyFile("timeShift", pan);
        break;
      case "watch":
        this._tone({ type: "square", f0: 1200, f1: 1200, dur: 0.06, gain: 0.2, pan });
        this._tone({ type: "square", f0: 900, f1: 900, dur: 0.06, gain: 0.2, when: 0.12, pan });
        // pocketWatch and summon (Conjure) share sfx: "watch".
        this._playRandomKeyFile(["pocketWatch", "summon"], pan);
        break;
      case "slow":
        this._tone({ type: "sine", f0: 400, f1: 200, dur: 0.3, gain: 0.3, pan });
        this._playKeyFile("slow", pan);
        break;
      case "stun":
        this._tone({ type: "square", f0: 800, f1: 400, dur: 0.08, gain: 0.35, pan });
        this._noise({ dur: 0.12, gain: 0.28, type: "highpass", freq: 2400, sweep: 600, pan });
        break;
      case "shieldBlock":
        this._tone({ type: "square", f0: 220, f1: 100, dur: 0.1, gain: 0.3, pan });
        this._playKeyFile("shieldBlock", pan);
        break;
      case "lowHealth":
        this._tone({ type: "sine", f0: 90, dur: 0.2, gain: 0.3, pan });
        this._playKeyFile("lowHealth", pan);
        break;
      case "jump":
        this._tone({ type: "sine", f0: 300, f1: 500, dur: 0.12, gain: 0.2, pan });
        this._playKeyFile("jump", pan);
        break;
      case "landSoft":
        this._noise({ dur: 0.08, gain: 0.2, type: "lowpass", freq: 500, sweep: 150, pan });
        this._playKeyFile("landSoft", pan);
        break;
      case "landHard":
        this._tone({ type: "sine", f0: 80, f1: 40, dur: 0.15, gain: 0.35, pan });
        this._noise({ dur: 0.15, gain: 0.3, type: "lowpass", freq: 700, sweep: 100, pan });
        this._playKeyFile("landHard", pan);
        break;
      case "footstepStone":
        this._noise({ dur: 0.06, gain: 0.12, type: "bandpass", freq: 900, q: 1, pan });
        this._playRandomKeyFile(["footstepStone1", "footstepStone2", "footstepStone3", "footstepStone4"], pan, 0.5);
        break;
      case "pickupCommon":
        this._tone({ type: "sine", f0: 700, f1: 1100, dur: 0.1, gain: 0.25, pan });
        this._playKeyFile("pickupCommon", pan);
        break;
      case "pickupRare":
        this._tone({ type: "triangle", f0: 700, f1: 1500, dur: 0.18, gain: 0.3, pan });
        this._tone({ type: "triangle", f0: 1100, f1: 1900, dur: 0.16, gain: 0.22, when: 0.06, pan });
        this._playKeyFile("pickupRare", pan);
        break;
      case "burn":
        this._noise({ dur: 0.25, gain: 0.35, type: "bandpass", freq: 1400, sweep: 400, pan });
        break;
      case "curse":
        this._tone({ type: "sawtooth", f0: 150, f1: 100, dur: 0.4, gain: 0.3, pan });
        this._tone({ type: "square", f0: 220, f1: 180, dur: 0.35, gain: 0.2, when: 0.05, pan });
        break;
      case "hit":
        this._tone({ type: "square", f0: 220, f1: 80, dur: 0.12, gain: 0.4, pan });
        this._noise({ dur: 0.1, gain: 0.3, type: "lowpass", freq: 1600, sweep: 200, pan });
        break;
      case "projectileClash":
        this._tone({ type: "square", f0: 520, f1: 120, dur: 0.18, gain: 0.38, pan });
        this._tone({ type: "triangle", f0: 980, f1: 240, dur: 0.16, gain: 0.22, when: 0.03, pan });
        this._noise({ dur: 0.16, gain: 0.32, type: "bandpass", freq: 1800, sweep: 380, q: 1.4, pan });
        break;
      case "death":
        this._tone({ type: "sawtooth", f0: 300, f1: 50, dur: 0.7, gain: 0.45, pan });
        this._noise({ dur: 0.6, gain: 0.3, type: "lowpass", freq: 800, sweep: 60, pan });
        break;
      case "countdown":
        this._tone({ type: "sine", f0: 660, dur: 0.15, gain: 0.4 });
        break;
      case "go":
        this._tone({ type: "sine", f0: 990, dur: 0.4, gain: 0.5 });
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) =>
          this._tone({ type: "triangle", f0: f, dur: 0.3, gain: 0.4, when: i * 0.12 }));
        break;
      case "lose":
        [392, 330, 262].forEach((f, i) =>
          this._tone({ type: "triangle", f0: f, dur: 0.4, gain: 0.35, when: i * 0.16 }));
        break;
      default:
        this._tone({ type: "sine", f0: 440, dur: 0.1, gain: 0.2, pan });
    }
  }

  // Public: play a short UI/menu sting by name. Respects the SFX mute toggle.
  menuCue(name) {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case "hover":
        this._tone({ type: "sine", f0: 880, dur: 0.04, gain: 0.12 });
        break;
      case "confirm":
        this._tone({ type: "triangle", f0: 330, f1: 180, dur: 0.12, gain: 0.26 });
        this._noise({ dur: 0.05, gain: 0.08, type: "lowpass", freq: 900 });
        break;
      case "back":
        this._tone({ type: "sine", f0: 440, f1: 174, dur: 0.12, gain: 0.22 });
        break;
      case "transition":
        this._noise({ dur: 0.2, gain: 0.25, type: "bandpass", freq: 400, sweep: 2000, q: 0.7 });
        break;
      case "victory":
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          this._tone({ type: "triangle", f0: f, dur: 0.25, gain: 0.3, when: i * 0.12 }));
        break;
      case "defeat":
        this._tone({ type: "sawtooth", f0: 220, f1: 110, dur: 0.5, gain: 0.25 });
        this._tone({ type: "sine", f0: 82, f1: 55, dur: 0.5, gain: 0.2 });
        break;
      case "lockin":
        this._tone({ type: "sine", f0: 1200, f1: 2000, dur: 0.1, gain: 0.2 });
        this._noise({ dur: 0.06, gain: 0.12, type: "highpass", freq: 3000, sweep: 6000 });
        break;
      case "countdown":
        this._tone({ type: "sine", f0: 1046, dur: 0.08, gain: 0.18 });
        break;
      case "chatMessage":
        this._playKeyFile("chatMessage");
        break;
      case "copyConfirm":
        this._playKeyFile("copyConfirm");
        break;
      case "playerJoin":
        this._playKeyFile("playerJoin");
        break;
      case "playerLeave":
        this._playKeyFile("playerLeave");
        break;
      case "muteOn":
        this._playKeyFile("muteOn");
        break;
      case "muteOff":
        this._playKeyFile("muteOff");
        break;
      default:
        break;
    }
  }

  // Generative ambient music pad: a slow minor arpeggio under a drone.
  startMusic() {
    if (!this.ctx || !this.musicOn || this._musicNodes.length) return;
    const root = 110; // A2
    const scale = [0, 3, 5, 7, 10, 12]; // minor pentatonic-ish
    const drone = this.ctx.createOscillator();
    const dg = this.ctx.createGain();
    drone.type = "sawtooth"; drone.frequency.value = root / 2;
    dg.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500;
    drone.connect(lp); lp.connect(dg); dg.connect(this.musicGain);
    drone.start();
    this._musicNodes.push(drone, dg);

    let step = 0;
    this._musicTimer = setInterval(() => {
      if (!this.musicOn) return;
      const semi = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      const f = root * Math.pow(2, semi / 12);
      const t = this._now();
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(g); g.connect(this.musicGain); g.connect(this.reverb);
      osc.start(t); osc.stop(t + 1.3);
      step++;
    }, 620);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    for (const n of this._musicNodes) { try { n.stop && n.stop(); n.disconnect(); } catch {} }
    this._musicNodes = [];
  }
}

// Module-level accessor so other ES modules can fire menu cues without the instance.
export function menuCue(name) { return _instance?.menuCue(name); }
