import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

/**
* Gate every route by default. New pages are protected the moment they exist
 * rather than the moment someone remembers to add them to a list.
 */
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  // The manifest must stay public: a browser fetches it before anyone has
  // signed in, and behind the session gate it comes back as a login redirect,
  // which silently kills the "add to home screen" prompt.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.png$).*)",
  ],
};
