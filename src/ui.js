// All DOM/UI wiring: menus, lobby, HUD, room code, invite link, QR code.
// QRCode is loaded globally from a <script> tag (window.QRCode).
import { CFG, SPELLS, SPELL_ORDER } from "./config.js";

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

export class UI {
  constructor() {
    this.el = {
      menu: $("menu"), lobby: $("lobby"), hud: $("hud"),
      nameInput: $("name-input"), btnHost: $("btn-host"),
      joinCode: $("join-code"), btnJoin: $("btn-join"),
      menuStatus: $("menu-status"),
      roomCode: $("room-code"), btnCopyCode: $("btn-copy-code"),
      btnCopyLink: $("btn-copy-link"), qr: $("qr"),
      playerList: $("player-list"), btnStart: $("btn-start"),
      lobbyStatus: $("lobby-status"),
      roundInfo: $("round-info"), timer: $("timer"),
      scoreboard: $("scoreboard"), chargeBar: $("charge-bar"),
      centerMsg: $("center-msg"), touch: $("touch-controls"),
      abilityBar: $("ability-bar"),
      btnSfx: $("btn-sfx"), btnMusic: $("btn-music"),
    };
    this.handlers = {};
    this.audio = null;
    this._abilityEls = null;
    this._bind();
    this._prefillFromUrl();
    this._maybeShowTouch();
  }

  on(event, fn) { this.handlers[event] = fn; }

  setAudio(audio) {
    this.audio = audio;
    if (this.el.btnSfx) {
      this.el.btnSfx.onclick = () => {
        const on = this.el.btnSfx.classList.toggle("off");
        audio.setEnabled(!on);
        this.el.btnSfx.textContent = on ? "SFX: Off" : "SFX: On";
      };
    }
    if (this.el.btnMusic) {
      this.el.btnMusic.onclick = () => {
        const off = this.el.btnMusic.classList.toggle("off");
        audio.setMusic(!off);
        this.el.btnMusic.textContent = off ? "Music: Off" : "Music: On";
      };
    }
  }

  // Build the ability bar once, then refresh cooldown overlays each frame.
  _buildAbilityBar() {
    if (!this.el.abilityBar || this._abilityEls) return;
    this._abilityEls = {};
    this.el.abilityBar.replaceChildren();
    for (const id of SPELL_ORDER) {
      const s = SPELLS[id];
      if (!s) continue;
      const slot = document.createElement("div");
      slot.className = "ability-slot";
      slot.title = s.name;
      const key = document.createElement("span");
      key.className = "ability-key";
      key.textContent = s.key;
      const nm = document.createElement("span");
      nm.className = "ability-name";
      nm.textContent = s.name;
      const cd = document.createElement("div");
      cd.className = "ability-cd";
      const swatch = document.createElement("span");
      swatch.className = "ability-swatch";
      swatch.style.background = "#" + ((s.color || 0x8888ff).toString(16).padStart(6, "0"));
      slot.append(swatch, key, nm, cd);
      slot.onclick = () => this.handlers.selectSpell?.(id);
      this.el.abilityBar.appendChild(slot);
      this._abilityEls[id] = { slot, cd };
    }
  }

  updateAbilityBar(snapshot, localId) {
    this._buildAbilityBar();
    if (!this._abilityEls) return;
    const me = snapshot.players.find((p) => p.id === localId);
    const cds = me?.cds || {};
    for (const id in this._abilityEls) {
      const { cd } = this._abilityEls[id];
      const remain = cds[id] || 0;
      const total = SPELLS[id].cd || 1;
      const pct = Math.max(0, Math.min(100, (remain / total) * 100));
      cd.style.height = pct + "%";
      this._abilityEls[id].slot.classList.toggle("ready", remain <= 0);
    }
  }

