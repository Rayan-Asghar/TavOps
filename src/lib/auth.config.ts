import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth setup.
 *
 * The proxy runs on the edge runtime, where bcrypt and the Postgres driver
 * cannot load. Keeping the providers out of this file is what lets the proxy
 * import it without dragging Node-only dependencies into the edge bundle.
 *
 * ## This file is LIVE. Do not delete `authorized`.
 *
 * Next.js 16 renamed Middleware to Proxy, so the file that consumes this is
 * `src/proxy.ts`, not `middleware.ts`. Searching the repo for `middleware.ts`
 * finds nothing and makes `authorized` look like dead code — it is not. It runs
 * on every request matched by the proxy's matcher and is what gates new routes
 * by default. Removing it would leave only the per-page `getActor()` checks,
 * so any page that forgot one would become public.
 */
/**
 * Copies the fields the session is built from onto the token.
 *
 * Shared with the Node-side instance in `auth.ts`, which cannot reuse the `jwt`
 * callback wholesale — a Google sign-in has to resolve the Tavren user by email
 * first, and that is a database query this file must never contain. Pure, so it
 * stays edge-safe.
 */
export function applyUserToToken(
  token: Record<string, unknown>,
  user: {
    id?: string;
    globalRole?: string;
    accessExpiresAt?: string | null;
    sessionVersion?: number;
  },
): void {
  token.uid = user.id;
  token.globalRole = user.globalRole;
  token.accessExpiresAt = user.accessExpiresAt ?? null;
  // 0 for a token minted before this existed, which matches no row: every
  // session predating the change is invalidated, which is the point.
  token.sessionVersion = user.sessionVersion ?? 0;
}

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const signedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname === "/login" ||
        /* An invitee has no session by definition — that is what the link is
           for. Without this the invite redirects to a login they cannot pass,
           which is a closed loop. The page itself is gated on the token, and
           the token is 256 bits. */
        nextUrl.pathname.startsWith("/invite/") ||
        nextUrl.pathname.startsWith("/api/cron");

      if (isPublic) return true;
      return signedIn;
    },
    jwt({ token, user }) {
      if (user) applyUserToToken(token, user);
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.globalRole = token.globalRole as never;
        session.user.accessExpiresAt = token.accessExpiresAt as string | null;
        session.user.sessionVersion = (token.sessionVersion as number) ?? 0;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
