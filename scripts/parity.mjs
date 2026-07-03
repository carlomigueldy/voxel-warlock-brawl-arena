#!/usr/bin/env node
// R3F determinism CLI (design p4-design.md §7 / issue #138, reduced at P6
// #179) — originally proved pixel parity between the R3F scene and the
// golden legacy renderer across every P4 render PR; P6 deletes the legacy
// renderer this compared against, so the r3f-vs-legacy baseline this script
// used to also compute is gone. What remains — same-renderer determinism
// (two independent captures of the same fixture+seed, same page, ≈0 pixel
// diff) — stays as an ongoing regression guard: it still catches an
// accidental Math.random()/timing leak into build/VFX code, just against a
// single renderer instead of two.
//
// Drives src/three/parity/determinism.ts + test/parity/replayDriver.ts
// (window.__parity) over Playwright, using the SAME 3 fixtures the
// sim-replay determinism suite trusts (test/replay/fixtures/*.json).
//
// Usage:
//   node scripts/parity.mjs [--no-build] [--tolerance 0.001] [--keep-server]
//     Full gate (also `npm run parity`): for every fixture, captures the
//     page TWICE (independent page loads, same seed) and compares —
//     same-renderer determinism ≈0. Exits non-zero if any fixture/frame
//     exceeds --tolerance. Evidence: test/parity/.output/<fixture>/.
//
//   node scripts/parity.mjs --fixture <id> [--seed N] [--frame N ...] [--no-build]
//     Single-fixture evidence capture for a PR: writes a screenshot PNG for
//     the given fixture (default frames = [mid, last] tick). Never fails the
//     build — this mode is for producing PR-comment evidence, not gating.
//
//   node scripts/parity.mjs --help
//
// `window`, `document`, `requestAnimationFrame` below refer to the BROWSER's
// globals inside page.evaluate() callbacks (Playwright serializes+runs these
// in the page, never in this Node process) — declared here purely so eslint's
// Node-globals block for scripts/**/*.mjs doesn't flag them as undefined.
/* global window, document, requestAnimationFrame */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "test", "replay", "fixtures");
const OUTPUT_DIR = path.join(ROOT, "test", "parity", ".output");
const VIEWPORT = { width: 1280, height: 720 };
const CANDIDATE_PORTS = Array.from({ length: 20 }, (_, i) => 4173 + i);
// Fraction of pixels allowed to differ for a same-renderer "≈0" determinism
// pass. Measured r3f-vs-r3f noise floor across the 3 fixtures' key frames is
// 0.00000 for map/prop/hazard-only frames (procedural generation is
// Math.random()-heavy — a seed leak would blow way past this tolerance, not
// hover near it, so a clean zero there is a real determinism signal) and up
// to a REPRODUCIBLE ~0.003 on frames where a player + name label is on
// screen (spell-cast-seed42 frame 149, confirmed bit-identical magnitude
// across repeated runs) — NameLabel.tsx's makeLabelTexture() draws into a
// fresh `document.createElement("canvas")` 2D context per page load, and
// canvas-2D text/font rasterization can differ by a sub-pixel amount between
// independently-constructed browser contexts (a documented Chromium
// headless-rendering trait, not a randomness/timing leak — see that file's
// diff evidence: only the two player+label blobs differ, the map/props
// around them are byte-identical). 0.004 keeps real headroom above the
// worst observed value while still catching anything an actual leak would
// produce (an uncontrolled Math.random() draw shows up as global noise, not
// a two-small-blobs diff).
const DEFAULT_TOLERANCE = 0.004;

// Global playwright (per issue #138's brief: NOT a repo dep — this repo
// keeps `npm ci` light; the parity gate isn't part of default `npm test`/CI,
// so it's the one place in this repo that resolves a tool from outside
// node_modules). Tries a normal resolution first (works if a future change
// ever adds it as a devDep or a caller's NODE_PATH already covers it) before
// falling back to the documented global install path.
const GLOBAL_PLAYWRIGHT = "/home/carlomigueldy/.npm-global/lib/node_modules/playwright";

