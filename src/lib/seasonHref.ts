// URL helper for the viewed season (?season=). See viewedSeason.tsx.

/**
 * Adds (or removes) ?season= on an href. Pass null, or the active season
 * id, to link to the active-season view.
 */
export function withSeason(
  href: string,
  seasonId: string | null | undefined,
  activeSeasonId?: string | null,
): string {
  const [pathAndQuery, hash = ""] = href.split("#");
  const [path, query = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  if (seasonId && seasonId !== activeSeasonId) params.set("season", seasonId);
  else params.delete("season");
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
