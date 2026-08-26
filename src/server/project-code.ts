import { sql } from "drizzle-orm";
import type { db } from "@/db";
import { projects } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * "Northwind Apparel" -> "NA-003".
 *
 * Shared by the handoff and by direct project creation so codes stay in one
 * sequence per client prefix regardless of how the project came into being.
 */
export async function nextProjectCode(
  tx: Tx,
  clientName: string,
): Promise<string> {
  const prefix =
    clientName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .replace(/[^A-Z]/g, "") || "TV";

  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(sql`${projects.code} like ${prefix + "-%"}`);

  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}
