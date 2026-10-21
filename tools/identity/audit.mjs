// Read-only identity audit and migration planning (pure functions).
//
// Input is a snapshot (see snapshot.mjs):
//   { seasons: [{ seasonId, data, players: [{ id, data }],
//                 games: [{ id, data, lines: [{ id, data }] }] }] }
//
// Nothing here links players automatically. The audit *proposes* links and
// writes them as "pending"; only proposals a coach changes to "approve" are
// ever applied by migrate.mjs.

import { randomUUID, createHash } from "node:crypto";

export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const refKey = (r) => `${r.seasonId}/${r.seasonPlayerId}`;

function entriesOf(snapshot) {
  const out = [];
  for (const s of snapshot.seasons) {
    const lineCounts = new Map();
    for (const g of s.games ?? []) {
      for (const l of g.lines ?? []) {
        const pid = typeof l.data?.playerId === "string" ? l.data.playerId : l.id;
        lineCounts.set(pid, (lineCounts.get(pid) ?? 0) + 1);
      }
    }
    for (const p of s.players) {
      const d = p.data ?? {};
      out.push({
        seasonId: s.seasonId,
        seasonPlayerId: p.id,
        seasonLabel: String(s.data?.seasonLabel ?? s.seasonId),
        teamName: String(s.data?.teamName ?? "Team"),
        name: String(d.name ?? "").trim(),
        number: typeof d.number === "number" ? d.number : 0,
        careerPlayerId:
          typeof d.careerPlayerId === "string" && d.careerPlayerId.trim()
            ? d.careerPlayerId.trim()
            : null,
        identityStatus: d.identityStatus === "confirmed" ? "confirmed" : "unreviewed",
        gameLines: lineCounts.get(p.id) ?? 0,
        games: typeof d.stats?.games === "number" ? d.stats.games : 0,
      });
    }
  }
  return out;
}

function orphanLines(snapshot) {
  const out = [];
  for (const s of snapshot.seasons) {
    const roster = new Set(s.players.map((p) => p.id));
    for (const g of s.games ?? []) {
      for (const l of g.lines ?? []) {
        const pid = typeof l.data?.playerId === "string" ? l.data.playerId : l.id;
        if (!roster.has(pid)) {
          out.push({
            seasonId: s.seasonId,
            gameId: g.id,
            playerId: pid,
            name: String(l.data?.name ?? ""),
          });
        }
      }
    }
  }
  return out;
}

