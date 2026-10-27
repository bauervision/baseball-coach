// Read-only inventory of a source dataset (pure; works on a state Map).
// Reports structure, states, counts, legacy quirks, unexpected documents
// and fields, malformed values, and dangling references. Ids appear (some
// legacy roster ids embed names), so the file is written outside the repo;
// the console summary prints counts only.

import { LEDGER_PATH, PLAYER_PRIVATE, SEASON_PRIVATE, TEAM_KEYS, docsUnder, identityKeyed, seasonView } from "./model.mjs";

const KNOWN = {
  season: [
    "teamName", "seasonLabel", "league", "record", "record.wins", "record.losses", "gamesPlayed", "scheduledGames",
    "usesGamesPlayedRecord", "endSeasonMode", "finalAwards", "recognitionLayouts", "branding", "status", "finalizedAt",
    "reopenedAt", "activatedAt", "createdAt", "updatedAt", "teamId", "ownerUid", "published", ...SEASON_PRIVATE,
  ],
  player: [
    "id", "name", "number", "bats", "throws", "primaryPos", "returningPlayer", "leaderboardHidden", "stats",
    "createdAt", "updatedAt", "careerLinks", ...PLAYER_PRIVATE,
  ],
  game: ["date", "opponent", "result", "score", "gameType", "coachAwards", "gameBall", "lineupSnapshot", "createdAt", "updatedAt"],
  line: ["playerId", "name", "number", "delta"],
  lineup: ["id", "seasonId", "title", "inningCount", "rows", "createdAtISO", "updatedAtISO", "createdAt", "updatedAt"],
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function unknownFields(kind, data, path, out) {
  for (const k of Object.keys(data ?? {})) if (!KNOWN[kind].includes(k)) out.push({ path, field: k });
}

/** Classifies a roster doc id without printing it. */
export function idShape(id, careerPlayerId) {
  if (/^sp_[0-9a-f]{20}$/.test(id)) return "opaque";
  if (identityKeyed(id, careerPlayerId)) return "identity-keyed";
  if (/^p\d+$/.test(id)) return "legacy-sequence";
  return "legacy-name";
}

export function inventory(state, source = {}) {
  const { seasons, unknown } = seasonView(state);
  const unexpectedFields = [];
  const malformed = [];
  const dangling = [];
  const rows = [];
  for (const s of [...seasons.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const d = s.data ?? {};
    const sp = `seasons/${s.id}`;
    unknownFields("season", d, sp, unexpectedFields);
    const roster = new Set([...s.players.values()].filter((p) => p.data).map((p) => p.id));
    const players = { total: 0, withPrivateProfile: 0, privateFieldsPublic: 0, careerPlayerId: 0, confirmed: 0, linkedFrom: 0, careerLinks: 0, idShapes: {} };
    for (const p of s.players.values()) {
      if (!p.data) continue;
      const pp = `${sp}/players/${p.id}`;
      players.total++;
      if (p.profile) players.withPrivateProfile++;
      if (PLAYER_PRIVATE.some((k) => k in p.data)) players.privateFieldsPublic++;
      const eff = { ...p.data, ...(p.profile ?? {}) };
      if (eff.careerPlayerId) players.careerPlayerId++;
      if (eff.identityStatus === "confirmed") players.confirmed++;
      if (Array.isArray(eff.linkedFrom) && eff.linkedFrom.length) players.linkedFrom++;
      if (Array.isArray(p.data.careerLinks) && p.data.careerLinks.length) players.careerLinks++;
      const shape = idShape(p.id, eff.careerPlayerId);
      players.idShapes[shape] = (players.idShapes[shape] ?? 0) + 1;
      unknownFields("player", p.data, pp, unexpectedFields);
      if (typeof p.data.name !== "string" || !p.data.name.trim()) malformed.push({ path: pp, field: "name", issue: "missing" });
      if (!isNum(p.data.number)) malformed.push({ path: pp, field: "number", issue: `type ${typeof p.data.number}` });
      for (const [k, v] of Object.entries(p.data.stats ?? {})) if (!isNum(v)) malformed.push({ path: pp, field: `stats.${k}`, issue: `type ${typeof v}` });
      for (const r of Array.isArray(eff.linkedFrom) ? eff.linkedFrom : []) {
        const target = seasons.get(r?.seasonId)?.players.get(r?.seasonPlayerId);
        if (!target?.data) dangling.push({ path: pp, field: "linkedFrom", target: `${r?.seasonId}/${r?.seasonPlayerId}` });
      }
    }
    let lines = 0;
    const games = { total: s.games.size, results: { W: 0, L: 0, T: 0, other: 0 }, withoutGameType: 0, lineupSnapshots: 0, gameBalls: 0, coachAwards: 0 };
    for (const g of s.games.values()) {
      const gp = `${sp}/games/${g.id}`;
      const gd = g.data ?? {};
      unknownFields("game", gd, gp, unexpectedFields);
      if (["W", "L", "T"].includes(gd.result)) games.results[gd.result]++;
      else games.results.other++;
      if (!gd.gameType) games.withoutGameType++;
      if (gd.lineupSnapshot) games.lineupSnapshots++;
      if (gd.gameBall) games.gameBalls++;
      games.coachAwards += Object.keys(gd.coachAwards ?? {}).length;
      if (gd.score && (!isNum(gd.score.us) || !isNum(gd.score.them))) malformed.push({ path: gp, field: "score", issue: "non-numeric" });
      const ref = (field, id) => id && !roster.has(id) && dangling.push({ path: gp, field, target: id });
      for (const [k, a] of Object.entries(gd.coachAwards ?? {})) ref(`coachAwards.${k}`, a?.playerId);
      ref("gameBall", gd.gameBall?.playerId);
      for (const r of gd.lineupSnapshot?.rows ?? []) ref("lineupSnapshot", r?.playerId);
      for (const [lid, l] of g.lines) {
        lines++;
        const lp = `${gp}/lines/${lid}`;
        unknownFields("line", l, lp, unexpectedFields);
        if (!roster.has(lid)) dangling.push({ path: lp, field: "(line id)", target: lid });
        for (const [k, v] of Object.entries(l?.delta ?? {})) if (!isNum(v)) malformed.push({ path: lp, field: `delta.${k}`, issue: `type ${typeof v}` });
      }
    }
    for (const [lid, l] of s.lineups) {
      unknownFields("lineup", l, `${sp}/lineups/${lid}`, unexpectedFields);
      for (const r of l?.rows ?? []) if (r?.playerId && !roster.has(r.playerId)) dangling.push({ path: `${sp}/lineups/${lid}`, field: "rows", target: r.playerId });
    }
    for (const [k, v] of Object.entries(d.finalAwards ?? {})) if (v && !roster.has(v)) dangling.push({ path: sp, field: `finalAwards.${k}`, target: v });
    for (const k of Object.keys(d.recognitionLayouts ?? {})) if (!roster.has(k)) dangling.push({ path: sp, field: "recognitionLayouts", target: k });
    if (d.record && ["wins", "losses", "ties"].some((k) => k in d.record && !isNum(d.record[k]))) malformed.push({ path: sp, field: "record", issue: "non-numeric" });
    rows.push({
      seasonId: s.id,
      seasonDocExists: !!s.data,
      teamName: d.teamName ?? null,
      seasonLabel: d.seasonLabel ?? null,
      league: d.league ?? null,
      status: d.status ?? null,
      teamId: d.teamId ?? null,
      ownerUidSet: !!d.ownerUid,
      published: "published" in d ? d.published : null,
      legacy: !d.teamId,
      brandingSnapshot: !!d.branding,
      privateFieldsOnSeason: SEASON_PRIVATE.filter((k) => k in d),
      privateAudit: !!s.audit,
      record: d.record ?? null,
      legacyDottedRecord: "record.wins" in d || "record.losses" in d,
      gamesPlayed: d.gamesPlayed ?? null,
      scheduledGames: d.scheduledGames ?? null,
      endSeasonMode: d.endSeasonMode ?? null,
      finalAwards: Object.keys(d.finalAwards ?? {}).filter((k) => d.finalAwards[k]).sort(),
      recognitionLayouts: Object.keys(d.recognitionLayouts ?? {}).length,
      players,
      games,
      lines,
      lineups: s.lineups.size,
    });
  }
  const teams = docsUnder(state, "teams").map((t) => ({
    teamId: t.id,
    teamName: t.data.teamName ?? null,
    sport: t.data.sport ?? null,
    division: t.data.division ?? null,
    logo: t.data.logo ?? null,
    awardCollection: t.data.awardCollection ?? null,
    ownerUidSet: !!t.data.ownerUid,
    workspaceIdSet: !!t.data.workspaceId,
    currentSeasonId: t.data.currentSeasonId ?? null,
    unexpectedFields: Object.keys(t.data).filter((k) => !TEAM_KEYS.includes(k)),
  }));
  const counts = {};
  for (const [p] of state) {
    const key = p.split("/").map((x, i) => (i % 2 ? "*" : x)).join("/");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const config = state.get("app/config");
  return {
    kind: "tallies-migration-inventory",
    source,
    counts: Object.fromEntries(Object.entries(counts).sort()),
    seasons: rows,
    teams,
    publicTeams: docsUnder(state, "publicTeams").map((t) => ({ teamId: t.id, currentSeasonId: t.data.currentSeasonId ?? null })),
    legacyCurrentSeason: config ? (config.currentSeasonId ?? null) : null,
    admins: docsUnder(state, "admins").length,
    coaches: docsUnder(state, "coaches").length,
    workspaces: docsUnder(state, "coachWorkspaces").length,
    migrationLedger: state.get(LEDGER_PATH) ? { state: state.get(LEDGER_PATH).state ?? null, legacyTeamId: state.get(LEDGER_PATH).legacyTeamId ?? null } : null,
    unexpected: {
      paths: unknown,
      missingParents: state.missingParents ?? [],
      fields: unexpectedFields,
    },
    malformed,
    dangling,
  };
}

/** Console lines: counts and states only (no names, no ids of players). */
export function inventorySummary(inv) {
  const out = [];
  out.push(`Documents: ${Object.entries(inv.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const s of inv.seasons) {
    out.push(
      `  ${s.seasonId}: ${s.legacy ? "legacy (no team)" : `team ${s.teamId}`}, status ${s.status ?? "none"}, published ${s.published ?? "unset"}, ` +
        `${s.players.total} players (${s.players.privateFieldsPublic} with private fields public; ids ${JSON.stringify(s.players.idShapes)}), ` +
        `${s.games.total} games, ${s.lines} lines, ${s.lineups} lineups, awards ${s.finalAwards.length}, layouts ${s.recognitionLayouts}`,
    );
  }
  out.push(`Teams: ${inv.teams.length}; public teams: ${inv.publicTeams.length}; legacy current season: ${inv.legacyCurrentSeason ?? "none"}; admins ${inv.admins}; coaches ${inv.coaches}`);
  out.push(`Unexpected: ${inv.unexpected.paths.length} paths, ${inv.unexpected.missingParents.length} missing parents, ${inv.unexpected.fields.length} fields; malformed ${inv.malformed.length}; dangling references ${inv.dangling.length}`);
  return out;
}
