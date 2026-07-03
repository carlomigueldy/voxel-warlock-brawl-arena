// The emitter<->store adapter (design §5.4). ui.js is a single-handler
// emitter (`on(event, fn)` — last registration wins, ui.js:739); this module
// registers the ~40 handlers main.js used to register at module scope,
// routed to store actions / the session hook's intents (via the module-level
// `gameSessionRef` published by useGameSession — see that file's header for
// why non-React code needs a ref instead of the hook's return value), plus
// the reverse direction (store -> ui.set*/render* on subscribe). Shrinks to
// nothing at P6 once ui.js is deleted.
import { PHASE } from "../sim.js";
import { snapshotRef } from "../store/snapshotRef";
import { useSessionStore } from "../store/useSessionStore";
import { useUiStore } from "../store/useUiStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { gameSessionRef } from "../loop/useGameSession";
import { getInput } from "../services/registry";
import { isEnabled } from "../supabase.js";
import {
  getUser,
  signUpEmail, signInEmail, signInWithEthereum, signInWithSolana, signInAsGuest, upgradeGuest, signOut,
} from "../auth.js";
import { setRegion as persistRegion } from "../region.js";
import { fetchLeaderboard } from "../leaderboard.js";

// UI/GameRenderer are still untyped legacy JS (P4/P5 convert them) — `any`
// here matches their actual inferred shape rather than fighting it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyUI = any;

