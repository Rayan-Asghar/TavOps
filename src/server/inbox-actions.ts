"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { resolveNotification } from "./notifications";

export async function dismissNotification(formData: FormData) {
  const actor = await requireActor();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Scoped to the actor's own rows, so a guessed id cannot clear someone
  // else's inbox.
  await resolveNotification(id, actor.id);
  revalidatePath("/");
}
