// Post-migration reconciliation (pure). Compares the pre-migration source
// (a verified export) with the destination, independently of the planner:
// both sides are canonicalized (private fields merged back, migration-only
// fields set aside, re-keyed roster ids mapped back) and must be equal, and
// every Tallies invariant is re-derived from the source. Any unexplained
// difference fails.

import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { computeCareerLinks } from "../../src/lib/careerLinks.ts";
import { normalizeLinkedFrom } from "../../src/lib/careerHistory.ts";
import {
  LEDGER_PATH,
  PLAYER_PRIVATE,
  PUBLIC_TEAM_KEYS,
  SEASON_PRIVATE,
  canonical,
  docsUnder,
  identityKeyed,
  seasonPlayerDocId,
  seasonView,
} from "./model.mjs";

const BRANDING_FIELDS = ["teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection"];
const MIGRATION_SEASON_FIELDS = ["ownerUid", "published", "teamId"];
const pick = (d, keys) => Object.fromEntries(keys.filter((k) => d && k in d).map((k) => [k, d[k]]));
const omit = (d, keys) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !keys.includes(k)));
const eq = (a, b) => canonical(a) === canonical(b);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function fieldDiffs(prefix, a, b, out, limit = 50) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  for (const k of keys) {
    if (out.length >= limit) return;
    if (!eq(a?.[k], b?.[k])) out.push(`${prefix}.${k} differs`);
  }
}

const canonSeason = (s) => ({ ...omit(s.data, [...MIGRATION_SEASON_FIELDS, ...SEASON_PRIVATE]), ...pick(s.data, SEASON_PRIVATE), ...pick(s.audit, SEASON_PRIVATE) });

/** Source roster id → destination id (identity-keyed entries are re-keyed). */
export function rosterIdMap(sourceSeasons) {
  const map = new Map();
  for (const s of sourceSeasons.values()) {
    const m = new Map();
    for (const p of s.players.values()) {
      if (!p.data) continue;
      const cid = { ...pick(p.data, PLAYER_PRIVATE), ...pick(p.profile, PLAYER_PRIVATE) }.careerPlayerId;
      m.set(p.id, identityKeyed(p.id, cid) ? seasonPlayerDocId(String(cid).trim(), s.id) : p.id);
    }
    map.set(s.id, m);
  }
  return map;
}

function canonPlayer(p, back) {
  const pub = omit(p.data, ["careerLinks"]);
  if (back && "id" in pub && back.has(pub.id)) pub.id = back.get(pub.id);
  return { ...omit(pub, PLAYER_PRIVATE), ...pick(p.data, PLAYER_PRIVATE), ...pick(p.profile, PLAYER_PRIVATE) };
}

function lineTotals(s) {
  const out = new Map();
  for (const g of s.games.values()) {
    for (const [lid, l] of g.lines) {
      const t = out.get(lid) ?? {};
      for (const [k, v] of Object.entries(l?.delta ?? {})) if (isNum(v)) t[k] = (t[k] ?? 0) + v;
      out.set(lid, t);
    }
  }
  return out;
}

function careerEntries(seasons, idOf = (sid, pid) => pid) {
  const entries = [];
  for (const s of seasons.values()) {
    if (!s.data || s.data.status === "deleting") continue;
    for (const p of s.players.values()) {
      if (!p.data) continue;
      const eff = { ...pick(p.data, PLAYER_PRIVATE), ...pick(p.profile, PLAYER_PRIVATE) };
      entries.push({
        seasonId: s.id,
        seasonPlayerId: idOf(s.id, p.id),
        careerPlayerId: typeof eff.careerPlayerId === "string" ? eff.careerPlayerId : undefined,
        confirmed: eff.identityStatus === "confirmed",
        linkedFrom: normalizeLinkedFrom(eff.linkedFrom).map((r) => ({ seasonId: r.seasonId, seasonPlayerId: idOf(r.seasonId, r.seasonPlayerId) })),
      });
    }
  }
  return entries;
}

