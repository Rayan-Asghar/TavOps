"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

/**
 * Records the viewer's theme in a cookie.
 *
 * A cookie rather than localStorage because every page here is server
 * rendered: the layout has to know the theme at render time, or the first
 * paint is the wrong colour and then snaps. That does opt the app into dynamic
 * rendering, which costs nothing — every real page is already dynamic through
 * `getActor()`.
 *
 * Deliberately unauthenticated. It sets a display preference on the caller's
 * own browser and reads nothing, so there is no actor to check.
 */
export async function setTheme(formData: FormData) {
  const theme = parseTheme(String(formData.get("theme") ?? ""));
  const jar = await cookies();

  if (theme === "system") {
    // No cookie means "follow the OS", which the CSS handles via a guarded
    // prefers-color-scheme block.
    jar.delete(THEME_COOKIE);
  } else {
    jar.set(THEME_COOKIE, theme, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/", "layout");
}