// playwright's entry is CJS (`module.exports = {chromium, firefox, ...}`) —
// a dynamic `import()` of it exposes that as `.default`, not as named
// exports (cjs-module-lexer doesn't always find them through playwright's
// own require chain). Normalize both the "resolved as a real ESM/CJS-interop
// package" case and the "raw CJS default export" case to the same shape.
function normalizePlaywrightModule(mod) {
  return mod.chromium ? mod : mod.default;
}

async function loadPlaywright() {
  try {
    return normalizePlaywrightModule(await import("playwright"));
  } catch {
    try {
      // Node's ESM resolver won't do package.json "main" lookup for a bare
      // absolute directory path the way `require()`/CJS does — point it at
      // the package's actual entry file.
      return normalizePlaywrightModule(await import(`${GLOBAL_PLAYWRIGHT}/index.js`));
    } catch (err) {
      throw new Error(
        `[parity] could not resolve "playwright" (tried the package resolver and ${GLOBAL_PLAYWRIGHT}). ` +
          `Install it globally (npm i -g playwright && playwright install chromium) or as a devDep.`,
        { cause: err },
      );
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadFixtureMeta() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".snapshots.json"))
    .map((f) => {
      const id = f.replace(/\.json$/, "");
      const data = JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), "utf8"));
      return { id, seed: data.seed };
    });
}

// ---------------------------------------------------------------------------
// vite preview: build, pick a VERIFIED-free port (brief #138: unrelated dev
// servers squat common ports like 4173), serve, confirm it's actually this
// app before trusting the port.
// ---------------------------------------------------------------------------

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForHttp(port, timeoutMs, isAlive) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isAlive && !isAlive()) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return await res.text();
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  return null;
}

