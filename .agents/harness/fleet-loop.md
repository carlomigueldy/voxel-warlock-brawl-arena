# Epic Fleet Loop (generic harness)

A reusable, orchestrated multi-agent tick that picks up **any** open epic and
its sub-issues and advances them safely. Invoke from a routine/cron OR from an
interactive orchestrator. A project may keep one or more **concrete instance
files** under `.agents/workflows/` (a project-specific fleet loop wired to its
own epics); this file is the abstraction those instances specialize.

Prime directive: **idempotent, at-most-once; every change reaches
`main` only through an open PR — never a direct push or local
merge. The fleet may merge those PRs autonomously — including the
epic→`main` PR — but only when the §8 Autonomous-merge gate holds
(a merge to `main` additionally requires a confirmed-clean
**adversarial review**); otherwise it hands the merge to the owner.**

---

## 1. Hard rules (non-negotiable)

1. **No AI/LLM attribution anywhere** — commits, commit trailers, PR titles, PR
   bodies, issue comments, co-authors. Never add `Co-Authored-By` for an AI. For
   **local commits**, author/committer come from the configured git
   `user.name`/`user.email` (a real human/owner identity); for **PRs and
   issues**, attribution is the authenticated `gh` account (also a real
   human/owner). Never invent or set an AI/automation identity (per `CLAUDE.md` /
   `AGENTS.md` Hard rule 1).
2. **Conventional Commits** for every commit message AND every PR title, using a
   type from the closed set in `CLAUDE.md` / `AGENTS.md` Hard rule 2
   (authoritative): `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`,
   `ci`, `build`, `revert` (optional scope, e.g. `feat(dashboard): …`).
3. **Always use the PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) when
   opening a PR. Fill every section.
4. **Always use the issue templates** when creating issues:
   `.github/ISSUE_TEMPLATE/epic.md` and `.github/ISSUE_TEMPLATE/sub-issue.md`.
   Keep `feature_list.json` synchronized in the same change (per
   `.agents/workflows/backlog-maintenance.md`).
5. **Squash & merge ONLY** as the merge strategy (`gh pr merge --squash`).
   Sub-issue PRs target the **epic integration branch**. Both sub-issue→epic and
   the final epic→`main` PR may be **merged autonomously**, but
   **only** when the **§8 Autonomous-merge gate** holds (Opus approve + all local
   gates green + mergeable/no conflicts + no `fleet:blocked`/`hold:owner`);
   epic→`main` is **notify-then-merge** (owner notification, then
   merge). If the gate fails, leave the PR for the owner. Matches `CLAUDE.md` /
   `AGENTS.md` Hard rule 5 (authoritative).
6. Do NOT touch app code outside the claimed file scope for a given sub-issue.
7. `feature_list.json` is orchestrator-owned; the backlog-sync role only drafts a
   delta and hands it back — do not write it directly inside the loop.

---

## 2. Environment & WSL specifics

All tooling (node, npm, gh, git) lives in WSL. Run every command via:

```
wsl bash -lc 'cd /home/carlomigueldy/dev/voxel-warlock-brawl-arena && <cmd>'
```

Key points:

1. **Commit only from a checkout with `node_modules` installed** so husky
   lint-staged runs. `npm ci` with a warm npm store is
   fast — one install per worktree.
2. Worktrees live at `/home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<issue#>` relative to the repo root
   (e.g. `/home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/71`).
3. Auth precheck before any GitHub operation:
   ```bash
   gh auth status -h github.com
   gh repo view --json nameWithOwner,defaultBranchRef
   ```
4. GitHub Actions billing can red CI in seconds due to account billing
   constraints — red CI does not necessarily mean broken code. Evaluate gate
   failures **locally** (§7), not from the CI badge alone.

---

## 3. The tick — lifecycle overview

Each tick runs these steps in order. Each is detailed below.

1. **Step A** — Fetch live GitHub + fresh tree; derive idempotency keys (§4).
2. **Step B** — Select the epic and ≤2 unblocked sub-issues in dependency
   order (§5).
