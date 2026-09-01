"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { proposals, users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan, can } from "@/lib/rbac";
import { notify } from "./notifications";
import { advanceProposalSchema, createProposalSchema } from "./proposal-schemas";
import { safeErrorMessage } from "./action-errors";

export type ProposalState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function toState(err: unknown): ProposalState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of err.issues) {
      const k = String(i.path[0] ?? "_");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  return { error: safeErrorMessage(err, "proposal") };
}

export async function createProposal(
  _prev: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "proposal.create");

    const data = createProposalSchema.parse({
      jobTitle: formData.get("jobTitle"),
      jobUrl: formData.get("jobUrl") ?? "",
      category: formData.get("category") ?? undefined,
      source: formData.get("source") || "upwork",
      budgetAmount: formData.get("budgetAmount") || undefined,
      notes: formData.get("notes") ?? undefined,
    });

    // A single insert, so no transaction: logging a proposal writes one row and
    // notifies nobody. Chasing it is the rep's own business.
    await db.insert(proposals).values({
      ownerId: actor.id,
      jobTitle: data.jobTitle,
      jobUrl: data.jobUrl,
      category: data.category,
      source: data.source,
      budgetAmount: data.budgetAmount?.toFixed(2),
      notes: data.notes,
    });

    revalidatePath("/sales");
    return { ok: true, message: "Proposal logged." };
  } catch (err) {
    return toState(err);
  }
}

export async function advanceProposal(
  _prev: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  try {
    const actor = await requireActor();
    const data = advanceProposalSchema.parse({
      proposalId: String(formData.get("proposalId") ?? ""),
      status: String(formData.get("status") ?? ""),
      wonValue: formData.get("wonValue") || undefined,
    });

    const [row] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, data.proposalId))
      .limit(1);
    if (!row) return { error: "Proposal not found." };

    const seesAll = can(actor.globalRole, "proposal.viewAll");
    if (row.ownerId !== actor.id && !seesAll) {
      return { error: "That is not your proposal." };
    }

    const now = new Date();
    // Stamp the milestone that this status implies, so the funnel timings are
    // derived from real events rather than a single mutable "updated" column.
    const patch: Record<string, unknown> = { status: data.status, updatedAt: now };
    if (["responded", "meeting", "qualified", "won", "lost"].includes(data.status)) {
      patch.respondedAt = row.respondedAt ?? now;
    }
    if (data.status === "meeting") patch.meetingAt = row.meetingAt ?? now;
    if (data.status === "won" || data.status === "lost") patch.decidedAt = now;
    if (data.status === "won" && data.wonValue !== undefined) {
      patch.wonValue = data.wonValue.toFixed(2);
    }

    await db.transaction(async (tx) => {
      await tx.update(proposals).set(patch).where(eq(proposals.id, row.id));

      // A win that nobody converts is a deal with no delivery attached, so it
      // becomes an actionable item rather than waiting to be noticed.
      if (data.status === "won" && !row.wonProjectId) {
        const pms = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.isActive, true), eq(users.globalRole, "head")));
        for (const pm of pms) {
          await notify(
            {
              userId: pm.id,
              kind: "task_assigned",
              title: `Handoff waiting: ${row.jobTitle}`,
              body: "Sales won this. Convert it into a project on the Sales page.",
              isActionable: true,
              dedupeKey: `handoff_waiting:${row.id}`,
            },
            tx,
          );
        }
      }
    });

    revalidatePath("/sales");
    revalidatePath("/");
    return { ok: true, message: `Moved to ${data.status}.` };
  } catch (err) {
    return toState(err);
  }
}
