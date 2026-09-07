import { PasswordForm } from "./password-form";
import { googleEnabled } from "@/lib/auth";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { FormError } from "@/components/ui";

/**
 * A server component so it can read `searchParams` — NextAuth reports a refused
 * OAuth sign-in by redirecting back here with `?error=`, and there is no way to
 * see that from a client page without a Suspense boundary that buys nothing.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // AccessDenied is our own signIn() refusing an address that is not a user.
  // Said plainly, because the alternative — "try again" — sends somebody round
  // the same loop forever. It names no address, so it is not an oracle for who
  // works here: you only reach it holding that Google account already.
  const oauthError =
    error === "AccessDenied"
      ? "That Google account is not set up in Tavren. Ask an admin to create your account first."
      : error
        ? "Google sign-in did not complete. Try again, or use your password."
        : null;

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center bg-brand text-2xl font-bold text-white">
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

        {oauthError && (
          <div className="mb-4">
            <FormError>{oauthError}</FormError>
          </div>
        )}

        {googleEnabled && (
          <>
            <div className="mb-4">
              <GoogleSignInButton />
            </div>

            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-2xs uppercase tracking-[.12em] text-fg-subtle">
                or
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <PasswordForm />

        <p className="mt-4 text-xs text-fg-subtle">
          Accounts are created by an admin.
        </p>
      </div>
    </main>
  );
}

/** Google's mark, inline: the CSP allows no external image hosts. */
