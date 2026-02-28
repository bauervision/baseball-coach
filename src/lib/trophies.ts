// lib/trophies.ts
import type { Player } from "@/lib/roster";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
} from "@/lib/roster";

export type TrophyKey =
  | "batting_champ"
  | "on_base_king"
  | "slugger"
  | "ops_star"
  | "rbi_producer"
  | "run_machine"
  | "hit_leader"
  | "iron_tiger"
  | "gold_glove"
  | "cannon_arm"
  | "walk_wizard"
  | "brick_wall";

export type TrophyDef = {
  key: TrophyKey;
  title: string;
  subtitle: string;
};

export type TrophyAward = {
  trophy: TrophyDef;
  winner: Player;
  runnerUp: Player | null;
  valueLabel: string;
  valueSub?: string;
};

type Candidate = {
  p: Player;
  score: number;
  t1: number; // tie-break 1
  t2: number; // tie-break 2
  t3: number; // tie-break 3
};

function pa(p: Player) {
  const s = p.stats;
  return s.atBats + s.walks + s.hitByPitch;
}

function safeNum(n: number) {
  return Number.isFinite(n) ? n : 0;
}

function sortCandidatesDesc(a: Candidate, b: Candidate) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.t1 !== a.t1) return b.t1 - a.t1;
  if (b.t2 !== a.t2) return b.t2 - a.t2;
  if (b.t3 !== a.t3) return b.t3 - a.t3;
  return a.p.name.localeCompare(b.p.name);
}

function pickUniqueWinner(opts: {
  trophy: TrophyDef;
  players: Player[];
  alreadyWon: Set<string>;
  buildCandidates: (p: Player) => Candidate;
  formatValue: (p: Player) => { valueLabel: string; valueSub?: string };
}): TrophyAward | null {
  const { trophy, players, alreadyWon, buildCandidates, formatValue } = opts;

  const candidates = players.map(buildCandidates).sort(sortCandidatesDesc);

  // Try best candidate who hasn't already won.
  const winnerCand = candidates.find((c) => !alreadyWon.has(c.p.id));
  if (!winnerCand) return null;

  alreadyWon.add(winnerCand.p.id);

  // Runner up: best candidate excluding winner, and ideally also not already-won
  // (but if everyone already won, we still show a runner up if possible).
  const runnerUpCand =
    candidates.find((c) => c.p.id !== winnerCand.p.id && !alreadyWon.has(c.p.id)) ??
    candidates.find((c) => c.p.id !== winnerCand.p.id) ??
    null;

  const winner = winnerCand.p;
  const runnerUp = runnerUpCand?.p ?? null;

  const v = formatValue(winner);

  return {
    trophy,
    winner,
    runnerUp,
    valueLabel: v.valueLabel,
    valueSub: v.valueSub,
  };
}

