/* Workflow runtime globals injected by the Claude Code Workflow engine. */
/* global args, agent, parallel, phase, log */

export const meta = {
  name: "review-dev-workflows",
  description:
    "Adversarially review each reusable dev-workflow script against a 10/10 workflow-quality rubric (Opus, 3 lenses) and have an Opus fixer resolve findings in a loop until a clean pass — optimizing for token efficiency and high-quality outputs",
  whenToUse:
    "Run after authoring/editing the .claude/workflows/*.js dev workflows to harden them. Pass args: { files?: string[], maxRounds?: number }.",
  phases: [
    { title: "Review", model: "opus" },
    { title: "Fix", model: "opus" },
  ],
};

// ── Parameters ────────────────────────────────────────────────────────────
const FILES = (args && Array.isArray(args.files) && args.files) || [
  ".claude/workflows/feature-implementation.js",
  ".claude/workflows/adversarial-code-review.js",
  ".claude/workflows/bugfix-sweep.js",
  ".claude/workflows/test-coverage.js",
];
const MAX_ROUNDS = (args && Number(args.maxRounds)) || 4;

const RUNTIME_FACTS = `WORKFLOW RUNTIME CONTRACT (the script runs in the Claude Code Workflow engine — judge against THIS, not generic Node):
- Globals available: args, agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), phase(title), log(msg). No filesystem/Node APIs.
- Date.now(), new Date() (argless), and Math.random() THROW — using them is a critical defect. Vary by index instead.
- agent() returns final text by default, or the validated object when opts.schema is passed; returns null if the agent is skipped or dies — callers MUST .filter(Boolean) / null-guard.
- parallel() is a BARRIER (awaits all; failed thunks resolve to null). pipeline() has NO barrier between stages and is the DEFAULT for multi-stage work.
- Concurrency cap is min(16, cores-2); a single parallel/pipeline call accepts ≤4096 items.
- opts: { label, phase, schema, model: 'opus'|'sonnet'|'haiku', effort, isolation: 'worktree', agentType }. schema must be valid JSON Schema; worktree isolation is expensive — justified only for parallel file mutation that would otherwise conflict.
- meta must be a PURE LITERAL (no variables/calls); meta.phases titles should match phase()/opts.phase strings.`;

const REPO_RULES = `REPO HARD RULES these workflows must enforce in the agents they spawn (CLAUDE.md): no AI/LLM attribution anywhere; Conventional Commits; cheapest-tier-that-fits (Opus=plan/review, Sonnet=implement, Haiku/Explore=recon); always merge via an open PR (never push/fast-forward/locally merge straight to main); autonomous merge only when the fleet-loop.md §8 gate holds, and a merge to main additionally requires a confirmed-clean adversarial review.`;

const RUBRIC = `Score the workflow script on each dimension 0-1 (1 = flawless), max 10:
1. Runtime correctness — agent/parallel/pipeline/phase/log used correctly; valid JSON Schemas; no forbidden Date/Math.random; meta is a pure literal; args parsed safely with sane defaults.
2. Token efficiency — cheapest tier per task; no redundant/over-fanned agents; dedupe BEFORE expensive verify; caps on fan-out; prompts demand structured data (not prose) where schema'd; no wasted agent calls.
3. Orchestration effectiveness — pipeline-by-default vs justified barriers; no wasted wall-clock; parallelism is real and safe (disjoint file scopes OR worktree isolation); verify/refute stages are independent and adversarial.
4. Output quality — schemas force actionable structured findings; verifiers are prompted to REFUTE (not rubber-stamp); fixers preserve intent; meaningful (non-vacuous) acceptance.
5. Robustness — every agent() result null-guarded/.filter(Boolean); empty-result and zero-task paths handled; dropped/capped items are log()'d (no silent truncation); loops have a bound.
6. Repo-rule enforcement — spawned-agent prompts carry no-AI-attribution + Conventional Commits + tier discipline + proper merge gating (always merge via an open PR; autonomous merge only under the fleet-loop.md §8 gate; a merge to main also requires a confirmed-clean adversarial review) where relevant.
7. Tier discipline — Opus only for plan/review/verify; Sonnet for implementation; Haiku/Explore for recon; no upgraded scouts or downgraded reviewers.
8. Adversarial robustness — prompts resist a lazy/gaming agent; calibration prevents score inflation AND padding; refute-by-default verifiers.
9. Clarity & maintainability — readable, well-sectioned, parameterized; labels/phases coherent; a maintainer can extend it.
10. Goal effectiveness — the workflow actually produces high-quality outputs token-efficiently end-to-end; return value is useful to the orchestrator.`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "dimensions", "findings", "verdict"],
  properties: {
    overallScore: {
      type: "number",
      description: "Sum of 10 dimension scores, 0-10",
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
      description:
        "Concrete defects. Empty (or nits-only) only if truly flawless.",
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
            description: "Line/section/quote in the file",
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
    key: "runtime-correctness",
    brief:
      "You are an adversarial WORKFLOW-RUNTIME engineer. Stress-test API usage against the runtime contract: forbidden Date/Math.random, mis-typed schemas, missing null-guards, pure-literal meta, barrier-vs-pipeline misuse, unsafe args parsing, concurrency/cap mistakes. A bug that would throw at runtime is CRITICAL.",
  },
  {
    key: "token-efficiency",
    brief:
      "You are an adversarial TOKEN-EFFICIENCY & ORCHESTRATION engineer. Hunt waste: wrong tier for a task, redundant/over-fanned agents, verify before dedupe, unbounded fan-out, prose where structured data would do, needless barriers stalling wall-clock, re-reads. Every wasted agent call is a finding.",
  },
  {
    key: "output-quality",
    brief:
      "You are an adversarial OUTPUT-QUALITY & REPO-RULE engineer. Check that verifiers truly refute (not rubber-stamp), schemas yield actionable findings, fixers preserve intent, silent truncation is logged, and every spawned-agent prompt carries the repo hard rules (no AI attribution, conventional commits, tier discipline, merge always via an open PR with §8 gating + adversarial review before any merge to main).",
  },
];

