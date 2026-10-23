// app/admin/_parts/TeamDesignerTab.tsx
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
import {
  BUNDLED_LOGOS,
  PALETTE_LABELS,
  SPORTS,
  contrastWarnings,
  isSupportedSport,
  isValidColor,
  newTeamId,
  newTeamTemplate,
  parseColor,
  sameBranding,
  snapshotFromTeam,
  validateBranding,
  type Team,
} from "@/lib/branding";
import { AWARD_COLLECTIONS, isCollectionSelectable } from "@/lib/awardCollections";
import { TOKEN_KEYS, type ThemeMode, type ThemeTokens } from "@/lib/themeTokens";
import type { SeasonSummary } from "@/lib/seasonStore";
import {
  applyTeamBrandingToSeason,
  createTeam,
  updateTeam,
} from "@/lib/teamStore";
import { toastStyle } from "../adminHelpers";
import { SELECT_CLASS, SELECT_STYLE } from "./SeasonTab";
import { TeamBrandingPreview } from "./TeamBrandingPreview";

export const DISCARD_TEAM_PROMPT = "Discard your unsaved team changes?";

type Section = "identity" | "appearance" | "seasons";
type Draft = Team; // teamId "" while new

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function pickerHex(value: string): string {
  const c = parseColor(value);
  if (!c) return "#000000";
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-xl border px-3 text-sm disabled:opacity-60";

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChangeAction: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={props.label} className="inline-flex rounded-xl border p-0.5" style={{ borderColor: "var(--stroke)" }}>
      {props.options.map(([v, text]) => {
        const on = v === props.value;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => props.onChangeAction(v)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: on ? "linear-gradient(90deg, var(--primary), var(--secondary))" : "transparent",
              color: on ? "rgba(0,0,0,0.92)" : "var(--muted)",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function Tile(props: {
  selected: boolean;
  disabled?: boolean;
  onClickAction: () => void;
  label: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      aria-disabled={props.disabled || undefined}
      disabled={props.disabled}
      onClick={props.onClickAction}
      className="grid min-h-11 justify-items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed"
      style={{
        borderColor: props.selected
          ? "color-mix(in oklab, var(--secondary) 75%, transparent)"
          : "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: props.selected
          ? "color-mix(in oklab, var(--primary) 14%, var(--card))"
          : "color-mix(in oklab, var(--bg-base) 55%, transparent)",
        opacity: props.disabled ? 0.55 : 1,
      }}
    >
      {props.children}
      <span>{props.label}</span>
      {props.note ? (
        <span className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>
          {props.note}
        </span>
      ) : null}
    </button>
  );
}

export function TeamDesignerTab(props: {
  db: Firestore;
  canEdit: boolean;
  teams: Team[] | null;
  seasons: SeasonSummary[] | null;
  onTeamsChangedAction: () => void;
  onSeasonsChangedAction: () => void;
  onDirtyChangeAction: (dirty: boolean) => void;
}) {
  const { db, canEdit, teams, seasons, onTeamsChangedAction, onSeasonsChangedAction, onDirtyChangeAction } = props;

  const [selectedId, setSelectedId] = React.useState<string>("");
  const [saved, setSaved] = React.useState<Draft>(() => newTeamTemplate());
  const [draft, setDraft] = React.useState<Draft>(() => newTeamTemplate());
  const [section, setSection] = React.useState<Section>("identity");
  const [mode, setMode] = React.useState<ThemeMode>("dark");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const dirty = !sameBranding(draft, saved);
  const errors = validateBranding(draft);
  const valid = Object.keys(errors).length === 0;
  const isNew = !draft.teamId;
  const disabled = !canEdit || busy;

  React.useEffect(() => onDirtyChangeAction(dirty), [dirty, onDirtyChangeAction]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // First load: open the first team, or a new-team draft when none exist.
  React.useEffect(() => {
    if (teams === null || selectedId) return;
    const first = teams[0];
    const start = first ? structuredClone(first) : newTeamTemplate();
    setSelectedId(first ? first.teamId : "new");
    setSaved(start);
    setDraft(structuredClone(start));
  }, [teams, selectedId]);

  function select(id: string) {
    if (id === selectedId) return;
    if (dirty && !window.confirm(DISCARD_TEAM_PROMPT)) return;
    const team = teams?.find((t) => t.teamId === id);
    const start = team ? structuredClone(team) : newTeamTemplate();
    setSelectedId(team ? team.teamId : "new");
    setSaved(start);
    setDraft(structuredClone(start));
    setMsg(null);
    setErr(null);
  }

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function setColor(key: keyof ThemeTokens, value: string) {
    setDraft((d) => ({
      ...d,
      palettes: { ...d.palettes, [mode]: { ...d.palettes[mode], [key]: value } },
    }));
  }

  function resetPalette(which: ThemeMode) {
    setDraft((d) => ({
      ...d,
      palettes: { ...d.palettes, [which]: { ...saved.palettes[which] } },
    }));
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const team: Team = { ...draft, teamId: draft.teamId || newTeamId(draft.teamName) };
      if (isNew) await createTeam(db, team);
      else await updateTeam(db, team);
      setSaved(structuredClone(team));
      setDraft(structuredClone(team));
      setSelectedId(team.teamId);
      setMsg(
        isNew
          ? `${team.teamName} created. Create a season for it under Season Update.`
          : `${team.teamName} saved. Existing seasons keep their own branding until you apply it.`,
      );
      onTeamsChangedAction();
    } catch (e: unknown) {
      setErr(errorText(e, "Could not save the team."));
    } finally {
      setBusy(false);
    }
  }

  async function applyToSeason(seasonId: string) {
    if (dirty || isNew) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await applyTeamBrandingToSeason({ db, seasonId, team: saved });
      setMsg(`Applied ${saved.teamName} branding to ${seasonId}.`);
      onSeasonsChangedAction();
    } catch (e: unknown) {
      setErr(errorText(e, "Could not apply branding."));
    } finally {
      setBusy(false);
    }
  }

  const palette = draft.palettes[mode];
  const warnings = contrastWarnings(palette);
  const teamSeasons = (seasons ?? []).filter((s) => s.teamId && s.teamId === draft.teamId);
  const legacySeasons = (seasons ?? []).filter((s) => !s.branding);
  const savedSnapshot = isNew ? null : snapshotFromTeam(saved);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Team Designer</CardTitle>
            <CardSubtitle>
              Team identity, colors, logo, and award artwork. Seasons keep the
              branding they were created with.
            </CardSubtitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="team-designer-select">
              Team
            </label>
            <select
              id="team-designer-select"
              className={`${SELECT_CLASS.replace("w-full", "")} w-auto min-w-44 max-w-64`}
              style={SELECT_STYLE}
              value={selectedId || "new"}
              onChange={(e) => select(e.target.value)}
              disabled={disabled || teams === null}
            >
              {(teams ?? []).map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.teamName}
                </option>
              ))}
              <option value="new">+ New team</option>
            </select>
            <span
              role="status"
              className="text-xs font-semibold"
              style={{ color: dirty ? "var(--secondary)" : "var(--muted)" }}
            >
              {dirty ? "Unsaved changes" : isNew ? "New team" : "Saved"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || !dirty}
              onClick={() => {
                setDraft(structuredClone(saved));
                setMsg(null);
                setErr(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={disabled || !dirty || !valid} onClick={save}>
              {busy ? "Saving…" : isNew ? "Create team" : "Save team"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        <div className="grid min-w-0 gap-3">
          <Segmented
            label="Team Designer sections"
            value={section}
            onChangeAction={setSection}
            options={[
              ["identity", "Identity"],
              ["appearance", "Appearance"],
              ["seasons", "Seasons"],
            ]}
          />

          {section === "identity" ? (
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                {(
                  [
                    ["teamName", "Team name", "Falcons", errors.teamName],
                    ["shortName", "Short name", "FAL", errors.shortName],
                    ["division", "Division / age group", "10U", errors.division],
                  ] as const
                ).map(([key, label, placeholder, error]) => (
                  <label key={key} className="grid gap-1">
                    <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      {label}
                    </span>
                    <input
                      className={INPUT_CLASS}
                      style={{ ...SELECT_STYLE, borderColor: error ? "#fb7185" : SELECT_STYLE.borderColor }}
                      value={draft[key]}
                      placeholder={placeholder}
                      onChange={(e) => patch({ [key]: e.target.value } as Partial<Draft>)}
                      disabled={disabled}
                      aria-invalid={!!error}
                    />
                    {error && draft[key] !== "" ? (
                      <span className="text-[11px]" style={{ color: "#fb7185" }}>{error}</span>
                    ) : null}
                  </label>
                ))}
              </div>

              <fieldset className="grid gap-1">
                <legend className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                  Sport
                </legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {SPORTS.map((sp) => (
                    <Tile
                      key={sp.id}
                      label={sp.label}
                      note={sp.available ? undefined : "Coming soon"}
                      selected={draft.sport === sp.id}
                      disabled={disabled || !sp.available}
                      onClickAction={() => {
                        if (isSupportedSport(sp.id)) patch({ sport: sp.id });
                      }}
                    >
                      <span aria-hidden="true" className="text-xl leading-none">
                        {sp.icon}
                      </span>
                    </Tile>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                    Logo
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {BUNDLED_LOGOS.map((l) => (
                      <Tile
                        key={l.id}
                        label={l.name}
                        selected={draft.logo?.id === l.id}
                        disabled={disabled}
                        onClickAction={() => patch({ logo: { kind: "bundled", id: l.id } })}
                      >
                        <span className="flex gap-1" aria-hidden="true">
                          {(["#0c0e12", "#f7f8fb"] as const).map((bg) => (
                            <span key={bg} className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: bg }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={l.color} alt="" className="h-7 w-7 object-contain" />
                            </span>
                          ))}
                        </span>
                      </Tile>
                    ))}
                    <Tile
                      label="No logo"
                      note="Team initials"
                      selected={draft.logo === null}
                      disabled={disabled}
                      onClickAction={() => patch({ logo: null })}
                    />
                  </div>
                </fieldset>

                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                    Award collection
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {AWARD_COLLECTIONS.map((c) => {
                      const selectable = isCollectionSelectable(c.id);
                      return (
                        <Tile
                          key={c.id}
                          label={c.name}
                          note={selectable ? undefined : "Coming soon"}
                          selected={draft.awardCollection === c.id}
                          disabled={disabled || !selectable}
                          onClickAction={() => patch({ awardCollection: c.id })}
                        >
                          {c.preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.preview} alt="" className="h-9 w-9 rounded-lg object-cover" />
                          ) : null}
                        </Tile>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </div>
          ) : null}

          {section === "appearance" ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented
                  label="Theme being edited"
                  value={mode}
                  onChangeAction={setMode}
                  options={[
                    ["dark", "Dark theme"],
                    ["light", "Light theme"],
                  ]}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" disabled={disabled} onClick={() => resetPalette("dark")}>
                    Reset Dark Theme
                  </Button>
                  <Button size="sm" variant="ghost" disabled={disabled} onClick={() => resetPalette("light")}>
                    Reset Light Theme
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      resetPalette("dark");
                      resetPalette("light");
                    }}
                  >
                    Reset All to Team Defaults
                  </Button>
                </div>
              </div>

              <div className="grid gap-1.5 sm:grid-cols-2">
                {TOKEN_KEYS.map((key) => {
                  const value = palette[key];
                  const ok = isValidColor(value);
                  const id = `color-${mode}-${key}`;
                  return (
                    <div key={key} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2">
                      <input
                        type="color"
                        aria-label={`${PALETTE_LABELS[key]} color picker (${mode})`}
                        value={pickerHex(value)}
                        onChange={(e) => setColor(key, e.target.value)}
                        disabled={disabled}
                        className="h-9 w-9 cursor-pointer rounded-lg border bg-transparent p-0.5"
                        style={{ borderColor: "var(--stroke)" }}
                      />
                      <label htmlFor={id} className="grid min-w-0 gap-0.5">
                        <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>
                          {PALETTE_LABELS[key]}
                        </span>
                        <input
                          id={id}
                          className="h-8 w-full min-w-0 rounded-lg border px-2 font-mono text-xs"
                          style={{ ...SELECT_STYLE, borderColor: ok ? SELECT_STYLE.borderColor : "#fb7185" }}
                          value={value}
                          onChange={(e) => setColor(key, e.target.value.trim())}
                          disabled={disabled}
                          aria-invalid={!ok}
                          spellCheck={false}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              {errors.palettes ? (
                <div className="text-xs" style={{ color: "#fb7185" }}>
                  {errors.palettes}
                </div>
              ) : null}

              <div role="status" aria-live="polite" className="rounded-xl border px-3 py-2 text-xs" style={warnings.length ? toastStyle("err") : toastStyle("ok")}>
                {warnings.length === 0 ? (
                  <>Contrast check ({mode}): all representative text, button, navigation, and card pairs pass.</>
                ) : (
                  <>
                    <strong>Low contrast ({mode} theme)</strong> — your colors are kept; consider adjusting:
                    <ul className="mt-1 list-disc pl-4">
                      {warnings.map((w) => (
                        <li key={w.label}>
                          {w.label}: {w.ratio}:1 (needs {w.minimum}:1)
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {section === "seasons" ? (
            <div className="grid gap-2 text-sm">
              {isNew ? (
                <div style={{ color: "var(--muted)" }}>Save the team first, then create seasons for it under Season Update.</div>
              ) : teamSeasons.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>
                  No seasons use {saved.teamName} yet. Create one under Season Update → Create season and pick this team.
                </div>
              ) : (
                <ul className="grid gap-1.5">
                  {teamSeasons.map((s) => {
                    const final = s.status === "finalized";
                    const current = sameBranding(s.branding, savedSnapshot);
                    return (
                      <li
                        key={s.seasonId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
                        style={{ borderColor: "var(--stroke)" }}
                      >
                        <span>
                          <strong>{s.seasonLabel}</strong>{" "}
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            {final ? "Final — branding preserved" : current ? "Uses current branding" : "Uses earlier branding"}
                          </span>
                        </span>
                        {!final && !current ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={disabled || dirty}
                            title={dirty ? "Save team changes first" : undefined}
                            onClick={() => applyToSeason(s.seasonId)}
                          >
                            Apply current branding
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {legacySeasons.length ? (
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {legacySeasons.map((s) => s.seasonLabel).join(", ")} use the original Tigers
                  branding and are not linked to a team.
                </div>
              ) : null}
            </div>
          ) : null}

          <div aria-live="polite" className="grid gap-2">
            {err ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>{err}</div>
            ) : null}
            {msg ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>{msg}</div>
            ) : null}
          </div>
        </div>

        <section aria-label="Live preview" className="grid min-w-0 gap-2 lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Live preview — not saved
            </span>
            <Segmented
              label="Preview theme"
              value={mode}
              onChangeAction={setMode}
              options={[
                ["dark", "Dark"],
                ["light", "Light"],
              ]}
            />
          </div>
          <TeamBrandingPreview branding={{ ...draft, teamId: draft.teamId || null }} mode={mode} />
        </section>
      </CardContent>
    </Card>
  );
}
