// All DOM/UI wiring: menus, lobby, HUD, room code, invite link, QR code.
// QRCode is loaded globally from a <script> tag (window.QRCode).
import { CFG, SPELLS, SPELL_ORDER, getArenaHazard } from "./config.js";

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

export class UI {
  constructor() {
    this.el = {
      menu: $("menu"), lobby: $("lobby"), hud: $("hud"),
      nameInput: $("name-input"), btnHost: $("btn-host"),
      charCards: $("char-cards"), charPreview: $("char-preview"),
      charPreviewName: $("char-preview-name"),
      allAbilitiesToggle: $("all-abilities-toggle"),
      arenaWorld: $("arena-world"), landSize: $("land-size"),
      joinCode: $("join-code"), btnJoin: $("btn-join"),
      menuStatus: $("menu-status"),
      roomCode: $("room-code"), btnCopyCode: $("btn-copy-code"),
      btnCopyLink: $("btn-copy-link"), qr: $("qr"),
      playerList: $("player-list"), btnStart: $("btn-start"),
      botControls: $("bot-controls"), botCount: $("bot-count"), botSkill: $("bot-skill"),
      lobbyStatus: $("lobby-status"),
      roundInfo: $("round-info"), timer: $("timer"),
      scoreboard: $("scoreboard"), chargeBar: $("charge-bar"),
      hazardWarning: $("hazard-warning"),
      centerMsg: $("center-msg"), touch: $("touch-controls"),
      abilityBar: $("ability-bar"),
      btnSfx: $("btn-sfx"), btnMusic: $("btn-music"),
      // Custom control shells (native inputs above remain the source of truth).
      abilitiesToggleUi: $("abilities-toggle-ui"),
      landSizeUi: $("land-size-ui"),
      arenaWorldUi: $("arena-world-ui"),
      botCountUi: $("bot-count-ui"), botCountValue: $("bot-count-value"),
      botSkillUi: $("bot-skill-ui"),
      mapObjectsUi: $("map-objects-ui"),
      // Online / matchmaking elements.
      btnHostOnline: $("btn-host-online"),
      btnQuickMatch: $("btn-quick-match"),
      roomsList: $("rooms-list"),
      regionSelect: $("region-select"),
      onlineNotice: $("online-disabled-notice"),
      // Leaderboard elements.
      lbMetricUi: $("lb-metric-ui"),
      lbScopeUi: $("lb-scope-ui"),
      leaderboardTable: $("leaderboard-table"),
      lbNotice: $("leaderboard-disabled-notice"),
      // Account elements.
      identityBadge: $("identity-badge"),
      authForm: $("auth-form"),
      accountNotice: $("account-disabled-notice"),
    };
    this.handlers = {};
    this.audio = null;
    this._abilityEls = null;
    this._abilityMode = null;
    this.spellSlotHotkeys = [...CFG.DEFAULT_SPELL_SLOT_HOTKEYS];
    this.preview = null;
    this.selectedCharacter = this._initialCharacter();
    this._menuScreen = "online";
    this._onlineEnabled = false;
    this._lbMetric = "wins";
    this._lbScope = "global";
    this._populateArenaControls();
    this._buildCustomControls();
    this._buildCharacterCards();
    this._spawnEmbers();
    this._bind();
    this._bindNavSpine();
    this._prefillFromUrl();
    this._maybeShowTouch();
  }

  // ---- Custom (non-native) menu controls ----------------------------------
  _buildCustomControls() {
    this._buildAbilitiesToggle();
    this._buildArenaCards();
    this._buildLandSizeSegmented();
    this._buildBotControls();
    this._buildMapObjectsToggles();
    this._buildRegionSelector();
    this._buildLeaderboardControls();
    this._initAuthForm();
  }

  _buildAbilitiesToggle() {
    const btn = this.el.abilitiesToggleUi;
    const native = this.el.allAbilitiesToggle;
    if (!btn || !native) return;
    const sync = () => {
      const on = native.checked;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", String(on));
      const state = btn.querySelector(".rune-toggle-state");
      if (state) state.textContent = on ? "ON" : "OFF";
    };
    btn.addEventListener("click", () => { native.checked = !native.checked; sync(); });
    sync();
  }

  _buildArenaCards() {
    const wrap = this.el.arenaWorldUi;
    const native = this.el.arenaWorld;
    if (!wrap || !native) return;
    wrap.replaceChildren();
    CFG.ARENA_WORLDS.forEach((world) => {
      const hazard = getArenaHazard(world.id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "arena-card";
      card.setAttribute("role", "radio");
      card.dataset.value = world.id;
      card.style.setProperty("--card-color", hex(world.top));
      card.innerHTML =
        `<span class="arena-card-orb"></span>` +
        `<span class="arena-card-name">${escapeHTML(world.name)}</span>` +
        `<span class="arena-card-hazard">${escapeHTML(hazard.name)}</span>` +
        `<span class="arena-card-check">✓</span>`;
      card.addEventListener("click", () => this._selectArena(world.id));
      wrap.appendChild(card);
    });
    this._selectArena(native.value || CFG.DEFAULT_ARENA_WORLD);
  }

  _selectArena(id) {
    if (this.el.arenaWorld) this.el.arenaWorld.value = id;
    this.el.arenaWorldUi?.querySelectorAll(".arena-card").forEach((c) => {
      const on = c.dataset.value === id;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-checked", String(on));
    });
  }

  _buildLandSizeSegmented() {
    const wrap = this.el.landSizeUi;
    const native = this.el.landSize;
    if (!wrap || !native) return;
    wrap.replaceChildren();
    Object.values(CFG.ARENA_LAND_SIZES).forEach((size) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "seg-option";
      opt.setAttribute("role", "radio");
      opt.dataset.value = size.id;
      opt.textContent = size.name;
      opt.addEventListener("click", () => this._selectSegment(wrap, native, size.id));
      wrap.appendChild(opt);
    });
    this._selectSegment(wrap, native, native.value || CFG.DEFAULT_ARENA_LAND_SIZE);
  }

