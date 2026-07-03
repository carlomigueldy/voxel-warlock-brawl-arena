import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "unsafe-none",
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "three/addons/": fileURLToPath(new URL("./node_modules/three/examples/jsm/", import.meta.url)),
    },
  },
  server: { headers: COOP_COEP },
  preview: { headers: COOP_COEP },
});
