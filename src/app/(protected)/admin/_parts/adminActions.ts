"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

import type { Player } from "@/lib/roster";
import type {
  GameResult,
  LineState,
  CoachPicks,
  CoachPickKey,
} from "../adminHelpers";
import { num, parseOptionalInt, EMPTY_STATS } from "../adminHelpers";
import { careerPlayerIdForEdit } from "@/lib/playerIdentity";
import {
  planRosterAdditions,
  rosterRemovalBlocker,
  validateNewSeasonId,
  type ImportSelection,
  type NewPlayerDraft,
  type RosterAdditionPlan,
} from "@/lib/rosterPlanning";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { snapshotFromTeam, type Team } from "@/lib/branding";
import {
  asSeasonStatus,
  isFinalized,
  planFinalize,
  planReopen,
  type LifecycleEvent,
} from "@/lib/seasonLifecycle";
import { loadCurrentLineup } from "@/lib/lineupStore";
import type { GameLineupSnapshot } from "@/lib/lineup";
import {
  asGameType,
  computeOfficialSeasonTally,
  type GameType,
} from "@/lib/gameClassification";

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

/**
 * Creates a new season. Refuses any id that already exists (checked inside a
 * transaction), so an existing season's record, gamesPlayed, createdAt, and
 * other history can never be reset from here. Does not change the current
 * season; use makeCurrentSeason for that.
 */
