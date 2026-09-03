import type { MetadataRoute } from "next";

/**
 * Installable to a phone home screen.
 *
 * The difference between a bookmark and a habit. Logging hours happens at the
 * end of a 2am shift, and an icon on the home screen that opens straight to
 * /log removes the "find the laptop" step that is the real reason updates do
 * not get entered.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TavrenOPS",
    short_name: "TavrenOPS",
    description: "Tavren internal operations",
    // Opens on the log screen, not the inbox: the people who install this to a
    // phone are the ones entering hours, not the ones reading dashboards.
    start_url: "/log",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#e8003f",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
