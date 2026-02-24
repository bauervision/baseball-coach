export function Stat(props: {
  label: string;
  value: string;
  leader?: boolean;
  tone?: "primary" | "secondary" | "accent" | "accent2";
}) {
  const leader = props.leader === true;

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
      className="rounded-xl border px-2 py-2"
      style={{
        borderColor: leader
          ? `color-mix(in oklab, ${toneVar} 55%, transparent)`
          : "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: leader
          ? `linear-gradient(180deg,
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
        className="text-[10px] font-semibold tracking-wide uppercase"
        style={{
          color: leader
            ? `color-mix(in oklab, ${toneVar} 85%, var(--foreground))`
            : "var(--muted)",
        }}
      >
        {props.label}
        {leader ? (
          <span
            className="ml-1 align-middle"
            style={{
              fontSize: 10,
              color: `color-mix(in oklab, ${toneVar} 82%, var(--foreground))`,
            }}
          >
            LEAD
          </span>
        ) : null}
      </div>

      <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        {props.value}
      </div>
    </div>
  );
}