// Kill the preview server AND its children. spawn("npx", …) makes npx the
// direct child and vite a grandchild; a plain proc.kill() SIGTERMs only npx
// and orphans vite (leaving the port bound + the Node event loop alive, so
// `npm run parity` hangs after printing its result). With detached:true the
// child leads its own process group, so a negative-pid SIGKILL takes the
// whole tree down.
function killServer(proc) {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function startPreviewServer() {
  for (const port of CANDIDATE_PORTS) {
    if (!(await isPortFree(port))) continue;
    const proc = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group → killServer() can SIGKILL npx+vite together
    });
    // Drain stdout/stderr immediately — an unconsumed pipe fills its OS
    // buffer once vite preview logs enough per-request lines (every fixture
    // JSON / GLB / chunk fetch during a capture), at which point vite's own
    // write() blocks and every in-flight page request stalls right along
    // with it. Symptom without this: page.goto() resolves fine (the initial
    // HTML is small) but window.__parity.ready never flips true, because
    // the dynamic import()s installParityHarness() awaits stall on the
    // clogged pipe — a `page.waitForFunction` timeout with no console/
    // pageerror event to explain it.
    proc.stdout.on("data", () => {});
    proc.stderr.on("data", () => {});
    let exited = false;
    proc.once("exit", () => {
      exited = true;
    });

    const html = await waitForHttp(port, 15000, () => !exited);
    if (!html || !html.includes("Voxel Warlock")) {
      // Either nothing came up on this port in time, or something else is
      // squatting it and answering with a different app — try the next one.
      if (!exited) killServer(proc);
      continue;
    }
    return { proc, port, baseUrl: `http://127.0.0.1:${port}` };
  }
  throw new Error(`[parity] no free, verified port found among ${CANDIDATE_PORTS.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Playwright capture: one page load per (fixture, seed, run) combination — a
// fresh navigation is the strongest possible determinism proof (no shared JS
// module state between "run A" and "run B") and sidesteps any singleton
// (services/registry.ts, pool.ts's caches) that would otherwise need manual
// reset between runs on the same page.
// ---------------------------------------------------------------------------

function defaultKeyFrames(frameCount) {
  const mid = Math.floor(frameCount / 2);
  const last = frameCount - 1;
  return [...new Set([mid, last])].sort((a, b) => a - b);
}

async function captureRun(browser, baseUrl, { fixture, seed, frames }) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // Kills the sin()-driven typing/speak-ring pulse animations (design §7
  // item 4) — irrelevant to these fixtures (no chat/speak events) but a
  // correctness requirement of the harness in general.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const url = `${baseUrl}/?capture=1&fixture=${fixture}&seed=${seed}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__parity?.ready === true, null, { timeout: 15000 });

  const frameCount = await page.evaluate((id) => window.__parity.loadFixture(id), fixture);
  const keyFrames = frames && frames.length ? frames : defaultKeyFrames(frameCount);
  // R3F's <Canvas className="r3f-canvas"> puts that class on the WRAPPING
  // <div> it renders, not on the <canvas> element itself — the canvas is an
  // unclassed child a level down.
  const selector = ".r3f-canvas canvas";
  await page.waitForSelector(selector, { state: "attached", timeout: 15000 });
  // R3F sizes its <canvas> from a ResizeObserver on its container — that
  // fires asynchronously, a beat AFTER the canvas attaches to the DOM. Under
  // frameloop="never" nothing else ever forces a wait for it, so the very
  // first advance() of a fresh page can draw into (and get screenshotted at)
  // the browser's unstyled-<canvas> default 300x150 intrinsic size instead
  // of the viewport — and since resizing a <canvas> always clears its
  // drawing buffer, a LATER resize can't fix an already-drawn frame either.
  // Block until the backing store actually matches the viewport before the
  // first stepTo()/advance() ever runs.
  await page.waitForFunction(
    ({ sel, w, h }) => {
      const el = document.querySelector(sel);
      return !!el && el.width === w && el.height === h;
    },
    { sel: selector, w: VIEWPORT.width, h: VIEWPORT.height },
    { timeout: 15000 },
  );

  const shots = [];
  for (const frame of keyFrames) {
    if (frame < 0 || frame >= frameCount) {
      throw new Error(`[parity] frame ${frame} out of range for fixture "${fixture}" (${frameCount} ticks)`);
    }
    await page.evaluate((f) => window.__parity.stepTo(f), frame);
    // stepTo()'s advance()/renderer.update() calls draw synchronously, but
    // the compositor may not have PRESENTED that draw yet when a screenshot
    // is requested immediately after — most visible on r3f's first-ever
    // frame post-navigation (frameloop="never" means nothing else ever
    // primes the pipeline). A double rAF round-trip waits for one full
    // paint cycle without rendering an extra frame itself (R3F's own rAF
    // loop never starts under frameloop="never" — see replayDriver.ts —
    // so a bare `requestAnimationFrame` here can't trigger a second
    // advance()/Math.random() draw).
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const buffer = await page.locator(selector).screenshot();
    shots.push({ frame, buffer });
  }

  await page.close();
  return { frameCount, keyFrames, shots, consoleErrors };
}

// ---------------------------------------------------------------------------
// Pixel diff (pixelmatch/pngjs — design §7 item 3).
// ---------------------------------------------------------------------------

function diffPngs(bufA, bufB) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, diffPng: null, note: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const numDiff = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
  return { ratio: numDiff / (width * height), diffPng: PNG.sync.write(diff), note: null };
}

