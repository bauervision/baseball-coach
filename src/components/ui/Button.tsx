"use client";

import * as React from "react";
import { cx } from "./cx";

export type UiButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type UiButtonSize = "sm" | "md" | "lg";

export type UiButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "color"
> & {
  variant?: UiButtonVariant;
  size?: UiButtonSize;

  /**
   * When true, button is disabled and announces busy state.
   * Styling is handled in CSS (keep primitives token-driven via globals.css).
   */
  loading?: boolean;
};

const VARIANT_CLASS: Record<UiButtonVariant, string> = {
  primary: "ui-btn ui-btn--primary",
  secondary: "ui-btn ui-btn--secondary",
  ghost: "ui-btn ui-btn--ghost",
  danger: "ui-btn ui-btn--danger",
};

const SIZE_CLASS: Record<UiButtonSize, string> = {
  sm: "ui-btn--sm",
  md: "ui-btn--md",
  lg: "ui-btn--lg",
};

export const Button = React.forwardRef<HTMLButtonElement, UiButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", disabled, loading, ...props },
    ref,
  ) {
    const isDisabled = Boolean(disabled || loading);

    return (
      <button
        ref={ref}
        className={cx(VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
        disabled={isDisabled}
        aria-busy={loading ? true : undefined}
        {...props}
      />
    );
  },
);
