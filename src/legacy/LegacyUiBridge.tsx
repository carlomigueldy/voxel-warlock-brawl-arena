// ui=legacy: wires the existing UI class (src/ui.js, still imperative DOM —
// P5 replaces this with React components) to the audio engine, the
// character-preview turntable, and the stores (via wireLegacyUiToStores).
// ui.js has no destroy() — the static DOM it owns stays mounted for the
// app's lifetime (design §5.1); this bridge only unsubscribes its own store
// listeners on cleanup, it never tears down `ui` itself.
import { useEffect } from "react";
import { getUI, getAudio, getPreview } from "../services/registry";
import { wireLegacyUiToStores } from "./wireLegacyUiToStores";

export function LegacyUiBridge(): null {
  useEffect(() => {
    const ui = getUI();
    ui.setAudio(getAudio());

    // Live 360° character preview — warms up behind the loader screen, same
    // as main.js's former module-top-level wiring (ui.showMenu() also calls
    // preview.start() again; CharacterPreview.start() is idempotent).
    const previewCanvas = document.getElementById("char-preview") as HTMLCanvasElement | null;
    if (previewCanvas) {
      const preview = getPreview(previewCanvas);
      ui.setPreview(preview);
      preview.start();
    }

    const unwire = wireLegacyUiToStores(ui);
    void import("./juice"); // side-effect only; screens/draft-juice/nav-feel/onboarding/gamepad/credits

    return () => {
      unwire();
    };
  }, []);

  return null;
}
