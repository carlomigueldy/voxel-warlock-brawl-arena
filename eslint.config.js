import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// The codebase is ~all TypeScript now (P6 cutover deleted the legacy JS
// prototype) — this is a real gate over src/**/*.{ts,tsx} and
// test/**/*.{ts,tsx}, not the vacuous .js-only config it used to be. The
// handful of remaining .js files (asset-url.js, loader.js, build scripts)
// keep the old, deliberately permissive ruleset below unchanged.
export default tseslint.config(
  {
    // App code + build config only. dist/public are build output/static assets;
    // node_modules is deps; .claude/.agents hold harness/workflow scripts that
    // run in a bespoke runtime (top-level return etc.) and are not app modules.
    ignores: ["dist/**", "public/**", "node_modules/**", ".claude/**", ".agents/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    // Non-type-checked preset: fast, no tsconfig "project" wiring needed, and
    // covers test/**/*.ts too (which tsconfig.json's `exclude` keeps out of
    // the type-checked project, so the type-checked preset can't reach them
    // without a second tsconfig — not worth it for this pass). `extends`
    // (rather than spreading at the top level) scopes the preset's rules to
    // this `files` glob — spread, they carry no `files` of their own and
    // would otherwise also hit the plain-JS test/**/*.mjs suites below.
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Core hooks rules only — react-hooks v7's `recommended` preset also
      // bundles the new React Compiler ruleset (immutability/purity/refs/
      // set-state-in-render/...), which assumes patterns this R3F codebase
      // intentionally violates (refs + imperative mutation in useFrame
      // loops). rules-of-hooks/exhaustive-deps are the two that catch real
      // bugs; the rest is out of scope here.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...reactRefresh.configs.vite.rules,
      // The codebase already has an established "_"-prefix convention for
      // deliberately-unused bindings (shared-signature callback params,
      // placeholder test args) — recognize it instead of flagging them.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // `any` shows up ~60x, concentrated at real type-modeling debt (net.ts's
      // wire payloads, sim.ts/player.ts's shared mutable state) that's out of
      // scope for wiring up the linter — warn rather than force a rewrite.
      "@typescript-eslint/no-explicit-any": "warn",
      // Same idiom as the legacy .js block below: pervasive intentional
      // `try { ... } catch {}` best-effort cleanup (voice/net/social/audio
      // teardown paths), not oversights.
      "no-empty": "off",
      // Every occurrence here is "declare a safe default, then unconditionally
      // overwrite it in every branch" (satisfies control-flow/definite-
      // assignment, not a dead computation) — same call as the legacy .js block.
      "no-useless-assignment": "off",
      // net.ts's sanitizeChat carries the same intentional ASCII-control-char
      // strip the legacy .js block already exempts.
      "no-control-regex": "off",
    },
  },
  {
    files: ["src/**/*.js", "*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // peerjs populates window.Peer via a browser-only dynamic import in
        // net.js; the bare `Peer` global is read there and mocked in tests.
        Peer: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-cond-assign": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      // Pre-existing sanitize helpers intentionally strip ASCII control chars.
      "no-control-regex": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs", "src/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-cond-assign": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      // Pre-existing sanitize helpers intentionally strip ASCII control chars.
      "no-control-regex": "off",
    },
  },
);
