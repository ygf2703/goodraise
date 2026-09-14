import type { ComponentPropsWithRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
type Appearance = { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; className?: string };

function buttonClassName({ variant = "primary", size = "md", icon = false, className = "" }: Appearance) {
  return ["gr-button", `gr-button--${variant}`, `gr-button--${size}`, icon && "gr-button--icon", className].filter(Boolean).join(" ");
}

export function Button({ variant, size, icon, className, type = "button", busy = false, disabled, ...props }:
  ComponentPropsWithRef<"button"> & Appearance & { busy?: boolean }) {
  return <button {...props} type={type} className={buttonClassName({ variant, size, icon, className })} disabled={disabled || busy} aria-busy={busy || props["aria-busy"]} />;
}

// Navigation stays a real anchor (open in new tab, copy link, keyboard access).
export function ButtonLink({ variant, size, icon, className, disabled = false, href, onClick, tabIndex, ...props }:
  Omit<ComponentPropsWithRef<"a">, "href"> & Appearance & { href: string; disabled?: boolean }) {
  return <a {...props} href={disabled ? undefined : href} role={disabled ? "link" : props.role}
    className={buttonClassName({ variant, size, icon, className })} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : tabIndex}
    onClick={(event) => { if (disabled) { event.preventDefault(); event.stopPropagation(); } else onClick?.(event); }} />;
}
