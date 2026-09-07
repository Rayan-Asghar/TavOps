/**
 * Validating a saved view.
 *
 * A view is a name plus a URL, and a URL a user supplies is the classic way to
 * turn a convenience feature into an open redirect: save a "view" pointing at
 * another origin, share it with a colleague, and the app's own navigation
 * walks them off it. So the path is checked against a fixed list rather than
 * merely being made to look relative — a deny-list of dangerous shapes is a
 * game you lose eventually, an allow-list is not.
 *
 * Pure, so every hostile shape can be tested without a database.
 */

/** Screens that can hold a saved view. Adding one is a deliberate edit. */
export const SAVEABLE_PATHS = [
  "/tasks",
  "/projects",
  "/reports",
  "/clients",
  "/audit",
] as const;

export type SaveablePath = (typeof SAVEABLE_PATHS)[number];

export function isSaveablePath(path: string): path is SaveablePath {
  return (SAVEABLE_PATHS as readonly string[]).includes(path);
}

/**
 * Normalises a query string: drops the leading `?`, removes paging (a saved
 * view means a set of filters, not page 4 of them) and anything empty, and
 * sorts the keys so the same filters always produce the same stored string.
 */
export function normaliseViewQuery(raw: string): string {
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  params.delete("page");

  const kept: [string, string][] = [];
  for (const [k, v] of params) {
    if (v.trim() === "") continue;
    kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return new URLSearchParams(kept).toString();
}

/** The href a saved view points at. Built here so nothing ever concatenates a
 *  stored string onto a path by hand. */
export function viewHref(path: SaveablePath, query: string): string {
  return query ? `${path}?${query}` : path;
}
