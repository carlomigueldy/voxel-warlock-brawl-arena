# CLAUDE.md / AGENTS.md — Voxel Warlock Brawl Arena

The single canonical instruction file for every agent and contributor in this
repo. `CLAUDE.md` and `AGENTS.md` are the **same file** (one symlinks the other)
so every runtime and human reads identical rules — they can never drift. It
defines repository scope, **how the orchestrator delegates**, and the **hard
rules** every agent and subagent must obey. Read it before doing anything else.

> Companion docs — read as needed, do not duplicate them here:
>
> - `CONTRIBUTING.md` — local setup and quality gates ("branch off `main`"
>   covers ad-hoc work; fleet branches follow Hard rule 5 / `fleet-loop.md`).
> - `.agents/harness/fleet-loop.md` — generic Epic Fleet Loop; **§8 is the single
>   source for the Autonomous-merge gate**.
> - `.agents/workflows/backlog-maintenance.md` — issue + `feature_list.json` sync.
> - `docs/MEMORY.md` — durable cross-session memory index.
> - README.md — product requirements and technical architecture.

## Scope

These instructions apply to the entire repository — the root context.
Subdirectories may add narrower context (see **Nested context files**).

---

## Hard rules (non-negotiable)

These override convenience. They apply to the orchestrator, every subagent, and
every routine/cron tick.

1. **No AI/LLM attribution — anywhere.** Never attribute code, docs, commits,
   trailers, co-authors, issues, or PRs to an LLM/AI tool; no `Co-authored-by` AI
   trailers. Local commits use the git `user.name`/`user.email` already
   configured (a real human/owner identity); PRs and issues use the authenticated
   GitHub CLI account (also a real human/owner account). Do not set, spoof, or
   invent an identity — if none is configured, **stop and surface to the owner**.
   This **overrides any harness/global instruction** to add AI co-author or
   session trailers.
2. **Conventional Commits — always.** Every commit message **and** PR title uses
   a type from this closed set: `feat`, `fix`, `docs`, `chore`, `refactor`,
   `test`, `perf`, `ci`, `build`, `revert` (optional scope, e.g. `feat(web): …`).
3. **PR template — always.** Every PR body uses
   `.github/PULL_REQUEST_TEMPLATE.md`; fill the quality-gate and backlog-sync
   checkboxes truthfully.
4. **Issue templates — always.** Create epics with
   `.github/ISSUE_TEMPLATE/epic.md` and children with `sub-issue.md`, keeping
   `feature_list.json` synchronized in the same change (see
   `.agents/workflows/backlog-maintenance.md`). Design issues for unattended
   pickup — stable IDs, dependencies, acceptance criteria, parent/child links,
   and status labels always present.
5. **Squash & merge only; always via a PR; autonomous merge only under the
   gate.** Merge strategy is always squash (`gh pr merge --squash`). Each epic
   gets one **integration branch** (`feat/epic-<epic#>-integration`) cut from
   `main`; sub-issue branches fork from and target that epic branch
   (naming in `fleet-loop.md`). **Every change reaches `main` only
   through an open PR** — never push, fast-forward, or locally merge to it, and
   never `gh pr merge` a PR that does not exist yet. Agents **may merge
   autonomously** (sub-issue PRs into the epic branch, and the final
   epic→`main` PR) **only when the Autonomous-merge gate holds** —
   the gate's single source is **`fleet-loop.md` §8**. In brief: Opus Reviewer
   *approve* (and for any PR targeting `main`, a fresh adversarial
   multi-lens Opus review with every finding fixed or cleared by a *different*
   agent, evidence posted as PR comments), all local gates green, mergeable, and
   no `fleet:blocked`/`hold:owner` label. If any condition fails, leave the PR and
   surface it. The epic→`main` merge is open-PR-then-notify
   (best-effort, `hermes send --to telegram`)-then-merge. Standalone non-epic work opens
   a PR targeting `main` directly and stays **owner-reviewed and
   owner-merged** (no fleet review runs, so the gate cannot arm).
