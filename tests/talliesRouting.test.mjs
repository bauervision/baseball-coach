// Tallies brand and permanent team routes (pure functions and source guards).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  parseTeamPath,
  seasonHomeHref,
  seasonPlayerHref,
  seasonTrophiesHref,
  teamHref,
  teamShareUrl,
} from "../src/lib/teamRoutes.ts";
import { computeCareerLinks, normalizeCareerLinks, sameLinks } from "../src/lib/careerLinks.ts";
import { careerLinksFor } from "../tools/privacy-split-migrate.mjs";
import { TALLIES_NEUTRAL_BRANDING, TALLIES_TAGLINE } from "../src/lib/talliesBrand.ts";
import { contrastRatio, normalizeBranding } from "../src/lib/branding.ts";

const read = (p) => fs.readFileSync(p, "utf8");

test("team paths parse to team, season, view, and player; everything else is not a team route", () => {
  assert.equal(parseTeamPath("/"), null);
  assert.equal(parseTeamPath("/player/"), null);
  assert.deepEqual(parseTeamPath("/teams/falcons-ab12/"), { teamId: "falcons-ab12", seasonId: null, view: "home", playerId: null });
  assert.deepEqual(parseTeamPath("/teams/t1/seasons/tigers-2026/home/"), { teamId: "t1", seasonId: "tigers-2026", view: "home", playerId: null });
  assert.deepEqual(parseTeamPath("/teams/t1/seasons/s1/trophies"), { teamId: "t1", seasonId: "s1", view: "trophies", playerId: null });
  assert.deepEqual(parseTeamPath("/teams/t1/seasons/s1/players/500-blake-turner/"), {
    teamId: "t1",
    seasonId: "s1",
    view: "player",
    playerId: "500-blake-turner",
  });
  for (const bad of ["/teams/", "/teams/t1/seasons/", "/teams/t1/seasons/s1", "/teams/t1/x", "/teams/t1/seasons/s1/players/", "/teams/t1/seasons/s1/nope", "/teams/%E0%A4%A/", "/teams/a%2Fb/", "/teams/../admin/"]) {
    assert.equal(parseTeamPath(bad), "invalid", bad);
  }
  // The roster store's "no season" sentinel can never be a route id.
  assert.equal(parseTeamPath("/teams/t1/seasons/__none__/home/"), "invalid");
  assert.match(read("src/lib/rosterStore.ts"), /export const NO_SEASON = "__none__";/);
});

test("links are built from ids only and round-trip through the parser", () => {
  assert.equal(teamHref("falcons-ab12"), "/teams/falcons-ab12/");
  for (const [href, want] of [
    [seasonHomeHref("t1", "s1"), { view: "home", seasonId: "s1" }],
    [seasonTrophiesHref("t1", "s1"), { view: "trophies", seasonId: "s1" }],
    [seasonPlayerHref("t1", "s1", "p1"), { view: "player", seasonId: "s1", playerId: "p1" }],
  ]) {
    const r = parseTeamPath(href);
    for (const [k, v] of Object.entries(want)) assert.equal(r[k], v, href);
  }
  const share = teamShareUrl("https://talllies.web.app/", "falcons-ab12");
  assert.equal(share, "https://talllies.web.app/teams/falcons-ab12/");
  // No season, coach, email, name, division, or location in the shared link.
  assert.doesNotMatch(share, /season|uid|@|coach|Falcons|Mustang|\?/);
});

test("public career links match the migration tool's algorithm (visible = published)", () => {
  const seasons = [
    { id: "s-spring", data: { status: "finalized", published: true }, players: [
      { id: "a1", data: { careerPlayerId: "cp-a", identityStatus: "confirmed" }, private: null },
      { id: "b1", data: {}, private: { careerPlayerId: "cp-b", identityStatus: "unreviewed" } },
    ] },
    { id: "s-fall", data: { status: "active", published: true }, players: [
      { id: "a2", data: {}, private: { careerPlayerId: "cp-a", identityStatus: "confirmed", linkedFrom: [{ seasonId: "s-spring", seasonPlayerId: "a1" }] } },
      { id: "b2", data: {}, private: { careerPlayerId: "cp-b", identityStatus: "confirmed", linkedFrom: [{ seasonId: "s-spring", seasonPlayerId: "b1" }] } },
    ] },
    { id: "s-draft", data: { status: "draft", published: false }, players: [
      { id: "a3", data: {}, private: { careerPlayerId: "cp-a", identityStatus: "confirmed", linkedFrom: [{ seasonId: "s-fall", seasonPlayerId: "a2" }] } },
    ] },
  ];
  const tool = careerLinksFor(seasons);
  const entries = seasons.flatMap((s) =>
    s.players.map((p) => {
      const eff = { ...(p.private ?? {}), ...p.data };
      return { seasonId: s.id, seasonPlayerId: p.id, careerPlayerId: eff.careerPlayerId, confirmed: eff.identityStatus === "confirmed", linkedFrom: eff.linkedFrom ?? [] };
    }),
  );
  const mine = computeCareerLinks(entries, new Set(["s-spring", "s-fall"]));
  assert.deepEqual(Object.fromEntries(mine), Object.fromEntries(tool));
  assert.deepEqual(mine.get("s-spring/a1"), [{ seasonId: "s-fall", seasonPlayerId: "a2" }]);
  assert.ok(!JSON.stringify([...mine.values()]).includes("s-draft"), "never links to an unpublished season");

  // Unpublishing Fall removes every link to it.
  const without = computeCareerLinks(entries, new Set(["s-spring"]));
  assert.deepEqual(without.get("s-spring/a1"), []);
  assert.deepEqual(without.get("s-spring/b1"), []);
  assert.deepEqual(without.get("s-fall/a2"), [{ seasonId: "s-spring", seasonPlayerId: "a1" }]);
});

