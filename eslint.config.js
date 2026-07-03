import js from "@eslint/js";
import globals from "globals";

// Standing up the toolchain, not a lint sweep: this repo has 40+ pre-existing
// JS files written before ESLint was wired in, so the ruleset here is
// deliberately permissive (recommended, minus the rules that would fail on
// the current tree) rather than a strict style gate.
export default [
  {
    // App code + build config only. dist/public are build output/static assets;
    // node_modules is deps; .claude/.agents hold harness/workflow scripts that
    // run in a bespoke runtime (top-level return etc.) and are not app modules.
    ignores: ["dist/**", "public/**", "node_modules/**", ".claude/**", ".agents/**"],
  },
  js.configs.recommended,
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
    files: ["scripts/**/*.mjs", "test/**/*.mjs", "src/**/*.mjs", "*.config.js", "vite.config.js"],
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
];
