import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BUNDLED_LOGOS,
  LEGACY_TIGERS_BRANDING,
  SPORTS,
  contrastRatio,
  contrastWarnings,
  isSupportedSport,
  isValidColor,
  isValidLogoRef,
  newTeamId,
  newTeamTemplate,
  normalizeBranding,
  plaqueAccents,
  resolveLogo,
  sameBranding,
  snapshotFromTeam,
  teamInitials,
  validateBranding,
} from "../src/lib/branding.ts";
import {
  AWARD_COLLECTIONS,
  REQUIRED_AWARD_KEYS,
  SELECTABLE_COLLECTION_IDS,
  collectionArt,
  isCollectionSelectable,
  missingArtwork,
  trophyArtFor,
} from "../src/lib/awardCollections.ts";
import { DARK_TOKENS, LIGHT_TOKENS, TOKEN_KEYS } from "../src/lib/themeTokens.ts";
import { TROPHY_ART } from "../src/lib/trophyArtwork.ts";

const SOFTBALL = {
  ...structuredClone(LEGACY_TIGERS_BRANDING),
  teamId: "falcons-ab12",
  teamName: "Falcons",
  shortName: "FAL",
  sport: "softball",
  division: "10U",
  logo: null,
  palettes: {
    dark: { ...DARK_TOKENS, primary: "#2563eb", secondary: "#14b8a6", bgBase: "#07131f", card: "#0f2233" },
    light: { ...LIGHT_TOKENS, primary: "#1d4ed8", secondary: "#0f766e", bgBase: "#f4fbff" },
  },
};

test("legacy branding reproduces the original Tigers tokens exactly", () => {
  assert.deepEqual(LEGACY_TIGERS_BRANDING.palettes.dark, DARK_TOKENS);
  assert.deepEqual(LEGACY_TIGERS_BRANDING.palettes.light, LIGHT_TOKENS);
  assert.equal(LEGACY_TIGERS_BRANDING.teamName, "Tigers");
  assert.equal(LEGACY_TIGERS_BRANDING.division, "Mustang");
  assert.equal(LEGACY_TIGERS_BRANDING.sport, "baseball");
  assert.equal(LEGACY_TIGERS_BRANDING.awardCollection, "original");
  assert.equal(resolveLogo(LEGACY_TIGERS_BRANDING.logo)?.mark, "/TigersLogo.png");
  assert.equal(resolveLogo(LEGACY_TIGERS_BRANDING.logo)?.color, "/TigersLogoColor.png");
  assert.deepEqual(validateBranding(LEGACY_TIGERS_BRANDING), {}, "every original token is a valid color");
  // A season without a snapshot falls back to legacy (null = "use legacy").
  assert.equal(normalizeBranding(undefined), null);
  assert.equal(normalizeBranding({ teamName: "x" }), null, "partial snapshots are not trusted");
});

test("sports: only baseball and softball can be chosen or stored", () => {
  assert.deepEqual(SPORTS.filter((s) => s.available).map((s) => s.id), ["baseball", "softball"]);
  assert.deepEqual(SPORTS.filter((s) => !s.available).map((s) => s.id), ["basketball", "football", "soccer", "volleyball"]);
  for (const s of SPORTS) assert.equal(isSupportedSport(s.id), s.available, s.id);
  assert.ok(validateBranding({ ...SOFTBALL, sport: "basketball" }).sport);
  assert.equal(normalizeBranding({ ...SOFTBALL, sport: "soccer" }), null);
  assert.deepEqual(validateBranding(SOFTBALL), {});
});

test("dark and light palettes are independent and copied, never shared", () => {
  const team = structuredClone(SOFTBALL);
  const snap = snapshotFromTeam(team);
  team.palettes.dark.primary = "#ff0000";
  assert.equal(snap.palettes.dark.primary, "#2563eb", "snapshot is a copy");
  assert.notEqual(snap.palettes.dark.primary, snap.palettes.light.primary, "not derived from each other");
  const edited = structuredClone(SOFTBALL);
  edited.palettes.light.card = "#fafafa";
  assert.deepEqual(edited.palettes.dark, SOFTBALL.palettes.dark, "editing light leaves dark untouched");
});

test("colors: hex and rgb()/rgba() only; injection and partial palettes rejected", () => {
  for (const ok of ["#fff", "#ff4d00", "#ff4d0080", "rgb(1, 2, 3)", "rgba(204, 204, 204, 0.11029380963341695)"]) {
    assert.ok(isValidColor(ok), ok);
  }
  for (const bad of ["red", "url(/x.png)", "#ff4d00; background:url(x)", "var(--x)", "rgba(1,2,3,0.5) !important", "", "expression(alert(1))"]) {
    assert.ok(!isValidColor(bad), bad);
  }
  const badPalette = structuredClone(SOFTBALL);
  badPalette.palettes.dark.primary = "url(https://evil)";
  assert.ok(validateBranding(badPalette).palettes);
  const missingKey = structuredClone(SOFTBALL);
  delete missingKey.palettes.light.accent2;
  assert.ok(validateBranding(missingKey).palettes);
  const extraKey = structuredClone(SOFTBALL);
  extraKey.palettes.dark.background = "#000";
  assert.ok(validateBranding(extraKey).palettes);
  assert.deepEqual(TOKEN_KEYS.length, 9);
});