export async function createSeason(opts: {
  db: Firestore;
  uid: string;
  seasonId: string;
  existingSeasonIds: string[];
  teamName: string;
  teamId: string;
  seasonLabel: string;
  usesGamesPlayedRecord: boolean;
  scheduledGames: number;
  fallbackTeamName: string;
  /** Team identity to link and snapshot (branding is copied, not referenced). */
  team?: Team | null;
}): Promise<{ seasonId: string }> {
  const { db, uid } = opts;
  const checked = validateNewSeasonId(opts.seasonId, opts.existingSeasonIds);
  if (!checked.ok) throw new Error(checked.error);
  const seasonId = checked.seasonId;
  const seasonRef = doc(db, "seasons", seasonId);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(seasonRef);
    if (existing.exists()) {
      throw new Error(
        `Season "${seasonId}" already exists. Choose it under Make current season instead.`,
      );
    }
    const team = opts.team ?? null;
    const teamName = team
      ? team.teamName.trim()
      : opts.teamName.trim() || opts.fallbackTeamName || "Team";
    const teamId = team ? team.teamId : opts.teamId.trim().toLowerCase();
    tx.set(seasonRef, {
      teamName,
      ...(teamId ? { teamId } : {}),
      ...(team
        ? { league: team.division.trim(), branding: snapshotFromTeam(team) }
        : {}),
      seasonLabel: opts.seasonLabel.trim() || "Season",
      record: { wins: 0, losses: 0, ties: 0 },
      usesGamesPlayedRecord: opts.usesGamesPlayedRecord === true,
      scheduledGames: Math.max(0, Math.floor(opts.scheduledGames)),
      gamesPlayed: 0,
      // New seasons start as drafts: roster setup now, games once current.
      status: "draft",
      ...(uid ? { coachUids: [uid] } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return { seasonId };
}

/**
 * Points app/config at an existing season. A draft season becomes "active"
 * (lifecycle fields only); a finalized season must be reopened first, so
 * reopening and making current stay separate, deliberate actions. Never
 * touches record, games, stats, or awards.
 */
export async function makeCurrentSeason(opts: {
  db: Firestore;
  seasonId: string;
  uid?: string;
}): Promise<void> {
  const { db } = opts;
  const seasonId = opts.seasonId.trim();
  if (!seasonId) throw new Error("Choose a season.");
  const seasonRef = doc(db, "seasons", seasonId);
  const cfgRef = doc(db, "app", "config");

  await runTransaction(db, async (tx) => {
    const season = await tx.get(seasonRef);
    if (!season.exists()) {
      throw new Error(`Season "${seasonId}" does not exist.`);
    }
    const data = season.data();
    if (isFinalized(data)) {
      throw new Error(
        `${data.seasonLabel ?? seasonId} is finalized. Reopen it first if it needs to become current again.`,
      );
    }
    if (asSeasonStatus(data.status) === "draft") {
      if (!opts.uid) throw new Error("Sign in as the head coach to activate a season.");
      const event: LifecycleEvent = {
        action: "activated",
        at: new Date().toISOString(),
        byUid: opts.uid,
        fromStatus: "draft",
      };
      tx.update(seasonRef, {
        status: "active",
        activatedAt: serverTimestamp(),
        lifecycleHistory: [
          ...(Array.isArray(data.lifecycleHistory) ? data.lifecycleHistory : []),
          event,
        ],
        updatedAt: serverTimestamp(),
      });
    }
    tx.set(
      cfgRef,
      { currentSeasonId: seasonId, updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

/** Clear error before Firestore rules reject a write to a finalized season. */
export async function assertSeasonWritable(db: Firestore, seasonId: string): Promise<void> {
  const snap = await getDoc(doc(db, "seasons", seasonId));
  if (snap.exists() && isFinalized(snap.data())) {
    const label = String(snap.data().seasonLabel ?? seasonId);
    throw new Error(`${label} is finalized and read-only. Reopen it to make changes.`);
  }
}

/**
 * Finalizes a season: marks it read-only (enforced by Firestore rules).
 * Writes only lifecycle fields (status, finalizedAt, finalizedByUid,
 * lifecycleHistory, updatedAt); never recalculates stats or resets the
 * record, games played, or awards. Idempotent.
 */
export async function finalizeSeason(opts: {
  db: Firestore;
  uid: string;
  seasonId: string;
}): Promise<{ alreadyFinalized: boolean }> {
  const { db, uid, seasonId } = opts;
  const ref = doc(db, "seasons", seasonId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Season "${seasonId}" does not exist.`);
    const plan = planFinalize(snap.data(), uid, new Date().toISOString());
    if (plan.alreadyFinalized) return { alreadyFinalized: true };
    tx.update(ref, {
      status: "finalized",
      finalizedAt: serverTimestamp(),
      finalizedByUid: uid,
      lifecycleHistory: plan.history,
      updatedAt: serverTimestamp(),
    });
    return { alreadyFinalized: false };
  });
}

/**
 * Reopens a finalized season so it is editable again ("active"). Does not
 * make it the current season. The finalization is kept in
 * lifecycleHistory; records, stats, and awards are untouched.
 */
export async function reopenSeason(opts: {
  db: Firestore;
  uid: string;
  seasonId: string;
}): Promise<void> {
  const { db, uid, seasonId } = opts;
  const ref = doc(db, "seasons", seasonId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Season "${seasonId}" does not exist.`);
    const plan = planReopen(snap.data(), uid, new Date().toISOString());
    tx.update(ref, {
      status: "active",
      reopenedAt: serverTimestamp(),
      reopenedByUid: uid,
      lifecycleHistory: plan.history,
      updatedAt: serverTimestamp(),
    });
  });
}

// Edits the official schedule size for an existing season without touching
// games, record, or gamesPlayed.
export async function updateScheduledGames(opts: {
  db: Firestore;
  seasonId: string;
  scheduledGames: number;
}): Promise<void> {
  const { db, seasonId, scheduledGames } = opts;
  await assertSeasonWritable(db, seasonId);
  if (!Number.isFinite(scheduledGames) || scheduledGames < 0) {
    throw new Error("Scheduled games must be a whole number, 0 or more.");
  }

  const batch = writeBatch(db);
  batch.set(
    doc(db, "seasons", seasonId),
    {
      scheduledGames: Math.floor(scheduledGames),
      updatedAt: serverTimestamp(),
    },
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
      returningPlayer: boolean;
      dirty: boolean;
    }
  >;
}): Promise<{ wrote: number }> {
  const { db, seasonId, players, edits } = opts;

  if (players.length === 0) throw new Error("No players in roster.");
  await assertSeasonWritable(db, seasonId);

  const batch = writeBatch(db);
  let wrote = 0;

  for (const p of players) {
    const edit = edits[p.id];
    if (!edit || !edit.dirty) continue;

    const name = edit.name.trim();
    if (!name) throw new Error("Player name cannot be empty.");

    const n = parseOptionalInt(edit.number);
    const shirtSize = edit.shirtSize.trim();
    // Editing a name, number, or flag never changes who the player is: the
    // stored careerPlayerId is kept (one is minted only if a legacy doc has
    // none), and the doc id is unchanged, so game lines stay attached.
    const { careerPlayerId } = careerPlayerIdForEdit(p.careerPlayerId);
    const playerRef = doc(db, "seasons", seasonId, "players", p.id);

    batch.set(
      playerRef,
      {
        name,
        careerPlayerId,
        number: n,
        shirtSize: shirtSize ? shirtSize : null,
        leaderboardHidden: edit.leaderboardHidden === true,
        returningPlayer: edit.returningPlayer === true,
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

/**
 * Adds returning and new players to a season roster. Additive only: never
 * deletes or overwrites a roster doc, never touches the season record, and
 * never copies stats (new entries start at zero). Re-submitting the same
 * selection skips players already on the roster.
 */
export async function addPlayersToRoster(opts: {
  db: Firestore;
  seasonId: string;
  imports: ImportSelection[];
  newPlayers: NewPlayerDraft[];
}): Promise<RosterAdditionPlan> {
  const { db, seasonId } = opts;
  if (!seasonId.trim()) throw new Error("Choose a season.");

  const seasonSnap = await getDoc(doc(db, "seasons", seasonId));
  if (!seasonSnap.exists()) {
    throw new Error(`Season "${seasonId}" does not exist. Create it first.`);
  }
  await assertSeasonWritable(db, seasonId);

  const playersCol = collection(db, "seasons", seasonId, "players");
  const existingSnap = await getDocs(playersCol);
  const plan = planRosterAdditions({
    existing: existingSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: typeof data.name === "string" ? data.name : "",
        number: typeof data.number === "number" ? data.number : 0,
        careerPlayerId:
          typeof data.careerPlayerId === "string"
            ? data.careerPlayerId
            : undefined,
        linkedFrom: normalizeLinkedFrom(data.linkedFrom),
      };
    }),
    imports: opts.imports,
    newPlayers: opts.newPlayers,
  });

  if (plan.writes.length === 0) return plan;

  let written: typeof plan.writes = [];
  await runTransaction(db, async (tx) => {
    const refs = plan.writes.map((w) => doc(playersCol, w.seasonPlayerId));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    written = [];
    plan.writes.forEach((w, i) => {
      if (snaps[i].exists()) return; // added concurrently; keep what is there
      tx.set(refs[i], {
        ...w.data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      written.push(w);
    });
  });

  const skippedNow = plan.writes
    .filter((w) => !written.includes(w))
    .map((w) => ({ name: w.data.name, reason: "already-on-roster" as const }));

  return {
    writes: written,
    skipped: [...plan.skipped, ...skippedNow],
    warnings: plan.warnings,
  };
}

/** Collects every place a season references its roster doc ids. */
async function scanSeasonReferences(db: Firestore, seasonId: string) {
  const lineIds = new Set<string>();
  const gameAwardIds = new Set<string>();
  const games = await getDocs(collection(db, "seasons", seasonId, "games"));
  for (const g of games.docs) {
    const data = g.data() as {
      coachAwards?: Record<string, { playerId?: unknown }>;
      gameBall?: { playerId?: unknown } | null;
    };
    for (const award of Object.values(data.coachAwards ?? {})) {
      if (typeof award?.playerId === "string") gameAwardIds.add(award.playerId);
    }
    if (typeof data.gameBall?.playerId === "string") {
      gameAwardIds.add(data.gameBall.playerId);
    }
    const lines = await getDocs(
      collection(db, "seasons", seasonId, "games", g.id, "lines"),
    );
    lines.forEach((l) => {
      lineIds.add(l.id);
      const pid = l.data().playerId;
      if (typeof pid === "string") lineIds.add(pid);
    });
  }

  const season = (await getDoc(doc(db, "seasons", seasonId))).data() ?? {};
  const finalAwardIds = new Set<string>(
    Object.values((season.finalAwards ?? {}) as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string",
    ),
  );
  const layoutIds = new Set<string>(
    Object.keys((season.recognitionLayouts ?? {}) as Record<string, unknown>),
  );

  return { lineIds, gameAwardIds, finalAwardIds, layoutIds };
}

/**
 * Removes a roster entry added by mistake. Permitted only when the player
 * has no history in this season (no game lines, no game or season
 * recognition, no saved layout) and no other season links to it.
 * `confirmName` must equal the player's name as an explicit confirmation.
 */
export async function removeRosterPlayer(opts: {
  db: Firestore;
  seasonId: string;
  seasonPlayerId: string;
  confirmName: string;
}): Promise<void> {
  const { db, seasonId, seasonPlayerId } = opts;
  await assertSeasonWritable(db, seasonId);
  const ref = doc(db, "seasons", seasonId, "players", seasonPlayerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That player is not on this roster.");

  const name = String(snap.data().name ?? "").trim();
  if (opts.confirmName.trim() !== name) {
    throw new Error(`Type ${name} exactly to confirm removal.`);
  }

  const scan = await scanSeasonReferences(db, seasonId);
  const linkedFromIds = new Set<string>();
  const seasons = await getDocs(collection(db, "seasons"));
  for (const s of seasons.docs) {
    if (s.id === seasonId) continue;
    const ps = await getDocs(collection(db, "seasons", s.id, "players"));
    ps.forEach((p) => {
      for (const r of normalizeLinkedFrom(p.data().linkedFrom)) {
        if (r.seasonId === seasonId) linkedFromIds.add(r.seasonPlayerId);
      }
    });
  }

  const blocker = rosterRemovalBlocker(seasonPlayerId, {
    ...scan,
    linkedFromIds,
  });
  if (blocker) {
    throw new Error(`${name} ${blocker}, so they stay on the roster.`);
  }

  await writeBatch(db).delete(ref).commit();
}

export async function saveGameAndApplyDeltas(opts: {
  db: Firestore;
  seasonId: string;
  date: string;
  opponent: string;
  result: GameResult;
  gameType: GameType;
  scoreUs: string;
  scoreThem: string;
  players: Player[];
  lines: Record<string, LineState>;
  coachPicks: CoachPicks;
  gameBallPlayerId: string;
  gameId?: string | null;
}): Promise<{ wroteLines: number; opponent: string; gameId: string }> {
  const {
    db,
    seasonId,
    date,
    opponent,
    result,
    gameType,
    scoreUs,
    scoreThem,
    players,
    lines,
    coachPicks,
    gameBallPlayerId,
    gameId,
  } = opts;

  const opp = opponent.trim();
  if (!opp) throw new Error("Opponent is required.");
  await assertSeasonWritable(db, seasonId);

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

  if (wroteLines === 0 && coachPickCount === 0 && !gameBallPlayerId) {
    throw new Error("No player stats or coach picks were entered.");
  }

  let gameBall: { playerId: string; playerName: string; playerNumber: number } | null =
    null;

  if (gameBallPlayerId) {
    const gameBallPlayer = players.find((p) => p.id === gameBallPlayerId);
    if (!gameBallPlayer) {
      throw new Error("Selected Game Ball player was not found in roster.");
    }

    // Repeat recipients across games are allowed. Each game stores a single
    // gameBall object, so one game can never hold two awards.
    gameBall = {
      playerId: gameBallPlayer.id,
      playerName: gameBallPlayer.name,
      playerNumber: gameBallPlayer.number,
    };
  }

  // Historical lineup snapshot: captured only the first time this game is
  // saved, using whatever the current lineup is at that moment. Later edits
  // to this same game must NOT re-capture it (that would make the snapshot
  // track the current lineup instead of staying frozen to this game), and
  // older games saved before this feature existed simply never get one.
  let lineupSnapshot: GameLineupSnapshot | null = null;

  if (!gameId) {
    const currentLineup = await loadCurrentLineup(db, seasonId);
    if (currentLineup && currentLineup.rows.length > 0) {
      lineupSnapshot = {
        capturedAtISO: new Date().toISOString(),
        inningCount: currentLineup.inningCount,
        rows: currentLineup.rows,
      };
    }
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
      gameType: asGameType(gameType),
      score: { us: num(scoreUs), them: num(scoreThem) },
      coachAwards: selectedCoachAwards,
      gameBall,
      updatedAt: serverTimestamp(),
      ...(gameId ? {} : { createdAt: serverTimestamp() }),
      ...(lineupSnapshot ? { lineupSnapshot } : {}),
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

  // Official record and games played exclude scrimmages; legacy games with
  // no gameType count as Regular Season. Player stat totals below still
  // include every game, as before.
  const tally = computeOfficialSeasonTally(
    gamesSnap.docs.map((gameDoc) => {
      const data = gameDoc.data() as { result?: unknown; gameType?: unknown };
      return { result: data.result, gameType: data.gameType };
    }),
  );

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
      coachAwards?: Record<
        string,
        { playerId?: unknown; playerName?: unknown; playerNumber?: unknown }
      >;
    };

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
      record: { wins: tally.wins, losses: tally.losses, ties: tally.ties },
      gamesPlayed: tally.gamesPlayed,
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
