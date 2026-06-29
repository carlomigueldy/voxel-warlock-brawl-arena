/* Workflow runtime globals injected by the Claude Code Workflow engine. */
/* global args, agent, parallel, phase, log */

export const meta = {
  name: "adversarial-claude-md-review",
  description:
    "Adversarially review an agent-instruction file (default CLAUDE.md) against a 10/10 harness rubric; Opus fixer iterates until a unanimous clean pass or max rounds",
  whenToUse:
    'Run after changing CLAUDE.md / AGENTS.md (or any agent-instruction doc) to harden it. Pass args to target a different file or change the round cap, e.g. args: { file: "apps/web/CLAUDE.md", maxRounds: 4 }.',
  phases: [{ title: "Review" }, { title: "Fix", model: "opus" }],
};

// ── Parameters ────────────────────────────────────────────────────────────
// args may be a string (the file path) or an object { file, maxRounds }.
const FILE =
  (typeof args === "string" && args) || (args && args.file) || "CLAUDE.md"; // resolved relative to the repo root the agents run in
const MAX_ROUNDS = (args && Number(args.maxRounds)) || 6;

const RUBRIC = `Score the file (an agent/orchestrator instruction contract) on each of these 10 dimensions, 0-1 each (1 = flawless), for a max of 10:
1. Clarity — every directive is unambiguous; no vague language an agent could misread.
2. Completeness — no missing rule, role, or workflow an agent would need; no dangling references.
3. Consistency — zero internal contradictions; aligns with every file it references.
4. Conciseness — no bloat, no redundancy; nothing repeated that a link could carry.
5. Actionability — directives are testable/enforceable, not aspirational.
6. Correctness — every rule is technically sound (git, gh, conventional commits, merge strategy, any symlink/nesting claims).
7. Prioritization — hard/non-negotiable rules are unmistakably elevated above guidance; precedence is clear.
8. Adversarial robustness — resists misreading, loophole-seeking, and "technically complied" gaming by a lazy or adversarial agent.
9. Structure & navigability — headings, ordering, and skimmability serve an agent reading under load.
10. Self-consistency of any canonical/symlink + nested-context model the file describes — coherent and won't break tooling.`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "dimensions", "findings", "verdict"],
  properties: {
    overallScore: {
      type: "number",
      description: "Sum of the 10 dimension scores, 0-10",
    },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "notes"],
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      description: "Concrete defects. Empty only if truly flawless.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "location", "problem", "suggestedFix"],
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "nit"],
          },
          location: {
            type: "string",
            description: "Section/line/quote in the reviewed file",
          },
          problem: { type: "string" },
          suggestedFix: { type: "string" },
        },
      },
    },
    verdict: { type: "string", enum: ["pass", "needs-fix"] },
  },
};

const LENSES = [
  {
    key: "rule-lawyer",
    brief: `You are an adversarial RULE-LAWYER harness engineer. Hunt for loopholes: rules an agent could "technically comply" with while violating intent, undefined precedence, escape hatches, and unenforceable shoulds. Assume the reading agent is lazy and looking for the easiest interpretation.`,
  },
  {
    key: "completeness-consistency",
    brief: `You are an adversarial COMPLETENESS & CONSISTENCY harness engineer. Cross-check every claim and reference against reality. Read every file the document references and verify it does not contradict them or point at things that don't exist. Flag missing rules and dangling refs.`,
  },
  {
    key: "mechanics-correctness",
    brief: `You are an adversarial MECHANICS-CORRECTNESS harness engineer. Stress-test technical accuracy: git/gh commands, conventional-commits semantics, merge-strategy claims, and any symlink / per-directory nested-context model the file describes. Will any of it break a real tool, a routine/cron, or a fresh agent? Verify any symlink/path it claims actually exists as described.`,
  },
];

function reviewPrompt(lens, round, priorFixSummary) {
  return `${lens.brief}

Read the file at ${FILE} FRESH from disk right now (it may have just been edited).${
    priorFixSummary
      ? `\n\nThis is review round ${round}. The previous round's fixer reported:\n${priorFixSummary}\nDo NOT assume those fixes are correct — re-verify them adversarially and look for regressions or new problems they introduced.`
      : ""
  }

You may read any referenced repo file to verify claims. Then score the document against this rubric:

${RUBRIC}

