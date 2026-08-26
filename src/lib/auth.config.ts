import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth setup.
 *
 * Middleware runs on the edge runtime, where bcrypt and the Postgres driver
 * cannot load. Keeping the providers out of this file is what lets middleware
 * import it without dragging Node-only dependencies into the edge bundle.
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
