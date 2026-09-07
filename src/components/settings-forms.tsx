"use client";

import { useActionState } from "react";
import {
  changeNameAction,
  changePasswordAction,
} from "@/server/settings-actions";
import { FormError, FormSuccess } from "./ui";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

export function NameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(changeNameAction, initial);

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={current}
          required
          maxLength={160}
          className="field"
        />
        <p className="mt-1 text-2xs text-fg-subtle">
          What colleagues see on your work logs and reviews.
        </p>
      </div>
      {state.error && <FormError>{state.error}</FormError>}
      {state.ok && state.message && <FormSuccess>{state.message}</FormSuccess>}
      <button type="submit" disabled={pending} className="btn-secondary btn-sm">
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

/**
 * Changing your own password.
 *
 * The current password is required, so a borrowed unlocked laptop cannot be
 * turned into a permanent account takeover in two clicks — and the form says
 * plainly that other sessions end, because that is the reassuring half of a
 * change somebody usually makes because they are worried.
 */
export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="currentPassword">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="newPassword">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="field"
        />
        <p className="mt-1 text-2xs text-fg-subtle">
          At least 12 characters. There is no second factor on this app, so
          length is the whole of it.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="field"
        />
      </div>

      {state.error && <FormError>{state.error}</FormError>}
      {state.ok && state.message && <FormSuccess>{state.message}</FormSuccess>}

      <button type="submit" disabled={pending} className="btn-primary btn-sm">
        {pending ? "Changing…" : "Change password"}
      </button>
      <p className="m-0 text-2xs text-fg-subtle">
        Changing it signs out every other device you are signed in on.
      </p>
    </form>
  );
}
