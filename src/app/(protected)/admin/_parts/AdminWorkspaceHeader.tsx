"use client";

// Admin workspace header: who/what is being administered, then the sections
// grouped by scope — everyday coaching on the left, team & season
// management on the right. Sign-in and allowlist states render as children.

import * as React from "react";
import Link from "next/link";
import {
  CalendarCog,
  ClipboardList,
  ListOrdered,
  Palette,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { AdminTab } from "../adminHelpers";

type Section = { tab: AdminTab; label: string; icon: LucideIcon };

const COACHING: Section[] = [
  { tab: "stats", label: "Stat Update", icon: ClipboardList },
  { tab: "lineup", label: "Lineup", icon: ListOrdered },
  { tab: "players", label: "Player Update", icon: Users },
];
const MANAGEMENT: Section[] = [
  { tab: "season", label: "Season Update", icon: CalendarCog },
  { tab: "team", label: "Team Designer", icon: Palette },
];

function SectionButton(props: {
  section: Section;
  active: boolean;
  onSelectAction: (tab: AdminTab) => void;
  accent?: boolean;
  /** Phones: three labels per row need the room more than the icons. */
  compactIcon?: boolean;
}) {
  const { section, active } = props;
  const Icon = section.icon;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => props.onSelectAction(section.tab)}
      className={[
        "relative inline-flex h-9 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors sm:flex-none sm:px-3 sm:text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-1",
        active ? "font-bold" : "font-semibold hover:bg-[color-mix(in_oklab,var(--card)_70%,transparent)]",
      ].join(" ")}
      style={{
        background: active ? "var(--card)" : "transparent",
        color: active ? "var(--foreground)" : "var(--muted)",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.18)" : undefined,
        outlineColor: "var(--secondary)",
      }}
    >
      <Icon
        className={"h-4 w-4 shrink-0" + (props.compactIcon ? " max-sm:hidden" : "")}
        aria-hidden="true"
        style={{ color: props.accent || active ? "var(--secondary)" : undefined }}
      />
      <span className="truncate">{section.label}</span>
      {/* Shape cue for the active section, not just color. */}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full"
          style={{ background: "var(--primary)" }}
        />
      ) : null}
    </button>
  );
}

function Group(props: {
  label: string;
  sections: Section[];
  activeTab: AdminTab | null;
  onSelectAction: (tab: AdminTab) => void;
  management?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className={[
        "gap-0.5 rounded-xl border p-0.5 sm:inline-flex sm:w-auto",
        // Phones: management splits evenly; coaching sizes to its labels.
        props.management ? "grid grid-cols-2" : "flex",
      ].join(" ")}
      style={{
        borderColor: props.management
          ? "color-mix(in oklab, var(--secondary) 30%, var(--stroke))"
          : "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: props.management
          ? "color-mix(in oklab, var(--secondary) 6%, var(--bg-base))"
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
      }}
    >
      {props.sections.map((s) => (
        <SectionButton
          key={s.tab}
          section={s}
          active={props.activeTab === s.tab}
          onSelectAction={props.onSelectAction}
          accent={s.tab === "team"}
          compactIcon={!props.management}
        />
      ))}
    </div>
  );
}

export function AdminWorkspaceHeader(props: {
  /** e.g. "Mustang Tigers" (division + team) from the current season. */
  teamLine: string;
  seasonLabel: string;
  /** Diagnostic only (tooltip). */
  seasonId: string;
  /** Null while guided setup is open (no section is active). */
  activeTab: AdminTab | null;
  onSelectAction: (tab: AdminTab) => void;
  /** True once signed in and allowlisted. */
  ready: boolean;
  myPlayersHref?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <header
      className="ui-card grid gap-3 px-4 py-3 sm:px-5"
      aria-label="Admin workspace"
      data-admin-ready={props.ready ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-x-3 gap-y-0.5 max-sm:flex-col">
          <h2 className="text-lg font-bold leading-tight" style={{ color: "var(--foreground)" }}>
            Admin
          </h2>
          <p
            className="min-w-0 truncate text-sm font-semibold"
            style={{ color: "var(--muted)" }}
            title={`Current season id: ${props.seasonId}`}
            data-admin-context
          >
            {props.teamLine} · {props.seasonLabel}
          </p>
        </div>
        {props.myPlayersHref ? (
          <Link href={props.myPlayersHref} className="text-xs font-semibold underline" style={{ color: "var(--muted)" }}>
            My Players
          </Link>
        ) : null}
      </div>

      <nav aria-label="Admin sections" className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          <Group label="Coaching" sections={COACHING} activeTab={props.activeTab} onSelectAction={props.onSelectAction} />
          <Group
            label="Team and season management"
            sections={MANAGEMENT}
            activeTab={props.activeTab}
            onSelectAction={props.onSelectAction}
            management
          />
      </nav>

      {props.children}
    </header>
  );
}
