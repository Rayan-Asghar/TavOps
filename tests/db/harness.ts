import postgres from "postgres";
import { randomUUID } from "node:crypto";

/**
 * Owner-role client, for building and tearing down fixtures.
 *
 * Fixtures are written as the owner rather than the app role on purpose: the
 * app role is what the code under test uses, and a fixture that had to satisfy
 * the same policies it is meant to be testing would be circular. Note the owner
 * still cannot read the RLS tables without opting in — FORCE applies to it too,
 * which is the whole point of the backstop.
 */
const OWNER_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  "postgresql://tavren:tavren_dev_pw@localhost:5433/tavren_ops_test";

export const owner = postgres(OWNER_URL, { max: 2 });

/** Everything the fixtures touch, children first. */
const TABLES = [
  "audit_log",
  "notifications",
  "worklog_revisions",
  "work_logs",
  "time_sessions",
  "reviews",
  "blockers",
  "tasks",
  "project_members",
  "project_financials",
  "user_rates",
  "projects",
  "clients",
  "team_members",
  "teams",
  "users",
];

/**
 * Refuses to run anywhere but the test database.
 *
 * `resetDb` truncates every table. One mistyped URL — or a future change to how
 * the config derives it — would otherwise empty the development database
 * between test cases, and the first sign of it would be a colleague's data
 * gone. The name check costs nothing and makes that impossible.
 */
function assertTestDatabase() {
  const name = new URL(OWNER_URL).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to truncate "${name}": the fixture harness only runs against a database whose name ends in _test.`,
    );
  }
}

export async function resetDb() {
  assertTestDatabase();
  await owner.unsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`,
  );
}

export async function makeUser(opts: {
  name?: string;
  role?: "admin" | "head" | "sales" | "developer" | "collaborator";
  accessExpiresAt?: Date | null;
  isActive?: boolean;
}) {
  const id = randomUUID();
  await owner`
    INSERT INTO users (id, name, email, password_hash, global_role, is_active, access_expires_at)
    VALUES (${id}, ${opts.name ?? "Test Person"}, ${`${id}@example.test`},
            'x', ${opts.role ?? "developer"}, ${opts.isActive ?? true},
            ${opts.accessExpiresAt ?? null})`;
  return id;
}

export async function makeProject(opts: {
  code?: string;
  pmId?: string | null;
  deliveryLeadId?: string | null;
  salesOwnerId?: string | null;
}) {
  const id = randomUUID();
  await owner`
    INSERT INTO projects (id, code, name, pm_id, delivery_lead_id, sales_owner_id)
    VALUES (${id}, ${opts.code ?? id.slice(0, 8)}, 'Test Project',
            ${opts.pmId ?? null}, ${opts.deliveryLeadId ?? null},
            ${opts.salesOwnerId ?? null})`;
  return id;
}

export async function addMember(
  projectId: string,
  userId: string,
  role: "pm" | "tech_lead" | "developer" | "qa" | "observer" | "sales_owner" = "developer",
  expiresAt: Date | null = null,
) {
  await owner`
    INSERT INTO project_members (project_id, user_id, role, expires_at)
    VALUES (${projectId}, ${userId}, ${role}, ${expiresAt})`;
}

/**
 * Inserts a financials row.
 *
 * Wrapped in the opt-in because FORCE ROW LEVEL SECURITY applies to the table
 * owner too — without the GUC even this fixture is refused, which is precisely
 * the property `rls.test.ts` goes on to assert.
 */
export async function makeFinancials(projectId: string, contractValue: string) {
  await owner.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL tavren.finance_access = 'on'`);
    await tx`
      INSERT INTO project_financials (project_id, contract_value)
      VALUES (${projectId}, ${contractValue})`;
  });
}

export async function makeRate(userId: string, costPerHour: string) {
  await owner.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL tavren.finance_access = 'on'`);
    await tx`
      INSERT INTO user_rates (user_id, internal_cost_per_hour)
      VALUES (${userId}, ${costPerHour})`;
  });
}
