// components/home/TokenRow.tsx
"use client";

import * as React from "react";
import type { ThemeTokens } from "@/lib/themeTokens";
import { ColorPickerDialog } from "./ColorPickerDialog";

function isHexColor(v: string) {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export function TokenRow(props: {
  k: keyof ThemeTokens;
  value: string;
  locked: boolean;
  onToggleLockAction: () => void;
  onChangeAction: (v: string) => void;
}) {
  const label = formatTokenLabel(props.k);
  const isHex = isHexColor(props.value);
  const colorInputRef = React.useRef<HTMLInputElement | null>(null);

  const openHexPicker = React.useCallback(() => {
    if (!isHex) return;
    colorInputRef.current?.click();
  }, [isHex]);

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
        background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
        color: "var(--foreground)",
      }}
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold">{label}</div>
        <div
          className="mt-0.5 wrap-break-word text-xs"
          style={{ color: "var(--muted)" }}
        >
          {props.value}
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-nowrap sm:justify-start">
        <button
          type="button"
          onClick={isHex ? openHexPicker : undefined}
          className="h-7 w-7 shrink-0 rounded-lg border"
          style={{
            background: isHex
              ? props.value
              : "color-mix(in oklab, var(--stroke) 30%, transparent)",
            borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
            boxShadow:
              props.k === "primary" ||
              props.k === "secondary" ||
              props.k === "accent" ||
              props.k === "accent2"
                ? "0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent)"
                : undefined,
          }}
          title={isHex ? "Pick a color" : "Pick color + opacity"}
        />

        {isHex ? (
          <input
            ref={colorInputRef}
            type="color"
            value={props.value}
            onChange={(e) => props.onChangeAction(e.target.value)}
            className="hidden"
            aria-hidden="true"
          />
        ) : (
          <ColorPickerDialog
            value={props.value}
            onChangeAction={props.onChangeAction}
            label={`Edit ${label}`}
          />
        )}

        <button
          type="button"
          onClick={props.onToggleLockAction}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={
            props.locked
              ? { background: "var(--foreground)", color: "var(--bg-base)" }
              : {
                  border:
                    "1px solid color-mix(in oklab, var(--stroke) 90%, transparent)",
                  color:
                    "color-mix(in oklab, var(--foreground) 80%, transparent)",
                }
          }
        >
          {props.locked ? "Locked" : "Open"}
        </button>
      </div>
    </div>
  );
}

function formatTokenLabel(k: keyof ThemeTokens) {
  switch (k) {
    case "bgBase":
      return "bg-base";
    case "foreground":
      return "foreground";
    case "card":
      return "card";
    case "stroke":
      return "stroke";
    case "muted":
      return "muted";
    case "accent":
      return "accent";
    case "accent2":
      return "accent-2";
    default:
      return String(k);
  }
}
