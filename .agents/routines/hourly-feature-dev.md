# Routine — Hourly Epic Feature Development

> **Copy-paste this whole file into the Claude desktop UI** to run one tick of
> autonomous feature development. **When scheduling, the owner MUST give the task
> the exact title `voxel-warlock-brawl-arena hourly-feature-dev` and cron `0 * * * *`** — this is
> the canonical identifier Step 3 self-matches on to disable the right task. It is
> safe to overlap with a prior still-running tick because every action is
> idempotent and guarded by both GitHub locks and a local-worktree check.
> When the backlog is exhausted — no open epics, no actionable sub-issues, no
> open fleet PRs — the terminal-stop step (Step 3) **self-disables** the schedule
> if run under a programmatic scheduler; otherwise it instructs the owner to
> disable it. Self-disable is **gated on the owner first being notified** (the
> optional notifier or a GitHub issue): if every notification channel fails, the
> routine is left **enabled** and stops, so disabling never outruns notification.
>
> This routine **does not reinvent anything** — it drives the existing harness:
> - `.agents/harness/fleet-loop.md` — the generic Epic Fleet Loop (authoritative).
> - `.agents/workflows/backlog-maintenance.md` — backlog + `feature_list.json` sync.
> - `CLAUDE.md` / `AGENTS.md` — the hard rules and orchestrator role.

---

## Your role

You are the **orchestrator** for the Voxel Warlock Brawl Arena repo. You **delegate; you do not
implement directly** (see `CLAUDE.md`). This routine runs **one tick** of the
Epic Fleet Loop and then stops. Do not loop internally — the hourly schedule
provides the cadence.

**ultracode** — this routine opts into multi-agent orchestration. When you reach
Step 1 and begin executing real work, treat it as an `ultracode` turn: drive the
fleet roles as **dynamic multi-agent Workflows** (parallel Scout / Implementer /
Reviewer / Backlog-sync agents) rather than doing the implementation inline. The
keyword is intentional and standing for the whole tick. **Set every `agent()`
call's tier explicitly** (`opts.model` / `opts.effort` per role) — never inherit
from the Opus orchestrator (CLAUDE.md **Hard rule 6**; unset = all-Opus = the
$200 trap).

**Run id — resolve this FIRST, before Step 0, to a concrete literal.** Each
tooling command runs in its **own** `wsl bash -lc '…'`, and shell variables do
**not** persist across those separate invocations — so a `$RID` bash variable
would expand to empty in every later command. Instead, run this once and **read
the printed value**:

```
wsl bash -lc 'echo "run-$(date -u +%Y%m%d-%H%M%S)-$$"'   # prints e.g. run-20260627-140312-4821
```

Call that printed string **`<RID>`** and **paste the literal** into every site
below (it already carries exactly one `run-` prefix — do not add another, and do
not write the token `$RID` into a later shell expecting it to expand):
- lock label this run sets/removes: **`lock:<RID>`** → e.g. `lock:run-20260627-140312-4821`
- claim comment: **`claimed by <RID> at <ISO>`** (this routine's canonical form;
  note `fleet-loop.md` §6.2 writes `claimed by run <id> …` with a space — Step 0c's
  age scan tolerates both: match the timestamp after `at`, not the spacing)
- report footer: **`Tick <RID>`**

