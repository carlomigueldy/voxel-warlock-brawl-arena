import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // MUST be node, NEVER jsdom: net.js does import("peerjs") when typeof window!=="undefined"; jsdom would fire it and peerjs throws reading navigator. node keeps it inert.
    globals: false, // tests import { test, vi } explicitly
    include: ["test/**/*.test.{mjs,ts}", "src/**/*.test.{mjs,ts}"], // stats.test lives in src/
    // guard tests fs.readFileSync("src/main.js")/("index.html") relative to cwd=repo root — do NOT set a custom root.
  },
});
