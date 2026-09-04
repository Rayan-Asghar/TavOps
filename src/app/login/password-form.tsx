"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/server/auth-actions";
import { FormError } from "@/components/ui";

const initial: LoginState = {};

/**
 * The password form. Split out of the page so the page itself can stay a server
 * component and read `searchParams` — OAuth failures come back as a query
 * parameter, and `useSearchParams` in a page needs a Suspense boundary that
 * buys nothing here.
 */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form action={formAction} className="panel space-y-4 p-6">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="field"
          placeholder="you@tavren.io"
          aria-invalid={!!state.error}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          aria-invalid={!!state.error}
        />
      </div>

      {state.error && (
        <FormError>{state.error}</FormError>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
