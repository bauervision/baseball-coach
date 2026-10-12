// Shared editing rules for admin whole-number inputs (scores, stat lines,
// jersey numbers, scheduled games). The field keeps a raw text draft while
// focused and only normalizes on blur, so temporary empty states are fine.
//
// Kept free of imports so it can be unit tested with `node --test`.

const DIGITS_ONLY = /^\d*$/;

/**
 * Next draft text for a keystroke, or null to reject the change (keep the
 * previous draft). Only nonnegative integers are accepted.
 *
 * When the field held just the placeholder "0" and the caret sat after it,
 * typing "7" yields "07" — that zero is dropped so the result is "7". Any
 * other text (e.g. editing "105" down to "05") is left alone until blur.
 */
export function nextNumericDraft(prev: string, raw: string): string | null {
  const text = raw.trim();
  if (!DIGITS_ONLY.test(text)) return null;

  if (prev === "0" && text.length > 1 && text.startsWith("0")) {
    return text.replace(/^0+(?=\d)/, "");
  }

  return text;
}

/** Numeric value of a draft; an empty draft reads as `emptyValue`. */
export function parseNumericDraft(draft: string, emptyValue = 0): number {
  const text = draft.trim();
  if (!text) return emptyValue;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? Math.max(0, n) : emptyValue;
}

/**
 * Canonical text committed on blur: leading zeros stripped, and an empty
 * draft becomes "0" unless the field allows empty (optional values).
 */
export function normalizeNumericDraft(
  draft: string,
  allowEmpty = false,
): string {
  const text = draft.trim();
  if (!text) return allowEmpty ? "" : "0";
  return String(parseNumericDraft(text));
}
