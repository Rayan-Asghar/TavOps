import { cookies } from "next/headers";
import { requirePageActor } from "@/lib/authz";
import { PageHeader } from "@/components/app-shell";
import { NameForm, PasswordForm } from "@/components/settings-forms";
import { ThemeToggle } from "@/components/theme-toggle";
import { DensityToggle } from "@/components/density-toggle";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { DENSITY_COOKIE, parseDensity } from "@/lib/density";
import { humanizeRole } from "@/lib/tone";

export const metadata = { title: "Settings" };

/**
 * Your own account.
 *
 * There was no self-service anything: a forgotten password meant asking an
 * admin, which puts a colleague's temporary password into a chat message and
 * leaves it there. Theme and density lived on whichever page happened to host
 * their toggle, which made them feel like page state rather than preferences.
 */
export default async function SettingsPage() {
  const actor = await requirePageActor();
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const density = parseDensity(jar.get(DENSITY_COOKIE)?.value);

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Settings"
        description={`Signed in as ${actor.name} · ${humanizeRole(actor.globalRole)}.`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <p className="eyebrow">Profile</p>
          <h2 className="display m-0 mb-4 text-xl">Who you are</h2>
          <NameForm current={actor.name} />
          {/* Roles are not self-service: granting yourself a capability is the
              one change nobody should be able to make alone. */}
          <p className="mt-4 border-t border-border pt-3 text-2xs text-fg-subtle">
            Your role is set by an admin under People.
          </p>
        </section>

        <section className="panel p-5">
          <p className="eyebrow">Security</p>
          <h2 className="display m-0 mb-4 text-xl">Password</h2>
          <PasswordForm />
        </section>

        <section className="panel p-5 lg:col-span-2">
          <p className="eyebrow">Appearance</p>
          <h2 className="display m-0 mb-4 text-xl">How it looks</h2>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="label m-0 mb-1.5">Theme</p>
              <ThemeToggle current={theme} />
            </div>
            <div>
              <p className="label m-0 mb-1.5">List density</p>
              <DensityToggle current={density} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