(The Step 0c collision scan reads *other* runs' locks, so it matches the wildcard
`lock:run-*`, not this run's own `<RID>`.)

Repo (run all tooling through WSL):

```
wsl bash -lc 'cd /home/carlomigueldy/dev/voxel-warlock-brawl-arena && <cmd>'
```

---

## Owner notifications (optional notifier) — always on

The owner is **always** notified at three lifecycle moments. The transport is an
**optional** notifier CLI (`hermes send --to telegram`) — it is **not assumed present**;
treat every invocation as best-effort:

```
wsl bash -lc 'hermes send --to telegram "<text>"'
```

Send a notification at **each** of these points — they are mandatory, not
best-effort in *intent* (the send itself is best-effort if the notifier is absent):

1. **Epic started** — when this tick is the **first** to begin an epic (the
   selected epic had no in-progress/closed children and no open fleet PRs before
   this tick — i.e. work on it starts now). Send once per epic, not per sub-issue
   or per tick. Example text:
   `🚀 Voxel Warlock Brawl Arena: starting epic #<epic#> "<epic title>" — claiming #<n> <title> at <ISO>.`
2. **Blocker hit** — whenever a claimed issue is labelled `fleet:blocked` (red
   gate, Step 1) **or** the backlog is found **stalled** (Branch B). Example:
   `⛔ Voxel Warlock Brawl Arena: BLOCKED on #<n> "<title>" (epic #<epic#>) — <failed gate / stall reason> at <ISO>. Needs a human.`
3. **Epic finished** — when an epic is complete (every child closed/merged) and
   its `epic → main` merge gate is green, sent **immediately before** the
   autonomous squash-merge to `main` (notify-then-merge — Branch C-iv). Example:
   `✅ Voxel Warlock Brawl Arena: epic #<epic#> "<epic title>" complete — gate green, squash-merging to main at <ISO>.`

Rules for these pings:

- **Best-effort, never blocking.** If `hermes send --to telegram` is absent or the send fails, log
  it and continue the tick — a failed lifecycle ping must never abort work or
  change a stop decision. (This differs from the terminal-stop notify in Step 3,
  where notification **gates** self-disable; those keep their existing GitHub-issue
  fallback. The epic-start and blocker pings have no GitHub-issue fallback — they
  are notifier-only liveness signals.)
- **Idempotent across overlapping ticks.** Only the tick that actually performs
  the transition sends it: the tick that *first* claims an epic sends "started";
  the tick that *first* sets `fleet:blocked` or detects the stall sends "blocker";
  the tick that *first* observes the epic ready sends "finished". A tick that
  merely re-observes an already-notified state (e.g. an epic already in progress,
  an already-blocked issue) does **not** resend.

---

## Step 0 — Pre-flight: avoid colliding with concurrent runs

The hourly schedule **can overlap with a still-running prior tick**. Before
selecting any work, detect and respect both kinds of active claim. Do this
BEFORE touching `.agents/harness/fleet-loop.md` §4.

**ultracode — always fan the pre-flight out across parallel scouts.** This step
is pure read-only recon (GitHub queries, worktree liveness, branch/PR/label
scans), so it is **always** run as parallel **Explore/Haiku** subagents, never
inline by the orchestrator and never serially. In **one** message, spawn the
three sub-checks below concurrently:

- **Scout A — live GitHub claims (0a):** runs the `gh`/`git fetch` queries and
  returns the raw JSON (open epics, open PRs with head/base refs+labels, open
  issues+labels). Carries the gh-failure rule: if any `gh` call exits non-zero,
  it reports the failure verbatim so the orchestrator can abort the tick.
- **Scout B — local worktrees (0b):** enumerates registered worktrees + the
  fleet worktree root and reports each `<n>` dir's `git log -1 --format='%cI %s'`
  (re-checking tips a few seconds apart for liveness).
- **Scout C — claim-comment ages (0c inputs):** for every candidate issue,
  reads `gh issue view <n> --json comments` and extracts the ISO timestamp after
  `at` (tolerating both `claimed by run-<id>` and the spaced `claimed by run
  <id>` form) plus any `lock:run-*` / `fleet:in-progress` labels.

Use the cheapest tier that fits — **Explore** for the broad search/enumeration,
**Haiku** for the mechanical JSON/timestamp parsing. Keep them **read-only**:
scouts return structured findings; the **orchestrator** alone applies the
collision rule (0c), claims work, and writes any labels/comments. If a scout's
`gh` query fails, the gh-failure rule (0a) still governs — abort the tick.

### 0a. Live GitHub claims (remote)

```bash
gh auth status -h github.com
gh repo view --json nameWithOwner,defaultBranchRef
git -C /home/carlomigueldy/dev/voxel-warlock-brawl-arena fetch origin --prune
gh issue list --state open --label epic --limit 100 --json number,title,labels,body
gh pr list   --state open --json number,headRefName,baseRefName,title,labels
gh issue list --state open --limit 200 --json number,title,labels
```

> **gh-failure rule (fail-safe — applies to every gh call in this routine).** If
> `gh auth status` or **any** `gh issue list` / `gh pr list` exits non-zero (auth
> failure, API outage, a billing failure, rate limit), **abort
> this tick immediately**: claim no work, run no cleanup, and **never
> self-disable**. A failed or empty-on-error query is *never* evidence of an
> empty backlog. Report `Stop condition: gh query failed — tick aborted (no work,
> no self-disable)` and stop.

### 0b. Local Claude/git worktrees (on disk)

A clean, committed worktree may still be **actively owned by another run** — same
git identity means you cannot tell commits apart by author. Enumerate existing
worktrees and check liveness:

```bash
# All registered worktrees + their branches.
git -C /home/carlomigueldy/dev/voxel-warlock-brawl-arena worktree list --porcelain

# What lives under the fleet worktree root (issue-number-keyed dirs).
ls -la /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees 2>/dev/null

# For each existing worktree dir <n>, check for a LIVE concurrent run:
#   git log -1 --format='%cI %s' shows a very recent commit timestamp, OR
#   the branch tip advances between two checks a few seconds apart.
git -C /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<n> log -1 --format='%cI %s'
```

### 0c. The collision rule

For every candidate issue `<n>`, treat it as **OWNED — skip it** if ANY hold:

- An open PR exists with head `feat/<n>-*`.
- The issue has `fleet:in-progress`, or a `lock:run-*` label (any run's) whose
  **claim comment is < 2h old**. GitHub labels carry no timestamp, so measure
  lock age from the claim comment (a `claimed by run… at <ISO>` line, per
  `fleet-loop.md` §4.2/§6.2). Read it with `gh issue view <n> --json comments`
  and parse the **ISO timestamp after `at`** — tolerate both this routine's
  `claimed by run-<id>` and the harness's spaced `claimed by run <id>` form.
- A remote branch `origin/feat/<n>-*` exists.
- **A local worktree `/home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<n>` exists with a commit timestamp
  in the last ~2h, or whose tip advances on re-check** → another tick owns it.

Exception (per the `detect-concurrent-worktree-runs` memory): if a worktree is
clearly **abandoned** (claim comment > 2h old, branch exists, no open PR, no
recent commits), the safe move is to **finish → open/refresh PR → tear down
decisively** rather than abort midway — whoever merges first wins, the other
no-ops. Do not clobber a *live* run's worktree.

> ✅ If, after this step, no unowned unblocked issue remains, **do not claim work
> this tick and do not stop here** — skip Steps 1–2 and **jump to Step 3 (the
> terminal-stop gate)**, which decides exhausted vs. stalled vs. just-busy and
> handles notify/self-disable. Stopping here directly would make the entire
> terminal-stop machinery unreachable on an exhausted backlog (the routine would
> print "nothing to pick up" every hour forever instead of self-disabling). Do
> not force work.

---

## Step 1 — Run exactly one Fleet Loop tick

Execute the tick defined in **`.agents/harness/fleet-loop.md`** end to end. Use
its §11 one-tick checklist as the step list, **except where this routine
overrides it** — the overrides below win on conflict. (Notably: the PR step
supersedes §8 / §11-F2's `Closes #<n>` — see the PR bullet.) Key bindings for
this routine:

- **Selection (§5):** highest-priority open epic with unfinished children, then
  ≤ **2** unblocked sub-issues in dependency order. Cap = 2 issues per tick.
- **Isolation (§6):** create `/home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<n>` on branch
  `feat/<n>-<slug>` from `origin/feat/epic-<epic#>-integration`; set
  `fleet:in-progress` + `lock:<RID>`; post the `claimed by <RID> at <ISO>`
  comment; re-run the
  duplicate-guard once after the label write (race guard).
- **Epic-start notify:** immediately after claiming, if this tick is the **first**
  to begin the selected epic (no in-progress/closed children, no open fleet PR
  before this tick), send the **"Epic started"** notification (see *Owner
  notifications*). Best-effort; one per epic.
- **Fleet roles (§7) — run as a dynamic `ultracode` Workflow:** Scout
  (Haiku/Explore) → Implementer (Sonnet) → Reviewer (Opus) → Backlog-sync
  (Sonnet/Haiku). Fan these out as a multi-agent Workflow (parallel/pipelined
  agents per claimed issue), not inline edits. Spawn independent subagents in
  parallel. **Set each role's tier explicitly on its `agent()` call**
  (`opts.model` / `opts.effort`) — never inherit from the Opus orchestrator
  (CLAUDE.md **Hard rule 6**). Load `.agents/skills/frontend-design/SKILL.md`
  before any UI work.
- **Gates (§7):** inside each worktree, in order —
  `npm ci` →
  npm test →
  `python3 -m json.tool feature_list.json`. A red gate ⇒ label
  `fleet:blocked`, comment the failed gate, send the **"Blocker hit"** notification
  (see *Owner notifications*), **stop**.
- **PR (§8):** open/update a PR **targeting the epic branch**
  (`feat/epic-<epic#>-integration`), never `main`. Conventional-Commit title,
  PR template body. Reference the issue as `Refs #<n>` — **not** `Closes #<n>`,
  and **this overrides** §8 / §11-F2 of `fleet-loop.md`, which say `Closes`:
  GitHub only auto-closes an issue when its PR merges into the **default branch**,
  so a `Closes` keyword on an epic-branch PR silently never fires. The sub-issue
  is closed explicitly (`gh issue close <n>`) when its PR merges into the epic
  branch, or it auto-closes when the epic → `main` PR (which *does* target the
  default branch) merges.
- **Autonomous merge (§8 gate):** after the PR is open and the fleet roles are
  done, run the `fleet-loop.md` §8 **Autonomous-merge gate** on it — Opus
  Reviewer = approve, all local gates green, PR mergeable/no conflicts, and no
  `fleet:blocked`/`hold:owner` label. If it **holds**, squash-merge the sub-issue
  PR into the epic branch (`gh pr merge <pr#> --squash --delete-branch`) and
  `gh issue close <n>`. If it **fails**, do **not** merge — set `fleet:review`,
  comment the failing condition, and leave it for the owner.

---

## Step 2 — Hard rules (never violated)

These come from `CLAUDE.md` / `AGENTS.md` and `fleet-loop.md` §1:

1. **No AI/LLM attribution** anywhere — commits, trailers, co-authors, PR
   titles/bodies, issue comments. Local commits use the configured git identity;
   PRs/issues use the authenticated `gh` account. If no git identity is
   configured, **stop and surface to the owner**.
2. **Conventional Commits** for every commit message and PR title.
3. **PR template** filled truthfully (quality-gate + backlog-sync checkboxes).
4. **Issue templates** for any new issues; keep `feature_list.json` in sync in
   the same change (`.agents/workflows/backlog-maintenance.md`).
5. **Squash & merge only; always via an open PR; autonomous merge under the
   gate.** Every merge to `main` goes **through an open PR** — never a direct push
   or local merge. The loop merges both sub-issue→epic and epic→`main` PRs
   autonomously, but **only** when the `fleet-loop.md` §8 **Autonomous-merge
   gate** holds (Opus approve + all local gates green + mergeable/no conflicts +
   no `fleet:blocked`/`hold:owner`) — and a **merge to `main` additionally
   requires a confirmed-clean adversarial multi-lens review** of the PR.
   epic→`main` is **open-PR → notify → merge** (notification first). Gate fails ⇒
   leave the PR for the owner.

CI may be red within seconds due to account billing, not code — evaluate gates
**locally**, never from the CI badge alone.

---

## Step 3 — Terminal-stop gate: check backlog exhaustion FIRST

This gate runs **before** any per-tick cleanup (Step 4) so the routine never
spends a cleanup pass on a terminal tick.

**Fail-safe first (per the gh-failure rule in Step 0a).** A zero count is only
trusted when the `gh` call **exited 0 and returned a well-formed JSON array**.
Capture each query, abort the whole tick on any failure, and never read a failed
or malformed query as an empty backlog. The backlog is **exhausted** only when
all three captured counts are `0` AND all three commands succeeded.

Run the three checks below as **one** `wsl bash -lc '…'` script (per the header's
WSL convention) so `exit 1` aborts the whole gate cleanly and `EPICS` / `SUBS` /
`PRS` are all computed in one pass before branching. (The blockquote notes between
the fenced blocks are commentary — the bash is one continuous script.)

```bash
# Each query must succeed (gh exit 0) AND emit a real JSON array, or the tick
# ABORTS — a malformed/empty/error-object payload is never read as a "0" count.
# Guard mechanism: `jq -e 'type=="array"'` yields an explicit boolean that -e
# tests, so it exits non-zero on an object (e.g. {"message":"Bad credentials"}),
# on empty input, and on a parse error alike. (Do NOT use `jq -e 'arrays'`: it
# produces no output on a non-array and -e's no-output convention makes the
# distinction fragile; the explicit type test is unambiguous.) `jq empty` first
# rejects unparseable input before the type check runs.
fetch_count() {  # $1 = jq filter producing the count; reads gh JSON from stdin
  local json; json="$(cat)" || return 1
  printf '%s' "$json" | jq empty >/dev/null 2>&1 || return 1          # parseable?
  printf '%s' "$json" | jq -e 'type=="array"' >/dev/null 2>&1 || return 1  # a real array?
  printf '%s' "$json" | jq "$1"
}

# 1. No open epics remain.
EPICS_JSON=$(gh issue list --state open --label epic --limit 100 --json number) \
  || { echo 'gh failed (epics) — abort tick, do NOT self-disable'; exit 1; }
EPICS=$(printf '%s' "$EPICS_JSON" | fetch_count 'length') \
  || { echo 'malformed epics JSON — abort tick, do NOT self-disable'; exit 1; }

# 2. No open sub-issues remain that are actionable. A sub-issue still in
#    fleet:review OR fleet:blocked is NOT actionable this tick — exclude both,
#    so a permanently blocked issue cannot keep the routine alive forever.
SUBS_JSON=$(gh issue list --state open --label sub-issue --limit 200 --json number,labels) \
  || { echo 'gh failed (sub-issues) — abort tick, do NOT self-disable'; exit 1; }
SUBS=$(printf '%s' "$SUBS_JSON" | fetch_count '[.[] | select((.labels|map(.name)) as $l | ($l|index("fleet:review")|not) and ($l|index("fleet:blocked")|not))] | length') \
  || { echo 'malformed sub-issues JSON — abort tick, do NOT self-disable'; exit 1; }

# 2b. ALL open sub-issues (no label exclusion). Distinguishes "blocked/stalled
#     children still open" (SUBS_OPEN>0 → genuinely STALLED) from "every child
#     closed/merged, epic just awaiting its epic→main PR" (SUBS_OPEN==0 → epic
#     ready, NOT stalled — a different owner action).
SUBS_OPEN=$(printf '%s' "$SUBS_JSON" | fetch_count 'length') \
  || { echo 'malformed sub-issues JSON — abort tick, do NOT self-disable'; exit 1; }
```

> Note on blocked issues: a `fleet:blocked` sub-issue is treated as **not
> actionable** because an hourly tick cannot unblock it (it needs a human to
> resolve the gate/upstream dependency, then remove the `fleet:blocked` label).
> Counting it as remaining work would spin the routine forever doing nothing, so
> the terminal-stop notification below explicitly tells the owner if blocked-only
> work is what triggered the stop.

> **Stalled ≠ exhausted (no silent forever-loop).** A sub-issue can be
> non-actionable *without* a `fleet:blocked` label — e.g. its `dependencies` are
> not yet merged into the epic branch (Step 1/§5 cannot select it). It is still
> open (`SUBS_OPEN > 0`), so the routine correctly does **not** self-disable; but
> no tick can pick it either, so without handling the routine would no-op forever.
> **Branch B below** detects this (open children remain yet nothing selectable)
> and notifies the owner instead of silently spinning.

```bash
# (continued — same wsl bash -lc session as checks 1-2 above)
# 3. No open fleet PRs are still awaiting integration.
PRS_JSON=$(gh pr list --state open --json headRefName) \
  || { echo 'gh failed (PRs) — abort tick, do NOT self-disable'; exit 1; }
PRS=$(printf '%s' "$PRS_JSON" | fetch_count '[.[] | select(.headRefName | test("^feat/(epic-)?[0-9]"))] | length') \
  || { echo 'malformed PRs JSON — abort tick, do NOT self-disable'; exit 1; }
```

Now take **exactly one** of three branches (A, B, or C below) based on the counts
and on whether anything was selectable this tick. Define two signals first:

- **`NOTHING_SELECTABLE`** — true when Step 0c found no unowned unblocked issue
  (you jumped straight here) **or** Step 1 selected zero issues this tick.
- **`LIVE_OWNED_SKIP`** — true when Step 0c skipped **any** candidate because it
  was **OWNED by a live concurrent run** (an open `feat/<n>-*` PR, a `lock:run-*`
  with a claim comment < 2h old, or a live worktree). This is the normal, safe
  overlap the header describes — the work is being actively done by another tick,
  it is **not** stalled.

---

**Branch A — EXHAUSTED (self-disable).** Only if all three `gh` queries succeeded
AND `EPICS == 0 && SUBS == 0 && PRS == 0`. (If any query aborted above, the tick
already stopped without self-disabling — that is none of these branches.) Then:

1. **Do not claim any work this tick** and **do not run Step 4 cleanup** (nothing
   was claimed).
2. **Notify the owner FIRST, and gate self-disable on notification actually
   succeeding** — disabling must never outrun the notification. Probe for the
   optional notifier CLI, else fall back to opening a GitHub issue. **Do not `--label` it
   with a label that may not exist** (a missing label would
   make `gh issue create` fail); create the issue label-free so the call is
   reliable. Capture whether *any* channel succeeded:
   ```bash
   wsl bash -lc '
     TITLE="chore: hourly feature-dev routine self-disabled (backlog exhausted)"
     MSG="Voxel Warlock Brawl Arena hourly routine: backlog exhausted (no open epics, no actionable sub-issues, no open fleet PRs) at $(date -u +%Y-%m-%dT%H:%M:%SZ). Routine is self-disabling. Re-schedule when a new epic is filed. If only fleet:blocked sub-issues remain, a human must unblock them first."
     notified=0
     if command -v hermes send --to telegram >/dev/null 2>&1 && hermes send --to telegram "$MSG"; then
       echo "notified: notifier"; notified=1
     else
       # Idempotent fallback: reuse an existing open notification issue instead of
       # opening a new one every terminal tick (no hourly issue spam). Match by
       # exact title; comment on it if present, else create it once (label-free so
       # a missing label cannot make the call fail).
       EXIST=$(gh issue list --state open --search "in:title \"$TITLE\"" --json number,title \
               | jq -r --arg t "$TITLE" "[.[] | select(.title==\$t)][0].number // empty")
       if [ -n "$EXIST" ]; then
         gh issue comment "$EXIST" --body "$MSG" && { echo "notified: existing issue #$EXIST"; notified=1; }
       elif gh issue create --title "$TITLE" --body "$MSG"; then
         echo "notified: github-issue (notifier unavailable)"; notified=1
       fi
     fi
     [ "$notified" -eq 1 ] && echo "NOTIFY_OK" || echo "NOTIFY_FAILED"
   '
   ```
   The optional notifier binary is **not** assumed present; the GitHub issue
   is the contract. The GitHub-issue fallback is **idempotent** — a terminal tick
   that recurs (e.g. because self-disable was ambiguous, item 3) comments on the
   existing issue rather than opening a duplicate. (The notifier path is
   not idempotent, so a *recurring* Branch B/awaiting tick that keeps reaching the
   owner via the notifier will message each tick; that is acceptable as a liveness ping,
   and the GitHub channel never duplicates.) Do not retry in a loop.

   **`NOTIFY_FAILED` — governs Branch A only.** If neither channel succeeded on a
   Branch A (exhausted) tick, do **NOT** self-disable — a disabled-but-unannounced
   routine is the one failure mode this gate exists to prevent. Skip item 3,
   report `Stop condition: terminal but owner-notify failed — left enabled` and
   **stop**. The next hourly tick re-evaluates and re-attempts the notify; the
   routine stays alive until the owner is actually reached. (Branch B never
   self-disables regardless of `NOTIFY_OK`/`NOTIFY_FAILED`, so this gate does not
   apply to it.)

   **Stalled variant (used by Branch B).** Reuse the exact same `command -v
   hermes send --to telegram` → existing-issue → create logic, but change **both** the title **and**
   the body — the exhausted `MSG` above says "Routine is self-disabling", which is
   **false** when stalled (the routine stays enabled):
   - `TITLE="chore: hourly feature-dev routine stalled (work remains, all blocked)"`
   - `MSG="Voxel Warlock Brawl Arena hourly routine: backlog STALLED at $(date -u +%Y-%m-%dT%H:%M:%SZ) — work remains (open epics/sub-issues) but none is selectable (all fleet:blocked or dependency-stalled, no open PRs). Routine stays ENABLED and will retry; a human must unblock the issues or merge the blocking dependencies."`
3. **Self-disable the schedule** (only after `NOTIFY_OK` above) so the routine
   stops being re-invoked. Resolve
   THIS task deterministically, in this order:
   1. If the scheduler context exposes this run's own task id (env var or
      injected task handle), use that id directly — it is unambiguous.
   2. Otherwise list the scheduler's tasks and match the **exact title**
      `voxel-warlock-brawl-arena hourly-feature-dev` (the canonical title the owner was instructed
      to schedule it under; see the file header). Match the full title string,
      not a substring, so a customized/renamed task or a different routine is
      never disabled by mistake.
   3. If exactly one task matches, delete/disable it, **then verify** it is gone:
      re-list the scheduler's tasks and confirm the id/title no longer appears (or
      is marked disabled). If it still appears, the disable did not take — report
      `Stop condition: backlog exhausted — self-disable FAILED, owner notified to
      remove manually` (the owner was already reached in item 2). If **zero**
      match, or **more than one** matches (ambiguous — the title was customized or
      duplicated), **do NOT delete anything**: say so plainly and instruct the
      owner to remove the task manually.
   If the routine has no programmatic handle at all (pasted manually into the
   desktop UI), fall back to instructing the owner to remove it.
4. Report `Stop condition: backlog exhausted — routine self-disabled (owner notified)`
   and **stop**. (Deleting an already-removed task is a no-op; if a new epic is
   filed later, the owner re-schedules and it resumes from live state.)

---

**Branch B — STALLED (notify, stay enabled).** Else if **`SUBS_OPEN > 0`**
(open sub-issues still exist) **and `PRS == 0`** **and `NOTHING_SELECTABLE`**
**and NOT `LIVE_OWNED_SKIP`** — every still-open sub-issue is blocked-by-label or
dependency-stalled with **no open PR in flight and no live concurrent run working
it**, so no tick can make progress until a human intervenes. Three guard clauses
are essential here:
- `SUBS_OPEN > 0`: there must be at least one **open** sub-issue to be stalled on.
  If `SUBS_OPEN == 0` while an epic is still open (all children closed/merged), the
  epic is **ready for its `epic → main` PR**, not stalled → Branch C(iv).
- `PRS == 0`: if all open children are in `fleet:review` with open PRs (`SUBS == 0`
  because review is excluded, but `PRS > 0`), the work is **complete and awaiting
  owner merge**, not stalled → Branch C.
- `NOT LIVE_OWNED_SKIP`: if nothing was selectable only because a **live
  concurrent tick** already owns the unblocked issue(s) (the safe overlap the
  header describes), the work is **in progress**, not stalled → Branch C. Firing
  a "human must intervene" alarm here would cry wolf every overlapping hour.

Then:

1. Run the **idempotent notify** (item 2 logic above) with the **stalled**
   `TITLE`/`MSG` variant given in item 2 (not the "self-disabling" exhausted
   message). This is the **"Blocker hit"** lifecycle ping (see *Owner
   notifications*) — the notifier channel reaches the owner directly.
2. **Do NOT self-disable** — on either `NOTIFY_OK` or `NOTIFY_FAILED`. A human
   must unblock the issues or merge the blocking dependencies; the routine stays
   enabled and re-evaluates next tick.
3. Report `Stop condition: backlog stalled — owner notified, left enabled` and
   **stop**. (Do not run Step 4 cleanup — nothing was claimed.)

---

**Branch C — BUSY / awaiting integration (normal, stay enabled).** **Any state
not matched by A or B** — this is the catch-all, so the partition is total. It
covers:
- (i) **BUSY** — work remained and something was selectable/claimed this tick.
  Proceed to **Step 4 (normal cleanup)**.
- (ii) **gate-blocked PRs awaiting owner** — any `PRS > 0` with nothing
  selectable: open fleet PRs that the §8 gate did **not** clear (review not
  approved, a red gate, conflicts, or a `fleet:blocked`/`hold:owner` veto), so the
  loop left them for the owner. (A PR that *passes* the gate is merged in Step 1 /
  Branch C-iv, never parked here.) Re-run the §8 gate on each; merge any that now
  pass, else report `Stop condition: gate-blocked PRs awaiting owner` and **stop**,
  schedule left enabled.
- (iii) **live overlap** — `LIVE_OWNED_SKIP`: nothing selectable only because a
  live concurrent tick already owns the unblocked work (safe, expected overlap).
  Report `Stop condition: live concurrent run owns the work — no-op` and **stop**.
- (iv) **epic ready → autonomous epic→main merge** — `EPICS > 0 && SUBS_OPEN ==
  0 && PRS == 0`: every child of an open epic is closed/merged with no sub-issue
  PR pending, so the epic is complete. **Autonomously merge it to `main`** via the
  `fleet-loop.md` §8 notify-then-merge procedure:
  1. Open the `epic → main` PR if one does not already exist (squash, PR
     template, Conventional-Commit title), targeting the default branch.
  2. Run the §8 **Autonomous-merge gate**. Because this PR targets `main`, the
     review bar is the **adversarial** one: a **fresh, multi-lens, refute-oriented
     Opus review** of the whole integration branch (correctness / security /
     scope) — e.g. the `adversarial-code-review` skill with `args: { pr:
     <epic-pr#> }` — with **every surfaced finding fixed (and re-verified) or
     cleared as a non-issue by a _different_ agent** (never self-cleared). Plus
     all local gates green on the integration branch, PR mergeable, and no
     `fleet:blocked`/`hold:owner` on the epic or its PR. **Post the audit trail**
     to the epic PR before merging: one comment with the adversarial-review
     confirmed-clean verdict, one with the gate results. Missing evidence ⇒ the
     gate fails (§8 conditions 1–2).
  3. **Gate holds:** send the **"Epic finished"** notification *first* (best-effort,
     see *Owner notifications*), then `gh pr merge "$EPIC_PR" --squash
     --delete-branch` (capture `$EPIC_PR` per `fleet-loop.md` §8 — never a literal
     placeholder). Sync `feature_list.json` (epic → `done`) into the owner's hands.
     Report `Stop condition: epic merged to main (gate green, owner notified)` and
     **stop**.
  4. **Gate fails** (review not approved, red gate, conflicts, or a
     `fleet:blocked`/`hold:owner` veto): do **not** merge. Send the
     **"Blocker hit"** ping naming the failing condition, leave the epic PR open,
     and report `Stop condition: epic→main gate failed — owner notified, left for
     owner` and **stop**.

Self-disable **never** applies in Branch C (open PRs, live runs, and ready epics
are all unfinished work). Only sub-case (i) runs Step 4; (ii)/(iii)/(iv) claimed
nothing, so they just stop.

---

## Step 4 — Per-tick cleanup & hand-back, then stop

Reached only from **Branch C sub-case (i) — BUSY** (work was selectable/claimed
this tick). Branches A/B and Branch C (ii)/(iii)/(iv) already stopped above.

1. Remove `lock:<RID>` from every issue claimed this tick.
2. For each claimed issue, the §8 gate has already decided its fate in Step 1:
   **gate held** ⇒ its PR was squash-merged into the epic branch and the issue
   closed; **gate failed** ⇒ leave `fleet:review` (or `fleet:blocked`) on it with
   the failing condition commented, for the owner. If merging the last child made
   the epic ready (`SUBS_OPEN == 0`), the next tick's Branch C-iv runs the
   epic→`main` merge — do not also do it here.
3. Hand the proposed `feature_list.json` delta to the owner (do **not** write it
   inside the loop — it is orchestrator-owned).
4. **Stop** this tick — the hourly schedule re-invokes you for the next one.

### Report back (end every run with this)

```
Tick <RID> @ <ISO timestamp>
Owned/skipped (concurrent): #<…> (worktree live) , #<…> (open PR)
Claimed this tick:          #<n> <title> , #<m> <title>   (≤2)
Gates:                      all green | <gate> failed on #<n>
PRs opened/updated:         #<pr> → feat/epic-<epic#>-integration
Blocked:                    #<n> — <reason>  (or: none)
Backlog delta handed back:  <summary>  (or: none)
Merged this tick:           #<pr> (sub-issue→epic) | epic #<epic#>→main | none
Stop condition:             cap reached | no remaining issues | blocked
                            | gate-blocked PRs awaiting owner                  (Branch C-ii)
                            | live concurrent run owns the work — no-op        (Branch C-iii)
                            | epic merged to main (gate green, owner notified) (Branch C-iv)
                            | epic→main gate failed — owner notified, left for owner  (Branch C-iv)
                            | backlog exhausted — routine self-disabled (owner notified)  (Branch A)
                            | backlog exhausted — self-disable FAILED, owner notified to remove manually
                            | backlog stalled — owner notified, left enabled   (Branch B)
                            | terminal but owner-notify failed — left enabled
                            | gh query failed — tick aborted (no work, no self-disable)
```
