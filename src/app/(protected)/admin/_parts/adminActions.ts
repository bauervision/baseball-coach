// app/admin/adminActions.ts
"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  writeBatch,
  serverTimestamp,
  increment,
  type Firestore,
} from "firebase/firestore";

import type { Player } from "@/lib/roster";
import type { GameResult, LineState, DraftPlayer } from "../adminHelpers";
import {
  num,
  parseOptionalInt,
  playerDocIdFromDraft,
  EMPTY_STATS,
} from "../adminHelpers";

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

  await setDoc(
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

  const cfgRef = doc(db, "app", "config");
  await setDoc(
    cfgRef,
    { currentSeasonId: nextId, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function savePlayerEdits(opts: {
  db: Firestore;
  seasonId: string;
  players: Player[];
  edits: Record<
    string,
    { name: string; number: string; shirtSize: string; dirty: boolean }
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

  // delete current roster
  snap.forEach((docSnap) => batch.delete(docSnap.ref));

  // write new roster
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

  // reset season record
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
}): Promise<{ wroteLines: number; opponent: string }> {
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
  } = opts;

  const opp = opponent.trim();
  if (!opp) throw new Error("Opponent is required.");

  const slug = opp
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const gid = `${date.replaceAll("-", "")}-${slug}-${Date.now()}`;

  const seasonRef = doc(db, "seasons", seasonId);
  const gameRef = doc(db, "seasons", seasonId, "games", gid);

  const batch = writeBatch(db);

  batch.set(
    gameRef,
    {
      date,
      opponent: opp,
      result,
      score: { us: num(scoreUs), them: num(scoreThem) },
      createdAt: serverTimestamp(),
    },
    { merge: false },
  );

  const recordPatch =
    result === "W"
      ? { "record.wins": increment(1) }
      : result === "L"
        ? { "record.losses": increment(1) }
        : { "record.ties": increment(1) };

  batch.set(
    seasonRef,
    {
      updatedAt: serverTimestamp(),
      ...recordPatch,
    },
    { merge: true },
  );

  let wroteLines = 0;

  for (const p of players) {
    const l = lines[p.id];
    if (!l) continue;
    if (l.hidden) continue;
    // anyNonZero lives in adminHelpers; caller should validate or we can just
    // check field-by-field later. For now, rely on caller and just write when non-zero:
    const d = l.delta as Record<string, unknown>;
    const hasAny =
      Object.values(d).some((v) => typeof v === "number" && v !== 0) ?? false;
    if (!hasAny) continue;

    wroteLines++;

    const lineRef = doc(db, "seasons", seasonId, "games", gid, "lines", p.id);
    batch.set(
      lineRef,
      {
        playerId: p.id,
        name: p.name,
        number: p.number,
        delta: l.delta,
      },
      { merge: false },
    );

    const playerRef = doc(db, "seasons", seasonId, "players", p.id);

    // Batting-only for now; we’ll extend this when we add PO/A to LineDelta.
    batch.set(
      playerRef,
      {
        updatedAt: serverTimestamp(),
        "stats.atBats": increment((l.delta as any).atBats ?? 0),
        "stats.hits": increment((l.delta as any).hits ?? 0),
        "stats.doubles": increment((l.delta as any).doubles ?? 0),
        "stats.triples": increment((l.delta as any).triples ?? 0),
        "stats.homeRuns": increment((l.delta as any).homeRuns ?? 0),
        "stats.runs": increment((l.delta as any).runs ?? 0),
        "stats.rbi": increment((l.delta as any).rbi ?? 0),
        "stats.walks": increment((l.delta as any).walks ?? 0),
        "stats.hitByPitch": increment((l.delta as any).hitByPitch ?? 0),
      },
      { merge: true },
    );
  }

  if (wroteLines === 0)
    throw new Error("No player stats were entered (everything is zero).");

  await batch.commit();
  return { wroteLines, opponent: opp };
}
