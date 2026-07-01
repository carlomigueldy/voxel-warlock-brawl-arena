# Feature Gap Analysis — Voxel Warlock Brawl Arena

> Generated 2026-07-01 via a fan-out analysis workflow: 6 parallel Sonnet analysts
> (gameplay/balance, modes/content, multiplayer/infra, progression/retention,
> UX/accessibility/mobile, backlog reconciliation) → Opus synthesis. 40 raw findings
> deduped to 31 ranked gaps. Report-only; no code or backlog changes were made.
> Every finding cites source files — verify against the tree before actioning.

## Executive Summary

Voxel Warlock Brawl Arena is surface-complete — ~54 modules covering sim, rendering, netcode, auth, matchmaking, and a polished onboarding/HUD layer — but the gap analysis surfaces one structural contradiction and several systemic omissions that matter more than any missing feature. The single most important finding is that the **HP-death layer silently overrides the game's stated ring-out identity** (`player.js:574-583`), letting burst kits win damage races the design pillar says shouldn't exist. Beyond balance, the P2P layer is a **single point of failure with no host migration, no client reconnect, and STUN-only ICE** — any WiFi blip or NAT edge case ends or blocks a match with no recovery. Retention infrastructure is essentially absent (no XP/levels, no cosmetics, no friends/party, no seasons, cumulative-only leaderboard), and **mobile is not at desktop parity** because touch players cannot switch spells mid-match. Finally, the backlog mirror (`feature_list.json`) and the task brief's own framing are stale enough to mislead planning, so a documentation-reconciliation pass is a prerequisite to trustworthy autonomous work.

## Prioritized Gap Table