function writeEvidence(dir, name, buffer) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, buffer);
  return file;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { frames: [], build: true, tolerance: DEFAULT_TOLERANCE, keepServer: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") args.fixture = argv[++i];
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--frame") args.frames.push(Number(argv[++i]));
    else if (a === "--no-build") args.build = false;
    else if (a === "--tolerance") args.tolerance = Number(argv[++i]);
    else if (a === "--keep-server") args.keepServer = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`[parity] unknown argument "${a}" (--help for usage)`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/parity.mjs [--no-build] [--tolerance 0.001]
      Full gate: r3f-vs-r3f same-page determinism (≈0), across all fixtures.

  node scripts/parity.mjs --fixture <id> [--seed N] [--frame N ...] [--no-build]
      Single-fixture PR evidence capture. Fixtures: ${loadFixtureMeta().map((f) => f.id).join(", ")}

  node scripts/parity.mjs --help
`);
}

async function withServerAndBrowser(args, fn) {
  if (args.build) {
    console.log("[parity] npm run build …");
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }
  const { proc, port, baseUrl } = await startPreviewServer();
  console.log(`[parity] vite preview verified on port ${port} (title contains "Voxel Warlock")`);
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch();
  try {
    return await fn({ baseUrl, browser });
  } finally {
    await browser.close();
    if (!args.keepServer) killServer(proc);
  }
}

async function runFullGate(args) {
  const fixtures = loadFixtureMeta();
  const results = [];
  let failed = false;

  await withServerAndBrowser(args, async ({ baseUrl, browser }) => {
    for (const { id, seed } of fixtures) {
      const outDir = path.join(OUTPUT_DIR, id);
      console.log(`\n[parity] fixture "${id}" (seed ${seed})`);

      const runA = await captureRun(browser, baseUrl, { fixture: id, seed });
      const runB = await captureRun(browser, baseUrl, { fixture: id, seed });

      for (const [i, frame] of runA.keyFrames.entries()) {
        const det = diffPngs(runA.shots[i].buffer, runB.shots[i].buffer);

        writeEvidence(outDir, `golden-frame${frame}.png`, runA.shots[i].buffer);
        if (det.diffPng) writeEvidence(outDir, `diff-determinism-frame${frame}.png`, det.diffPng);

        const ok = det.ratio <= args.tolerance;
        if (!ok) failed = true;

        results.push({ fixture: id, frame, det: det.ratio, ok });

        console.log(`  frame ${frame}: r3f-det=${det.ratio.toFixed(5)}${ok ? "" : " FAIL"}`);

        for (const run of [runA, runB]) {
          if (run.consoleErrors.length) {
            console.warn(`  [parity] console errors during capture: ${run.consoleErrors.slice(0, 3).join(" | ")}`);
          }
        }
      }
    }
  });

  console.log(`\n[parity] evidence written under ${path.relative(ROOT, OUTPUT_DIR)}/<fixture>/`);
  console.log("\n[parity] summary (tolerance = " + args.tolerance + "):");
  console.table(
    results.map((r) => ({
      fixture: r.fixture,
      frame: r.frame,
      "r3f determinism": r.det.toFixed(5),
    })),
  );

  if (failed) {
    console.error(
      "\n[parity] FAIL — same-page determinism exceeded tolerance for at least one (fixture, frame). " +
        "This is a regression guard against a Math.random()/timing leak into build/VFX code, not a " +
        "cross-renderer parity gate (the legacy renderer it used to compare against is deleted).",
    );
    process.exitCode = 1;
  } else {
    console.log("\n[parity] PASS — r3f-vs-r3f ≈0 for every fixture/frame.");
  }
}

async function runSingleFixture(args) {
  const fixtures = loadFixtureMeta();
  const meta = fixtures.find((f) => f.id === args.fixture);
  if (!meta) {
    throw new Error(`[parity] unknown fixture "${args.fixture}" — known: ${fixtures.map((f) => f.id).join(", ")}`);
  }
  const seed = Number.isFinite(args.seed) ? args.seed : meta.seed;
  const outDir = path.join(OUTPUT_DIR, args.fixture);

  await withServerAndBrowser(args, async ({ baseUrl, browser }) => {
    const run = await captureRun(browser, baseUrl, { fixture: args.fixture, seed, frames: args.frames });
    for (const [i, frame] of run.keyFrames.entries()) {
      const file = writeEvidence(outDir, `r3f-frame${frame}.png`, run.shots[i].buffer);
      console.log(`[parity] wrote ${path.relative(ROOT, file)}`);
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.fixture) return runSingleFixture(args);
  return runFullGate(args);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Defensive: even after killServer, a lingering Playwright/child handle
    // can keep the event loop alive — force a clean exit so `npm run parity`
    // (and downstream PR captures) return instead of hanging.
    process.exit(process.exitCode ?? 0);
  });
