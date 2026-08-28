"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, withFinanceAccess } from "@/db";
import {
  auditLog,
  clients,
  projectFinancials,
  projectMembers,
  projects,
  proposals,
} from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { notify } from "./notifications";
import { convertProposalSchema } from "./handoff-schemas";
import { nextProjectCode } from "./project-code";
import { commitmentsFor, overCommitted } from "./capacity";
import { safeErrorMessage } from "./action-errors";

export type HandoffState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  projectId?: string;
};

function toState(err: unknown): HandoffState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of err.issues) {
      const k = String(i.path[0] ?? "_");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  return { error: safeErrorMessage(err, "handoff") };
}

/**
 * Turns a won proposal into the project that delivers it.
 *
 * This is the handoff: nothing typed during the sale is retyped. The proposal
 * keeps a pointer to the project, so "which deal did this come from" stays
 * answerable a year later.
 *
 * The project is created as a draft, not active — a PM and delivery lead still
 * have to confirm assets, scope and team before work starts, and a project that
 * appears already-running would skip that.
 */
export async function convertProposalToProject(
  _prev: HandoffState,
  formData: FormData,
): Promise<HandoffState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "project.create");

    const data = convertProposalSchema.parse({
      proposalId: String(formData.get("proposalId") ?? ""),
      projectName: formData.get("projectName"),
      clientId: formData.get("clientId") ?? "",
      newClientName: formData.get("newClientName") ?? undefined,
      projectType: formData.get("projectType") ?? undefined,
      deliveryLeadId: formData.get("deliveryLeadId") ?? "",
      pmId: formData.get("pmId") ?? "",
      internalDueDate: formData.get("internalDueDate") ?? "",
      clientDueDate: formData.get("clientDueDate") ?? "",
      contractValue: formData.get("contractValue") || undefined,
      scope: formData.get("scope") ?? undefined,
    });

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, data.proposalId))
      .limit(1);

    if (!proposal) return { error: "Proposal not found." };
    if (proposal.status !== "won") {
      return { error: "Only a won proposal can be handed off." };
    }
    if (proposal.wonProjectId) {
      return { error: "This proposal has already been converted." };
    }

    const created = await db.transaction(async (tx) => {
      let clientId = data.clientId ?? null;
      if (!clientId && data.newClientName) {
        const [client] = await tx
          .insert(clients)
          .values({ name: data.newClientName, source: proposal.source })
          .returning();
        clientId = client.id;
      }

      const [clientRow] = clientId
        ? await tx
            .select({ name: clients.name })
            .from(clients)
            .where(eq(clients.id, clientId))
            .limit(1)
        : [{ name: data.projectName }];

      const code = await nextProjectCode(tx, clientRow?.name ?? data.projectName);

      const [project] = await tx
        .insert(projects)
        .values({
          code,
          name: data.projectName,
          clientId,
          lifecycle: "draft",
          projectType: data.projectType ?? proposal.category,
          // Carried straight from the proposal — the rep who won it stays the
          // client's point of contact.
          salesOwnerId: proposal.ownerId,
          pmId: data.pmId ?? null,
          deliveryLeadId: data.deliveryLeadId ?? null,
          startDate: new Date(),
          internalDueDate: data.internalDueDate,
          clientDueDate: data.clientDueDate,
          description: data.scope ?? proposal.notes,
        })
        .returning();

      // Seed membership so the people named can see it immediately.
      const members = [
        { userId: proposal.ownerId, role: "sales_owner" as const },
        ...(data.pmId ? [{ userId: data.pmId, role: "pm" as const }] : []),
        ...(data.deliveryLeadId
          ? [{ userId: data.deliveryLeadId, role: "tech_lead" as const }]
          : []),
      ];
      const seen = new Set<string>();
      for (const m of members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        await tx
          .insert(projectMembers)
          .values({ projectId: project.id, userId: m.userId, role: m.role })
          .onConflictDoNothing();
      }

      await tx
        .update(proposals)
        .set({ wonProjectId: project.id, updatedAt: new Date() })
        .where(eq(proposals.id, proposal.id));

      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: "proposal.convert",
        entityType: "project",
        entityId: project.id,
        detail: { proposalId: proposal.id, code },
      });

      return { project, clientName: clientRow?.name ?? null };
    });

    // Money is written in its own RLS-gated transaction rather than being
    // folded into the one above, so the opt-in stays scoped to the finance
    // write and nothing else.
    const value = data.contractValue ?? Number(proposal.wonValue ?? 0);
    if (value > 0) {
      await withFinanceAccess(async (tx) => {
        await tx
          .insert(projectFinancials)
          .values({
            projectId: created.project.id,
            contractValue: value.toFixed(2),
          })
          .onConflictDoNothing();
      });
    }

    for (const uid of [data.pmId, data.deliveryLeadId].filter(Boolean)) {
      if (uid === actor.id) continue;
      await notify({
        userId: uid as string,
        kind: "task_assigned",
        title: `Handed off: ${created.project.name}`,
        body: `${created.clientName ?? "New client"} — won by sales. Confirm assets, scope and team, then set it active.`,
        projectId: created.project.id,
        isActionable: true,
        dedupeKey: `handoff:${created.project.id}:${uid}`,
      });
    }

    revalidatePath("/sales");
    revalidatePath("/projects");

    // Advisory, never blocking: taking a job while the team is booked is a
    // legitimate call, but it should be a call somebody makes knowingly rather
    // than discovers a week in. The project is already created at this point.
    const booked = overCommitted(
      await commitmentsFor(
        [data.pmId, data.deliveryLeadId].filter(Boolean) as string[],
      ),
    );
    const warning =
      booked.length > 0
        ? ` Heads up: ${booked
            .map((b) => `${b.name} is ${b.weeksBooked.toFixed(1)} weeks booked`)
            .join(", ")}.`
        : "";

    return {
      ok: true,
      message: `Created ${created.project.code} as a draft.${warning}`,
      projectId: created.project.id,
    };
  } catch (err) {
    return toState(err);
  }
}
