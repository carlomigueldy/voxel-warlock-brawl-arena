// All DOM/UI wiring: menus, lobby, HUD, room code, invite link, QR code.
// QRCode is loaded globally from a <script> tag (window.QRCode).
import { CFG, SPELLS, SPELL_ORDER, SPELL_TEMPLATES, ITEMS, getArenaHazard } from "./config.js";
import { spellIconSvg } from "./spell-icons.js";

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
      hpBar: $("hp-bar"), hpText: $("hp-text"),
      hazardWarning: $("hazard-warning"),
      centerMsg: $("center-msg"), touch: $("touch-controls"),
      abilityBar: $("ability-bar"),
      itemBar: $("item-bar"),
      castWrap: $("cast-wrap"), castBar: $("cast-bar"), castLabel: $("cast-label"),
      statusIcons: $("status-icons"),
      btnSfx: $("btn-sfx"), btnMusic: $("btn-music"),
      // Custom control shells (native inputs above remain the source of truth).
      mobsToggleUi: $("mobs-toggle-ui"),
      mobsToggle: $("mobs-toggle"),
      landSizeUi: $("land-size-ui"),
      arenaWorldUi: $("arena-world-ui"),
      botCountUi: $("bot-count-ui"), botCountValue: $("bot-count-value"),
      botSkillUi: $("bot-skill-ui"),
      mapObjectsUi: $("map-objects-ui"),
      // Online / matchmaking elements.
      btnQuickMatch: $("btn-quick-match"),
      btnCancelQueue: $("btn-cancel-queue"),
      onlineQueueStatus: $("online-queue-status"),
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
      // Tutorial
      tutSpellbookList: $("tut-spellbook-list"),
      btnPractice: $("btn-practice"),
      // ESC pause menu
      pauseMenu: $("pause-menu"), pauseResume: $("pause-resume"),
      pauseSfx: $("pause-sfx"), pauseMusic: $("pause-music"),
      pauseHelp: $("pause-help"), pauseControls: $("pause-controls"),
      pauseLeave: $("pause-leave"),
      // Big-mob incoming announcement banner.
      mobBanner: $("mob-banner"),
      // Step 6: spell draft overlay elements.
      spellDraft: $("spell-draft"),
      draftTimer: $("draft-timer"),
      draftTemplates: $("draft-templates"),
      draftSlots: $("draft-slots"),
      draftGrid: $("draft-grid"),
      draftReady: $("draft-ready"),
    };
    this.handlers = {};
    this.audio = null;
    this._paused = false;
    this._mobBannerTimer = null;
    this._lastHandledSnapTime = null;
    this._abilityEls = null;
    this._draftBuilt = false;         // tracks whether the draft overlay grid has been rendered
    this._draftKeyBound = false;      // Escape + Tab trap listener attached once per element lifetime
    this._draftPreviousFocus = null;  // element to restore focus to when the overlay closes
    this.spellSlotHotkeys = [...CFG.DEFAULT_SPELL_SLOT_HOTKEYS];
    this.preview = null;
    this.selectedCharacter = this._initialCharacter();
    this._menuScreen = "online";
    this._onlineEnabled = false;
    this._onlineQueueStatus = "";
    this._lbMetric = "wins";
    this._lbScope = "global";
    this._populateArenaControls();
    this._buildCustomControls();
    this._buildCharacterCards();
    this._spawnEmbers();
    this._bind();
    this._bindNavSpine();
    this._bindTutorialTabs();
    this._buildTutorialSpellbook();
    this._prefillFromUrl();
    this._maybeShowTouch();
  }

  // ---- Custom (non-native) menu controls ----------------------------------
  _buildCustomControls() {
    this._buildMobsToggle();
    this._buildArenaCards();
    this._buildLandSizeSegmented();
    this._buildBotControls();
    this._buildMapObjectsToggles();
    this._buildRegionSelector();
    this._buildLeaderboardControls();
    this._initAuthForm();
  }

  _buildMobsToggle() {
    const btn = this.el.mobsToggleUi;
    const native = this.el.mobsToggle;
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
    if (this.el.btnCancelQueue) this.el.btnCancelQueue.disabled = true;
    if (this.el.regionSelect)   this.el.regionSelect.disabled   = !enabled;
    // Auth form: hidden when not enabled.
    if (this.el.authForm)      this.el.authForm.classList.toggle("hidden", !enabled);
    if (this.el.identityBadge) this.el.identityBadge.classList.toggle("hidden", true);
    this.setOnlineQueueState({
      searching: false,
      status: enabled ? "Search your home region first. We widen the queue automatically." : "Online queue unavailable without Supabase.",
      canCancel: false,
    });
  }

  setOnlineQueueState({ searching = false, status, canCancel = false } = {}) {
    if (typeof status === "string") {
      this._onlineQueueStatus = status;
    }
    if (this.el.onlineQueueStatus) {
      this.el.onlineQueueStatus.textContent = this._onlineQueueStatus;
    }
    if (this.el.btnQuickMatch) {
      this.el.btnQuickMatch.classList.toggle("hidden", searching);
      this.el.btnQuickMatch.disabled = !this._onlineEnabled || searching;
    }
    if (this.el.btnCancelQueue) {
      const showCancel = searching && canCancel;
      this.el.btnCancelQueue.classList.toggle("hidden", !showCancel);
      this.el.btnCancelQueue.disabled = !showCancel;
    }
  }

  // ---- Render helpers -------------------------------------------------------

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

  /** Public name accessor — used by main.js for quick-match and room-code flows. */
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
    this._sfxOff = false;
    this._musicOff = false;
    const bindToggle = (btn, fn) => { if (btn) btn.onclick = fn; };
    bindToggle(this.el.btnSfx, () => this._toggleSfx());
    bindToggle(this.el.pauseSfx, () => this._toggleSfx());
    bindToggle(this.el.btnMusic, () => this._toggleMusic());
    bindToggle(this.el.pauseMusic, () => this._toggleMusic());
    this._syncAudioButtons();
  }

  // SFX/Music toggles are shared by the HUD controls and the pause menu, so
  // both button pairs always reflect the same AudioEngine state.
  _toggleSfx() {
    this._sfxOff = !this._sfxOff;
    this.audio?.setEnabled(!this._sfxOff);
    this._syncAudioButtons();
  }

  _toggleMusic() {
    this._musicOff = !this._musicOff;
    this.audio?.setMusic(!this._musicOff);
    this._syncAudioButtons();
  }

  _syncAudioButtons() {
    const sfxLabel = this._sfxOff ? "SFX: Off" : "SFX: On";
    const musicLabel = this._musicOff ? "Music: Off" : "Music: On";
    for (const b of [this.el.btnSfx, this.el.pauseSfx]) {
      if (b) { b.classList.toggle("off", this._sfxOff); b.textContent = sfxLabel; }
    }
    for (const b of [this.el.btnMusic, this.el.pauseMusic]) {
      if (b) { b.classList.toggle("off", this._musicOff); b.textContent = musicLabel; }
    }
  }

  setSpellSlotHotkeys(keys = CFG.DEFAULT_SPELL_SLOT_HOTKEYS) {
    this.spellSlotHotkeys = CFG.DEFAULT_SPELL_SLOT_HOTKEYS.map((fallback, i) => keys[i] || fallback);
    this._buildAbilityBar(true);
  }

  setItemSlotHotkeys(keys = CFG.DEFAULT_ITEM_SLOT_HOTKEYS) {
    this.itemSlotHotkeys = CFG.DEFAULT_ITEM_SLOT_HOTKEYS.map((fallback, i) => keys[i] || fallback);
    this._buildItemBar(true);
  }

  _buildItemBar(force = false) {
    if (!this.el.itemBar) return;
    if (!force && this._itemEls) return;
    this._itemEls = {};
    this.el.itemBar.replaceChildren();
    for (let i = 0; i < CFG.ITEM_SLOT_COUNT; i++) this._buildItemSlot(i);
  }

  _buildItemSlot(index) {
    if (!this.itemSlotHotkeys) this.itemSlotHotkeys = CFG.DEFAULT_ITEM_SLOT_HOTKEYS.slice();
    const key = this.itemSlotHotkeys[index] || CFG.DEFAULT_ITEM_SLOT_HOTKEYS[index];
    // Passive slots show no hotkey in the label; active slots show the bound key.
    const slot = this._slotShell(`Item slot ${index + 1}`, null, "Empty", 0x444444);
    slot.el.dataset.itemSlot = String(index);
    slot.el.classList.add("empty");
    this.el.itemBar.appendChild(slot.el);
    this._itemEls[index] = { slot: slot.el, cd: slot.cd, nm: slot.nm, swatch: slot.swatch, key };
  }

  updateItemBar(snapshot, localId) {
    if (!this.el.itemBar) return;
    this._buildItemBar(false);
    if (!this._itemEls) return;
    const me = snapshot.players.find((p) => p.id === localId);
    const equippedKeys = me?.items || [];
    const cds = me?.cds || {};
    for (let i = 0; i < CFG.ITEM_SLOT_COUNT; i++) {
      const elSet = this._itemEls[i];
      if (!elSet) continue;
      const { slot, cd, nm, swatch } = elSet;
      const key = equippedKeys[i];
      const it = key ? ITEMS[key] : null;
      const empty = !it;
      slot.dataset.itemKey = empty ? "" : key;
      nm.textContent = empty ? "Empty" : it.name;
      swatch.style.background = "#" + ((empty ? 0x444444 : it.color).toString(16).padStart(6, "0"));
      // Active items show cooldown overlay using the granted spell's cooldown.
      if (!empty && it.kind === "active" && it.grantsSpell) {
        const remain = cds[it.grantsSpell] || 0;
        const total = SPELLS[it.grantsSpell]?.cd || 1;
        cd.style.height = Math.max(0, Math.min(100, (remain / total) * 100)) + "%";
      } else {
        cd.style.height = "0%";
      }
      slot.classList.toggle("empty", empty);
      slot.classList.toggle("ready", !empty && (it.kind !== "active" || (cds[it.grantsSpell] || 0) <= 0));
    }
  }

  // Build the ability bar once, then refresh cooldown overlays each frame.
  // Always builds the strict 6-slot layout (spellbook path removed in Step 5).
  _buildAbilityBar(force = false) {
    if (!this.el.abilityBar) return;
    if (force) this._abilityEls = null;
    if (this._abilityEls) return;
    this._abilityEls = {};
    this.el.abilityBar.replaceChildren();
    for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) this._buildSpellSlot(i);
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
    swatch.innerHTML = spellIconSvg("");
    swatch.style.color = "#" + (color.toString(16).padStart(6, "0"));
    swatch.style.background = "transparent";
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
    this._buildAbilityBar(false);
    if (!this._abilityEls) return;
    const cds = me?.cds || {};
    const spellSlots = Array.isArray(me?.spellSlots) ? me.spellSlots : [];
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
      swatch.innerHTML = spellIconSvg(empty ? "" : id);
      swatch.style.color = "#" + ((empty ? 0x444466 : (SPELLS[id].color || 0x8888ff)).toString(16).padStart(6, "0"));
      swatch.style.background = "transparent";
      cd.style.height = empty ? "100%" : pct + "%";
      slot.classList.toggle("empty", empty);
      slot.classList.toggle("locked", empty);
      slot.classList.toggle("ready", !empty && remain <= 0);
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
    // Private Host — fires hostPrivate event.
    if (this.el.btnHost) {
      this.el.btnHost.onclick = () => {
        const name = this._name();
        if (!name) return this.setMenuStatus("Enter a name first.");
        this.handlers.hostPrivate?.(name, {
          mobsEnabled: this.mobsEnabled(),
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
    if (this.el.btnCancelQueue) {
      this.el.btnCancelQueue.onclick = () => this.handlers.cancelQueue?.();
    }

    // Private Join — fires joinByCode event.
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

    // ESC pause menu buttons.
    if (this.el.pauseResume) this.el.pauseResume.onclick = () => { this.hidePause(); this.handlers.resume?.(); };
    if (this.el.pauseLeave) this.el.pauseLeave.onclick = () => this.handlers.leaveMatch?.();
    if (this.el.pauseHelp) this.el.pauseHelp.onclick = () => this._togglePauseControls();
  }

  _tryJoin() {
    const name = this._name();
    const code = this.el.joinCode?.value.trim().toUpperCase() || "";
    if (!name) return this.setMenuStatus("Enter a name first.");
    if (code.length < 4) return this.setMenuStatus("Enter a valid room code.");
    this.handlers.joinByCode?.(name, code, this.selectedCharacter);
  }

  _name() { return this.el.nameInput?.value.trim().slice(0, 14) || ""; }

  mobsEnabled() { return this.el.mobsToggle?.checked !== false; }

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
      // Navigate to private screen so the join field is visible.
      this._showMenuScreen("private");
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
   * Valid names: "online" | "private" | "characters" | "settings" | "leaderboards" | "account"
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
    this.hidePause();
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
    this._buildItemBar();
    if (this.el.itemBar) this.el.itemBar.classList.remove("hidden");
    if (this._touchEnabled && this.el.touch) this.el.touch.classList.remove("hidden");
  }

  // ---- ESC pause menu ----
  showPause() {
    if (!this.el.pauseMenu) return;
    this.el.pauseMenu.classList.remove("hidden");
    this._paused = true;
  }

  hidePause() {
    if (this.el.pauseMenu) this.el.pauseMenu.classList.add("hidden");
    if (this.el.pauseControls) this.el.pauseControls.classList.add("hidden");
    this._paused = false;
  }

  // ---- Step 6: Spell Draft overlay ----

  /**
   * Show (and lazily build) the spell draft overlay.
   * Called every frame from updateHUD when phase === "spellSelection".
   * onAction: fn({action, spell?, template?}) — routed to sim or net by the caller.
   */
  showSpellDraft(snapshot, localId, onAction) {
    const overlay = this.el.spellDraft;
    if (!overlay) return;
    if (!this._draftBuilt) {
      this._buildDraftOverlay(onAction);
      this._draftBuilt = true;
      overlay.classList.remove("hidden");
      // Accessibility: save the previously-focused element so we can restore it
      // when the overlay closes, then move focus into the dialog.
      this._draftPreviousFocus = document.activeElement;
      const firstBtn = overlay.querySelector("button:not([disabled])");
      if (firstBtn) firstBtn.focus();
    }
    this._refreshDraftOverlay(snapshot, localId);
  }

  /** Hide the draft overlay and mark it for rebuild next time (new match). */
  hideSpellDraft() {
    if (!this.el.spellDraft) return;
    this.el.spellDraft.classList.add("hidden");
    this._draftBuilt = false;
    // Restore keyboard focus to wherever it was before the overlay opened.
    if (this._draftPreviousFocus) {
      this._draftPreviousFocus.focus();
      this._draftPreviousFocus = null;
    }
  }

  /** Build the static skeleton of the draft overlay once per match. */
  _buildDraftOverlay(onAction) {
    // ---- Template quick-pick buttons ----
    const tplWrap = this.el.draftTemplates;
    if (tplWrap) {
      tplWrap.replaceChildren();
      SPELL_TEMPLATES.forEach((tpl, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "draft-tpl-btn";
        btn.setAttribute("aria-label", `${tpl.name} template — ${tpl.desc}`);
        const nameSpan = document.createElement("span");
        nameSpan.className = "draft-tpl-name";
        nameSpan.textContent = tpl.name;
        const descSpan = document.createElement("span");
        descSpan.className = "draft-tpl-desc";
        descSpan.textContent = tpl.desc;
        btn.append(nameSpan, descSpan);
        btn.addEventListener("click", () => onAction?.({ action: "template", template: i }));
        tplWrap.appendChild(btn);
      });
    }

    // ---- Slot indicators (6 empty slots) ----
    const slotsWrap = this.el.draftSlots;
    if (slotsWrap) {
      slotsWrap.replaceChildren();
      for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) {
        const s = document.createElement("div");
        s.className = "draft-slot-pip";
        s.setAttribute("aria-hidden", "true");
        s.dataset.draftSlot = String(i);
        slotsWrap.appendChild(s);
      }
    }

    // ---- Spell grid (all spells except fireball) ----
    const grid = this.el.draftGrid;
    if (grid) {
      grid.replaceChildren();
      // Use SPELL_ORDER but skip fireball (always-on free basic).
      for (const id of SPELL_ORDER) {
        if (id === "fireball") continue;
        const s = SPELLS[id];
        if (!s) continue;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "draft-spell-card";
        card.role = "option";
        card.setAttribute("aria-selected", "false");
        card.dataset.spell = id;
        card.setAttribute("aria-label", `${s.name} — ${s.desc}`);
        const swatch = document.createElement("span");
        swatch.className = "dsc-swatch";
        swatch.innerHTML = spellIconSvg(id);
        swatch.style.color = hex(s.color || 0x6c4cff);
        swatch.style.background = "transparent";
        const nm = document.createElement("span");
        nm.className = "dsc-name";
        nm.textContent = s.name;
        const cd = document.createElement("span");
        cd.className = "dsc-cd";
        cd.textContent = s.cd + "s";
        const desc = document.createElement("span");
        desc.className = "dsc-desc";
        desc.textContent = s.desc;
        card.append(swatch, nm, cd, desc);
        card.addEventListener("click", () => onAction?.({ action: "toggle", spell: id }));
        grid.appendChild(card);
      }
    }

    // ---- Ready button ----
    const readyBtn = this.el.draftReady;
    if (readyBtn) {
      // Remove any previous listener by cloning (avoids duplicate listeners on rebuild).
      const fresh = readyBtn.cloneNode(true);
      readyBtn.replaceWith(fresh);
      this.el.draftReady = fresh;
      fresh.addEventListener("click", () => onAction?.({ action: "ready" }));
    }

    // ---- Keyboard handlers (attached once per overlay element lifetime) ----
    // Escape clears picks; Tab is trapped inside the dialog; both prevent the
    // global Escape handler in main.js from also opening the pause menu.
    const overlay = this.el.spellDraft;
    if (overlay && !this._draftKeyBound) {
      this._draftKeyBound = true;
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onAction?.({ action: "clear" });
          return;
        }
        // Basic focus trap: cycle Tab within the visible overlay.
        if (e.key === "Tab") {
          const focusable = [
            ...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]'),
          ];
          if (focusable.length < 2) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
          } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
      }, { capture: true });
    }
  }

  /** Refresh timer, slot pips, card highlights, and ready state each frame. */
  _refreshDraftOverlay(snapshot, localId) {
    if (!snapshot) return;
    // Timer.
    if (this.el.draftTimer) {
      this.el.draftTimer.textContent = Math.ceil(Math.max(0, snapshot.timer));
      const urgent = snapshot.timer < 8;
      this.el.draftTimer.classList.toggle("draft-timer-urgent", urgent);
    }

    const me = snapshot.players?.find((p) => p.id === localId);
    if (!me) return;

    const picks = me.draftPick || [];
    const isReady = !!me.draftReady;

    // Slot pips: show picked spell names.
    const slotsWrap = this.el.draftSlots;
    if (slotsWrap) {
      const pips = slotsWrap.querySelectorAll(".draft-slot-pip");
      pips.forEach((pip, i) => {
        const id = picks[i];
        const s = id ? SPELLS[id] : null;
        pip.textContent = s ? s.name : "";
        pip.classList.toggle("draft-slot-filled", !!s);
        if (s) pip.style.setProperty("--swatch", hex(s.color || 0x6c4cff));
        else pip.style.removeProperty("--swatch");
      });
    }

    // Spell cards: highlight selected, dim over-cap, disable when ready.
    const grid = this.el.draftGrid;
    if (grid) {
      const atCap = picks.length >= CFG.SPELL_SLOT_COUNT;
      grid.querySelectorAll(".draft-spell-card").forEach((card) => {
        const id = card.dataset.spell;
        const selected = picks.includes(id);
        card.classList.toggle("is-selected", selected);
        card.setAttribute("aria-selected", String(selected));
        card.classList.toggle("at-cap", !selected && atCap);
        card.disabled = isReady;
      });
    }

    // Template buttons: disable when ready.
    if (this.el.draftTemplates) {
      this.el.draftTemplates.querySelectorAll(".draft-tpl-btn").forEach((btn) => {
        btn.disabled = isReady;
      });
    }

    // Ready button: reflect committed state.
    if (this.el.draftReady) {
      this.el.draftReady.disabled = isReady;
      this.el.draftReady.classList.toggle("is-ready", isReady);
      this.el.draftReady.querySelector(".btn-label").textContent = isReady ? "Locked In" : "Ready";
    }
  }

  /** Toggle the pause overlay; returns the new paused (visible) state. */
  togglePause() {
    if (this._paused) { this.hidePause(); return false; }
    this._buildControlsPanel();
    this.showPause();
    return true;
  }

  _togglePauseControls() {
    if (!this.el.pauseControls) return;
    this._buildControlsPanel();
    this.el.pauseControls.classList.toggle("hidden");
  }

  /** Render the keybind reference from the live spellbook + slot hotkeys. */
  _buildControlsPanel() {
    const el = this.el.pauseControls;
    if (!el) return;
    const rows = [
      ["Move", "W A S D / Arrow keys"],
      ["Aim", "Mouse"],
      ["Fire", "Space / Left-click"],
      ["Cast selected", "Right-click"],
    ];
    // Customizable ability-slot hotkeys (reflect any player remaps).
    const slotKeys = this.spellSlotHotkeys || CFG.DEFAULT_SPELL_SLOT_HOTKEYS;
    slotKeys.forEach((key, i) => {
      rows.push([`Ability slot ${i + 1}`, String(key).toUpperCase()]);
    });
    // Default spell-cast keybinds straight from the spellbook definition.
    for (const id of SPELL_ORDER) {
      const s = SPELLS[id];
      if (s?.key) rows.push([s.name, String(s.key).toUpperCase()]);
    }
    el.innerHTML = rows
      .map(([k, v]) => `<div class="pause-control-row"><span>${escapeHTML(k)}</span><kbd>${escapeHTML(v)}</kbd></div>`)
      .join("");
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
    // Step 6: spell draft overlay — show when drafting, hide otherwise.
    if (snapshot.phase === "spellSelection") {
      this.showSpellDraft(snapshot, localId, (action) => this.handlers.draft?.(action));
    } else {
      this.hideSpellDraft();
    }

    const phaseLabel = {
      spellSelection: "Spell Draft",
      countdown: "Get Ready", playing: "Brawl!",
      roundEnd: "Round Over", matchEnd: "Match Over", lobby: "",
    }[snapshot.phase] || "";
    this.el.roundInfo.textContent = `Round ${snapshot.round} — ${phaseLabel}`;

    if (snapshot.phase === "countdown") {
      this.el.timer.textContent = Math.ceil(snapshot.timer) + "";
    } else if (snapshot.phase === "spellSelection") {
      this.el.timer.textContent = Math.ceil(Math.max(0, snapshot.timer)) + "s";
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
    if (this.el.hpBar && me) {
      const hpPct = me.mhp ? Math.max(0, Math.min(100, (me.hp / me.mhp) * 100)) : 0;
      this.el.hpBar.style.width = hpPct + "%";
      if (this.el.hpText) this.el.hpText.textContent = `${Math.ceil(me.hp ?? 0)}/${me.mhp ?? 0}`;
    }
    if (this.el.hazardWarning) {
      const hazardTime = me?.hz || 0;
      this.el.hazardWarning.classList.toggle("hidden", hazardTime <= 0);
      this.el.hazardWarning.textContent = hazardTime > 0 ? `HAZARD ${hazardTime.toFixed(1)}s` : "";
    }

    // Step-3: cast/channel progress bar
    if (this.el.castWrap) {
      const ca = me?.ca;
      this.el.castWrap.classList.toggle("hidden", !ca);
      if (ca) {
        this.el.castBar.style.width = Math.round(ca.p * 100) + "%";
        this.el.castWrap.classList.toggle("channeling", ca.c === 1);
        this.el.castWrap.classList.toggle("casting", ca.c === 0);
        this.el.castLabel.textContent = (SPELLS[ca.s]?.name || "") + (ca.c ? " (channeling)" : " (casting)");
      }
    }
    // Step-3: status-effect icons
    if (this.el.statusIcons && me) {
      const defs = [
        ["sl", "Slow", "#66ccff"], ["bu", "Burn", "#ff7a2e"], ["cu", "Curse", "#9c2bff"],
        ["st", "Stun", "#ffe14c"], ["iv", "Invis", "#88aacc"], ["hs", "Haste", "#ffd23c"],
      ];
      this.el.statusIcons.replaceChildren();
      for (const [k, label, col] of defs) {
        const on = k === "st" ? (me.st > 0) : (me[k] === 1);
        if (!on) continue;
        const chip = document.createElement("span");
        chip.className = "status-chip";
        chip.style.background = col;
        chip.title = label;
        chip.textContent = label[0];
        this.el.statusIcons.appendChild(chip);
      }
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
      // spellSelection and playing both suppress the center overlay.
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

  // ---- Tutorial tab switching -----------------------------------------------

  /** Switch to one of the five tutorial tabs ("basics"|"goal"|"controls"|"spellbook"|"tips"). */
  _showTutorialTab(name) {
    this.el.menu.querySelectorAll(".tut-panel").forEach((panel) => {
      const on = panel.id === `tut-${name}`;
      panel.classList.toggle("tut-panel-hidden", !on);
      panel.setAttribute("aria-hidden", on ? "false" : "true");
    });
    this.el.menu.querySelectorAll(".tut-tab").forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      // Roving tabindex: only the active tab is a tab stop (WAI-ARIA tabs pattern).
      tab.tabIndex = on ? 0 : -1;
    });
  }

  /** Wire tutorial tab buttons and the practice CTA. Called once from the constructor. */
  _bindTutorialTabs() {
    const tabs = [...this.el.menu.querySelectorAll(".tut-tab")];
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => this._showTutorialTab(tab.dataset.tab));
      // Arrow / Home / End move focus across the tablist (WAI-ARIA tabs pattern).
      tab.addEventListener("keydown", (e) => {
        let next = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        this._showTutorialTab(tabs[next].dataset.tab);
        tabs[next].focus();
      });
    });
    // Default to Basics.
    this._showTutorialTab("basics");

    // Practice vs Bot — mirrors the host flow but jumps straight to the game.
    if (this.el.btnPractice) {
      this.el.btnPractice.onclick = () => {
        const name = this._name() || "Warlock";
        this.handlers.practice?.(name, {
          character: this.selectedCharacter,
          ...this.getArenaSettings(),
        });
      };
    }
  }

  /**
   * Populate the spellbook panel from SPELL_ORDER + SPELLS (already imported).
   * Grouped into Projectiles / Mobility / Control & Utility.
   * Called once from the constructor so the list stays in sync with config.
   */
  _buildTutorialSpellbook() {
    const container = this.el.tutSpellbookList;
    if (!container) return;

    const groups = [
      { label: "Projectiles",       ids: SPELL_ORDER.slice(0, 8)  },
      { label: "Mobility",          ids: SPELL_ORDER.slice(8, 13) },
      { label: "Control / Utility", ids: SPELL_ORDER.slice(13)    },
    ];

    container.replaceChildren();

    for (const group of groups) {
      const section = document.createElement("div");
      section.className = "tut-spell-group";

      const heading = document.createElement("h3");
      heading.className = "tut-spell-group-title";
      heading.textContent = group.label;
      section.appendChild(heading);

      for (const id of group.ids) {
        const s = SPELLS[id];
        if (!s) continue;
        const colorHex = "#" + ((s.color || 0x8888ff) >>> 0).toString(16).padStart(6, "0").slice(-6);

        const row = document.createElement("div");
        row.className = "tut-spell-row";
        row.style.setProperty("--spell-color", colorHex);

        const swatch = document.createElement("span");
        swatch.className = "tut-spell-swatch";
        swatch.style.background = colorHex;
        swatch.setAttribute("aria-hidden", "true");

        const keyChip = document.createElement("span");
        keyChip.className = "tut-spell-key";
        keyChip.textContent = s.key;

        const info = document.createElement("div");
        info.className = "tut-spell-info";

        const name = document.createElement("span");
        name.className = "tut-spell-name";
        name.textContent = s.name;

        const cd = document.createElement("span");
        cd.className = "tut-spell-cd";
        cd.textContent = `CD ${s.cd}s`;

        const desc = document.createElement("span");
        desc.className = "tut-spell-desc";
        desc.textContent = s.desc || "";

        info.append(name, cd, desc);
        row.append(swatch, keyChip, info);
        section.appendChild(row);
      }

      container.appendChild(section);
    }
  }

  // ---- Big-mob incoming banner -------------------------------------------

  /**
   * Show the #mob-banner for the given mob type and entrance kind.
   * Any previously scheduled hide timer is cancelled so back-to-back mobs
   * always display a fresh banner rather than inheriting an old countdown.
   *
   * @param {string} mobType - e.g. "stoneGiant"
   * @param {string} kind    - entrance kind: "shatter" | "storm" | "summon" | "meteor"
   */
  showMobBanner(mobType, kind) {
    const el = this.el.mobBanner;
    if (!el) return;

    const COPY = {
      stoneGiant:     "⚠ STONE GIANT EMERGES",
      stormingVortex: "STORM INCOMING — STORMING VORTEX",
      giantDwarf:     "THE GROUND TREMBLES — GIANT DWARF",
      fireElemental:  "METEOR FALLING — FIRE ELEMENTAL",
    };

    // Cancel any in-flight hide.
    if (this._mobBannerTimer != null) {
      clearTimeout(this._mobBannerTimer);
      this._mobBannerTimer = null;
    }

    // Reset accent classes.
    el.classList.remove(
      "mob-banner--shatter",
      "mob-banner--storm",
      "mob-banner--summon",
      "mob-banner--meteor",
    );

    el.textContent = COPY[mobType] || mobType.toUpperCase();

    if (kind) el.classList.add(`mob-banner--${kind}`);

    // Force animation restart: toggling hidden re-triggers the CSS @keyframes
    // because going from display:none to display:block restarts animations.
    el.classList.remove("hidden");

    // Auto-hide slightly after the full entrance window.
    const hideAfterMs = Math.round((CFG.MOB_ENTRANCE + 0.6) * 1000);
    this._mobBannerTimer = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove(
        "mob-banner--shatter",
        "mob-banner--storm",
        "mob-banner--summon",
        "mob-banner--meteor",
      );
      this._mobBannerTimer = null;
    }, hideAfterMs);
  }

  /**
   * Iterate a snapshot's event list and trigger banner for each mobIncoming event.
   * Uses snapTime to avoid reprocessing the same snapshot on every render frame.
   *
   * @param {Array}  events   - snapshot.events array (may be undefined/null)
   * @param {number} snapTime - snapshot.t timestamp for deduplication
   */
  handleEvents(events, snapTime) {
    if (!Array.isArray(events) || events.length === 0) return;
    // Guard: only process each distinct snapshot once across render frames.
    if (snapTime != null && snapTime === this._lastHandledSnapTime) return;
    this._lastHandledSnapTime = snapTime;
    for (const ev of events) {
      if (ev.type === "mobIncoming") {
        this.showMobBanner(ev.mobType, ev.entrance);
      }
    }
  }
}