export function computeTrophies(players: Player[]): TrophyAward[] {
  const list = players.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (list.length === 0) return [];

  // Deterministic ordering of trophies (roughly “most prestigious” to “most fun”).
  const TROPHIES: TrophyDef[] = [
    {
      key: "batting_champ",
      title: "Batting Champ",
      subtitle: "Highest batting average (min 10 AB)",
    },
    {
      key: "on_base_king",
      title: "On-Base King",
      subtitle: "Highest OBP (min 10 PA)",
    },
    {
      key: "slugger",
      title: "Slugger",
      subtitle: "Highest slugging (min 10 AB)",
    },
    {
      key: "ops_star",
      title: "OPS Star",
      subtitle: "Best all-around hitter (min 10 PA)",
    },
    {
      key: "rbi_producer",
      title: "RBI Producer",
      subtitle: "Most RBIs",
    },
    {
      key: "run_machine",
      title: "Run Machine",
      subtitle: "Most runs scored",
    },
    {
      key: "hit_leader",
      title: "Hit Leader",
      subtitle: "Most hits",
    },
    {
      key: "iron_tiger",
      title: "Iron Tiger",
      subtitle: "Most games played",
    },
    {
      key: "gold_glove",
      title: "Gold Glove",
      subtitle: "Most put outs (PO)",
    },
    {
      key: "cannon_arm",
      title: "Cannon Arm",
      subtitle: "Most assists (A)",
    },
    {
      key: "walk_wizard",
      title: "Walk Wizard",
      subtitle: "Most walks (BB)",
    },
    {
      key: "brick_wall",
      title: "The Brick Wall",
      subtitle: "Most hit by pitch (HBP)",
    },
  ];

  const won = new Set<string>();
  const awards: TrophyAward[] = [];

  for (const t of TROPHIES) {
    const award = (() => {
      switch (t.key) {
        case "batting_champ":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => {
              const ab = p.stats.atBats;
              const eligible = ab >= 10;
              return {
                p,
                score: eligible ? safeNum(battingAverage(p)) : -1,
                t1: ab, // more AB wins ties
                t2: pa(p),
                t3: p.stats.games,
              };
            },
            formatValue: (p) => ({
              valueLabel: fmt3(battingAverage(p)),
              valueSub: `${p.stats.hits} H / ${p.stats.atBats} AB`,
            }),
          });

        case "on_base_king":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => {
              const denom = pa(p);
              const eligible = denom >= 10;
              return {
                p,
                score: eligible ? safeNum(onBasePercentage(p)) : -1,
                t1: denom,
                t2: p.stats.hits + p.stats.walks + p.stats.hitByPitch, // times on base
                t3: p.stats.games,
              };
            },
            formatValue: (p) => ({
              valueLabel: fmt3(onBasePercentage(p)),
              valueSub: `${p.stats.hits + p.stats.walks + p.stats.hitByPitch} on base / ${pa(p)} PA`,
            }),
          });

        case "slugger":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => {
              const ab = p.stats.atBats;
              const eligible = ab >= 10;
              return {
                p,
                score: eligible ? safeNum(slugging(p)) : -1,
                t1: ab,
                t2: p.stats.hits,
                t3: p.stats.games,
              };
            },
            formatValue: (p) => ({
              valueLabel: fmt3(slugging(p)),
              valueSub: `2B ${p.stats.doubles} • 3B ${p.stats.triples} • HR ${p.stats.homeRuns}`,
            }),
          });

        case "ops_star":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => {
              const denom = pa(p);
              const eligible = denom >= 10;
              return {
                p,
                score: eligible ? safeNum(ops(p)) : -1,
                t1: denom,
                t2: p.stats.atBats,
                t3: p.stats.games,
              };
            },
            formatValue: (p) => ({
              valueLabel: fmt3(ops(p)),
              valueSub: `OBP ${fmt3(onBasePercentage(p))} + SLG ${fmt3(slugging(p))}`,
            }),
          });

        case "rbi_producer":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.rbi,
              t1: p.stats.hits,
              t2: pa(p),
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.rbi),
              valueSub: `Runs batted in`,
            }),
          });

        case "run_machine":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.runs,
              t1: p.stats.hits + p.stats.walks + p.stats.hitByPitch,
              t2: pa(p),
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.runs),
              valueSub: `Runs scored`,
            }),
          });

        case "hit_leader":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.hits,
              t1: p.stats.atBats,
              t2: p.stats.runs,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.hits),
              valueSub: `Total hits`,
            }),
          });

        case "iron_tiger":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.games,
              t1: pa(p),
              t2: p.stats.atBats,
              t3: p.stats.hits,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.games),
              valueSub: `Games played`,
            }),
          });

        case "gold_glove":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.putOuts,
              t1: p.stats.assists,
              t2: p.stats.games,
              t3: pa(p),
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.putOuts),
              valueSub: `Put outs (PO)`,
            }),
          });

        case "cannon_arm":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.assists,
              t1: p.stats.putOuts,
              t2: p.stats.games,
              t3: pa(p),
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.assists),
              valueSub: `Assists (A)`,
            }),
          });

        case "walk_wizard":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.walks,
              t1: pa(p),
              t2: p.stats.hits,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.walks),
              valueSub: `Walks (BB)`,
            }),
          });

        case "brick_wall":
          return pickUniqueWinner({
            trophy: t,
            players: list,
            alreadyWon: won,
            buildCandidates: (p) => ({
              p,
              score: p.stats.hitByPitch,
              t1: pa(p),
              t2: p.stats.games,
              t3: p.stats.walks,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.hitByPitch),
              valueSub: `Hit by pitch (HBP)`,
            }),
          });

        default:
          return null;
      }
    })();

    if (award) awards.push(award);
  }

  // If your roster isn’t exactly 12, still return all trophies (up to player count unique).
  // The picker already enforces uniqueness; if there are fewer players, some trophies won’t be assigned.
  return awards;
}