  _selectSegment(wrap, native, value, onChange) {
    if (native) native.value = value;
    wrap.querySelectorAll(".seg-option").forEach((o) => {
      const on = o.dataset.value === value;
      o.classList.toggle("is-active", on);
      o.setAttribute("aria-checked", String(on));
    });
    onChange?.();
  }

  _buildBotControls() {
    // Stepper -> #bot-count
    const stepper = this.el.botCountUi;
    const countInput = this.el.botCount;
    const valueEl = this.el.botCountValue;
    if (stepper && countInput && valueEl) {
      const max = CFG.MAX_PLAYERS - 1;
      const render = () => {
        const v = Math.max(0, Math.min(max, Number.parseInt(countInput.value, 10) || 0));
        countInput.value = String(v);
        valueEl.textContent = String(v);
        valueEl.classList.remove("bump");
        void valueEl.offsetWidth;
        valueEl.classList.add("bump");
        stepper.querySelector('[data-step="-1"]').disabled = v <= 0;
        stepper.querySelector('[data-step="1"]').disabled = v >= max;
      };
      stepper.querySelectorAll(".stepper-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const step = Number.parseInt(b.dataset.step, 10) || 0;
          countInput.value = String((Number.parseInt(countInput.value, 10) || 0) + step);
          render();
          this.handlers.bots?.(this.getBotSettings());
        });
      });
      render();
    }
    // Segmented -> #bot-skill
    const skillWrap = this.el.botSkillUi;
    const skillNative = this.el.botSkill;
    if (skillWrap && skillNative) {
      skillWrap.replaceChildren();
      const labels = { smart: "Smart", brilliant: "Brilliant", expert: "Expert" };
      CFG.BOT_SKILLS.forEach((skill) => {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "seg-option";
        opt.setAttribute("role", "radio");
        opt.dataset.value = skill;
        opt.textContent = labels[skill] || skill;
        opt.addEventListener("click", () => this._selectSegment(skillWrap, skillNative, skill, () => this.handlers.bots?.(this.getBotSettings())));
        skillWrap.appendChild(opt);
      });
      this._selectSegment(skillWrap, skillNative, skillNative.value || "smart");
    }
  }

  _buildMapObjectsToggles() {
    const wrap = this.el.mapObjectsUi;
    if (!wrap || !CFG.OBSTACLE_TYPES) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("vwb-map-objects") || "{}"); } catch {}
    const state = { ...CFG.DEFAULT_OBSTACLE_TOGGLES, ...saved };
    wrap.replaceChildren();
    CFG.OBSTACLE_TYPES.forEach(({ id, label }) => {
      const lbl = document.createElement("label");
      lbl.className = "obs-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "obs-toggle-check";
      input.dataset.id = id;
      input.checked = state[id] !== false;
      input.setAttribute("aria-label", label);
      const track = document.createElement("span");
      track.className = "obs-toggle-track";
      const knob = document.createElement("span");
      knob.className = "obs-toggle-knob";
      track.appendChild(knob);
      const text = document.createElement("span");
      text.className = "obs-toggle-label";
      text.textContent = label;
      const sync = () => lbl.classList.toggle("is-on", input.checked);
      sync();
      input.addEventListener("change", () => { sync(); this._saveMapObjects(); });
      lbl.appendChild(input);
      lbl.appendChild(track);
      lbl.appendChild(text);
      wrap.appendChild(lbl);
    });
  }

  _saveMapObjects() {
    const wrap = this.el.mapObjectsUi;
    if (!wrap) return;
    const state = {};
    wrap.querySelectorAll(".obs-toggle-check").forEach((input) => {
      if (input.dataset.id) state[input.dataset.id] = input.checked;
    });
    try { localStorage.setItem("vwb-map-objects", JSON.stringify(state)); } catch {}
  }

  _getEnabledObstacles() {
    const result = { ...CFG.DEFAULT_OBSTACLE_TOGGLES };
    const wrap = this.el.mapObjectsUi;
    if (!wrap) return result;
    wrap.querySelectorAll(".obs-toggle-check").forEach((input) => {
      if (input.dataset.id) result[input.dataset.id] = input.checked;
    });
    return result;
  }

  // ---- Region selector -------------------------------------------------------

  _buildRegionSelector() {
    const sel = this.el.regionSelect;
    if (!sel) return;
    sel.replaceChildren();
    // Fallback list — overridden at runtime if CFG.REGIONS is populated by the data team.
    const regions = (Array.isArray(CFG.REGIONS) && CFG.REGIONS.length > 0)
      ? CFG.REGIONS
      : [
          { id: "sea",     label: "Southeast Asia" },
          { id: "us-east", label: "US East" },
          { id: "us-west", label: "US West" },
          { id: "eu",      label: "Europe" },
          { id: "sa",      label: "South America" },
          { id: "oce",     label: "Oceania" },
        ];
    regions.forEach(({ id, label }) => {
      const opt = new Option(label, id);
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      this.handlers.regionChange?.(sel.value);
    });
  }

  /** Sync the region dropdown to a stored/detected value (called from main.js after getRegion()). */
  setRegion(id) {
    if (this.el.regionSelect && id) this.el.regionSelect.value = id;
  }

  // ---- Leaderboard controls -------------------------------------------------

  _buildLeaderboardControls() {
    const metricWrap = this.el.lbMetricUi;
    if (metricWrap) {
      const metrics = [
        { id: "wins",      label: "Wins"    },
        { id: "kd",        label: "K/D"     },
        { id: "roundWins", label: "Rounds"  },
        { id: "rating",    label: "Rating"  },
      ];
      metricWrap.replaceChildren();
      metrics.forEach(({ id, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seg-option";
        btn.setAttribute("role", "radio");
        btn.dataset.metric = id;
        btn.textContent = label;
        btn.addEventListener("click", () => {
          this._lbMetric = id;
          this._syncLbSegmented();
          this.handlers.leaderboardChange?.({ metric: this._lbMetric, scope: this._lbScope });
        });
        metricWrap.appendChild(btn);
      });
    }

    const scopeWrap = this.el.lbScopeUi;
    if (scopeWrap) {
      scopeWrap.replaceChildren();
      [{ id: "global", label: "Global" }, { id: "region", label: "My Region" }].forEach(({ id, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seg-option";
        btn.setAttribute("role", "radio");
        btn.dataset.scope = id;
        btn.textContent = label;
        btn.addEventListener("click", () => {
          this._lbScope = id;
          this._syncLbSegmented();
          this.handlers.leaderboardChange?.({ metric: this._lbMetric, scope: this._lbScope });
        });
        scopeWrap.appendChild(btn);
      });
    }

    this._syncLbSegmented();
  }

  _syncLbSegmented() {
    this.el.lbMetricUi?.querySelectorAll(".seg-option").forEach((btn) => {
      const on = btn.dataset.metric === this._lbMetric;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    });
    this.el.lbScopeUi?.querySelectorAll(".seg-option").forEach((btn) => {
      const on = btn.dataset.scope === this._lbScope;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }

  // ---- Auth form ------------------------------------------------------------

  _initAuthForm() {
    if (this.el.authForm) this._renderAuthTabs(this.el.authForm);
  }

  _renderAuthTabs(container) {
    container.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "auth-tabs";
    [{ mode: "signin", label: "Sign In" }, { mode: "signup", label: "Sign Up" }, { mode: "guest", label: "Play as Guest" }].forEach(({ mode, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "auth-tab-btn seg-option";
      btn.dataset.mode = mode;
      btn.textContent = label;
      btn.addEventListener("click", () => this._renderAuthForm(container, mode));
      tabs.appendChild(btn);
    });
    container.appendChild(tabs);
    this._renderAuthForm(container, "signin");
  }

  _renderAuthForm(container, mode) {
    container.querySelector(".auth-fields")?.remove();
    const fields = document.createElement("div");
    fields.className = "auth-fields";

    if (mode === "guest") {
      const guestBtn = document.createElement("button");
      guestBtn.type = "button";
      guestBtn.className = "btn btn-forge btn-hero";
      guestBtn.textContent = "Play as Guest";
      guestBtn.addEventListener("click", () => this.handlers.guest?.());
      fields.appendChild(guestBtn);
    } else {
      const emailField = this._makeAuthField("email", "Email", "email");
      const pwField = this._makeAuthField("password", mode === "signup" ? "Password" : "Password", "password");
      if (mode === "signup") {
        const userField = this._makeAuthField("username", "Username", "text");
        fields.append(emailField, userField, pwField);
      } else {
        fields.append(emailField, pwField);
      }

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "btn btn-forge btn-hero";
      submitBtn.textContent = mode === "signup" ? "Create Account" : "Sign In";
      submitBtn.addEventListener("click", () => {
        const email    = container.querySelector('[name="email"]')?.value?.trim();
        const password = container.querySelector('[name="password"]')?.value;
        const username = container.querySelector('[name="username"]')?.value?.trim();
        if (mode === "signup") {
          this.handlers.signUp?.({ email, password, username });
        } else {
          this.handlers.signIn?.({ email, password });
        }
      });

      const walletDivider = document.createElement("p");
      walletDivider.className = "auth-wallet-divider";
      walletDivider.textContent = "or connect a wallet";

      const ethBtn = document.createElement("button");
      ethBtn.type = "button";
      ethBtn.className = "btn btn-ghost auth-wallet-btn auth-eth-btn";
      ethBtn.textContent = "Sign in with Ethereum";
      ethBtn.addEventListener("click", () => this.handlers.ethSignIn?.());

      const solBtn = document.createElement("button");
      solBtn.type = "button";
      solBtn.className = "btn btn-ghost auth-wallet-btn auth-sol-btn";
      solBtn.textContent = "Sign in with Solana";
      solBtn.addEventListener("click", () => this.handlers.solSignIn?.());

      fields.append(submitBtn, walletDivider, ethBtn, solBtn);
    }

    container.appendChild(fields);

    // Sync tab active states.
    container.querySelectorAll(".auth-tab-btn").forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }

  _renderUpgradeForm(container) {
    container.replaceChildren();
    const title = document.createElement("p");
    title.className = "auth-upgrade-title";
    title.textContent = "Link an account to save your stats:";

    const emailField   = this._makeAuthField("email",    "Email",    "email");
    const userField    = this._makeAuthField("username",  "Username", "text");
    const pwField      = this._makeAuthField("password",  "Password", "password");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-forge";
    btn.textContent = "Upgrade Account";
    btn.addEventListener("click", () => {
      const email    = container.querySelector('[name="email"]')?.value?.trim();
      const password = container.querySelector('[name="password"]')?.value;
      const username = container.querySelector('[name="username"]')?.value?.trim();
      this.handlers.upgrade?.({ email, password, username });
    });

    container.append(title, emailField, userField, pwField, btn);
  }

  _makeAuthField(name, label, type) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lbl = document.createElement("label");
    lbl.className = "field-label";
    lbl.htmlFor = `auth-${name}`;
    lbl.textContent = label;
    const rune = document.createElement("div");
    rune.className = "rune-field";
    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.id = `auth-${name}`;
    input.autocomplete = type === "password" ? "current-password" : (name === "email" ? "email" : "username");
    const line = document.createElement("span");
    line.className = "rune-field-line";
    rune.append(input, line);
    wrap.append(lbl, rune);
    return wrap;
  }

  // ---- Online-enabled flag --------------------------------------------------

  /**
   * Called by main.js on boot with isEnabled() result.
   * Shows/hides disabled notices and enables/disables online-only controls.
   */
  setOnlineEnabled(enabled) {
    this._onlineEnabled = enabled;
    // Notices: visible when NOT enabled.
    document.querySelectorAll(".supabase-notice").forEach((el) => {
      el.classList.toggle("hidden", enabled);
    });
    // Online buttons: disabled when not enabled.
    if (this.el.btnQuickMatch)  this.el.btnQuickMatch.disabled  = !enabled;
    if (this.el.btnHostOnline)  this.el.btnHostOnline.disabled  = !enabled;
    if (this.el.regionSelect)   this.el.regionSelect.disabled   = !enabled;
    // Auth form: hidden when not enabled.
    if (this.el.authForm)      this.el.authForm.classList.toggle("hidden", !enabled);
    if (this.el.identityBadge) this.el.identityBadge.classList.toggle("hidden", true);
  }

  // ---- Render helpers -------------------------------------------------------

  /** Render the live rooms list in the Online sub-screen. */
  renderRooms(list) {
    const el = this.el.roomsList;
    if (!el) return;
    el.replaceChildren();

    if (!list || list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "rooms-empty";
      empty.textContent = "No open rooms. Be the first to host!";
      el.appendChild(empty);
      return;
    }

    list.forEach((room) => {
      const row = document.createElement("div");
      row.className = "room-row";
      row.setAttribute("role", "listitem");

      const host = document.createElement("span");
      host.className = "room-host";
      host.textContent = escapeHTML(room.hostName || "Unknown");

      const map = document.createElement("span");
      map.className = "room-map";
      map.textContent = escapeHTML(room.map || "—");

      const players = document.createElement("span");
      players.className = "room-players";
      players.textContent = `${room.playerCount ?? "?"}/${room.maxPlayers ?? "?"}`;

      const joinBtn = document.createElement("button");
      joinBtn.type = "button";
      joinBtn.className = "btn btn-ghost room-join-btn";
      joinBtn.textContent = "Join";
      joinBtn.addEventListener("click", () => {
        const name = this._name();
        if (!name) { this.setMenuStatus("Enter a name first."); return; }
        this.handlers.joinRoom?.(room.code);
      });

      row.append(host, map, players, joinBtn);
      el.appendChild(row);
    });
  }

  /** Render leaderboard rows. rows is the array from fetchLeaderboard(). */
  renderLeaderboard(rows, { metric, scope } = {}) {
    const el = this.el.leaderboardTable;
    if (!el) return;
    el.replaceChildren();

    // Sync controls to reflect the rendered metric/scope.
    if (metric) this._lbMetric = metric;
    if (scope)  this._lbScope  = scope;
    this._syncLbSegmented();

    if (!rows || rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "lb-empty";
      empty.textContent = "No data yet — play some matches!";
      el.appendChild(empty);
      return;
    }

    const metricLabel = { wins: "Wins", kd: "K/D", roundWins: "Rounds", rating: "Rating" }[metric] || "Score";

    const header = document.createElement("div");
    header.className = "lb-row lb-header";
    header.setAttribute("role", "row");
    const hRank  = document.createElement("span"); hRank.className  = "lb-rank";  hRank.textContent  = "#";
    const hName  = document.createElement("span"); hName.className  = "lb-name";  hName.textContent  = "Warlock";
    const hValue = document.createElement("span"); hValue.className = "lb-value"; hValue.textContent = metricLabel;
    header.append(hRank, hName, hValue);
    el.appendChild(header);

    rows.forEach((row, i) => {
      const r = document.createElement("div");
      r.className = "lb-row" + (i === 0 ? " lb-top" : "");
      r.setAttribute("role", "row");

      const rank  = document.createElement("span"); rank.className  = "lb-rank";
      const name  = document.createElement("span"); name.className  = "lb-name";
      const value = document.createElement("span"); value.className = "lb-value";

      rank.textContent  = i + 1;
      name.textContent  = escapeHTML(row.username || (row.userId ? row.userId.slice(0, 8) + "…" : "—"));
      value.textContent = row[metric] ?? "—";

      r.append(rank, name, value);
      el.appendChild(r);
    });
  }

  /**
   * Render identity badge + auth form based on the current user.
   * user: {id, email, username, isGuest} | null
   */
  renderAuthState(user) {
    const badge = this.el.identityBadge;
    const form  = this.el.authForm;
    if (!badge || !form) return;

    if (!this._onlineEnabled) {
      badge.classList.add("hidden");
      return;
    }

    if (user) {
      // Signed-in (real or guest).
      badge.classList.remove("hidden");
      badge.replaceChildren();

      const icon = document.createElement("span");
      icon.className = user.isGuest ? "identity-icon identity-guest" : "identity-icon identity-account";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = user.isGuest ? "◎" : "◉";

      const info = document.createElement("span");
      info.className = "identity-info";
      info.textContent = user.isGuest
        ? "Playing as Guest"
        : (user.username || user.email || "Signed In");

      const signOutBtn = document.createElement("button");
      signOutBtn.type = "button";
      signOutBtn.className = "btn btn-ghost identity-signout";
      signOutBtn.textContent = "Sign Out";
      signOutBtn.addEventListener("click", () => this.handlers.signOut?.());

      badge.append(icon, info, signOutBtn);

      if (user.isGuest) {
        this._renderUpgradeForm(form);
        form.classList.remove("hidden");
      } else {
        form.replaceChildren();
        form.classList.add("hidden");
      }
    } else {
      // Not signed in.
      badge.classList.add("hidden");
      form.classList.remove("hidden");
      this._renderAuthTabs(form);
    }
  }

  /** Public name accessor — used by main.js for quickMatch / joinRoom flows. */
  getName() { return this._name(); }

  // ---- Floating ember particle bed ----------------------------------------
  _spawnEmbers() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["var(--ember)", "var(--arcane)", "var(--gold)", "var(--rune)"];
    document.querySelectorAll(".ember-field").forEach((field) => {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 26; i++) {
        const e = document.createElement("span");
        e.className = "ember";
        e.style.left = Math.random() * 100 + "%";
        e.style.setProperty("--s", (3 + Math.random() * 5).toFixed(1) + "px");
        e.style.setProperty("--dur", (7 + Math.random() * 8).toFixed(1) + "s");
        e.style.setProperty("--delay", (-Math.random() * 12).toFixed(1) + "s");
        e.style.setProperty("--drift", (Math.random() * 80 - 40).toFixed(0) + "px");
        e.style.setProperty("--c", colors[i % colors.length]);
        frag.appendChild(e);
      }
      field.appendChild(frag);
    });
  }

  on(event, fn) { this.handlers[event] = fn; }

  setPreview(preview) {
    this.preview = preview;
    if (preview) preview.select(this.selectedCharacter);
    this._highlightCharacter(this.selectedCharacter);
  }

  getCharacter() { return this.selectedCharacter; }

  _initialCharacter() {
    const saved = localStorage.getItem("vwb-character");
    return CFG.CHARACTERS.some((c) => c.id === saved) ? saved : CFG.DEFAULT_CHARACTER;
  }

  _buildCharacterCards() {
    if (!this.el.charCards) return;
    this.el.charCards.replaceChildren();
    for (const ch of CFG.CHARACTERS) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "char-card";
      card.dataset.character = ch.id;
      card.setAttribute("role", "radio");
      card.style.setProperty("--char-color", hex(ch.color));
      card.innerHTML =
        `<span class="char-card-swatch"></span>` +
        `<span class="char-card-name">${escapeHTML(ch.name)}</span>` +
        `<span class="char-card-blurb">${escapeHTML(ch.blurb)}</span>` +
        `<span class="char-card-check">✓</span>`;
      card.addEventListener("click", () => this._selectCharacter(ch.id));
      this.el.charCards.appendChild(card);
    }
    this._highlightCharacter(this.selectedCharacter);
  }

  _selectCharacter(id) {
    if (!CFG.CHARACTERS.some((c) => c.id === id)) return;
    this.selectedCharacter = id;
    localStorage.setItem("vwb-character", id);
    this._highlightCharacter(id);
    this.preview?.select(id);
    this.handlers.character?.(id);
  }

  _highlightCharacter(id) {
    if (!this.el.charCards) return;
    for (const card of this.el.charCards.children) {
      const on = card.dataset.character === id;
      card.classList.toggle("is-active", on);
      card.setAttribute("aria-checked", String(on));
    }
    if (this.el.charPreviewName) {
      this.el.charPreviewName.textContent = (CFG.CHARACTERS.find((c) => c.id === id) || {}).name || "";
    }
  }

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

  setSpellSlotHotkeys(keys = CFG.DEFAULT_SPELL_SLOT_HOTKEYS) {
    this.spellSlotHotkeys = CFG.DEFAULT_SPELL_SLOT_HOTKEYS.map((fallback, i) => keys[i] || fallback);
    if (this._abilityMode === "slots") this._buildAbilityBar(true);
  }

  // Build the ability bar once, then refresh cooldown overlays each frame.
  _buildAbilityBar(force = false, mode = this._abilityMode || "spellbook") {
    if (!this.el.abilityBar) return;
    if (force || this._abilityMode !== mode) {
      this._abilityEls = null;
      this._abilityMode = mode;
    }
    if (this._abilityEls) return;
    this._abilityEls = {};
    this.el.abilityBar.replaceChildren();
    if (mode === "slots") {
      for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) this._buildSpellSlot(i);
      return;
    }
    for (const id of SPELL_ORDER) this._buildSpellbookSlot(id);
  }

  _buildSpellbookSlot(id) {
    const s = SPELLS[id];
    if (!s) return;
    const slot = this._slotShell(s.name, s.key, s.name, s.color || 0x8888ff);
    slot.el.dataset.spell = id;
    slot.el.onclick = () => this.handlers.selectSpell?.(id);
    this._attachTooltip(slot.el);
    this.el.abilityBar.appendChild(slot.el);
    this._abilityEls[id] = { slot: slot.el, cd: slot.cd };
  }

  _buildSpellSlot(index) {
    const key = this.spellSlotHotkeys[index] || CFG.DEFAULT_SPELL_SLOT_HOTKEYS[index];
    const slot = this._slotShell(`Spell slot ${index + 1}`, key, "Empty", 0x444466);
    slot.el.dataset.slot = String(index);
    slot.el.classList.add("empty");
    const picker = document.createElement("button");
    picker.className = "hotkey-picker";
    picker.type = "button";
    picker.textContent = "↻";
    picker.onclick = (e) => {
      e.stopPropagation();
      picker.textContent = "…";
      const set = (ev) => {
        ev.preventDefault();
        const key = this._eventKey(ev);
        if (key) {
          this.handlers.spellSlotHotkey?.(index, key);
          this.spellSlotHotkeys[index] = key;
          slot.key.textContent = key;
        }
        picker.textContent = "↻";
      };
      addEventListener("keydown", set, { once: true });
    };
    slot.el.appendChild(picker);
    slot.el.onclick = () => {
      const spell = slot.el.dataset.spell;
      if (spell) this.handlers.selectSpell?.(spell);
    };
    this._attachTooltip(slot.el);
    this.el.abilityBar.appendChild(slot.el);
    this._abilityEls[index] = { slot: slot.el, cd: slot.cd, key: slot.key, nm: slot.nm, swatch: slot.swatch };
  }

  _slotShell(title, keyText, nameText, color) {
    const el = document.createElement("div");
    el.className = "ability-slot";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const key = document.createElement("span");
    key.className = "ability-key";
    key.textContent = keyText;
    const nm = document.createElement("span");
    nm.className = "ability-name";
    nm.textContent = nameText;
    const cd = document.createElement("div");
    cd.className = "ability-cd";
    const swatch = document.createElement("span");
    swatch.className = "ability-swatch";
    swatch.style.background = "#" + (color.toString(16).padStart(6, "0"));
    el.append(swatch, key, nm, cd);
    return { el, key, nm, cd, swatch };
  }

  _eventKey(e) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
    return null;
  }

  // ---- Spell tooltip -------------------------------------------------------

  _initTooltip() {
    if (this._tooltipEl) return this._tooltipEl;
    const tt = document.createElement("div");
    tt.className = "spell-tooltip";
    tt.setAttribute("role", "tooltip");
    tt.setAttribute("aria-hidden", "true");
    (this.el.hud || document.body).appendChild(tt);
    this._tooltipEl = tt;
    return tt;
  }

  _buildTooltipContent(id) {
    const s = SPELLS[id];
    if (!s) return null;
    const color = "#" + ((s.color || 0x8888ff) >>> 0).toString(16).padStart(6, "0").slice(-6);
    const stats = [`Cooldown: ${s.cd}s`];
    if (s.range != null)    stats.push(`Range: ${s.range}`);
    if (s.kb != null)       stats.push(`Knockback: ${s.kb}`);
    if (s.duration != null) stats.push(`Duration: ${s.duration}s`);
    if (s.count != null)    stats.push(`Count: ${s.count}`);
    if (s.chains != null)   stats.push(`Chains: ${s.chains}`);

    const frag = document.createDocumentFragment();

    const titleEl = document.createElement("div");
    titleEl.className = "spell-tooltip-title";
    titleEl.style.color = color;
    titleEl.textContent = s.name;
    const keyEl = document.createElement("span");
    keyEl.className = "spell-tooltip-key";
    keyEl.textContent = s.key;
    titleEl.appendChild(keyEl);
    frag.appendChild(titleEl);

    const descEl = document.createElement("div");
    descEl.className = "spell-tooltip-desc";
    descEl.textContent = s.desc || "";
    frag.appendChild(descEl);

    const statsEl = document.createElement("div");
    statsEl.className = "spell-tooltip-stats";
    statsEl.textContent = stats.join(" · ");
    frag.appendChild(statsEl);

    return frag;
  }

  _positionTooltip(tt, anchor) {
    tt.style.visibility = "hidden";
    tt.style.display = "block";
    const rect = anchor.getBoundingClientRect();
    const tw = tt.offsetWidth;
    const th = tt.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2;
    let top  = rect.top - th - 8;
    if (top < 8) top = rect.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tt.style.left = left + "px";
    tt.style.top  = top  + "px";
    tt.style.visibility = "";
  }

  _showTooltip(slotEl) {
    const id = slotEl.dataset.spell;
    if (!id || !SPELLS[id]) { this._hideTooltip(); return; }
    const tt = this._initTooltip();
    const content = this._buildTooltipContent(id);
    if (!content) { this._hideTooltip(); return; }
    tt.replaceChildren(content);
    tt.removeAttribute("aria-hidden");
    tt.classList.add("visible");
    this._positionTooltip(tt, slotEl);
  }

  _hideTooltip() {
    if (!this._tooltipEl) return;
    this._tooltipEl.classList.remove("visible");
    this._tooltipEl.setAttribute("aria-hidden", "true");
  }

  _attachTooltip(slotEl) {
    slotEl.addEventListener("mouseenter", (e) => {
      if (e.target !== slotEl && e.target.classList.contains("hotkey-picker")) return;
      this._showTooltip(slotEl);
    });
    slotEl.addEventListener("mouseleave", () => this._hideTooltip());
    slotEl.addEventListener("focusin", () => this._showTooltip(slotEl));
    slotEl.addEventListener("focusout", () => this._hideTooltip());
  }

  // -------------------------------------------------------------------------

  updateAbilityBar(snapshot, localId) {
    const me = snapshot.players.find((p) => p.id === localId);
    const slotMode = snapshot.spellSlotsEnabled && Array.isArray(me?.spellSlots);
    this._buildAbilityBar(false, slotMode ? "slots" : "spellbook");
    if (!this._abilityEls) return;
    const cds = me?.cds || {};
    if (slotMode) {
      const spellSlots = me.spellSlots;
      for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) {
        const id = spellSlots[i];
        const { slot, cd, nm, swatch } = this._abilityEls[i];
        const empty = !id || !SPELLS[id];
        const remain = empty ? 0 : (cds[id] || 0);
        const total = empty ? 1 : (SPELLS[id].cd || 1);
        const pct = Math.max(0, Math.min(100, (remain / total) * 100));
        slot.dataset.spell = empty ? "" : id;
        slot.title = empty ? `Empty spell slot ${i + 1}` : "";
        nm.textContent = empty ? "Empty" : SPELLS[id].name;
        swatch.style.background = "#" + ((empty ? 0x444466 : (SPELLS[id].color || 0x8888ff)).toString(16).padStart(6, "0"));
        cd.style.height = empty ? "100%" : pct + "%";
        slot.classList.toggle("empty", empty);
        slot.classList.toggle("locked", empty);
        slot.classList.toggle("ready", !empty && remain <= 0);
      }
      return;
    }
    const acquired = new Set(me?.spells || SPELL_ORDER);
    for (const id in this._abilityEls) {
      const { slot, cd } = this._abilityEls[id];
      const locked = !acquired.has(id);
      const remain = cds[id] || 0;
      const total = SPELLS[id].cd || 1;
      const pct = Math.max(0, Math.min(100, (remain / total) * 100));
      cd.style.height = locked ? "100%" : pct + "%";
      slot.classList.toggle("locked", locked);
      slot.classList.toggle("ready", !locked && remain <= 0);
    }
  }

  _populateArenaControls() {
    if (this.el.arenaWorld) {
      this.el.arenaWorld.replaceChildren(...CFG.ARENA_WORLDS.map((world) => new Option(world.name, world.id, false, world.id === CFG.DEFAULT_ARENA_WORLD)));
    }
    if (this.el.landSize) {
      this.el.landSize.replaceChildren(...Object.values(CFG.ARENA_LAND_SIZES).map((size) => new Option(size.name, size.id, false, size.id === CFG.DEFAULT_ARENA_LAND_SIZE)));
    }
  }

  _bind() {
    // LAN Host — fires hostLan event.
    if (this.el.btnHost) {
      this.el.btnHost.onclick = () => {
        const name = this._name();
        if (!name) return this.setMenuStatus("Enter a name first.");
        this.handlers.hostLan?.(name, {
          allAbilitiesAtStart: this.allAbilitiesAtStart(),
          character: this.selectedCharacter,
          ...this.getArenaSettings(),
        });
      };
    }

    // Online Host — fires hostOnline event.
    if (this.el.btnHostOnline) {
      this.el.btnHostOnline.onclick = () => {
        const name = this._name();
        if (!name) return this.setMenuStatus("Enter a name first.");
        this.handlers.hostOnline?.(name, {
          allAbilitiesAtStart: this.allAbilitiesAtStart(),
          character: this.selectedCharacter,
          ...this.getArenaSettings(),
        });
      };
    }

    // Quick Match — fires quickMatch event.
    if (this.el.btnQuickMatch) {
      this.el.btnQuickMatch.onclick = () => {
        const name = this._name();
        if (!name) return this.setMenuStatus("Enter a name first.");
        this.handlers.quickMatch?.();
      };
    }

    // LAN Join — fires joinByCode event.
    if (this.el.btnJoin) {
      this.el.btnJoin.onclick = () => this._tryJoin();
    }
    if (this.el.joinCode) {
      this.el.joinCode.addEventListener("input", () => {
        this.el.joinCode.value = this.el.joinCode.value.toUpperCase();
      });
      this.el.joinCode.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this._tryJoin();
      });
    }

    // Lobby controls.
    if (this.el.btnStart) {
      this.el.btnStart.onclick = () => this.handlers.start?.();
    }
    this.el.botCount?.addEventListener("input", () => this.handlers.bots?.(this.getBotSettings()));
    this.el.botSkill?.addEventListener("change", () => this.handlers.bots?.(this.getBotSettings()));
    if (this.el.btnCopyCode) {
      this.el.btnCopyCode.onclick = () => this._copy(this.currentCode, this.el.btnCopyCode, "Copy Code");
    }
    if (this.el.btnCopyLink) {
      this.el.btnCopyLink.onclick = () => this._copy(this._inviteLink(), this.el.btnCopyLink, "Copy Invite Link");
    }
  }

  _tryJoin() {
    const name = this._name();
    const code = this.el.joinCode?.value.trim().toUpperCase() || "";
    if (!name) return this.setMenuStatus("Enter a name first.");
    if (code.length < 4) return this.setMenuStatus("Enter a valid room code.");
    this.handlers.joinByCode?.(name, code, this.selectedCharacter);
  }

  _name() { return this.el.nameInput?.value.trim().slice(0, 14) || ""; }

  allAbilitiesAtStart() { return this.el.allAbilitiesToggle?.checked !== false; }

  getArenaSettings() {
    const arenaWorld = CFG.ARENA_WORLDS.some((world) => world.id === this.el.arenaWorld?.value) ? this.el.arenaWorld.value : CFG.DEFAULT_ARENA_WORLD;
    const landSize = CFG.ARENA_LAND_SIZES[this.el.landSize?.value] ? this.el.landSize.value : CFG.DEFAULT_ARENA_LAND_SIZE;
    const enabledObstacles = this._getEnabledObstacles();
    return { arenaWorld, landSize, enabledObstacles };
  }

  getBotSettings() {
    return {
      count: Math.max(0, Math.min(CFG.MAX_PLAYERS - 1, Number.parseInt(this.el.botCount?.value, 10) || 0)),
      skill: CFG.BOT_SKILLS.includes(this.el.botSkill?.value) ? this.el.botSkill.value : "smart",
    };
  }

  _prefillFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    if (code) {
      if (this.el.joinCode) this.el.joinCode.value = code.toUpperCase();
      this.setMenuStatus(`Room ${code.toUpperCase()} ready — enter your name and Join.`);
      // Navigate to LAN screen so the join field is visible.
      this._showMenuScreen("lan");
    }
    const savedName = localStorage.getItem("vwb-name");
    if (savedName && this.el.nameInput) this.el.nameInput.value = savedName;
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

  // ---- Cinematic menu sub-screen navigation ----

  /**
   * Switch to one of the named sub-screens.
   * Valid names: "online" | "lan" | "characters" | "settings" | "leaderboards" | "account"
   */
  _showMenuScreen(name) {
    this._menuScreen = name;
    // Toggle sub-screens.
    this.el.menu.querySelectorAll(".sub-screen").forEach((el) => {
      const on = el.id === `screen-${name}`;
      el.classList.toggle("sub-screen-hidden", !on);
      el.setAttribute("aria-hidden", on ? "false" : "true");
    });
    // Update spine button active state.
    this.el.menu.querySelectorAll(".spine-btn").forEach((btn) => {
      const on = btn.dataset.screen === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-current", on ? "true" : "false");
    });
    // Notify main.js so it can subscribe/unsubscribe as needed.
    this.handlers.screenChange?.(name);
  }

  /** Wire the vertical spine nav buttons to sub-screen switching. */
  _bindNavSpine() {
    this.el.menu.querySelectorAll(".spine-btn").forEach((btn) => {
      btn.addEventListener("click", () => this._showMenuScreen(btn.dataset.screen));
    });
    // Initialise to "online" sub-screen.
    this._showMenuScreen("online");
  }

  // ---- screen transitions ----
  showMenu() {
    this.el.menu.classList.remove("hidden");
    this.el.lobby.classList.add("hidden");
    this.el.hud.classList.add("hidden");
    if (this.el.touch) this.el.touch.classList.add("hidden");
    // Return to online sub-screen when coming back from lobby.
    this._showMenuScreen("online");
    this.preview?.start();
  }

  showLobby(code, { isHost }) {
    this.currentCode = code;
    localStorage.setItem("vwb-name", this._name());
    this.preview?.stop();
    this.el.menu.classList.add("hidden");
    this.el.lobby.classList.remove("hidden");
    this.el.roomCode.textContent = code;
    this.el.btnStart.classList.toggle("hidden", !isHost);
    this.el.botControls?.classList.toggle("hidden", !isHost);
    this._renderQR(this._inviteLink());
  }

  showGame() {
    this.preview?.stop();
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

  setMenuStatus(t) { if (this.el.menuStatus) this.el.menuStatus.textContent = t || ""; }
  setLobbyStatus(t) { if (this.el.lobbyStatus) this.el.lobbyStatus.textContent = t || ""; }

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
      if (p.isBot) {
        const b = document.createElement("span");
        b.className = "host-badge"; b.textContent = "BOT";
        li.appendChild(b);
      } else if (p.id === hostId) {
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

    // Scoreboard sorted by score — includes K/D column.
    const rows = [...snapshot.players]
      .map((p) => ({ ...p, meta: meta?.get(p.id) }))
      .sort((a, b) => b.s - a.s);
    this.el.scoreboard.replaceChildren();
    rows.forEach((p) => {
      const row = document.createElement("div");
      row.className = p.al ? "row" : "row dead";

      const name = document.createElement("span");
      name.textContent = `${p.meta?.name || "warlock"}${p.id === localId ? " (you)" : ""}`;

      // K/D column — uses snapshot k/d fields; falls back to 0 if absent.
      const kd = document.createElement("span");
      kd.className = "pkd";
      kd.textContent = `${p.k ?? 0}/${p.d ?? 0}`;

      const score = document.createElement("span");
      score.className = "pscore";
      score.textContent = p.s;

      row.append(name, kd, score);
      this.el.scoreboard.appendChild(row);
    });

    // Charge bar for local player.
    const me = snapshot.players.find((p) => p.id === localId);
    const pct = me ? Math.min(100, (me.c / CFG.CHARGE_MAX) * 100) : 0;
    this.el.chargeBar.style.width = pct + "%";
    if (this.el.hazardWarning) {
      const hazardTime = me?.hz || 0;
      this.el.hazardWarning.classList.toggle("hidden", hazardTime <= 0);
      this.el.hazardWarning.textContent = hazardTime > 0 ? `HAZARD ${hazardTime.toFixed(1)}s` : "";
    }

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