test("stored career links are validated and compared by id", () => {
  assert.deepEqual(normalizeCareerLinks([{ seasonId: "s", seasonPlayerId: "p" }, { seasonId: "", seasonPlayerId: "x" }, null, "x"]), [{ seasonId: "s", seasonPlayerId: "p" }]);
  assert.ok(sameLinks([{ seasonId: "s", seasonPlayerId: "p" }], [{ seasonId: "s", seasonPlayerId: "p" }]));
  assert.ok(!sameLinks([], [{ seasonId: "s", seasonPlayerId: "p" }]));
});

test("Tallies brand: tagline unchanged, neutral frame is valid and readable, independent of the Tigers", () => {
  assert.equal(TALLIES_TAGLINE, "Every season counts.");
  assert.ok(normalizeBranding({ ...TALLIES_NEUTRAL_BRANDING }), "neutral branding passes the same validation as team branding");
  assert.equal(TALLIES_NEUTRAL_BRANDING.logo, null);
  for (const mode of ["light", "dark"]) {
    const p = TALLIES_NEUTRAL_BRANDING.palettes[mode];
    assert.ok(contrastRatio(p.foreground, p.bgBase) >= 7, `${mode} body text`);
    assert.ok(contrastRatio(p.muted, p.bgBase) >= 4.5, `${mode} muted text`);
  }
  // Public CSS tokens: ink on cream, button text, small coral text.
  const css = read("src/styles/tallies.css");
  assert.ok(contrastRatio("#221b3a", "#fff8ee") >= 7);
  assert.ok(contrastRatio("#b8283a", "#fff8ee") >= 4.5, "coral-ink small text on cream");
  assert.ok(contrastRatio("#625a78", "#fff8ee") >= 4.5, "muted on cream");
  assert.ok(contrastRatio("#b9b0cf", "#16122a") >= 4.5, "muted on night");
  assert.match(css, /^\.tallies \{/m, "tokens are scoped to .tallies, never :root");
  assert.doesNotMatch(css, /:root/);
  // The Tigers' palette and logo are untouched.
  assert.match(read("src/lib/branding.ts"), /LEGACY_TIGERS_BRANDING/);
});

test("Bubblegum Sans is the authentic OFL font, self-hosted with its license, wordmark only", () => {
  const woff2 = fs.readFileSync("src/app/fonts/BubblegumSans-Regular-latin.woff2");
  assert.equal(woff2.subarray(0, 4).toString("latin1"), "wOF2");
  const ofl = read("src/app/fonts/BubblegumSans-OFL.txt");
  assert.match(ofl, /Copyright \(c\) 2011 Angel Koziupa/);
  assert.match(ofl, /Reserved Font Name "Bubblegum Sans"/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.equal(read("public/licenses/BubblegumSans-OFL.txt"), ofl, "the served license matches the bundled one");
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /localFont\(\{[\s\S]*BubblegumSans-Regular-latin\.woff2[\s\S]*preload: false/);
  // Only the wordmark class uses the display face.
  const uses = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name) && /--font-tallies/.test(read(p))) uses.push(p);
    }
  };
  walk("src");
  assert.deepEqual(uses.sort(), ["src/app/layout.tsx", "src/styles/tallies.css"]);
  assert.match(read("src/styles/tallies.css"), /\.tallies-wordmark \{\s*font-family: var\(--font-tallies\)/);
});

test("future Tallies Hosting config targets only the reserved site and rewrites team routes", () => {
  const cfg = JSON.parse(read("firebase.tallies.json"));
  assert.equal(cfg.hosting.site, "talllies");
  assert.equal(cfg.firestore, undefined, "never deploys rules");
  assert.deepEqual(cfg.hosting.rewrites.map((r) => [r.source, r.destination]), [
    ["/teams/**", "/teams/index.html"],
    ["**", "/index.html"],
  ]);
  // The live site's config is unchanged.
  const live = JSON.parse(read("firebase.json"));
  assert.equal(live.hosting.site, "bauer-baseball");
  assert.equal(live.firestore.rules, "firestore.rules");
});
