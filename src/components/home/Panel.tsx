// components/home/Panel.tsx
"use client";

import * as React from "react";

export function Panel(props: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
        background: "color-mix(in oklab, var(--card) 72%, transparent)",
      }}
    >
      <div className="text-sm font-semibold">{props.title}</div>
      <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {props.subtitle}
      </div>
      {props.children}
    </div>
  );
}
