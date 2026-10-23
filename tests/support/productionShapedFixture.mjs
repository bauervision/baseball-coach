// Production-shaped fixture: the same document kinds, counts, field names,
// value types, and legacy quirks as the production Tigers export verified
// on 2026-10-23, with invented names and numbers. No child data from
// production appears here.
//
// Quirks reproduced on purpose:
// - Spring 2026 (tigers-2026) has no teamName/seasonLabel/createdAt, keeps
//   the literal dotted legacy fields "record.wins"/"record.losses", has a
//   31-key stats map (extra "strikeouts"), p01-style player ids with
//   bats/throws/primaryPos, and no careerPlayerId on players.
// - Fall 2026 (tigers-fall-2026) is current, uses gamesPlayed records, has
//   NN-first-last / pNN-first-last ids with unconfirmed careerPlayerIds,
//   recognition layouts, game balls, lineup snapshots on some games, and
//   one game without gameType.
// - Jersey numbers are integers. Four players returned; one changed number
//   (#999 → #500).
//
// productionShapedSnapshot({ migrated: true }) is the state after the
// approved identity migration (Spring entries linked and confirmed).

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const INNING_SPOTS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF", "BENCH"];
const SIZES = ["YS", "YM", "YL", "YXL", "AM"];
const DELTA_KEYS = [
  "atBats", "hits", "doubles", "triples", "homeRuns", "runs", "rbi", "walks", "hitByPitch",
  "stolenBases", "putOuts", "assists", "pitchingStrikeouts", "pitchingSaves", "flyBallCatches",
];
const AWARD_KEYS = [
  "charlieHustle", "mostImproved", "bestPitcher", "bestCatcher", "bestFirstBaseman", "bestSecondBaseman",
  "bestThirdBaseman", "bestShortstop", "bestLeftFielder", "bestCenterFielder", "bestRightFielder",
];

// The four returning players' permanent ids (the Fall ids).
export const PS_IDS = {
  alex: "a1a1a1a1-0000-4000-8000-000000000001",
  blake: "b2b2b2b2-0000-4000-8000-000000000002",
  casey: "c3c3c3c3-0000-4000-8000-000000000003",
  drew: "d4d4d4d4-0000-4000-8000-000000000004",
};

const SPRING = [
  ["Alex Rivera", 21, "alex"], ["Blake Turner", 999, "blake"], ["Casey Morgan", 24, "casey"],
  ["Drew Parker", 83, "drew"], ["Emery Lane", 7], ["Finley Brooks", 12], ["Gray Holt", 4],
  ["Harper Quinn", 15], ["Indy Shaw", 9], ["Jules Voss", 33], ["Kai Monroe", 2], ["Logan Pike", 18],
];
const FALL = [
  ["Alex Rivera", 21, "alex", "21-alex-rivera"], ["Blake Turner", 500, "blake", "500-blake-turner"],
  ["Casey Morgan", 24, "casey", "24-casey-morgan"], ["Drew Parker", 83, "drew", "p10-drew-parker"],
  ["Morgan Ellis", 3, null, "03-morgan-ellis"], ["Nico Vance", 5, null, "05-nico-vance"],
  ["Oakley Reed", 11, null, "p11-oakley-reed"], ["Parker Hale", 14, null, "14-parker-hale"],
  ["Quinn Avery", 27, null, "p02-quinn-avery"], ["Rowan Fisk", 30, null, "30-rowan-fisk"],
  ["Sage Mills", 44, null, "p05-sage-mills"],
];
const OPPONENTS = ["Comets", "Rockets", "Owls", "Bears", "Sharks", "Wolves", "Hornets", "Bison", "Storm", "Eagles", "Pirates"];