| Rank | Gap | Area | Severity | Effort | Evidence |
|------|-----|------|----------|--------|----------|
| 1 | HP damage kills outright, bypassing the knockback/ring-out design pillar | gameplay | P0 | M | `player.js:574-583` sets `alive=false` at `hp<=0` regardless of arena position; `CFG.PLAYER_HP_MAX=180` vs Meteor 66, Detonate ~48, Lightning 22, Arcane Bolt 24 |
| 2 | TURN relay missing — STUN-only ICE blocks symmetric-NAT/firewall players | infra | P0 | S | `net.js:38-47` lists only 2 STUN servers, no TURN/`turns:`, no ICE-failure detection in `_initPeer` (`net.js:220-227`) |
| 3 | `feature_list.json` badly stale — 2 of ~8 real epics tracked | backlog | P0 | S | 125-line file has only `ui-esc-pause-menu` + `feat-region-matchmaking`; merged epics (#48, #43, low-poly rebuild, fullscreen lobby, #54/#53/#55) have no entries |
| 4 | No host migration + no client reconnect — any host/network drop ends match | multiplayer | P0 | L | `main.js:470-474` `onClose`→`resetMatchState()`+`showMenu()`; `net.js:220-227` single `Peer.connect`, no retry; no re-election anywhere |
| 5 | Touch players cannot switch spells mid-match | mobile | P0 | M | `index.html:798-802` renders only joystick + single `#fire-btn`; `input.js:119` hardcodes `selectedSpell="fireball"`; `setSelectedSpell` has no touch-facing caller |
| 6 | No account progression — no XP, levels, or unlocks | progression | P0 | L | `auth.js:33-52` `mapUser` returns `{id,email,username,isGuest}`; `0001_init.sql` has no xp/level/unlock table |
| 7 | Zero cosmetics/skins — 4 characters permanently fixed | progression | P0 | L | `character.js` loads 4 hardcoded GLBs; no `skin`/`cosmetic`/`unlock` matches in `src/` or migrations |
| 8 | No diminishing returns / immunity window on chained CC | gameplay | P1 | M | `player.js:268` gates only on flat `status.disabled>0`; config CC durations stack additively with no DR tracking |
| 9 | Mob ability damage/knockback not scaled by player count (only HP is) | gameplay | P1 | S | `config.js:252-268` scales `MOB_HP_MIN_FACTOR` by count; `abilityDmg`/`abilityKb` (fissureSlam 22/34) are flat |
| 10 | No late-join / spectator mode | multiplayer | P1 | M | `net.js:88-113` `_onConn` has no phase check; `JOIN` handling `net.js:118-134` doesn't branch on match phase; no observer path |
| 11 | Matchmaking has no cancel/give-up/bot-fill escape hatch in sparse regions | multiplayer | P1 | M | `matchmaking.js:267-276` widens indefinitely; `selectPair:63-75` requires exactly `MATCH_SIZE`, no fallback; no timeout state to `onStatus` |
| 12 | No in-game settings for SFX/music/master volume or graphics quality | accessibility | P1 | M | `audio.js:28-30` hardcodes gains at 0.9; `ui.js:2724-2735` exposes only a voice-volume slider; no quality toggle |
| 13 | No practice tutorial — freeform dummy sandbox only | ux | P1 | M | `main.js:~123-264` practice spawns no mobs + a dummy panel; no scripted objective/prompt system for charge/ring-out/draft |
| 14 | No ranked/casual split — one undifferentiated pool | progression | P1 | M | `matchmaking.js` queues by region only; `leaderboard.js` `fetchLeaderboard` has no ranked/mode filter or MMR gating |
| 15 | No friends/party/invite system — social.js is a local mute list | retention | P1 | M | `social.js` (77 lines) is `isMuted`/`toggleMute` over localStorage `vwb-mute-list`; no friends table, no invite/party code |
| 16 | No FFA-only limit — no team/co-op mode | gameplay | P1 | L | `config.js` `MAX_PLAYERS:6` with no `team` field; grep for `team` gameplay logic returns zero |
| 17 | Leaderboard has no seasons/resets, friends filter, or self-rank lookup | progression | P1 | M | `leaderboard.js:59-75` supports only region+metric+limit over one cumulative view; no `season_id`, no "my rank" query |
| 18 | No client-facing match history / post-match stat recap | progression | P1 | M | `match_players` is write-only (service role); no client read query in `leaderboard.js` for a user's own history |
| 19 | No anti-cheat / host-trust validation — host self-reports ELO outcome | infra | P1 | L | `submit-match` + host `broadcast()`/STATE (`net.js:160-165`) carry no signature/replay-protection; modified host can fabricate results |
| 20 | Guest/ranked lobby identity is client-declared, not enforced | multiplayer | P2 | S | `net.js:232-238` sends `userId` freely; `_acceptsMatchmakingJoin:188-197` checks matchId/queueId only, never validates a Supabase session |
| 21 | ELO silently discarded when a guest/bot wins the match | progression | P2 | S | `leaderboard.js:18-23,30-31` skips submission when `hasWinner` is false, dropping authenticated losers' stats |
| 22 | Instant-cast hard-CC spells have no telegraph despite AoE/mob convention | gameplay | P2 | M | `config.js` SPELLS: disable/stun/target/pull/drain fire on lock with no `castTime`; mobs + AoE all use `castTime`+`telegraphR` |
| 23 | Only 3 fixed bot archetypes, no adaptive difficulty | gameplay | P2 | M | `config.js:197` `BOT_SKILLS` = 3 tiers; `bot.js:34-103` hardcodes fixed reaction/aim/loadout; no per-player scaling in `sim.js` |
| 24 | No comeback/rubber-band mechanic — first-to-5 can snowball | gameplay | P2 | M | `config.js:161-169` `POINTS_TO_WIN_MATCH=5`; `CHARGE_MAX` flat 4.0, no score-deficit scaling of charge/shrink |
| 25 | Draft templates + top bot loadout overlap, narrowing kit diversity | gameplay | P2 | S | `config.js:544-551` 3 templates reuse drain/shield/teleport/swap; `bot.js` `expert` weights nearly every spell >0.6 |
| 26 | Static PvE — 5 mob types, flat AI, no waves/elites/scaling | content | P2 | M | `config.js` `MOB_TYPES` = 5; `mob.js:255` "no leading, no team logic, no dodging"; no wave/difficulty hooks |
| 27 | No tournament/bracket structure | multiplayer | P2 | L | `matchmaking.js`/`net.js` do one-shot rooms only; no bracket/round-tracking module |
| 28 | No daily/weekly quests or login rewards | retention | P2 | M | No `quest`/`daily`/`login` logic in `src/` or migrations |
| 29 | Onboarding hotkey step has no Escape/cancel and is shown to touch users | accessibility | P2 | S | `onboarding.js:208-220` `_beginCapture` swallows keydowns; Escape isn't in `RESERVED_CODES`; step never consults `isTouch` |
| 30 | Gamepad has no rebinding UI and no on-screen glyph prompts | accessibility | P2 | M | `gamepad.js` wires raw input; no rebind panel (vs keyboard's onboarding step); menus show keyboard chips only |
| 31 | Issue #34 not linked as `blocked_by` on the region-matchmaking epic | multiplayer | P1 | M | Epic is `in_progress` with all sub-issues `done`; owner-only ops issue #34 blocks closure but isn't a tracked dependency |

## Per-Theme Detail

### Theme 1 — Core combat identity & balance (Ranks 1, 8, 9, 22, 24, 25, 23)

The headline defect is that the **HP layer contradicts the design pillar**. The brief states "Bolt does KNOCKBACK not lethal damage; lava/ring-out is death," yet `player.js:574-583` sets `alive=false` the instant `hp<=0` with no positional check, and burst spells stack far past `CFG.PLAYER_HP_MAX=180` well inside cooldown windows (Meteor 36+30 burn, Detonate 32+~16, Lightning 22, Arcane Bolt 24). This rewards the `Burst` draft template over spacing/edge play and quietly turns a Smash-style ring-out game into a damage race. It compounds with **no CC diminishing returns** (`player.js:268` gates only on `status.disabled>0`; durations in `config.js` stack additively): a target can be chain-locked through disable→stun→mob-AoE for several uninterruptible seconds, and with the HP-kill path that becomes a fully uninteractive death.

Balance blind spots reinforce the pattern: **mob offense isn't scaled by player count** — `config.js:252-268` scales only `MOB_HP_MIN_FACTOR`, leaving `abilityDmg`/`abilityKb` flat, so a single fissureSlam (22 dmg + 0.9s stun + 34 kb) is proportionally brutal in a 2-player match. Secondary depth gaps: **instant-cast hard-CC spells skip the telegraph convention** the codebase otherwise enforces for AoE and mobs (`castTime`/`telegraphR`), making the highest-impact abilities the least dodgeable; **no comeback mechanic** (`config.js:161-169`) lets an early lead snowball to 5-0; and **template/bot-weight overlap** collapses ~33 spells onto a handful of high-value picks, thinning the draft phase and bot differentiation.

### Theme 2 — Multiplayer resilience & connectivity (Ranks 2, 4, 10, 11, 31)

The netcode has **no fault tolerance**. `main.js:470-474` tears down match state on any `conn.on('close')`, `net.js:220-227` does a single `Peer.connect` with no retry/backoff, and there is no host re-election anywhere — so a host tab crash, laptop sleep, or brief WiFi drop ends the match for everyone, and a client blip permanently ejects that player. (The separate "reconnect UX" and "client resume" findings across the multiplayer and UX dimensions are the same underlying defect and are merged here.) Independently, **ICE is STUN-only** (`net.js:38-47`, two STUN servers, no TURN, no ICE-failure detection), so symmetric-NAT/firewall/mobile-carrier users simply time out with no fallback — a low-effort, high-impact connectivity fix (Rank 2). Lower down: **no late-join/spectator** (`net.js:88-113` has no phase check), **no matchmaking escape hatch** in sparse regions (`matchmaking.js:267-276` widens forever; `selectPair:63-75` demands exactly `MATCH_SIZE` with no bot-fill), and the region-matchmaking epic is functionally **blocked on owner-only issue #34** without that dependency being recorded.

Note: the "presence-pairing race / split-brain" finding (matchmaking.js `_evaluatePair:218-251`) is plausible but lower-confidence and low-frequency; it is folded into this theme as a hardening item rather than ranked separately.

### Theme 3 — Trust & anti-cheat (Ranks 19, 20, 21)

Because the host runs the authoritative sim and **self-reports the result** to `submit-match` for ELO, with no signature/replay-protection on STATE (`net.js:160-165`) and no server-side check, a modified host can fabricate any leaderboard outcome. This is amplified by **client-declared identity** (`net.js:232-238` sends `userId` freely; `_acceptsMatchmakingJoin:188-197` never validates a Supabase session), letting a guest spoof any user in a ranked lobby. Both become material the moment ranked matchmaking (#34) ships. A related fairness bug: **ELO is silently dropped whenever a guest/bot wins** (`leaderboard.js:18-23`), under-crediting exactly the mixed casual lobbies new players inhabit.

### Theme 4 — Progression & retention meta (Ranks 6, 7, 14, 15, 17, 18, 21, 28)

Retention infrastructure is largely absent. There is **no account progression** — `auth.js:33-52` maps a user to `{id,email,username,isGuest}` and `0001_init.sql` has no xp/level/unlock table — so winning changes only a hidden ELO number. There are **no cosmetics** (4 hardcoded GLBs, no skin/unlock system), removing the primary long-tail loop for arena brawlers. Social is a stub: `social.js` is a 77-line local mute list with **no friends/party/invite**, so players can't reconnect after a good match. The ladder is a **single cumulative leaderboard** (`leaderboard.js:59-75`) with no seasons, friends filter, or self-rank lookup, and match_players is **write-only** with no client history/recap query. No **daily/login** loop exists. Together these mean nothing pulls a player back tomorrow.

### Theme 5 — Modes, content & PvE depth (Ranks 16, 26, 27, 13, 23)

The game is **FFA-only** (`config.js` `MAX_PLAYERS:6`, zero `team` logic), with **no ranked/casual split**, no **team/co-op** variant, and no **tournament/bracket** module — capping social and competitive replay. PvE is **static**: 5 mob types with flat nearest-target AI (`mob.js:255`) and no wave/elite/difficulty scaling. And the **practice mode teaches nothing** (`main.js:~123-264` is a dummy sandbox) — despite polished account/character onboarding (#54), no scripted sequence teaches charge-scaling knockback, ring-out timing, or drafting, the exact mechanics that make this game distinct.

**Map variety is already built but unsurfaced.** `config.js` `ARENA_WORLDS` defines 5 worlds/hazards and matchmaking carries a single `map` field with no voting/rotation UI — but this is explicitly covered by the approved-but-unstarted "lobby map selection" spec, so it is a **known backlog item, not a new gap** (flagged, not ranked).

### Theme 6 — Mobile & accessibility parity (Ranks 5, 12, 29, 30)

**Mobile is not at parity.** `index.html:798-802` gives touch players a joystick and one `#fire-btn`, while `input.js:119` locks `selectedSpell="fireball"` with no touch-facing `setSelectedSpell` caller — every character has 4-5 spells the mobile player can never switch to. Baseline **audio/graphics settings are missing** (`audio.js:28-30` hardcoded gains; `ui.js` exposes only a voice slider; no quality toggle), a comfort/accessibility floor. The **onboarding hotkey step has no Escape/cancel and is shown to touch users** who have no keyboard (`onboarding.js:208-220`), and **gamepad has no rebind UI or on-screen glyphs**, making controller play feel second-class.

### Theme 7 — Backlog & documentation reconciliation (Rank 3, plus false-positive corrections)

`feature_list.json` tracks only 2 of the project's ~8 shipped/active epics (Rank 3) — the mirror no longer reflects reality, which undermines any fleet-loop or planning pass. Alongside that, the recon surfaced **three stale-framing corrections that are NOT buildable gaps** and should be reconciled rather than actioned:

- **"5 approved-but-unstarted specs" is inaccurate.** Only 4 files exist in `docs/superpowers/specs/`, and all 4 (menu cinematic polish, fullscreen lobby, lobby map selection, low-poly asset conversion) already have merged implementation commits (c4f160a, 57a9ad2, 98f4746, 40b092d). They need a status pass (mark done/archive), not implementation — actioning them risks re-building shipped work.
- **The "rune labels" 5th spec does not exist** as pending work; rune labels shipped in 6d8d40d / e655a17 / #28. Close the `plans/2026-06-29-rune-labels.md` against those commits.
- **Handbook "21 active spells" vs README's 20** is an off-by-one doc discrepancy (`README.md:78-101` lists 20), to reconcile against `config.js` SPELLS — a doc fix, not a feature.
- Issue #32 (GLB optimization) has no `feature_list.json` entry and should get one for mirror integrity.

## Quick Wins vs. Big Bets

**Quick wins (small effort, outsized impact — do first):**
- **TURN relay fallback** (Rank 2, S) — add TURN/`turns:` to `net.js:38-47` + ICE-failure messaging; directly lifts matchmaking success rate for firewalled/mobile users.
- **`feature_list.json` resync + spec status pass** (Rank 3, S) — restore backlog truth and archive the 4 shipped specs / rune-label plan / #32 entry so autonomous planning stops misfiring.
- **Scale mob ability dmg/kb by player count** (Rank 9, S) — mirror the existing `MOB_HP_MIN_FACTOR` treatment for `abilityDmg`/`abilityKb`.
- **Enforce authenticated identity on ranked joins** (Rank 20, S) and **stop dropping ELO on guest/bot wins** (Rank 21, S) — cheap integrity/fairness fixes.
- **Draft template diversification** (Rank 25, S) and **onboarding Escape/touch guard** (Rank 29, S).

**Big bets (large effort, strategic — schedule deliberately):**
- **Reconcile the HP/ring-out identity** (Rank 1, M) — the single most important design decision: cap or convert raw HP death into knockback vulnerability so ring-out is the real win condition. Pair with **CC diminishing returns** (Rank 8, M).
- **Netcode resilience** (Rank 4, L) — host migration + client reconnect/resume; the game's biggest robustness liability.
- **Progression + cosmetics foundation** (Ranks 6 & 7, L) — schema, unlock economy, and skin pipeline; the core retention/monetization loop, currently absent.
- **Team/co-op modes + ranked/casual split** (Ranks 16 & 14, L/M) and **anti-cheat / result verification** (Rank 19, L) — required before a credible ranked launch on top of #34.
