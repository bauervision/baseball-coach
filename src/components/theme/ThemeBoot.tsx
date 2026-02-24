"use client";

import * as React from "react";
import { applyThemeMode, readThemeMode } from "@/lib/themeTokens";

export function ThemeBoot() {
  // layout effect runs before paint (prevents flash / wrong first render)
  React.useLayoutEffect(() => {
    applyThemeMode(readThemeMode());
  }, []);

  return null;
}