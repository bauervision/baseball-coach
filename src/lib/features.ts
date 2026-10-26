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

// Emulator builds only: tests may switch the auth flags per browser context
// (localStorage "bc:feature:<name>" = "1" | "0"). In any other build this
// condition is a constant false and the override is compiled out.
const EMULATOR_BUILD = process.env.BC_EMULATOR_BUILD === "1";

function emulatorOverride(name: string): boolean | null {
  if (!EMULATOR_BUILD || typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(`bc:feature:${name}`);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/**
 * Invitation-only multi-coach mode: Google sign-in, coach workspaces,
 * authorization from coaches/{uid} instead of the admin email allowlist.
 * Presentation only — Firestore rules enforce access either way. Off in
 * production until Google sign-in is enabled and the owner's account is
 * linked (docs/PUBLIC_PRIVATE_DATA.md §5).
 */
export function multiCoachEnabled(): boolean {
  return emulatorOverride("multiCoach") ?? process.env.NEXT_PUBLIC_FEATURE_MULTI_COACH === "1";
}

/** "Link Google account" for the existing password account (also on in multi-coach mode). */
export function googleLinkEnabled(): boolean {
  return emulatorOverride("googleLink") ?? (process.env.NEXT_PUBLIC_FEATURE_GOOGLE_LINK === "1" || multiCoachEnabled());
}
