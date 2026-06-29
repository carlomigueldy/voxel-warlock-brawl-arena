// Local input collection (keyboard/mouse + touch). Produces an input object
// that gets sent to the host (or applied directly if we are the host).
export class InputController {
  constructor(renderer) {
    this.renderer = renderer;
    this.keys = {};
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.fire = false;
    this.seq = 0;
    this.touchMove = [0, 0];
    this.touchFire = false;

    this._bind();
  }

  _bind() {
    addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "Space") this.fire = true;
    });
    addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      if (e.code === "Space") this.fire = false;
    });
    addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    addEventListener("mousedown", (e) => { if (e.button === 0) this.fire = true; });
    addEventListener("mouseup", (e) => { if (e.button === 0) this.fire = false; });

    this._bindTouch();
  }

  _bindTouch() {
    const joystick = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    const fireBtn = document.getElementById("fire-btn");
    if (!joystick) return;

    let active = false, originX = 0, originY = 0;
    const radius = 50;

    const start = (e) => {
      active = true;
      const t = e.touches ? e.touches[0] : e;
      const rect = joystick.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      e.preventDefault();
    };
    const move = (e) => {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      let dx = t.clientX - originX;
      let dy = t.clientY - originY;
      const len = Math.hypot(dx, dy);
      if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove = [dx / radius, dy / radius];
      e.preventDefault();
    };
    const end = (e) => {
      active = false;
      knob.style.transform = "translate(0,0)";
      this.touchMove = [0, 0];
    };

    joystick.addEventListener("touchstart", start, { passive: false });
    joystick.addEventListener("touchmove", move, { passive: false });
    joystick.addEventListener("touchend", end);

    fireBtn.addEventListener("touchstart", (e) => { this.touchFire = true; e.preventDefault(); }, { passive: false });
    fireBtn.addEventListener("touchend", (e) => { this.touchFire = false; e.preventDefault(); }, { passive: false });
  }

  // Build the current input snapshot to send/apply.
  sample() {
    let mx = 0, mz = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) mz -= 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) mz += 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) mx -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) mx += 1;

    // Touch joystick overrides if active.
    if (this.touchMove[0] !== 0 || this.touchMove[1] !== 0) {
      mx = this.touchMove[0];
      mz = this.touchMove[1];
    }

    const aim = this.renderer.screenToAim(this.mouseX, this.mouseY);
    const fire = this.fire || this.touchFire;

    return { move: [mx, mz], aim, fire, seq: ++this.seq };
  }
}
