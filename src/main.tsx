// React shell entry — loaded ONLY behind ?shell=react (see index.html's
// bootstrap script); the default (no query param) path still loads
// src/main.js untouched. No <StrictMode>: a double-invoke would construct
// two Peers / two rAF loops / two AudioContexts through the singletons in
// src/services/registry.ts (design §10 risk 2).
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetServices } from "./services/registry";

const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<App />);

// HMR safety net (design §10 risk 5). main.tsx has no component exports, so
// Vite's default behavior for editing it is already a full page reload; this
// dispose hook is defense-in-depth for the case a future edit changes that.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
    resetServices();
  });
}
