// Shared "forged" button primitive — port of src/style.css's .btn/.btn-forge/
// .btn-ghost (design §4 partition: controls -> ui/common). React 19 accepts
// `ref` as a plain prop on function components (no forwardRef needed).
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "forge" | "ghost";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  type?: "button" | "submit" | "reset";
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "forge", type = "button", className, children, ref, ...rest }: ButtonProps) {
  const variantClass = variant === "forge" ? styles.forge : styles.ghost;
  return (
    <button ref={ref} type={type} className={[styles.btn, variantClass, className].filter(Boolean).join(" ")} {...rest}>
      {variant === "forge" && <span className={styles.spark} aria-hidden="true" />}
      {children}
    </button>
  );
}
