"use client";
import * as React from "react";
import { applyThemeMode, readThemeMode } from "@/lib/themeTokens";
import { MobileResponsive } from "@/components/shell/MobileResponsive";
import { AnimatedBackgroundSkin } from "@/components/shell/AnimatedBackgroundSkin";
import { Roster } from "@/components/roster/Roster";

export default function HomeClient() {
  React.useEffect(() => {
  applyThemeMode(readThemeMode());
}, []);

  return (
    <>
      <AnimatedBackgroundSkin />
      <div
        className="relative z-10 min-h-dvh"
         style={{ color: "var(--foreground)" }}
      >
        <MobileResponsive >
          <Roster />
        </MobileResponsive>
      </div>
    </>
  );
}
