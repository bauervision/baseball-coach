// Permanent team routes (Tallies, multi-coach mode). Pure functions only.
//
//   /teams/{teamId}/                                  the team's published current season
//   /teams/{teamId}/seasons/{seasonId}/home           a published season (history)
//   /teams/{teamId}/seasons/{seasonId}/trophies       its trophy case
//   /teams/{teamId}/seasons/{seasonId}/players/{id}   a player (stats, awards, recognition sheet, print)
//
// Ids are the stable Firestore document ids. URLs never carry a coach uid or
// email, a team name, a division, or a location. The static export serves
// one prerendered shell for every /teams/** path (Hosting rewrite), and the
// client parses the real path with parseTeamPath.

export type TeamRouteView = "home" | "trophies" | "player";

export type TeamRoute = {
  teamId: string;
  /** null = the team's published current season (the permanent link). */
  seasonId: string | null;
  view: TeamRouteView;
  playerId: string | null;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

function segment(raw: string): string | null {
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return ID.test(s) ? s : null;
}

/**
 * null: not a team route. "invalid": under /teams/ but malformed (shown as
 * not found, never as another team or the legacy current season).
 */
export function parseTeamPath(pathname: string): TeamRoute | "invalid" | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts[0] !== "teams") return null;
  const teamId = parts[1] ? segment(parts[1]) : null;
  if (!teamId) return "invalid";
  if (parts.length === 2) return { teamId, seasonId: null, view: "home", playerId: null };
  if (parts[2] !== "seasons" || !parts[3]) return "invalid";
  const seasonId = segment(parts[3]);
  if (!seasonId) return "invalid";
  if (parts.length === 5 && (parts[4] === "home" || parts[4] === "trophies")) {
    return { teamId, seasonId, view: parts[4], playerId: null };
  }
  if (parts.length === 6 && parts[4] === "players") {
    const playerId = segment(parts[5]);
    return playerId ? { teamId, seasonId, view: "player", playerId } : "invalid";
  }
  return "invalid";
}

const enc = encodeURIComponent;

/** The permanent link a coach shares; the same in every season. */
export function teamHref(teamId: string): string {
  return `/teams/${enc(teamId)}/`;
}

export function seasonHomeHref(teamId: string, seasonId: string): string {
  return `/teams/${enc(teamId)}/seasons/${enc(seasonId)}/home/`;
}

export function seasonTrophiesHref(teamId: string, seasonId: string): string {
  return `/teams/${enc(teamId)}/seasons/${enc(seasonId)}/trophies/`;
}

export function seasonPlayerHref(teamId: string, seasonId: string, playerId: string): string {
  return `/teams/${enc(teamId)}/seasons/${enc(seasonId)}/players/${enc(playerId)}/`;
}

/** Absolute share URL for "Copy team link" (origin of the running site). */
export function teamShareUrl(origin: string, teamId: string): string {
  return `${origin.replace(/\/+$/, "")}${teamHref(teamId)}`;
}
