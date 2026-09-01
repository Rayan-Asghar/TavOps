"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/server/auth-actions";
import { FormError } from "@/components/ui";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center bg-brand text-2xl font-black text-white">
            T
          </span>
          <span className="flex flex-col gap-1 leading-none">
            <strong className="text-lg tracking-[.08em]">TAVREN</strong>
            <small className="text-2xs tracking-[.14em] text-fg-muted">
              INTERNAL OS
            </small>
          </span>
        </div>

        <h1 className="display mb-2 text-4xl">Sign in</h1>
        <p className="mb-6 text-xs text-fg-muted">
          Operations, delivery and reporting in one place.
        </p>

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

        <p className="mt-4 text-xs text-fg-subtle">
          Accounts are created by an admin.
        </p>
      </div>
    </main>
  );
}
