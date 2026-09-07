import type { Metadata } from "next";
import { inspectInvite } from "@/server/invite-queries";
import { googleEnabled } from "@/lib/auth";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

export const metadata: Metadata = { title: { absolute: "Your invitation · TavrenOPS" } };

/**
 * The invite page.
 *
 * Public by necessity — the whole point is that the person has no session yet —
 * and gated on a 256-bit token instead. It has its own bare layout, like
 * `/login`, so somebody who cannot sign in never sees the application shell.
 *
 * Its real job is narrower than it looks. Where Google is configured, an invited
 * person can already sign in without ever opening this: `maySignIn` passes the
 * moment their row exists, because the admin choosing that address is the
 * authorisation. So the page offers both paths and says so, rather than
 * pretending Google needs a token.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await inspectInvite(token);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
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

        {!invite.valid ? (
          /* One message for unknown, expired and already-accepted. Telling them
             apart would confirm to a stranger which tokens once existed. */
          <>
            <h1 className="display mb-2 text-4xl">Link expired</h1>
            <p className="mb-6 text-xs text-fg-muted">
              This invitation is no longer valid. Invites last seven days, and
              each one stops working once it has been used.
            </p>
            <div className="panel p-6 text-sm text-fg-muted">
              Ask whoever invited you to send a new link. If you have already set
              a password, sign in instead.
              <div className="mt-4">
                <a href="/login" className="btn-secondary btn-sm">
                  Go to sign in
                </a>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="display mb-2 text-4xl">
              Welcome{invite.name ? `, ${invite.name.split(" ")[0]}` : ""}
            </h1>
            <p className="mb-6 text-xs text-fg-muted">
              {/* Offering a choice when there is only one way in reads as a
                  missing button rather than as a simple page. */}
              {googleEnabled
                ? "Your account is ready. Choose how you want to sign in — you only need one."
                : "Your account is ready. Set a password and you are in."}
            </p>

            {googleEnabled && (
              <div className="panel mb-4 p-6">
                <h2 className="mb-1.5 text-sm font-semibold text-fg">
                  Continue with Google
                </h2>
                <p className="m-0 mb-4 text-xs text-fg-muted">
                  Nothing to remember, and nothing to set. Use the Google account
                  matching the address you were invited on.
                </p>
                <GoogleSignInButton label="Continue with Google" />
              </div>
            )}

            <div className="panel p-6">
              <h2 className="mb-1.5 text-sm font-semibold text-fg">
                {googleEnabled ? "Or set a password" : "Set a password"}
              </h2>
              <p className="m-0 mb-4 text-xs text-fg-muted">
                Use this if you would rather sign in with an email and password.
              </p>
              <AcceptInviteForm token={token} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
