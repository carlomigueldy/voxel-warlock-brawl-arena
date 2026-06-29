/* Workflow runtime globals injected by the Claude Code Workflow engine. */
/* global args, agent, parallel, phase, log */

export const meta = {
  name: "bugfix-sweep",
  description:
    "Haiku/Explore scouts fan out to find bugs → dedupe → Sonnet fixers patch each in isolated worktrees in parallel → Opus verifies every fix",
  whenToUse:
    'Run for a batch cleanup of a target area. Pass args: { area, hints?, maxFixes? } where area scopes the search (e.g. "apps/web/src/lib" or "the notification pipeline"). Each fix lands in its own worktree branch for the orchestrator to integrate.',
  phases: [
    { title: "Scout" },
    { title: "Fix" },
    { title: "Verify", model: "opus" },
  ],
};

// ── Parameters ────────────────────────────────────────────────────────────
const AREA = (typeof args === "string" && args) || (args && args.area) || "";
const HINTS = (args && args.hints) || "";
// Clamp caller input so a single parallel() fan-out stays within the engine's
// ≤4096-items-per-call cap and within sane token budgets.
const MAX_FIXES = Math.min(
  64,
  Math.max(1, (args && Number(args.maxFixes)) || 8),
);
const SCOUTS = Math.min(8, Math.max(1, (args && Number(args.scouts)) || 3));

if (!AREA) {
  return { error: "No area provided. Pass args.area to scope the sweep." };
}

const HARD_RULES = `HARD RULES (CLAUDE.md): no AI/LLM attribution anywhere; Conventional Commits if you commit; match surrounding code style; commit to your worktree branch ONLY — never merge, rebase onto, or push to main, and leave all integration to the orchestrator.`;

const BUGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bugs"],
  properties: {
    bugs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "severity", "title", "detail"],
        properties: {
          file: { type: "string" },
          line: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "major", "minor"],
          },
          title: { type: "string" },
          detail: {
            type: "string",
            description: "Root cause + why it's wrong",
          },
        },
      },
    },
  },
};

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["branch", "files", "summary"],
  properties: {
    branch: {
      type: "string",
      description:
        "The git branch name the fix was committed to in this worktree",
    },
    files: {
      type: "array",
      items: { type: "string" },
      description: "Path(s) changed by the fix",
    },
    summary: { type: "string", description: "One-line description of the fix" },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fixed", "introducedRegression", "rationale"],
  properties: {
    fixed: {
      type: "boolean",
      description: "True if the bug is genuinely resolved",
    },
    introducedRegression: {
      type: "boolean",
      description: "True if the fix broke or risked something else",
    },
    rationale: { type: "string" },
  },
};

// ── Phase 1: Scout (Haiku/Explore, parallel, diverse angles) ────────────────
phase("Scout");
const ANGLES = [
  "error handling, null/undefined safety, and unhandled promise rejections",
  "logic correctness, edge cases, off-by-one, and boundary conditions",
  "resource/state issues: races, leaks, stale closures, incorrect async ordering",
];

const scouts = await parallel(
  Array.from({ length: SCOUTS }, (_, i) => {
    const angle = ANGLES[i % ANGLES.length];
    return () =>
      agent(
        `You are a bug-finding scout. Search the area "${AREA}" for real, concrete bugs — focus on: ${angle}.${
          HINTS ? `\nRequester hints: ${HINTS}` : ""
        }

Read the relevant files. Report only genuine defects with a clear root cause — no speculative "could be cleaner" items. Cite file and line. Return structured output only.`,
        {
          label: `scout:${i + 1}`,
          phase: "Scout",
          schema: BUGS_SCHEMA,
          agentType: "Explore",
        },
      );
  }),
);

