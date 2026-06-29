/* Workflow runtime globals injected by the Claude Code Workflow engine. */
/* global args, agent, parallel, phase, log */

export const meta = {
  name: "adversarial-code-review",
  description:
    "Multi-lens Opus adversarial review of a diff/PR: parallel correctness/security/scope reviewers → dedupe → independent verify → confirmed verdict",
  whenToUse:
    'Run before merging any branch/PR to surface real defects. Pass args to set the diff source, e.g. args: { base: "main" } or args: { pr: 87 }. Defaults to the working diff vs the merge-base with main.',
  phases: [
    { title: "Review", model: "opus" },
    { title: "Verify", model: "opus" },
  ],
};

// ── Parameters ────────────────────────────────────────────────────────────
// args: { base?: string, pr?: number, focus?: string }
const BASE = (args && args.base) || "main";
const PR = args && args.pr;
const FOCUS = (args && args.focus) || "";

const DIFF_SOURCE = PR
  ? `the GitHub pull request #${PR} (use \`gh pr diff ${PR}\` and \`gh pr view ${PR}\`)`
  : `the working branch's diff against its merge-base with ${BASE} (use \`git fetch origin ${BASE}\` then \`git diff origin/${BASE}...HEAD\`)`;

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "file", "line", "title", "detail", "fix"],
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "nit"],
          },
          file: { type: "string" },
          line: { type: "string", description: "Line number or range" },
          title: { type: "string", description: "One-line defect summary" },
          detail: { type: "string", description: "Why it is a defect" },
          fix: { type: "string", description: "Concrete suggested fix" },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isReal", "confidence", "rationale"],
  properties: {
    isReal: {
      type: "boolean",
      description: "True only if the defect genuinely exists in the diff",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
  },
};

const LENSES = [
  {
    key: "correctness",
    brief:
      "You are an adversarial CORRECTNESS reviewer. Hunt for logic bugs, off-by-one errors, unhandled edge cases, race conditions, incorrect error handling, broken control flow, and contract violations between caller and callee.",
  },
  {
    key: "security",
    brief:
      "You are an adversarial SECURITY reviewer. Hunt for injection (SQL/command/XSS), missing authz/authn, secret leakage, unsafe deserialization, SSRF, path traversal, missing input validation, and insecure defaults. Be concrete about exploitability.",
  },
  {
    key: "scope-regression",
    brief:
      "You are an adversarial SCOPE & REGRESSION reviewer. Flag changes outside the stated intent, dead code, removed safeguards, breaking API/contract changes, and behavior the diff silently alters. Verify nothing unrelated was touched.",
  },
];

function reviewPrompt(lens) {
  return `${lens.brief}

Review ${DIFF_SOURCE}. Read the full diff fresh right now, and open any referenced file to understand surrounding context before judging.${
    FOCUS ? `\n\nExtra focus from the requester: ${FOCUS}` : ""
  }

Report only DEFECTS THE DIFF INTRODUCES OR FAILS TO HANDLE — do not report pre-existing issues in untouched code, and do not pad with stylistic taste. Each finding must be specific enough that an engineer can act on it without guessing: name the file, the line, the concrete problem, and a fix. If the diff is clean for your lens, return an empty findings array. Return structured output only.`;
}

function verifyPrompt(f) {
  return `You are a skeptical verifier. Another reviewer claims this defect exists in ${DIFF_SOURCE}:

[${f.severity}] ${f.file}:${f.line} — ${f.title}
Detail: ${f.detail}

Read the actual diff and surrounding code yourself. Try to REFUTE the claim. Set isReal=false if the code already handles it, the reviewer misread the diff, or it is a pre-existing/untouched issue. Set isReal=true only if you independently confirm the defect is real and introduced/left-unhandled by this diff. Return structured output only.`;
}

// ── Pipeline: each lens reviews, then each of its findings is verified ───────
const perLens = await parallel(
  LENSES.map((lens) => async () => {
    const review = await agent(reviewPrompt(lens), {
      label: `review:${lens.key}`,
      phase: "Review",
      schema: FINDINGS_SCHEMA,
      model: "opus",
    });
    return { lens: lens.key, findings: (review && review.findings) || [] };
  }),
);

const all = perLens.filter(Boolean).flatMap((r) => r.findings);

// Dedupe by file+line+title before spending verify agents.
const seen = new Set();
const deduped = all.filter((f) => {
  const k = `${f.file}|${f.line}|${f.title}`.slice(0, 160).toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Verify highest-severity findings first, and bound the fan-out so a
// pathological/gaming reviewer (or a huge diff) can't exceed the engine's
// per-parallel item cap. Any drop is logged, never silent.
const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2, nit: 3 };
const dedupedSorted = deduped
  .slice()
  .sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
  );

const MAX_VERIFY = 200;
const toVerify = dedupedSorted.slice(0, MAX_VERIFY);

log(
  `Review: ${all.length} raw findings → ${deduped.length} unique. Verifying each adversarially.`,
);
if (deduped.length > MAX_VERIFY) {
  log(
    `Capping verify at ${MAX_VERIFY}/${deduped.length} findings (highest-severity first); ${deduped.length - MAX_VERIFY} unverified.`,
  );
}

const verified = await parallel(
  toVerify.map((f) => async () => {
    const v = await agent(verifyPrompt(f), {
      label: `verify:${f.file}`,
      phase: "Verify",
      schema: VERDICT_SCHEMA,
      model: "opus",
    });
    return { ...f, verdict: v };
  }),
);

const confirmed = verified
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.isReal)
  .sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
  );

log(
  `Confirmed ${confirmed.length} real defects (${confirmed.filter((f) => f.severity === "critical").length} critical, ${confirmed.filter((f) => f.severity === "major").length} major).`,
);

return {
  source: PR ? `PR #${PR}` : `diff vs ${BASE}`,
  rawFindings: all.length,
  confirmed,
};
