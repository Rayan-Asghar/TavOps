/**
 * List density.
 *
 * DESIGN-STANDARD C4 asks for a density control, and §1.1 explains why it
 * belongs on this page in particular: the data zone wants 32–40px rows, but
 * Projects is a card grid, which is chrome-density. Two people looking at three
 * projects want the cards; the same two looking at thirty want a list.
 *
 * Kept out of a `"use server"` file for the same reason `theme.ts` is: every
 * export of one of those becomes a callable endpoint, and the layout needs to
 * read the cookie name without pulling in an action.
 */

export const DENSITY_COOKIE = "tavren_density";

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export const DENSITY_LABEL: Record<Density, string> = {
  comfortable: "Cards",
  compact: "List",
};

/** Anything unrecognised means the default. */
export function parseDensity(value: string | null | undefined): Density {
  return (DENSITIES as readonly string[]).includes(value ?? "")
    ? (value as Density)
    : "comfortable";
}
