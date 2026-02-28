// app/admin/_parts/SeasonTab.tsx
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { Field } from "../adminUiHelpers";
import { toastStyle } from "../adminHelpers";

export function SeasonTab(props: {
  canEdit: boolean;

  seasonEditId: string;
  setSeasonEditIdAction: (v: string) => void;

  seasonTeamName: string;
  setSeasonTeamNameAction: (v: string) => void;

  seasonLabel: string;
  setSeasonLabelAction: (v: string) => void;

  teamNamePlaceholder: string;

  seasonBusy: boolean;
  seasonMsg: string | null;
  seasonErr: string | null;
  onSwitchSeasonAction: () => void;
}) {
  const {
    canEdit,
    seasonEditId,
    setSeasonEditIdAction,
    seasonTeamName,
    setSeasonTeamNameAction,
    seasonLabel,
    setSeasonLabelAction,
    teamNamePlaceholder,
    seasonBusy,
    seasonMsg,
    seasonErr,
    onSwitchSeasonAction,
  } = props;

  return (
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
            onChangeAction={setSeasonEditIdAction}
            placeholder="tigers-2027"
            disabled={!canEdit || seasonBusy}
          />
          <Field
            label="Team name"
            value={seasonTeamName}
            onChangeAction={setSeasonTeamNameAction}
            placeholder={teamNamePlaceholder || "Team"}
            disabled={!canEdit || seasonBusy}
          />
          <Field
            label="Season label"
            value={seasonLabel}
            onChangeAction={setSeasonLabelAction}
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
          <Button onClick={onSwitchSeasonAction} disabled={!canEdit || seasonBusy}>
            {seasonBusy ? "Updating…" : "Set current season"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}