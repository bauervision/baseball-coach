// Permanent player identity.
//
// `careerPlayerId` is the canonical, opaque, permanent player identity. It is
// a random UUID that never encodes name, jersey number, team, or season, and
// it is already stored on every season roster doc
// (seasons/{seasonId}/players/{seasonPlayerId}.careerPlayerId). We keep it as
// the one identity rather than introducing a second, competing id.
//
// What changes is how links are trusted:
// - A season roster doc carries `identityStatus`. Only "confirmed" links
//   (made by an explicit coach action: returning-player import, creating a new
//   player, or an approved migration) count toward career history.
// - Legacy docs have no status. Their careerPlayerId was historically
//   assigned by exact name match, so they are "unreviewed" until a coach
//   approves them. Nothing is ever linked or merged because names match.

export type IdentityStatus = "confirmed" | "unreviewed";

export function newCareerPlayerId(): string {
  return globalThis.crypto.randomUUID();
}

export function normalizeCareerPlayerId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asIdentityStatus(value: unknown): IdentityStatus {
  return value === "confirmed" ? "confirmed" : "unreviewed";
}

/** Lowercase, accent-free, punctuation-free, single-spaced name for search. */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Player edits must never change identity. The existing careerPlayerId is
 * kept; one is minted only for a legacy doc that never had one.
 */
export function careerPlayerIdForEdit(existing: string | undefined): {
  careerPlayerId: string;
  minted: boolean;
} {
  const id = normalizeCareerPlayerId(existing);
  return id
    ? { careerPlayerId: id, minted: false }
    : { careerPlayerId: newCareerPlayerId(), minted: true };
}