Be ruthless. A 10/10 means a hostile, lazy agent could not misread or game a single directive, every reference is accurate, and nothing is missing, redundant, or technically wrong.

SCORING CALIBRATION — read carefully, this is binding:
- A dimension may score BELOW 1.0 ONLY if you also emit a concrete finding (critical/major/minor) that, once fixed, would raise it to 1.0. No finding ⇒ that dimension scores 1.0. You may NOT dock fractional points for stylistic taste, "could be tighter", "slightly dense", tone, or preference — only for an objective defect an editor could act on.
- A "nit" severity is for cosmetic preferences and MUST NOT lower any dimension below 1.0; nits never block a 10/10.
- Do not invent new defects to justify a sub-10 score. If the prior round already fixed every real defect and you find no new objective one, the honest score is 10/10 with verdict "pass" and empty findings (or nits only). Awarding 10/10 when warranted is correct, not lenient.
- Conversely, never round up past a real unfixed defect.

Reserve overallScore 10 only if findings contains zero critical/major/minor items (nits alone are acceptable for a 10). Return structured output only — it is data, not prose for a human.`;
}

function fixPrompt(round, findings) {
  const list = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] (${f.location}) ${f.problem}\n   Suggested: ${f.suggestedFix}`,
    )
    .join("\n");
  return `You are an expert harness engineer with Edit/Write access. Round ${round}: fix ${FILE} to resolve the adversarial-review findings below WITHOUT degrading it.

Findings (union of the adversarial reviewers):
${list}

Rules for your edit:
- Read ${FILE} fresh, then apply targeted edits. If a sibling AGENTS.md is a symlink to this file, edit the canonical file only.
- Resolve every critical/major finding; resolve minor findings unless doing so conflicts with a hard rule or another finding (explain any you skip).
- PRESERVE the document's hard rules, its orchestrator/delegation model, any nested-context model, and its generic (no hardcoded personal identifiers) conventions.
- Do not introduce contradictions, dangling references, bloat, or claims you haven't verified. Keep it tight.
- Conventional-commits / merge-strategy / symlink facts must stay technically correct.
After editing, return a concise summary of exactly what you changed and which findings (by number) you resolved or deliberately skipped (with reason).`;
}

// ── Loop: review → fix until unanimous clean pass or MAX_ROUNDS ─────────────
let priorFixSummary = null;
const rounds = [];

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Review");
  const reviews = (
    await parallel(
      LENSES.map(
        (lens) => () =>
          agent(reviewPrompt(lens, round, priorFixSummary), {
            label: `r${round}:review:${lens.key}`,
            phase: "Review",
            schema: REVIEW_SCHEMA,
            model: "opus",
          }),
      ),
    )
  ).filter(Boolean);

  if (!reviews.length) {
    log(`Round ${round}: all reviewers failed — aborting.`);
    break;
  }

  const minScore = Math.min(...reviews.map((r) => r.overallScore));
  const avgScore = (
    reviews.reduce((s, r) => s + r.overallScore, 0) / reviews.length
  ).toFixed(2);
  const blocking = reviews
    .flatMap((r) => r.findings)
    .filter((f) => ["critical", "major", "minor"].includes(f.severity));

  // Dedupe blocking findings so the fixer isn't handed the same defect 3×.
  const seen = new Set();
  const deduped = blocking.filter((f) => {
    const k = (f.location + "|" + f.problem).slice(0, 160);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  log(
    `Round ${round}: min=${minScore}/10 avg=${avgScore}/10 · ${reviews.length} reviewers · ${deduped.length} blocking findings`,
  );
  rounds.push({ round, minScore, avgScore, blocking: deduped.length });

  const allPass =
    reviews.every((r) => r.verdict === "pass") &&
    minScore >= 10 &&
    deduped.length === 0;
  if (allPass) {
    log(`Round ${round}: clean 10/10 from all reviewers — stopping.`);
    return { result: "passed", file: FILE, rounds, finalRound: round };
  }

  if (round === MAX_ROUNDS) {
    log(
      `Round ${round} (max) reached without unanimous 10/10. Best min=${minScore}. Applying a final fix pass.`,
    );
  }

  phase("Fix");
  priorFixSummary = await agent(fixPrompt(round, deduped), {
    label: `r${round}:opus-fix`,
    phase: "Fix",
    model: "opus",
  });
}

return { result: "max-iterations-or-stopped", file: FILE, rounds };
