"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import type { ThemeMode } from "@/lib/themeTokens";
import {
  applyThemeMode,
  readThemeMode,
  writeThemeMode,
} from "@/lib/themeTokens";

export function ThemeModeToggle(props: { disabled?: boolean }) {
  const [mode, setMode] = React.useState<ThemeMode>("dark");

  React.useEffect(() => {
    const m = readThemeMode();
    setMode(m);
    applyThemeMode(m);
  }, []);

  const onToggleAction = React.useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      writeThemeMode(next);
      applyThemeMode(next);
      return next;
    });
  }, []);

  const isDark = mode === "dark";

  return (
    <button
      type="button"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      disabled={props.disabled}
      onClick={onToggleAction}
      className="grid h-9 w-9 place-items-center rounded-xl border shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
      style={{
       color: "var(--secondary)" ,
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 72%, transparent))",
      }}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
