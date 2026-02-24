// components/home/ColorPickerDialog.tsx
"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMediaQuery } from "./useMediaQuery";

function clamp01(n: number) {
  if (Number.isNaN(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toHex2(n: number) {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

function parseRgba(v: string): { r: number; g: number; b: number; a: number } | null {
  const s = v.trim();
  const m = /^rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]*\.?[0-9]+)\s*\)$/.exec(
    s,
  );
  if (!m) return null;

  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = clamp01(Number(m[4]));

  if ([r, g, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;

  return { r, g, b, a };
}

function isHexColor(v: string) {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export function ColorPickerDialog(props: {
  value: string;
  onChangeAction: (next: string) => void;
  label?: string;
  buttonClassName?: string;
}) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [open, setOpen] = React.useState(false);

  const initial = React.useMemo(() => {
    const trimmed = props.value.trim();
    if (isHexColor(trimmed)) return { mode: "hex" as const, hex: trimmed };
    const rgba = parseRgba(trimmed);
    if (rgba) return { mode: "rgba" as const, rgba, hex: rgbToHex(rgba.r, rgba.g, rgba.b) };
    return { mode: "unknown" as const, raw: trimmed };
  }, [props.value]);

  const [hex, setHex] = React.useState(initial.mode === "hex" ? initial.hex : initial.mode === "rgba" ? initial.hex : "#ffffff");
  const [alpha, setAlpha] = React.useState(initial.mode === "rgba" ? initial.rgba.a : 1);

  React.useEffect(() => {
    // keep draft synced when token changes externally
    if (initial.mode === "hex") {
      setHex(initial.hex);
      setAlpha(1);
    } else if (initial.mode === "rgba") {
      setHex(initial.hex);
      setAlpha(initial.rgba.a);
    }
  }, [initial]);

  const close = React.useCallback(() => setOpen(false), []);
  const openDialog = React.useCallback(() => setOpen(true), []);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const apply = React.useCallback(() => {
    if (initial.mode === "rgba") {
      // Convert chosen hex -> rgba(r,g,b,a)
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const a = clamp01(alpha);
      props.onChangeAction(`rgba(${r}, ${g}, ${b}, ${a})`);
    } else {
      // Default to hex
      props.onChangeAction(hex);
    }
    close();
  }, [alpha, close, hex, initial.mode, props]);

  // If token is unknown (neither hex nor rgba), we still let user pick a hex and replace it.
  const subtitle =
    initial.mode === "rgba"
      ? "Pick a color and set opacity."
      : "Pick a color.";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={props.buttonClassName ?? "rounded-lg border px-2 py-1 text-[11px] font-semibold"}
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
          color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
          background: "color-mix(in oklab, var(--card) 70%, transparent)",
        }}
      >
        Edit
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0"
              style={{ background: "color-mix(in oklab, black 55%, transparent)" }}
              onClick={close}
            />

            <motion.div
              className="relative w-full max-w-140 rounded-2xl border p-4 shadow-2xl"
              initial={{ y: 10, scale: 0.99, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 10, scale: 0.99, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{
                borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
                background: "color-mix(in oklab, var(--card) 94%, var(--bg-base) 6%)",
                marginLeft: "calc(env(safe-area-inset-left, 0px) + 16px)",
                marginRight: "calc(env(safe-area-inset-right, 0px) + 16px)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {props.label ?? "Edit color"}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {subtitle}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border px-2 py-1 text-xs font-semibold"
                  style={{
                    borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
                    color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
                    background: "color-mix(in oklab, var(--bg-base) 55%, transparent)",
                  }}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-xl border"
                  style={{
                    borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
                    background: initial.mode === "rgba"
                      ? `linear-gradient(90deg, color-mix(in oklab, ${hex} ${Math.round(alpha * 100)}%, transparent), color-mix(in oklab, ${hex} ${Math.round(alpha * 100)}%, transparent))`
                      : hex,
                  }}
                />

                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded-lg border bg-transparent"
                  style={{
                    borderColor: "color-mix(in oklab, var(--stroke) 90%, transparent)",
                  }}
                />

                <div className="min-w-0 text-sm" style={{ color: "var(--muted)" }}>
                  {hex.toUpperCase()}
                </div>
              </div>

              {initial.mode === "rgba" ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                    Opacity
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(alpha * 100)}
                      onChange={(e) => setAlpha(clamp01(Number(e.target.value) / 100))}
                      className="w-full"
                    />
                    <div className="w-12 text-right text-xs" style={{ color: "var(--muted)" }}>
                      {Math.round(alpha * 100)}%
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-semibold"
                  style={{
                    border: "1px solid color-mix(in oklab, var(--stroke) 90%, transparent)",
                    color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
                    background: "color-mix(in oklab, var(--bg-base) 55%, transparent)",
                  }}
                  onClick={close}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-semibold"
                  style={{
                    background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                    color: "black",
                  }}
                  onClick={apply}
                >
                  Apply
                </button>
              </div>

              {/* On mobile, keep focus inside dialog naturally; native picker handles itself */}
              {isMobile ? null : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
