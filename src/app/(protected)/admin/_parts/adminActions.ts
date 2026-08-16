"use client";

// Add orderBy to the firestore import
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

import type { Player } from "@/lib/roster";
import type {
  GameResult,
  LineState,
  DraftPlayer,
  CoachPicks,
  CoachPickKey,
} from "../adminHelpers";
import {
  num,
  parseOptionalInt,
  playerDocIdFromDraft,
  EMPTY_STATS,
} from "../adminHelpers";

const COACH_PICK_STAT_FIELD: Record<CoachPickKey, string> = {
  charlieHustle: "stats.charlieHustleAwards",
  mostImproved: "stats.mostImprovedAwards",
  bestPitcher: "stats.bestPitcherAwards",
  bestCatcher: "stats.bestCatcherAwards",
  bestFirstBaseman: "stats.bestFirstBasemanAwards",
  bestSecondBaseman: "stats.bestSecondBasemanAwards",
  bestThirdBaseman: "stats.bestThirdBasemanAwards",
  bestShortstop: "stats.bestShortstopAwards",
  bestLeftFielder: "stats.bestLeftFielderAwards",
  bestCenterFielder: "stats.bestCenterFielderAwards",
  bestRightFielder: "stats.bestRightFielderAwards",
};

export async function checkAllowlist(opts: {
  db: Firestore;
  uid: string;
}): Promise<boolean> {
  const { db, uid } = opts;
  const adminRef = doc(db, "admins", uid);
  const snap = await getDoc(adminRef);
  return snap.exists();
}