export function wireLegacyUiToStores(ui: LegacyUI): () => void {
  const session = () => gameSessionRef.current;

  // ---- Host/match lifecycle -> useGameSession intents ----
  ui.on("hostPrivate", async (name: string, options: unknown) => session()?.hostPrivate(name, options as never));
  ui.on("quickMatch", () => session()?.quickMatch());
  ui.on("cancelQueue", async () => session()?.cancelQueue());
  ui.on("joinByCode", async (name: string, code: string, character: string | null) => session()?.join(name, code, character));
  ui.on("host", (name: string, options: unknown) => session()?.hostPrivate(name, options as never));
  ui.on("join", (name: string, code: string, character: string | null) => session()?.join(name, code, character));
  ui.on("practice", (name: string, options: unknown) => session()?.practice(name, options as never));
  ui.on("resume", () => session()?.resume());
  ui.on("leaveMatch", () => session()?.leaveMatch());

  // ---- Draft / practice panel / lobby config -> sim (host-local, via session hook) ----
  ui.on("draft", (action: unknown) => session()?.draft(action));
  ui.on("spawnDummy", (type: string) => session()?.spawnDummy(type));
  ui.on("clearDummies", () => session()?.clearDummies());
  ui.on("changeLoadout", (ids: string[]) => session()?.changeLoadout(ids));
  ui.on("toggleNoCooldown", (on: boolean) => session()?.toggleNoCooldown(on));
  ui.on("bots", () => session()?.bots());
  ui.on("configChange", () => session()?.configChange());
  // Port of main.js's ui.on("start", () => { applyBotSettings(); beginMatch(); }).
  ui.on("start", () => session()?.startMatch());

  // ---- Settings (spell/item hotkeys, PTT, selected spell) ----
  // useSettingsStore is the single writer of the persisted key (see that
  // file's header — it reimplements input.ts's normalize+write logic against
  // the same exported pure helpers/storage keys rather than delegating to a
  // live InputController instance, to keep the store importable/testable
  // without pulling in the renderer/ui/registry graph). This adapter is what
  // then mirrors the result into the runtime InputController + legacy DOM,
  // so there is still exactly one persistence writer per key.
  ui.on("selectSpell", (id: string) => getInput().setSelectedSpell(id));
  ui.on("spellSlotHotkey", (index: number, key: string) => {
    useSettingsStore.getState().setSpellSlotHotkey(index, key);
    const hotkeys = useSettingsStore.getState().spellSlotHotkeys;
    getInput().spellSlotHotkeys = hotkeys;
    ui.setSpellSlotHotkeys(hotkeys);
  });
  ui.on("itemSlotHotkey", (index: number, key: string) => {
    useSettingsStore.getState().setItemSlotHotkey(index, key);
    const hotkeys = useSettingsStore.getState().itemSlotHotkeys;
    getInput().itemSlotHotkeys = hotkeys;
    ui.setItemSlotHotkeys(hotkeys);
  });
  ui.on("pttKey", (code: string) => {
    if (useSettingsStore.getState().setPttKey(code)) getInput().pttKey = code;
  });

  // ---- Social (chat/mute/voice prefs) -> useGameSession intents ----
  ui.on("chatOpen", (open: boolean) => {
    const input = getInput();
    input.chatting = !!open;
    useUiStore.getState().setChatOpen(!!open);
    if (!open) {
      session()?.sendTyping(false);
      input.resetActivity();
    }
  });
  ui.on("chatSend", (text: string) => {
    if (text) session()?.sendChat(text);
    session()?.sendTyping(false);
  });
  ui.on("chatTyping", (typing: boolean) => session()?.sendTyping(typing));
  ui.on("toggleMute", (peerId: string) => session()?.toggleMute(peerId));
  ui.on("clearMutes", (peerIds: string[]) => session()?.clearMutes(peerIds || []));
  ui.on("socialPrefs", (prefs: { masterVolume?: number; micEnabled?: boolean }) => session()?.socialPrefs(prefs));
  ui.on("conductDismiss", () => {});

  // ---- Region / screen / leaderboard ----
  ui.on("regionChange", async (id: string) => {
    persistRegion(id);
    useSettingsStore.getState().setRegion(id);
  });
  ui.on("screenChange", async (name: string) => {
    if (name === "leaderboards" && isEnabled()) {
      fetchLeaderboard({ region: null, metric: "wins", limit: 20 })
        .then((rows) => {
          ui.renderLeaderboard(rows || [], { metric: "wins", scope: "global" });
          useUiStore.getState().setLeaderboard(rows || [], { metric: "wins", scope: "global" });
        })
        .catch(() => {});
    }
  });
  ui.on("leaderboardChange", async ({ metric, scope }: { metric: "wins" | "kd" | "roundWins" | "rating"; scope: "global" | "region" }) => {
    if (!isEnabled()) return;
    try {
      const region = scope === "region" ? useSettingsStore.getState().region : null;
      const rows = await fetchLeaderboard({ region, metric, limit: 20 });
      ui.renderLeaderboard(rows || [], { metric, scope });
      useUiStore.getState().setLeaderboard(rows || [], { metric, scope });
    } catch { /* non-fatal */ }
  });

  // ---- Auth ----
  ui.on("signUp", async ({ email, password, username }: { email: string; password: string; username: string }) => {
    try {
      await signUpEmail({ email, password, username });
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Sign up failed: " + errMessage(err));
    }
  });
  ui.on("signIn", async ({ email, password }: { email: string; password: string }) => {
    try {
      await signInEmail({ email, password });
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Sign in failed: " + errMessage(err));
    }
  });
  ui.on("ethSignIn", async () => {
    try {
      await signInWithEthereum();
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Ethereum sign-in failed: " + errMessage(err));
    }
  });
  ui.on("solSignIn", async () => {
    try {
      await signInWithSolana();
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Solana sign-in failed: " + errMessage(err));
    }
  });
  ui.on("guest", async () => {
    try {
      await signInAsGuest();
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Guest sign-in failed: " + errMessage(err));
    }
  });
  ui.on("upgrade", async ({ email, password, username }: { email: string; password: string; username: string }) => {
    try {
      await upgradeGuest({ email, password, username });
      ui.renderAuthState(getUser());
      useUiStore.getState().setAuthView(getUser());
    } catch (err) {
      ui.setMenuStatus("Upgrade failed: " + errMessage(err));
    }
  });
  ui.on("signOut", async () => {
    try {
      await signOut();
      ui.renderAuthState(null);
      useUiStore.getState().setAuthView(null);
    } catch { /* non-fatal */ }
  });

  // ---- Reverse: store -> ui (design §5.4) ----
  const unsubMenuStatus = useUiStore.subscribe((s, prev) => {
    if (s.menuStatus !== prev.menuStatus) ui.setMenuStatus(s.menuStatus);
  });
  const unsubLobbyStatus = useUiStore.subscribe((s, prev) => {
    if (s.lobbyStatus !== prev.lobbyStatus) ui.setLobbyStatus(s.lobbyStatus);
  });
  const unsubQueue = useUiStore.subscribe((s, prev) => {
    if (s.queue !== prev.queue) ui.setOnlineQueueState(s.queue);
  });
  const unsubAuth = useUiStore.subscribe((s, prev) => {
    if (s.authView !== prev.authView) ui.renderAuthState(s.authView);
  });

  // ---- ESC pause / Enter chat (main.js 840-866) ----
  const onKeydown = (e: KeyboardEvent) => {
    const snap = snapshotRef.current;
    const inGame = useSessionStore.getState().inGame;
    if (e.code === "Escape") {
      if (!inGame || !snap || snap.phase === PHASE.LOBBY || snap.phase === PHASE.SPELL_SELECTION) return;
      e.preventDefault();
      const paused = ui.togglePause();
      const input = getInput();
      input.paused = paused;
      useUiStore.getState().setPaused(paused);
      session()?.sendAfk(paused);
      if (!paused) input.resetActivity();
      return;
    }
    if (e.code === "Enter") {
      if (!inGame || !snap || snap.phase === PHASE.LOBBY || snap.phase === PHASE.SPELL_SELECTION) return;
      if (ui.isChatOpen() || getInput().paused || ui.isDialogOpen()) return;
      e.preventDefault();
      ui.openChat();
    }
  };
  addEventListener("keydown", onKeydown);

  return () => {
    unsubMenuStatus();
    unsubLobbyStatus();
    unsubQueue();
    unsubAuth();
    removeEventListener("keydown", onKeydown);
  };
}

function errMessage(err: unknown): string {
  return (err as { message?: string })?.message || String(err);
}
