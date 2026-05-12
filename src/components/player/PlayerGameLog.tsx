"use client";

function formatGameDate(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function buildLineSummary(props: {
  atBats: number;
  hits: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
}): string {
  const bits: string[] = [];
  bits.push(`${props.hits} for ${props.atBats}`);
  if (props.runs > 0)
    bits.push(`${props.runs} ${props.runs === 1 ? "run" : "runs"}`);
  if (props.rbi > 0) bits.push(`${props.rbi} RBI`);
  if (props.walks > 0) bits.push(`${props.walks} BB`);
  if (props.hitByPitch > 0) bits.push(`${props.hitByPitch} HBP`);
  return bits.join(" • ");
}

export function GameLogRow(props: {
  date: string;
  opponent: string;
  result: "W" | "L" | "T";
  scoreUs: number;
  scoreThem: number;
  atBats: number;
  hits: number;
  hitStreak: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
}) {
  const summary = buildLineSummary(props);

  return (
    <div
      className="rounded-xl border px-3 py-3"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {formatGameDate(props.date)} vs {props.opponent}
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {summary}
          </div>
          {props.hitStreak > 0 ? (
            <div
              className={[
                "mt-1 text-xs font-semibold transition",
                props.hitStreak >= 5 ? "animate-pulse" : "",
              ].join(" ")}
              style={{
                color:
                  props.hitStreak >= 3
                    ? "color-mix(in oklab, var(--secondary) 88%, #ff7a18)"
                    : "var(--secondary)",
                textShadow:
                  props.hitStreak >= 3
                    ? "0 0 12px color-mix(in oklab, var(--secondary) 70%, transparent)"
                    : undefined,
              }}
            >
              {props.hitStreak >= 5 ? "Fire streak: " : "Hit streak: "}
              {props.hitStreak} {props.hitStreak === 1 ? "game" : "games"}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--muted)" }}
          >
            {props.result} {props.scoreUs}-{props.scoreThem}
          </div>
        </div>
      </div>
    </div>
  );
}
