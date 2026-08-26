import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

/**
* Gate every route by default. New pages are protected the moment they exist
 * rather than the moment someone remembers to add them to a list.
 */
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
