"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createUserAction, type UserFormState } from "@/server/user-actions";
import { ROLE_DESCRIPTIONS } from "@/server/user-schemas";
import { CopyField } from "./copy-field";
import { FormError } from "@/components/ui";

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

  /* The public origin, read on the client. The server does not reliably know
     its own behind a proxy, and `setState` in an effect is a lint error here —
     `useSyncExternalStore` is the pattern this codebase already uses for a
     client-only value, with a server snapshot that renders nothing. */
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Move focus to the credential panel on success: it is the only place the
    // password is ever shown, so it must not be missed.
    if (state.ok) resultRef.current?.focus();
  }, [state.ok, state.invitePath]);

  return (
    <div className="space-y-4">
      {state.ok && state.invitePath && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="panel border-ok bg-ok-soft p-4 outline-none"
        >
          <h3 className="text-sm font-semibold text-fg">
            {state.createdName} is ready — send them this link
          </h3>
          <p className="mt-1 mb-3 text-xs text-warn">
            Shown once, and not stored anywhere readable. It expires in seven
            days; if you lose it, re-send the invite from their row.
          </p>
          {/* An absolute URL built on the client, because the server does not
              reliably know its own public origin behind a proxy — and a link
              somebody has to prefix by hand is a link that arrives broken. */}
          <CopyField
            value={`${origin}${state.invitePath}`}
            label="Invitation link"
          />
        </div>
      )}

      {/* Remounting on each success clears every field and the role state in
          one step, which is why nothing here resets state from an effect. */}
      <UserFields
        key={state.invitePath ?? "new"}
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
        <FormError>{state.error}</FormError>
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
          An invitation link is generated and shown once. Send it to them; it
          expires in seven days.
        </p>
      </div>
    </form>
  );
}
