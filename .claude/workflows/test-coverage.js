/* Workflow runtime globals injected by the Claude Code Workflow engine. */
/* global args, agent, parallel, phase, log */

export const meta = {
  name: "test-coverage",
  description:
    "Haiku scout lists changed/uncovered source files → parallel Sonnet test-writers add tests per file → Opus reviews each suite for real (not vacuous) coverage",
  whenToUse:
    "Run to backfill or strengthen tests. Pass args: { base?, paths?, maxFiles? }. Defaults to files changed vs main. Opus rejects assertion-free or tautological tests and the writer revises once.",
  phases: [
    { title: "Discover" },
    { title: "Write" },
    { title: "Review", model: "opus" },
  ],
};

// ── Parameters ────────────────────────────────────────────────────────────
const BASE = (args && args.base) || "main";
const PATHS = (args && args.paths) || ""; // optional explicit scope override
// Clamp to a sane ceiling so untrusted input can never overflow the fan-out cap (≤4096).
const MAX_FILES = Math.min(
  Math.max((args && Number(args.maxFiles)) || 10, 1),
  50,
);

const HARD_RULES = `HARD RULES (CLAUDE.md): no AI/LLM attribution; Conventional Commits if committing; match the repo's existing test framework, file naming, and style — read a neighboring test first.`;

const TARGETS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["targets"],
  properties: {
    targets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceFile", "reason", "priority"],
        properties: {
          sourceFile: { type: "string" },
          reason: {
            type: "string",
            description: "Why it needs tests (changed / uncovered / risky)",
          },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

const WRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["testFile", "behaviors"],
  properties: {
    testFile: {
      type: "string",
      description:
        "Exact path of the test file created/edited in the working tree",
    },
    behaviors: {
      type: "array",
      items: { type: "string" },
      description:
        "Behaviors covered (happy path, edge cases, error paths, boundaries)",
    },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meaningful", "issues"],
  properties: {
    meaningful: {
      type: "boolean",
      description:
        "True only if tests assert real behavior and would catch regressions",
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description:
        "Vacuous assertions, missing edge cases, tautologies, mocks that hide the unit",
    },
  },
};

// ── Phase 1: Discover targets (Haiku/Explore) ───────────────────────────────
phase("Discover");
const scope = PATHS
  ? `the paths: ${PATHS}`
  : `files changed vs ${BASE} (run \`git fetch origin ${BASE}\` then \`git diff --name-only origin/${BASE}...HEAD\`)`;

const discovery = await agent(
  `You are a test-coverage scout. Identify source files in ${scope} that most need tests. Skip config, generated, and trivial files. For each, note why it needs coverage and a priority. Read enough to judge whether existing tests already cover it. Return structured output only.`,
  {
    label: "discover",
    phase: "Discover",
    schema: TARGETS_SCHEMA,
    agentType: "Explore",
  },
);

const ranked = ((discovery && discovery.targets) || []).sort((a, b) => {
  const order = { high: 0, medium: 1, low: 2 };
  return order[a.priority] - order[b.priority];
});
const targets = ranked.slice(0, MAX_FILES);

if (!targets.length) {
  return { note: "No files needing tests were found.", scope };
}
const dropped = ranked.length - targets.length;
if (dropped) {
  log(
    `Discover: capped ${ranked.length} candidates to ${targets.length} (dropped ${dropped} lower-priority targets).`,
  );
}
log(`Discover: ${targets.length} files to cover.`);

// ── Phase 2/3: Write tests (Sonnet) → Review assertions (Opus), per file ─────
function writePrompt(target, reviseNotes) {
  return `You are a Sonnet test author. Write or extend tests for: ${target.sourceFile}
Reason it needs coverage: ${target.reason}

First read the source file AND a neighboring existing test to copy the framework, imports, file-naming, and style. Then write tests that assert REAL behavior: happy path, edge cases, error paths, and boundaries. Avoid tautologies, snapshot-only tests, and over-mocking that hides the unit under test. ${HARD_RULES}${
    reviseNotes
      ? `\n\nA reviewer rejected your previous attempt. Fix these issues:\n${reviseNotes}`
      : ""
  }

Create/edit the test file in the working tree. Return structured output only: the exact testFile path and the list of behaviors you covered.`;
}

function reviewPrompt(target, write) {
  return `You are an Opus test reviewer. A Sonnet author added tests for source ${target.sourceFile}.
The author's test file is at: ${write.testFile}
Behaviors the author claims to cover: ${(write.behaviors || []).join("; ") || "(none reported)"}

Review ONLY the test file at ${write.testFile} for source ${target.sourceFile}; ignore any other test files present in the tree (other writers are editing the shared working tree concurrently). Read that exact test file AND the source. Judge whether the tests assert MEANINGFUL behavior that would actually catch regressions — not vacuous assertions, tautologies, snapshot-only coverage, or mocks that stub out the very logic being tested. List concrete issues. Return structured output only.`;
}

const results = await parallel(
  targets.map((target) => async () => {
    // Writer and reviewer share the default working tree so the Opus reviewer
    // can actually read the file the writer just created/edited. We deliberately
    // do NOT isolate writers in per-file worktrees: distinct source files map to
    // distinct test files, so parallel writers rarely collide, and worktree
    // isolation would hide the new test file from the reviewer — making the
    // meaningful-coverage gate vacuous. The only shared state is the git index,
    // which is acceptable for these non-committing edits. To disambiguate which
    // file the reviewer reads in the shared tree, the writer reports its exact
    // testFile path (WRITE_SCHEMA) and reviewPrompt pins the reviewer to it.
    let write = await agent(writePrompt(target, null), {
      label: `write:${target.sourceFile}`,
      phase: "Write",
      schema: WRITE_SCHEMA,
      model: "sonnet",
    });

    // agent() returns null if the writer is skipped or dies — don't burn an
    // Opus reviewer on a test file that was never written.
    if (!write) {
      return {
        sourceFile: target.sourceFile,
        testFile: null,
        behaviors: [],
        meaningful: null,
        remainingIssues: ["writer produced no output"],
      };
    }

    let review = await agent(reviewPrompt(target, write), {
      label: `review:${target.sourceFile}`,
      phase: "Review",
      schema: REVIEW_SCHEMA,
      model: "opus",
    });

    // One revision pass if the reviewer found the suite vacuous.
    if (review && !review.meaningful && review.issues.length) {
      const revised = await agent(
        writePrompt(target, review.issues.join("\n")),
        {
          label: `rewrite:${target.sourceFile}`,
          phase: "Write",
          schema: WRITE_SCHEMA,
          model: "sonnet",
        },
      );
      // Keep the prior write/review if the rewrite is skipped or dies.
      if (revised) {
        write = revised;
        review = await agent(reviewPrompt(target, write), {
          label: `re-review:${target.sourceFile}`,
          phase: "Review",
          schema: REVIEW_SCHEMA,
          model: "opus",
        });
      }
    }

    return {
      sourceFile: target.sourceFile,
      testFile: write.testFile,
      behaviors: write.behaviors || [],
      meaningful: review ? review.meaningful : null,
      remainingIssues: review ? review.issues : [],
    };
  }),
);

const done = results.filter(Boolean);
const solid = done.filter((r) => r.meaningful);
// Deterministic manifest of test files actually written, for the orchestrator
// to review/commit from the shared working tree.
const testFiles = done.map((r) => r.testFile).filter(Boolean);
log(
  `Tests written for ${done.length} files; ${solid.length} passed the meaningful-coverage review.`,
);

return {
  scope,
  filesCovered: done.length,
  meaningful: solid.length,
  testFiles,
  results: done,
};
