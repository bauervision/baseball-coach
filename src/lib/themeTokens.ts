import { storageKey } from "@/lib/storage";

export type ThemeMode = "light" | "dark";

export type ThemeTokens = {
  bgBase: string;
  foreground: string;
  card: string;
  stroke: string;
  muted: string;

  primary: string;
  secondary: string;

  accent: string;
  accent2: string;
};

export const TOKEN_KEYS: Array<keyof ThemeTokens> = [
  "bgBase",
  "foreground",
  "card",
  "stroke",
  "muted",
  "primary",
  "secondary",
  "accent",
  "accent2",
];

export function applyThemeTokens(tokens: ThemeTokens) {
  if (typeof document === "undefined") return;
  const r = document.documentElement;

  r.style.setProperty("--bg-base", tokens.bgBase);
  r.style.setProperty("--foreground", tokens.foreground);
  r.style.setProperty("--card", tokens.card);
  r.style.setProperty("--stroke", tokens.stroke);
  r.style.setProperty("--muted", tokens.muted);

  r.style.setProperty("--primary", tokens.primary);
  r.style.setProperty("--secondary", tokens.secondary);

  r.style.setProperty("--accent", tokens.accent);
  r.style.setProperty("--accent-2", tokens.accent2);
}

export function tokensToCss(tokens: ThemeTokens) {
  return [
    `:root {`,
    `  --bg-base: ${tokens.bgBase};`,
    `  --foreground: ${tokens.foreground};`,
    `  --card: ${tokens.card};`,
    `  --stroke: ${tokens.stroke};`,
    `  --muted: ${tokens.muted};`,
    ``,
    `  --primary: ${tokens.primary};`,
    `  --secondary: ${tokens.secondary};`,
    ``,
    `  --accent: ${tokens.accent};`,
    `  --accent-2: ${tokens.accent2};`,
    `}`,
  ].join("\n");
}

const THEME_MODE_KEY = storageKey("themeMode");

/**
 * Your fixed brand tokens (dark) + a clean light counterpart.
 * Brand colors remain the same in both modes.
 */
const DARK_TOKENS: ThemeTokens = {
  bgBase: "#0c0e12",
  foreground: "#e5e6e8",
  card: "#1f1f23",
  stroke: "rgba(204, 204, 204, 0.11029380963341695)",
  muted: "#8b8fa0",

  primary: "#ff4d00",
  secondary: "#efa243",

  accent: "#d352f4",
  accent2: "#6aea53",
};

const LIGHT_TOKENS: ThemeTokens = {
  bgBase: "#f7f8fb",
  foreground: "#0e1116",
  card: "#ffffff",
  stroke: "rgba(15, 18, 25, 0.14)",
  muted: "rgba(14, 17, 22, 0.62)",

  primary: DARK_TOKENS.primary,
  secondary: DARK_TOKENS.secondary,

  accent: DARK_TOKENS.accent,
  accent2: DARK_TOKENS.accent2,
};

export function getTokensForMode(mode: ThemeMode): ThemeTokens {
  return mode === "light" ? LIGHT_TOKENS : DARK_TOKENS;
}

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const raw = window.localStorage.getItem(THEME_MODE_KEY);
  return raw === "light" ? "light" : "dark";
}

export function writeThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_MODE_KEY, mode);
}

export function applyThemeMode(mode: ThemeMode) {
  applyThemeTokens(getTokensForMode(mode));

  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
}