"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AuthOverlayHost from "@/components/layout/AuthOverlayHost";
import { AuthOverlay } from "@/components/auth/AuthOverlay";
import { ThemeBoot } from "@/components/theme/ThemeBoot";
import { ShellLayout } from "@/components/shell/ShellLayout";
import { useAppMode } from "@/lib/teamScope";
import { TalliesLanding } from "@/components/tallies/TalliesLanding";
import { TalliesSignIn } from "@/components/tallies/TalliesSignIn";
import { LegacyLinkRedirect, TalliesCoachShell } from "@/components/tallies/TalliesFrames";

function LandingOrLegacyHome() {
  const sp = useSearchParams();
  return sp.get("season") ? <LegacyLinkRedirect kind="home" /> : <TalliesLanding />;
}

function Redirect(props: { to: string }) {
  const router = useRouter();
  React.useEffect(() => router.replace(props.to), [router, props.to]);
  return null;
}

/**
 * Tallies mode (multi-coach builds): public pages need no session gate.
 *   /                 landing (old /?season= links redirect to the team route)
 *   /signin           coach sign-in
 *   /teams/**         parents' team pages in the team's own branding
 *   /admin            coach workspace (its gate checks access)
 *   /player, /trophies  old links: redirect to the permanent team route
 */
function TalliesFrame(props: { children: React.ReactNode }) {
  const path = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  if (path === "/") {
    return (
      <React.Suspense fallback={null}>
        <LandingOrLegacyHome />
      </React.Suspense>
    );
  }
  if (path === "/signin") return <TalliesSignIn />;
  if (path === "/player") return <LegacyLinkRedirect kind="player" />;
  if (path === "/trophies") return <LegacyLinkRedirect kind="trophies" />;
  // My Players moves into the workspace with the Admin data layer (B+).
  if (path === "/profile") return <Redirect to="/admin/" />;
  if (path === "/admin") return <TalliesCoachShell>{props.children}</TalliesCoachShell>;
  return <ShellLayout>{props.children}</ShellLayout>;
}

export function AuthOverlayWrapper(props: { children: React.ReactNode }) {
  // The mode is known only after mount; until then nothing renders (the
  // legacy gate rendered nothing before mount either).
  const mode = useAppMode();
  if (mode === "tallies") {
    return (
      <>
        <ThemeBoot />
        <TalliesFrame>{props.children}</TalliesFrame>
      </>
    );
  }
  if (mode === null) return <ThemeBoot />;
  return (
    <>
      <ThemeBoot />
      <AuthOverlayHost />
      <AuthOverlay>
        <ShellLayout>{props.children}</ShellLayout>
      </AuthOverlay>
    </>
  );
}