test("contrast: warnings flag weak pairs without changing colors", () => {
  assert.deepEqual(contrastWarnings(DARK_TOKENS), []);
  // Known baseline finding: Tigers gold nav icons on the light background.
  assert.deepEqual(contrastWarnings(LIGHT_TOKENS).map((w) => w.label), ["Navigation highlight on background"]);
  const poor = { ...DARK_TOKENS, foreground: "#2a2a2e", muted: "#303035" };
  const warnings = contrastWarnings(poor);
  assert.ok(warnings.some((w) => w.label === "Text on page background"));
  assert.equal(poor.foreground, "#2a2a2e", "colors are never replaced");
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
});

test("logos: bundled ids only, with an initials fallback", () => {
  assert.ok(isValidLogoRef(null));
  assert.ok(isValidLogoRef({ kind: "bundled", id: "tigers" }));
  assert.ok(!isValidLogoRef({ kind: "bundled", id: "dla" }), "not every public image is a team logo");
  assert.ok(!isValidLogoRef({ kind: "url", id: "https://example.com/x.png" }));
  assert.ok(!isValidLogoRef({ kind: "bundled", id: "tigers", src: "/x" }));
  assert.equal(resolveLogo(null), null);
  assert.equal(teamInitials("Falcons"), "FA");
  assert.equal(teamInitials("Lady Hawks"), "LH");
  for (const l of BUNDLED_LOGOS) {
    assert.ok(fs.existsSync(path.join("public", l.mark)) && fs.existsSync(path.join("public", l.color)), l.id);
  }
});

test("award collections: only complete, available collections are selectable", () => {
  const original = AWARD_COLLECTIONS.find((c) => c.id === "original");
  assert.deepEqual(missingArtwork(original), []);
  assert.deepEqual(REQUIRED_AWARD_KEYS, Object.keys(TROPHY_ART));
  assert.deepEqual(SELECTABLE_COLLECTION_IDS, ["original"]);
  assert.deepEqual(
    AWARD_COLLECTIONS.map((c) => [c.id, c.name, c.available]),
    [["original", "Original", true], ["girl-power", "Girl Power", false], ["boys-of-summer", "Boys of Summer", false], ["cyberball", "Cyberball", false]],
  );
  for (const c of AWARD_COLLECTIONS.filter((x) => !x.available)) {
    assert.equal(c.preview, null, "no placeholder artwork");
    assert.equal(missingArtwork(c).length, REQUIRED_AWARD_KEYS.length);
    assert.equal(isCollectionSelectable(c.id), false);
  }
  // A partially populated collection can never become active.
  const partial = { ...original, id: "partial", available: true, art: { mvp: "/trophies/mvp.png" } };
  assert.ok(missingArtwork(partial).length > 0);
  for (const src of new Set(Object.values(original.art))) assert.ok(fs.existsSync(path.join("public", src)), src);
  assert.equal(collectionArt("cyberball"), original.art, "unavailable falls back to Original");
  assert.equal(trophyArtFor("original", "mvp"), "/trophies/mvp.png");
  assert.equal(trophyArtFor("original", "unknown"), "/trophies/trophy.png");
});

test("recognition sheet accents: Tigers exact, other teams derived from their light palette", () => {
  assert.deepEqual(plaqueAccents(LIGHT_TOKENS), { brand: "#ff4d00", deep: "#d9480f", gold: "#efa243", goldLine: "#d9a35a" });
  const a = plaqueAccents(SOFTBALL.palettes.light);
  assert.equal(a.brand, "#1d4ed8");
  assert.equal(a.gold, "#0f766e");
  assert.match(a.deep, /color-mix\(in srgb, #1d4ed8/);
});

test("unsaved-change detection ignores key order but catches edits", () => {
  const a = structuredClone(SOFTBALL);
  const b = JSON.parse(JSON.stringify(SOFTBALL, Object.keys(SOFTBALL).reverse()));
  assert.ok(sameBranding(a, { ...b, palettes: SOFTBALL.palettes }));
  const c = structuredClone(SOFTBALL);
  c.palettes.light.muted = "#123456";
  assert.ok(!sameBranding(a, c));
  const t = newTeamTemplate();
  assert.equal(t.teamName, "");
  assert.equal(t.logo, null);
  assert.deepEqual(t.palettes, LEGACY_TIGERS_BRANDING.palettes, "new teams start from the original palette");
  assert.match(newTeamId("Lady Falcons 10U!", () => 0.5), /^lady-falcons-10u-[0-9a-z]{4}$/);
});

test("firestore.rules branding lists match the app's catalogs", () => {
  const rules = fs.readFileSync("firestore.rules", "utf8");
  const list = (fn) => JSON.parse(rules.match(new RegExp(`function ${fn}\\(\\) \\{ return (\\[[^\\]]*\\]); \\}`))[1].replace(/'/g, '"'));
  assert.deepEqual(list("brandingSports"), SPORTS.filter((s) => s.available).map((s) => s.id));
  assert.deepEqual(list("brandingLogoIds"), BUNDLED_LOGOS.map((l) => l.id));
  assert.deepEqual(list("brandingCollections"), [...SELECTABLE_COLLECTION_IDS]);
});
