// React port of src/credits.js (design §9a #168) — a self-contained trigger
// + dialog rather than a dedicated menu-spine sub-screen: #161 p5-menu owns
// MenuRoot's spine (SPINE_ITEMS is closed over `useMenuNavStore`'s six
// sub-screens), so a Juice-owned "credits route" adds its own entry point
// instead of reaching into that sibling's region, per the design §9
// integration contract (each sibling only decorates its own territory).
// Reuses the shared `Modal` primitive (design §4) for the focus-trap +
// Escape-to-close the design floor requires, instead of re-implementing it.
import { useState } from "react";
import { useSessionStore } from "../../store/useSessionStore";
import { useFx } from "../../hooks/useFx";
import { menuCue } from "../../audio";
import { Modal } from "../common";
import styles from "./Credits.module.css";

export function Credits() {
  const screen = useSessionStore((s) => s.screen);
  const fx = useFx();
  const [open, setOpen] = useState(false);

  if (screen !== "menu") return null;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Open credits"
        onClick={() => {
          setOpen(true);
          menuCue("confirm");
        }}
      >
        ★ Credits
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          menuCue("back");
        }}
        ariaLabel="Credits"
      >
        {/* Reduced motion disables the auto-scroll (Credits.module.css); make
            the viewport keyboard-focusable so it can still be scrolled — same
            trade legacy made in credits.js's own init(). Read once at open,
            not reactively, matching legacy's own non-reactive behavior. */}
        <div className={styles.wrap} tabIndex={fx.reducedMotion ? 0 : undefined} data-testid="credits-wrap">
          <div className={styles.scroll}>
            <section className={styles.section}>
              <h3 className={styles.h}>Crafted by</h3>
              <p className={styles.body}>
                <a className={styles.link} href="https://carlomigueldy.dev" target="_blank" rel="noopener noreferrer">
                  carlomigueldy.dev
                </a>
              </p>
            </section>
            <section className={styles.section}>
              <h3 className={styles.h}>Powered by</h3>
              <p className={styles.body}>Three.js · PeerJS (WebRTC) · Supabase · qrcode · Meshy AI</p>
            </section>
            <section className={styles.section}>
              <h3 className={styles.h}>Spell icons</h3>
              <p className={styles.body}>Bespoke duotone SVG icons</p>
            </section>
            <section className={styles.section}>
              <h3 className={styles.h}>Special thanks</h3>
              <p className={styles.body}>The Warlock Brawl (Warcraft III) original that inspired this clone</p>
            </section>
          </div>
        </div>
      </Modal>
    </>
  );
}
