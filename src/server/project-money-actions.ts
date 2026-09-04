"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, withFinanceAccessInTx } from "@/db";
import { projectFinancials, projects, retainerPeriods } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import {
  setProjectMoneySchema,
  upsertRetainerPeriodSchema,
} from "./project-money-schemas";
import { writeAudit } from "./audit";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";

/**
 * The commercial shape of a project, and the writers it never had.
 *
 * Migration 0019 added `projects.billing_model` and `retainer_periods`, and
 * nothing in the app could set either — retainers were expressible in the
 * schema and impossible in practice. `project_financials` was written once, at
 * proposal handoff, and never editable afterwards.
 */

const blank = (v: string | undefined | null) =>
  v === undefined || v === null || v.trim() === "" ? null : v.trim();

export async function setProjectMoneyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "finance.view");
    assertCan(actor.globalRole, "project.edit");

    const data = setProjectMoneySchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      billingModel: String(formData.get("billingModel") ?? ""),
      contractValue: String(formData.get("contractValue") ?? ""),
      platformFeePct: String(formData.get("platformFeePct") ?? ""),
      budgetedHours: String(formData.get("budgetedHours") ?? ""),
      currency: String(formData.get("currency") || "USD"),
    });

    // 404-not-403 on an unreachable project, like every other fetch-by-id.
    await assertProjectAccess(actor, data.projectId);

    const [before] = await db
      .select({ billingModel: projects.billingModel })
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);
    if (!before) throw new UserFacingError("That project no longer exists.");

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ billingModel: data.billingModel, updatedAt: new Date() })
        .where(eq(projects.id, data.projectId));

      const values = {
        contractValue: blank(data.contractValue),
        platformFeePct: blank(data.platformFeePct),
        budgetedHours: blank(data.budgetedHours),
        currency: data.currency.toUpperCase(),
      };

      await withFinanceAccessInTx(tx, async (sp) => {
        await sp
          .insert(projectFinancials)
          .values({ projectId: data.projectId, ...values })
          .onConflictDoUpdate({
            target: projectFinancials.projectId,
            set: values,
          });
      });

      // The billing model is not sensitive — it is a badge on the project list.
      // The AMOUNTS are, and `head` can read /audit without holding
      // `rates.view`, so they stay out of the payload for the same reason the
      // rate action keeps them out.
      await writeAudit(tx, {
        actorId: actor.id,
        projectId: data.projectId,
        entityType: "project",
        entityId: data.projectId,
        action: "project.set_money",
        before: { billingModel: before.billingModel },
        after: {
          billingModel: data.billingModel,
          currency: values.currency,
          hasContractValue: values.contractValue !== null,
          hasBudget: values.budgetedHours !== null,
        },
      });
    });

    revalidatePath(`/projects/${data.projectId}`);
    revalidatePath("/projects");
    return { ok: true, message: "Commercial terms saved." };
  } catch (err) {
    return { error: safeErrorMessage(err, "setProjectMoney") };
  }
}

export async function upsertRetainerPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "finance.view");
    assertCan(actor.globalRole, "project.edit");

    const data = upsertRetainerPeriodSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      periodStart: String(formData.get("periodStart") ?? ""),
      periodEnd: String(formData.get("periodEnd") ?? ""),
      includedHours: String(formData.get("includedHours") ?? ""),
      amount: String(formData.get("amount") ?? ""),
      rolloverHours: String(formData.get("rolloverHours") ?? ""),
      currency: String(formData.get("currency") || "USD"),
    });

    await assertProjectAccess(actor, data.projectId);

    const [project] = await db
      .select({ billingModel: projects.billingModel })
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);
    if (!project) throw new UserFacingError("That project no longer exists.");
    if (project.billingModel !== "retainer") {
      // Refused rather than silently allowed: a period on a fixed-fee project
      // would be measured against nothing and read as a second budget.
      throw new UserFacingError(
        "Set the billing model to Retainer before adding periods.",
      );
    }

    const values = {
      includedHours: blank(data.includedHours),
      amount: blank(data.amount),
      rolloverHours: blank(data.rolloverHours) ?? "0",
      currency: data.currency.toUpperCase(),
    };

    await db.transaction(async (tx) => {
      await tx
        .insert(retainerPeriods)
        .values({
          projectId: data.projectId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          ...values,
        })
        // Keyed on (project, start): re-submitting a month corrects it rather
        // than creating a second period that double-counts its hours.
        .onConflictDoUpdate({
          target: [retainerPeriods.projectId, retainerPeriods.periodStart],
          set: { periodEnd: data.periodEnd, ...values },
        });

      await writeAudit(tx, {
        actorId: actor.id,
        projectId: data.projectId,
        entityType: "project",
        entityId: data.projectId,
        action: "project.retainer_period",
        after: {
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          currency: values.currency,
          hasAmount: values.amount !== null,
        },
      });
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, message: `Period from ${data.periodStart} saved.` };
  } catch (err) {
    return { error: safeErrorMessage(err, "upsertRetainerPeriod") };
  }
}
