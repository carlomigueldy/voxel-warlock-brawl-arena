# Contributing to Voxel Warlock Brawl Arena

This is a private project. These notes keep changes consistent for the core
team and any AI/automation agents working in the repo. Agents should also read
[`AGENTS.md`](AGENTS.md) and [`.agents/workflows/backlog-maintenance.md`](.agents/workflows/backlog-maintenance.md).

## Prerequisites

- Node.js **20.20+** (see [`.nvmrc`](.nvmrc); run `nvm use`)
- npm **9.15+** via Corepack (`corepack enable`)

```bash
corepack enable
npm ci
npm dev
```

## Workflow

1. Branch off `main`. Use a descriptive prefix (`feat/`, `fix/`, `chore/`, …).
   Exception: fleet-loop epic sub-issues fork from and target the epic
   integration branch, not `main` — see [`AGENTS.md`](AGENTS.md) Hard rule 5.
2. Keep GitHub issues and [`feature_list.json`](feature_list.json) in sync — see
   the backlog-maintenance workflow. The epic + sub-issue pattern and the
   `feature_list.json` mirror are the source of truth for scope and status.
3. Run the quality gates locally before opening a PR (they also run in CI):

   ```bash
npm test
   ```

4. Open a PR into `main` and fill out the PR template. Exception: fleet-loop
   epic sub-issue PRs target the epic integration branch, not `main` — see
   [`AGENTS.md`](AGENTS.md) Hard rule 5.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) with a type
  from the closed set in [`AGENTS.md`](AGENTS.md) Hard rule 2 (the authoritative
  list): one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`,
  `ci`, `build`, `revert`.
- Do **not** attribute commits, PRs, or issues to an LLM/AI tool.
- A Husky `pre-commit` hook runs `lint-staged` (ESLint + Prettier on staged
  files). CI re-runs the full gates so fresh clones are protected even without
  local hooks.

## Project layout

See the "Repository layout" section in [`README.md`](README.md).
