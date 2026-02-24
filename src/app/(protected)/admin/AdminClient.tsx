"use client";

import * as React from "react";

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
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";

import { firebaseAuth, firestore } from "@/lib/firebase";
import { useRosterPlayers, DEFAULT_SEASON_ID } from "@/lib/rosterStore";
import type { Player, PlayerBattingStats } from "@/lib/roster";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import {
  LineState,
  todayISO,
  GameResult,
  EMPTY_DELTA,
  anyNonZero,
  LineDelta,
  num,
} from "./adminHelpers";
import { Field, MiniNumber, Select } from "./adminUiHelpers";

type AdminTab = "stats" | "players" | "season";

type DraftPlayer = {
  key: string;
  name: string;
  number: string; // optional input
  primaryPos: string; // optional input
};

const EMPTY_STATS: PlayerBattingStats = {
  games: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  strikeouts: 0,
  hitByPitch: 0,
};

function newDraftPlayer(): DraftPlayer {
  return {
    key: `dp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    number: "",
    primaryPos: "",
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseOptionalInt(s: string): number {
  const raw = s.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function playerDocIdFromDraft(d: DraftPlayer, idx: number): string {
  const nameSlug = slugify(d.name) || `player-${idx + 1}`;
  const n = parseOptionalInt(d.number);
  if (n > 0) return `${String(n).padStart(2, "0")}-${nameSlug}`;
  return `p${String(idx + 1).padStart(2, "0")}-${nameSlug}`;
}

function toastStyle(kind: "err" | "ok") {
  return {
    borderColor:
      kind === "err"
        ? "color-mix(in oklab, var(--accent) 35%, transparent)"
        : "color-mix(in oklab, var(--accent-2) 35%, transparent)",
    background:
      kind === "err"
        ? "color-mix(in oklab, var(--accent) 12%, transparent)"
        : "color-mix(in oklab, var(--accent-2) 12%, transparent)",
    color: "var(--foreground)",
  } as const;
}

function TabButton(props: {
  label: string;
  active: boolean;
  onClickAction: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClickAction}
      disabled={props.disabled}
      className="h-10 rounded-xl border px-3 text-sm font-semibold transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor: props.active
          ? "color-mix(in oklab, var(--primary) 45%, transparent)"
          : "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: props.active
          ? "color-mix(in oklab, var(--primary) 16%, var(--card))"
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
        color: "var(--foreground)",
      }}
    >
      {props.label}
    </button>
  );
}

export default function AdminClient() {
  const { seasonId, meta, players, error: rosterError } = useRosterPlayers();

  const [tab, setTab] = React.useState<AdminTab>("stats");

  const [authReady, setAuthReady] = React.useState(false);
  const [uid, setUid] = React.useState<string | null>(null);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);

  const [isAllowlisted, setIsAllowlisted] = React.useState<boolean | null>(null);

  // Admin: player edits
  const [playerEdits, setPlayerEdits] = React.useState<
    Record<string, { name: string; number: string; dirty: boolean }>
  >({});
  const [playerBusy, setPlayerBusy] = React.useState(false);
  const [playerMsg, setPlayerMsg] = React.useState<string | null>(null);
  const [playerErr, setPlayerErr] = React.useState<string | null>(null);

  // Admin: season mgmt
  const [seasonEditId, setSeasonEditId] = React.useState("");
  const [seasonTeamName, setSeasonTeamName] = React.useState("");
  const [seasonLabel, setSeasonLabel] = React.useState("");
  const [seasonBusy, setSeasonBusy] = React.useState(false);
  const [seasonMsg, setSeasonMsg] = React.useState<string | null>(null);
  const [seasonErr, setSeasonErr] = React.useState<string | null>(null);

  // Admin: roster builder
  const [draft, setDraft] = React.useState<DraftPlayer[]>(() => [
    newDraftPlayer(),
  ]);
  const [rosterBusy, setRosterBusy] = React.useState(false);
  const [rosterMsg, setRosterMsg] = React.useState<string | null>(null);
  const [rosterErr, setRosterErr] = React.useState<string | null>(null);

  // Admin: game entry
  const [lines, setLines] = React.useState<Record<string, LineState>>({});

  const [date, setDate] = React.useState(todayISO());
  const [opponent, setOpponent] = React.useState("");
  const [result, setResult] = React.useState<GameResult>("W");
  const [scoreUs, setScoreUs] = React.useState("0");
  const [scoreThem, setScoreThem] = React.useState("0");

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);

  const canEdit = uid !== null && isAllowlisted === true;
  const effectiveSeasonId = seasonId || DEFAULT_SEASON_ID;

  React.useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUid(u?.uid ?? null);
      setAuthReady(true);

      if (!u?.uid) {
        setIsAllowlisted(null);
        return;
      }

      try {
        const adminRef = doc(firestore, "admins", u.uid);
        const snap = await getDoc(adminRef);
        setIsAllowlisted(snap.exists());
      } catch {
        setIsAllowlisted(false);
      }
    });

    return () => unsub();
  }, []);

  // Keep game-entry lines in sync with roster changes.
  React.useEffect(() => {
    const ps = players ?? null;
    if (ps === null) return;

    setLines((prev) => {
      const next: Record<string, LineState> = { ...prev };

      for (const p of ps) {
        if (!next[p.id]) next[p.id] = { hidden: false, delta: { ...EMPTY_DELTA } };
      }

      for (const k of Object.keys(next)) {
        if (!ps.find((p) => p.id === k)) delete next[k];
      }

      return next;
    });
  }, [players]);

  // Keep Player Update form state in sync with roster changes
  React.useEffect(() => {
    const ps = players ?? null;
    if (ps === null) return;

    setPlayerEdits((prev) => {
      const out: Record<string, { name: string; number: string; dirty: boolean }> =
        { ...prev };

      for (const p of ps) {
        const existing = out[p.id];
        if (!existing) {
          out[p.id] = { name: p.name, number: String(p.number ?? 0), dirty: false };
          continue;
        }

        if (!existing.dirty) {
          out[p.id] = { name: p.name, number: String(p.number ?? 0), dirty: false };
        }
      }

      for (const k of Object.keys(out)) {
        if (!ps.find((p) => p.id === k)) delete out[k];
      }

      return out;
    });
  }, [players]);

  const hiddenCount = React.useMemo(() => {
    return Object.values(lines).filter((l) => l.hidden).length;
  }, [lines]);

  const playedCount = React.useMemo(() => {
    const ps = players ?? [];
    let n = 0;
    for (const p of ps) {
      const l = lines[p.id];
      if (!l) continue;
      if (anyNonZero(l.delta)) n++;
    }
    return n;
  }, [players, lines]);

  const onSignInAction = React.useCallback(async () => {
    if (signingIn) return;
    setSignInError(null);
    setSigningIn(true);

    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setPassword("");
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Sign in failed.";
      setSignInError(msg);
    } finally {
      setSigningIn(false);
    }
  }, [email, password, signingIn]);

  function setDeltaValue(playerId: string, key: keyof LineDelta, value: number) {
    setLines((prev) => {
      const cur = prev[playerId];
      if (!cur) return prev;

      return {
        ...prev,
        [playerId]: {
          ...cur,
          delta: {
            ...cur.delta,
            [key]: Math.max(0, Math.floor(value)),
          },
        },
      };
    });
  }

  function toggleHidden(playerId: string) {
    setLines((prev) => {
      const cur = prev[playerId];
      if (!cur) return prev;
      return {
        ...prev,
        [playerId]: { ...cur, hidden: !cur.hidden },
      };
    });
  }

  const unhideAllAction = React.useCallback(() => {
    setLines((prev) => {
      const out: Record<string, LineState> = { ...prev };
      for (const k of Object.keys(out)) {
        out[k] = { ...out[k], hidden: false };
      }
      return out;
    });
  }, []);

  const resetAllAction = React.useCallback(() => {
    setLines((prev) => {
      const out: Record<string, LineState> = { ...prev };
      for (const k of Object.keys(out)) {
        out[k] = { ...out[k], delta: { ...EMPTY_DELTA } };
      }
      return out;
    });
  }, []);

  // -----------------------------
  // Player Update
  // -----------------------------
  function setPlayerEditValue(
    playerId: string,
    patch: Partial<{ name: string; number: string }>,
  ) {
    setPlayerEdits((prev) => {
      const cur = prev[playerId] ?? { name: "", number: "0", dirty: false };
      return {
        ...prev,
        [playerId]: {
          name: patch.name ?? cur.name,
          number: patch.number ?? cur.number,
          dirty: true,
        },
      };
    });
  }

  const dirtyPlayersCount = React.useMemo(() => {
    return Object.values(playerEdits).filter((p) => p.dirty).length;
  }, [playerEdits]);

  const onSavePlayerEditsAction = React.useCallback(async () => {
    if (!canEdit || playerBusy) return;

    setPlayerBusy(true);
    setPlayerMsg(null);
    setPlayerErr(null);

    try {
      const ps = players ?? [];
      if (ps.length === 0) {
        setPlayerErr("No players in roster.");
        return;
      }

      const batch = writeBatch(firestore);
      let wrote = 0;

      for (const p of ps) {
        const edit = playerEdits[p.id];
        if (!edit || !edit.dirty) continue;

        const name = edit.name.trim();
        if (!name) {
          setPlayerErr("Player name cannot be empty.");
          return;
        }

        const n = parseOptionalInt(edit.number);

        const playerRef = doc(
          firestore,
          "seasons",
          effectiveSeasonId,
          "players",
          p.id,
        );

        batch.set(
          playerRef,
          {
            name,
            number: n,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        wrote++;
      }

      if (wrote === 0) {
        setPlayerErr("No changes to save.");
        return;
      }

      await batch.commit();

      setPlayerMsg(`Saved changes for ${wrote} player(s).`);

      // Mark clean; keep values as-is.
      setPlayerEdits((prev) => {
        const out = { ...prev };
        for (const k of Object.keys(out)) out[k] = { ...out[k], dirty: false };
        return out;
      });
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to save player changes.";
      setPlayerErr(msg);
    } finally {
      setPlayerBusy(false);
    }
  }, [canEdit, playerBusy, players, playerEdits, effectiveSeasonId]);

  // -----------------------------
  // Season management
  // -----------------------------
  const onSwitchSeasonAction = React.useCallback(async () => {
    if (!canEdit || seasonBusy) return;

    setSeasonBusy(true);
    setSeasonMsg(null);
    setSeasonErr(null);

    try {
      const nextId = seasonEditId.trim();
      if (!nextId) {
        setSeasonErr("Season id is required.");
        return;
      }

      const seasonRef = doc(firestore, "seasons", nextId);
      await setDoc(
        seasonRef,
        {
          teamName: seasonTeamName.trim() || meta.teamName || "Team",
          seasonLabel: seasonLabel.trim() || "Season",
          record: { wins: 0, losses: 0, ties: 0 },
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      const cfgRef = doc(firestore, "app", "config");
      await setDoc(
        cfgRef,
        { currentSeasonId: nextId, updatedAt: serverTimestamp() },
        { merge: true },
      );

      setSeasonMsg(`Current season set to ${nextId}.`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to switch season.";
      setSeasonErr(msg);
    } finally {
      setSeasonBusy(false);
    }
  }, [
    canEdit,
    seasonBusy,
    seasonEditId,
    seasonTeamName,
    seasonLabel,
    meta.teamName,
  ]);

  // -----------------------------
  // Roster rebuild
  // -----------------------------
  function updateDraftRow(key: string, patch: Partial<DraftPlayer>) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function insertRowAfter(key: string) {
    setDraft((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx + 1, 0, newDraftPlayer());
      return next;
    });
  }

  function removeRow(key: string) {
    setDraft((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length ? next : [newDraftPlayer()];
    });
  }

  const onRebuildRosterAction = React.useCallback(async () => {
    if (!canEdit || rosterBusy) return;

    setRosterBusy(true);
    setRosterMsg(null);
    setRosterErr(null);

    try {
      const cleaned = draft
        .map((d) => ({
          ...d,
          name: d.name.trim(),
          number: d.number.trim(),
          primaryPos: d.primaryPos.trim(),
        }))
        .filter((d) => d.name.length > 0);

      if (cleaned.length === 0) {
        setRosterErr("Add at least one player name.");
        return;
      }

      const playersCol = collection(firestore, "seasons", effectiveSeasonId, "players");
      const snap = await getDocs(query(playersCol));

      const batch = writeBatch(firestore);
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

        const pref = doc(firestore, "seasons", effectiveSeasonId, "players", id);

        batch.set(
          pref,
          {
            ...player,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: false },
        );
      }

      const seasonRef = doc(firestore, "seasons", effectiveSeasonId);
      batch.set(
        seasonRef,
        {
          updatedAt: serverTimestamp(),
          record: { wins: 0, losses: 0, ties: 0 },
        },
        { merge: true },
      );

      await batch.commit();

      setRosterMsg(
        `Roster rebuilt for ${effectiveSeasonId}. Players: ${cleaned.length}.`,
      );

      setDraft([newDraftPlayer()]);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to rebuild roster.";
      setRosterErr(msg);
    } finally {
      setRosterBusy(false);
    }
  }, [canEdit, rosterBusy, effectiveSeasonId, draft]);

  // -----------------------------
  // Save game (existing; uses effectiveSeasonId)
  // -----------------------------
  const onSaveGameAction = React.useCallback(async () => {
    if (!canEdit || saving) return;

    setSaving(true);
    setSaveError(null);
    setSavedMsg(null);

    try {
      const opp = opponent.trim();
      if (!opp) {
        setSaveError("Opponent is required.");
        return;
      }

      const slug = opp
        .toLowerCase()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const gid = `${date.replaceAll("-", "")}-${slug}-${Date.now()}`;

      const seasonRef = doc(firestore, "seasons", effectiveSeasonId);
      const gameRef = doc(firestore, "seasons", effectiveSeasonId, "games", gid);

      const batch = writeBatch(firestore);

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

      const ps = players ?? [];
      for (const p of ps) {
        const l = lines[p.id];
        if (!l) continue;
        if (!anyNonZero(l.delta)) continue;

        wroteLines++;

        const lineRef = doc(
          firestore,
          "seasons",
          effectiveSeasonId,
          "games",
          gid,
          "lines",
          p.id,
        );

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

        const playerRef = doc(
          firestore,
          "seasons",
          effectiveSeasonId,
          "players",
          p.id,
        );

        batch.set(
          playerRef,
          {
            updatedAt: serverTimestamp(),
            "stats.atBats": increment(l.delta.atBats),
            "stats.hits": increment(l.delta.hits),
            "stats.doubles": increment(l.delta.doubles),
            "stats.triples": increment(l.delta.triples),
            "stats.homeRuns": increment(l.delta.homeRuns),
            "stats.runs": increment(l.delta.runs),
            "stats.rbi": increment(l.delta.rbi),
            "stats.walks": increment(l.delta.walks),
            "stats.hitByPitch": increment(l.delta.hitByPitch),
          },
          { merge: true },
        );
      }

      if (wroteLines === 0) {
        setSaveError("No player stats were entered (everything is zero).");
        return;
      }

      await batch.commit();

      setSavedMsg(`Saved game vs ${opp}. Updated ${wroteLines} player(s).`);

      setLines((prev) => {
        const out: Record<string, LineState> = { ...prev };
        for (const k of Object.keys(out)) {
          out[k] = { ...out[k], delta: { ...EMPTY_DELTA } };
        }
        return out;
      });
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Save failed.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    canEdit,
    saving,
    effectiveSeasonId,
    date,
    opponent,
    result,
    scoreUs,
    scoreThem,
    players,
    lines,
  ]);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardSubtitle>Sign in and manage the current season.</CardSubtitle>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Current season id:{" "}
            <span style={{ color: "var(--foreground)", fontWeight: 700 }}>
              {effectiveSeasonId}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton
              label="Stat Update"
              active={tab === "stats"}
              onClickAction={() => setTab("stats")}
            />
            <TabButton
              label="Player Update"
              active={tab === "players"}
              onClickAction={() => setTab("players")}
            />
            <TabButton
              label="Season Update"
              active={tab === "season"}
              onClickAction={() => setTab("season")}
            />
          </div>

          {!authReady ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Checking auth…
            </div>
          ) : uid === null ? (
            <div className="grid gap-3">
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Sign in (Firebase Auth) to update stats.
              </div>

              {signInError ? (
                <div
                  className="rounded-xl border px-3 py-2 text-xs"
                  style={toastStyle("err")}
                >
                  {signInError}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  label="Email"
                  value={email}
                  onChangeAction={setEmail}
                  type="email"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeAction={setPassword}
                  type="password"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={onSignInAction} disabled={signingIn}>
                  {signingIn ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            </div>
          ) : isAllowlisted === false ? (
            <div className="grid gap-2">
              <div className="text-sm font-semibold">
                Signed in, but not allowlisted.
              </div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Add a document at <code>admins/{uid}</code> to enable admin access.
              </div>
            </div>
          ) : isAllowlisted === null ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Checking admin allowlist…
            </div>
          ) : (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Signed in and allowlisted.
            </div>
          )}
        </CardContent>
      </Card>

      {tab === "stats" ? (
        <Card>
          <CardHeader>
            <CardTitle>Stat Update</CardTitle>
            <CardSubtitle>
              Enter a game and update season totals for the current season.
            </CardSubtitle>
          </CardHeader>

          <CardContent className="grid gap-4">
            {rosterError ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {rosterError}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label="Date"
                value={date}
                onChangeAction={setDate}
                type="date"
              />
              <Field
                label="Opponent"
                value={opponent}
                onChangeAction={setOpponent}
              />

              <Select
                label="Result"
                value={result}
                onChangeAction={(v) => setResult(v as GameResult)}
                options={[
                  ["W", "Win"],
                  ["L", "Loss"],
                  ["T", "Tie"],
                ]}
              />

              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Us"
                  value={scoreUs}
                  onChangeAction={setScoreUs}
                  inputMode="numeric"
                />
                <Field
                  label="Them"
                  value={scoreThem}
                  onChangeAction={setScoreThem}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Entered stats for{" "}
                <span style={{ color: "var(--foreground)" }}>{playedCount}</span>{" "}
                player(s).
                {hiddenCount > 0 ? (
                  <>
                    {" "}
                    Hidden:{" "}
                    <span style={{ color: "var(--foreground)" }}>
                      {hiddenCount}
                    </span>
                    .
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={unhideAllAction}>
                  Show hidden
                </Button>
                <Button variant="ghost" onClick={resetAllAction}>
                  Reset stats
                </Button>
              </div>
            </div>

            {saveError ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
                {saveError}
              </div>
            ) : null}

            {savedMsg ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
                {savedMsg}
              </div>
            ) : null}

            <div className="grid gap-3">
              {players === null ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  Loading players…
                </div>
              ) : (players ?? []).length === 0 ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  No players in roster. Use Season Update to rebuild roster.
                </div>
              ) : (
                (players ?? [])
                  .slice()
                  .sort((a, b) => {
                    const na = Number(a.number ?? 0);
                    const nb = Number(b.number ?? 0);
                    if (na !== nb) return na - nb;
                    return String(a.name).localeCompare(String(b.name));
                  })
                  .map((p) => {
                    const row = lines[p.id];
                    if (!row) return null;

                    if (row.hidden) {
                      return (
                        <div
                          key={p.id}
                          className="rounded-2xl border px-4 py-3"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 92%, transparent)",
                            background:
                              "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">
                                {p.name}{" "}
                                <span style={{ color: "var(--muted)" }}>
                                  #{p.number}
                                </span>
                              </div>
                              <div className="text-xs" style={{ color: "var(--muted)" }}>
                                Hidden row
                              </div>
                            </div>

                            <Button
                              variant="secondary"
                              onClick={() => toggleHidden(p.id)}
                            >
                              Show
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={p.id}
                        className="rounded-2xl border p-4"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--stroke) 92%, transparent)",
                          background:
                            "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                          boxShadow:
                            "0 0 0 1px color-mix(in oklab, var(--primary) 8%, transparent) inset",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                              {p.name}{" "}
                              <span className="text-xs" style={{ color: "var(--muted)" }}>
                                #{p.number}
                              </span>
                            </div>
                            {p.primaryPos ? (
                              <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                                {p.primaryPos}
                              </div>
                            ) : null}
                          </div>

                          <Button variant="ghost" onClick={() => toggleHidden(p.id)}>
                            Hide
                          </Button>
                        </div>

                        <div className="mt-3 adminStatGrid">
                          <MiniNumber
                            label="AB"
                            value={String(row.delta.atBats)}
                            onChangeAction={(v) => setDeltaValue(p.id, "atBats", v)}
                          />
                          <MiniNumber
                            label="H"
                            value={String(row.delta.hits)}
                            onChangeAction={(v) => setDeltaValue(p.id, "hits", v)}
                          />
                          <MiniNumber
                            label="2B"
                            value={String(row.delta.doubles)}
                            onChangeAction={(v) => setDeltaValue(p.id, "doubles", v)}
                          />
                          <MiniNumber
                            label="3B"
                            value={String(row.delta.triples)}
                            onChangeAction={(v) => setDeltaValue(p.id, "triples", v)}
                          />
                          <MiniNumber
                            label="HR"
                            value={String(row.delta.homeRuns)}
                            onChangeAction={(v) => setDeltaValue(p.id, "homeRuns", v)}
                          />
                          <MiniNumber
                            label="R"
                            value={String(row.delta.runs)}
                            onChangeAction={(v) => setDeltaValue(p.id, "runs", v)}
                          />
                          <MiniNumber
                            label="RBI"
                            value={String(row.delta.rbi)}
                            onChangeAction={(v) => setDeltaValue(p.id, "rbi", v)}
                          />
                          <MiniNumber
                            label="BB"
                            value={String(row.delta.walks)}
                            onChangeAction={(v) => setDeltaValue(p.id, "walks", v)}
                          />
                          <MiniNumber
                            label="HBP"
                            value={String(row.delta.hitByPitch)}
                            onChangeAction={(v) => setDeltaValue(p.id, "hitByPitch", v)}
                          />
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button onClick={onSaveGameAction} disabled={!canEdit || saving}>
                {saving ? "Saving…" : "Save game"}
              </Button>
            </div>

            {!canEdit ? (
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                Sign in and ensure your uid is allowlisted in <code>admins/{uid}</code>{" "}
                to save.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : tab === "players" ? (
        <Card>
          <CardHeader>
            <CardTitle>Player Update</CardTitle>
            <CardSubtitle>Edit player name and number for the current season.</CardSubtitle>
          </CardHeader>

          <CardContent className="grid gap-4">
            {!canEdit ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Sign in and ensure your uid is allowlisted to edit players.
              </div>
            ) : null}

            {playerErr ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
                {playerErr}
              </div>
            ) : null}

            {playerMsg ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
                {playerMsg}
              </div>
            ) : null}

            {players === null ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Loading players…
              </div>
            ) : (players ?? []).length === 0 ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                No players in roster. Use Season Update to rebuild roster.
              </div>
            ) : (
              <div className="grid gap-2">
                {(players ?? [])
                  .slice()
                  .sort((a, b) => {
                    const na = Number(a.number ?? 0);
                    const nb = Number(b.number ?? 0);
                    if (na !== nb) return na - nb;
                    return String(a.name).localeCompare(String(b.name));
                  })
                  .map((p) => {
                    const edit = playerEdits[p.id] ?? {
                      name: p.name,
                      number: String(p.number ?? 0),
                      dirty: false,
                    };

                    return (
                      <div
                        key={p.id}
                        className="rounded-2xl border p-3"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--stroke) 92%, transparent)",
                          background:
                            "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                          boxShadow:
                            "0 0 0 1px color-mix(in oklab, var(--primary) 8%, transparent) inset",
                        }}
                      >
                        <div className="grid gap-2 sm:grid-cols-12 sm:items-end">
                          <div className="sm:col-span-7">
                            <Field
                              label="Name"
                              value={edit.name}
                              onChangeAction={(v) => setPlayerEditValue(p.id, { name: v })}
                              disabled={!canEdit || playerBusy}
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <Field
                              label="Number"
                              value={edit.number}
                              onChangeAction={(v) => setPlayerEditValue(p.id, { number: v })}
                              inputMode="numeric"
                              disabled={!canEdit || playerBusy}
                            />
                          </div>

                          <div className="sm:col-span-2 flex items-center justify-end gap-2">
                            <div className="text-xs" style={{ color: "var(--muted)" }}>
                              {edit.dirty ? "Edited" : "Saved"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                Pending changes:{" "}
                <span style={{ color: "var(--foreground)", fontWeight: 700 }}>
                  {dirtyPlayersCount}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={onSavePlayerEditsAction}
                  disabled={!canEdit || playerBusy || dirtyPlayersCount === 0}
                >
                  {playerBusy ? "Saving…" : "Save player changes"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Season Update</CardTitle>
              <CardSubtitle>
                Switch to a new season (sets <code>app/config.currentSeasonId</code>).
              </CardSubtitle>
            </CardHeader>

            <CardContent className="grid gap-3">
              {!canEdit ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  Sign in and ensure your uid is allowlisted to edit season settings.
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-3">
                <Field
                  label="New season id"
                  value={seasonEditId}
                  onChangeAction={setSeasonEditId}
                  placeholder="tigers-2027"
                  disabled={!canEdit || seasonBusy}
                />
                <Field
                  label="Team name"
                  value={seasonTeamName}
                  onChangeAction={setSeasonTeamName}
                  placeholder={meta.teamName || "Team"}
                  disabled={!canEdit || seasonBusy}
                />
                <Field
                  label="Season label"
                  value={seasonLabel}
                  onChangeAction={setSeasonLabel}
                  placeholder="Spring 2027"
                  disabled={!canEdit || seasonBusy}
                />
              </div>

              {seasonErr ? (
                <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
                  {seasonErr}
                </div>
              ) : null}

              {seasonMsg ? (
                <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
                  {seasonMsg}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={onSwitchSeasonAction}
                  disabled={!canEdit || seasonBusy}
                >
                  {seasonBusy ? "Updating…" : "Set current season"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Roster Builder</CardTitle>
              <CardSubtitle>
                Add players one at a time. Rebuild overwrites the current season roster.
              </CardSubtitle>
            </CardHeader>

            <CardContent className="grid gap-3">
              {!canEdit ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  Sign in and ensure your uid is allowlisted to rebuild rosters.
                </div>
              ) : null}

              {rosterErr ? (
                <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
                  {rosterErr}
                </div>
              ) : null}

              {rosterMsg ? (
                <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
                  {rosterMsg}
                </div>
              ) : null}

              <div className="grid gap-2">
                {draft.map((d) => (
                  <div
                    key={d.key}
                    className="rounded-2xl border p-3"
                    style={{
                      borderColor:
                        "color-mix(in oklab, var(--stroke) 92%, transparent)",
                      background:
                        "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                      boxShadow:
                        "0 0 0 1px color-mix(in oklab, var(--primary) 8%, transparent) inset",
                    }}
                  >
                    <div className="grid gap-2 sm:grid-cols-12 sm:items-end">
                      <div className="sm:col-span-6">
                        <Field
                          label="Name"
                          value={d.name}
                          onChangeAction={(v) => updateDraftRow(d.key, { name: v })}
                          placeholder="Player name"
                          disabled={!canEdit || rosterBusy}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <Field
                          label="Number"
                          value={d.number}
                          onChangeAction={(v) => updateDraftRow(d.key, { number: v })}
                          inputMode="numeric"
                          placeholder="7"
                          disabled={!canEdit || rosterBusy}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <Field
                          label="Primary Pos"
                          value={d.primaryPos}
                          onChangeAction={(v) => updateDraftRow(d.key, { primaryPos: v })}
                          placeholder="SS"
                          disabled={!canEdit || rosterBusy}
                        />
                      </div>

                      <div className="sm:col-span-2 flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => insertRowAfter(d.key)}
                          disabled={!canEdit || rosterBusy}
                          title="Insert row"
                        >
                          +
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => removeRow(d.key)}
                          disabled={!canEdit || rosterBusy}
                          title="Remove row"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDraft((p) => [...p, newDraftPlayer()])}
                  disabled={!canEdit || rosterBusy}
                >
                  Add row
                </Button>

                <Button
                  onClick={onRebuildRosterAction}
                  disabled={!canEdit || rosterBusy}
                >
                  {rosterBusy ? "Rebuilding…" : "Rebuild roster (overwrite)"}
                </Button>
              </div>

              <div className="text-xs" style={{ color: "var(--muted)" }}>
                This overwrites{" "}
                <code>seasons/{effectiveSeasonId}/players</code>.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}