function proposalId(members) {
  const key = members.map(refKey).sort().join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/**
 * Builds the audit report. Proposals:
 * - "shared-career-id": entries that already share a careerPlayerId (made by
 *   the old exact-name matching). Proposed as one identity, pending review.
 * - "same-name-different-ids": entries in different seasons with the same
 *   normalized name but different ids. Possible duplicates, pending review.
 * Conflicts (different names under one id, or one id twice in a season) are
 * reported and never proposed.
 */
export function auditIdentities(snapshot, opts = {}) {
  const mintId = opts.mintId ?? randomUUID;
  const entries = entriesOf(snapshot);

  const byId = new Map();
  for (const e of entries) {
    if (!e.careerPlayerId) continue;
    if (!byId.has(e.careerPlayerId)) byId.set(e.careerPlayerId, []);
    byId.get(e.careerPlayerId).push(e);
  }

  const conflicts = [];
  const proposals = [];
  const proposed = new Set();

  for (const [careerPlayerId, group] of byId) {
    if (group.length < 2) continue;
    const names = new Set(group.map((e) => normalizeName(e.name)));
    const seasons = new Set(group.map((e) => e.seasonId));
    if (names.size > 1) {
      conflicts.push({
        kind: "different-names-share-id",
        careerPlayerId,
        members: group.map(memberOf),
      });
      continue;
    }
    if (seasons.size < group.length) {
      conflicts.push({
        kind: "same-season-duplicate-id",
        careerPlayerId,
        members: group.map(memberOf),
      });
      continue;
    }
    if (group.every((e) => e.identityStatus === "confirmed")) continue;
    const members = group.map(memberOf);
    members.forEach((m) => proposed.add(refKey(m)));
    proposals.push({
      proposalId: proposalId(members),
      basis: "shared-career-id",
      displayName: latest(group).name,
      careerPlayerId,
      members,
    });
  }

  const byName = new Map();
  for (const e of entries) {
    const n = normalizeName(e.name);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(e);
  }
  const possibleDuplicates = [];
  for (const [, group] of byName) {
    const ids = new Set(group.map((e) => e.careerPlayerId ?? `none:${refKey(memberOf(e))}`));
    if (ids.size < 2) continue;
    possibleDuplicates.push(group.map(memberOf));
    const seasons = new Set(group.map((e) => e.seasonId));
    if (seasons.size < group.length) continue; // two same-name kids in one season
    if (group.some((e) => proposed.has(refKey(memberOf(e))))) continue;
    const members = group.map(memberOf);
    const existing = group.find((e) => e.careerPlayerId)?.careerPlayerId;
    proposals.push({
      proposalId: proposalId(members),
      basis: "same-name-different-ids",
      displayName: latest(group).name,
      careerPlayerId: existing ?? mintId(),
      members,
    });
  }

  const missingCareerId = entries.filter((e) => !e.careerPlayerId).map(memberOf);
  const returningPlayers = proposals
    .filter((p) => new Set(p.members.map((m) => m.seasonId)).size >= 2)
    .map((p) => ({
      proposalId: p.proposalId,
      displayName: p.displayName,
      seasons: p.members.map((m) => `${m.teamName} ${m.seasonLabel} #${m.number}`),
    }));

  const orphans = orphanLines(snapshot);

  return {
    summary: {
      seasons: snapshot.seasons.length,
      rosterEntries: entries.length,
      confirmed: entries.filter((e) => e.identityStatus === "confirmed").length,
      unreviewed: entries.filter((e) => e.identityStatus !== "confirmed").length,
      missingCareerId: missingCareerId.length,
      proposals: proposals.length,
      conflicts: conflicts.length,
      orphanLines: orphans.length,
    },
    seasons: snapshot.seasons.map((s) => ({
      seasonId: s.seasonId,
      teamName: String(s.data?.teamName ?? ""),
      seasonLabel: String(s.data?.seasonLabel ?? ""),
      players: s.players.length,
      games: (s.games ?? []).length,
    })),
    returningPlayers,
    proposals,
    conflicts,
    possibleDuplicates,
    missingCareerId,
    orphanLines: orphans,
  };

  function memberOf(e) {
    return {
      seasonId: e.seasonId,
      seasonPlayerId: e.seasonPlayerId,
      name: e.name,
      number: e.number,
      teamName: e.teamName,
      seasonLabel: e.seasonLabel,
      careerPlayerId: e.careerPlayerId,
      identityStatus: e.identityStatus,
      gameLines: e.gameLines,
    };
  }
  function latest(group) {
    return group[group.length - 1];
  }
}

/** Approval template: every proposal starts as "pending". */
export function approvalTemplate(report, generatedAt) {
  return {
    version: 1,
    generatedAt,
    instructions:
      "Change decision to \"approve\" only for proposals you have checked are the same child. Remove members that are not. Leave everything else \"pending\" or set \"reject\".",
    approvals: report.proposals.map((p) => ({
      proposalId: p.proposalId,
      decision: "pending",
      displayName: p.displayName,
      basis: p.basis,
      careerPlayerId: p.careerPlayerId,
      members: p.members.map((m) => ({
        seasonId: m.seasonId,
        seasonPlayerId: m.seasonPlayerId,
        note: `${m.name} #${m.number} · ${m.teamName} ${m.seasonLabel} · ${m.gameLines} game lines`,
      })),
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Plans the additive writes for approved proposals. Idempotent: members
 * already confirmed under the target id produce no operation. Only touches
 * careerPlayerId, identityStatus, and migration bookkeeping fields on
 * season roster docs; never stats, games, lines, awards, or layouts.
 */
export function planMigration(snapshot, approvalsDoc) {
  const errors = [];
  const ops = [];
  const noops = [];
  const players = new Map();
  for (const s of snapshot.seasons) {
    for (const p of s.players) players.set(`${s.seasonId}/${p.id}`, p.data ?? {});
  }

  const approved = (approvalsDoc?.approvals ?? []).filter(
    (a) => a.decision === "approve",
  );
  const claimed = new Map();

  for (const a of approved) {
    if (!UUID.test(String(a.careerPlayerId ?? ""))) {
      errors.push(`${a.proposalId}: careerPlayerId must be a UUID.`);
      continue;
    }
    const members = a.members ?? [];
    if (members.length === 0) {
      errors.push(`${a.proposalId}: no members.`);
      continue;
    }
    const seasons = new Set();
    for (const m of members) {
      const key = refKey(m);
      if (!players.has(key)) {
        errors.push(`${a.proposalId}: ${key} does not exist.`);
        continue;
      }
      if (seasons.has(m.seasonId)) {
        errors.push(`${a.proposalId}: two members in season ${m.seasonId}.`);
      }
      seasons.add(m.seasonId);
      if (claimed.has(key) && claimed.get(key) !== a.proposalId) {
        errors.push(`${key} is in two approved proposals (${claimed.get(key)}, ${a.proposalId}).`);
      }
      claimed.set(key, a.proposalId);

      const data = players.get(key);
      const prev = {
        careerPlayerId: data.careerPlayerId ?? null,
        identityStatus: data.identityStatus ?? null,
      };
      if (prev.careerPlayerId === a.careerPlayerId && prev.identityStatus === "confirmed") {
        noops.push(key);
        continue;
      }
      ops.push({
        path: `seasons/${m.seasonId}/players/${m.seasonPlayerId}`,
        proposalId: a.proposalId,
        set: { careerPlayerId: a.careerPlayerId, identityStatus: "confirmed" },
        previous: prev,
      });
    }
  }

  return { ok: errors.length === 0, errors, ops, noops };
}

/** Stable digest of every roster doc's stats, for before/after checks. */
export function statsDigest(snapshot) {
  const rows = [];
  for (const s of snapshot.seasons) {
    for (const p of s.players) {
      rows.push(`${s.seasonId}/${p.id}:${JSON.stringify(sortKeys(p.data?.stats ?? {}))}`);
    }
    for (const g of s.games ?? []) {
      rows.push(`${s.seasonId}/games/${g.id}:${(g.lines ?? []).length}`);
    }
  }
  return createHash("sha256").update(rows.sort().join("\n")).digest("hex");
}

function sortKeys(o) {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}
