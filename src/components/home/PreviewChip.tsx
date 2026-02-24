// components/home/PreviewChip.tsx
"use client";

export function PreviewChip(props: {
  label: string;
  kind: "accent" | "accent2" | "stroke" | "muted";
}) {
  const style =
    props.kind === "accent"
      ? {
          background: "color-mix(in oklab, var(--accent) 22%, transparent)",
          border:
            "1px solid color-mix(in oklab, var(--accent) 55%, transparent)",
        }
      : props.kind === "accent2"
        ? {
            background: "color-mix(in oklab, var(--accent-2) 20%, transparent)",
            border:
              "1px solid color-mix(in oklab, var(--accent-2) 55%, transparent)",
          }
        : props.kind === "stroke"
          ? {
              background: "color-mix(in oklab, var(--stroke) 25%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
            }
          : {
              background: "color-mix(in oklab, var(--muted) 12%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
            };

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
      style={{ ...style, color: "var(--foreground)" }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{
          background:
            props.kind === "accent"
              ? "var(--accent)"
              : props.kind === "accent2"
                ? "var(--accent-2)"
                : props.kind === "stroke"
                  ? "color-mix(in oklab, var(--stroke) 90%, transparent)"
                  : "var(--muted)",
        }}
        aria-hidden="true"
      />
      {props.label}
    </span>
  );
}
