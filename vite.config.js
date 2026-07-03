import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "unsafe-none",
};

export default defineConfig({
  resolve: {
    alias: {
      "three/addons/": fileURLToPath(new URL("./node_modules/three/examples/jsm/", import.meta.url)),
    },
  },
  server: { headers: COOP_COEP },
  preview: { headers: COOP_COEP },
});
