# Backlog Maintenance Workflow

Use this workflow whenever an agent creates, updates, decomposes, closes, or audits project tasks.

## 1. Ground in current repo state

1. Run `git status --short` and avoid touching unrelated changes.
2. Read README.md, and `feature_list.json` before changing backlog structure.
3. If project docs and `feature_list.json` disagree, preserve the current issue state and explicitly reconcile the discrepancy in the backlog update.

## 2. Check GitHub before creating tasks

1. Confirm authentication and repository:
   - `gh auth status -h github.com`
   - `gh repo view --json nameWithOwner,url,defaultBranchRef`
2. Check existing issues before creating duplicates:
   - `gh issue list --state all --limit 200 --json number,title,state,labels,url`
3. Check labels before creating labels:
   - `gh label list --limit 200 --json name,color,description`

## 3. Create or update labels

Use consistent labels:

- Structure: `epic`, `sub-issue`
- Phase: mvp, v1
- Area: docs, gameplay, rendering, multiplayer, ui, audio, infra

Only add new labels when they improve filtering or ownership.

## 4. Create epics and sub-issues

For each epic:

1. Create the epic issue with labels including `epic` and its phase.
2. Create child issues with labels including `sub-issue` and their phase/area labels.
3. Put this metadata in every issue body:
   - Stable backlog ID
   - Phase
   - Priority
   - Status
   - Parent epic, for child issues
   - Dependencies
   - Acceptance criteria
   - Source docs
4. Edit the epic body after child issue creation so it contains checkbox links to all child issues.

## 5. Update `feature_list.json`

For every issue-backed feature, keep these fields current:

- `id`
- `title`
- `type`
- `phase`
- `status`
- `priority`
- `labels`
- `issue.number`
- `issue.url`
- `parent` for sub-issues
- `subissues` for epics
- `dependencies`
- `acceptance_criteria`
- `source_docs`
- `summary`

Run `python3 -m json.tool feature_list.json >/tmp/feature_list.validate.json` before finishing.

## 6. Finish with an audit summary

Return:

- Files changed
- GitHub issues created or updated, with number/title/URL
- Labels created or updated, if relevant
- Any GitHub CLI failures or blockers
- Any repo files intentionally not touched because they were out of scope
