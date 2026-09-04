import { PasswordForm } from "./password-form";
import { googleLoginAction } from "@/server/auth-actions";
import { googleEnabled } from "@/lib/auth";
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
            <form action={googleLoginAction} className="mb-4">
              <button type="submit" className="btn-secondary w-full">
                <GoogleMark />
                Continue with Google
              </button>
            </form>

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
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
