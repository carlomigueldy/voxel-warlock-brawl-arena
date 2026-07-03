import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "unsafe-none",
};

export default defineConfig({
  plugins: [
    react(),
    // P6 deploy-readiness (#181): registers a service worker so the app is
    // installable (manifest + SW are both required — public/site.webmanifest
    // already covers the manifest half). `manifest: false` keeps that
    // hand-authored file as the single source of truth instead of having
    // this plugin generate/inject a second one. Precache is scoped to the
    // app shell only (JS/CSS/HTML/icons) — the ~480 MB of character/mob GLBs
    // and SFX mp3s under assets/**/ are excluded on purpose (single-level
    // globs don't cross into nested subdirectories); caching the full asset
    // library would blow past Workbox's per-file precache ceiling and make
    // "install" itself a multi-hundred-MB download. Full offline play is out
    // of scope for this pass — see PR notes.
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globDirectory: "dist",
        globPatterns: ["*.{html,ico,svg,png,webmanifest}", "assets/*.{js,css}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "three/addons/": fileURLToPath(new URL("./node_modules/three/examples/jsm/", import.meta.url)),
    },
  },
  server: { headers: COOP_COEP },
  preview: { headers: COOP_COEP },
});