3. **Step C** — Claim issues; create isolated worktrees; set lock labels (§6).
4. **Step D** — Fan out fleet roles: Scout → Implementer → Reviewer →
   Backlog-sync (§7 roles table below; §7 of this doc is gates).
5. **Step E** — Run validation gates inside each worktree (§7).
6. **Step F** — Push branch; open or update PR targeting the epic branch using
   the PR template (§8).
7. **Step G** — Post progress comment on the issue; update labels (§8).
8. **Step H** — Release `lock:run-<id>`; record stop condition; hand proposed
   `feature_list.json` delta to orchestrator (§10).

### State machine

```
queued → in-progress → review → done
                    ↘ blocked
```

Generic state labels: `fleet:queued` / `fleet:in-progress` / `fleet:review` /
`fleet:blocked`. Temporary claim label: `lock:run-<id>` (removed on release).

---

## 4. Step A — Ground in live GitHub + fresh tree (idempotency key)

Never trust a stale local checkout. Always start here.

### 4.1 Fetch live state

```bash
git fetch origin --prune

# Open epics are the entry point — pick up ANY open epic, not a hardcoded one.
gh issue list --state open --label epic --limit 100 \
  --json number,title,labels,body

# Open PRs + all open issues for selection + duplicate-guard.
gh pr list --state open --json number,headRefName,title,baseRefName,labels
gh issue list --state open --limit 200 --json number,title,state,labels,body

# Label inventory (create fleet:* / lock:* labels if missing).
gh label list --limit 200 --json name,color,description
```

### 4.2 Duplicate-guard (idempotency key = issue number)

For each candidate sub-issue, **NO-OP** (skip, do not claim) if any are true:

- The issue is closed or labeled `fleet:review` / status `done`.
- An open PR already exists with `headRefName` matching `feat/<issue#>-*`.
- The issue has a `fleet:in-progress` label.
- The issue has an active `lock:run-<id>` label less than 2 hours old (check the
  claim-comment timestamp).
- A remote branch `origin/feat/<issue#>-*` already exists.

```bash
gh pr list --state open --json number,headRefName | \
  jq --arg n "feat/<issue#>-" '.[] | select(.headRefName | startswith($n))'

gh issue view <issue#> --json labels,state
```

### 4.3 Branch from fresh origin

Always branch from the epic integration branch on origin, never a stale local
branch:

```bash
git fetch origin feat/epic-<epic#>-integration
# Step C creates the worktree from origin/feat/epic-<epic#>-integration.
```

If the epic integration branch does not yet exist, create it from
`origin/main` once per epic and push it (this is the only branch
the loop creates off `main`):

```bash
git branch feat/epic-<epic#>-integration origin/main
git push -u origin feat/epic-<epic#>-integration
```

---

## 5. Step B — Epic & sub-issue selection (dependency-ordered)

### 5.1 Selection algorithm

1. From the open `epic` issues (§4.1), pick the highest-priority epic with
   unfinished children (use `feature_list.json` priority `P0` > `P1` > `P2`, then
   lowest issue number to break ties).
