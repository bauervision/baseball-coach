"use client";

import * as React from "react";

type Props = {
  /** ISO date in local time, e.g. "2026-03-28" */
  dateISO?: string;
  label?: string;
};

function parseLocalMidnight(dateISO: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function diffParts(target: Date, now: Date) {
  const ms = target.getTime() - now.getTime();
  const clamped = Math.max(0, ms);

  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { ms, days, hours, minutes };
}

function formatShortMonthDay(dateISO: string): string {
  const d = parseLocalMidnight(dateISO);
  if (!d) return "Mar 28";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function OpeningDayCountdown(props: Props) {
  const dateISO = props.dateISO ?? "2026-03-28";
  const label = props.label ?? "Opening Day";

  const target = React.useMemo(() => parseLocalMidnight(dateISO), [dateISO]);
  const [now, setNow] = React.useState<Date>(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!target) return null;

  const { ms, days, hours, minutes } = diffParts(target, now);

  const isToday =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();

  const done = ms <= 0 || isToday;

  const dateLabel = formatShortMonthDay(dateISO);

  const primaryNumber = done ? "0" : days > 0 ? String(days) : String(hours);
  const primaryUnit = done ? "days" : days > 0 ? "days" : "hours";

  const subA = done
    ? { label: "HRS", value: "00" }
    : { label: "HRS", value: pad2(hours) };
  const subB = done
    ? { label: "MIN", value: "00" }
    : { label: "MIN", value: pad2(minutes) };

  return (
    <div
      className="w-full rounded-2xl border px-4 py-3"
      style={{
        borderColor: "color-mix(in oklab, var(--primary) 40%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--primary) 12%, var(--card)), color-mix(in oklab, var(--bg-base) 78%, transparent))",
        color: "color-mix(in oklab, var(--foreground) 92%, white 8%)",
        boxShadow:
          "0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent) inset",
        position: "relative",
        overflow: "hidden",
      }}
      aria-label={`${label} countdown`}
      title={`${label} — ${dateISO}`}
    >
      {/* subtle sweep on desktop */}
      <div
        className="hidden sm:block"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "-80px -120px auto -120px",
          height: 160,
          background:
            "radial-gradient(700px 160px at 30% 35%, color-mix(in oklab, var(--secondary) 18%, transparent), transparent 60%)",
          filter: "blur(2px)",
          opacity: 0.9,
          pointerEvents: "none",
        }}
      />

      {/* Corner ribbon (desktop) */}
      <div
        className="hidden sm:block"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 62, // anchor near the pin corner
          right: -90, // anchor near the pin corner
          transformOrigin: "top right",
          transform: "rotate(15deg) ",
          zIndex: 3,
          padding: "10px 102px",
          borderRadius: 999,
          border:
            "1px solid color-mix(in oklab, var(--accent-2) 28%, transparent)",
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--accent-2) 18%, transparent), color-mix(in oklab, var(--bg-base) 70%, transparent))",
          boxShadow:
            "0 12px 34px rgba(0, 0, 0, 0.28), 0 0 0 1px color-mix(in oklab, var(--accent-2) 10%, transparent) inset",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color:
              "color-mix(in oklab, var(--accent-2) 86%, var(--foreground))",
            whiteSpace: "nowrap",
          }}
        >
          Season starts soon
        </div>
      </div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold tracking-wide uppercase"
            style={{ color: "var(--muted)" }}
          >
            {label}
          </div>
          <div className="mt-0.5 text-base font-extrabold leading-tight">
            {done ? "Today" : "Countdown"}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
            {dateLabel}
          </div>
        </div>
      </div>

      {/* Main countdown row */}
      <div className="mt-3 grid gap-3 justify-items-center sm:justify-items-stretch sm:grid-cols-[max-content_1fr] sm:items-center">
        {/* Big number */}
        <div
          className="inline-flex w-full sm:w-auto items-center justify-center sm:items-end sm:justify-start gap-3 rounded-2xl px-4 py-3"
          style={{
            border:
              "1px solid color-mix(in oklab, var(--accent-2) 26%, transparent)",
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--accent-2) 18%, transparent), color-mix(in oklab, var(--accent-2) 10%, transparent))",
            boxShadow:
              "0 0 0 1px color-mix(in oklab, var(--accent-2) 10%, transparent) inset, 0 18px 50px rgba(0, 0, 0, 0.26)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* shimmer */}
          <span
            aria-hidden="true"
            className="odc-shimmer"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.14) 22%, transparent 45%)",
              transform: "translateX(-80%)",
              pointerEvents: "none",
              opacity: 0.65,
            }}
          />

          <div
            className="leading-none w-full text-center sm:w-auto sm:text-left"
            style={{
              fontSize: 44,
              fontWeight: 950,
              letterSpacing: "-0.04em",
              color:
                "color-mix(in oklab, var(--accent-2) 88%, var(--foreground))",
              textShadow: "0 20px 55px rgba(0, 0, 0, 0.35)",
            }}
          >
            {primaryNumber}
          </div>

          {/* Unit label: desktop gets the hype copy, mobile gets the simple "28 days" */}
          <div className="pb-1">
            <div className="hidden sm:block">
              <div
                className="text-[11px] font-semibold tracking-wide uppercase"
                style={{
                  color: "color-mix(in oklab, var(--muted) 92%, white 8%)",
                }}
              >
                T-minus
              </div>
              <div className="text-sm font-extrabold leading-tight">
                {primaryUnit}
              </div>
            </div>
          </div>
        </div>

        {/* Secondary chips */}
        <div className="hidden sm:grid grid-cols-2 gap-3 sm:justify-end sm:ml-auto sm:w-fit">
          <div
            className="rounded-2xl px-3 py-3 text-center"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
              background:
                "color-mix(in oklab, var(--bg-base) 58%, transparent)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset",
            }}
          >
            <div
              className="text-[11px] font-semibold tracking-wide uppercase"
              style={{ color: "var(--muted)" }}
            >
              {subA.label}
            </div>
            <div
              className="mt-1 text-xl font-black"
              style={{
                letterSpacing: "-0.02em",
                color: "color-mix(in oklab, var(--foreground) 96%, white 4%)",
              }}
            >
              {subA.value}
            </div>
          </div>

          <div
            className="rounded-2xl px-3 py-3 text-center"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
              background:
                "color-mix(in oklab, var(--bg-base) 58%, transparent)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset",
            }}
          >
            <div
              className="text-[11px] font-semibold tracking-wide uppercase"
              style={{ color: "var(--muted)" }}
            >
              {subB.label}
            </div>
            <div
              className="mt-1 text-xl font-black"
              style={{
                letterSpacing: "-0.02em",
                color: "color-mix(in oklab, var(--foreground) 96%, white 4%)",
              }}
            >
              {subB.value}
            </div>
          </div>
        </div>
      </div>

      {/* Keep motion tasteful and respect reduced motion */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .odc-shimmer {
            animation: odcShimmer 2.4s ease-in-out infinite;
          }
        }

        @keyframes odcShimmer {
          0% { transform: translateX(-80%); opacity: 0.0; }
          20% { opacity: 0.55; }
          55% { opacity: 0.55; }
          100% { transform: translateX(120%); opacity: 0.0; }
        }
      `}</style>
    </div>
  );
}
