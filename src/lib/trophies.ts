//src/lib/trophies.ts
import type { Player } from "@/lib/roster";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
} from "@/lib/roster";

export type TrophyKey =
  | "mvp"
  | "dominator"
  | "honorable_mention"
  | "best_all_around"
  | "batting_champ"
  | "on_base_king"
  | "slugger"
  | "ops_star"
  | "rbi_producer"
  | "run_machine"
  | "hit_leader"
  | "iron_tiger"
  | "walk_wizard"
  | "tough_as_nails"
  | "strikeout_ace"
  | "speed_demon"
  | "singles_specialist"
  | "doubles_machine"
  | "triples_king"
  | "home_run_king"
  | "gold_glove"
  | "cannon_arm"
  | "hot_streak_hitter"
  | "flyball_trapper"
  | "charlie_hustle"
  | "most_improved"
  | "closer"
  | "best_pitcher"
  | "best_catcher"
  | "best_first_baseman"
  | "best_second_baseman"
  | "best_third_baseman"
  | "best_shortstop"
  | "best_left_fielder"
  | "best_center_fielder"
  | "best_right_fielder";

export type FinalAwardKey =
  | "mvp"
  | "dominator"
  | "honorableMention"
  | "bestAllAround";

export type FinalAwards = Partial<Record<FinalAwardKey, string>>;

export type ComputeTrophiesOptions = {
  endSeasonMode?: boolean;
  finalAwards?: FinalAwards;
};

export type TrophyTone = "primary" | "secondary" | "accent" | "accent2";

export type TrophyDef = {
  key: TrophyKey;
  title: string;
  subtitle: string;
  tone?: TrophyTone;
};

export type TrophyAward = {
  trophy: TrophyDef;
  leaders: Player[];
  winner: Player;
  runnerUp: Player | null;
  valueLabel: string;
  valueSub?: string;
};

export type RunnerUpAward = {
  trophy: TrophyDef;
  winner: Player;
  runnerUp: Player;
  valueLabel: string;
  valueSub?: string;
};

type Candidate = {
  p: Player;
  score: number;
  t1: number;
  t2: number;
  t3: number;
};

type ExtraStatsShape = {
  pitchingStrikeouts?: number;
  stolenBases?: number;
  pitchingSaves?: number;
  flyBallCatches?: number;
  longestHitStreak?: number;
  charlieHustleAwards?: number;
  mostImprovedAwards?: number;
  bestPitcherAwards?: number;
  bestCatcherAwards?: number;
  bestFirstBasemanAwards?: number;
  bestSecondBasemanAwards?: number;
  bestThirdBasemanAwards?: number;
  bestShortstopAwards?: number;
  bestLeftFielderAwards?: number;
  bestCenterFielderAwards?: number;
  bestRightFielderAwards?: number;
};

function pa(p: Player) {
  const s = p.stats;
  return s.atBats + s.walks + s.hitByPitch;
}

function safeNum(n: number) {
  return Number.isFinite(n) ? n : 0;
}

function statsExtras(p: Player): ExtraStatsShape {
  return p.stats as unknown as ExtraStatsShape;
}

function extraStat(p: Player, key: keyof ExtraStatsShape): number {
  const value = statsExtras(p)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function singlesFor(p: Player): number {
  return Math.max(
    0,
    p.stats.hits - p.stats.doubles - p.stats.triples - p.stats.homeRuns,
  );
}

function sortCandidatesDesc(a: Candidate, b: Candidate) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.t1 !== a.t1) return b.t1 - a.t1;
  if (b.t2 !== a.t2) return b.t2 - a.t2;
  if (b.t3 !== a.t3) return b.t3 - a.t3;
  return a.p.name.localeCompare(b.p.name);
}

function sameLeadScore(a: Candidate, b: Candidate): boolean {
  return a.score === b.score;
}

