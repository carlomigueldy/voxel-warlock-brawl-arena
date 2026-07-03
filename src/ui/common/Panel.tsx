// The "forged panel" shell every P5 screen/overlay sits on — port of
// src/style.css's .panel (design §4 partition: forged panel -> shared
// primitives). Purely presentational; siblings compose their own content
// (menu body, lobby grid, HUD chrome, ...) inside it.
import type { HTMLAttributes, ReactNode, Ref } from "react";
import styles from "./Panel.module.css";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Left-aligned, tighter padding — for denser surfaces (e.g. pause menu). */
  compact?: boolean;
  ref?: Ref<HTMLDivElement>;
}

export function Panel({ children, compact = false, className, ref, ...rest }: PanelProps) {
  return (
    <div ref={ref} className={[styles.panel, compact && styles.compact, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
