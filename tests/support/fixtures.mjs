// Fixture: two legacy Tigers seasons coached by the same coach.
// Four players (Ava, Ben, Cole, Dana) played both seasons; their legacy
// careerPlayerIds were shared by the old exact-name matching and are not
// yet confirmed. Ben changed number (#12 → #21). Two different children
// named Jordan Kim played one season each with different ids. Fixture data
// only; it is not production data.

export const COACH_UID = "coach-mike";
export const OTHER_COACH_UID = "coach-other";

export const IDS = {
  ava: "11111111-1111-4111-8111-111111111111",
  ben: "22222222-2222-4222-8222-222222222222",
  cole: "33333333-3333-4333-8333-333333333333",
  dana: "44444444-4444-4444-8444-444444444444",
  eli: "55555555-5555-4555-8555-555555555555",
  finn: "66666666-6666-4666-8666-666666666666",
  jordanA: "77777777-7777-4777-8777-777777777777",
  jordanB: "88888888-8888-4888-8888-888888888888",
};

export function stats(overrides = {}) {
  return {
    games: 0,
    plateAppearances: 0,
    atBats: 0,
    hits: 0,
    currentHitStreak: 0,
    longestHitStreak: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    runs: 0,
    rbi: 0,
    walks: 0,
    hitByPitch: 0,
    stolenBases: 0,
    putOuts: 0,
    assists: 0,
    pitchingStrikeouts: 0,
    pitchingSaves: 0,
    flyBallCatches: 0,
    charlieHustleAwards: 0,
    mostImprovedAwards: 0,
    bestPitcherAwards: 0,
    bestCatcherAwards: 0,
    bestFirstBasemanAwards: 0,
    bestSecondBasemanAwards: 0,
    bestThirdBasemanAwards: 0,
    bestShortstopAwards: 0,
    bestLeftFielderAwards: 0,
    bestCenterFielderAwards: 0,
    bestRightFielderAwards: 0,
    ...overrides,
  };
}

function player(id, name, number, careerPlayerId, s, extra = {}) {
  return { id, data: { name, number, careerPlayerId, stats: stats(s), ...extra } };
}

function line(playerId, name, number, delta) {
  return { id: playerId, data: { playerId, name, number, delta } };
}

export function legacySnapshot() {
  return {
    exportedAt: new Date().toISOString(),
    config: { currentSeasonId: "tigers-fall-2026" },
    seasons: [
      {
        seasonId: "tigers-2026",
        data: {
          teamName: "Tigers",
          seasonLabel: "Spring 2026",
          record: { wins: 6, losses: 2, ties: 0 },
          gamesPlayed: 8,
          endSeasonMode: true,
          finalAwards: { mvp: "07-ava-carter" },
        },
        players: [
          player("07-ava-carter", "Ava Carter", 7, IDS.ava, { games: 8, atBats: 20, hits: 9, longestHitStreak: 4, charlieHustleAwards: 1 }),
          player("12-ben-diaz", "Ben Diaz", 12, IDS.ben, { games: 8, atBats: 18, hits: 5, longestHitStreak: 2 }),
          player("03-cole-evans", "Cole Evans", 3, IDS.cole, { games: 7, atBats: 15, hits: 6 }),
          player("09-dana-fox", "Dana Fox", 9, IDS.dana, { games: 8, atBats: 19, hits: 7 }),
          player("05-eli-grant", "Eli Grant", 5, IDS.eli, { games: 6, atBats: 12, hits: 3 }),
          player("08-jordan-kim", "Jordan Kim", 8, IDS.jordanA, { games: 5, atBats: 10, hits: 2 }),
        ],
        games: [
          {
            id: "20260410-bears-1",
            data: { date: "2026-04-10", opponent: "Bears", result: "W" },
            lines: [
              line("07-ava-carter", "Ava Carter", 7, { atBats: 3, hits: 2 }),
              line("12-ben-diaz", "Ben Diaz", 12, { atBats: 3, hits: 1 }),
            ],
          },
        ],
      },
      {
        seasonId: "tigers-fall-2026",
        data: {
          teamName: "Tigers",
          seasonLabel: "Fall 2026",
          record: { wins: 5, losses: 3, ties: 1 },
          gamesPlayed: 9,
          endSeasonMode: true,
          finalAwards: { mvp: "09-dana-fox", bestAttitude: "07-ava-carter" },
          recognitionLayouts: { "07-ava-carter": { order: ["earned-mvp"] } },
        },
        players: [
          player("07-ava-carter", "Ava Carter", 7, IDS.ava, { games: 9, atBats: 25, hits: 11, longestHitStreak: 3 }, { returningPlayer: true }),
          // Ben switched to #21; his doc id still says 12 from a rebuild.
          player("21-ben-diaz", "Ben Diaz", 21, IDS.ben, { games: 9, atBats: 22, hits: 8, longestHitStreak: 5 }, { returningPlayer: true }),
          player("03-cole-evans", "Cole Evans", 3, IDS.cole, { games: 9, atBats: 21, hits: 7 }, { returningPlayer: true }),
          player("09-dana-fox", "Dana Fox", 9, IDS.dana, { games: 9, atBats: 24, hits: 12 }, { returningPlayer: true }),
          player("11-finn-hale", "Finn Hale", 11, IDS.finn, { games: 9, atBats: 20, hits: 6 }),
          player("10-jordan-kim", "Jordan Kim", 10, IDS.jordanB, { games: 9, atBats: 18, hits: 6 }),
        ],
        games: [
          {
            id: "20260915-owls-1",
            data: {
              date: "2026-09-15",
              opponent: "Owls",
              result: "W",
              gameBall: { playerId: "09-dana-fox", playerName: "Dana Fox", playerNumber: 9 },
            },
            lines: [
              line("07-ava-carter", "Ava Carter", 7, { atBats: 3, hits: 1 }),
              line("21-ben-diaz", "Ben Diaz", 21, { atBats: 3, hits: 2 }),
              // Orphan: written under Ben's old doc id before a rebuild (D3).
              line("12-ben-diaz", "Ben Diaz", 12, { atBats: 2, hits: 0 }),
            ],
          },
        ],
      },
    ],
  };
}

/** Snapshot → RosterSeasonInput[] for playerSearch. */
export function rosterSeasons(snapshot, extra = {}) {
  return snapshot.seasons.map((s) => ({
    seasonId: s.seasonId,
    teamName: s.data.teamName,
    seasonLabel: s.data.seasonLabel,
    coachUids: s.data.coachUids,
    ...(extra[s.seasonId] ?? {}),
    players: s.players.map((p) => ({
      id: p.id,
      name: p.data.name,
      number: p.data.number,
      careerPlayerId: p.data.careerPlayerId,
      identityStatus: p.data.identityStatus,
      linkedFrom: p.data.linkedFrom,
    })),
  }));
}

/** Snapshot entry → ParticipationDoc for careerHistory. */
export function participation(snapshot, seasonId, seasonPlayerId, override = {}) {
  const s = snapshot.seasons.find((x) => x.seasonId === seasonId);
  const p = s.players.find((x) => x.id === seasonPlayerId);
  return {
    seasonId,
    seasonPlayerId,
    careerPlayerId: p.data.careerPlayerId,
    identityStatus: p.data.identityStatus,
    linkedFrom: p.data.linkedFrom ?? [],
    name: p.data.name,
    number: p.data.number,
    stats: p.data.stats,
    season: {
      teamName: s.data.teamName,
      seasonLabel: s.data.seasonLabel,
      endSeasonMode: s.data.endSeasonMode,
      finalAwards: s.data.finalAwards,
    },
    ...override,
  };
}
