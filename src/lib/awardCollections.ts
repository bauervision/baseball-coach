// Award artwork collections. A team picks one complete collection; seasons
// snapshot the collection id so historical sheets never change artwork.
//
// Only collections that are both available and complete (every award
// category mapped to bundled artwork) can be selected. Planned collections
// are listed without artwork until a full set is supplied; nothing is
// substituted or faked in the meantime.

import { TROPHY_ART } from "@/lib/trophyArtwork";

export const FALLBACK_TROPHY_ART = "/trophies/trophy.png";

/** Every award category the trophy engine can display. */
export const REQUIRED_AWARD_KEYS: readonly string[] = Object.freeze(Object.keys(TROPHY_ART));

export type AwardCollection = {
  id: string;
  name: string;
  description: string;
  /** Representative artwork for pickers; null until artwork exists. */
  preview: string | null;
  available: boolean;
  art: Readonly<Record<string, string>>;
};

export const AWARD_COLLECTIONS: readonly AwardCollection[] = Object.freeze([
  {
    id: "original",
    name: "Original",
    description: "The original Baseball Coach trophy artwork.",
    preview: "/trophies/mvp.png",
    available: true,
    art: TROPHY_ART,
  },
  {
    id: "girl-power",
    name: "Girl Power",
    description: "Softball-inspired collection. Coming soon.",
    preview: null,
    available: false,
    art: {},
  },
  {
    id: "boys-of-summer",
    name: "Boys of Summer",
    description: "Classic baseball collection. Coming soon.",
    preview: null,
    available: false,
    art: {},
  },
  {
    id: "cyberball",
    name: "Cyberball",
    description: "Futuristic collection. Coming soon.",
    preview: null,
    available: false,
    art: {},
  },
]);

/** Missing award keys (empty = complete). Art must be bundled /trophies/ PNGs. */
export function missingArtwork(c: AwardCollection): string[] {
  return REQUIRED_AWARD_KEYS.filter((k) => {
    const src = c.art[k];
    return !(typeof src === "string" && /^\/trophies\/[a-z0-9-]+\.png$/.test(src));
  });
}

export function isCollectionSelectable(id: unknown): boolean {
  const c = AWARD_COLLECTIONS.find((x) => x.id === id);
  return !!c && c.available && missingArtwork(c).length === 0;
}

export const SELECTABLE_COLLECTION_IDS: readonly string[] = Object.freeze(
  AWARD_COLLECTIONS.filter((c) => isCollectionSelectable(c.id)).map((c) => c.id),
);

/** The art map of a collection; unknown/unavailable -> Original. */
export function collectionArt(collectionId: string | null | undefined): Readonly<Record<string, string>> {
  return isCollectionSelectable(collectionId)
    ? AWARD_COLLECTIONS.find((x) => x.id === collectionId)!.art
    : AWARD_COLLECTIONS[0].art;
}

/** Artwork for an award in a collection; unknown/unavailable -> Original. */
export function trophyArtFor(collectionId: string | null | undefined, key: string): string {
  const c = isCollectionSelectable(collectionId)
    ? AWARD_COLLECTIONS.find((x) => x.id === collectionId)!
    : AWARD_COLLECTIONS[0];
  return c.art[key] ?? FALLBACK_TROPHY_ART;
}
