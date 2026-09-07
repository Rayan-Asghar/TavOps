"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { clients, connectLedger, proposals } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan, can } from "@/lib/rbac";
import { notify, resolveByDedupeKey } from "./notifications";
import { usersWithCapability } from "./recipients";
import { writeAudit } from "./audit";
import {
  advanceProposalSchema,
  chaseDedupeKey,
  createProposalSchema,
  linkProposalClientSchema,
  markChasedSchema,
} from "./proposal-schemas";
import { bidCostSchema } from "./connects-schemas";
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

    const cost = bidCostSchema.parse({
      connects: formData.get("connects") || undefined,
      boost: formData.get("boost") || undefined,
    });

    /* This used to be a bare insert with a comment saying no transaction was
       needed. That stopped being true once a bid spends connects: the proposal
       and what it cost to place have to land together, or a failure halfway
       leaves the balance wrong with nothing to point at. */
    await db.transaction(async (tx) => {
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
        })
        .returning({ id: proposals.id });

      const spends: { kind: "bid" | "boost"; count: number }[] = [];
      if (cost.connects) spends.push({ kind: "bid", count: cost.connects });
      if (cost.boost) spends.push({ kind: "boost", count: cost.boost });

      for (const spend of spends) {
        await tx.insert(connectLedger).values({
          kind: spend.kind,
          // Negative: the sign belongs to the kind, and 0023 checks it.
          delta: -spend.count,
          proposalId: row.id,
          recordedById: actor.id,
        });
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
      lostReason: formData.get("lostReason") || undefined,
      lostNote: formData.get("lostNote") || undefined,
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
    /* Set on the way in, cleared on the way out. A deal that was lost and then
       revived must not keep its reason: the database CHECK refuses it, and the
       reason it refuses is that a stale answer corrupts every count of why we
       lose. */
    if (data.status === "lost") {
      patch.lostReason = data.lostReason;
      patch.lostNote = data.lostNote ?? null;
    } else {
      patch.lostReason = null;
      patch.lostNote = null;
    }

    await db.transaction(async (tx) => {
      await tx.update(proposals).set(patch).where(eq(proposals.id, row.id));

      /* Moving a proposal along IS answering the chase, whatever it moved to.
         Without this the inbox line outlives the thing it was about, which is
         the failure that makes people stop reading a queue. */
      /* The cycle being closed is the one currently outstanding, so it is
         keyed on the count BEFORE any increment. */
      await resolveByDedupeKey(
        row.ownerId,
        chaseDedupeKey(row.id, row.chaseCount),
        tx,
      );

      // A win that nobody converts is a deal with no delivery attached, so it
      // becomes an actionable item rather than waiting to be noticed.
      if (data.status === "won" && !row.wonProjectId) {
        // Whoever can create the project, rather than whoever is called a head:
        // the previous role-name lookup silently told no admin anything.
        for (const person of await usersWithCapability("project.create", tx)) {
          await notify(
            {
              userId: person.id,
              kind: "task_assigned",
              title: `Handoff waiting: ${row.jobTitle}`,
              body: "Sales won this. Convert it into a project on the Sales page.",
              isActionable: true,
              proposalId: row.id,
              dedupeKey: `handoff_waiting:${row.id}`,
            },
            tx,
          );
        }
      }

      /* A status change is a commercial fact somebody disputes months later --
         a lost reason above all -- and this writer was the only one in
         src/server that changed a row without recording who changed it. */
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "proposal",
        entityId: row.id,
        action: "proposal.advance",
        before: {
          status: row.status,
          lostReason: row.lostReason,
          wonValue: row.wonValue,
        },
        after: {
          status: data.status,
          lostReason: patch.lostReason ?? null,
          wonValue: patch.wonValue ?? row.wonValue,
        },
      });
    });

    revalidatePath("/sales");
    revalidatePath("/");
    return { ok: true, message: `Moved to ${data.status}.` };
  } catch (err) {
    return toState(err);
  }
}

/**
 * Records that the rep chased this one.
 *
 * The only write the chase queue needs. It stamps an event that happened and
 * bumps a counter; the next due moment falls out of `lib/chase.ts` from those
 * two facts. Nobody is asked when they intend to chase again — that is the
 * distinction between this and the `follow_up_due_at` migration 0011 removed.
 */
export async function markChased(
  _prev: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "proposal.create");
    const data = markChasedSchema.parse({
      proposalId: String(formData.get("proposalId") ?? ""),
    });

    const [row] = await db
      .select({
        id: proposals.id,
        ownerId: proposals.ownerId,
        status: proposals.status,
        chaseCount: proposals.chaseCount,
      })
      .from(proposals)
      .where(eq(proposals.id, data.proposalId))
      .limit(1);
    if (!row) return { error: "Proposal not found." };
    if (row.ownerId !== actor.id && !can(actor.globalRole, "proposal.viewAll")) {
      return { error: "That is not your proposal." };
    }
    if (row.status === "won" || row.status === "lost") {
      return { error: "That one is already decided." };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(proposals)
        .set({
          lastChasedAt: new Date(),
          // Incremented in SQL rather than read-then-written, so two clicks in
          // the same second cannot both write the same number.
          chaseCount: sql`${proposals.chaseCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, row.id));
      // The cycle just answered, keyed on the count before the increment above.
      await resolveByDedupeKey(
        row.ownerId,
        chaseDedupeKey(row.id, row.chaseCount),
        tx,
      );
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${row.id}`);
    revalidatePath("/");
    return { ok: true, message: "Chased. The clock starts again." };
  } catch (err) {
    return toState(err);
  }
}

/**
 * Points a proposal at a client we already have.
 *
 * `proposals.client_id` has existed since 0003 with nothing writing it, so a
 * rep bidding on a job for somebody we have already delivered for had no way to
 * know. Linking is all a rep gets: creating a client stays in the handoff,
 * where there is a project to hang it on.
 */
export async function linkProposalClient(
  _prev: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "proposal.create");
    const data = linkProposalClientSchema.parse({
      proposalId: String(formData.get("proposalId") ?? ""),
      clientId: formData.get("clientId") ?? "",
    });

    const [row] = await db
      .select({ id: proposals.id, ownerId: proposals.ownerId, clientId: proposals.clientId })
      .from(proposals)
      .where(eq(proposals.id, data.proposalId))
      .limit(1);
    if (!row) return { error: "Proposal not found." };
    if (row.ownerId !== actor.id && !can(actor.globalRole, "proposal.viewAll")) {
      return { error: "That is not your proposal." };
    }

    if (data.clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, data.clientId))
        .limit(1);
      if (!client) return { error: "No such client." };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(proposals)
        .set({ clientId: data.clientId, updatedAt: new Date() })
        .where(eq(proposals.id, row.id));
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "proposal",
        entityId: row.id,
        action: "proposal.link_client",
        before: { clientId: row.clientId },
        after: { clientId: data.clientId },
      });
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${row.id}`);
    return { ok: true, message: data.clientId ? "Client linked." : "Client unlinked." };
  } catch (err) {
    return toState(err);
  }
}
