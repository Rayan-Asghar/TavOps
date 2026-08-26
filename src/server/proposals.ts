"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { proposals, users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan, can } from "@/lib/rbac";
import { notify } from "./notifications";
import {
  advanceProposalSchema,
  createProposalSchema,
  feasibilityAnswerSchema,
} from "./proposal-schemas";

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
  return { error: err instanceof Error ? err.message : String(err) };
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
      needsFeasibility: formData.get("needsFeasibility") === "on",
      notes: formData.get("notes") ?? undefined,
    });

    await db.transaction(async (tx) => {
      // Feasibility goes to a delivery lead, falling back to a PM — the two
      // people who can actually judge whether the scope is buildable.
      let assignee: string | null = null;
      if (data.needsFeasibility) {
        const [lead] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.isActive, true),
              or(
                eq(users.globalRole, "delivery_lead"),
                eq(users.globalRole, "pm"),
              ),
            ),
          )
          .orderBy(users.globalRole)
          .limit(1);
        assignee = lead?.id ?? null;
      }

      const [row] = await tx
        .insert(proposals)
        .values({
          ownerId: actor.id,
          jobTitle: data.jobTitle,
          jobUrl: data.jobUrl,
          category: data.category,
          source: data.source,
          budgetAmount: data.budgetAmount?.toFixed(2),
          notes: data.notes,
          feasibility: data.needsFeasibility ? "pending" : "not_needed",
          feasibilityAssignedToId: assignee,
          // Chase it in two business days unless something moves sooner.
          followUpDueAt: new Date(Date.now() + 2 * 864e5),
        })
        .returning();

      if (assignee) {
        await notify(
          {
            userId: assignee,
            kind: "feasibility_requested",
            title: `Feasibility check: ${data.jobTitle}`,
            body: data.notes ?? "A rep needs a technical read before bidding.",
            isActionable: true,
            dedupeKey: `feasibility:${row.id}`,
          },
          tx,
        );
      }
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
    if (data.status === "won" || data.status === "lost") {
      patch.decidedAt = now;
      patch.followUpDueAt = null;
    }
    if (data.status === "won" && data.wonValue !== undefined) {
      patch.wonValue = data.wonValue.toFixed(2);
    }

    await db.update(proposals).set(patch).where(eq(proposals.id, row.id));
    revalidatePath("/sales");
    return { ok: true, message: `Moved to ${data.status}.` };
  } catch (err) {
    return toState(err);
  }
}

export async function answerFeasibility(
  _prev: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "feasibility.answer");

    const data = feasibilityAnswerSchema.parse({
      proposalId: String(formData.get("proposalId") ?? ""),
      decision: String(formData.get("decision") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    const [row] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, data.proposalId))
      .limit(1);
    if (!row) return { error: "Proposal not found." };

    await db.transaction(async (tx) => {
      await tx
        .update(proposals)
        .set({
          feasibility: data.decision,
          feasibilityNote: data.note,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, row.id));

      await notify(
        {
          userId: row.ownerId,
          kind: "feasibility_answered",
          title: `Feasibility ${data.decision}: ${row.jobTitle}`,
          body: data.note,
          isActionable: true,
          dedupeKey: `feasibility_answer:${row.id}`,
        },
        tx,
      );
    });

    revalidatePath("/sales");
    revalidatePath("/");
    return { ok: true, message: `Marked ${data.decision}.` };
  } catch (err) {
    return toState(err);
  }
}
