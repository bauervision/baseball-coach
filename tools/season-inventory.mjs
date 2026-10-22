// Compact season inventory from an export (no Firestore access, no names).
//
//   node tools/season-inventory.mjs --from-json <export.json>
import fs from "node:fs";
import { arg } from "./identity/firestore.mjs";

try {
  const file = arg("--from-json");
  if (!file) throw new Error("Pass --from-json <export.json>.");
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));

  console.log(`Source: ${snap.projectId ?? "?"} (${snap.source ?? "?"}) exported ${snap.exportedAt}`);
  console.log(`app/config.currentSeasonId: ${snap.config?.currentSeasonId ?? "(missing)"}`);
  console.log(`Root collections: ${Object.keys(snap.raw ?? {}).join(", ") || "(none)"}`);

  const rows = snap.seasons.map((s) => {
    const d = s.data ?? {};
    const lines = s.games.reduce((n, g) => n + g.lines.length, 0);
    const players = s.players.length;
    const withId = s.players.filter((p) => typeof p.data?.careerPlayerId === "string").length;
    const confirmed = s.players.filter((p) => p.data?.identityStatus === "confirmed").length;
    const rec = d.record ?? {};
    return {
      season: s.seasonId,
      doc: s.parentMissing ? "MISSING" : "ok",
      label: d.seasonLabel ?? "",
      team: d.teamName ?? "",
      league: d.league ?? "",
      record: `${rec.wins ?? "-"}-${rec.losses ?? "-"}-${rec.ties ?? 0}`,
      gp_field: d.gamesPlayed ?? "",
      sched: d.scheduledGames ?? "",
      games: s.games.filter((g) => !g.parentMissing).length,
      orphanGames: s.games.filter((g) => g.parentMissing).length,
      lines,
      players,
      ids: `${withId}/${players}`,
      confirmed,
      coachUids: Array.isArray(d.coachUids) ? d.coachUids.length : "none",
      ended: d.endSeasonMode === true,
      finalAwards: Object.values(d.finalAwards ?? {}).filter(Boolean).length,
      layouts: Object.keys(d.recognitionLayouts ?? {}).length,
      lineups: s.lineups.length,
      other: (s.otherSubcollections ?? []).join(",") || "",
      created: d.createdAt?.__timestamp?.slice(0, 10) ?? "",
    };
  });
  console.table(rows);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
