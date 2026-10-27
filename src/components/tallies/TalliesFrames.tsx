"use client";

// Tallies-mode frames: the coach area shell and the legacy-link redirect.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { TalliesLockup } from "@/components/brand/TalliesBrand";
import { BrandingProvider } from "@/components/theme/BrandingProvider";
import { ThemeModeToggle } from "@/components/shell/ThemeModeToggle";
import { getFirestoreDb } from "@/lib/firebase.client";
import { TALLIES_NEUTRAL_BRANDING } from "@/lib/talliesBrand";
import { seasonHomeHref, seasonPlayerHref, seasonTrophiesHref } from "@/lib/teamRoutes";

/** Coach area (/admin) in Tallies mode: neutral brand frame, no team labels. */
export function TalliesCoachShell(props: { children: React.ReactNode }) {
  React.useEffect(() => {
    document.title = "Coach workspace · Tallies";
  }, []);
  return (
    <BrandingProvider branding={TALLIES_NEUTRAL_BRANDING}>
      <div
        className="flex min-h-dvh flex-col"
        style={{ background: "var(--bg-base)", color: "var(--foreground)" }}
        data-tallies-coach-shell
      >
        <header
          className="border-b"
          style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)" }}
        >
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
            <Link href="/" aria-label="Tallies home" className="rounded-lg">
              <TalliesLockup size={26} />
            </Link>
            <ThemeModeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">{props.children}</main>
      </div>
    </BrandingProvider>
  );
}

function LegacyRedirectInner(props: { kind: "home" | "player" | "trophies" }) {
  const sp = useSearchParams();
  const router = useRouter();
  const season = sp.get("season")?.trim() || null;
  const id = sp.get("id")?.trim() || null;
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!season) {
      setFailed(true);
      return;
    }
    let active = true;
    // Only a published season with a team can be resolved (rules deny the
    // rest); legacy links never fall back to another season or team.
    getDoc(doc(getFirestoreDb(), "seasons", season))
      .then((s) => {
        if (!active) return;
        const d = s.exists() ? s.data() : null;
        const teamId = d && d.published === true && typeof d.teamId === "string" ? d.teamId : null;
        if (!teamId) return setFailed(true);
        router.replace(
          props.kind === "player" && id
            ? seasonPlayerHref(teamId, season, id)
            : props.kind === "trophies"
              ? seasonTrophiesHref(teamId, season)
              : seasonHomeHref(teamId, season),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [season, id, props.kind, router]);

  if (!failed) {
    return (
      <div className="tallies grid place-items-center px-4" role="status">
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>
          Finding this page…
        </p>
      </div>
    );
  }
  return (
    <div className="tallies grid place-items-center px-4" data-legacy-link="unresolved">
      <div className="tallies-card max-w-md p-6 text-center">
        <h1 className="text-xl font-extrabold">This link has moved</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
          Team pages now live at a permanent team link. Ask your coach for the current link.
        </p>
        <Link href="/" className="tallies-link mt-4 inline-block text-sm">
          Go to Tallies
        </Link>
      </div>
    </div>
  );
}

/** Old query links (/player?id=&season=, /trophies?season=, /?season=). */
export function LegacyLinkRedirect(props: { kind: "home" | "player" | "trophies" }) {
  return (
    <React.Suspense fallback={null}>
      <LegacyRedirectInner kind={props.kind} />
    </React.Suspense>
  );
}
