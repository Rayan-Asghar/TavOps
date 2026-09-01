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
        nextUrl.pathname.startsWith("/api/cron");

      if (isPublic) return true;
      return signedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.globalRole = (user as { globalRole?: string }).globalRole;
        token.accessExpiresAt =
          (user as { accessExpiresAt?: string | null }).accessExpiresAt ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.globalRole = token.globalRole as never;
        session.user.accessExpiresAt = token.accessExpiresAt as string | null;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