function rng(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

function uuid(r) {
  const h = () => r(16).toString(16);
  const part = (n) => Array.from({ length: n }, h).join("");
  return `${part(8)}-${part(4)}-4${part(3)}-8${part(3)}-${part(12)}`;
}

const at = (iso) => new Date(iso);

function emptyStats(extra) {
  const s = { games: 0, plateAppearances: 0, currentHitStreak: 0, longestHitStreak: 0 };
  for (const k of DELTA_KEYS) s[k] = 0;
  for (const k of AWARD_KEYS) s[`${k}Awards`] = 0;
  return { ...s, ...extra };
}

function buildSeason({ roster, gameCount, linesPerGame, startDate, seed, fall }) {
  const r = rng(seed);
  const players = roster.map((p) => ({ ...p, stats: emptyStats(fall ? {} : { strikeouts: 0 }), streak: 0 }));
  const games = [];
  const results = { W: 0, L: 0, T: 0 };
  for (let g = 0; g < gameCount; g++) {
    const date = new Date(Date.parse(startDate) + g * 7 * 864e5).toISOString().slice(0, 10);
    const lineCount = linesPerGame[g];
    const playing = [...players].sort((a, b) => ((a.seq * 7 + g * 3) % 13) - ((b.seq * 7 + g * 3) % 13)).slice(0, lineCount);
    const lines = playing.map((p) => {
      const atBats = 2 + r(2);
      const hits = r(atBats + 1);
      const delta = Object.fromEntries(DELTA_KEYS.map((k) => [k, 0]));
      Object.assign(delta, {
        atBats, hits, doubles: hits > 1 ? r(2) : 0, runs: r(2), rbi: r(2), walks: r(2),
        hitByPitch: r(6) === 0 ? 1 : 0, stolenBases: r(2), putOuts: r(3), assists: r(2),
        pitchingStrikeouts: p.pos === "P" ? r(4) : 0, flyBallCatches: r(2),
      });
      const s = p.stats;
      s.games += 1;
      for (const k of DELTA_KEYS) s[k] += delta[k];
      s.plateAppearances += delta.atBats + delta.walks + delta.hitByPitch;
      if (!fall) s.strikeouts += r(2);
      p.streak = hits > 0 ? p.streak + 1 : 0;
      s.currentHitStreak = p.streak;
      s.longestHitStreak = Math.max(s.longestHitStreak, p.streak);
      return { id: p.id, data: { playerId: p.id, name: p.name, number: p.number, delta } };
    });
    const ref = (p) => ({ playerId: p.id, playerName: p.name, playerNumber: p.number });
    const awardKeys = fall ? AWARD_KEYS.filter((k) => k !== "bestSecondBaseman" && k !== "bestCenterFielder") : AWARD_KEYS;
    const coachAwards = {};
    for (const k of awardKeys.filter((_, i) => (i + g) % 3 === 0)) {
      const p = playing[r(playing.length)];
      coachAwards[k] = ref(p);
      p.stats[`${k}Awards`] += 1;
    }
    const us = r(9), them = r(11);
    const result = us > them ? "W" : us < them ? "L" : "T";
    results[result] += 1;
    const data = {
      date, opponent: OPPONENTS[g % OPPONENTS.length], result, score: { us, them }, coachAwards,
      createdAt: at(`${date}T23:00:00Z`), updatedAt: at(`${date}T23:30:00Z`),
    };
    if (fall) {
      data.gameBall = ref(playing[0]);
      if (g !== 4) data.gameType = g === 2 ? "scrimmage" : "regular";
      if (g >= gameCount - 6) {
        data.lineupSnapshot = {
          capturedAtISO: `${date}T22:00:00.000Z`, inningCount: 6,
          rows: playing.map((p, i) => ({ playerId: p.id, battingOrder: i + 1, hiddenFromLineup: false, innings: innings(i, g) })),
        };
      }
    }
    games.push({ id: `${date.replace(/-/g, "")}-${data.opponent.toLowerCase()}-${1790000000000 + g}`, data, lines });
  }
  return { players, games, results };
}

function innings(i, g) {
  return Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), INNING_SPOTS[(i + n + g) % INNING_SPOTS.length]]));
}

function lineup(seasonId, roster, withHidden) {
  return {
    id: "current",
    data: {
      id: "current", seasonId, title: "Game lineup", inningCount: 6,
      createdAtISO: "2026-09-01T12:00:00.000Z", updatedAtISO: "2026-10-10T12:00:00.000Z", updatedAt: at("2026-10-10T12:00:00Z"),
      rows: roster.map((p, i) => ({ playerId: p.id, battingOrder: i + 1, innings: innings(i, 0), ...(withHidden ? { hiddenFromLineup: false } : {}) })),
    },
  };
}

