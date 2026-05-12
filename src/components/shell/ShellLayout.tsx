"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { BackToTop } from "../ui/BackToTop";
import { useRosterPlayers } from "@/lib/rosterStore";

export function ShellLayout(props: { children: React.ReactNode }) {
  const { meta, error } = useRosterPlayers();
  const pathname = usePathname();

  const normalizedPathname = pathname.replace(/\/+$/, "");
  const isPlayerPage = normalizedPathname === "/player";

  const navTitle = React.useMemo(() => {
    const league = meta.league?.trim() || "?";
    const team = meta.teamName?.trim() || "?";
    return `${league} ${team}`;
  }, [meta.league, meta.teamName]);

  const seasonLabel = React.useMemo(() => {
    const s = meta.seasonLabel?.trim();
    return s && s.length ? s : undefined;
  }, [meta.seasonLabel]);

  return (
    <div
      className="flex min-h-dvh flex-col overflow-x-hidden"
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
        <div
          className={[
            "mx-auto w-full px-4 py-6 sm:py-10",
            isPlayerPage ? "max-w-none 2xl:px-10" : "max-w-6xl",
          ].join(" ")}
        >
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
