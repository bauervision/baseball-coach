// app/admin/_parts/SeasonLifecycleCard.tsx
"use client";

import * as React from "react";
import {
  collection,
  getCountFromServer,
  type Firestore,
} from "firebase/firestore";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { SeasonSummary } from "@/lib/seasonStore";
import {
  finalizationChecklist,
  seasonTag,
  type LifecycleEvent,
} from "@/lib/seasonLifecycle";
import { toastStyle } from "../adminHelpers";
import { finalizeSeason, reopenSeason } from "./adminActions";
import { SELECT_CLASS, SELECT_STYLE, seasonOptionLabel } from "./SeasonTab";

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function eventText(e: LifecycleEvent): string {
  const when = e.at ? new Date(e.at).toLocaleDateString() : "";
  const verb =
    e.action === "finalized" ? "Finalized" : e.action === "reopened" ? "Reopened" : "Activated";
  return `${verb} ${when}`;
}

/**
 * Finalize / reopen a season. Finalizing makes the season read-only for
 * everyone (Firestore rules), without touching its record, stats, or
 * awards. Reopening makes it editable again but never makes it current.
 */
export function SeasonLifecycleCard(props: {
  db: Firestore;
  uid: string | null;
  canEdit: boolean;
  seasons: SeasonSummary[] | null;
  currentSeasonId: string;
  onChangedAction: () => void;
}) {
  const { db, uid, canEdit, seasons, currentSeasonId, onChangedAction } = props;
  const [picked, setPicked] = React.useState("");
  const seasonId = picked || currentSeasonId;
  const season = seasons?.find((s) => s.seasonId === seasonId) ?? null;
  const finalized = season?.status === "finalized";

  const [rosterSize, setRosterSize] = React.useState<number | null>(null);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = React.useState(false);
  const [understood, setUnderstood] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setChecked({});
    setConfirming(false);
    setUnderstood(false);
    setRosterSize(null);
    if (!seasonId) return;
    let active = true;
    getCountFromServer(collection(db, "seasons", seasonId, "players"))
      .then((c) => {
        if (active) setRosterSize(c.data().count);
      })
      .catch(() => {
        if (active) setRosterSize(null);
      });
    return () => {
      active = false;
    };
  }, [db, seasonId, finalized]);

  const items = season
    ? finalizationChecklist({
        seasonLabel: season.seasonLabel,
        teamName: season.teamName,
        officialGames:
          season.gamesPlayed ||
          season.record.wins + season.record.losses + (season.record.ties ?? 0),
        record: season.record,
        rosterSize: rosterSize ?? 0,
        finalAwardsChosen: season.finalAwardsChosen,
        layoutsSaved: season.layoutsSaved,
      })
    : [];
  const allChecked = items.length > 0 && items.every((i) => checked[i.key]);
  const disabled = !canEdit || busy || !season;
  const name = season ? `${season.seasonLabel} — ${season.teamName}` : "";

  async function run(action: "finalize" | "reopen") {
    if (!uid || !season) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (action === "finalize") {
        const res = await finalizeSeason({ db, uid, seasonId });
        setMsg(
          res.alreadyFinalized
            ? `${name} was already finalized. Nothing changed.`
            : `${name} is finalized and read-only. Its record, stats, and awards were not changed.`,
        );
      } else {
        await reopenSeason({ db, uid, seasonId });
        setMsg(
          `${name} is reopened and editable. It was not made the current season.`,
        );
      }
      setConfirming(false);
      setUnderstood(false);
      onChangedAction();
    } catch (e: unknown) {
      setErr(errorText(e, `Could not ${action} the season.`));
    } finally {
      setBusy(false);
    }
  }

  const tag = season
    ? seasonTag({
        status: season.status,
        isCurrent: season.seasonId === currentSeasonId,
        endSeasonMode: season.endSeasonMode,
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Season Lifecycle</CardTitle>
        <CardSubtitle>
          Finalize a completed season to protect it. Parents can still view
          and print it.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1">
            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Season
            </span>
            <select
              aria-label="Season to finalize or reopen"
              className={SELECT_CLASS}
              style={SELECT_STYLE}
              value={seasonId}
              onChange={(e) => setPicked(e.target.value)}
              disabled={!canEdit || busy || seasons === null}
            >
              {(seasons ?? []).map((s) => (
                <option key={s.seasonId} value={s.seasonId}>
                  {seasonOptionLabel(s)}
                  {s.status === "finalized" ? " — final" : s.seasonId === currentSeasonId ? " — current" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm" aria-live="polite">
            Status:{" "}
            <strong>
              {finalized
                ? "Finalized (read-only)"
                : season?.status === "draft"
                  ? "Draft"
                  : season?.status === "active"
                    ? "Open"
                    : "Open (not yet finalized)"}
            </strong>
            {tag && tag !== "Final" ? ` · ${tag}` : ""}
          </div>
        </div>

        {season && !finalized ? (
          <fieldset className="grid gap-1" disabled={disabled}>
            <legend className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Before finalizing, confirm:
            </legend>
            {items.map((i) => (
              <label key={i.key} className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={!!checked[i.key]}
                  onChange={(e) => setChecked((c) => ({ ...c, [i.key]: e.target.checked }))}
                />
                <span>{i.label}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  — {i.fact}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {season && finalized ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Games, roster, stats, lineups, awards, and recognition layouts are
            locked. Reopening makes them editable again; it does not change
            the current season.
          </div>
        ) : null}

        {confirming && season ? (
          <div
            role="alertdialog"
            aria-labelledby="lifecycle-confirm"
            className="grid gap-2 rounded-xl border px-3 py-2 text-sm"
            style={toastStyle(finalized ? "err" : "ok")}
          >
            <div id="lifecycle-confirm">
              {finalized
                ? `Reopen ${name}? Its historical records become editable again until it is finalized again.`
                : `Finalize ${name}? It becomes read-only for everyone, including you, until reopened.`}
            </div>
            {finalized ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                I understand this season&rsquo;s records will be editable.
              </label>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={finalized ? "danger" : "primary"}
                disabled={busy || (finalized && !understood)}
                onClick={() => run(finalized ? "reopen" : "finalize")}
              >
                {busy ? "Saving…" : finalized ? "Reopen season" : "Finalize season"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {season?.lifecycleHistory.length
                ? `History: ${season.lifecycleHistory.slice(-3).map(eventText).join(" · ")}`
                : "No lifecycle history yet."}
            </div>
            <Button
              variant={finalized ? "secondary" : "primary"}
              disabled={disabled || (!finalized && !allChecked)}
              onClick={() => setConfirming(true)}
            >
              {finalized ? "Reopen season…" : "Finalize season…"}
            </Button>
          </div>
        )}

        <div aria-live="polite" className="grid gap-2">
          {err ? (
            <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
              {err}
            </div>
          ) : null}
          {msg ? (
            <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
              {msg}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
