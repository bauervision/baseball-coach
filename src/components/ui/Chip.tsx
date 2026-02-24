// components/ui/Chip.tsx
"use client";

export type ChipKind =
  | "primary"
  | "secondary"
  | "accent"
  | "accent2"
  | "stroke"
  | "muted";

const DOT_BG: Record<ChipKind, string> = {
  primary: "var(--primary)",
  secondary: "var(--secondary)",
  accent: "var(--accent)",
  accent2: "var(--accent-2)",
  stroke: "color-mix(in oklab, var(--stroke) 90%, transparent)",
  muted: "var(--muted)",
};

const SURFACE_STYLE: Record<ChipKind, { background: string; border: string }> = {
  primary: {
    background: "color-mix(in oklab, var(--primary) 22%, transparent)",
    border: "1px solid color-mix(in oklab, var(--primary) 55%, transparent)",
  },
  secondary: {
    background: "color-mix(in oklab, var(--secondary) 20%, transparent)",
    border: "1px solid color-mix(in oklab, var(--secondary) 55%, transparent)",
  },
  accent: {
    background: "color-mix(in oklab, var(--accent) 22%, transparent)",
    border: "1px solid color-mix(in oklab, var(--accent) 55%, transparent)",
  },
  accent2: {
    background: "color-mix(in oklab, var(--accent-2) 20%, transparent)",
    border: "1px solid color-mix(in oklab, var(--accent-2) 55%, transparent)",
  },
  stroke: {
    background: "color-mix(in oklab, var(--stroke) 25%, transparent)",
    border: "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
  },
  muted: {
    background: "color-mix(in oklab, var(--muted) 12%, transparent)",
    border: "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
  },
};

export function Chip(props: { label: string; kind: ChipKind }) {
  const style = SURFACE_STYLE[props.kind];

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
      style={{ ...style, color: "var(--foreground)" }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: DOT_BG[props.kind] }}
        aria-hidden="true"
      />
      {props.label}
    </span>
  );
}
