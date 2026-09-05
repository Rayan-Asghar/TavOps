import { eq } from "drizzle-orm";
import { db, type Db } from "@/db";
import { users } from "@/db/schema";
import { can, type Capability } from "@/lib/rbac";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Everyone who holds a capability, for notifying rather than for authorising.
 *
 * Sweeps need to address "whoever can do something about this", and the two
 * that existed before this reached for `globalRole = 'head'` directly — a role
 * name branch of exactly the kind `rbac.ts` opens by telling you not to write.
 * It also happened to be wrong: an admin holds every capability and was never
 * told anything.
 *
 * The filter runs in JS because the grants live in TypeScript, not in the
 * database. That is the right place for them — they are a product decision, not
 * data — and the cost is reading the staff table, which is nine rows.
 */
export async function usersWithCapability(
  capability: Capability,
  tx: Tx = db,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx
    .select({ id: users.id, name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.isActive, true));
  return rows
    .filter((u) => can(u.globalRole, capability))
    .map(({ id, name }) => ({ id, name }));
}