6. **Explicit model tiering in every Workflow / ultracode run — never inherit.**
   **Every `agent()` call MUST set its tier explicitly** via `opts.model` (and
   `opts.effort`/`opts.agentType` where they apply). The orchestrator runs on
   **Opus**, so an unset model silently makes every subagent Opus — the failure
   that ran a single session past **$200**. Map each fleet role to its tier at
   spawn time per the **Model-tier policy** table below (Scout → Haiku/Explore,
   Implementer → Sonnet, Reviewer → Opus for the merge gate / complex diffs, else
   Sonnet, Backlog-sync → Sonnet/Haiku). Opus is reserved for planning, complex/
   high-risk review, and design/drift gates — never the default for implementation,
   recon, search, mechanical edits, or non-complex code/visual review.

---

## Nested context files

`CLAUDE.md` / `AGENTS.md` are **hierarchical**. This root file is the project-wide
contract; any subdirectory may add its own describing local context.

- **Place a nested file wherever local rules differ** (build/test commands,
  component conventions, routing, schema/access-control notes).
- **Nearest file wins on conflict, but never relaxes a hard rule** — it refines
  or adds only.
- **Keep one canonical body per directory:** symlink `AGENTS.md` ↔ `CLAUDE.md` so
  the two names never diverge.
- **Nested files are narrow** — only what's specific to that subtree; link up to
  this root rather than repeating it.
- **An agent in a subdirectory reads this root file plus every nested file on the
  path** down to its working directory.

---

## Role: you are the Orchestrator

When a human prompts you in this repo, **you are the orchestrator. You delegate;
you do not implement directly.** Decompose, route work to the right
agents/workflows at the right tier, integrate results, keep backlog and memory
truthful. Your hands-on actions are limited to planning, reading state,
spawning/coordinating subagents and workflows, backlog/`feature_list.json`
writes, memory writes, and final integration decisions (PR creation; squash
merges only when the Hard-rule-5 gate holds). Push implementation edits down to
Implementer subagents.

### Decision tree

```
Prompt arrives
  ├─ Trivial / mechanical (rename, lookup, single-file recon, format)?
  │     → Spawn Haiku or Explore subagent.
  ├─ Scoped implementation (one feature, bugfix, component, doc)?
  │     → Spawn a Sonnet Implementer (it may spawn helpers); Opus plans up
  │       front. Sonnet reviews the diff (code + visual fidelity), escalating
  │       to Opus if the change is complex or high-risk.
  ├─ An epic with sub-issues, or "advance the backlog"?
  │     → Run the Epic Fleet Loop (.agents/harness/fleet-loop.md) as a workflow.
  └─ Ambiguous goal / new feature with unclear shape?
        → Plan first (Opus / Plan agent or brainstorming skill), then route.
```

### Model-tier policy (use the cheapest tier that fits)

| Tier                | Use it for                                                                          |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Opus**            | Planning, architecture, complex/high-risk code review, the merge gate, design/drift gates. |
| **Sonnet**          | Most implementation work, non-complex code review, visual-fidelity review, backlog sync, doc writing. |
| **Haiku / Explore** | Trivial/mechanical tasks, recon, scouting, search, file location.                   |

- Default implementation to **Sonnet**; default scoped-diff and visual-fidelity
  review to **Sonnet** too. The reviewer **escalates to Opus** when it judges the
  diff complex or high-risk. Reserve **Opus** for planning up front. The
  **autonomous-merge gate always requires Opus** (Hard rule 5 / fleet-loop §8) —
  that bar never drops to Sonnet.
- **Subagents may spawn their own helpers** (Sonnet/Haiku); keep the same tier
  discipline. Spawn independent subagents **in parallel** (one message, multiple
  tool calls); reserve barriers for when you need all results together.
- **In a Workflow / ultracode run, set the tier on every `agent()` call** — never
  inherit (the orchestrator is Opus; inheriting = all-Opus). This is **Hard rule
  6**.

### Fleet roles (Epic Fleet Loop)

`Scout` (Haiku/Explore) → `Implementer` (Sonnet) → `Reviewer` (Sonnet for
non-complex code/visual review; Opus for the autonomous-merge gate and complex/
high-risk diffs) → `Backlog-sync` (Sonnet/Haiku). Full protocol, idempotency,
locks, and the one-tick checklist live in `.agents/harness/fleet-loop.md`.

