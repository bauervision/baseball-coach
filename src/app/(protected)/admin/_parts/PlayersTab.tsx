"use client";

import * as React from "react";
import type { Player } from "@/lib/roster";

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
import type { PlayerEdit } from "./usePlayerEdits";

export function PlayersTab(props: {
  canEdit: boolean;
  players: Player[] | null;

  playerEdits: Record<string, PlayerEdit>;

  setPlayerEditValueAction: (
    playerId: string,
    patch: Partial<{
      name: string;
      number: string;
      shirtSize: string;
      leaderboardHidden: boolean;
      returningPlayer: boolean;
    }>,
  ) => void;

  dirtyPlayersCount: number;
  playerBusy: boolean;
  playerMsg: string | null;
  playerErr: string | null;
  onSavePlayerEditsAction: () => void;
  onRemovePlayerAction: (playerId: string, confirmName: string) => Promise<void>;
}) {
  const {
    canEdit,
    players,
    playerEdits,
    setPlayerEditValueAction,
    dirtyPlayersCount,
    playerBusy,
    playerMsg,
    playerErr,
    onSavePlayerEditsAction,
    onRemovePlayerAction,
  } = props;

  const SHIRT_SIZES = [
    "",
    "YXS",
    "YS",
    "YM",
    "YL",
    "YXL",
    "AS",
    "AM",
    "AL",
    "AXL",
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player Update</CardTitle>
        <CardSubtitle>
          Edit player name, number, shirt size, and leaderboard visibility.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {!canEdit ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Sign in and ensure your uid is allowlisted to edit players.
          </div>
        ) : null}

        {playerErr ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("err")}
          >
            {playerErr}
          </div>
        ) : null}

        {playerMsg ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("ok")}
          >
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
                  shirtSize: String(p.shirtSize ?? ""),
                  leaderboardHidden: p.leaderboardHidden === true,
                  returningPlayer: p.returningPlayer === true,
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
                      <div className="sm:col-span-4">
                        <Field
                          label="Name"
                          value={edit.name}
                          onChangeAction={(v) =>
                            setPlayerEditValueAction(p.id, { name: v })
                          }
                          disabled={!canEdit || playerBusy}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <Field
                          label="Number"
                          value={edit.number}
                          onChangeAction={(v) =>
                            setPlayerEditValueAction(p.id, { number: v })
                          }
                          numeric
                          allowEmpty
                          disabled={!canEdit || playerBusy}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          className="flex h-10 items-center gap-2 rounded-xl border px-3 text-xs"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 92%, transparent)",
                            background:
                              "color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%)",
                            color: "var(--foreground)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={edit.returningPlayer}
                            onChange={(e) =>
                              setPlayerEditValueAction(p.id, {
                                returningPlayer: e.target.checked,
                              })
                            }
                            disabled={!canEdit || playerBusy}
                          />
                          <span title="Display only. Career links are made when importing returning players in Roster Builder.">
                            Returning player
                          </span>
                        </label>
                      </div>

                      <div className="sm:col-span-2">
                        <div className="grid gap-1">
                          <div
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            Shirt size
                          </div>

                          <select
                            value={edit.shirtSize}
                            onChange={(e) =>
                              setPlayerEditValueAction(p.id, {
                                shirtSize: e.target.value,
                              })
                            }
                            disabled={!canEdit || playerBusy}
                            className="h-10 w-full rounded-xl border px-3 text-sm outline-none"
                            style={{
                              borderColor:
                                "color-mix(in oklab, var(--stroke) 92%, transparent)",
                              background:
                                "color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%)",
                              color: "var(--foreground)",
                            }}
                          >
                            {SHIRT_SIZES.map((s) => (
                              <option
                                key={s}
                                value={s}
                                style={{ color: "#000" }}
                              >
                                {s === "" ? "Select…" : s}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          className="flex h-10 items-center gap-2 rounded-xl border px-3 text-xs"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 92%, transparent)",
                            background:
                              "color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%)",
                            color: "var(--foreground)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={edit.leaderboardHidden}
                            onChange={(e) =>
                              setPlayerEditValueAction(p.id, {
                                leaderboardHidden: e.target.checked,
                              })
                            }
                            disabled={!canEdit || playerBusy}
                          />
                          Hide leaders
                        </label>
                      </div>

                      <div className="sm:col-span-12 flex items-center justify-between gap-2">
                        <div
                          className="text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          {edit.leaderboardHidden
                            ? "This player still appears on the roster, but is excluded from leaderboard leader calculations."
                            : "This player is included in leaderboard leader calculations."}
                        </div>

                        <div className="flex items-center gap-3">
                          <RemovePlayerControl
                            name={p.name}
                            disabled={!canEdit || playerBusy}
                            onRemoveAction={(confirmName) =>
                              onRemovePlayerAction(p.id, confirmName)
                            }
                          />
                          <div
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            {edit.dirty ? "Edited" : "Saved"}
                          </div>
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
  );
}

/**
 * Removing a roster entry is the only destructive roster action. It needs
 * the player's name typed exactly, and the action itself refuses players with
 * any game or recognition history.
 */
function RemovePlayerControl(props: {
  name: string;
  disabled: boolean;
  onRemoveAction: (confirmName: string) => Promise<void>;
}) {
  const { name, disabled, onRemoveAction } = props;
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const inputId = React.useId();

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs underline disabled:opacity-60"
        style={{ color: "var(--muted)" }}
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setTyped("");
          setErr(null);
        }}
      >
        Remove from roster…
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Remove ${name} from roster`}
      className="flex flex-wrap items-center gap-2 rounded-xl border px-2 py-1 text-xs"
      style={toastStyle("err")}
    >
      <label htmlFor={inputId}>
        Only for players added by mistake. Type <strong>{name}</strong> to
        confirm:
      </label>
      <input
        id={inputId}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="h-8 rounded-lg border px-2 text-xs"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
          color: "var(--foreground)",
        }}
        autoComplete="off"
        disabled={busy}
      />
      <Button
        variant="danger"
        size="sm"
        disabled={busy || typed.trim() !== name}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await onRemoveAction(typed);
          } catch (e: unknown) {
            setErr(
              e && typeof e === "object" && "message" in e
                ? String((e as { message?: unknown }).message)
                : "Could not remove player.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : "Remove"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
      {err ? (
        <span role="alert" className="basis-full">
          {err}
        </span>
      ) : null}
    </div>
  );
}
