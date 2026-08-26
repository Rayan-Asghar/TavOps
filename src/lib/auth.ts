import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authConfig } from "./auth.config";
import type { Actor } from "./access";
import type { GlobalRole } from "./rbac";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
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

        // Compare against a dummy hash when the user is missing so that a
        // wrong email and a wrong password take the same time to fail.
        const hash =
          found?.passwordHash ??
          "$2b$12$0000000000000000000000000000000000000000000000000000";
        const ok = await bcrypt.compare(password, hash);

        if (!found || !ok) return null;
        if (!found.isActive) return null;
        if (found.accessExpiresAt && found.accessExpiresAt <= new Date()) {
          return null;
        }

        return {
          id: found.id,
          name: found.name,
          email: found.email,
          globalRole: found.globalRole,
          accessExpiresAt: found.accessExpiresAt?.toISOString() ?? null,
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