2. Read that epic body's checkbox list and `feature_list.json` `subissues` to get
   the child issues **in dependency order** (respect each child's `dependencies`).
3. Walk the chain in order. Pick the first issues that:
   1. Pass the duplicate-guard from §4.2.
   2. Have **all** dependencies merged into the epic branch (or confirmed `done`).
   3. Are not labeled `fleet:blocked`.

Cap: claim at most **2 issues per tick** to bound blast radius.

```bash
# Confirm a dependency is already on the epic branch before selecting a child.
git log origin/feat/epic-<epic#>-integration --oneline | head -30
gh issue view <dep-issue#> --json state,labels
```

---

## 6. Step C — Claiming, locks & isolated worktrees (collision avoidance)

### 6.1 Create an isolated worktree

```bash
git worktree add \
  /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<issue#> \
  -b feat/<issue#>-<slug> \
  origin/feat/epic-<epic#>-integration
```

Branch naming: `feat/<issue#>-<slug>` (lowercase, hyphens). Epic branch:
`feat/epic-<epic#>-integration`. Worktree path:
`/home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<issue#>`.

Install dependencies inside the worktree (warm npm store = fast):

```bash
wsl bash -lc 'cd /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<issue#> && \
  npm ci'
```

### 6.2 Claim handshake

1. Set `fleet:in-progress` label on the issue.
2. Add `lock:run-<id>` label (`<id>` = short unique run identifier, e.g.
   `run-20260627-1400`).
3. Post a claim comment: `"claimed by run <id> at <ISO timestamp>"`.
4. Re-check: re-run the duplicate-guard once after the label write to confirm no
   other run claimed in the same window (race-condition guard).

```bash
gh issue edit <issue#> --add-label "fleet:in-progress,lock:run-<id>"
gh issue comment <issue#> --body "claimed by run <id> at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

### 6.3 File-scoped claims

Before claiming, declare the exact file globs the sub-issue will touch (the Scout
produces these). If another active run (another worktree with a `lock:run-*`
label) lists overlapping globs, abort the claim and post a `fleet:blocked`
comment explaining the overlap.

---

## 7. Step D/E — Fleet roles & validation gates

### Fleet roles (inputs / actions / outputs / model tier)

| Role             | Tier            | Inputs                                                            | Actions                                                                                                                                                                 | Outputs                                                                   |
| ---------------- | --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Scout**        | Haiku / Explore | Issue body + acceptance criteria; epic context; live state (§4).  | Locate target files; read current state; summarize gap; flag blockers / overlapping claims; output a scoped work brief with exact file globs.                           | Work brief: summary, gap analysis, file list, blockers.                   |
| **Implementer**  | Sonnet          | Scout brief; worktree on fresh epic-branch base; relevant skills. | Make file-scoped changes confined to claimed globs. Load any task-relevant skill first (e.g. frontend-design SKILL for UI). Conventional commits. No AI attribution.    | Committed diff inside the worktree, confined to claimed globs.            |
| **Reviewer**     | Opus            | Implementer diff; acceptance criteria; gate results (§7 gates).   | Correctness review; scope check (no out-of-scope edits); regression check; verify gates green; approve or request changes with file/line refs.                          | Approve verdict or explicit request-changes notes.                        |
| **Backlog-sync** | Sonnet / Haiku  | Final issue + PR state after gates pass; current backlog mirror.  | Post progress comment (run-id, what changed, gates, evidence, next step). Set `fleet:review` after handoff. Draft `feature_list.json` delta — do NOT write it directly. | Issue comment; proposed `feature_list.json` patch handed to orchestrator. |

**Model tier policy:** Opus reserved for planning/review; Sonnet for
implementation; Haiku/Explore for trivial recon. Subagents may spawn their own
Sonnet/Haiku helpers. Do not upgrade Scout to Sonnet/Opus or downgrade Reviewer
below Opus. When the loop runs as a Workflow / ultracode, **each role's
`agent()` call sets its tier explicitly** (`opts.model` / `opts.effort`) — never
inherit from the Opus orchestrator (CLAUDE.md **Hard rule 6** is the single
source; unset model = all-Opus = the $200 trap).

> For an epic with a design/visual dimension, add an Opus **Design-guard** role
> and a visual-QA evidence step (see a project's concrete instance under
> `.agents/workflows/` for the pattern). For non-UI epics this is omitted.

### Validation gates (required before any handoff or PR)

Run every gate inside the worktree, in this exact order. A red gate blocks PR
and progress: label the issue `fleet:blocked`, post a comment naming the failed
gate, and **stop**.

```bash
# From inside the worktree (project quality-gate scripts).
npm ci
npm test
python3 -m json.tool feature_list.json > /dev/null
```

Run the `feature_list.json` validation even when the issue does not touch it — a
partial upstream rewrite could corrupt it.

| Gate              | Status |
| ----------------- | ------ |
| install           | ✓ / ✗  |
| format:check      | ✓ / ✗  |
| lint              | ✓ / ✗  |
| typecheck         | ✓ / ✗  |
| test              | ✓ / ✗  |
| build             | ✓ / ✗  |
| feature_list.json | ✓ / ✗  |

---

## 8. Step F/G — PR & comment updates + gated autonomous merge

### PR opening / updating

Sub-issue PRs target the **epic branch** (`feat/epic-<epic#>-integration`), not
`main`. PR titles are Conventional Commits. Bodies fill the PR
template.

```bash
gh pr create \
  --title "feat(<scope>): <short description> (#<issue#>)" \
  --body-file pr-body.md \
  --base feat/epic-<epic#>-integration \
  --head feat/<issue#>-<slug>
```

If a PR already exists for this branch, **update it** instead of opening a new
one — push commits, edit the body, add a comment:

```bash
gh pr edit <pr#> --body-file pr-body.md
gh pr comment <pr#> --body-file progress-comment.md
```

No AI attribution anywhere in PR titles, bodies, or comments.

### PR body — fill the template

Use `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Map the gate results onto its
**Quality gates** checkboxes, fill **Summary**, **Related issues** (`Closes
#<issue#>`), and tick **Backlog sync** if backlog state changed.

### Progress comment template

Post on the issue after gate results are known:

```
**run-<id>** · <ISO timestamp>

What changed: <brief>
Gates: all green / <gate> failed — see PR #<n>
Next step: <e.g. "awaiting review" or "blocked on #<n> merge">
```

### Merge policy — the Autonomous-merge gate (authoritative)

The fleet **may merge autonomously**, but only behind a single gate. This section
is the **single source of truth** for that gate; `CLAUDE.md` Hard rule 5 and the
routine reference it. Merge strategy is **always** `gh pr merge --squash`.

**Always via a PR — never a direct merge to `main`.** Lifting the
old "never self-merge to `main`" rule changed *who* may merge (the
fleet, autonomously, under this gate), not *how*. A change reaches
`main` **only** by merging an open `epic → main` PR.
Never `git push origin main`, never fast-forward/locally merge into
`main`, and never call `gh pr merge` before the PR exists — open
the PR first (§8 *PR opening*) and merge *through* it. The same holds for the
epic integration branch: merge sub-issue PRs into it, never push to it directly.

**Autonomous-merge gate — ALL four must hold for the PR under consideration:**

1. **Opus review = approve — and for `main`, adversarially
   reviewed + thoroughly verified, with evidence posted.** The Opus Reviewer's
   verdict on the diff is *approve* with **no** outstanding request-changes. For
   **any PR targeting `main`** (the epic→`main` PR), a
   single approval is **not** enough: run a **fresh, multi-lens, refute-oriented
   Opus review** of the whole integration branch (not just the last sub-issue) —
   correctness, security, and scope lenses that try to *break* the change. The
   `adversarial-code-review` skill (`args: { pr: <epic-pr#> }`) is the canonical
   way to run it. Every surfaced finding must be **resolved before merge**, where
   "resolved" means **either**: (a) **fixed** in a new commit on the PR branch
   and re-verified by re-running the review, **or** (b) **verified a non-issue by
   a _different_ agent than the one that raised it** (never self-cleared), who
   posts the justification. **No silent dismissals.**
   *Audit trail (required):* post the review's confirmed-clean verdict — and each
   finding's resolution — as a **PR comment** before merge. If that evidence
   comment is absent, condition 1 **fails** — a merge may not rest on an
   unposted/claimed-only review.
2. **All local gates green — and posted.** `install → format:check → lint →
   typecheck → test → build → python3 -m json.tool feature_list.json` all pass
   **locally** (CI may be billing-red in ~3s for unrelated reasons — never gate on
   the CI badge; evaluate locally per §7). **Post the gate results as a PR
   comment** before evaluating the merge; condition 2 fails if any gate is red
   **or** if no results were posted.
3. **Mergeable / no conflicts.** The PR merges cleanly against its base
   (`gh pr view <pr#> --json mergeable,mergeStateStatus` reports `MERGEABLE`).
4. **No veto label.** Neither the issue nor the PR carries **`fleet:blocked`** or
   **`hold:owner`**. (`hold:owner` is the owner's manual veto — ensure it exists
   alongside the `fleet:*` labels in §4/A3.)

If **any** condition fails: do **not** merge. Comment the failing condition, set
`fleet:review` (or `fleet:blocked` for a red gate), and leave the PR for the owner.
The two posted comments (review verdict + gate results) are the **audit trail**
that lets the owner confirm, after the fact, that an autonomous merge to
`main` was genuinely earned.

**Sub-issue PR → epic branch (fully autonomous when the gate holds):**

```bash
gh pr merge <pr#> --squash --delete-branch   # gate held → autonomous
gh issue close <issue#>                       # sub-issue closed on merge into epic branch
```

**Epic → `main` PR (open-PR → notify → merge, when the gate
holds):** reached when every child of the epic is closed/merged (see §10). The
merge **must** run against an open PR — never a direct/local merge to
`main`:

```bash
HEAD_REF="feat/epic-<epic#>-integration"
# 1. Ensure the epic→main PR exists (idempotent — reuse if already open),
#    then CAPTURE its number into a variable for the merge step.
EPIC_PR=$(gh pr list --base main --head "$HEAD_REF" --json number --jq '.[0].number // empty')
if [ -z "$EPIC_PR" ]; then
  gh pr create --base main --head "$HEAD_REF" \
    --title "feat(epic-<epic#>): <epic title>" --body-file epic-pr-body.md
  EPIC_PR=$(gh pr list --base main --head "$HEAD_REF" --json number --jq '.[0].number // empty')
fi
# 2. Run the gate against PR "$EPIC_PR" (fresh adversarial review + local gates),
#    and POST the two evidence comments (review verdict, gate results) — see the
#    gate above. Only proceed if every condition holds.
gh pr comment "$EPIC_PR" --body-file adversarial-verdict.md   # audit trail (condition 1)
gh pr comment "$EPIC_PR" --body-file gate-results.md          # audit trail (condition 2)
# 3. Notify FIRST (optional/best-effort — never block the merge), then merge
#    THROUGH the PR.
hermes send --to telegram "✅ Voxel Warlock Brawl Arena: epic #<epic#> complete — gate green, squash-merging to main." || true
gh pr merge "$EPIC_PR" --squash --delete-branch   # autonomous squash-merge of the open PR
```

The owner notification is optional and best-effort (`|| true`) and must precede
the merge, but a failed (or absent) notifier does **not** block it (the gate
already authorized the merge). The owner can cancel a pending
epic→`main` merge at any time by adding **`hold:owner`** to the
epic or its PR.

---

## 9. Idempotency & at-most-once (rerun safety)

### Contract

Rerunning the tick later must **resume** from existing issue comments + PR
state. It must NOT:

- Create a duplicate issue, branch, or worktree.
- Open a second PR for the same branch.
- Re-implement a change already committed to the branch.
- Overwrite a partial implementation from a concurrent run.

### Resume protocol

1. Re-run §4 (live-state fetch + duplicate-guard).
2. If the issue is `fleet:in-progress` with an active `lock:run-<id>` < 2h old
   and the lock is **not yours**: **no-op**. Do not clobber another run's
   worktree.
3. If the lock is older than 2h and the branch exists but has no open PR
   (abandoned run): adopt the worktree and continue from the last committed state
   rather than starting over.
4. If a PR already exists and gates are green: skip to Backlog-sync — post a
   progress update and transition the label to `fleet:review`.

### Idempotency keys

The **issue number** is the single idempotency key for every create action:

- Branch name contains `feat/<issue#>-` — existence check before creation.
- Worktree path contains `<issue#>` — existence check before `git worktree add`.
- PR head ref contains `feat/<issue#>-` — `gh pr list` check before `gh pr create`.
- Issue label — `gh issue view` check before `gh issue edit`.

---

## 10. Stop conditions, cleanup & hand-back

### Stop conditions

Stop the tick (claim no more issues) when any is true:

- No unblocked issue remains in the selected epic's chain (all done/review/blocked).
- The 2-issue claim cap for this tick is reached.
- A validation gate is red and cannot be fixed this tick — label `fleet:blocked`,
  comment the failure, stop.
- All sub-issues of the selected epic are `done` (closed/merged) — the epic is
  ready: open the epic → `main` PR and run the §8 Autonomous-merge
  gate (notify-then-merge). Merge autonomously if it holds; otherwise hand to the
  owner.
- GitHub auth or billing failure — log and stop; do not retry in a tight loop.

### Cleanup

1. Remove `lock:run-<id>` from every issue claimed this tick.
2. Leave `fleet:review` on any issue whose PR is open and awaiting review.
3. Optionally remove finished worktrees:
   ```bash
   git worktree remove /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<issue#>
   ```
4. Never force-push a shared branch (`feat/<issue#>-*` or
   `feat/epic-<epic#>-integration`).

### Hand-back to orchestrator

The loop produces:

- Git branches (one per claimed issue) pushed to `origin`.
- PRs targeting the epic branch (PR template, Conventional Commit titles).
- Issue comments with gate results and evidence.
- A proposed `feature_list.json` delta (as a comment or returned value).

The loop performs autonomously (when the §8 gate holds):

- Squash-merge of sub-issue PRs into the epic branch (`gh pr merge --squash`).
- The epic → `main` squash-merge (notify-then-merge).

The orchestrator/owner owns:

- Actual writes to `feature_list.json`.
- Any merge the §8 gate **blocked** (review not approved, red gate, conflicts, or
  a `fleet:blocked`/`hold:owner` label) — these are surfaced, not merged.
- Vetoing a pending merge via the `hold:owner` label.

---

## 11. Quick reference — one-tick checklist

Copy-paste at the start of each tick:

```
[ ] A1  git fetch origin --prune
[ ] A2  gh issue list --label epic + gh pr list — derive idempotency state
[ ] A3  Ensure fleet:*, lock:*, and hold:owner labels exist (create if missing)
[ ] A4  Duplicate-guard: no open PR, no fleet:in-progress, no active lock, no remote branch
[ ] B1  Select highest-priority open epic with unfinished children
[ ] B2  Select ≤2 unblocked sub-issues in dependency order (deps merged to epic branch)
[ ] C1  Ensure feat/epic-<epic#>-integration exists (create from origin/main once if not)
[ ] C2  git worktree add /home/carlomigueldy/dev/voxel-warlock-brawl-arena-worktrees/<n> -b feat/<n>-<slug> origin/feat/epic-<epic#>-integration
[ ] C3  npm ci (inside worktree)
[ ] C4  Set fleet:in-progress + lock:run-<id>; post claim comment; re-check guard
[ ] D1  Scout (Haiku): work brief + file globs
[ ] D2  Implementer (Sonnet): scoped changes; conventional commits; no AI attribution
[ ] D3  Reviewer (Opus): correctness + scope review
[ ] E   Gates: install → format:check → lint → typecheck → test → build → json.tool
[ ] F1  gh pr create (or update) targeting feat/epic-<epic#>-integration; PR template; conventional-commit title
[ ] F2  PR body: Summary, Related issues (Closes #n), Quality gates, Backlog sync
[ ] G   Post progress comment on issue; set fleet:review if not merging
[ ] G2  §8 Autonomous-merge gate (Opus approve + gates green + mergeable + no fleet:blocked/hold:owner)?
[ ] G3  Gate held → squash-merge sub-issue PR into epic branch + gh issue close <n>; else leave for owner
[ ] G4  Epic's children all done → open epic→main PR, re-run gate (fresh Opus epic review); notify then squash-merge to main
[ ] H1  Remove lock:run-<id> label
[ ] H2  Hand proposed feature_list.json delta to orchestrator
[ ] H3  Record stop condition (cap reached / no remaining issues / blocked / merged / epic merged to main)
```
