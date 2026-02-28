// app/admin/_parts/RosterBuilderTab.tsx
"use client";

import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import type { DraftPlayer } from "../adminHelpers";
import { newDraftPlayer, toastStyle } from "../adminHelpers";
import { Field } from "../adminUiHelpers";

export function RosterBuilderTab(props: {
  canEdit: boolean;
  seasonId: string;

  draft: DraftPlayer[];
  setDraftAction: React.Dispatch<React.SetStateAction<DraftPlayer[]>>;

  updateDraftRowAction: (key: string, patch: Partial<DraftPlayer>) => void;
  insertRowAfterAction: (key: string) => void;
  removeRowAction: (key: string) => void;

  rosterBusy: boolean;
  rosterMsg: string | null;
  rosterErr: string | null;
  onRebuildRosterAction: () => void;
}) {
  const {
    canEdit,
    seasonId,
    draft,
    setDraftAction,
    updateDraftRowAction,
    insertRowAfterAction,
    removeRowAction,
    rosterBusy,
    rosterMsg,
    rosterErr,
    onRebuildRosterAction,
  } = props;

  return (
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
                borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
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
                    onChangeAction={(v) => updateDraftRowAction(d.key, { name: v })}
                    placeholder="Player name"
                    disabled={!canEdit || rosterBusy}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label="Number"
                    value={d.number}
                    onChangeAction={(v) => updateDraftRowAction(d.key, { number: v })}
                    inputMode="numeric"
                    placeholder="7"
                    disabled={!canEdit || rosterBusy}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label="Primary Pos"
                    value={d.primaryPos}
                    onChangeAction={(v) => updateDraftRowAction(d.key, { primaryPos: v })}
                    placeholder="SS"
                    disabled={!canEdit || rosterBusy}
                  />
                </div>

                <div className="sm:col-span-2 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => insertRowAfterAction(d.key)}
                    disabled={!canEdit || rosterBusy}
                    title="Insert row"
                  >
                    +
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => removeRowAction(d.key)}
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
            onClick={() => setDraftAction((p) => [...p, newDraftPlayer()])}
            disabled={!canEdit || rosterBusy}
          >
            Add row
          </Button>

          <Button onClick={onRebuildRosterAction} disabled={!canEdit || rosterBusy}>
            {rosterBusy ? "Rebuilding…" : "Rebuild roster (overwrite)"}
          </Button>
        </div>

        <div className="text-xs" style={{ color: "var(--muted)" }}>
          This overwrites <code>seasons/{seasonId}/players</code>.
        </div>
      </CardContent>
    </Card>
  );
}