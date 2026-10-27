// Representative legacy dataset for the Tallies migration (Checkpoint D1),
// as a flat state (path → JSON-tagged data, the tools' format). Built from
// the production-shaped Tigers fixture (invented names; same document kinds,
// counts, ids, and legacy quirks as production) plus what production holds
// beyond it, verified structurally against the 2026-10-26 export:
// - Spring 2026 (tigers-2026): no teamName/seasonLabel, dotted legacy
//   record fields, p01-style ids — here also FINALIZED by the legacy app
//   (status, finalizedAt, finalizedByUid, lifecycleHistory on the season).
// - Fall 2026 (tigers-fall-2026): current in app/config, layouts, game
//   balls, lineup snapshots, a game without gameType.
// - A Falcons team (no owner yet) and its Spring 2027 DRAFT whose roster
//   entries are keyed by permanent identity ids (as the legacy app wrote
//   them), carry private fields publicly, link to Tigers seasons, and whose
//   season doc carries coachUids.
// - The owner's admins doc and (bound) coach record + workspace.
// No production child data appears here.

import { toJson } from "../../tools/identity/firestore.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { COACH_UID } from "./fixtures.mjs";
import { productionShapedSnapshot } from "./productionShapedFixture.mjs";

export const OWNER = COACH_UID;
export const WORKSPACE = "ws_0000000000000000000000a1";
export const FALCONS = "falcons-ab12";
export const FALCONS_DRAFT = "falcons-spring-2027";
export const SPRING = "tigers-2026";
export const FALL = "tigers-fall-2026";

const ts = (iso) => ({ __timestamp: new Date(iso).toISOString() });

export function falconsBranding() {
  const b = structuredClone(LEGACY_TIGERS_BRANDING);
  return { ...b, teamName: "Falcons", shortName: "FAL", division: "10U", logo: null, palettes: { dark: { ...b.palettes.dark, primary: "#1d4ed8" }, light: { ...b.palettes.light, primary: "#1d4ed8" } } };
}

export function legacyState({ finalizeSpring = true, falcons = true, bound = true } = {}) {
  const snap = productionShapedSnapshot({ migrated: true });
  const st = new Map();
  const put = (p, d) => st.set(p, toJson(d));
  put(`admins/${OWNER}`, { enabled: true });
  put("app/config", snap.config);
  for (const s of snap.seasons) {
    const sp = `seasons/${s.seasonId}`;
    const data = { ...s.data };
    if (s.seasonId === SPRING && finalizeSpring) {
      Object.assign(data, {
        status: "finalized",
        finalizedAt: new Date("2026-06-02T12:00:00Z"),
        finalizedByUid: OWNER,
        lifecycleHistory: [{ action: "finalized", at: "2026-06-02T12:00:00.000Z", byUid: OWNER, fromStatus: "active" }],
      });
    }
    put(sp, data);
    for (const p of s.players) put(`${sp}/players/${p.id}`, p.data);
    for (const g of s.games) {
      put(`${sp}/games/${g.id}`, g.data);
      for (const l of g.lines) put(`${sp}/games/${g.id}/lines/${l.id}`, l.data);
    }
    for (const l of s.lineups) put(`${sp}/lineups/${l.id}`, l.data);
  }
  if (bound) {
    put(`coaches/${OWNER}`, { workspaceId: WORKSPACE, inviteId: "inv_migration", status: "active", createdAt: new Date("2026-10-26T12:00:00Z") });
    put(`coachWorkspaces/${WORKSPACE}`, { ownerUid: OWNER, status: "active", createdAt: new Date("2026-10-26T12:00:00Z") });
  }
  if (falcons) {
    const b = falconsBranding();
    st.set(`teams/${FALCONS}`, { ...toJson(b), teamId: FALCONS, createdAt: ts("2026-10-24T12:00:00Z"), updatedAt: ts("2026-10-24T12:00:00Z") });
    const snapshot = { ...b, teamId: FALCONS };
    put(`seasons/${FALCONS_DRAFT}`, {
      teamName: "Falcons", seasonLabel: "Spring 2027", league: "10U", status: "draft", teamId: FALCONS, branding: snapshot,
      scheduledGames: 12, gamesPlayed: 0, usesGamesPlayedRecord: true, record: { wins: 0, losses: 0, ties: 0 },
      coachUids: [OWNER], createdAt: new Date("2026-10-24T12:00:00Z"), updatedAt: new Date("2026-10-24T12:00:00Z"),
    });
    // Two returning Tigers (identity-keyed ids, linked to their Tigers
    // entries) and one new player.
    const fall = (id) => st.get(`seasons/${FALL}/players/${id}`);
    const entries = [
      { from: "21-alex-rivera", spring: "p01" },
      { from: "24-casey-morgan", spring: "p03" },
      { newId: "e5e5e5e5-0000-4000-8000-000000000005", name: "Toby Grant", number: 9 },
    ];
    for (const e of entries) {
      const src = e.from ? fall(e.from) : null;
      const cid = src ? src.careerPlayerId : e.newId;
      put(`seasons/${FALCONS_DRAFT}/players/${cid}`, {
        id: cid, name: src ? src.name : e.name, number: src ? src.number : e.number, careerPlayerId: cid,
        identityStatus: "confirmed", returningPlayer: !!src, leaderboardHidden: false, shirtSize: "YL",
        linkedFrom: src ? [{ seasonId: FALL, seasonPlayerId: e.from }, { seasonId: SPRING, seasonPlayerId: e.spring }] : [],
        stats: Object.fromEntries(Object.keys(src?.stats ?? fall("21-alex-rivera").stats).map((k) => [k, 0])),
        createdAt: new Date("2026-10-24T12:00:00Z"), updatedAt: new Date("2026-10-24T12:00:00Z"),
      });
    }
  }
  st.missingParents = [];
  return st;
}

/** Seeds a state into the emulator with the Admin SDK (rules bypassed). */
export async function seedState(admin, state, fromJson) {
  const entries = [...state];
  for (let i = 0; i < entries.length; i += 400) {
    const batch = admin.batch();
    for (const [p, d] of entries.slice(i, i + 400)) batch.set(admin.doc(p), fromJson(d, admin));
    await batch.commit();
  }
}
