/**
 * Theme selection.
 *
 * Kept out of the "use server" action file because every export of one of those
 * becomes a callable endpoint, and because the layout needs to read the cookie
 * name without pulling in an action.
 */

export const THEME_COOKIE = "tavren_theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

/** Anything unrecognised means "no choice recorded", which is `system`. */
export function parseTheme(value: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "")
    ? (value as Theme)
    : "system";
}
