// Build-time feature flags.
//
// PLAYER_REGISTRY gates everything that reads or writes the private
// collections `playerIdentities` and `coachProfiles/{uid}/linkedPlayers`
// (My Players, linked-child preselection, registry upserts on import).
// Those collections are denied by the currently deployed rules, so keep this
// off until the updated firestore.rules are reviewed, emulator-tested, and
// deployed. Enable with NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY=1.
export const PLAYER_REGISTRY_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY === "1";
