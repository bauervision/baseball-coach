"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { parseNumericDraft } from "@/lib/numericDraft";

import { Field } from "../adminUiHelpers";
import { toastStyle } from "../adminHelpers";
import { updateScheduledGames } from "./adminActions";

export function SeasonScheduleCard(props: {
  db: Firestore;
  seasonId: string;
  canEdit: boolean;
  scheduledGames: number;
  gamesPlayed: number;
}) {
  const { db, seasonId, canEdit, scheduledGames, gamesPlayed } = props;

  const [draft, setDraft] = React.useState(String(scheduledGames));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Follow the live season doc until the admin starts editing.
  const [lastSynced, setLastSynced] = React.useState(scheduledGames);
  if (lastSynced !== scheduledGames) {
    setLastSynced(scheduledGames);
    if (parseNumericDraft(draft) === lastSynced) setDraft(String(scheduledGames));
  }

  const dirty = parseNumericDraft(draft) !== scheduledGames;

  const onSave = async () => {
    if (!canEdit || busy) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const next = parseNumericDraft(draft);
      await updateScheduledGames({ db, seasonId, scheduledGames: next });
      setMsg(`Scheduled games set to ${next}.`);
    } catch (e: unknown) {
      setErr(
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to update scheduled games.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Season Schedule</CardTitle>
        <CardSubtitle>
          Official scheduled games for <code>{seasonId}</code>. Changing this
          never alters saved games.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
          <Field
            label="Scheduled games"
            value={draft}
            onChangeAction={setDraft}
            numeric
            disabled={!canEdit || busy}
          />
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Official games completed:{" "}
            <span style={{ color: "var(--foreground)", fontWeight: 700 }}>
              {gamesPlayed} of {scheduledGames}
            </span>{" "}
            (regular season + make-up; scrimmages excluded).
          </div>
        </div>

        {gamesPlayed > scheduledGames ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            More official games are recorded than scheduled. Check for games
            that should be classified as scrimmages, or raise the total.
          </div>
        ) : null}

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

        <div className="flex items-center justify-end gap-2">
          <Button onClick={onSave} disabled={!canEdit || busy || !dirty}>
            {busy ? "Saving…" : "Save schedule"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
