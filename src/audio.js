// Procedural SFX engine built on the Web Audio API. Synthesizing sounds at
// runtime keeps the build asset-free while still giving every spell, hit, death
// and round transition its own punchy, "juicy" voice. A light reverb bus and a
// generative ambient pad round out the immersive feel.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.musicOn = true;
    this._musicNodes = [];
    this._lastPlay = {}; // throttle identical sounds
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

  // Public: play a named sound. `pan` in [-1,1] from world x position.
  play(name, pan = 0) {
    if (!this.enabled || !this.ctx) return;
    // Throttle to avoid machine-gun stacking of identical sounds.
    const now = this._now();
    if (this._lastPlay[name] && now - this._lastPlay[name] < 0.03) return;
    this._lastPlay[name] = now;

    switch (name) {
      case "fireball":
        this._tone({ type: "sawtooth", f0: 320, f1: 120, dur: 0.22, gain: 0.4, pan });
        this._noise({ dur: 0.18, gain: 0.25, freq: 900, sweep: 300, pan });
        break;
      case "lightning":
        this._noise({ dur: 0.25, gain: 0.5, type: "highpass", freq: 2000, sweep: 6000, pan });
        this._tone({ type: "square", f0: 1800, f1: 400, dur: 0.18, gain: 0.2, pan });
        break;
      case "whoosh":
        this._noise({ dur: 0.3, gain: 0.3, type: "bandpass", freq: 700, sweep: 1800, q: 0.7, pan });
        break;
      case "homing":
        this._tone({ type: "triangle", f0: 500, f1: 900, dur: 0.3, gain: 0.3, pan });
        break;
      case "spray":
        for (let i = 0; i < 5; i++)
          this._noise({ dur: 0.12, gain: 0.18, freq: 800 + i * 200, sweep: 300, when: i * 0.04, pan });
        break;
      case "meteor":
        this._tone({ type: "sawtooth", f0: 90, f1: 40, dur: 0.9, gain: 0.45, pan });
        this._noise({ dur: 0.9, gain: 0.3, type: "lowpass", freq: 400, sweep: 80, pan });
        break;
      case "meteorImpact":
        this._tone({ type: "sine", f0: 70, f1: 30, dur: 0.6, gain: 0.6, pan });
        this._noise({ dur: 0.5, gain: 0.5, type: "lowpass", freq: 1200, sweep: 120, pan });
        break;
      case "teleport":
        this._tone({ type: "sine", f0: 200, f1: 1400, dur: 0.25, gain: 0.35, pan });
        this._tone({ type: "sine", f0: 1400, f1: 300, dur: 0.2, gain: 0.2, when: 0.1, pan });
        break;
      case "drain":
        this._tone({ type: "sawtooth", f0: 600, f1: 140, dur: 0.5, gain: 0.3, pan });
        break;
      case "gravity":
        this._tone({ type: "sine", f0: 120, f1: 60, dur: 0.7, gain: 0.4, pan });
        break;
      case "link":
        this._tone({ type: "triangle", f0: 400, f1: 800, dur: 0.3, gain: 0.25, pan });
        this._tone({ type: "triangle", f0: 600, f1: 1000, dur: 0.3, gain: 0.2, when: 0.05, pan });
        break;
      case "disable":
        this._tone({ type: "square", f0: 300, f1: 80, dur: 0.35, gain: 0.3, pan });
        break;
      case "shield":
        this._tone({ type: "sine", f0: 300, f1: 700, dur: 0.4, gain: 0.3, pan });
        break;
      case "windwalk":
        this._noise({ dur: 0.6, gain: 0.25, type: "bandpass", freq: 500, sweep: 2000, q: 0.5, pan });
        break;
      case "rush":
        this._tone({ type: "sawtooth", f0: 200, f1: 500, dur: 0.4, gain: 0.3, pan });
        break;
      case "timeshift":
        this._tone({ type: "sine", f0: 800, f1: 200, dur: 0.6, gain: 0.3, pan });
        break;
      case "watch":
        this._tone({ type: "square", f0: 1200, f1: 1200, dur: 0.06, gain: 0.2, pan });
        this._tone({ type: "square", f0: 900, f1: 900, dur: 0.06, gain: 0.2, when: 0.12, pan });
        break;
      case "hit":
        this._tone({ type: "square", f0: 220, f1: 80, dur: 0.12, gain: 0.4, pan });
        this._noise({ dur: 0.1, gain: 0.3, type: "lowpass", freq: 1600, sweep: 200, pan });
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
