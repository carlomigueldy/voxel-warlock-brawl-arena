// ACCOUNT sub-screen — port of index.html #screen-account / ui.js's
// `_renderAuthTabs`/`_renderAuthForm`/`_renderUpgradeForm`/`renderAuthState`
// (design §0 parity contract; same auth intents `wireLegacyUiToStores`
// dispatches under `?ui=legacy` — this component calls the SAME src/auth.ts
// functions directly since nothing routes through the legacy `ui.on(...)`
// emitter here). Also hosts the spell/item slot hotkey pickers (orchestrator
// brief: guard.ui #7 "hotkeys configurable and persisted") — legacy only
// exposes rebinding via the ↻ icon on an in-game ability slot (HUD
// territory, #163), so this is an additive second entry point using the
// SAME `useSettingsStore.setSpellSlotHotkey`/`setItemSlotHotkey` writers,
// not a new intent.
import { useState, type FormEvent } from "react";
import { CFG } from "../../../config.js";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { useUiStore } from "../../../store/useUiStore";
import {
  getUser,
  signUpEmail,
  signInEmail,
  signInWithEthereum,
  signInWithSolana,
  signInAsGuest,
  upgradeGuest,
  signOut,
} from "../../../auth.js";
import { Button } from "../../common";
import styles from "../menu.module.css";

function errMessage(err: unknown): string {
  return (err as { message?: string })?.message || String(err);
}

type AuthTab = "signin" | "signup" | "guest";

function AuthField({ name, label, type }: { name: string; label: string; type: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={`auth-${name}`}>
        {label}
      </label>
      <div className={styles.runeField}>
        <input id={`auth-${name}`} name={name} type={type} autoComplete={type === "password" ? "current-password" : name === "email" ? "email" : "username"} />
      </div>
    </div>
  );
}

function readField(form: HTMLFormElement, name: string): string {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.value?.trim() ?? "";
}

