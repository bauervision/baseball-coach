// app/admin/_parts/SeasonTab.tsx
"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { Field } from "../adminUiHelpers";
import { toastStyle } from "../adminHelpers";
import type { SeasonSummary } from "@/lib/seasonStore";
import { validateNewSeasonId } from "@/lib/rosterPlanning";

export const SELECT_CLASS =
  "h-10 w-full min-w-0 rounded-xl border px-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed";
export const SELECT_STYLE: React.CSSProperties = {
  borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
  background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
  color: "var(--foreground)",
};

export function seasonOptionLabel(s: SeasonSummary): string {
  return `${s.teamName} · ${s.seasonLabel} (${s.seasonId})`;
}

export function SeasonTab(props: {
  canEdit: boolean;
  currentSeasonId: string;
  seasons: SeasonSummary[] | null;

  seasonEditId: string;
  setSeasonEditIdAction: (v: string) => void;
  seasonTeamName: string;
  setSeasonTeamNameAction: (v: string) => void;
  seasonTeamId: string;
  setSeasonTeamIdAction: (v: string) => void;
  seasonLabel: string;
  setSeasonLabelAction: (v: string) => void;
  usesGamesPlayedRecord: boolean;
  setUsesGamesPlayedRecordAction: (v: boolean) => void;
  scheduledGames: string;
  setScheduledGamesAction: (v: string) => void;
  makeCurrentAfterCreate: boolean;
  setMakeCurrentAfterCreateAction: (v: boolean) => void;
  selectedCurrentId: string;
  setSelectedCurrentIdAction: (v: string) => void;

  teamNamePlaceholder: string;

  seasonBusy: boolean;
  seasonMsg: string | null;
  seasonErr: string | null;
  onCreateSeasonAction: () => void;
  onMakeCurrentAction: () => void;
}) {
  const {
    canEdit,
    currentSeasonId,
    seasons,
    seasonEditId,
    seasonBusy,
    selectedCurrentId,
  } = props;

  const existingIds = (seasons ?? []).map((s) => s.seasonId);
  const idCheck = seasonEditId.trim()
    ? validateNewSeasonId(seasonEditId, existingIds)
    : null;
  const pickedId = selectedCurrentId || currentSeasonId;
  const disabled = !canEdit || seasonBusy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasons</CardTitle>
        <CardSubtitle>
          Creating a season never changes an existing one. Making a season
          current only changes which season the app shows.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {!canEdit ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Sign in and ensure your uid is allowlisted to edit season settings.
          </div>
        ) : null}

        <section aria-labelledby="make-current-heading" className="grid gap-2">
          <h3 id="make-current-heading" className="text-sm font-semibold">
            Make current season
          </h3>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1">
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--muted)" }}
              >
                Season
              </span>
              <select
                aria-label="Season to make current"
                className={SELECT_CLASS}
                style={SELECT_STYLE}
                value={pickedId}
                onChange={(e) =>
                  props.setSelectedCurrentIdAction(e.target.value)
                }
                disabled={disabled || seasons === null}
              >
                {seasons === null ? (
                  <option value={currentSeasonId}>Loading seasons…</option>
                ) : null}
                {(seasons ?? []).map((s) => (
                  <option
                    key={s.seasonId}
                    value={s.seasonId}
                    disabled={s.status === "finalized" && s.seasonId !== currentSeasonId}
                  >
                    {seasonOptionLabel(s)}
                    {s.seasonId === currentSeasonId
                      ? " — current"
                      : s.status === "finalized"
                        ? " — final (reopen to use)"
                        : s.status === "draft"
                          ? " — draft"
                          : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={props.onMakeCurrentAction}
              disabled={disabled || pickedId === currentSeasonId}
            >
              Make current
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="create-season-heading"
          className="grid gap-2 border-t pt-4"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 70%, transparent)",
          }}
        >
          <h3 id="create-season-heading" className="text-sm font-semibold">
            Create season
          </h3>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field
              label="New season id"
              value={seasonEditId}
              onChangeAction={props.setSeasonEditIdAction}
              placeholder="tigers-spring-2027"
              disabled={disabled}
            />
            <Field
              label="Team name"
              value={props.seasonTeamName}
              onChangeAction={props.setSeasonTeamNameAction}
              placeholder={props.teamNamePlaceholder || "Team"}
              disabled={disabled}
            />
            <Field
              label="Team id (optional)"
              value={props.seasonTeamId}
              onChangeAction={props.setSeasonTeamIdAction}
              placeholder="tigers"
              disabled={disabled}
            />
            <Field
              label="Season label"
              value={props.seasonLabel}
              onChangeAction={props.setSeasonLabelAction}
              placeholder="Spring 2027"
              disabled={disabled}
            />
          </div>
          {idCheck && !idCheck.ok ? (
            <div className="text-xs" role="status" style={{ color: "var(--accent)" }}>
              {idCheck.error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_180px] sm:items-end">
            <div className="grid gap-1">
              <label className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={props.usesGamesPlayedRecord}
                  onChange={(event) =>
                    props.setUsesGamesPlayedRecordAction(event.target.checked)
                  }
                  disabled={disabled}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span>Display games played instead of W-L record</span>
              </label>
              <label className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={props.makeCurrentAfterCreate}
                  onChange={(event) =>
                    props.setMakeCurrentAfterCreateAction(event.target.checked)
                  }
                  disabled={disabled}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span>Make it the current season after creating</span>
              </label>
            </div>
            <Field
              label="Scheduled games"
              value={props.scheduledGames}
              onChangeAction={props.setScheduledGamesAction}
              numeric
              placeholder="10"
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={props.onCreateSeasonAction}
              disabled={disabled || !idCheck || !idCheck.ok}
            >
              {seasonBusy ? "Saving…" : "Create season"}
            </Button>
          </div>
        </section>

        <div aria-live="polite" className="grid gap-2">
          {props.seasonErr ? (
            <div
              className="rounded-xl border px-3 py-2 text-xs"
              style={toastStyle("err")}
            >
              {props.seasonErr}
            </div>
          ) : null}
          {props.seasonMsg ? (
            <div
              className="rounded-xl border px-3 py-2 text-xs"
              style={toastStyle("ok")}
            >
              {props.seasonMsg}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
