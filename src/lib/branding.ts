// Team identity and branding.
//
//   teams/{teamId}              the team's current identity and branding
//   seasons/{id}.teamId         which team a season belongs to
//   seasons/{id}.branding       the season's own snapshot of that branding
//
// Every view renders from the *season* snapshot, so later edits to a team
// never change past seasons or their printed recognition sheets. Seasons
// saved before branding existed have no snapshot and use the deterministic
// LEGACY_TIGERS_BRANDING, which reproduces the original Tigers appearance.
//
// Pure functions only; Firestore lives in teamStore.ts. Validation here
// mirrors firestore.rules.

import { DARK_TOKENS, LIGHT_TOKENS, TOKEN_KEYS, type ThemeTokens } from "@/lib/themeTokens";
import { isCollectionSelectable } from "@/lib/awardCollections";

export type ThemePalette = ThemeTokens;

export type SportId = "baseball" | "softball" | "basketball" | "football" | "soccer" | "volleyball";

export const SPORTS: Array<{ id: SportId; label: string; icon: string; available: boolean }> = [
  { id: "baseball", label: "Baseball", icon: "⚾", available: true },
  { id: "softball", label: "Softball", icon: "🥎", available: true },
  { id: "basketball", label: "Basketball", icon: "🏀", available: false },
  { id: "football", label: "Football", icon: "🏈", available: false },
  { id: "soccer", label: "Soccer", icon: "⚽", available: false },
  { id: "volleyball", label: "Volleyball", icon: "🏐", available: false },
];

export type SupportedSport = "baseball" | "softball";

export function isSupportedSport(v: unknown): v is SupportedSport {
  return v === "baseball" || v === "softball";
}

export function sportLabel(sport: SupportedSport): string {
  return sport === "softball" ? "Softball" : "Baseball";
}

// ---------------------------------------------------------------------------
// Logos. A reference is a tagged object so uploaded logos can be added later
// ({ kind: "uploaded", path }) without changing the team/season model.

export type LogoRef = { kind: "bundled"; id: string } | null;

export type BundledLogo = {
  id: string;
  name: string;
  /** Single-color mark, tinted with theme colors via CSS mask. */
  mark: string;
  /** Full-color artwork. */
  color: string;
};

export const BUNDLED_LOGOS: BundledLogo[] = [
  { id: "tigers", name: "Tigers D", mark: "/TigersLogo.png", color: "/TigersLogoColor.png" },
];

export function resolveLogo(ref: LogoRef): BundledLogo | null {
  if (!ref || ref.kind !== "bundled") return null;
  return BUNDLED_LOGOS.find((l) => l.id === ref.id) ?? null;
}

/** Fallback mark when no logo is chosen. */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Branding

export type Palettes = { dark: ThemePalette; light: ThemePalette };

/** What a season snapshots (and a team stores). */
export type SeasonBranding = {
  teamId: string | null;
  teamName: string;
  shortName: string;
  sport: SupportedSport;
  division: string;
  logo: LogoRef;
  palettes: Palettes;
  awardCollection: string;
};

export type Team = SeasonBranding & { teamId: string };

/** The original Tigers look, used for seasons without a snapshot. */
export const LEGACY_TIGERS_BRANDING: SeasonBranding = Object.freeze({
  teamId: null,
  teamName: "Tigers",
  shortName: "",
  sport: "baseball",
  division: "Mustang",
  logo: { kind: "bundled", id: "tigers" },
  palettes: { dark: { ...DARK_TOKENS }, light: { ...LIGHT_TOKENS } },
  awardCollection: "original",
}) as SeasonBranding;

/** Starting point for a new team (the Tigers palettes, no logo). */
export function newTeamTemplate(): Omit<Team, "teamId"> & { teamId: "" } {
  return {
    ...structuredClone(LEGACY_TIGERS_BRANDING),
    teamId: "",
    teamName: "",
    division: "",
    logo: null,
  };
}

export const PALETTE_LABELS: Record<keyof ThemePalette, string> = {
  bgBase: "Page background",
  card: "Card surface",
  foreground: "Text",
  muted: "Secondary text",
  stroke: "Borders",
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  accent2: "Accent 2",
};

// Hex (#rgb, #rrggbb, #rrggbbaa) or rgb()/rgba(). Nothing else reaches CSS.
// Must match validColor() in firestore.rules exactly.
const COLOR_RE =
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?[(] *[0-9]{1,3} *, *[0-9]{1,3} *, *[0-9]{1,3} *(, *(0|1|0?[.][0-9]+|1[.]0+) *)?[)])$/;

export function isValidColor(v: unknown): v is string {
  return typeof v === "string" && v.length <= 48 && COLOR_RE.test(v);
}

export function isValidPalette(p: unknown): p is ThemePalette {
  if (!p || typeof p !== "object") return false;
  const keys = Object.keys(p);
  return (
    keys.length === TOKEN_KEYS.length &&
    TOKEN_KEYS.every((k) => isValidColor((p as Record<string, unknown>)[k]))
  );
}

export function isValidLogoRef(v: unknown): v is LogoRef {
  if (v === null) return true;
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    Object.keys(r).length === 2 &&
    r.kind === "bundled" &&
    typeof r.id === "string" &&
    BUNDLED_LOGOS.some((l) => l.id === r.id)
  );
}

export type BrandingErrors = Partial<Record<"teamName" | "shortName" | "sport" | "division" | "logo" | "palettes" | "awardCollection", string>>;

