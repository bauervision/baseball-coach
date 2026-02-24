// components/shell/ShellLayout.tsx
"use client";

import * as React from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { BackToTop } from "../ui/BackToTop";
import { useRosterPlayers } from "@/lib/rosterStore";

export function ShellLayout(props: { children: React.ReactNode }) {
  const { meta, players, error } = useRosterPlayers();

  // Left title: stable + short. (You can tweak this copy anytime.)
 const navTitle = React.useMemo(() => {
  const league = meta.league?.trim() || "?";
  const team = meta.teamName?.trim() || "?";
  return `${league} ${team}`;
}, [meta.league, meta.teamName]);

  // Center label: season label (desktop only in Navbar).
  const seasonLabel = React.useMemo(() => {
    const s = meta.seasonLabel?.trim();
    return s && s.length ? s : undefined;
  }, [meta.seasonLabel]);

  return (
    <div
      className="min-h-dvh flex flex-col overflow-x-hidden"
      style={{
        background: "var(--bg-base)",
        color: "var(--foreground)",
      }}
    >
      <div
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <Navbar title={navTitle} seasonLabel={seasonLabel} />
      </div>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
          {error ? (
            <div className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
              {error}
            </div>
          ) : null}

          {props.children}
        </div>
      </main>

      <div
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <Footer />
        <BackToTop />
      </div>
    </div>
  );
}