function reviewPrompt(file, lens, round, priorFixSummary) {
  return `${lens.brief}

Read the workflow script at ${file} FRESH from disk right now (it may have just been edited). ${RUNTIME_FACTS}

${REPO_RULES}
${
  priorFixSummary
    ? `\nThis is review round ${round}. The previous fixer reported:\n${priorFixSummary}\nDo NOT trust those fixes — re-verify adversarially and look for regressions they introduced.`
    : ""
}
Score it against this rubric:

${RUBRIC}

SCORING CALIBRATION (binding):
- A dimension scores below 1.0 ONLY if you also emit a concrete critical/major/minor finding that, once fixed, would raise it to 1.0. No finding ⇒ that dimension is 1.0. Never dock fractional points for taste/tone/"could be tighter".
- "nit" is cosmetic; nits never lower a dimension below 1.0 and never block a 10/10.
- Do not invent defects to justify a sub-10 score; do not round up past a real unfixed defect. An honest 10/10 with empty (or nits-only) findings is correct when warranted.
- overallScore may be 10 only if findings has zero critical/major/minor items.

Be ruthless but precise. Return structured output only — it is data, not prose.`;
}

function fixPrompt(file, round, findings) {
  const list = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] (${f.location}) ${f.problem}\n   Suggested: ${f.suggestedFix}`,
    )
    .join("\n");
  return `You are an expert Workflow-engine engineer with Edit/Write/Bash access. Round ${round}: fix ${file} to resolve the adversarial-review findings below WITHOUT degrading it or changing its intended behavior.

${RUNTIME_FACTS}

${REPO_RULES}

Findings (deduped union of the adversarial reviewers):
${list}

Rules for your edit:
- Read ${file} fresh, then apply targeted edits. Resolve every critical/major; resolve minors unless doing so conflicts with the runtime contract or another finding (explain any skipped).
- PRESERVE the workflow's purpose, its phases, tier discipline (Opus review / Sonnet implement / Haiku-Explore recon), schemas' intent, and the repo hard rules embedded in spawned-agent prompts.
- Optimize for TOKEN EFFICIENCY and OUTPUT QUALITY: cheapest tier that fits, dedupe before verify, structured outputs, bounded fan-out, no wasted agents, refute-by-default verifiers.
- Do NOT use Date.now()/new Date()/Math.random(). Keep meta a pure literal.
- After editing, run \`node --check ${file}\` (via Bash, in the repo's WSL if needed) to prove it still parses; if it fails, fix and re-check before returning.
Return a concise summary of exactly what you changed and which findings (by number) you resolved or deliberately skipped (with reason).`;
}

// ── Per-file review→fix loop; all files run concurrently ────────────────────
async function harden(file) {
  let priorFixSummary = null;
  const rounds = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reviews = (
      await parallel(
        LENSES.map(
          (lens) => () =>
            agent(reviewPrompt(file, lens, round, priorFixSummary), {
              label: `${file.split("/").pop()} r${round}:${lens.key}`,
              phase: "Review",
              schema: REVIEW_SCHEMA,
              model: "opus",
            }),
        ),
      )
    ).filter(Boolean);

    if (!reviews.length) {
      log(`${file}: round ${round} — all reviewers failed, aborting.`);
      return { file, result: "reviewers-failed", rounds };
    }

    const minScore = Math.min(...reviews.map((r) => r.overallScore));
    const blocking = reviews
      .flatMap((r) => r.findings)
      .filter((f) => ["critical", "major", "minor"].includes(f.severity));

    const seen = new Set();
    const deduped = blocking.filter((f) => {
      const k = (f.location + "|" + f.problem).slice(0, 160).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    log(
      `${file}: round ${round} min=${minScore}/10 · ${deduped.length} blocking findings`,
    );
    rounds.push({ round, minScore, blocking: deduped.length });

    const allPass =
      reviews.every((r) => r.verdict === "pass") &&
      minScore >= 10 &&
      deduped.length === 0;
    if (allPass) {
      log(
        `${file}: clean 10/10 from all reviewers — done in ${round} round(s).`,
      );
      return { file, result: "passed", rounds, finalRound: round };
    }

    if (round === MAX_ROUNDS) {
      log(
        `${file}: max rounds reached (min=${minScore}). Applying final fix pass.`,
      );
    }

    priorFixSummary = await agent(fixPrompt(file, round, deduped), {
      label: `${file.split("/").pop()} r${round}:fix`,
      phase: "Fix",
      model: "opus",
    });
  }

  return { file, result: "max-rounds", rounds };
}

phase("Review");
const results = await parallel(FILES.map((file) => () => harden(file)));

const summary = results.filter(Boolean);
const passed = summary.filter((r) => r.result === "passed").length;
log(`Done: ${passed}/${summary.length} workflows reached a clean 10/10.`);

return { passed, total: summary.length, results: summary };
