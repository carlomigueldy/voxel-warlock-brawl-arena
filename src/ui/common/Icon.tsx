// Small inline-SVG glyph set shared by the primitive kit (checkmark on an
// active CharacterCard, close on Modal, warning on field errors, ...) —
// design §4 partition: shared primitives. `currentColor`-filled so each
// glyph inherits whatever `color` the call site sets via a var(--token).
import type { SVGAttributes } from "react";

export type IconName = "check" | "close" | "warning";

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, string> = {
  check: "M4.5 11.5L9 16l10.5-10.5",
  close: "M5 5l14 14M19 5L5 19",
  warning: "M12 3.5L21.5 20h-19L12 3.5zM12 9.5v5M12 17.25h.01",
};

export function Icon({ name, size = 16, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
