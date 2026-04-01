"use client";

function displayValue(value: string): string {
  if (/^\d+\.000$/.test(value)) {
    return value.slice(0, -1);
  }

  return value;
}

export function Stat(props: {
  label: string;
  value: string;
  leader?: boolean;
  tone?: "primary" | "secondary" | "accent" | "accent2";
  compact?: boolean;
}) {
  const leader = props.leader === true;
  const compact = props.compact === true;

  const toneVar =
    props.tone === "secondary"
      ? "var(--secondary)"
      : props.tone === "accent"
        ? "var(--accent)"
        : props.tone === "accent2"
          ? "var(--accent-2)"
          : "var(--primary)";

  return (
    <div
      className={
        compact
          ? "rounded-xl border px-2 py-1.5 min-w-0"
          : "rounded-xl border px-2 py-2 min-w-0"
      }
      style={{
        borderColor: leader
          ? `color-mix(in oklab, ${toneVar} 55%, transparent)`
          : "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: leader
          ? `linear-gradient(
              180deg,
              color-mix(in oklab, ${toneVar} 22%, var(--card)),
              color-mix(in oklab, var(--bg-base) 60%, transparent)
            )`
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
        boxShadow: leader
          ? `0 0 0 1px color-mix(in oklab, ${toneVar} 18%, transparent) inset,
             0 10px 24px color-mix(in oklab, ${toneVar} 18%, transparent)`
          : "none",
      }}
    >
      <div
        className={
          compact
            ? "text-[9px] font-semibold tracking-wide uppercase truncate text-center"
            : "text-[10px] font-semibold tracking-wide uppercase truncate text-center"
        }
        style={{
          color: leader
            ? `color-mix(in oklab, ${toneVar} 85%, var(--foreground))`
            : "var(--muted)",
        }}
      >
        {props.label}
      </div>

      <div
        className={
          compact
            ? "text-[13px] font-semibold leading-tight text-center"
            : "text-sm font-semibold text-center"
        }
        style={{ color: "var(--foreground)" }}
      >
        {displayValue(props.value)}
      </div>
    </div>
  );
}
