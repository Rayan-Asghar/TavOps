"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DENSITY_COOKIE, parseDensity } from "@/lib/density";

/**
 * Records the viewer's list density in a cookie.
 *
 * Same reasoning as `setTheme`: the page is server rendered, so the density has
 * to be known at render time or the list reflows after first paint. It is a
 * display preference on the caller's own browser, reads nothing, and so needs no
 * actor check.
 *
 * The audit found no persisted UI preference anywhere in the app — a density you
 * have to re-pick on every visit is not a preference, it is a filter.
 */
export async function setDensity(formData: FormData) {
  const density = parseDensity(String(formData.get("density") ?? ""));
  const jar = await cookies();
  jar.set(DENSITY_COOKIE, density, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/projects");
}
