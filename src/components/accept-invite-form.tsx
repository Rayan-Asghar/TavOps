"use client";

import { useActionState } from "react";
import Link from "next/link";
import { acceptInviteAction } from "@/server/invite-actions";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

/**
 * Setting the password an invite was sent for.
 *
 * The token rides in a hidden field rather than being read from the URL by the
 * action: a server action does not see the page's path, and passing it
 * explicitly keeps the action callable in a test without a router.
 *
 * On success the form is replaced entirely rather than reset. There is nothing
 * left to do here — the link is spent — and leaving two empty password boxes on
 * screen invites somebody to type into them again and wonder why it fails.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, initial);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormSuccess>{state.message ?? "Password set."}</FormSuccess>
        <Link href="/login" className="btn-primary w-full">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="field"
          aria-describedby="password-hint"
          aria-invalid={!!state.error}
        />
        <p id="password-hint" className="mt-1 text-2xs text-fg-muted">
          At least 12 characters. A phrase you can remember beats a short jumble
          you cannot.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="field"
          aria-invalid={!!state.error}
        />
      </div>

      {state.error && <FormError>{state.error}</FormError>}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Setting…" : "Set password"}
      </button>
    </form>
  );
}
