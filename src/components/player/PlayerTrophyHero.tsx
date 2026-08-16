"use client";

import Image from "next/image";
import type { TrophyAward } from "@/lib/trophies";
import { TROPHY_ART } from "@/lib/trophyArtwork";

export function PlayerTrophyHero(props: {
  playerName: string;
  awards: TrophyAward[];
  endSeasonMode: boolean;
}) {
  const { playerName, awards, endSeasonMode } = props;

  return (
    <div
      className="rounded-3xl border p-5 sm:p-6"
      style={{
        borderColor: "color-mix(in oklab, var(--secondary) 42%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--secondary) 18%, var(--card)), color-mix(in oklab, var(--primary) 12%, var(--card)) 48%, color-mix(in oklab, var(--bg-base) 72%, transparent))",
        boxShadow:
          "0 0 0 1px color-mix(in oklab, var(--secondary) 12%, transparent) inset, 0 18px 40px color-mix(in oklab, var(--stroke) 20%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--muted)" }}
          >
            {endSeasonMode ? "Trophy Recognition" : "Trophy Outlook"}
          </div>

          <div
            className="mt-2 text-xl font-extrabold leading-tight sm:text-2xl"
            style={{ color: "var(--foreground)" }}
          >
            {awards.length > 0
              ? endSeasonMode
                ? `${playerName} earned season recognition`
                : `${playerName} currently has the edge`
              : endSeasonMode
                ? `${playerName} gave the team a great season`
                : `${playerName} is still chasing a trophy`}
          </div>

          <div
            className="mt-2 text-sm sm:text-base"
            style={{ color: "var(--muted)" }}
          >
            {awards.length > 0
              ? endSeasonMode
                ? "These are the trophies and awards this player earned by the end of the season."
                : "A player will ultimately receive one trophy, but these are the categories where they currently lead or are tied for the lead."
              : endSeasonMode
                ? "Not every contribution fits neatly into a trophy, but every player helped shape the season."
                : "No active trophy lead yet. Keep recording games and strengths will start to separate."}
          </div>
        </div>
      </div>

      {awards.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {awards.map((award) => {
            const artworkSrc =
              TROPHY_ART[award.trophy.key] ?? "/trophies/trophy.png";

            return (
              <div
                key={award.trophy.key}
                className="flex min-h-36 items-center justify-between gap-5 rounded-2xl border px-5 py-5"
                style={{
                  borderColor:
                    "color-mix(in oklab, var(--stroke) 88%, transparent)",
                  background:
                    "color-mix(in oklab, var(--bg-base) 58%, transparent)",
                }}
              >
                <div className="min-w-0">
                  <div
                    className="text-2xl font-extrabold leading-tight"
                    style={{ color: "var(--foreground)" }}
                  >
                    {award.trophy.title}
                  </div>

                  <div
                    className="mt-2 text-4xl font-extrabold leading-none"
                    style={{
                      color: "var(--secondary)",
                      textShadow:
                        "0 0 18px color-mix(in oklab, var(--secondary) 45%, transparent)",
                    }}
                  >
                    {award.valueLabel}
                  </div>

                  {award.valueSub ? (
                    <div
                      className="mt-2 text-lg font-semibold"
                      style={{ color: "var(--muted)" }}
                    >
                      {award.valueSub}
                    </div>
                  ) : null}
                </div>

                <div
                  className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border sm:h-28 sm:w-28"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--secondary) 34%, transparent)",
                    background:
                      "color-mix(in oklab, var(--secondary) 10%, var(--card))",
                    boxShadow:
                      "0 10px 24px color-mix(in oklab, var(--secondary) 16%, transparent)",
                  }}
                  aria-hidden="true"
                >
                  <Image
                    src={artworkSrc}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 112px, 96px"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