function pickWinner(opts: {
  trophy: TrophyDef;
  players: Player[];
  buildCandidates: (p: Player) => Candidate;
  formatValue: (p: Player) => { valueLabel: string; valueSub?: string };
  requirePositiveScore?: boolean;
}): TrophyAward | null {
  const {
    trophy,
    players,
    buildCandidates,
    formatValue,
    requirePositiveScore = true,
  } = opts;

  const candidates = players.map(buildCandidates).sort(sortCandidatesDesc);
  if (candidates.length === 0) return null;

  const bestOverall = candidates[0];
  if (!Number.isFinite(bestOverall.score)) return null;
  if (requirePositiveScore && bestOverall.score <= 0) return null;

  const winnerCand = candidates.find(
    (c) => !requirePositiveScore || c.score > 0,
  );
  if (!winnerCand) return null;

  const leaders = candidates
    .filter(
      (c) =>
        (!requirePositiveScore || c.score > 0) && sameLeadScore(c, winnerCand),
    )
    .map((c) => c.p);

  const runnerUpCand =
    candidates.find(
      (c) =>
        !sameLeadScore(c, winnerCand) && (!requirePositiveScore || c.score > 0),
    ) ?? null;

  const winner = winnerCand.p;
  const runnerUp = runnerUpCand?.p ?? null;
  const v = formatValue(winner);

  return {
    trophy,
    leaders,
    winner,
    runnerUp,
    valueLabel: v.valueLabel,
    valueSub: v.valueSub,
  };
}

const TROPHIES: TrophyDef[] = [
  {
    key: "mvp",
    title: "MVP",
    subtitle: "Final coach-selected season MVP",
    tone: "primary",
  },
  {
    key: "dominator",
    title: "Dominator",
    subtitle: "Final coach-selected impact award",
    tone: "secondary",
  },
  {
    key: "honorable_mention",
    title: "Honorable Mention",
    subtitle: "Final coach-selected recognition",
    tone: "accent",
  },
  {
    key: "best_all_around",
    title: "Best All-Around",
    subtitle: "Final coach-selected complete player award",
    tone: "accent2",
  },
  {
    key: "batting_champ",
    title: "Batting Champ",
    subtitle: "Highest batting average (min 10 AB)",
    tone: "primary",
  },
  {
    key: "on_base_king",
    title: "On-Base King",
    subtitle: "Highest OBP (min 10 PA)",
    tone: "accent",
  },
  {
    key: "slugger",
    title: "Slugger",
    subtitle: "Highest slugging (min 10 AB)",
    tone: "secondary",
  },
  {
    key: "ops_star",
    title: "OPS Star",
    subtitle: "Best all-around hitter (min 10 PA)",
    tone: "accent2",
  },
  {
    key: "rbi_producer",
    title: "RBI Producer",
    subtitle: "Most RBIs",
    tone: "primary",
  },
  {
    key: "run_machine",
    title: "Run Machine",
    subtitle: "Most runs scored",
    tone: "secondary",
  },
  {
    key: "hit_leader",
    title: "Hit Leader",
    subtitle: "Most hits",
    tone: "accent",
  },
  {
    key: "hot_streak_hitter",
    title: "Hot Streak Hitter",
    subtitle: "Longest hit streak",
    tone: "secondary",
  },
  {
    key: "singles_specialist",
    title: "Singles Specialist",
    subtitle: "Most singles",
    tone: "primary",
  },
  {
    key: "doubles_machine",
    title: "Doubles Machine",
    subtitle: "Most doubles",
    tone: "secondary",
  },
  {
    key: "triples_king",
    title: "Triples King",
    subtitle: "Most triples",
    tone: "accent2",
  },
  {
    key: "home_run_king",
    title: "Home Run King",
    subtitle: "Most home runs",
    tone: "accent",
  },
  {
    key: "walk_wizard",
    title: "Walk Wizard",
    subtitle: "Most walks (BB)",
    tone: "accent",
  },
  {
    key: "tough_as_nails",
    title: "Tough as Nails",
    subtitle: "Takes hits and keeps going",
    tone: "accent2",
  },
  {
    key: "strikeout_ace",
    title: "Strikeout Ace",
    subtitle: "Most pitching strikeouts",
    tone: "primary",
  },
  {
    key: "speed_demon",
    title: "Speed Demon",
    subtitle: "Most stolen bases",
    tone: "secondary",
  },
  {
    key: "iron_tiger",
    title: "Iron Tiger",
    subtitle: "Most games played",
    tone: "accent2",
  },
  {
    key: "gold_glove",
    title: "Gold Glove",
    subtitle: "Most put outs (PO)",
    tone: "secondary",
  },
  {
    key: "cannon_arm",
    title: "Cannon Arm",
    subtitle: "Most assists (A)",
    tone: "primary",
  },
  {
    key: "flyball_trapper",
    title: "Flyball Trapper",
    subtitle: "Most fly-ball catches",
    tone: "accent2",
  },
  {
    key: "closer",
    title: "The Closer",
    subtitle: "Most saves / shutdown finishes",
    tone: "accent",
  },
  {
    key: "best_pitcher",
    title: "Best Pitcher",
    subtitle: "Top fielding impact at P",
    tone: "primary",
  },
  {
    key: "best_catcher",
    title: "Best Catcher",
    subtitle: "Top fielding impact at C",
    tone: "secondary",
  },
  {
    key: "best_first_baseman",
    title: "Best First Baseman",
    subtitle: "Top fielding impact at 1B",
    tone: "accent",
  },
  {
    key: "best_second_baseman",
    title: "Best Second Baseman",
    subtitle: "Top fielding impact at 2B",
    tone: "accent2",
  },
  {
    key: "best_third_baseman",
    title: "Best Third Baseman",
    subtitle: "Top fielding impact at 3B",
    tone: "primary",
  },
  {
    key: "best_shortstop",
    title: "Best Shortstop",
    subtitle: "Top fielding impact at SS",
    tone: "secondary",
  },
  {
    key: "best_left_fielder",
    title: "Best Left Fielder",
    subtitle: "Top fielding impact at LF",
    tone: "accent",
  },
  {
    key: "best_center_fielder",
    title: "Best Center Fielder",
    subtitle: "Top fielding impact at CF",
    tone: "accent2",
  },
  {
    key: "best_right_fielder",
    title: "Best Right Fielder",
    subtitle: "Top fielding impact at RF",
    tone: "primary",
  },
  {
    key: "most_improved",
    title: "Most Improved",
    subtitle: "Coach-selected improvement award",
    tone: "accent",
  },
  {
    key: "charlie_hustle",
    title: "Charlie Hustle",
    subtitle: "Coach-selected hustle award",
    tone: "primary",
  },
];

