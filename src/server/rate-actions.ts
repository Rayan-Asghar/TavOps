"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, withFinanceAccess } from "@/db";
import { userRates, users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { planRateChange } from "@/lib/rate-change";
import { UserFacingError } from "@/lib/errors";
import { setUserRateSchema } from "./rate-schemas";
import { writeAudit } from "./audit";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";

/**
 * Gives `user_rates` its first writer inside the application.
 *
 * Until now the only way to enter what somebody costs was `psql` or the seed
 * script, which meant the entire costing layer returned `unrated` for anyone
 * the seed did not cover. This is the missing half of Phase 1.
 *
 * Gated on `rates.view`, which is admin-only by deliberate design — `rbac.ts`
 * says pay data is not granted by inference, and being able to SET a rate is
 * strictly more than being able to read one.
 */
export async function setUserRateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "rates.view");

    const data = setUserRateSchema.parse({
      userId: String(formData.get("userId") ?? ""),
      internalCostPerHour: String(formData.get("internalCostPerHour") ?? ""),
      billableRatePerHour: String(formData.get("billableRatePerHour") ?? ""),
      currency: String(formData.get("currency") || "USD"),
      effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    });

    const [person] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);
    if (!person) throw new UserFacingError("That person no longer exists.");

    await withFinanceAccess(async (tx) => {
      // FOR UPDATE: two admins setting a rate at once would otherwise both read
      // the same open row, both close it, and both insert — leaving two open
      // rates and a person whose hours cost `ambiguous` from then on. The
      // partial unique index would catch the second insert, but failing on a
      // constraint is a worse experience than serialising here.
      const [current] = await tx
        .select({ id: userRates.id, effectiveFrom: userRates.effectiveFrom })
        .from(userRates)
        .where(
          and(eq(userRates.userId, data.userId), isNull(userRates.effectiveTo)),
        )
        .orderBy(desc(userRates.effectiveFrom))
        .limit(1)
        .for("update");

      const plan = planRateChange(
        current ?? null,
        {
          internalCostPerHour: data.internalCostPerHour,
          billableRatePerHour: data.billableRatePerHour
            ? data.billableRatePerHour
            : null,
          currency: data.currency.toUpperCase(),
        },
        new Date(`${data.effectiveFrom}T00:00:00.000Z`),
      );

      if (!plan.ok) {
        throw new UserFacingError(
          "A rate change has to start after the current one began. Pick a later date.",
        );
      }

      if (plan.closePrevious) {
        await tx
          .update(userRates)
          .set({ effectiveTo: plan.closePrevious.effectiveTo })
          .where(eq(userRates.id, plan.closePrevious.id));
      }

      await tx.insert(userRates).values({
        userId: data.userId,
        internalCostPerHour: plan.insert.internalCostPerHour,
        billableRatePerHour: plan.insert.billableRatePerHour,
        currency: plan.insert.currency,
        effectiveFrom: plan.insert.effectiveFrom,
      });

      // NO AMOUNTS IN THE AUDIT ROW, and this is load-bearing rather than
      // fussy. `head` holds `audit.view` but NOT `rates.view`, so anything
      // written here is readable at /audit by exactly the role rbac.ts
      // deliberately withholds pay data from. An audit trail that leaks the
      // thing it is auditing is worse than none. What changed, for whom, and
      // from when is enough to answer "who did this"; the amounts live in the
      // RLS-protected table where only `rates.view` reaches them.
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "user",
        entityId: data.userId,
        action: "user.set_rate",
        after: {
          effectiveFrom: data.effectiveFrom,
          currency: plan.insert.currency,
          hasRateCard: plan.insert.billableRatePerHour !== null,
          replacedPrevious: plan.closePrevious !== null,
        },
      });
    });

    revalidatePath("/admin/users");
    return {
      ok: true,
      message: `Rate set for ${person.name}, from ${data.effectiveFrom}.`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "setUserRate") };
  }
}
