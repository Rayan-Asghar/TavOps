"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import {
  resetPasswordAction,
  setUserActiveAction,
  type UserFormState,
} from "@/server/user-actions";
import { reissueInviteAction } from "@/server/invite-actions";
import { CopyField } from "./copy-field";

import { ActionButton } from "./ui";
const initial: UserFormState = {};

export function UserRowActions({
  userId,
  userName,
  isActive,
  isSelf,
  isLastAdmin,
  hasPassword,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
  /** Somebody who has never set one is still waiting on an invite. */
  hasPassword: boolean;
}) {
  const [resetState, resetAction, resetting] = useActionState(
    resetPasswordAction,
    initial,
  );

  const [resetConfirming, setResetConfirming] = useState(false);
  const [reissueState, reissueAction, reissuing] = useActionState(
    reissueInviteAction,
    initial,
  );

  /* The action hands back a path; only the client knows the public origin. */
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const blocked = isSelf || (isLastAdmin && isActive);
  const blockedReason = isSelf
    ? "You cannot deactivate your own account."
    : "This is the last active admin.";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        {/* Two different situations, deliberately not one control. An invite is
            for arriving and a reset is for being locked out; somebody who has
            never set a password cannot be "reset" to anything. */}
        {!hasPassword && isActive ? (
          <form action={reissueAction}>
            <input type="hidden" name="id" value={userId} />
            <button
              type="submit"
              disabled={reissuing}
              className="btn-secondary btn-sm"
            >
              {reissuing ? "Creating…" : "Re-send invite"}
            </button>
          </form>
        ) : null}

        {/* One click used to invalidate someone's current password with no
            confirmation. Same two-step speed bump as deactivation. */}
        {hasPassword && resetConfirming ? (
          <form action={resetAction} className="flex gap-2">
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={resetting}
              className="btn-danger btn-sm"
            >
              {resetting ? "Resetting…" : "Confirm reset"}
            </button>
            <button
              type="button"
              onClick={() => setResetConfirming(false)}
              className="btn-ghost btn-sm"
            >
              Cancel
            </button>
          </form>
        ) : hasPassword ? (
          <button
            type="button"
            onClick={() => setResetConfirming(true)}
            className="btn-secondary btn-sm"
          >
            Reset password
          </button>
        ) : null}

        {isActive ? (
          <ActionButton
            action={setUserActiveAction}
            fields={{ userId, makeActive: "false" }}
            className="btn-secondary btn-sm"
            confirm="Confirm"
            disabled={blocked}
            pendingLabel="Deactivating…"
          >
            Deactivate
          </ActionButton>
        ) : (
          <ActionButton
            action={setUserActiveAction}
            fields={{ userId, makeActive: "true" }}
            className="btn-secondary btn-sm"
            pendingLabel="Reactivating…"
          >
            Reactivate
          </ActionButton>
        )}
      </div>

      {blocked && isActive && (
        <p className="text-right text-xs text-fg-subtle">{blockedReason}</p>
      )}

      {resetState.ok && resetState.tempPassword && (
        <div role="status" className="rounded-lg border border-ok bg-ok-soft p-3">
          <p className="mb-2 text-xs text-warn">
            New password for {userName}. Shown once — send it now.
          </p>
          <CopyField value={resetState.tempPassword} />
        </div>
      )}
      {reissueState.ok && reissueState.message && (
        <div role="status" className="rounded-lg border border-ok bg-ok-soft p-3">
          <p className="mb-2 text-xs text-warn">
            New invitation for {userName}. Shown once, expires in seven days, and
            the previous link has stopped working.
          </p>
          <CopyField value={`${origin}${reissueState.message}`} />
        </div>
      )}
      {resetState.error && (
        <p role="alert" className="text-right text-xs text-danger">
          {resetState.error}
        </p>
      )}
      {reissueState.error && (
        <p role="alert" className="text-right text-xs text-danger">
          {reissueState.error}
        </p>
      )}
    </div>
  );
}