const allBugs = scouts.filter(Boolean).flatMap((s) => s.bugs || []);
const seen = new Set();
const bugs = allBugs
  .filter((b) => {
    const k = `${b.file}|${b.line}|${b.title}`.slice(0, 160).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .sort((a, b) => {
    const order = { critical: 0, major: 1, minor: 2 };
    return order[a.severity] - order[b.severity];
  })
  .slice(0, MAX_FIXES);

if (allBugs.length > MAX_FIXES) {
  log(
    `Found ${allBugs.length} bugs; capping to ${MAX_FIXES} highest-severity (others dropped).`,
  );
}
log(`Scout: ${allBugs.length} raw → ${bugs.length} unique bugs to fix.`);

if (!bugs.length) {
  return { area: AREA, bugs: [], fixes: [], note: "No bugs found." };
}

// ── Phase 2/3: Fix each in an isolated worktree → Verify (Opus) ──────────────
// Worktree isolation lets fixers touch overlapping files in parallel without
// clobbering each other. Each fix is a separate branch the orchestrator integrates.
function fixPrompt(bug) {
  return `You are a Sonnet bug-fixer in an isolated worktree. Fix ONLY this bug:

${bug.file}:${bug.line} [${bug.severity}] — ${bug.title}
Root cause: ${bug.detail}

Read the file and its neighbors, apply a minimal, correct fix, and commit it with a Conventional Commit message (e.g. "fix(scope): <what>"). ${HARD_RULES}

Report the exact git branch name your commit landed on (run \`git rev-parse --abbrev-ref HEAD\`), the file(s) changed, and a one-line description. Return structured output only.`;
}

function verifyPrompt(bug, fix) {
  return `You are a skeptical Opus verifier. A fixer claims to have resolved this bug on branch "${fix.branch}":

${bug.file}:${bug.line} [${bug.severity}] — ${bug.title}
Root cause: ${bug.detail}
Fixer reported: ${fix.summary}
Files changed: ${(fix.files || []).join(", ")}

Do NOT \`git checkout\` the branch — it is checked out in the fixer's worktree and git will refuse. Inspect the fixer's committed change with READ-ONLY ref commands that resolve from the shared object store of any workspace:
- \`git show ${fix.branch}\` — view the fix commit and its full diff.
- \`git diff ${fix.branch}^..${fix.branch} -- ${(fix.files || []).join(" ") || bug.file}\` — the fix commit's diff scoped to the changed files (anchored on the branch's parent, so it works whether the branch forked from main or an epic integration branch).
Read enough surrounding code (e.g. \`git show ${fix.branch}:${bug.file}\`) to judge correctness. Refute by default: set fixed=true ONLY if you have read the actual diff and the bug is genuinely resolved. Independently check the diff did not introduce a regression or alter unrelated behavior. Return structured output only.`;
}

const fixes = await parallel(
  bugs.map((bug) => async () => {
    const fix = await agent(fixPrompt(bug), {
      label: `fix:${bug.file}`,
      phase: "Fix",
      model: "sonnet",
      schema: FIX_SCHEMA,
      isolation: "worktree",
    });
    if (!fix || !fix.branch) return { bug, fixed: false, note: "fixer failed" };
    // Verify in the default workspace (no isolation): linked worktrees share the
    // object store and refs, so `git show`/`git diff` resolve the fixer's
    // committed branch read-only WITHOUT checking it out (which git refuses since
    // the fixer's worktree still holds that branch). The verifier mutates nothing,
    // so a separate worktree would be unjustified expense per the runtime contract.
    const verdict = await agent(verifyPrompt(bug, fix), {
      label: `verify:${bug.file}`,
      phase: "Verify",
      model: "opus",
      schema: VERIFY_SCHEMA,
    });
    return { bug, fix, verdict };
  }),
);

const results = fixes.filter(Boolean);
const confirmed = results.filter(
  (r) => r.verdict && r.verdict.fixed && !r.verdict.introducedRegression,
);

log(
  `Verified ${confirmed.length}/${results.length} fixes clean. Each lives in its own worktree branch for integration.`,
);

return {
  area: AREA,
  bugsFound: allBugs.length,
  attempted: results.length,
  confirmed: confirmed.length,
  results,
};
