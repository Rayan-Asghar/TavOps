import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { homePathFor } from "@/lib/home";

/**
 * Where sign-in lands, so that it can land somewhere different per person.
 *
 * This exists as a route rather than a branch inside `loginAction` because of
 * Google: `signIn("google", …)` is called before anybody knows who is signing
 * in, so its `redirectTo` cannot depend on the identity. A route resolves after
 * the session exists and therefore works for both providers with one rule.
 *
 * It sits OUTSIDE the (app) group on purpose: that group's layout builds the
 * nav, the notification count and the timer chip on every render, and paying
 * for all three to throw them away on a redirect is the kind of cost that never
 * shows up in a profile because it only happens once per sign-in.
 *
 * It renders nothing. Nobody should ever see this page.
 */
export default async function StartPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  redirect(homePathFor(me?.globalRole ?? "developer"));
}
