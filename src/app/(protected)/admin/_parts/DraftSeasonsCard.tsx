"use client";

// Season Update → Draft seasons: delete an unused draft (abandoned setup).
// Only drafts that are not current are listed; deletion itself re-checks
// eligibility under a rules-enforced lock (deleteDraftSeason).

import * as React from "react";
import { collection, getDocs, type Firestore } from "firebase/firestore";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { SeasonSummary } from "@/lib/seasonStore";
import { toastStyle } from "../adminHelpers";
import { deleteDraftSeason, DraftNotDeletableError } from "./adminActions";

export function DraftSeasonsCard(props: {
  db: Firestore;
  uid: string | null;
  canEdit: boolean;
  seasons: SeasonSummary[] | null;
  currentSeasonId: string;
  onDeletedAction: () => void;
}) {
  const { db, uid, canEdit, seasons, currentSeasonId } = props;
  const drafts = (seasons ?? []).filter(
    (s) => (s.status === "draft" || s.status === "deleting") && s.seasonId !== currentSeasonId,
  );
  const [confirming, setConfirming] = React.useState<SeasonSummary | null>(null);
  const [rosterCount, setRosterCount] = React.useState<number | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function open(s: SeasonSummary) {
    setConfirming(s);
    setTyped("");
    setMsg(null);
    setRosterCount(null);
    try {
      setRosterCount((await getDocs(collection(db, "seasons", s.seasonId, "players"))).size);
    } catch {
      setRosterCount(null);
    }
  }

  async function run() {
    if (!confirming || !uid || busy) return;
    setBusy(true);
    setMsg(null);
    const s = confirming;
    try {
      const res = await deleteDraftSeason({ db, uid, seasonId: s.seasonId });
      setConfirming(null);
      setMsg({
        kind: "ok",
        text:
          res.outcome === "deleted"
            ? `Deleted the ${s.teamName} ${s.seasonLabel} draft and ${res.removedPlayers} draft roster ${res.removedPlayers === 1 ? "entry" : "entries"}.`
            : `The ${s.teamName} ${s.seasonLabel} draft was already deleted.`,
      });
      props.onDeletedAction();
    } catch (e: unknown) {
      setMsg({
        kind: "err",
        text:
          e instanceof DraftNotDeletableError
            ? `${s.seasonLabel} was not deleted: ${e.reasons.join(" ")}`
            : `${s.seasonLabel} was not deleted: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft seasons</CardTitle>
        <CardSubtitle>
          Delete a draft left over from setup. Only unused drafts that are not current can be deleted; active, finalized,
          and earlier seasons are always kept.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {seasons === null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Loading seasons…
          </div>
        ) : drafts.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No draft seasons.
          </div>
        ) : (
          <ul className="grid gap-2" aria-label="Draft seasons">
            {drafts.map((s) => (
              <li
                key={s.seasonId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
                style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)" }}
              >
                <span className="min-w-0 text-sm">
                  <strong>{s.teamName}</strong> · {s.seasonLabel}{" "}
                  <span style={{ color: "var(--muted)" }}>
                    · {s.status === "deleting" ? "Deletion interrupted" : "Draft"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit || busy}
                  aria-label={`Delete draft ${s.teamName} ${s.seasonLabel}`}
                  onClick={() => void open(s)}
                >
                  {s.status === "deleting" ? "Finish deleting…" : "Delete draft…"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="draft-delete-title"
            aria-describedby="draft-delete-desc"
            className="grid gap-2 rounded-xl border px-3 py-3 text-sm"
            style={toastStyle("err")}
          >
            <div id="draft-delete-title" className="font-semibold">
              Delete {confirming.teamName} · {confirming.seasonLabel} (draft)?
            </div>
            <p id="draft-delete-desc">
              This removes the draft season and its{" "}
              {rosterCount === null ? "draft roster entries" : `${rosterCount} draft roster ${rosterCount === 1 ? "entry" : "entries"}`}
              . Earlier seasons, permanent player identities, linked children, and the {confirming.teamName} team are not
              changed. This cannot be undone.
            </p>
            <label className="grid gap-1 text-xs font-semibold">
              Type “{confirming.seasonLabel}” to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="h-9 rounded-lg border px-2 text-sm font-normal"
                style={{ borderColor: "var(--stroke)", background: "var(--bg-base)", color: "var(--foreground)" }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={busy || typed.trim() !== confirming.seasonLabel}
                onClick={() => void run()}
              >
                {busy ? "Deleting…" : "Delete draft season"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {msg ? (
          <div role="status" className="rounded-xl border px-3 py-2 text-xs" style={toastStyle(msg.kind)}>
            {msg.text}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
