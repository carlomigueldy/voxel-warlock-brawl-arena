import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // MUST be node, NEVER jsdom: net.js does import("peerjs") when typeof window!=="undefined"; jsdom would fire it and peerjs throws reading navigator. node keeps it inert.
    globals: false, // tests import { test, vi } explicitly
    include: ["test/**/*.test.{mjs,ts,tsx}", "src/**/*.test.{mjs,ts,tsx}"], // stats.test lives in src/
    // jest-dom only calls expect.extend() — no document/window access at
    // import time — so this is safe for the "node"-environment tests too
    // (design §4/P5: every RTL suite gets toBeInTheDocument/toHaveAttribute/... for free).
    setupFiles: ["test/setup/jest-dom.ts"],
    // guard tests fs.readFileSync("src/main.js")/("index.html") relative to cwd=repo root — do NOT set a custom root.
  },
});
