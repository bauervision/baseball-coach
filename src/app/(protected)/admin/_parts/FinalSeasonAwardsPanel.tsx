"use client";

import * as React from "react";
import { doc, setDoc, type Firestore } from "firebase/firestore";
import type { Player } from "@/lib/roster";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "../adminUiHelpers";
import { toastStyle } from "../adminHelpers";

export type FinalAwardKey =
  | "mvp"
  | "dominator"
  | "honorableMention"
  | "bestAllAround";

export type FinalAwards = Record<FinalAwardKey, string>;

const FINAL_AWARD_FIELDS: Array<{ key: FinalAwardKey; label: string }> = [
  { key: "mvp", label: "MVP" },
  { key: "dominator", label: "Dominator" },
  { key: "honorableMention", label: "Honorable Mention" },
  { key: "bestAllAround", label: "Best All-Around" },
];

type SeasonFinalState = {
  endSeasonMode: boolean;
  finalAwards: FinalAwards;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asPlayerId(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function normalizeSeasonFinalState(meta: unknown): SeasonFinalState {
  const root = asRecord(meta);
  const rawFinalAwards = asRecord(root.finalAwards);

  return {
    endSeasonMode: root.endSeasonMode === true,
    finalAwards: {
      mvp: asPlayerId(rawFinalAwards.mvp),
      dominator: asPlayerId(rawFinalAwards.dominator),
      honorableMention: asPlayerId(rawFinalAwards.honorableMention),
      bestAllAround: asPlayerId(rawFinalAwards.bestAllAround),
    },
  };
}

function validateNoDuplicateFinalAwards(
  finalAwards: FinalAwards,
): string | null {
  const picked = Object.values(finalAwards).filter(Boolean);
  const unique = new Set(picked);

  if (picked.length !== unique.size) {
    return "A player can only receive one final season award.";
  }

  return null;
}

export function FinalSeasonAwardsPanel(props: {
  db: Firestore;
  seasonId: string;
  canEdit: boolean;
  players: Player[] | null;
  endSeasonMode: boolean;
  finalAwards: FinalAwards;
}) {
  const { db, seasonId, canEdit, players, endSeasonMode, finalAwards } = props;

  const [draftAwards, setDraftAwards] =
    React.useState<FinalAwards>(finalAwards);
  const [confirmingEndSeason, setConfirmingEndSeason] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    queueMicrotask(() => {
      setDraftAwards(finalAwards);
    });
  }, [finalAwards]);

  const sortedPlayers = React.useMemo(() => {
    return (players ?? []).slice().sort((a, b) => {
      const na = Number(a.number ?? 0);
      const nb = Number(b.number ?? 0);
      if (na !== nb) return na - nb;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [players]);

  const optionsForAward = React.useCallback(
    (currentKey: FinalAwardKey): [string, string][] => {
      const selectedByOtherAwards = new Set(
        FINAL_AWARD_FIELDS.filter((field) => field.key !== currentKey)
          .map((field) => draftAwards[field.key])
          .filter(Boolean),
      );

      return [
        ["", "— None —"],
        ...sortedPlayers
          .filter(
            (player) =>
              player.id === draftAwards[currentKey] ||
              !selectedByOtherAwards.has(player.id),
          )
          .map((player): [string, string] => [
            player.id,
            `#${player.number} ${player.name}`,
          ]),
      ];
    },
    [draftAwards, sortedPlayers],
  );

  const setAwardAction = React.useCallback(
    (key: FinalAwardKey, playerId: string) => {
      setDraftAwards((prev) => ({
        ...prev,
        [key]: playerId,
      }));
      setMsg(null);
      setErr(null);
    },
    [],
  );

  const saveAwardsAction = React.useCallback(async () => {
    if (!canEdit || busy) return;

    const validationError = validateNoDuplicateFinalAwards(draftAwards);
    if (validationError) {
      setErr(validationError);
      setMsg(null);
      return;
    }

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      await setDoc(
        doc(db, "seasons", seasonId),
        {
          endSeasonMode: true,
          finalAwards: draftAwards,
        },
        { merge: true },
      );

      setMsg("Final season awards saved.");
    } catch (e: unknown) {
      const nextErr =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to save final season awards.";
      setErr(nextErr);
    } finally {
      setBusy(false);
    }
  }, [busy, canEdit, db, draftAwards, seasonId]);

  const endSeasonAction = React.useCallback(async () => {
    if (!canEdit || busy) return;

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      await setDoc(
        doc(db, "seasons", seasonId),
        {
          endSeasonMode: true,
          finalAwards: draftAwards,
        },
        { merge: true },
      );

      setConfirmingEndSeason(false);
      setMsg("Season ended. Final award selections are now enabled.");
    } catch (e: unknown) {
      const nextErr =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to end season.";
      setErr(nextErr);
    } finally {
      setBusy(false);
    }
  }, [busy, canEdit, db, draftAwards, seasonId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>End Season</CardTitle>
        <CardSubtitle>
          Lock the season into final-awards mode and choose optional
          coach-picked season awards.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {err ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("err")}
          >
            {err}
          </div>
        ) : null}

        {msg ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("ok")}
          >
            {msg}
          </div>
        ) : null}

        {!endSeasonMode ? (
          <div
            className="rounded-2xl border p-4"
            style={{
              borderColor:
                "color-mix(in oklab, var(--stroke) 92%, transparent)",
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, var(--bg-base) 6%), var(--card))",
            }}
          >
            <div className="text-sm font-semibold">
              Ready to end the season?
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              This enables final awards. Next pass, we will use this same flag
              to hide the public lineup and switch trophy language to past
              tense.
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!confirmingEndSeason ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingEndSeason(true)}
                  disabled={!canEdit || busy}
                >
                  End Season
                </Button>
              ) : (
                <>
                  <Button onClick={endSeasonAction} disabled={!canEdit || busy}>
                    {busy ? "Ending…" : "Confirm End Season"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmingEndSeason(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {endSeasonMode ? (
          <div
            className="rounded-2xl border p-4"
            style={{
              borderColor:
                "color-mix(in oklab, var(--stroke) 92%, transparent)",
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, var(--bg-base) 6%), var(--card))",
              boxShadow:
                "0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent) inset",
            }}
          >
            <div className="mb-3">
              <div className="text-sm font-semibold">Final Coach Awards</div>
              <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Optional. Each player can receive only one final season award.
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {FINAL_AWARD_FIELDS.map((field) => (
                <Select
                  key={field.key}
                  label={field.label}
                  value={draftAwards[field.key]}
                  onChangeAction={(v) => setAwardAction(field.key, v)}
                  options={optionsForAward(field.key)}
                />
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={saveAwardsAction} disabled={!canEdit || busy}>
                {busy ? "Saving…" : "Save Final Awards"}
              </Button>
            </div>
          </div>
        ) : null}

        {!canEdit ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Sign in with an allowlisted admin account to end the season.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
