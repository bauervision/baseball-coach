"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { BackToTop } from "../ui/BackToTop";
import { useRosterPlayers } from "@/lib/rosterStore";
import { useViewedSeasonId } from "@/lib/viewedSeason";
import { BrandingProvider } from "@/components/theme/BrandingProvider";
import { multiCoachEnabled } from "@/lib/features";
import { useTeamScope } from "@/lib/teamScope";
import { TALLIES_NEUTRAL_BRANDING } from "@/lib/talliesBrand";

export function ShellLayout(props: { children: React.ReactNode }) {
  // Shell shows the viewed season (?season=), else the active season.
  const viewedSeasonId = useViewedSeasonId();
  const { meta, loaded, error } = useRosterPlayers(viewedSeasonId);
  const pathname = usePathname();
  const scope = useTeamScope();

  const normalizedPathname = pathname.replace(/\/+$/, "");
  const isPlayerPage =
    normalizedPathname === "/player" || (scope.inTeam && scope.route?.view === "player");

  // Team routes (Tallies): the season's own branding once that season is
  // loaded; before that (or when nothing is published) the team's public
  // identity, else the neutral Tallies frame — never the Tigers default.
  const teamRoute = scope.inTeam;
  const showSeason = !teamRoute || (scope.status === "ready" && loaded);
  const teamFrame = teamRoute && !showSeason;
  const frameBranding = teamFrame
    ? (scope.team?.branding ?? TALLIES_NEUTRAL_BRANDING)
    : meta.branding;
  const frameTitle = teamFrame ? scope.team?.teamName || "Tallies" : null;

  // Multi-coach mode: the coach area belongs to the signed-in coach's own
  // workspace, not to the legacy current season, so the shell stays neutral
  // there (no legacy team/season labels, no raw loader errors).
  const [multiCoach, setMultiCoach] = React.useState(false);
  React.useEffect(() => setMultiCoach(multiCoachEnabled()), []);
  const coachArea = multiCoach && normalizedPathname === "/admin";

  const navTitle = React.useMemo(() => {
    if (frameTitle) return frameTitle;
    if (coachArea) return "Baseball Coach";
    const league = meta.league?.trim() ?? "";
    const team = meta.teamName?.trim() || "?";
    return league ? `${league} ${team}` : team;
  }, [frameTitle, coachArea, meta.league, meta.teamName]);

  const seasonLabel = React.useMemo(() => {
    if (coachArea || teamFrame) return undefined;
    const s = meta.seasonLabel?.trim();
    return s && s.length ? s : undefined;
  }, [coachArea, teamFrame, meta.seasonLabel]);

  return (
    <BrandingProvider branding={frameBranding}>
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
          <Navbar
            title={navTitle}
            seasonLabel={seasonLabel}
            viewedSeasonId={viewedSeasonId}
          />
        </div>

        <main className="flex-1">
          <div
            className={[
              "mx-auto w-full px-4 py-6 sm:py-10",
              isPlayerPage ? "max-w-none 2xl:px-10" : "max-w-6xl",
            ].join(" ")}
          >
            {error && !coachArea && !teamRoute ? (
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
          <Footer
            teamName={coachArea ? "" : teamFrame ? (frameTitle ?? "") : meta.teamName}
            league={coachArea || teamFrame ? "" : meta.league}
            seasonLabel={coachArea || teamFrame ? "" : meta.seasonLabel}
            poweredByTallies={teamRoute}
          />
          <BackToTop />
        </div>
      </div>
    </BrandingProvider>
  );
}