function AuthTabs() {
  const [tab, setTab] = useState<AuthTab>("signin");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    try {
      if (tab === "guest") {
        await signInAsGuest();
      } else if (tab === "signup") {
        await signUpEmail({ email: readField(form, "email"), password: readField(form, "password"), username: readField(form, "username") });
      } else {
        await signInEmail({ email: readField(form, "email"), password: readField(form, "password") });
      }
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      setError((tab === "signup" ? "Sign up failed: " : tab === "guest" ? "Guest sign-in failed: " : "Sign in failed: ") + errMessage(err));
    }
  }

  async function walletSignIn(kind: "eth" | "sol") {
    setError(null);
    try {
      await (kind === "eth" ? signInWithEthereum() : signInWithSolana());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      setError((kind === "eth" ? "Ethereum sign-in failed: " : "Solana sign-in failed: ") + errMessage(err));
    }
  }

  return (
    <div className={styles.authForm} id="auth-form">
      <div className={styles.authTabs}>
        {([
          { mode: "signin", label: "Sign In" },
          { mode: "signup", label: "Sign Up" },
          { mode: "guest", label: "Play as Guest" },
        ] as const).map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            className={[styles.authTabBtn, tab === mode && styles.authTabBtnActive].filter(Boolean).join(" ")}
            aria-pressed={tab === mode}
            onClick={() => {
              setTab(mode);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form className={styles.authFields} onSubmit={onSubmit}>
        {tab === "guest" ? (
          <Button type="submit" variant="forge" className={styles.btnHero}>
            Play as Guest
          </Button>
        ) : (
          <>
            <AuthField name="email" label="Email" type="email" />
            {tab === "signup" && <AuthField name="username" label="Username" type="text" />}
            <AuthField name="password" label="Password" type="password" />
            <Button type="submit" variant="forge" className={styles.btnHero}>
              {tab === "signup" ? "Create Account" : "Sign In"}
            </Button>
            <p className={styles.authWalletDivider}>or connect a wallet</p>
            <Button variant="ghost" onClick={() => walletSignIn("eth")}>
              Sign in with Ethereum
            </Button>
            <Button variant="ghost" onClick={() => walletSignIn("sol")}>
              Sign in with Solana
            </Button>
          </>
        )}
        {error && (
          <p className={styles.authError} role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function UpgradeForm() {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    try {
      await upgradeGuest({ email: readField(form, "email"), password: readField(form, "password"), username: readField(form, "username") });
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      setError("Upgrade failed: " + errMessage(err));
    }
  }

  return (
    <form className={styles.authForm} id="auth-form" onSubmit={onSubmit}>
      <p className={styles.screenDesc} style={{ marginTop: 0 }}>
        Link an account to save your stats:
      </p>
      <AuthField name="email" label="Email" type="email" />
      <AuthField name="username" label="Username" type="text" />
      <AuthField name="password" label="Password" type="password" />
      <Button type="submit" variant="forge">
        Upgrade Account
      </Button>
      {error && (
        <p className={styles.authError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Click-to-rebind hotkey chip — mirrors ui.js's `.hotkey-picker` (`↻` ->
 * listen for the next keydown -> normalize -> persist) but targets
 * `useSettingsStore` directly instead of the legacy DOM ability bar. */
function HotkeyPicker({ current, onPick, ariaLabel }: { current: string; onPick: (key: string) => void; ariaLabel: string }) {
  const [listening, setListening] = useState(false);

  function startListening() {
    setListening(true);
    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault();
      window.removeEventListener("keydown", onKeydown, true);
      setListening(false);
      const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : null;
      if (key) onPick(key);
    };
    window.addEventListener("keydown", onKeydown, { capture: true, once: true });
  }

  return (
    <button
      type="button"
      className={[styles.hotkeyPicker, listening && styles.hotkeyPickerListening].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      onClick={startListening}
    >
      {listening ? "…" : current}
    </button>
  );
}

function HotkeySettings() {
  const spellSlotHotkeys = useSettingsStore((s) => s.spellSlotHotkeys);
  const itemSlotHotkeys = useSettingsStore((s) => s.itemSlotHotkeys);
  const setSpellSlotHotkey = useSettingsStore((s) => s.setSpellSlotHotkey);
  const setItemSlotHotkey = useSettingsStore((s) => s.setItemSlotHotkey);

  return (
    <div className={styles.hotkeySection}>
      <span className={styles.fieldLabel}>Spell hotkeys</span>
      <div className={styles.hotkeyGrid}>
        {Array.from({ length: CFG.SPELL_SLOT_COUNT }, (_, i) => (
          <div className={styles.hotkeyRow} key={i}>
            <span className={styles.hotkeyLabel}>Slot {i + 1}</span>
            <HotkeyPicker
              current={spellSlotHotkeys[i] || CFG.DEFAULT_SPELL_SLOT_HOTKEYS[i]}
              ariaLabel={`Rebind spell slot ${i + 1} hotkey`}
              onPick={(key) => setSpellSlotHotkey(i, key)}
            />
          </div>
        ))}
      </div>
      <span className={styles.fieldLabel}>Item hotkeys</span>
      <div className={styles.hotkeyGrid}>
        {Array.from({ length: CFG.ITEM_SLOT_COUNT }, (_, i) => (
          <div className={styles.hotkeyRow} key={i}>
            <span className={styles.hotkeyLabel}>Slot {i + 1}</span>
            <HotkeyPicker
              current={itemSlotHotkeys[i] || CFG.DEFAULT_ITEM_SLOT_HOTKEYS[i]}
              ariaLabel={`Rebind item slot ${i + 1} hotkey`}
              onPick={(key) => setItemSlotHotkey(i, key)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountScreen() {
  const onlineEnabled = useUiStore((s) => s.onlineEnabled);
  const authView = useUiStore((s) => s.authView);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);

  return (
    <div className={styles.screen} id="screen-account" role="region" aria-label="Account">
      <h2 className={styles.screenTitle}>ACCOUNT</h2>

      {!onlineEnabled && (
        <div className={styles.supabaseNotice} role="alert">
          <span className={styles.supabaseNoticeIcon} aria-hidden="true">
            ⚠
          </span>
          <p>Connect a Supabase project to enable accounts &amp; persistent stats.</p>
        </div>
      )}

      {onlineEnabled && authView && (
        <div className={styles.identityBadge} id="identity-badge" aria-live="polite">
          <span className={styles.identityIcon} aria-hidden="true">
            {authView.isGuest ? "◎" : "◉"}
          </span>
          <span className={styles.identityInfo}>{authView.isGuest ? "Playing as Guest" : authView.username || authView.email || "Signed In"}</span>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await signOut();
              } finally {
                useUiStore.getState().setAuthView(null);
              }
            }}
          >
            Sign Out
          </Button>
        </div>
      )}

      {onlineEnabled && (authView?.isGuest ? <UpgradeForm /> : !authView ? <AuthTabs /> : null)}

      <HotkeySettings />

      <Button variant="ghost" id="btn-replay-intro" onClick={() => setOnboarded(false)}>
        Replay Intro
      </Button>
    </div>
  );
}