export function getTrophyDefinitions(): TrophyDef[] {
  return TROPHIES.slice();
}

const FINAL_AWARD_TROPHY_KEYS: Record<FinalAwardKey, TrophyKey> = {
  mvp: "mvp",
  dominator: "dominator",
  honorableMention: "honorable_mention",
  bestAllAround: "best_all_around",
};

function finalAwardForPlayer(opts: {
  trophy: TrophyDef;
  player: Player;
}): TrophyAward {
  const { trophy, player } = opts;

  return {
    trophy,
    leaders: [player],
    winner: player,
    runnerUp: null,
    valueLabel: "Awarded",
    valueSub: "Final coach pick",
  };
}

function computeFinalTrophies(
  players: Player[],
  finalAwards: FinalAwards | undefined,
): TrophyAward[] {
  if (!finalAwards) return [];

  const byId = new Map(players.map((p) => [p.id, p]));
  const usedPlayerIds = new Set<string>();
  const out: TrophyAward[] = [];

  const orderedKeys: FinalAwardKey[] = [
    "mvp",
    "dominator",
    "honorableMention",
    "bestAllAround",
  ];

  for (const finalKey of orderedKeys) {
    const playerId = finalAwards[finalKey];
    if (!playerId || usedPlayerIds.has(playerId)) continue;

    const player = byId.get(playerId);
    if (!player) continue;

    const trophyKey = FINAL_AWARD_TROPHY_KEYS[finalKey];
    const trophy = TROPHIES.find((t) => t.key === trophyKey);
    if (!trophy) continue;

    usedPlayerIds.add(playerId);
    out.push(finalAwardForPlayer({ trophy, player }));
  }

  return out;
}

