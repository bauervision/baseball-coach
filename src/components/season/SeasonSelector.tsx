"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getFirestoreDb } from "@/lib/firebase.client";
import { listSeasons, type SeasonSummary } from "@/lib/seasonStore";
import { seasonTag, visibleToViewers } from "@/lib/seasonLifecycle";
import { withSeason } from "@/lib/viewedSeason";

// Seasons change rarely: read once per page load, and drop the cache when
// the coach creates, activates, finalizes, or reopens a season.
let cache: SeasonSummary[] | null = null;

export function invalidateSeasonList(): void {
  cache = null;
}

export function useSeasonList(): SeasonSummary[] | null {
  const [list, setList] = React.useState<SeasonSummary[] | null>(() => cache);
  React.useEffect(() => {
    if (cache) return;
    let active = true;
    listSeasons(getFirestoreDb())
      .then((l) => {
        cache = l;
        if (active) setList(l);
      })
      .catch(() => {
        if (active) setList([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return list;
}

export function seasonOptionText(s: SeasonSummary, activeSeasonId: string): string {
  const tag = seasonTag({
    status: s.status,
    isCurrent: s.seasonId === activeSeasonId,
    endSeasonMode: s.endSeasonMode,
  });
  return `${s.seasonLabel} — ${s.teamName}${tag ? ` · ${tag}` : ""}`;
}

/**
 * Compact season picker for viewer pages. Selecting a season only changes
 * the URL (?season=), never the coach's active season. `hrefFor` lets a
 * page map a season to a different destination (e.g. the same player's
 * entry in that season).
 */
export function SeasonSelector(props: {
  viewedSeasonId: string;
  activeSeasonId: string;
  hrefFor?: (seasonId: string) => string;
  className?: string;
}) {
  const { viewedSeasonId, activeSeasonId, hrefFor } = props;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const list = useSeasonList();
  const id = React.useId();

  const options = (list ?? []).filter(
    (s) =>
      visibleToViewers({ status: s.status, isCurrent: s.seasonId === activeSeasonId }) ||
      s.seasonId === viewedSeasonId,
  );
  const viewingPast = !!activeSeasonId && viewedSeasonId !== activeSeasonId;
  const currentHref = (sid: string) =>
    hrefFor ? hrefFor(sid) : withSeason(`${pathname}?${sp.toString()}`, sid, activeSeasonId);

  if (options.length < 2 && !viewingPast) return null;

  return (
    <div className={["flex flex-wrap items-center gap-2 print:hidden", props.className ?? ""].join(" ")}>
      <label
        htmlFor={id}
        className="sr-only text-xs font-semibold sm:not-sr-only"
        style={{ color: "var(--muted)" }}
      >
        Season
      </label>
      <select
        id={id}
        value={viewedSeasonId}
        onChange={(e) => router.push(currentHref(e.target.value), { scroll: false })}
        disabled={list === null}
        className="h-9 max-w-[14.5rem] rounded-xl border px-1.5 text-[13px] font-semibold sm:max-w-[16rem] sm:px-2 sm:text-sm"
        style={{
          borderColor: viewingPast
            ? "color-mix(in oklab, var(--secondary) 65%, transparent)"
            : "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
          color: "var(--foreground)",
        }}
      >
        {list === null ? <option value={viewedSeasonId}>Loading seasons…</option> : null}
        {options.map((s) => (
          <option key={s.seasonId} value={s.seasonId} style={{ color: "#000" }}>
            {seasonOptionText(s, activeSeasonId)}
          </option>
        ))}
      </select>
      {viewingPast ? (
        <Link
          href={currentHref(activeSeasonId)}
          className="text-xs font-semibold underline"
          style={{ color: "var(--muted)" }}
          scroll={false}
        >
          Back to current
        </Link>
      ) : null}
    </div>
  );
}
