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
  LEGACY_TIGERS_BRANDING,
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
import {
  AWARD_COLLECTIONS,
  isCollectionSelectable,
} from "@/lib/awardCollections";
import {
  TOKEN_KEYS,
  type ThemeMode,
  type ThemeTokens,
} from "@/lib/themeTokens";
import type { SeasonSummary } from "@/lib/seasonStore";
import {
  applyTeamBrandingToSeason,
  createTeamIdempotent,
  teamAccessMessage,
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
  /** Visible caption before the options. */
  caption?: string;
  value: T;
  options: Array<[T, string]>;
  onChangeAction: (v: T) => void;
}) {
  const group = (
    <div
      role="tablist"
      aria-label={props.label}
      className="inline-flex rounded-xl border p-0.5"
      style={{ borderColor: "var(--stroke)" }}
    >
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
              background: on
                ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                : "transparent",
              color: on ? "rgba(0,0,0,0.92)" : "var(--muted)",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
  if (!props.caption) return group;
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className="text-xs font-semibold"
        style={{ color: "var(--muted)" }}
        aria-hidden="true"
      >
        {props.caption}
      </span>
      {group}
    </div>
  );
}

/**
 * Compact menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown opens
 * and focuses the first item; arrows move; Escape or Tab closes and returns
 * focus; clicking outside closes.
 */