export function productionShapedSnapshot({ migrated = false } = {}) {
  const r = rng(2026);
  const spring = SPRING.map(([name, number, key], i) => ({
    seq: i, key, name, number, id: `p${String(i + 1).padStart(2, "0")}`, pos: POSITIONS[i % POSITIONS.length],
  }));
  const fall = FALL.map(([name, number, key, id], i) => ({
    seq: i, key, name, number, id, pos: POSITIONS[(i + 2) % POSITIONS.length], careerPlayerId: key ? PS_IDS[key] : uuid(r),
  }));

  const S = buildSeason({ seasonId: "tigers-2026", roster: spring, gameCount: 11, linesPerGame: [8, 8, 9, 9, 10, 10, 10, 11, 11, 11, 12], startDate: "2026-03-14", seed: 11, fall: false });
  const F = buildSeason({ seasonId: "tigers-fall-2026", roster: fall, gameCount: 11, linesPerGame: [8, 8, 9, 9, 9, 10, 11, 11, 11, 11, 11], startDate: "2026-08-22", seed: 22, fall: true });

  const springPlayers = S.players.map((p, i) => ({
    id: p.id,
    data: {
      id: p.id, name: p.name, number: p.number, bats: ["R", "L", "S"][i % 3], throws: ["R", "L"][i % 2], primaryPos: p.pos,
      shirtSize: SIZES[i % SIZES.length], stats: p.stats, updatedAt: at("2026-06-01T12:00:00Z"),
      ...(i === 11 ? { leaderboardHidden: true } : {}),
      ...(migrated && p.key ? { careerPlayerId: PS_IDS[p.key], identityStatus: "confirmed" } : {}),
    },
  }));
  const fallPlayers = F.players.map((p, i) => ({
    id: p.id,
    data: {
      id: p.id, name: p.name, number: p.number, careerPlayerId: p.careerPlayerId, returningPlayer: !!p.key,
      leaderboardHidden: false, shirtSize: SIZES[(i + 2) % SIZES.length], stats: p.stats,
      createdAt: at("2026-08-15T12:00:00Z"), updatedAt: at("2026-10-20T12:00:00Z"),
      ...(migrated && p.key ? { identityStatus: "confirmed" } : {}),
    },
  }));

  const fallLayouts = Object.fromEntries(
    fallPlayers.slice(0, 8).map((p) => [p.id, { order: ["mvp", "hits", "rbi"], updatedAt: at("2026-10-19T12:00:00Z") }]),
  );
  return {
    config: { currentSeasonId: "tigers-fall-2026", updatedAt: at("2026-08-16T12:00:00Z") },
    admins: { enabled: true },
    seasons: [
      {
        seasonId: "tigers-2026",
        data: {
          league: "Mustang", endSeasonMode: true,
          finalAwards: { mvp: "p01", dominator: "p03", honorableMention: "p05", bestAllAround: "p02" },
          record: { wins: S.results.W, losses: S.results.L, ties: S.results.T },
          "record.wins": S.results.W, "record.losses": S.results.L,
          updatedAt: at("2026-06-01T12:00:00Z"),
        },
        players: springPlayers,
        games: S.games,
        lineups: [lineup("tigers-2026", spring, false)],
      },
      {
        seasonId: "tigers-fall-2026",
        data: {
          teamName: "Tigers", seasonLabel: "Fall 2026", endSeasonMode: false,
          finalAwards: { mvp: "", dominator: "", honorableMention: "", bestAllAround: "", bestAttitude: "" },
          gamesPlayed: 10, scheduledGames: 10, usesGamesPlayedRecord: true,
          record: { wins: F.results.W, losses: F.results.L, ties: F.results.T },
          recognitionLayouts: fallLayouts,
          createdAt: at("2026-08-15T12:00:00Z"), updatedAt: at("2026-10-20T12:00:00Z"),
        },
        players: fallPlayers,
        games: F.games,
        lineups: [lineup("tigers-fall-2026", fall, true)],
      },
    ],
  };
}

/** Approvals in the identity tool's format for the four returning players. */
export function productionShapedApprovals() {
  const pairs = [["alex", "p01", "21-alex-rivera"], ["blake", "p02", "500-blake-turner"], ["casey", "p03", "24-casey-morgan"], ["drew", "p04", "p10-drew-parker"]];
  return pairs.map(([key, springId, fallId]) => ({
    decision: "approve",
    careerPlayerId: PS_IDS[key],
    members: [
      { seasonId: "tigers-2026", seasonPlayerId: springId },
      { seasonId: "tigers-fall-2026", seasonPlayerId: fallId },
    ],
  }));
}
