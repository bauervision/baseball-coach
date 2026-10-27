// app/admin/_parts/useRosterDraft.ts
"use client";

import { useAdminScope } from "@/lib/adminScope";
import { loadScopedRosterSeasons } from "@/lib/teamData";
import * as React from "react";
import type { Firestore } from "firebase/firestore";
import type { DraftPlayer } from "../adminHelpers";
import { newDraftPlayer } from "../adminHelpers";
import { addPlayersToRoster } from "./adminActions";
import { newCareerPlayerId } from "@/lib/playerIdentity";
import {
  buildCandidatesFromRosters,
  defaultSelectedKeys,
  mergeRegistryCandidates,
  searchCandidates,
  type PlayerCandidate,
  type RosterSeasonInput,
} from "@/lib/playerSearch";
import type { RosterEntryDetails } from "@/lib/rosterPlanning";
import { loadRosterSeasons, type SeasonSummary } from "@/lib/seasonStore";
import { PLAYER_REGISTRY_ENABLED } from "@/lib/features";
import {
  ensureManagedIdentity,
  listLinkedPlayers,
  listManagedIdentities,
} from "@/lib/coachPlayersStore";

export type ImportPick = RosterEntryDetails & {
  candidate: PlayerCandidate;
  /** Permanent id the new entry will use (minted once if the source had none). */
  careerPlayerId: string;
};

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function pickFor(c: PlayerCandidate): ImportPick {
  const last = c.seasons[0];
  return {
    candidate: c,
    careerPlayerId: c.careerPlayerId || newCareerPlayerId(),
    number: last && last.number > 0 ? String(last.number) : "",
    primaryPos: "",
    shirtSize: "",
  };
}