function MenuButton(props: {
  label: string;
  disabled?: boolean;
  items: Array<{ label: string; disabled?: boolean; onSelect: () => void }>;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = React.useId();

  const enabled = props.items
    .map((it, i) => (it.disabled ? -1 : i))
    .filter((i) => i >= 0);
  const focusItem = (i: number) => itemRefs.current[i]?.focus();

  React.useEffect(() => {
    if (!open) return;
    focusItem(enabled[0] ?? 0);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // enabled is derived from items; only focus when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const current = itemRefs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const pos = enabled.indexOf(current);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      focusItem(enabled[(pos + step + enabled.length) % enabled.length]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusItem(enabled[e.key === "Home" ? 0 : enabled.length - 1]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={props.disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex h-8 items-center gap-1 rounded-xl border px-3 text-xs font-semibold disabled:opacity-60"
        style={{ borderColor: "var(--stroke)", color: "var(--foreground)" }}
      >
        {props.label}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={props.label}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 grid min-w-56 gap-0.5 rounded-xl border p-1 shadow-lg"
          style={{ borderColor: "var(--stroke)", background: "var(--card)" }}
        >
          {props.items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={it.disabled}
              onClick={() => {
                close();
                it.onSelect();
              }}
              className="rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] focus:bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] focus:outline-none disabled:opacity-50"
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
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
        <span
          className="text-[10px] font-medium"
          style={{ color: "var(--muted)" }}
        >
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
  /**
   * Guided setup: always a new team from the given template, no team picker
   * or Seasons section; the saved team is handed back.
   */
  setup?: { template: "blank" | "tigers"; onSavedAction: (team: Team) => void };
}) {
  const {
    db,
    canEdit,
    teams,
    seasons,
    onTeamsChangedAction,
    onSeasonsChangedAction,
    onDirtyChangeAction,
    setup,
  } = props;

  const initial = (): Draft =>
    setup?.template === "tigers"
      ? { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "" }
      : newTeamTemplate();
  const [selectedId, setSelectedId] = React.useState<string>(
    setup ? "new" : "",
  );
  const [saved, setSaved] = React.useState<Draft>(initial);
  const [draft, setDraft] = React.useState<Draft>(initial);
  // A new team keeps one id across retries, so a retry after a lost
  // response recovers the saved team instead of creating a second one.
  const pendingIdRef = React.useRef<string | null>(null);
  const savingRef = React.useRef(false);
  const [section, setSection] = React.useState<Section>("identity");
  // One theme selection shared by the editor and the live preview: either
  // switch changes both, so the preview always shows the palette being
  // edited. Unsaved edits to both palettes live in `draft`.
  const [mode, setMode] = React.useState<ThemeMode>("dark");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const dirty = !sameBranding(draft, saved);
  const errors = validateBranding(draft);
  const valid = Object.keys(errors).length === 0;
  const isNew = !draft.teamId;
  const disabled = !canEdit || busy;

  React.useEffect(
    () => onDirtyChangeAction(dirty),
    [dirty, onDirtyChangeAction],
  );
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
    if (setup || teams === null || selectedId) return;
    const first = teams[0];
    const start = first ? structuredClone(first) : newTeamTemplate();
    setSelectedId(first ? first.teamId : "new");
    setSaved(start);
    setDraft(structuredClone(start));
  }, [setup, teams, selectedId]);

  function select(id: string) {
    if (id === selectedId) return;
    pendingIdRef.current = null;
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
      palettes: {
        ...d.palettes,
        [mode]: { ...d.palettes[mode], [key]: value },
      },
    }));
  }

  function resetPalette(which: ThemeMode) {
    setDraft((d) => ({
      ...d,
      palettes: { ...d.palettes, [which]: { ...saved.palettes[which] } },
    }));
  }

  const paletteDirty = (which: ThemeMode) =>
    !sameBranding(draft.palettes[which], saved.palettes[which]);

  function confirmReset(which: ThemeMode[], what: string) {
    if (
      which.some(paletteDirty) &&
      !window.confirm(`Discard unsaved changes to ${what}?`)
    )
      return;
    which.forEach(resetPalette);
  }

  async function save() {
    if (!valid || busy || savingRef.current) return;
    savingRef.current = true; // blocks a double click before re-render
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (isNew) pendingIdRef.current ??= newTeamId(draft.teamName);
      const team: Team = {
        ...draft,
        teamId: draft.teamId || pendingIdRef.current!,
      };
      if (isNew) await createTeamIdempotent(db, team);
      else await updateTeam(db, team);
      pendingIdRef.current = null;
      setSaved(structuredClone(team));
      setDraft(structuredClone(team));
      setSelectedId(team.teamId);
      setMsg(
        isNew
          ? `${team.teamName} created. Create a season for it under Season Update.`
          : `${team.teamName} saved. Existing seasons keep their own branding until you apply it.`,
      );
      onTeamsChangedAction();
      if (isNew) setup?.onSavedAction(team);
    } catch (e: unknown) {
      setErr(teamAccessMessage(e, "Could not save the team."));
    } finally {
      savingRef.current = false;
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
  const teamSeasons = (seasons ?? []).filter(
    (s) => s.teamId && s.teamId === draft.teamId,
  );
  const legacySeasons = (seasons ?? []).filter((s) => !s.branding);
  const savedSnapshot = isNew ? null : snapshotFromTeam(saved);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{setup ? "New team" : "Team Designer"}</CardTitle>
            <CardSubtitle>
              Team identity, colors, logo, and award artwork. Seasons keep the
              branding they were created with.
            </CardSubtitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {setup ? null : (
              <>
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
              </>
            )}
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
            <Button
              size="sm"
              disabled={disabled || (!dirty && !isNew) || !valid}
              onClick={save}
            >
              {busy ? "Saving…" : isNew ? "Create team" : "Save team"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent
        className={[
          "grid gap-4 lg:items-start",
          // Appearance: compact editor (~35%, never narrower than the longest
          // color value needs) and a dominant live preview.
          section === "appearance"
            ? "lg:grid-cols-[minmax(27rem,35fr)_minmax(0,65fr)]"
            : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]",
        ].join(" ")}
      >
        <div className="grid min-w-0 gap-3">
          <Segmented
            label="Team Designer sections"
            value={section}
            onChangeAction={setSection}
            options={
              setup
                ? [
                    ["identity", "Identity"],
                    ["appearance", "Appearance"],
                  ]
                : [
                    ["identity", "Identity"],
                    ["appearance", "Appearance"],
                    ["seasons", "Seasons"],
                  ]
            }
          />

          {section === "identity" ? (
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                {(
                  [
                    ["teamName", "Team name", "Falcons", errors.teamName],
                    ["shortName", "Short name", "FAL", errors.shortName],
                    [
                      "division",
                      "Division / age group",
                      "10U",
                      errors.division,
                    ],
                  ] as const
                ).map(([key, label, placeholder, error]) => (
                  <label key={key} className="grid gap-1">
                    <span
                      className="text-xs font-semibold"
                      style={{ color: "var(--muted)" }}
                    >
                      {label}
                    </span>
                    <input
                      className={INPUT_CLASS}
                      style={{
                        ...SELECT_STYLE,
                        borderColor: error
                          ? "#fb7185"
                          : SELECT_STYLE.borderColor,
                      }}
                      value={draft[key]}
                      placeholder={placeholder}
                      onChange={(e) =>
                        patch({ [key]: e.target.value } as Partial<Draft>)
                      }
                      disabled={disabled}
                      aria-invalid={!!error}
                    />
                    {error && draft[key] !== "" ? (
                      <span
                        className="text-[11px]"
                        style={{ color: "#fb7185" }}
                      >
                        {error}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>

              <fieldset className="grid gap-1">
                <legend
                  className="mb-1 text-xs font-semibold"
                  style={{ color: "var(--muted)" }}
                >
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
                  <legend
                    className="mb-1 text-xs font-semibold"
                    style={{ color: "var(--muted)" }}
                  >
                    Logo
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {BUNDLED_LOGOS.map((l) => (
                      <Tile
                        key={l.id}
                        label={l.name}
                        selected={draft.logo?.id === l.id}
                        disabled={disabled}
                        onClickAction={() =>
                          patch({ logo: { kind: "bundled", id: l.id } })
                        }
                      >
                        <span className="flex gap-1" aria-hidden="true">
                          {(["#0c0e12", "#f7f8fb"] as const).map((bg) => (
                            <span
                              key={bg}
                              className="grid h-9 w-9 place-items-center rounded-lg"
                              style={{ background: bg }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={l.color}
                                alt=""
                                className="h-7 w-7 object-contain"
                              />
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
                  <legend
                    className="mb-1 text-xs font-semibold"
                    style={{ color: "var(--muted)" }}
                  >
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
                            <img
                              src={c.preview}
                              alt=""
                              className="h-9 w-9 rounded-lg object-cover"
                            />
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
                  label="Editing theme"
                  caption="Editing"
                  value={mode}
                  onChangeAction={setMode}
                  options={[
                    ["dark", "Dark"],
                    ["light", "Light"],
                  ]}
                />
                <MenuButton
                  label="Reset"
                  disabled={disabled}
                  items={[
                    {
                      label: "Reset Dark Theme",
                      disabled: !paletteDirty("dark"),
                      onSelect: () => confirmReset(["dark"], "the dark theme"),
                    },
                    {
                      label: "Reset Light Theme",
                      disabled: !paletteDirty("light"),
                      onSelect: () =>
                        confirmReset(["light"], "the light theme"),
                    },
                    {
                      label: "Reset All to Team Defaults",
                      disabled: !paletteDirty("dark") && !paletteDirty("light"),
                      onSelect: () =>
                        confirmReset(["dark", "light"], "both themes"),
                    },
                  ]}
                />
              </div>

              <ul
                className="grid gap-1"
                aria-label={`${mode === "dark" ? "Dark" : "Light"} theme colors`}
              >
                {TOKEN_KEYS.map((key) => {
                  const value = palette[key];
                  const ok = isValidColor(value);
                  const id = `color-${mode}-${key}`;
                  return (
                    <li
                      key={key}
                      // One row on desktop: [swatch] Label [value]. On narrow
                      // phones the value wraps under the label, never clipped.
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 sm:grid-cols-[2rem_5.75rem_minmax(0,1fr)]"
                    >
                      <input
                        type="color"
                        aria-label={`${PALETTE_LABELS[key]} color picker (${mode})`}
                        value={pickerHex(value)}
                        onChange={(e) => setColor(key, e.target.value)}
                        disabled={disabled}
                        className="h-9 w-9 cursor-pointer rounded-lg border bg-transparent p-0.5 sm:row-auto sm:h-8 sm:w-8 max-sm:row-span-2"
                        style={{ borderColor: "var(--stroke)" }}
                      />
                      <label
                        htmlFor={id}
                        className="text-[11px] font-semibold leading-tight"
                        style={{ color: "var(--muted)" }}
                      >
                        {PALETTE_LABELS[key]}
                      </label>
                      <input
                        id={id}
                        className="h-8 w-full min-w-0 rounded-lg border px-1.5 font-mono text-[11px] sm:px-2"
                        style={{
                          ...SELECT_STYLE,
                          borderColor: ok
                            ? SELECT_STYLE.borderColor
                            : "#fb7185",
                        }}
                        value={value}
                        onChange={(e) => setColor(key, e.target.value.trim())}
                        disabled={disabled}
                        aria-invalid={!ok}
                        spellCheck={false}
                      />
                    </li>
                  );
                })}
              </ul>
              {errors.palettes ? (
                <div className="text-xs" style={{ color: "#fb7185" }}>
                  {errors.palettes}
                </div>
              ) : null}

              <div
                role="status"
                aria-live="polite"
                className="rounded-xl border px-3 py-2 text-xs"
                style={warnings.length ? toastStyle("err") : toastStyle("ok")}
              >
                {warnings.length === 0 ? (
                  <>
                    Contrast check ({mode}): all representative text, button,
                    navigation, and card pairs pass.
                  </>
                ) : (
                  <>
                    <strong>Low contrast ({mode} theme)</strong> — your colors
                    are kept; consider adjusting:
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
                <div style={{ color: "var(--muted)" }}>
                  Save the team first, then create seasons for it under Season
                  Update.
                </div>
              ) : teamSeasons.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>
                  No seasons use {saved.teamName} yet. Create one under Season
                  Update → Create season and pick this team.
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
                          <span
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            {final
                              ? "Final — branding preserved"
                              : current
                                ? "Uses current branding"
                                : "Uses earlier branding"}
                          </span>
                        </span>
                        {!final && !current ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={disabled || dirty}
                            title={
                              dirty ? "Save team changes first" : undefined
                            }
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
                  {legacySeasons.map((s) => s.seasonLabel).join(", ")} use the
                  original Tigers branding and are not linked to a team.
                </div>
              ) : null}
            </div>
          ) : null}

          <div aria-live="polite" className="grid gap-2">
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
          </div>
        </div>

        <section
          aria-label="Live preview"
          className="grid min-w-0 gap-2 lg:sticky lg:top-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--muted)" }}
            >
              Live preview — not saved
            </span>
            <Segmented
              label="Preview theme"
              caption="Preview"
              value={mode}
              onChangeAction={setMode}
              options={[
                ["dark", "Dark"],
                ["light", "Light"],
              ]}
            />
          </div>
          <TeamBrandingPreview
            branding={{ ...draft, teamId: draft.teamId || null }}
            mode={mode}
          />
        </section>
      </CardContent>

      {dirty ? (
        <div
          className="sticky bottom-0 z-20 flex items-center justify-between gap-2 border-t px-4 py-2 lg:hidden"
          style={{ borderColor: "var(--stroke)", background: "var(--card)" }}
        >
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--secondary)" }}
          >
            Unsaved changes
          </span>
          <span className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setDraft(structuredClone(saved));
                setMsg(null);
                setErr(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={disabled || !valid} onClick={save}>
              {busy ? "Saving…" : isNew ? "Create team" : "Save team"}
            </Button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}