export function validateBranding(b: Omit<SeasonBranding, "teamId">): BrandingErrors {
  const e: BrandingErrors = {};
  const name = b.teamName.trim();
  if (!name) e.teamName = "Enter a team name.";
  else if (name.length > 40) e.teamName = "Use 40 characters or fewer.";
  if (b.shortName.trim().length > 12) e.shortName = "Use 12 characters or fewer.";
  if (!isSupportedSport(b.sport)) e.sport = "Choose baseball or softball.";
  if (b.division.trim().length > 40) e.division = "Use 40 characters or fewer.";
  if (!isValidLogoRef(b.logo)) e.logo = "Choose a bundled logo or none.";
  if (!isValidPalette(b.palettes?.dark) || !isValidPalette(b.palettes?.light)) {
    e.palettes = "Every color must be a hex (#rrggbb) or rgb()/rgba() value.";
  }
  if (!isCollectionSelectable(b.awardCollection)) e.awardCollection = "Choose an available award collection.";
  return e;
}

/** Parses a stored snapshot; anything invalid yields null (use legacy). */
export function normalizeBranding(raw: unknown): SeasonBranding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const palettes = r.palettes as Record<string, unknown> | undefined;
  const candidate: SeasonBranding = {
    teamId: typeof r.teamId === "string" && r.teamId ? r.teamId : null,
    teamName: typeof r.teamName === "string" ? r.teamName.trim() : "",
    shortName: typeof r.shortName === "string" ? r.shortName.trim() : "",
    sport: r.sport as SupportedSport,
    division: typeof r.division === "string" ? r.division.trim() : "",
    logo: (r.logo ?? null) as LogoRef,
    palettes: { dark: palettes?.dark as ThemePalette, light: palettes?.light as ThemePalette },
    awardCollection: typeof r.awardCollection === "string" ? r.awardCollection : "",
  };
  return Object.keys(validateBranding(candidate)).length === 0 ? candidate : null;
}

/** What gets written to seasons/{id}.branding from a team. */
export function snapshotFromTeam(team: Team): SeasonBranding {
  return {
    teamId: team.teamId,
    teamName: team.teamName.trim(),
    shortName: team.shortName.trim(),
    sport: team.sport,
    division: team.division.trim(),
    logo: team.logo ? { kind: "bundled", id: team.logo.id } : null,
    palettes: { dark: { ...team.palettes.dark }, light: { ...team.palettes.light } },
    awardCollection: team.awardCollection,
  };
}

export function sameBranding(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Stable, readable id: slug of the name plus a short random suffix. */
export function newTeamId(name: string, random = Math.random): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "team";
  const suffix = Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${slug}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.x). Warnings only: the coach's colors are never changed.

type RGBA = { r: number; g: number; b: number; a: number };

export function parseColor(c: string): RGBA | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((x) => parseInt(x + x, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : Math.min(1, +m[4]) };
  return null;
}

function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(fg: string, bg: string, page = "#ffffff"): number | null {
  const pageC = parseColor(page);
  const b0 = parseColor(bg);
  const f0 = parseColor(fg);
  if (!pageC || !b0 || !f0) return null;
  const b = over(b0, over(pageC, { r: 0, g: 0, b: 0, a: 1 }));
  const f = over(f0, b);
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastWarning = { label: string; ratio: number; minimum: number };

/** Representative pairs as the app renders them. */
export function contrastWarnings(p: ThemePalette): ContrastWarning[] {
  const BUTTON_INK = "rgba(0,0,0,0.92)";
  const checks: Array<[string, string, string, number]> = [
    ["Text on page background", p.foreground, p.bgBase, 4.5],
    ["Text on cards", p.foreground, p.card, 4.5],
    ["Secondary text on cards", p.muted, p.card, 4.5],
    ["Button label on primary", BUTTON_INK, p.primary, 4.5],
    ["Button label on secondary", BUTTON_INK, p.secondary, 4.5],
    ["Navigation highlight on background", p.secondary, p.bgBase, 3],
    ["Primary accents on cards", p.primary, p.card, 3],
  ];
  const out: ContrastWarning[] = [];
  for (const [label, fg, bg, minimum] of checks) {
    const ratio = contrastRatio(fg, bg, p.bgBase);
    if (ratio !== null && ratio < minimum) out.push({ label, ratio: Math.round(ratio * 100) / 100, minimum });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Print palette for recognition sheets (light paper, team accents).

export type PlaqueAccents = { brand: string; deep: string; gold: string; goldLine: string };

const TIGERS_PLAQUE: PlaqueAccents = { brand: "#ff4d00", deep: "#d9480f", gold: "#efa243", goldLine: "#d9a35a" };

/**
 * Sheet accents from the season's light palette. The original Tigers
 * colors map to the exact original sheet constants (pixel-identical);
 * other teams derive deeper shades with color-mix.
 */
export function plaqueAccents(light: ThemePalette): PlaqueAccents {
  if (
    light.primary.toLowerCase() === LIGHT_TOKENS.primary &&
    light.secondary.toLowerCase() === LIGHT_TOKENS.secondary
  ) {
    return TIGERS_PLAQUE;
  }
  return {
    brand: light.primary,
    deep: `color-mix(in srgb, ${light.primary} 82%, #000)`,
    gold: light.secondary,
    goldLine: `color-mix(in srgb, ${light.secondary} 80%, #6b5a40)`,
  };
}
