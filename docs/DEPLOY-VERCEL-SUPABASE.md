# Deploying to Vercel + Supabase

For a personal test environment. Phase 6 of `docs/ROADMAP.md` still recommends a
VPS for the real thing — see *Why this is a test environment* at the end.

Nothing here needs a cron daemon: the app schedules itself from an open browser
tab (`/api/heartbeat` → `src/server/scheduler.ts`), so Vercel's once-a-day cron
limit is irrelevant.

---

## Before you start

Keep `.env.local` pointing at your local Docker database and **never** put the
Supabase URL in it. Two things read it and would act on the wrong database:
`drizzle.config.ts`, and `pnpm test:db`, which truncates. Both dotenv and Node's
`--env-file` leave already-set variables alone, so prefixing a command on the
shell wins — that is the pattern used throughout below.

---

## 1. Supabase

Create a project. Note the database password it shows you once, and the project
ref (the random string in the dashboard URL).

From **Connect** in the dashboard, copy two connection strings:

| Purpose | Which one | Port |
| --- | --- | --- |
| Migrations, as owner | **Session pooler** | 5432 |
| The app, as `tavren_app` | **Transaction pooler** | 6543 |

Use the pooler for both, not the direct connection — new projects only reach
that over IPv6, which most home connections and Vercel do not have.

### Run the migrations, as the owner

```bash
MIGRATION_DATABASE_URL="<session pooler URL, postgres role>" pnpm db:migrate
```

Migrations are hand-written and include the RLS policies in
`0001_finance_rls_backstop.sql`, which `drizzle-kit` does not model. That is why
they run as the owner and the app never does.

### Create the application role

Open `scripts/bootstrap-roles-supabase.sql`, replace `REPLACE_ME` with a fresh
password (`openssl rand -hex 20`), and run it in the Supabase SQL editor.

**Run it after the migrations**, not before — the last statement names the
`drizzle` schema, which does not exist until `db:migrate` has run.

Do not commit the file with the password in it.

### Verify the role, before trusting anything

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'tavren_app';
```

**Both flags must be `false`.** If either is true, the finance backstop is off
and *every test still passes* — `project_financials` and `user_rates` would be
readable by any query that forgot to open the gate. This is the one check on
this page that is not optional.

The app's pooler username is the role name plus the project ref —
`tavren_app.<project-ref>` — not a bare `tavren_app`. Copy the exact shape from
the dashboard's connect dialog and swap the role.

### Seed something to look at

```bash
DATABASE_URL="<transaction pooler URL, tavren_app role>" pnpm db:seed
```

It refuses to run against a database that already has people in it, and prints
each account's random password once. Keep that output.

---

## 2. Vercel

Import the repository. Next.js is detected; no build settings to change. The
build needs ~4GB and Vercel's builders have 8, so the local
`NODE_OPTIONS=--max-old-space-size=4096` is not needed there.

### Environment variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | transaction pooler URL, `tavren_app` role |
| `DATABASE_POOL_MAX` | `1` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `LOG_LEVEL` | `info` |

`DATABASE_POOL_MAX=1` matters. Each serverless invocation is its own process
with its own pool; the default of 10 becomes ten connections per concurrent
instance against a database that allows far fewer. The pooler in front is doing
the pooling — see the comment in `src/db/index.ts`.

**Do not add `MIGRATION_DATABASE_URL`.** It is the owner credential, nothing at
runtime reads it, and putting it there hands every function the ability to drop
the RLS policies.

Optional, each unlocking one feature and inert without it:

| Variable | Enables |
| --- | --- |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | the "Continue with Google" button |
| `DIGEST_WEBHOOK_URLS` | daily digest delivery to Discord/Slack |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `TAVREN_SHEET_TEMPLATE_ID` | the Google Sheets mirror — **read the warning below first** |

### Google sign-in

The credentials come from a Google Cloud **OAuth 2.0 Web application** client —
*not* the Sheets service account, which is a different kind of credential and
will not work. Add `https://<your-app>.vercel.app/api/auth/callback/google` as
an authorised redirect URI.

There is no auto-provisioning by design: an unknown Google account is refused
rather than turned into a user. Seed or invite the account first.

---

## 3. Check it works

1. Sign in with a seeded account.
2. Leave a tab open. Within a few minutes a `job_runs` row appears and
   `last_run_at` advances — that is the scheduler running without any cron.
3. Open the app in three browsers at once; still one run per hour, because the
   server holds the clock, not the page.

---

## Known hazards in this environment

**A transaction pooler needs `DATABASE_POOL_MAX=1` and `prepare: false`.** Both
are handled in `src/db/index.ts`; set the variable and check the comment there
before changing either.

**Supabase's free tier has no backups.** Fine for testing, disqualifying for
anything holding real billable hours.

**A free project pauses after a week of inactivity** and needs a manual restore.
Daily use never triggers it; a test environment you forget about will.

---

## Why this is a test environment

Vercel's Hobby plan is licensed for personal, non-commercial use. Running the
agency's actual operations on it is outside those terms, and the enforcement is
an account being switched off rather than a warning. Phase 6 recommends a
~$5–8/month VPS for the real deployment: it runs the app and Postgres together,
gives you the database roles this app depends on without negotiation, keeps
backups under your control, and costs less than Vercel Pro's $20.
