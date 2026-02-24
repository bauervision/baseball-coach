"use client";

import * as React from "react";
import { ArrowUp } from "lucide-react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
}

export function BackToTop(props: {
  thresholdPx?: number;
  bottomPx?: number;
  rightPx?: number;
}) {
  const thresholdPx = props.thresholdPx ?? 420;
  const bottomPx = props.bottomPx ?? 16;
  const rightPx = props.rightPx ?? 16;

  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;

    const onScroll = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        setVisible(window.scrollY > thresholdPx);
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [thresholdPx]);

  const onClick = React.useCallback(() => {
    if (typeof window === "undefined") return;

    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed z-50 grid h-11 w-11 place-items-center rounded-2xl border shadow-xl transition-opacity hover:opacity-90"
      style={{
        right: rightPx,
        bottom: bottomPx,
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 72%, transparent))",
        boxShadow:
          "0 18px 55px rgba(0,0,0,0.35), 0 0 0 1px color-mix(in oklab, var(--accent) 10%, transparent) inset",
        color: "var(--secondary)",
      }}
      aria-label="Back to top"
      title="Back to top"
    >
      <ArrowUp className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
