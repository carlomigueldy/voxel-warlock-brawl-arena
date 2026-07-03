// Reusable dialog primitive built on Panel + the global `.overlay` chrome
// (design §4 partition: shared primitives — draft/social/conduct dialogs
// all reuse this). Traps focus while open, restores it to whatever was
// focused before opening, and closes on Escape or a backdrop click (design
// floor: "Modal traps focus").
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Panel } from "./Panel";
import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./Modal.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name — required since Modal has no mandatory visible heading. */
  ariaLabel: string;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

export function Modal({ open, onClose, children, ariaLabel, closeOnBackdrop = true, showCloseButton = true, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusables = () => (dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []);
    const first = focusables()[0];
    (first ?? dialog)?.focus();

    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const nodes = focusables();
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstNode || !dialog.contains(active)) {
          e.preventDefault();
          lastNode.focus();
        }
      } else if (active === lastNode || !dialog.contains(active)) {
        e.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener("keydown", onKeydown, true);
    return () => {
      document.removeEventListener("keydown", onKeydown, true);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={[styles.backdrop, "overlay"].join(" ")}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <Panel ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1} className={[styles.dialog, className].filter(Boolean).join(" ")}>
        {showCloseButton && (
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
        {children}
      </Panel>
    </div>,
    document.body,
  );
}