export function useRosterDraft(opts: {
  db: Firestore;
  uid: string | null;
  seasons: SeasonSummary[] | null;
  defaultSeasonId: string;
  canEdit: boolean;
}) {
  const { db, uid, seasons, defaultSeasonId, canEdit } = opts;
  const scope = useAdminScope();

  // Follows the current season (which may still be loading) until the coach
  // picks a season explicitly.
  const [chosenSeasonId, setTargetSeasonId] = React.useState<string | null>(
    null,
  );
  const targetSeasonId = chosenSeasonId ?? defaultSeasonId;

  const [rosterSeasons, setRosterSeasons] = React.useState<
    RosterSeasonInput[] | null
  >(null);
  const [registry, setRegistry] = React.useState<{
    identities: Array<{ careerPlayerId: string; displayName: string }>;
    linkedIds: Set<string>;
  }>({ identities: [], linkedIds: new Set() });
  const [reloadVersion, setReloadVersion] = React.useState(0);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [picks, setPicks] = React.useState<Record<string, ImportPick>>({});
  const [draft, setDraft] = React.useState<DraftPlayer[]>([]);
  const [rosterBusy, setRosterBusy] = React.useState(false);
  const [rosterMsg, setRosterMsg] = React.useState<string | null>(null);
  const [rosterErr, setRosterErr] = React.useState<string | null>(null);

  // Linked children are preselected once per target season; a deselection
  // sticks until the coach switches seasons.
  const preselectedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    setPicks({});
    setDraft([]);
    setSearchQuery("");
    setRosterMsg(null);
    setRosterErr(null);
    preselectedFor.current = null;
  }, [targetSeasonId]);

  React.useEffect(() => {
    if (!canEdit || seasons === null) return;
    let active = true;
    setRosterSeasons(null);
    (scope ? loadScopedRosterSeasons(db, seasons) : loadRosterSeasons(db, seasons))
      .then((list) => {
        if (active) setRosterSeasons(list);
      })
      .catch((e: unknown) => {
        if (active) {
          setRosterSeasons([]);
          setRosterErr(errorText(e, "Failed to load previous rosters."));
        }
      });
    return () => {
      active = false;
    };
  }, [scope, db, seasons, canEdit, reloadVersion]);

  React.useEffect(() => {
    if (!PLAYER_REGISTRY_ENABLED || !canEdit || !uid) return;
    let active = true;
    Promise.all([listManagedIdentities(db, uid), listLinkedPlayers(db, uid)])
      .then(([identities, linked]) => {
        if (!active) return;
        setRegistry({
          identities: [...identities, ...linked],
          linkedIds: new Set(linked.map((l) => l.careerPlayerId)),
        });
      })
      .catch(() => {
        // Registry rules not deployed or unavailable: prior rosters still work.
      });
    return () => {
      active = false;
    };
  }, [db, uid, canEdit, reloadVersion]);

  const targetRoster = React.useMemo(
    () => rosterSeasons?.find((s) => s.seasonId === targetSeasonId) ?? null,
    [rosterSeasons, targetSeasonId],
  );

  const candidates = React.useMemo(() => {
    if (!rosterSeasons) return null;
    const fromRosters = buildCandidatesFromRosters(rosterSeasons, {
      uid: uid ?? "",
      excludeSeasonId: targetSeasonId,
    });
    return mergeRegistryCandidates(
      fromRosters,
      registry.identities,
      registry.linkedIds,
    );
  }, [rosterSeasons, uid, targetSeasonId, registry]);

  // Identities and prior entries already on the target roster.
  const onRoster = React.useMemo(() => {
    const ids = new Set<string>();
    for (const p of targetRoster?.players ?? []) {
      ids.add(p.id);
      if (p.careerPlayerId) ids.add(p.careerPlayerId);
    }
    return ids;
  }, [targetRoster]);

  const isOnRoster = React.useCallback(
    (c: PlayerCandidate) =>
      (!!c.careerPlayerId && onRoster.has(c.careerPlayerId)) ||
      (c.status === "unreviewed" &&
        c.seasons.some((s) => onRoster.has(s.seasonPlayerId))),
    [onRoster],
  );

  React.useEffect(() => {
    if (!candidates || !targetRoster) return;
    if (preselectedFor.current === targetSeasonId) return;
    preselectedFor.current = targetSeasonId;
    const keys = new Set(defaultSelectedKeys(candidates, isOnRoster));
    if (keys.size === 0) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const c of candidates) {
        if (keys.has(c.key)) next[c.key] ??= pickFor(c);
      }
      return next;
    });
  }, [candidates, targetRoster, targetSeasonId, isOnRoster]);

  const results = React.useMemo(
    () => (candidates ? searchCandidates(candidates, searchQuery) : []),
    [candidates, searchQuery],
  );

  function togglePick(c: PlayerCandidate) {
    setPicks((prev) => {
      const next = { ...prev };
      if (next[c.key]) delete next[c.key];
      else next[c.key] = pickFor(c);
      return next;
    });
  }

  function updatePick(key: string, patch: Partial<RosterEntryDetails>) {
    setPicks((prev) =>
      prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev,
    );
  }

  function updateDraftRow(key: string, patch: Partial<DraftPlayer>) {
    setDraft((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function addDraftRow() {
    setDraft((prev) => [...prev, newDraftPlayer()]);
  }

  function removeDraftRow(key: string) {
    setDraft((prev) => prev.filter((r) => r.key !== key));
  }

  const pickList = Object.values(picks);
  const newRows = draft.filter((d) => d.name.trim());
  const pendingCount = pickList.length + newRows.length;

  const onAddPlayersAction = React.useCallback(async () => {
    if (!canEdit || rosterBusy || !targetSeasonId) return;

    setRosterBusy(true);
    setRosterMsg(null);
    setRosterErr(null);

    try {
      const res = await addPlayersToRoster({
        scope,
        db,
        seasonId: targetSeasonId,
        imports: Object.values(picks).map((p) => ({
          careerPlayerId: p.careerPlayerId,
          name: p.candidate.displayName,
          linkedFrom: p.candidate.seasons.map((s) => ({
            seasonId: s.seasonId,
            seasonPlayerId: s.seasonPlayerId,
          })),
          number: p.number,
          primaryPos: p.primaryPos,
          shirtSize: p.shirtSize,
        })),
        newPlayers: draft.filter((d) => d.name.trim()),
      });

      if (PLAYER_REGISTRY_ENABLED && uid) {
        await Promise.allSettled(
          res.writes.map((w) =>
            ensureManagedIdentity({
              db,
              uid,
              careerPlayerId: w.data.careerPlayerId,
              displayName: w.data.name,
            }),
          ),
        );
      }

      const parts = [
        `Added ${res.writes.length} player${res.writes.length === 1 ? "" : "s"} to ${scope ? (seasons?.find((x) => x.seasonId === targetSeasonId)?.seasonLabel ?? "the roster") : targetSeasonId}.`,
      ];
      if (res.skipped.length) {
        parts.push(
          `Already on the roster: ${res.skipped.map((s) => s.name).join(", ")}.`,
        );
      }
      parts.push(...res.warnings);
      setRosterMsg(parts.join(" "));
      setPicks({});
      setDraft([]);
      setReloadVersion((v) => v + 1);
    } catch (e: unknown) {
      setRosterErr(errorText(e, "Failed to add players."));
    } finally {
      setRosterBusy(false);
    }
  }, [scope, seasons, canEdit, rosterBusy, targetSeasonId, db, picks, draft, uid]);

  return {
    targetSeasonId,
    setTargetSeasonId,
    targetRoster,
    candidatesLoading: candidates === null,
    results,
    searchQuery,
    setSearchQuery,
    picks,
    togglePick,
    updatePick,
    isOnRoster,
    draft,
    addDraftRow,
    updateDraftRow,
    removeDraftRow,
    pendingCount,
    rosterBusy,
    rosterMsg,
    rosterErr,
    onAddPlayersAction,
  };
}
