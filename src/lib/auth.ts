import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { applyUserToToken, authConfig } from "./auth.config";
import { maySignIn } from "./sign-in-eligibility";
import type { Actor } from "./access";
import type { GlobalRole } from "./rbac";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Google sign-in is registered only when it is configured.
 *
 * A provider with no client id renders a button that fails on click, which
 * looks like a broken app rather than an unconfigured one. The login page reads
 * the same flag, so the button and the provider appear and disappear together.
 */
export const googleEnabled =
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

/**
 * The one place "is this person allowed in" is decided, for every provider.
 *
 * Both sign-in paths converge here so they cannot drift: a rule added for the
 * password form that Google skipped would be a way in that nobody tested.
 * Returns the row, or null — the caller never learns which check failed.
 */
async function activeMemberByEmail(email: string | null | undefined) {
  if (!email) return null;

  const [found] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  return maySignIn(found) ? found : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * The gate. Tavren is strictly internal, so a Google account is proof of
     * WHO somebody is and never proof that they belong here.
     *
     * There is deliberately NO auto-provisioning. An unknown Google account is
     * refused rather than turned into a user — otherwise anyone with a Google
     * login walks into the operations system, and the `users` table stops being
     * the list of people who work here. Accounts are created by an admin under
     * People, exactly as before; Google only replaces the password.
     */
    async signIn({ user, account, profile }) {
      // Credentials already authorized in `authorize()`; re-checking here would
      // duplicate the rule and invite the two copies to disagree.
      if (account?.provider !== "google") return true;

      // Google may return an address it has not verified. Treating that as
      // identity would let somebody claim a colleague's address.
      if (profile?.email_verified !== true) return false;

      return !!(await activeMemberByEmail(user.email ?? profile.email));
    },

    /**
     * Overrides the edge-safe `jwt` in auth.config.ts, which cannot do this:
     * a Google identity carries Google's subject id, not ours, and every
     * access check in the app keys on `users.id`. Resolving it by email is a
     * query, and `auth.config.ts` has to stay free of the Postgres driver so
     * the proxy can keep importing it on the edge runtime.
     *
     * Runs only when `user` is present — on sign-in, not on every request.
     */
    async jwt({ token, user, account }) {
      if (!user) return token;

      if (account?.provider === "google") {
        const member = await activeMemberByEmail(user.email);
        // signIn already refused this case; returning the token unchanged
        // leaves it without a uid, so getActor() reports signed out.
        if (!member) return token;

        applyUserToToken(token, {
          id: member.id,
          globalRole: member.globalRole,
          accessExpiresAt: member.accessExpiresAt?.toISOString() ?? null,
          sessionVersion: member.sessionVersion,
        });
        return token;
      }

      applyUserToToken(token, user as never);
      return token;
    },
  },
  providers: [
    ...(googleEnabled
      ? [
          Google({
            // Tavren's own users table is the allowlist, so linking by email is
            // exactly what we want: an admin creates the account, the person
            // signs in with the matching Google address. It is safe here ONLY
            // because signIn() refuses any address that is not already a user.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const [found] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);

        /* Compare against a dummy hash when the user is missing so that a
           wrong email and a wrong password take the same time to fail.

           `passwordHash` is nullable now — somebody invited who only ever signs
           in with Google has none. That case lands here too, deliberately: the
           `??` substitutes the dummy, the compare runs and fails, and the answer
           takes exactly as long as a wrong password. Do not "simplify" this into
           an early return on a null hash; that would make a Google-only account
           answer faster than a real one, which is an account enumeration oracle. */
        const hash =
          found?.passwordHash ??
          "$2b$12$0000000000000000000000000000000000000000000000000000";
        const ok = await bcrypt.compare(password, hash);

        // `found.passwordHash` restated so the null case is refused explicitly
        // rather than relying on the dummy never matching.
        if (!found || !found.passwordHash || !ok) return null;
        // Same rule as the Google path, from the same function.
        if (!(await activeMemberByEmail(found.email))) return null;

        return {
          id: found.id,
          name: found.name,
          email: found.email,
          globalRole: found.globalRole,
          accessExpiresAt: found.accessExpiresAt?.toISOString() ?? null,
          sessionVersion: found.sessionVersion,
        };
      },
    }),
  ],
});

/**
 * The actor for the current request, or null when signed out.
 * Server components, server actions and route handlers all start here.
 */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    globalRole: session.user.globalRole as GlobalRole,
    accessExpiresAt: session.user.accessExpiresAt
      ? new Date(session.user.accessExpiresAt)
      : null,
    sessionVersion: session.user.sessionVersion ?? 0,
  };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}
