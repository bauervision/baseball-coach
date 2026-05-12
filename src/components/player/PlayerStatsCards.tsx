"use client";

import * as React from "react";

export function BigStat(props: {
  label: string;
  value: string;
  leader?: boolean;
  tone?: "primary" | "secondary" | "accent" | "accent2";
  icon?: React.ReactNode;
  onExplainAction?: () => void;
}) {
  const toneVar =
    props.leader || props.tone === "secondary"
      ? "var(--secondary)"
      : props.tone === "accent"
        ? "var(--accent)"
        : props.tone === "accent2"
          ? "var(--accent-2)"
          : "var(--primary)";

  const clickable = typeof props.onExplainAction === "function";
  const Wrapper: "button" | "div" = clickable ? "button" : "div";

  return (
    <Wrapper
      type={clickable ? "button" : undefined}
      onClick={props.onExplainAction}
      className={[
        "rounded-2xl border p-4 text-left",
        clickable ? "transition active:scale-[0.99] hover:opacity-95" : "",
      ].join(" ")}
      style={{
        borderColor: props.leader
          ? "color-mix(in oklab, var(--secondary) 78%, transparent)"
          : `color-mix(in oklab, ${toneVar} 45%, transparent)`,
        background: props.leader
          ? "linear-gradient(135deg, color-mix(in oklab, var(--secondary) 24%, var(--card)), color-mix(in oklab, var(--bg-base) 58%, transparent))"
          : `linear-gradient(180deg, color-mix(in oklab, ${toneVar} 18%, var(--card)), color-mix(in oklab, var(--bg-base) 55%, transparent))`,
        boxShadow: props.leader
          ? "0 0 0 1px color-mix(in oklab, var(--secondary) 32%, transparent) inset, 0 0 28px color-mix(in oklab, var(--secondary) 22%, transparent)"
          : `0 0 0 1px color-mix(in oklab, ${toneVar} 14%, transparent) inset`,
        cursor: clickable ? "pointer" : "default",
      }}
      aria-label={clickable ? `What is ${props.label}?` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: "var(--muted)" }}
        >
          {props.label}
        </div>

        {props.leader ? (
          <div
            className="rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide"
            style={{ background: "var(--secondary)", color: "rgba(0,0,0,0.9)" }}
          >
            Leader
          </div>
        ) : props.icon ? (
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{
              background: `color-mix(in oklab, ${toneVar} 14%, var(--card))`,
              border: `1px solid color-mix(in oklab, ${toneVar} 32%, transparent)`,
              color: `color-mix(in oklab, ${toneVar} 78%, var(--foreground))`,
              opacity: 0.9,
            }}
            aria-hidden="true"
          >
            {props.icon}
          </div>
        ) : null}
      </div>

      <div className="mt-1 text-2xl font-semibold">{props.value}</div>

      {clickable ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
          Tap to learn
        </div>
      ) : null}
    </Wrapper>
  );
}

export function SmallStat(props: {
  label: string;
  value: string;
  leader?: boolean;
}) {
  return (
    <div
      className="rounded-xl border px-3 py-2"
      style={{
        borderColor: props.leader
          ? "color-mix(in oklab, var(--secondary) 72%, transparent)"
          : "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: props.leader
          ? "linear-gradient(135deg, color-mix(in oklab, var(--secondary) 18%, var(--card)), color-mix(in oklab, var(--bg-base) 64%, transparent))"
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
        boxShadow: props.leader
          ? "0 0 0 1px color-mix(in oklab, var(--secondary) 24%, transparent) inset, 0 0 20px color-mix(in oklab, var(--secondary) 16%, transparent)"
          : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="text-[10px] font-semibold tracking-wide uppercase"
          style={{ color: "var(--muted)" }}
        >
          {props.label}
        </div>

        {props.leader ? (
          <div
            className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase"
            style={{ background: "var(--secondary)", color: "rgba(0,0,0,0.9)" }}
          >
            Lead
          </div>
        ) : null}
      </div>

      <div className="text-sm font-semibold">{props.value}</div>
    </div>
  );
}
