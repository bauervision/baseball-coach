"use client";

// Applies a season's branding (palettes, logo) and exposes it to the tree.
//
// The shell wraps every page with the *viewed* season's branding, so
// historical pages render with their own snapshot. Palettes go through the
// existing theme-token pipeline (applyThemeMode), so the light/dark toggle
// keeps working unchanged. Logos are exposed as CSS variables
// (--team-logo-mark / --team-logo-color) for CSS mask/background use.

import * as React from "react";

import {
  LEGACY_TIGERS_BRANDING,
  resolveLogo,
  teamInitials,
  type SeasonBranding,
} from "@/lib/branding";
import { collectionArt } from "@/lib/awardCollections";
import { applyThemeMode, readThemeMode, setActivePalettes } from "@/lib/themeTokens";

const BrandingContext = React.createContext<SeasonBranding>(LEGACY_TIGERS_BRANDING);

// Overlays rendered outside the shell (sign-in/out transitions) read the
// last applied branding from this tiny store.
let applied: SeasonBranding = LEGACY_TIGERS_BRANDING;
const listeners = new Set<() => void>();

export function useAppliedBranding(): SeasonBranding {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => applied,
    () => LEGACY_TIGERS_BRANDING,
  );
}

function logoVar(url: string | null): string {
  return url ? `url("${url}")` : "none";
}

/** App-level provider: applies the branding to the document. */
export function BrandingProvider(props: {
  branding: SeasonBranding;
  children: React.ReactNode;
}) {
  const { branding } = props;
  const key = JSON.stringify([branding.palettes, branding.logo]);

  React.useLayoutEffect(() => {
    setActivePalettes(branding.palettes);
    applyThemeMode(readThemeMode());
    const logo = resolveLogo(branding.logo);
    const root = document.documentElement.style;
    root.setProperty("--team-logo-mark", logoVar(logo?.mark ?? null));
    root.setProperty("--team-logo-color", logoVar(logo?.color ?? null));
    applied = branding;
    listeners.forEach((l) => l());
    // key captures the branding values that affect the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <BrandingContext.Provider value={branding}>{props.children}</BrandingContext.Provider>
  );
}

/**
 * Scoped provider for previews (Team Designer): only changes context, never
 * the document, so the live app is untouched until the coach saves.
 */
export function ScopedBranding(props: { branding: SeasonBranding; children: React.ReactNode }) {
  return <BrandingContext.Provider value={props.branding}>{props.children}</BrandingContext.Provider>;
}

export function useBranding(): SeasonBranding {
  return React.useContext(BrandingContext);
}

/**
 * Award artwork map (award key -> image) of the branding's collection.
 * Same shape as the original TROPHY_ART, so call sites keep their own
 * fallbacks unchanged.
 */
export function useTrophyArt(): Readonly<Record<string, string>> {
  const { awardCollection } = useBranding();
  return collectionArt(awardCollection);
}

/**
 * The team's logo mark. With a bundled logo it renders the element that
 * the given CSS class styles (mask with --team-logo-mark, or an explicit
 * logo); without one it renders the team's initials.
 */
export function TeamMark(props: {
  className?: string;
  style?: React.CSSProperties;
  /** Use this branding instead of context (previews). */
  branding?: SeasonBranding;
  monogramStyle?: React.CSSProperties;
}) {
  const ctx = useBranding();
  const b = props.branding ?? ctx;
  const logo = resolveLogo(b.logo);
  if (logo) {
    return (
      <div
        className={props.className}
        style={{ ...props.style, ["--team-logo-mark" as string]: logoVar(logo.mark), ["--team-logo-color" as string]: logoVar(logo.color) }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="grid h-full w-full place-items-center rounded-lg font-black leading-none"
      style={{
        background: "linear-gradient(135deg, var(--primary), var(--secondary))",
        color: "rgba(0,0,0,0.88)",
        fontSize: 13,
        ...props.monogramStyle,
      }}
    >
      {teamInitials(b.shortName || b.teamName)}
    </div>
  );
}