/**
 * opts: { ownerUid, legacyTeamId? } — both default to the destination's
 * migration ledger; a mismatch with the ledger fails.
 */
export function verifyMigration(sourceState, destState, opts = {}) {
  const checks = [];
  const check = (id, title, fn) => {
    const mismatches = [];
    let details;
    try {
      details = fn(mismatches);
    } catch (e) {
      mismatches.push(`check crashed: ${e instanceof Error ? e.message : e}`);
    }
    checks.push({ id, title, ok: mismatches.length === 0, mismatches: mismatches.slice(0, 200), mismatchCount: mismatches.length, details: details ?? null });
  };

  const ledger = destState.get(LEDGER_PATH) ?? null;
  const ownerUid = str(opts.ownerUid) || str(ledger?.ownerUid);
  const legacyTeamId = str(opts.legacyTeamId) || str(ledger?.legacyTeamId);
  const src = seasonView(sourceState).seasons;
  const dst = seasonView(destState).seasons;
  const idMap = rosterIdMap(src);
  const backMap = new Map([...idMap].map(([sid, m]) => [sid, new Map([...m].filter(([a, b]) => a !== b).map(([a, b]) => [b, a]))]));
  const mapId = (sid, pid) => idMap.get(sid)?.get(pid) ?? pid;
  const legacyIds = new Set([...src.values()].filter((s) => s.data && !str(s.data.teamId)).map((s) => s.id));
  const expectedTeam = (s) => (legacyIds.has(s.id) ? legacyTeamId : str(s.data?.teamId));
  const coach = destState.get(`coaches/${ownerUid}`);
  const workspaceId = str(coach?.workspaceId);

  check("context", "Owner and legacy team are identified", (m) => {
    if (!ownerUid) m.push("owner uid unknown (no ledger and no --owner-uid)");
    if (opts.ownerUid && ledger?.ownerUid && opts.ownerUid !== ledger.ownerUid) m.push("owner uid differs from the migration ledger");
    if (opts.legacyTeamId && ledger?.legacyTeamId && opts.legacyTeamId !== ledger.legacyTeamId) m.push("legacy team differs from the migration ledger");
    if (legacyIds.size && !legacyTeamId) m.push("legacy team id unknown");
    if (!sourceState.get("admins/" + ownerUid)) m.push("owner is not the source's legacy admin");
    if (!workspaceId) m.push("owner has no coach record/workspace in the destination");
    return { ownerUidSet: !!ownerUid, legacyTeamId, legacySeasons: [...legacyIds].sort(), ledgerState: ledger?.state ?? null };
  });

  check("seasons", "Season ids and season documents (canonical)", (m) => {
    const a = [...src.keys()].sort();
    const b = [...dst.keys()].sort();
    if (!eq(a, b)) m.push(`season ids differ: source ${a.join(",")} / destination ${b.join(",")}`);
    for (const s of src.values()) {
      const d = dst.get(s.id);
      if (!s.data || !d?.data) {
        if (!!s.data !== !!d?.data) m.push(`seasons/${s.id} presence differs`);
        continue;
      }
      fieldDiffs(`seasons/${s.id}`, canonSeason(s), canonSeason(d), m);
    }
    return { seasons: a.length };
  });

  check("season-states", "Season states (status, lifecycle timestamps, end-of-season)", (m) => {
    const states = {};
    for (const s of src.values()) {
      const d = dst.get(s.id);
      const keys = ["status", "finalizedAt", "reopenedAt", "activatedAt", "endSeasonMode"];
      if (!eq(pick(s.data, keys), pick(d?.data, keys))) m.push(`seasons/${s.id} state differs`);
      states[s.id] = d?.data?.status ?? "legacy (no status)";
    }
    return states;
  });

  check("rosters", "Players and roster associations (identity in private records)", (m) => {
    let n = 0;
    for (const s of src.values()) {
      const d = dst.get(s.id);
      const ids = idMap.get(s.id);
      const want = [...ids.values()].sort();
      const have = [...(d?.players.values() ?? [])].filter((p) => p.data).map((p) => p.id).sort();
      if (!eq(want, have)) m.push(`seasons/${s.id}/players: ids differ (expected ${want.length}, found ${have.length})`);
      for (const p of s.players.values()) {
        if (!p.data) continue;
        const q = d?.players.get(ids.get(p.id));
        if (!q?.data) continue;
        n++;
        fieldDiffs(`seasons/${s.id}/players/${p.id}`, canonPlayer(p), canonPlayer(q, backMap.get(s.id)), m);
      }
    }
    return { entries: n, rekeyed: [...idMap.values()].reduce((c, mm) => c + [...mm].filter(([a, b]) => a !== b).length, 0) };
  });

  check("games", "Games and results", (m) => {
    let n = 0;
    for (const s of src.values()) {
      const d = dst.get(s.id);
      const a = [...s.games.keys()].sort();
      const b = [...(d?.games.keys() ?? [])].sort();
      if (!eq(a, b)) m.push(`seasons/${s.id}/games: ids differ`);
      const tally = (ss) => [...(ss?.games.values() ?? [])].reduce((t, g) => ((t[g.data?.result ?? "?"] = (t[g.data?.result ?? "?"] ?? 0) + 1), t), {});
      if (!eq(tally(s), tally(d))) m.push(`seasons/${s.id}: W/L/T from games differ`);
      for (const g of s.games.values()) {
        n++;
        if (!eq(g.data, d?.games.get(g.id)?.data)) m.push(`seasons/${s.id}/games/${g.id} differs`);
      }
    }
    return { games: n };
  });

  check("stats", "Game lines, player stats, and derived totals", (m) => {
    let lines = 0;
    for (const s of src.values()) {
      const d = dst.get(s.id);
      for (const g of s.games.values()) {
        const dg = d?.games.get(g.id);
        const a = [...g.lines.keys()].sort();
        const b = [...(dg?.lines.keys() ?? [])].sort();
        if (!eq(a, b)) m.push(`seasons/${s.id}/games/${g.id}/lines: ids differ`);
        for (const [lid, l] of g.lines) {
          lines++;
          if (!eq(l, dg?.lines.get(lid))) m.push(`seasons/${s.id}/games/${g.id}/lines/${lid} differs`);
        }
      }
      for (const p of s.players.values()) {
        const q = d?.players.get(mapId(s.id, p.id));
        if (p.data && !eq(p.data.stats, q?.data?.stats)) m.push(`seasons/${s.id}/players/${p.id}: stats differ`);
      }
      if (!eq(lineTotals(s), lineTotals(d ?? { games: new Map() }))) m.push(`seasons/${s.id}: per-player totals from game lines differ`);
      if (!eq(s.data?.record, d?.data?.record)) m.push(`seasons/${s.id}: record differs`);
    }
    return { lines };
  });

  check("lineups", "Lineups and lineup snapshots", (m) => {
    let n = 0;
    for (const s of src.values()) {
      const d = dst.get(s.id);
      if (!eq([...s.lineups.keys()].sort(), [...(d?.lineups.keys() ?? [])].sort())) m.push(`seasons/${s.id}/lineups: ids differ`);
      for (const [lid, l] of s.lineups) {
        n++;
        if (!eq(l, d?.lineups.get(lid))) m.push(`seasons/${s.id}/lineups/${lid} differs`);
      }
      for (const g of s.games.values()) if (!eq(g.data?.lineupSnapshot, d?.games.get(g.id)?.data?.lineupSnapshot)) m.push(`seasons/${s.id}/games/${g.id}: lineup snapshot differs`);
    }
    return { lineups: n };
  });

  check("awards", "Awards and recognition (final awards, coach awards, game balls, layouts)", (m) => {
    for (const s of src.values()) {
      const d = dst.get(s.id);
      for (const k of ["finalAwards", "recognitionLayouts"]) if (!eq(s.data?.[k], d?.data?.[k])) m.push(`seasons/${s.id}.${k} differs`);
      for (const g of s.games.values()) {
        const dg = d?.games.get(g.id)?.data;
        for (const k of ["coachAwards", "gameBall"]) if (!eq(g.data?.[k], dg?.[k])) m.push(`seasons/${s.id}/games/${g.id}.${k} differs`);
      }
      // Every award reference resolves exactly as it did before.
      const resolves = (ss, id) => !!ss?.players.get(id)?.data;
      const refs = [...Object.values(s.data?.finalAwards ?? {}), ...Object.keys(s.data?.recognitionLayouts ?? {})].filter((v) => typeof v === "string" && v);
      for (const id of refs) if (resolves(s, id) !== resolves(d, id)) m.push(`seasons/${s.id}: award reference ${id} resolves differently`);
    }
  });

  // Destination effective identities and published set.
  const published = new Set([...dst.values()].filter((s) => s.data?.published === true && s.data?.status !== "deleting").map((s) => s.id));

  check("career-links", "Career references (public links follow private identity, published only)", (m) => {
    const dEntries = careerEntries(dst);
    const fromDest = computeCareerLinks(dEntries, published);
    const fromSource = computeCareerLinks(careerEntries(src, mapId), published);
    let links = 0;
    for (const s of dst.values()) {
      for (const p of s.players.values()) {
        if (!p.data) continue;
        const key = `${s.id}/${p.id}`;
        const have = Array.isArray(p.data.careerLinks) ? p.data.careerLinks : [];
        links += have.length;
        if (!eq(have, fromDest.get(key) ?? [])) m.push(`${key}: careerLinks differ from the private identity`);
        if (!eq(have, fromSource.get(key) ?? [])) m.push(`${key}: careerLinks differ from the source career view`);
        for (const r of have) {
          if (!published.has(r?.seasonId)) m.push(`${key}: links to unpublished season ${r?.seasonId}`);
          else if (!dst.get(r.seasonId)?.players.get(r.seasonPlayerId)?.data) m.push(`${key}: links to a missing entry`);
        }
      }
    }
    return { links };
  });

  check("team-branding", "Team identity and branding", (m) => {
    const out = {};
    if (legacyTeamId) {
      const t = destState.get(`teams/${legacyTeamId}`);
      if (!t) m.push(`teams/${legacyTeamId} missing`);
      else if (!sourceState.get(`teams/${legacyTeamId}`)) {
        const names = [...new Set([...legacyIds].map((id) => str(src.get(id)?.data?.teamName)).filter(Boolean))];
        const want = { ...LEGACY_TIGERS_BRANDING, teamName: names[0] ?? LEGACY_TIGERS_BRANDING.teamName };
        for (const k of BRANDING_FIELDS) if (!eq(t[k], want[k])) m.push(`teams/${legacyTeamId}.${k} is not the legacy branding`);
      }
      out.legacyTeam = t ? pick(t, ["teamName", "sport", "division", "logo", "awardCollection"]) : null;
      out.legacyPrimary = t?.palettes ? { dark: t.palettes.dark?.primary, light: t.palettes.light?.primary } : null;
    }
    for (const t of docsUnder(sourceState, "teams")) {
      const d = destState.get(`teams/${t.id}`);
      for (const k of [...BRANDING_FIELDS, "teamId", "createdAt", "updatedAt"]) if (!eq(t.data[k], d?.[k])) m.push(`teams/${t.id}.${k} changed`);
    }
    for (const s of dst.values()) {
      if (s.data?.branding && s.data.branding.teamId !== s.data.teamId) m.push(`seasons/${s.id}: branding snapshot names another team`);
      if (legacyIds.has(s.id) && s.data?.branding) m.push(`seasons/${s.id}: legacy season gained a branding snapshot`);
    }
    return out;
  });

  check("ownership", "Ownership and team associations", (m) => {
    const teamIds = new Set(docsUnder(destState, "teams").map((t) => t.id));
    for (const s of src.values()) {
      const d = dst.get(s.id)?.data;
      if (!d) continue;
      if (d.ownerUid !== ownerUid) m.push(`seasons/${s.id}: ownerUid is not the owner`);
      if (d.teamId !== expectedTeam(s)) m.push(`seasons/${s.id}: teamId is not ${expectedTeam(s)}`);
      if (!teamIds.has(d.teamId)) m.push(`seasons/${s.id}: team ${d.teamId} missing`);
    }
    for (const id of teamIds) {
      const t = destState.get(`teams/${id}`);
      if (t.ownerUid !== ownerUid) m.push(`teams/${id}: ownerUid is not the owner`);
      if (t.workspaceId !== workspaceId) m.push(`teams/${id}: workspaceId is not the owner's workspace`);
      if (t.teamId !== id) m.push(`teams/${id}: teamId field differs`);
    }
    return { teams: teamIds.size };
  });

  check("publication", "Publication flags", (m) => {
    const out = {};
    for (const s of src.values()) {
      const d = dst.get(s.id)?.data;
      if (!s.data || !d) continue;
      const st = s.data.status;
      const want = typeof s.data.published === "boolean" ? s.data.published : legacyIds.has(s.id) && !["draft", "deleting"].includes(st);
      if (d.published !== want) m.push(`seasons/${s.id}: published ${d.published}, expected ${want}`);
      if (d.published === true && ["draft", "deleting"].includes(d.status)) m.push(`seasons/${s.id}: a draft is published`);
      out[s.id] = d.published;
    }
    return out;
  });

  check("current-season", "Current-season selection (legacy setting untouched)", (m) => {
    if (!eq(sourceState.get("app/config"), destState.get("app/config"))) m.push("app/config changed");
    const legacyCurrent = str(sourceState.get("app/config")?.currentSeasonId);
    const out = {};
    for (const t of docsUnder(destState, "teams")) {
      const cur = t.data.currentSeasonId ?? null;
      out[t.id] = cur;
      const before = str(sourceState.get(`teams/${t.id}`)?.currentSeasonId);
      if (before && cur !== before) m.push(`teams/${t.id}: currentSeasonId changed`);
      if (cur) {
        const s = dst.get(cur)?.data;
        if (!s || s.teamId !== t.id) m.push(`teams/${t.id}: current season is not its own`);
        if (["draft", "finalized", "deleting"].includes(s?.status)) m.push(`teams/${t.id}: current season is ${s.status}`);
      }
    }
    if (legacyTeamId && legacyIds.has(legacyCurrent)) {
      const st = src.get(legacyCurrent)?.data?.status;
      const want = ["draft", "finalized", "deleting"].includes(st) ? null : legacyCurrent;
      if ((out[legacyTeamId] ?? null) !== want) m.push(`teams/${legacyTeamId}: current season ${out[legacyTeamId]}, expected ${want}`);
    }
    return out;
  });

  check("public-projection", "Public team summaries", (m) => {
    for (const t of docsUnder(destState, "teams")) {
      const p = destState.get(`publicTeams/${t.id}`);
      if (!p) {
        m.push(`publicTeams/${t.id} missing`);
        continue;
      }
      const extra = Object.keys(p).filter((k) => !PUBLIC_TEAM_KEYS.includes(k));
      if (extra.length) m.push(`publicTeams/${t.id}: non-public fields ${extra.join(",")}`);
      for (const k of BRANDING_FIELDS) if (!eq(p[k] ?? null, t.data[k] ?? null)) m.push(`publicTeams/${t.id}.${k} differs from the team`);
      const cur = t.data.currentSeasonId;
      const want = cur && published.has(cur) && dst.get(cur)?.data?.teamId === t.id ? cur : null;
      if ((p.currentSeasonId ?? null) !== want) m.push(`publicTeams/${t.id}: currentSeasonId ${p.currentSeasonId ?? null}, expected ${want}`);
    }
    for (const p of docsUnder(destState, "publicTeams")) if (!destState.get(`teams/${p.id}`)) m.push(`publicTeams/${p.id}: no team`);
  });

  check("privacy", "Public/private separation", (m) => {
    let profiles = 0;
    for (const s of dst.values()) {
      if (s.data) for (const k of SEASON_PRIVATE) if (k in s.data) m.push(`seasons/${s.id}: private field ${k} is public`);
      for (const p of s.players.values()) {
        if (p.profile) profiles++;
        if (!p.data) {
          m.push(`seasons/${s.id}/players/${p.id}: private profile without entry`);
          continue;
        }
        for (const k of PLAYER_PRIVATE) if (k in p.data) m.push(`seasons/${s.id}/players/${p.id}: private field ${k} is public`);
        const cid = p.profile?.careerPlayerId;
        if (identityKeyed(p.id, cid)) m.push(`seasons/${s.id}/players/${p.id}: public id embeds the permanent identity`);
        for (const v of Object.values(omit(p.data, ["careerLinks"]))) if (typeof cid === "string" && cid && canonical(v).includes(cid)) m.push(`seasons/${s.id}/players/${p.id}: public field holds the permanent identity`);
      }
    }
    return { privateProfiles: profiles };
  });

  check("routing", "Historical routing (legacy links resolve to team routes)", (m) => {
    let routes = 0;
    for (const s of src.values()) {
      const d = dst.get(s.id)?.data;
      if (!d?.published) continue;
      const pt = destState.get(`publicTeams/${d.teamId}`);
      if (!pt) m.push(`/teams/${d.teamId}/: no public team for published ${s.id}`);
      for (const p of s.players.values()) {
        if (!p.data) continue;
        routes++;
        if (!dst.get(s.id)?.players.get(mapId(s.id, p.id))?.data) m.push(`/player/?id=${p.id}&season=${s.id}: no destination entry`);
      }
    }
    return { playerRoutes: routes };
  });

  check("unchanged-documents", "Everything else unchanged; no unexplained documents", (m) => {
    const allowedNew = (p) =>
      p === LEDGER_PATH ||
      /^migrationRuns\//.test(p) ||
      /^publicTeams\/[^/]+$/.test(p) ||
      p === `teams/${legacyTeamId}` ||
      /^seasons\/[^/]+\/private\/audit$/.test(p) ||
      /^seasons\/[^/]+\/players\/[^/]+(\/private\/profile)?$/.test(p);
    const handled = (p) => /^(seasons|teams|publicTeams)\//.test(p);
    for (const [p, d] of sourceState) {
      if (handled(p)) continue;
      if (!eq(d, destState.get(p))) m.push(`${p} changed or missing`);
    }
    for (const [p] of destState) {
      if (sourceState.has(p) || allowedNew(p)) continue;
      m.push(`${p}: unexplained new document`);
    }
    for (const [p] of sourceState) {
      if (!handled(p) || destState.has(p)) continue;
      const s = p.split("/");
      const rekeyed = s[0] === "seasons" && s[2] === "players" && mapId(s[1], s[3]) !== s[3];
      if (!rekeyed) m.push(`${p}: missing from destination`);
    }
  });

  const counts = (state) => {
    const c = {};
    for (const [p] of state) {
      const k = p.split("/").map((x, i) => (i % 2 ? "*" : x)).join("/");
      c[k] = (c[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(c).sort());
  };
  return {
    kind: "tallies-migration-verification",
    ok: checks.every((c) => c.ok),
    checks,
    counts: { source: counts(sourceState), destination: counts(destState) },
  };
}

export function verificationSummary(report) {
  const out = [`Verification ${report.ok ? "PASSED" : "FAILED"} (${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks)`];
  for (const c of report.checks) out.push(`  ${c.ok ? "PASS" : "FAIL"} ${c.id}: ${c.title}${c.ok ? "" : ` — ${c.mismatchCount} mismatch(es), e.g. ${c.mismatches[0]}`}`);
  return out;
}
