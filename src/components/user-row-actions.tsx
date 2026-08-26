"use client";

import { useActionState, useState } from "react";
import {
  resetPasswordAction,
  setUserActiveAction,
  type UserFormState,
} from "@/server/user-actions";
import { CopyField } from "./copy-field";

const initial: UserFormState = {};

export function UserRowActions({
  userId,
  userName,
  isActive,
  isSelf,
  isLastAdmin,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
}) {
  const [resetState, resetAction, resetting] = useActionState(
    resetPasswordAction,
    initial,
  );
  // Two-step inline confirm rather than a modal: deactivation is reversible,
  // so it needs a speed bump, not a ceremony.
  const [confirming, setConfirming] = useState(false);

  const blocked = isSelf || (isLastAdmin && isActive);
  const blockedReason = isSelf
    ? "You cannot deactivate your own account."
    : "This is the last active admin.";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={resetAction}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={resetting}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {resetting ? "Resetting…" : "Reset password"}
          </button>
        </form>

        {isActive ? (
          confirming ? (
            <form action={setUserActiveAction} className="flex gap-2">
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="makeActive" value="false" />
              <button
                type="submit"
                className="btn px-3 py-1.5 text-xs bg-danger text-white hover:bg-brand-hover"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={blocked}
              title={blocked ? blockedReason : undefined}
              onClick={() => setConfirming(true)}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Deactivate
            </button>
          )
        ) : (
          <form action={setUserActiveAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="makeActive" value="true" />
            <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
              Reactivate
            </button>
          </form>
        )}
      </div>

      {blocked && isActive && !confirming && (
        <p className="text-right text-xs text-fg-subtle">{blockedReason}</p>
      )}

      {resetState.ok && resetState.tempPassword && (
        <div role="status" className="rounded-lg border border-ok/40 bg-ok/[0.06] p-3">
          <p className="mb-2 text-xs text-warn">
            New password for {userName}. Shown once — send it now.
          </p>
          <CopyField value={resetState.tempPassword} />
        </div>
      )}
      {resetState.error && (
        <p role="alert" className="text-right text-xs text-danger">
          {resetState.error}
        </p>
      )}
    </div>
  );
}
