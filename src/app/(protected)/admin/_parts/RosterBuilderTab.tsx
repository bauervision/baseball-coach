// app/admin/_parts/RosterBuilderTab.tsx
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

import { toastStyle } from "../adminHelpers";
import { Field } from "../adminUiHelpers";
import type { SeasonSummary } from "@/lib/seasonStore";
import { SELECT_CLASS, SELECT_STYLE, seasonOptionLabel } from "./SeasonTab";
import type { useRosterDraft } from "./useRosterDraft";

const SHIRT_SIZES = ["", "YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL"];

const ROW_STYLE: React.CSSProperties = {
  borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
};

function ShirtSelect(props: {
  value: string;
  onChangeAction: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        Shirt
      </span>
      <select
        aria-label="Shirt size"
        className={SELECT_CLASS}
        style={SELECT_STYLE}
        value={props.value}
        onChange={(e) => props.onChangeAction(e.target.value)}
        disabled={props.disabled}
      >
        {SHIRT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s || "—"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RosterBuilderTab(props: {
  canEdit: boolean;
  seasons: SeasonSummary[] | null;
  roster: ReturnType<typeof useRosterDraft>;
}) {
  const { canEdit, seasons, roster } = props;
  const disabled = !canEdit || roster.rosterBusy;
  const target = seasons?.find((s) => s.seasonId === roster.targetSeasonId);
  const picks = Object.values(roster.picks);
  const rosterCount = roster.targetRoster?.players.length ?? 0;
  const searchId = React.useId();
  const resultsId = React.useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster Builder</CardTitle>
        <CardSubtitle>
          Add returning and new players to a season. Adding never removes
          anyone or changes past seasons.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {!canEdit ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Sign in and ensure your uid is allowlisted to build rosters.
          </div>
        ) : null}

        <label className="grid gap-1 sm:max-w-md">
          <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Season roster
          </span>
          <select
            aria-label="Season roster"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
            value={roster.targetSeasonId}
            onChange={(e) => roster.setTargetSeasonId(e.target.value)}
            disabled={disabled || seasons === null}
          >
            {seasons === null ? (
              <option value={roster.targetSeasonId}>Loading seasons…</option>
            ) : null}
            {(seasons ?? []).map((s) => (
              <option key={s.seasonId} value={s.seasonId}>
                {seasonOptionLabel(s)}
              </option>
            ))}
          </select>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {rosterCount} player{rosterCount === 1 ? "" : "s"} on this roster now.
          </span>
        </label>

        <section aria-labelledby={`${searchId}-h`} className="grid gap-2">
          <h3 id={`${searchId}-h`} className="text-sm font-semibold">
            Import returning players?
          </h3>
          <label htmlFor={searchId} className="sr-only">
            Search players you have coached
          </label>
          <input
            id={searchId}
            type="search"
            autoComplete="off"
            placeholder="Search players you have coached"
            value={roster.searchQuery}
            onChange={(e) => roster.setSearchQuery(e.target.value)}
            aria-controls={resultsId}
            disabled={disabled}
            className={SELECT_CLASS}
            style={SELECT_STYLE}
          />
          <div className="sr-only" aria-live="polite">
            {roster.candidatesLoading
              ? "Loading players"
              : `${roster.results.length} players found`}
          </div>
          <ul
            id={resultsId}
            aria-label="Returning player results"
            className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-1"
            style={ROW_STYLE}
          >
            {roster.candidatesLoading ? (
              <li className="p-2 text-sm" style={{ color: "var(--muted)" }}>
                Loading previous rosters…
              </li>
            ) : roster.results.length === 0 ? (
              <li className="p-2 text-sm" style={{ color: "var(--muted)" }}>
                {roster.searchQuery
                  ? "No matching players. Add them as a new player below."
                  : "No previous players yet."}
              </li>
            ) : (
              roster.results.map((r) => {
                const already = roster.isOnRoster(r);
                const checked = !!roster.picks[r.key];
                const latest = r.seasons[0];
                const seasonCount = r.seasons.length;
                return (
                  <li key={r.key}>
                    <label
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
                      style={{ opacity: already ? 0.6 : 1 }}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                        checked={checked || already}
                        disabled={disabled || already}
                        onChange={() => roster.togglePick(r)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{r.displayName}</span>
                        {r.linkedChild ? (
                          <span
                            className="ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                            style={{
                              borderColor:
                                "color-mix(in oklab, var(--secondary) 60%, transparent)",
                            }}
                          >
                            My player
                          </span>
                        ) : null}
                        <span
                          className="block truncate text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          {latest
                            ? `${latest.number > 0 ? `#${latest.number} · ` : ""}${latest.teamName} ${latest.seasonLabel}`
                            : "No confirmed seasons yet"}
                          {seasonCount > 0
                            ? ` · ${seasonCount} season${seasonCount === 1 ? "" : "s"}`
                            : ""}
                          {r.disambiguation && seasonCount > 1
                            ? ` · also ${r.seasons
                                .slice(1)
                                .map((s) => s.seasonLabel)
                                .join(", ")}`
                            : ""}
                          {already ? " · already on roster" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {picks.length > 0 ? (
          <section aria-label="Selected returning players" className="grid gap-2">
            <h3 className="text-sm font-semibold">
              Selected ({picks.length}) — set this season&rsquo;s details
            </h3>
            {picks.map((p) => (
              <div
                key={p.candidate.key}
                className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-12 sm:items-end"
                style={ROW_STYLE}
              >
                <div className="text-sm font-semibold sm:col-span-4 sm:self-center">
                  {p.candidate.displayName}
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Number"
                    value={p.number}
                    onChangeAction={(v) =>
                      roster.updatePick(p.candidate.key, { number: v })
                    }
                    numeric
                    allowEmpty
                    disabled={disabled}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Position"
                    value={p.primaryPos}
                    onChangeAction={(v) =>
                      roster.updatePick(p.candidate.key, { primaryPos: v })
                    }
                    placeholder="SS"
                    disabled={disabled}
                  />
                </div>
                <div className="sm:col-span-2">
                  <ShirtSelect
                    value={p.shirtSize}
                    onChangeAction={(v) =>
                      roster.updatePick(p.candidate.key, { shirtSize: v })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    onClick={() => roster.togglePick(p.candidate)}
                    disabled={disabled}
                    aria-label={`Deselect ${p.candidate.displayName}`}
                  >
                    Deselect
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section aria-label="New players" className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">New players</h3>
            <Button variant="secondary" onClick={roster.addDraftRow} disabled={disabled}>
              Add new player
            </Button>
          </div>
          {roster.draft.map((d) => (
            <div
              key={d.key}
              className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-12 sm:items-end"
              style={ROW_STYLE}
            >
              <div className="sm:col-span-4">
                <Field
                  label="Name"
                  value={d.name}
                  onChangeAction={(v) => roster.updateDraftRow(d.key, { name: v })}
                  placeholder="Player name"
                  disabled={disabled}
                />
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Number"
                  value={d.number}
                  onChangeAction={(v) => roster.updateDraftRow(d.key, { number: v })}
                  numeric
                  allowEmpty
                  placeholder="7"
                  disabled={disabled}
                />
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Position"
                  value={d.primaryPos}
                  onChangeAction={(v) =>
                    roster.updateDraftRow(d.key, { primaryPos: v })
                  }
                  placeholder="SS"
                  disabled={disabled}
                />
              </div>
              <div className="sm:col-span-2">
                <ShirtSelect
                  value={d.shirtSize}
                  onChangeAction={(v) => roster.updateDraftRow(d.key, { shirtSize: v })}
                  disabled={disabled}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  variant="ghost"
                  onClick={() => roster.removeDraftRow(d.key)}
                  disabled={disabled}
                  aria-label={`Remove row ${d.name || "new player"}`}
                >
                  Remove row
                </Button>
              </div>
            </div>
          ))}
        </section>

        <div aria-live="polite" className="grid gap-2">
          {roster.rosterErr ? (
            <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
              {roster.rosterErr}
            </div>
          ) : null}
          {roster.rosterMsg ? (
            <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
              {roster.rosterMsg}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            New season stats start at zero. Career history is kept.
          </span>
          <Button
            onClick={roster.onAddPlayersAction}
            disabled={disabled || roster.pendingCount === 0}
          >
            {roster.rosterBusy
              ? "Adding…"
              : `Add ${roster.pendingCount || ""} to ${target?.seasonLabel ?? "roster"}`.replace(
                  "  ",
                  " ",
                )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