  _bind() {
    this.el.btnHost.onclick = () => {
      const name = this._name();
      if (!name) return this.setMenuStatus("Enter a name first.");
      this.handlers.host?.(name);
    };
    this.el.btnJoin.onclick = () => this._tryJoin();
    this.el.joinCode.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._tryJoin();
    });
    this.el.btnStart.onclick = () => this.handlers.start?.();
    this.el.btnCopyCode.onclick = () => this._copy(this.currentCode, this.el.btnCopyCode, "Copy Code");
    this.el.btnCopyLink.onclick = () => this._copy(this._inviteLink(), this.el.btnCopyLink, "Copy Invite Link");
  }

  _tryJoin() {
    const name = this._name();
    const code = this.el.joinCode.value.trim().toUpperCase();
    if (!name) return this.setMenuStatus("Enter a name first.");
    if (code.length < 4) return this.setMenuStatus("Enter a valid room code.");
    this.handlers.join?.(name, code);
  }

  _name() { return this.el.nameInput.value.trim().slice(0, 14); }

  _prefillFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    if (code) {
      this.el.joinCode.value = code.toUpperCase();
      this.setMenuStatus(`Room ${code.toUpperCase()} ready — enter your name and Join.`);
    }
    const savedName = localStorage.getItem("vwb-name");
    if (savedName) this.el.nameInput.value = savedName;
  }

  _maybeShowTouch() {
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) this._touchEnabled = true;
  }

  _inviteLink() {
    const url = new URL(location.href);
    url.search = "?room=" + this.currentCode;
    return url.toString();
  }

  async _copy(text, btn, label) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => (btn.textContent = label), 1400);
  }

  // ---- screen transitions ----
  showMenu() {
    this.el.menu.classList.remove("hidden");
    this.el.lobby.classList.add("hidden");
    this.el.hud.classList.add("hidden");
    if (this.el.touch) this.el.touch.classList.add("hidden");
  }

  showLobby(code, { isHost }) {
    this.currentCode = code;
    localStorage.setItem("vwb-name", this._name());
    this.el.menu.classList.add("hidden");
    this.el.lobby.classList.remove("hidden");
    this.el.roomCode.textContent = code;
    this.el.btnStart.classList.toggle("hidden", !isHost);
    this._renderQR(this._inviteLink());
  }

  showGame() {
    this.el.menu.classList.add("hidden");
    this.el.lobby.classList.add("hidden");
    this.el.hud.classList.remove("hidden");
    this._buildAbilityBar();
    if (this.el.abilityBar) this.el.abilityBar.classList.remove("hidden");
    if (this._touchEnabled && this.el.touch) this.el.touch.classList.remove("hidden");
  }

  _renderQR(link) {
    this.el.qr.innerHTML = "";
    if (typeof QRCode === "undefined") {
      this.el.qr.textContent = "QR unavailable";
      return;
    }
    const canvas = document.createElement("canvas");
    this.el.qr.appendChild(canvas);
    QRCode.toCanvas(canvas, link, { width: 180, margin: 1 }, (err) => {
      if (err) this.el.qr.textContent = "QR error";
    });
  }

  setMenuStatus(t) { this.el.menuStatus.textContent = t || ""; }
  setLobbyStatus(t) { this.el.lobbyStatus.textContent = t || ""; }

  renderPlayerList(players, hostId) {
    this.el.playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = "#" + (CFG.COLORS[p.colorIndex % CFG.COLORS.length]).toString(16).padStart(6, "0");
      const name = document.createElement("span");
      name.textContent = p.name;
      li.appendChild(sw); li.appendChild(name);
      if (p.id === hostId) {
        const b = document.createElement("span");
        b.className = "host-badge"; b.textContent = "HOST";
        li.appendChild(b);
      }
      this.el.playerList.appendChild(li);
    });
  }

  // ---- in-game HUD ----
  updateHUD(snapshot, localId, meta) {
    const phaseLabel = {
      countdown: "Get Ready", playing: "Brawl!",
      roundEnd: "Round Over", matchEnd: "Match Over", lobby: "",
    }[snapshot.phase] || "";
    this.el.roundInfo.textContent = `Round ${snapshot.round} — ${phaseLabel}`;

    if (snapshot.phase === "countdown") {
      this.el.timer.textContent = Math.ceil(snapshot.timer) + "";
    } else {
      this.el.timer.textContent = this._fmtTime(snapshot.playTime || 0);
    }

    // Scoreboard sorted by score.
    const rows = [...snapshot.players]
      .map((p) => ({ ...p, meta: meta?.get(p.id) }))
      .sort((a, b) => b.s - a.s);
    this.el.scoreboard.replaceChildren();
    rows.forEach((p) => {
      const row = document.createElement("div");
      row.className = p.al ? "row" : "row dead";
      const name = document.createElement("span");
      name.textContent = `${p.meta?.name || "warlock"}${p.id === localId ? " (you)" : ""}`;
      const score = document.createElement("span");
      score.className = "pscore";
      score.textContent = p.s;
      row.append(name, score);
      this.el.scoreboard.appendChild(row);
    });

    // Charge bar for local player.
    const me = snapshot.players.find((p) => p.id === localId);
    const pct = me ? Math.min(100, (me.c / CFG.CHARGE_MAX) * 100) : 0;
    this.el.chargeBar.style.width = pct + "%";

    // Center messages.
    if (snapshot.phase === "countdown") {
      this.showCenter(Math.ceil(snapshot.timer) > 0 ? Math.ceil(snapshot.timer) : "GO!");
    } else if (snapshot.phase === "roundEnd") {
      const w = meta?.get(snapshot.winner)?.name;
      this.showCenter(w ? `${escapeHTML(w)} wins the round!` : "Draw!", "Next round starting…");
    } else if (snapshot.phase === "matchEnd") {
      const w = meta?.get(snapshot.matchWinner)?.name;
      this.showCenter(w ? `${escapeHTML(w)} WINS THE MATCH!` : "Match Over", "Refresh to play again");
    } else {
      this.hideCenter();
    }
  }

  showCenter(big, small) {
    this.el.centerMsg.classList.remove("hidden");
    this.el.centerMsg.innerHTML = `${big}${small ? `<small>${small}</small>` : ""}`;
  }
  hideCenter() { this.el.centerMsg.classList.add("hidden"); }

  _fmtTime(s) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  }
}