export async function switchSeason(opts: {
  db: Firestore;
  nextSeasonId: string;
  teamName: string;
  seasonLabel: string;
  fallbackTeamName: string;
}): Promise<void> {
  const { db, nextSeasonId, teamName, seasonLabel, fallbackTeamName } = opts;

  const nextId = nextSeasonId.trim();
  if (!nextId) throw new Error("Season id is required.");

  const seasonRef = doc(db, "seasons", nextId);
  const cfgRef = doc(db, "app", "config");
  const batch = writeBatch(db);

  batch.set(
    seasonRef,
    {
      teamName: teamName.trim() || fallbackTeamName || "Team",
      seasonLabel: seasonLabel.trim() || "Season",
      record: { wins: 0, losses: 0, ties: 0 },
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    cfgRef,
    { currentSeasonId: nextId, updatedAt: serverTimestamp() },
    { merge: true },
  );

  await batch.commit();
}

export async function savePlayerEdits(opts: {
  db: Firestore;
  seasonId: string;
  players: Player[];
  edits: Record<
    string,
    {
      name: string;
      number: string;
      shirtSize: string;
      leaderboardHidden: boolean;
      dirty: boolean;
    }
  >;
}): Promise<{ wrote: number }> {
  const { db, seasonId, players, edits } = opts;

  if (players.length === 0) throw new Error("No players in roster.");

  const batch = writeBatch(db);
  let wrote = 0;

  for (const p of players) {
    const edit = edits[p.id];
    if (!edit || !edit.dirty) continue;

    const name = edit.name.trim();
    if (!name) throw new Error("Player name cannot be empty.");

    const n = parseOptionalInt(edit.number);
    const shirtSize = edit.shirtSize.trim();
    const playerRef = doc(db, "seasons", seasonId, "players", p.id);

    batch.set(
      playerRef,
      {
        name,
        number: n,
        shirtSize: shirtSize ? shirtSize : null,
        leaderboardHidden: edit.leaderboardHidden === true,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    wrote++;
  }

  if (wrote === 0) throw new Error("No changes to save.");

  await batch.commit();
  return { wrote };
}

export async function rebuildRoster(opts: {
  db: Firestore;
  seasonId: string;
  draft: DraftPlayer[];
}): Promise<{ playerCount: number }> {
  const { db, seasonId, draft } = opts;

  const cleaned = draft
    .map((d) => ({
      ...d,
      name: d.name.trim(),
      number: d.number.trim(),
      primaryPos: d.primaryPos.trim(),
    }))
    .filter((d) => d.name.length > 0);

  if (cleaned.length === 0) throw new Error("Add at least one player name.");

  const playersCol = collection(db, "seasons", seasonId, "players");
  const snap = await getDocs(query(playersCol));

  const batch = writeBatch(db);

  snap.forEach((docSnap) => batch.delete(docSnap.ref));

  for (let i = 0; i < cleaned.length; i++) {
    const d = cleaned[i];
    const id = playerDocIdFromDraft(d, i);

    const player: Player = {
      id,
      name: d.name,
      number: parseOptionalInt(d.number),
      stats: { ...EMPTY_STATS },
    };

    if (d.primaryPos) player.primaryPos = d.primaryPos;

    const pref = doc(db, "seasons", seasonId, "players", id);

    batch.set(
      pref,
      { ...player, updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
      { merge: false },
    );
  }

  const seasonRef = doc(db, "seasons", seasonId);
  batch.set(
    seasonRef,
    { updatedAt: serverTimestamp(), record: { wins: 0, losses: 0, ties: 0 } },
    { merge: true },
  );

  await batch.commit();
  return { playerCount: cleaned.length };
}

export async function saveGameAndApplyDeltas(opts: {
  db: Firestore;
  seasonId: string;
  date: string;
  opponent: string;
  result: GameResult;
  scoreUs: string;
  scoreThem: string;
  players: Player[];
  lines: Record<string, LineState>;
  coachPicks: CoachPicks;
  gameId?: string | null;
}): Promise<{ wroteLines: number; opponent: string; gameId: string }> {
  const {
    db,
    seasonId,
    date,
    opponent,
    result,
    scoreUs,
    scoreThem,
    players,
    lines,
    coachPicks,
    gameId,
  } = opts;

  const opp = opponent.trim();
  if (!opp) throw new Error("Opponent is required.");

  const slug = opp
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const gid = gameId?.trim()
    ? gameId.trim()
    : `${date.replaceAll("-", "")}-${slug}-${Date.now()}`;

  const seasonRef = doc(db, "seasons", seasonId);
  const gameRef = doc(db, "seasons", seasonId, "games", gid);

  const batch = writeBatch(db);

  const selectedCoachAwards: Record<
    string,
    { playerId: string; playerName: string; playerNumber: number }
  > = {};

  for (const [key, playerId] of Object.entries(coachPicks) as Array<
    [CoachPickKey, string]
  >) {
    if (!playerId) continue;

    const player = players.find((p) => p.id === playerId);
    if (!player) continue;

    selectedCoachAwards[key] = {
      playerId: player.id,
      playerName: player.name,
      playerNumber: player.number,
    };
  }

  let wroteLines = 0;
  let coachPickCount = 0;

  for (const value of Object.values(coachPicks)) {
    if (value) coachPickCount++;
  }

  if (players.length === 0) {
    throw new Error("No players in roster.");
  }

  const lineDocsToWrite: Array<{
    playerId: string;
    name: string;
    number: number;
    delta: LineState["delta"];
  }> = [];

  for (const p of players) {
    const line = lines[p.id];
    const delta = line?.delta;
    const hidden = line?.hidden === true;

    const hasLineStats =
      !hidden &&
      !!delta &&
      Object.values(delta).some((v) => typeof v === "number" && v !== 0);

    if (hasLineStats && delta) {
      wroteLines++;
      lineDocsToWrite.push({
        playerId: p.id,
        name: p.name,
        number: p.number,
        delta,
      });
    }
  }

  if (wroteLines === 0 && coachPickCount === 0) {
    throw new Error("No player stats or coach picks were entered.");
  }

  const existingLinesSnap = await getDocs(
    collection(db, "seasons", seasonId, "games", gid, "lines"),
  );

  existingLinesSnap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });

  batch.set(
    gameRef,
    {
      date,
      opponent: opp,
      result,
      score: { us: num(scoreUs), them: num(scoreThem) },
      coachAwards: selectedCoachAwards,
      updatedAt: serverTimestamp(),
      ...(gameId ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );

  for (const line of lineDocsToWrite) {
    const lineRef = doc(
      db,
      "seasons",
      seasonId,
      "games",
      gid,
      "lines",
      line.playerId,
    );

    batch.set(
      lineRef,
      {
        playerId: line.playerId,
        name: line.name,
        number: line.number,
        delta: line.delta,
      },
      { merge: false },
    );
  }

  await batch.commit();

  const gamesSnap = await getDocs(
    query(collection(db, "seasons", seasonId, "games"), orderBy("date", "asc")),
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;

  type StatTotals = typeof EMPTY_STATS;
  const totalsByPlayer = new Map<string, StatTotals>();

  function ensureTotals(playerId: string): StatTotals {
    const existing = totalsByPlayer.get(playerId);
    if (existing) return existing;

    const next: StatTotals = { ...EMPTY_STATS };
    totalsByPlayer.set(playerId, next);
    return next;
  }

  for (const gameDoc of gamesSnap.docs) {
    const gameData = gameDoc.data() as {
      result?: unknown;
      coachAwards?: Record<
        string,
        { playerId?: unknown; playerName?: unknown; playerNumber?: unknown }
      >;
    };

    const gameResult =
      typeof gameData.result === "string"
        ? gameData.result.trim().toUpperCase()
        : "";

    if (gameResult === "W") wins += 1;
    else if (gameResult === "L") losses += 1;
    else if (gameResult === "T") ties += 1;

    const coachAwards = gameData.coachAwards;
    if (coachAwards && typeof coachAwards === "object") {
      for (const [key, award] of Object.entries(coachAwards)) {
        const playerId =
          award && typeof award.playerId === "string" ? award.playerId : "";

        if (!playerId) continue;
        if (!(key in COACH_PICK_STAT_FIELD)) continue;

        const statField = COACH_PICK_STAT_FIELD[key as CoachPickKey];
        const statKey = statField.replace(/^stats\./, "") as keyof StatTotals;

        const totals = ensureTotals(playerId);
        totals[statKey] += 1;
      }
    }

    const linesSnap = await getDocs(
      collection(db, "seasons", seasonId, "games", gameDoc.id, "lines"),
    );

    linesSnap.forEach((lineDoc) => {
      const lineData = lineDoc.data() as {
        playerId?: unknown;
        delta?: Partial<Record<keyof LineState["delta"], unknown>>;
      };

      const playerId =
        typeof lineData.playerId === "string" ? lineData.playerId : "";
      if (!playerId) return;

      const delta = lineData.delta;
      if (!delta || typeof delta !== "object") return;

      const totals = ensureTotals(playerId);

      const atBats =
        typeof delta.atBats === "number" && Number.isFinite(delta.atBats)
          ? Math.floor(delta.atBats)
          : 0;
      const hits =
        typeof delta.hits === "number" && Number.isFinite(delta.hits)
          ? Math.floor(delta.hits)
          : 0;
      const doubles =
        typeof delta.doubles === "number" && Number.isFinite(delta.doubles)
          ? Math.floor(delta.doubles)
          : 0;
      const triples =
        typeof delta.triples === "number" && Number.isFinite(delta.triples)
          ? Math.floor(delta.triples)
          : 0;
      const homeRuns =
        typeof delta.homeRuns === "number" && Number.isFinite(delta.homeRuns)
          ? Math.floor(delta.homeRuns)
          : 0;
      const runs =
        typeof delta.runs === "number" && Number.isFinite(delta.runs)
          ? Math.floor(delta.runs)
          : 0;
      const rbi =
        typeof delta.rbi === "number" && Number.isFinite(delta.rbi)
          ? Math.floor(delta.rbi)
          : 0;
      const walks =
        typeof delta.walks === "number" && Number.isFinite(delta.walks)
          ? Math.floor(delta.walks)
          : 0;
      const hitByPitch =
        typeof delta.hitByPitch === "number" &&
        Number.isFinite(delta.hitByPitch)
          ? Math.floor(delta.hitByPitch)
          : 0;
      const stolenBases =
        typeof delta.stolenBases === "number" &&
        Number.isFinite(delta.stolenBases)
          ? Math.floor(delta.stolenBases)
          : 0;
      const putOuts =
        typeof delta.putOuts === "number" && Number.isFinite(delta.putOuts)
          ? Math.floor(delta.putOuts)
          : 0;
      const assists =
        typeof delta.assists === "number" && Number.isFinite(delta.assists)
          ? Math.floor(delta.assists)
          : 0;
      const pitchingStrikeouts =
        typeof delta.pitchingStrikeouts === "number" &&
        Number.isFinite(delta.pitchingStrikeouts)
          ? Math.floor(delta.pitchingStrikeouts)
          : 0;
      const pitchingSaves =
        typeof delta.pitchingSaves === "number" &&
        Number.isFinite(delta.pitchingSaves)
          ? Math.floor(delta.pitchingSaves)
          : 0;
      const flyBallCatches =
        typeof delta.flyBallCatches === "number" &&
        Number.isFinite(delta.flyBallCatches)
          ? Math.floor(delta.flyBallCatches)
          : 0;

      const hasAnyStat =
        atBats !== 0 ||
        hits !== 0 ||
        doubles !== 0 ||
        triples !== 0 ||
        homeRuns !== 0 ||
        runs !== 0 ||
        rbi !== 0 ||
        walks !== 0 ||
        hitByPitch !== 0 ||
        stolenBases !== 0 ||
        putOuts !== 0 ||
        assists !== 0 ||
        pitchingStrikeouts !== 0 ||
        pitchingSaves !== 0 ||
        flyBallCatches !== 0;

      if (hasAnyStat) {
        totals.games += 1;
      }

      const hadHit = hits > 0;

      if (hasAnyStat) {
        if (hadHit) {
          totals.currentHitStreak += 1;
          totals.longestHitStreak = Math.max(
            totals.longestHitStreak,
            totals.currentHitStreak,
          );
        } else {
          totals.currentHitStreak = 0;
        }
      }

      totals.atBats += atBats;
      totals.hits += hits;
      totals.doubles += doubles;
      totals.triples += triples;
      totals.homeRuns += homeRuns;
      totals.runs += runs;
      totals.rbi += rbi;
      totals.walks += walks;
      totals.hitByPitch += hitByPitch;
      totals.stolenBases += stolenBases;
      totals.putOuts += putOuts;
      totals.assists += assists;
      totals.pitchingStrikeouts += pitchingStrikeouts;
      totals.pitchingSaves += pitchingSaves;
      totals.flyBallCatches += flyBallCatches;
      totals.plateAppearances += atBats + walks + hitByPitch;
    });
  }

  const rebuildBatch = writeBatch(db);

  rebuildBatch.set(
    seasonRef,
    {
      record: { wins, losses, ties },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  for (const player of players) {
    const playerRef = doc(db, "seasons", seasonId, "players", player.id);
    const totals = totalsByPlayer.get(player.id) ?? { ...EMPTY_STATS };

    rebuildBatch.set(
      playerRef,
      {
        stats: totals,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await rebuildBatch.commit();

  return { wroteLines, opponent: opp, gameId: gid };
}
