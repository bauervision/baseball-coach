
function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Centralized localStorage key builder.
 * Keep prefixes stable so app renames don't force refactors.
 */
export function storageKey(suffix: string) {
  const raw = process.env.NEXT_PUBLIC_STORAGE_PREFIX ?? "baseball-coach";
  const prefix = slugify(raw.length > 0 ? raw : "knexus-app");
  return `${prefix}:${suffix}`;
}

