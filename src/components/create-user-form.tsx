"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createUserAction, type UserFormState } from "@/server/user-actions";
import { ROLE_DESCRIPTIONS } from "@/server/user-schemas";
import { CopyField } from "./copy-field";

const initial: UserFormState = {};

const ROLE_ORDER = [
  "developer",
  "sales",
  "head",
  "collaborator",
  "admin",
] as const;

function labelFor(role: string) {
  return role
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, initial);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Move focus to the credential panel on success: it is the only place the
    // password is ever shown, so it must not be missed.
    if (state.ok) resultRef.current?.focus();
  }, [state.ok, state.tempPassword]);

  return (
    <div className="space-y-4">
      {state.ok && state.tempPassword && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="panel border-ok bg-ok-soft p-4 outline-none"
        >
          <h3 className="text-sm font-semibold text-fg">
            {state.createdName} can now sign in
          </h3>
          <p className="mt-1 mb-3 text-xs text-warn">
            This password is shown once and is not stored anywhere readable.
            Send it to them now — if you lose it, reset it instead.
          </p>
          <CopyField value={state.tempPassword} label="Temporary password" />
        </div>
      )}

      {/* Remounting on each success clears every field and the role state in
          one step, which is why nothing here resets state from an effect. */}
      <UserFields
        key={state.tempPassword ?? "new"}
        action={action}
        pending={pending}
        state={state}
      />
    </div>
  );
}

function UserFields({
  action,
  pending,
  state,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  state: UserFormState;
}) {
  const [role, setRole] = useState<string>("developer");
  const err = state.fieldErrors ?? {};
  const isCollaborator = role === "collaborator";

  return (
    <form action={action} noValidate className="@container panel p-5">
      <h2 className="mb-4 text-sm font-semibold text-fg">Add a person</h2>

      <div className="grid gap-4 @md:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input
            id="name"
            name="name"
            required
            className="field"
            placeholder="Ayan Khan"
            aria-invalid={!!err.name}
            aria-describedby={err.name ? "err-name" : undefined}
          />
          {err.name && (
            <p id="err-name" className="mt-1 text-xs text-danger">{err.name}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="field"
            placeholder="ayan@tavren.io"
            aria-invalid={!!err.email}
            aria-describedby={err.email ? "err-email" : undefined}
          />
          {err.email && (
            <p id="err-email" className="mt-1 text-xs text-danger">{err.email}</p>
          )}
        </div>

        <div className="@md:col-span-2">
          <label className="label" htmlFor="globalRole">Role</label>
          <select
            id="globalRole"
            name="globalRole"
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>{labelFor(r)}</option>
            ))}
          </select>
          {/* Role names alone do not say what is being granted. */}
          <p className="mt-1.5 text-xs text-fg-muted">
            {ROLE_DESCRIPTIONS[role]}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="weeklyCapacityHours">
            Weekly capacity
          </label>
          <input
            id="weeklyCapacityHours"
            name="weeklyCapacityHours"
            type="number"
            min={0}
            max={80}
            defaultValue={40}
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="accessExpiresAt">
            Access expires {isCollaborator ? "" : "(optional)"}
          </label>
          <input
            id="accessExpiresAt"
            name="accessExpiresAt"
            type="date"
            required={isCollaborator}
            className="field"
            aria-invalid={!!err.accessExpiresAt}
            aria-describedby={err.accessExpiresAt ? "err-exp" : "hint-exp"}
          />
          {err.accessExpiresAt ? (
            <p id="err-exp" className="mt-1 text-xs text-danger">
              {err.accessExpiresAt}
            </p>
          ) : (
            <p id="hint-exp" className="mt-1 text-xs text-fg-subtle">
              {isCollaborator
                ? "Required. Access revokes itself on this date."
                : "Leave blank for permanent staff."}
            </p>
          )}
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="mt-5 space-y-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary w-full whitespace-nowrap"
        >
          {pending ? "Creating…" : "Create account"}
        </button>
        <p className="text-xs text-fg-subtle">
          A temporary password is generated and shown once.
        </p>
      </div>
    </form>
  );
}
