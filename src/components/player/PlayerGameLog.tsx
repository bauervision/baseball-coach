"use client";

import { IconBall } from "@/components/player/helpers";
import type { PlayerGameLogItem } from "@/components/roster/usePlayerGameLog";
import { gameTypeLabel } from "@/lib/gameClassification";
import {
  gameLogHighlights,
  gameLogStatGroups,
  gameLogSummary,
} from "@/lib/playerGameLog";

function formatGameDate(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;
  return `${Number(m[2])}/${Number(m[3])}`;
}

const PILL = "inline-flex items-center gap-1 rounded-full px-2 py-0.5";

function RecognitionList(props: { item: PlayerGameLogItem }) {
  const { recognitions } = props.item;
  if (recognitions.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Recognition">
      {recognitions.map((r) => (
        <li
          key={r.key}
          className={`${PILL} text-xs font-semibold`}
          style={
            r.isGameBall
              ? {
                  color: "var(--secondary)",
                  background:
                    "color-mix(in oklab, var(--secondary) 16%, transparent)",
                  border:
                    "1px solid color-mix(in oklab, var(--secondary) 55%, transparent)",
                }
              : {
                  color: "var(--foreground)",
                  background:
                    "color-mix(in oklab, var(--primary) 16%, transparent)",
                  border:
                    "1px solid color-mix(in oklab, var(--primary) 50%, transparent)",
                }
          }
        >
          {r.isGameBall ? <IconBall /> : null}
          <span>{r.title}</span>
        </li>
      ))}
    </ul>
  );
}

function HighlightList(props: { item: PlayerGameLogItem }) {
  const highlights = gameLogHighlights(props.item.delta);
  if (highlights.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Game highlights">
      {highlights.map((s) => (
        <li
          key={s.key}
          className={`${PILL} text-[11px] font-semibold`}
          style={{
            color: "var(--foreground)",
            background: "color-mix(in oklab, var(--stroke) 22%, transparent)",
            border:
              "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
          }}
          title={s.name}
        >
          <span aria-hidden="true">
            {s.short}{" "}
            <span className="tabular-nums" style={{ color: "var(--secondary)" }}>
              ×{s.value}
            </span>
          </span>
          <span className="sr-only">
            {s.name}: {s.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FullStatLine(props: { item: PlayerGameLogItem }) {
  const groups = gameLogStatGroups(props.item.delta);

  return (
    <details className="group mt-2">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-xs font-semibold outline-offset-2 [&::-webkit-details-marker]:hidden"
        style={{ color: "var(--muted)" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="group-open:hidden">Full stat line</span>
        <span className="hidden group-open:inline">Hide stat line</span>
      </summary>

      <div className="mt-2 grid gap-2">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              {g.label}
            </div>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5">
              {g.stats.map((s) => (
                <div
                  key={s.key}
                  className="rounded-lg border px-2 py-1"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--stroke) 80%, transparent)",
                    background:
                      s.value > 0
                        ? "color-mix(in oklab, var(--card) 85%, transparent)"
                        : "transparent",
                  }}
                  title={s.name}
                >
                  <dt
                    className="truncate text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    <span aria-hidden="true">{s.short}</span>
                    <span className="sr-only">{s.name}</span>
                  </dt>
                  <dd
                    className="text-sm font-bold tabular-nums"
                    style={{
                      color: s.value > 0 ? "var(--foreground)" : "var(--muted)",
                      opacity: s.value > 0 ? 1 : 0.6,
                    }}
                  >
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}

export function GameLogRow(props: {
  item: PlayerGameLogItem;
  hitStreak: number;
}) {
  const { item, hitStreak } = props;
  const title = `${formatGameDate(item.date)} vs ${item.opponent}`;

  return (
    <article
      aria-label={title}
      className="rounded-xl border px-3 py-3"
      style={{
        borderColor: item.gotGameBall
          ? "color-mix(in oklab, var(--secondary) 55%, transparent)"
          : "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: item.gotGameBall
          ? "linear-gradient(180deg, color-mix(in oklab, var(--secondary) 10%, var(--bg-base)), color-mix(in oklab, var(--bg-base) 65%, transparent))"
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold">{title}</h3>
            {item.gameType !== "regular" ? (
              <span
                className={`${PILL} text-[10px] font-semibold uppercase tracking-wide`}
                style={{
                  color: "var(--muted)",
                  border:
                    "1px solid color-mix(in oklab, var(--stroke) 85%, transparent)",
                }}
              >
                {gameTypeLabel(item.gameType)}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {item.hasStatLine ? gameLogSummary(item.delta) : "No stats recorded"}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--muted)" }}
          >
            {item.result} {item.scoreUs}-{item.scoreThem}
          </div>
        </div>
      </div>

      <RecognitionList item={item} />
      {item.hasStatLine ? <HighlightList item={item} /> : null}

      {hitStreak > 0 ? (
        <div
          className={[
            "mt-2 text-xs font-semibold transition",
            hitStreak >= 5 ? "animate-pulse" : "",
          ].join(" ")}
          style={{
            color:
              hitStreak >= 3
                ? "color-mix(in oklab, var(--secondary) 88%, #ff7a18)"
                : "var(--secondary)",
            textShadow:
              hitStreak >= 3
                ? "0 0 12px color-mix(in oklab, var(--secondary) 70%, transparent)"
                : undefined,
          }}
        >
          {hitStreak >= 5 ? "Fire streak: " : "Hit streak: "}
          {hitStreak} {hitStreak === 1 ? "game" : "games"}
        </div>
      ) : null}

      {item.hasStatLine ? <FullStatLine item={item} /> : null}
    </article>
  );
}
