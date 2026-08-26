"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { clients, projectMembers, projects } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { createProjectSchema } from "./task-schemas";
import { nextProjectCode } from "./project-code";
import { eq } from "drizzle-orm";

export type ProjectState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  projectId?: string;
};

function toState(err: unknown): ProjectState {
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

/**
 * Creates a project directly, for work that never came through sales —
 * retainers, internal builds, referrals booked by phone. Deals won on Upwork
 * still go through the handoff so nothing is retyped.
 */
export async function createProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "project.create");

    const data = createProjectSchema.parse({
      name: formData.get("name"),
      clientId: formData.get("clientId") ?? "",
      newClientName: formData.get("newClientName") ?? undefined,
      projectType: formData.get("projectType") ?? undefined,
      pmId: formData.get("pmId") ?? "",
      deliveryLeadId: formData.get("deliveryLeadId") ?? "",
      salesOwnerId: formData.get("salesOwnerId") ?? "",
      internalDueDate: formData.get("internalDueDate") ?? "",
      clientDueDate: formData.get("clientDueDate") ?? "",
      description: formData.get("description") ?? undefined,
    });

    const created = await db.transaction(async (tx) => {
      let clientId = data.clientId ?? null;
      if (!clientId && data.newClientName) {
        const [c] = await tx
          .insert(clients)
          .values({ name: data.newClientName })
          .returning();
        clientId = c.id;
      }

      const [clientRow] = clientId
        ? await tx
            .select({ name: clients.name })
            .from(clients)
            .where(eq(clients.id, clientId))
            .limit(1)
        : [{ name: data.name }];

      const code = await nextProjectCode(tx, clientRow?.name ?? data.name);

      const [project] = await tx
        .insert(projects)
        .values({
          code,
          name: data.name,
          clientId,
          lifecycle: "draft",
          projectType: data.projectType,
          pmId: data.pmId ?? null,
          deliveryLeadId: data.deliveryLeadId ?? null,
          salesOwnerId: data.salesOwnerId ?? null,
          startDate: new Date(),
          internalDueDate: data.internalDueDate,
          clientDueDate: data.clientDueDate,
          description: data.description,
        })
        .returning();

      const members = [
        ...(data.pmId ? [{ userId: data.pmId, role: "pm" as const }] : []),
        ...(data.deliveryLeadId
          ? [{ userId: data.deliveryLeadId, role: "tech_lead" as const }]
          : []),
        ...(data.salesOwnerId
          ? [{ userId: data.salesOwnerId, role: "sales_owner" as const }]
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

      return project;
    });

    revalidatePath("/projects");
    return { ok: true, projectId: created.id };
  } catch (err) {
    return toState(err);
  }
}

/** Draft -> active, once assets, scope and team are confirmed. */
export async function activateProject(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "project.edit");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  await db
    .update(projects)
    .set({ lifecycle: "active", updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}