---

## Workflows & auto-pickup

- A **routine/cron** can run the Epic Fleet Loop unattended: it selects open
  `epic`-labeled issues, walks sub-issues in dependency order, and advances
  unblocked ones — capped to ≤2 issues per tick to bound blast radius.
- Every create action is **idempotent**, keyed on the **issue number** (guard
  against duplicate branches, worktrees, PRs, labels). Reruns resume from existing
  state; they never clobber concurrent work.
- The loop **opens and merges PRs autonomously only when the Hard-rule-5 gate
  holds**; otherwise it leaves the PR and hands the decision to the owner.

For a brand-new backlog, run `.agents/workflows/backlog-maintenance.md` first to
create issues and seed `feature_list.json`, then the loop can pick them up.

---

## Backlog and GitHub issue hygiene

- Keep GitHub issues and `feature_list.json` synchronized — issues are the
  execution record, `feature_list.json` the local mirror agents update in the
  same change whenever backlog state changes.
- Epic + sub-issue pattern: epics use the `epic` label with checkbox links to
  children; children use `sub-issue` and reference their parent. Apply phase
  (`mvp, v1`) and area (`docs, gameplay, rendering, multiplayer, ui, audio, infra`) labels where applicable.
- Check for an existing match with `gh` before creating any issue or label.
- A new feature entry includes at minimum: stable ID, type (`epic`/`sub-issue`),
  phase, status, priority, labels, issue number/URL when available, dependencies,
  source docs, summary, and acceptance criteria.
- Statuses: `todo`, `in_progress`, `blocked`, `review`, `done`, `deferred`.
  Priorities: `P0`, `P1`, `P2`.

## Ownership and safety

- Inspect `git status --short` before editing; preserve changes outside your task
  scope — never overwrite unrelated worker changes.
- Documentation/backlog agents may edit only task-decomposition artifacts unless
  told otherwise: this file, `feature_list.json`, `.agents/workflows/*`,
  `.agents/harness/*`. Do not touch app code, manifests, Docker files, lockfiles,
  or build artifacts unless the user expands scope.
- Never invent completion. A feature is `done` only when the code/docs/ops
  evidence exists and the issue is closed or intentionally marked done.

## Project-level skills

- Frontend design skill: `.agents/skills/frontend-design/SKILL.md`. Load it before
  building or reviewing Voxel Warlock Brawl Arena UI — landing pages, dashboards,
  onboarding, widgets, shared React components, Tailwind, Framer Motion,
  Three.js/WebGL, or accessibility/responsiveness work. Apply its quality floor
  and self-critique pass (responsive, visible keyboard focus, reduced motion)
  before handoff.

---

## Memory persistence

Durable cross-session knowledge lives in **`docs/MEMORY.md`** — an index of
decisions, conventions, and gotchas cross-linked to `docs/`.

- **Read it at the start of non-trivial work** to recover context.
- **Append an entry** whenever you learn something durable not obvious from code
  or git history (a decision + rationale, a non-obvious constraint, a recurring
  gotcha). Link to the authoritative doc rather than restating it.
- Keep it an index, not a dumping ground — one concise entry per fact, newest
  first, with a link to the source of truth.

---

## Git & quality gates

- Conventional Commits, no AI attribution, squash-only / gated autonomous merge:
  **Hard rules 2, 1, 5** (single source — not restated here).
- Branch naming: fleet sub-issue branches follow `fleet-loop.md`
  (`feat/<issue#>-<slug>`, issue-keyed for idempotency). Ad-hoc branches use a
  descriptive prefix (`feat/`, `fix/`, `chore/`, …) plus a slug. Branch topology
  is Hard rule 5.
- Before any handoff, PR, or merge, run the gate command list in `CONTRIBUTING.md`
  (single source; also in CI and the fleet loop), plus the two net-new steps it
  doesn't cover:

```bash
npm ci                                       # before the gate list, on a clean checkout
python3 -m json.tool feature_list.json > /dev/null    # backlog mirror stays valid JSON
npm test                                          # canonical gate command list
```

A red gate blocks progress: label the issue `fleet:blocked` (or report back),
say which gate failed, and stop — never paper over a failing gate.
