// Award-slot arrangement for the end-of-season recognition sheet. The sheet
// shows award "cards" in slot order: slot 0 is the large featured panel, the
// next three are the smaller panels, and any further slots appear as
// thumbnails inside Honors Earned (or not at all when there is no room).
//
// The automatic order comes from the trophy engine. A coach may save an
// override, which is only ever a permutation of the cards the player has
// actually earned: it never adds, removes, or changes awards. Saved orders
// are reconciled against the current cards so a stale override can never
// render an award the player no longer holds.
//
// Kept free of imports so it can be unit tested with `node --test`.

export const EARNED_PREFIX = "earned-";
export const RUNNER_UP_PREFIX = "runnerup-";

/** Slots that render as full award panels (featured + three smaller). */
export const PANEL_SLOT_COUNT = 4;

export function earnedCardKey(trophyKey: string): string {
  return `${EARNED_PREFIX}${trophyKey}`;
}

export function runnerUpCardKey(trophyKey: string): string {
  return `${RUNNER_UP_PREFIX}${trophyKey}`;
}

export function isRunnerUpCardKey(cardKey: string): boolean {
  return cardKey.startsWith(RUNNER_UP_PREFIX);
}

/**
 * The automatic card order: earned awards in trophy-engine order, then as
 * many runner-up finishes as the layout has room for.
 */
export function autoCardKeys(
  earnedTrophyKeys: readonly string[],
  runnerUpTrophyKeys: readonly string[],
): string[] {
  const runnerUpLimit =
    earnedTrophyKeys.length >= 4 ? 0 : earnedTrophyKeys.length >= 2 ? 2 : 4;

  return [
    ...earnedTrophyKeys.map(earnedCardKey),
    ...runnerUpTrophyKeys.slice(0, runnerUpLimit).map(runnerUpCardKey),
  ];
}

/**
 * How many slots are pictured on the sheet. Cards beyond this are still
 * counted in Honors Earned but have no artwork on the page.
 */
export function visibleSlotCount(cardCount: number, honorCount: number): number {
  if (cardCount <= PANEL_SLOT_COUNT) return cardCount;

  const thumbnailRoom = honorCount >= 8 ? 3 : honorCount >= 7 ? 2 : 0;
  return PANEL_SLOT_COUNT + Math.min(cardCount - PANEL_SLOT_COUNT, thumbnailRoom);
}

/** A saved order as read from Firestore; anything malformed is ignored. */
export function normalizeSavedOrder(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item && !out.includes(item)) out.push(item);
  }
  return out.length ? out : null;
}

/** The featured slot holds an earned award whenever the player has one. */
function featuredSlotValid(order: readonly string[]): boolean {
  if (order.length === 0 || !isRunnerUpCardKey(order[0])) return true;
  return order.every(isRunnerUpCardKey);
}

/**
 * Applies a saved order to the current cards. Valid saved keys keep their
 * slot; slots whose saved award is gone are filled first by valid saved keys
 * that no longer fit, then by new awards in automatic order. The result is
 * always exactly a permutation of `autoKeys`.
 */
export function reconcileOrder(
  autoKeys: readonly string[],
  saved: readonly string[] | null | undefined,
): string[] {
  if (!saved || saved.length === 0) return autoKeys.slice();

  const available = new Set(autoKeys);
  const slots: (string | null)[] = autoKeys.map(() => null);
  const used = new Set<string>();

  saved.forEach((key, i) => {
    if (i < slots.length && available.has(key) && !used.has(key)) {
      slots[i] = key;
      used.add(key);
    }
  });

  const leftovers = [
    ...saved.filter((key) => available.has(key) && !used.has(key)),
    ...autoKeys.filter((key) => !saved.includes(key)),
  ];

  const out = slots.map((key) => key ?? (leftovers.shift() as string));

  if (!featuredSlotValid(out)) {
    const earnedIndex = out.findIndex((key) => !isRunnerUpCardKey(key));
    [out[0], out[earnedIndex]] = [out[earnedIndex], out[0]];
  }

  return out;
}

/** Whether swapping slots `from` and `to` yields a valid arrangement. */
export function canSwapSlots(
  order: readonly string[],
  from: number,
  to: number,
): boolean {
  if (from === to) return false;
  if (from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return false;
  }
  return featuredSlotValid(swapSlots(order, from, to));
}

/** Swaps two slots; the caller checks `canSwapSlots` first. */
export function swapSlots(
  order: readonly string[],
  from: number,
  to: number,
): string[] {
  const out = order.slice();
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

export function sameOrder(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}
