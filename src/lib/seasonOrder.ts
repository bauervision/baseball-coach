// Chronological ordering for seasons. Season labels ("Spring 2026",
// "Fall 2026") are the most reliable signal: createdAt could be reset by the
// legacy Season Update action, so it is only a fallback.

const TERM_ORDER: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
  autumn: 3,
};

export function seasonSortKey(label: string, createdAtMs?: number): number {
  const text = label.toLowerCase();
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (year) {
    const term = Object.keys(TERM_ORDER).find((t) => text.includes(t));
    return Number(year[0]) * 10 + (term ? TERM_ORDER[term] : 5);
  }
  if (typeof createdAtMs === "number" && Number.isFinite(createdAtMs)) {
    // Convert to a comparable year*10 scale.
    return (1970 + createdAtMs / (365.25 * 24 * 3600 * 1000)) * 10;
  }
  return 0;
}