export function computeTrophies(
  players: Player[],
  options: ComputeTrophiesOptions = {},
): TrophyAward[] {
  const list = players.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (list.length === 0) return [];

  const awards: TrophyAward[] = [];

  if (options.endSeasonMode) {
    awards.push(...computeFinalTrophies(list, options.finalAwards));
  }

  for (const t of TROPHIES) {
    const award = (() => {
      switch (t.key) {
        case "batting_champ":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => {
              const ab = p.stats.atBats;
              const eligible = ab >= 10;
              return {
                p,
                score: eligible ? safeNum(battingAverage(p)) : -1,
                t1: ab,
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
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => {
              const denom = pa(p);
              const eligible = denom >= 10;
              return {
                p,
                score: eligible ? safeNum(onBasePercentage(p)) : -1,
                t1: denom,
                t2: p.stats.hits + p.stats.walks + p.stats.hitByPitch,
                t3: p.stats.games,
              };
            },
            formatValue: (p) => ({
              valueLabel: fmt3(onBasePercentage(p)),
              valueSub: `${p.stats.hits + p.stats.walks + p.stats.hitByPitch} on base / ${pa(p)} PA`,
            }),
          });

        case "slugger":
          return pickWinner({
            trophy: t,
            players: list,
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
          return pickWinner({
            trophy: t,
            players: list,
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
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.rbi,
              t1: p.stats.hits,
              t2: pa(p),
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.rbi),
              valueSub: "Runs batted in",
            }),
          });

        case "run_machine":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.runs,
              t1: p.stats.hits + p.stats.walks + p.stats.hitByPitch,
              t2: pa(p),
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.runs),
              valueSub: "Runs scored",
            }),
          });

        case "hit_leader":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.hits,
              t1: p.stats.atBats,
              t2: p.stats.runs,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.hits),
              valueSub: "Total hits",
            }),
          });

        case "hot_streak_hitter":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "longestHitStreak"),
              t1: p.stats.hits,
              t2: p.stats.atBats,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "longestHitStreak")),
              valueSub: "Game hit streak",
            }),
          });

        case "iron_tiger":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.games,
              t1: pa(p),
              t2: p.stats.hits,
              t3: p.stats.runs,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.games),
              valueSub: "Games played",
            }),
          });

        case "walk_wizard":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.walks,
              t1: pa(p),
              t2: p.stats.runs,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.walks),
              valueSub: "Walks",
            }),
          });

        case "tough_as_nails":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.hitByPitch,
              t1: pa(p),
              t2: p.stats.games,
              t3: p.stats.runs,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.hitByPitch),
              valueSub: "Hit by pitch",
            }),
          });

        case "singles_specialist":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: singlesFor(p),
              t1: p.stats.hits,
              t2: p.stats.atBats,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(singlesFor(p)),
              valueSub: "Singles",
            }),
          });

        case "doubles_machine":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.doubles,
              t1: p.stats.hits,
              t2: p.stats.atBats,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.doubles),
              valueSub: "Doubles",
            }),
          });

        case "triples_king":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.triples,
              t1: p.stats.hits,
              t2: p.stats.runs,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.triples),
              valueSub: "Triples",
            }),
          });

        case "home_run_king":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.homeRuns,
              t1: p.stats.rbi,
              t2: p.stats.hits,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.homeRuns),
              valueSub: "Home runs",
            }),
          });

        case "strikeout_ace":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "pitchingStrikeouts"),
              t1: p.stats.games,
              t2: pa(p),
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "pitchingStrikeouts")),
              valueSub: "Pitching strikeouts",
            }),
          });

        case "speed_demon":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "stolenBases"),
              t1: p.stats.runs,
              t2: pa(p),
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "stolenBases")),
              valueSub: "Stolen bases",
            }),
          });

        case "gold_glove":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.putOuts,
              t1: p.stats.assists,
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.putOuts),
              valueSub: "Putouts",
            }),
          });

        case "cannon_arm":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: p.stats.assists,
              t1: p.stats.putOuts,
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(p.stats.assists),
              valueSub: "Assists",
            }),
          });

        case "flyball_trapper":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "flyBallCatches"),
              t1: p.stats.games,
              t2: p.stats.putOuts,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "flyBallCatches")),
              valueSub: "Fly-ball catches",
            }),
          });

        case "closer":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "pitchingSaves"),
              t1: extraStat(p, "pitchingStrikeouts"),
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "pitchingSaves")),
              valueSub: "Saves / shutdown finishes",
            }),
          });

        case "charlie_hustle":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "charlieHustleAwards"),
              t1: p.stats.games,
              t2: pa(p),
              t3: p.stats.runs,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "charlieHustleAwards")),
              valueSub: "Coach hustle picks",
            }),
          });

        case "most_improved":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "mostImprovedAwards"),
              t1: p.stats.games,
              t2: pa(p),
              t3: p.stats.hits,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "mostImprovedAwards")),
              valueSub: "Coach improvement picks",
            }),
          });

        case "best_pitcher":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestPitcherAwards"),
              t1: extraStat(p, "pitchingStrikeouts"),
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestPitcherAwards")),
              valueSub: "Coach picks at P",
            }),
          });

        case "best_catcher":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestCatcherAwards"),
              t1: p.stats.putOuts,
              t2: p.stats.assists,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestCatcherAwards")),
              valueSub: "Coach picks at C",
            }),
          });

        case "best_first_baseman":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestFirstBasemanAwards"),
              t1: p.stats.putOuts,
              t2: p.stats.assists,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestFirstBasemanAwards")),
              valueSub: "Coach picks at 1B",
            }),
          });

        case "best_second_baseman":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestSecondBasemanAwards"),
              t1: p.stats.assists,
              t2: p.stats.putOuts,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestSecondBasemanAwards")),
              valueSub: "Coach picks at 2B",
            }),
          });

        case "best_third_baseman":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestThirdBasemanAwards"),
              t1: p.stats.assists,
              t2: p.stats.putOuts,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestThirdBasemanAwards")),
              valueSub: "Coach picks at 3B",
            }),
          });

        case "best_shortstop":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestShortstopAwards"),
              t1: p.stats.assists,
              t2: p.stats.putOuts,
              t3: p.stats.games,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestShortstopAwards")),
              valueSub: "Coach picks at SS",
            }),
          });

        case "best_left_fielder":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestLeftFielderAwards"),
              t1: extraStat(p, "flyBallCatches"),
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestLeftFielderAwards")),
              valueSub: "Coach picks at LF",
            }),
          });

        case "best_center_fielder":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestCenterFielderAwards"),
              t1: extraStat(p, "flyBallCatches"),
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestCenterFielderAwards")),
              valueSub: "Coach picks at CF",
            }),
          });

        case "best_right_fielder":
          return pickWinner({
            trophy: t,
            players: list,
            buildCandidates: (p) => ({
              p,
              score: extraStat(p, "bestRightFielderAwards"),
              t1: extraStat(p, "flyBallCatches"),
              t2: p.stats.games,
              t3: 0,
            }),
            formatValue: (p) => ({
              valueLabel: String(extraStat(p, "bestRightFielderAwards")),
              valueSub: "Coach picks at RF",
            }),
          });

        default:
          return null;
      }
    })();

    if (award) awards.push(award);
  }

  return awards;
}

const FINAL_COACH_AWARD_KEYS = new Set<TrophyKey>([
  "mvp",
  "dominator",
  "honorable_mention",
  "best_all_around",
]);

export function computeRunnerUpAwards(
  allAwards: TrophyAward[],
  playerId: string,
): RunnerUpAward[] {
  return allAwards
    .filter((award) => {
      if (FINAL_COACH_AWARD_KEYS.has(award.trophy.key)) {
        return false;
      }

      return award.runnerUp?.id === playerId;
    })
    .map((award) => ({
      trophy: award.trophy,
      winner: award.winner,
      runnerUp: award.runnerUp!,
      valueLabel: award.valueLabel,
      valueSub: award.valueSub,
    }));
}
