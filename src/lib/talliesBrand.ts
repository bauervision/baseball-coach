// Tallies brand constants (public pages, coach shell, team-route states).
// Independent of every team theme: team pages keep their own season
// branding, and the Tigers' palettes and logo are never touched.

import type { SeasonBranding, ThemePalette } from "@/lib/branding";

export const TALLIES_NAME = "Tallies";
export const TALLIES_TAGLINE = "Every season counts.";

/** Brand palette (also mirrored as CSS tokens in src/styles/tallies.css). */
export const TALLIES_COLORS = {
  ink: "#221B3A",
  cream: "#FFF8EE",
  coral: "#EF4F5A",
  sunshine: "#FFB627",
  teal: "#1F9D8B",
  night: "#16122A",
} as const;

const LIGHT: ThemePalette = {
  bgBase: "#FFF8EE",
  foreground: "#221B3A",
  card: "#FFFFFF",
  stroke: "rgba(34, 27, 58, 0.14)",
  muted: "#625A78",
  primary: "#EF4F5A",
  secondary: "#FFB627",
  accent: "#1F9D8B",
  accent2: "#3B6FE0",
};

const DARK: ThemePalette = {
  bgBase: "#16122A",
  foreground: "#FFF4E6",
  card: "#221C3D",
  stroke: "rgba(255, 244, 230, 0.14)",
  muted: "#B9B0CF",
  primary: "#FF6B6F",
  secondary: "#FFC94D",
  accent: "#3CC2B0",
  accent2: "#7EA2FF",
};

/**
 * Neutral frame for team routes before a season is shown (loading, not
 * found, nothing published) and for the coach area: never the Tigers.
 */
export const TALLIES_NEUTRAL_BRANDING: SeasonBranding = Object.freeze({
  teamId: null,
  teamName: "Tallies",
  shortName: "",
  sport: "baseball",
  division: "",
  logo: null,
  palettes: { dark: DARK, light: LIGHT },
  awardCollection: "original",
}) as SeasonBranding;
