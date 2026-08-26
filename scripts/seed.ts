/**
 * Development seed. Creates the Tavren team, two live projects and enough
 * task/blocker state to exercise the inbox, escalation and sync paths.
 *
 * Run with: pnpm db:seed
 */
// Env comes from --env-file=.env.local (see package.json); an inline dotenv
// call would lose the race against import hoisting of ../src/db.
import bcrypt from "bcryptjs";
import { db, withFinanceAccess } from "../src/db";
import {
  blockers,
  clients,
  projectFinancials,
  projectMembers,
  projects,
  tasks,
  userRates,
  users,
  workLogs,
} from "../src/db/schema";
import { addBusinessHours } from "../src/lib/business-time";

const DEV_PASSWORD = "tavren123";

async function main() {
  console.log("Seeding TavrenOPS...");

  const hash = await bcrypt.hash(DEV_PASSWORD, 12);

  const team = await db
    .insert(users)
    .values([
      { name: "Rayan", email: "contact@tavren.io", passwordHash: hash, globalRole: "admin", skills: ["ops"] },
      { name: "Hammad", email: "hammad@tavren.io", passwordHash: hash, globalRole: "pm", skills: ["delivery", "client-comms"] },
      { name: "Hozefa", email: "hozefa@tavren.io", passwordHash: hash, globalRole: "delivery_lead", skills: ["shopify", "wordpress"] },
      { name: "Muzammil", email: "muzammil@tavren.io", passwordHash: hash, globalRole: "sales", skills: ["bd"] },
      { name: "Saqlain", email: "saqlain@tavren.io", passwordHash: hash, globalRole: "sales", skills: ["upwork"] },
      { name: "Shahab", email: "shahab@tavren.io", passwordHash: hash, globalRole: "sales", skills: ["upwork"] },
      { name: "Ayan", email: "ayan@tavren.io", passwordHash: hash, globalRole: "developer", skills: ["shopify", "liquid", "react"] },
      { name: "Abdur Rehman", email: "abdur@tavren.io", passwordHash: hash, globalRole: "developer", skills: ["wordpress", "php"] },
      {
        name: "Ahmed",
        email: "ahmed@tavren.io",
        passwordHash: hash,
        globalRole: "collaborator",
        skills: ["qa"],
        // Temp contractor: access lapses in a fortnight.
        accessExpiresAt: new Date(Date.now() + 14 * 864e5),
      },
    ])
    .returning();

  const by = (name: string) => team.find((u) => u.name === name)!;

  const [northwind, brightleaf] = await db
    .insert(clients)
    .values([
      { name: "Northwind Apparel", industry: "Fashion / DTC", source: "upwork", primaryContactName: "Dana Reyes", primaryContactEmail: "dana@northwind.example" },
      { name: "Brightleaf Organics", industry: "Food & Beverage", source: "referral", primaryContactName: "Sam Okafor", primaryContactEmail: "sam@brightleaf.example" },
    ])
    .returning();

  const [shopify, wp] = await db
    .insert(projects)
    .values([
      {
        code: "NW-001",
        name: "Northwind Shopify Rebuild",
        clientId: northwind.id,
        lifecycle: "active",
        projectType: "Shopify Store Build",
        salesOwnerId: by("Saqlain").id,
        pmId: by("Hammad").id,
        deliveryLeadId: by("Hozefa").id,
        startDate: new Date(Date.now() - 12 * 864e5),
        internalDueDate: new Date(Date.now() + 10 * 864e5),
        clientDueDate: new Date(Date.now() + 17 * 864e5),
        description: "Full theme rebuild, Klaviyo migration, 40 PDPs.",
      },
      {
        code: "BL-002",
        name: "Brightleaf WordPress Refresh",
        clientId: brightleaf.id,
        lifecycle: "active",
        projectType: "WordPress Refresh",
        salesOwnerId: by("Muzammil").id,
        pmId: by("Hammad").id,
        deliveryLeadId: by("Hozefa").id,
        startDate: new Date(Date.now() - 5 * 864e5),
        internalDueDate: new Date(Date.now() + 20 * 864e5),
        clientDueDate: new Date(Date.now() + 26 * 864e5),
        description: "Marketing site refresh with a new blog template.",
      },
    ])
    .returning();

  await db.insert(projectMembers).values([
    { projectId: shopify.id, userId: by("Ayan").id, role: "developer" },
    { projectId: shopify.id, userId: by("Hozefa").id, role: "tech_lead" },
    { projectId: shopify.id, userId: by("Saqlain").id, role: "sales_owner" },
    { projectId: shopify.id, userId: by("Ahmed").id, role: "qa", expiresAt: new Date(Date.now() + 14 * 864e5) },
    { projectId: wp.id, userId: by("Abdur Rehman").id, role: "developer" },
    { projectId: wp.id, userId: by("Hozefa").id, role: "tech_lead" },
  ]);

  // Money and rates are gated by RLS, so seeding them needs the explicit opt-in.
  await withFinanceAccess(async (tx) => {
    await tx.insert(projectFinancials).values([
      { projectId: shopify.id, contractValue: "12000.00", platformFeePct: "10.00", budgetedHours: "160.00" },
      { projectId: wp.id, contractValue: "4500.00", platformFeePct: "0.00", budgetedHours: "70.00" },
    ]);
    await tx.insert(userRates).values([
      { userId: by("Ayan").id, internalCostPerHour: "12.00", billableRatePerHour: "45.00" },
      { userId: by("Abdur Rehman").id, internalCostPerHour: "11.00", billableRatePerHour: "40.00" },
      { userId: by("Hozefa").id, internalCostPerHour: "20.00", billableRatePerHour: "60.00" },
    ]);
  });

  const taskRows = await db
    .insert(tasks)
    .values([
      { projectId: shopify.id, title: "Homepage build", assigneeId: by("Ayan").id, status: "in_progress", estimatedHours: "16.00", dueDate: new Date(Date.now() + 3 * 864e5), lastUpdateAt: new Date(Date.now() - 3 * 864e5), sheetRowRef: "2" },
      { projectId: shopify.id, title: "PDP template", assigneeId: by("Ayan").id, status: "in_progress", estimatedHours: "20.00", dueDate: new Date(Date.now() - 1 * 864e5), sheetRowRef: "3" },
      { projectId: shopify.id, title: "Klaviyo setup", assigneeId: by("Ayan").id, status: "todo", estimatedHours: "8.00", sheetRowRef: "4" },
      { projectId: shopify.id, title: "Collection pages", assigneeId: by("Hozefa").id, status: "in_review", estimatedHours: "10.00", lastUpdateAt: new Date(), sheetRowRef: "5" },
      { projectId: wp.id, title: "Blog template", assigneeId: by("Abdur Rehman").id, status: "in_progress", estimatedHours: "12.00", lastUpdateAt: new Date(), sheetRowRef: "2" },
      { projectId: wp.id, title: "Contact form + CRM hook", assigneeId: by("Abdur Rehman").id, status: "todo", estimatedHours: "5.00", sheetRowRef: "3" },
    ])
    .returning();

  const homepage = taskRows.find((t) => t.title === "Homepage build")!;
  const pdp = taskRows.find((t) => t.title === "PDP template")!;

  await db.insert(workLogs).values([
    { projectId: shopify.id, taskId: homepage.id, userId: by("Ayan").id, hours: "6.00", notes: "Hero + featured collection sections, desktop and mobile.", resultingStatus: "in_progress", workDate: new Date(Date.now() - 3 * 864e5) },
    { projectId: shopify.id, taskId: pdp.id, userId: by("Ayan").id, hours: "4.50", notes: "Variant picker and gallery scaffolding.", resultingStatus: "in_progress", workDate: new Date(Date.now() - 2 * 864e5) },
    { projectId: shopify.id, taskId: null, userId: by("Hammad").id, hours: "1.00", notes: "Client call: scope walkthrough for Klaviyo migration.", workDate: new Date(Date.now() - 2 * 864e5) },
  ]);

  // One internal blocker already past SLA, and one client dependency that must
  // NOT count against the developer when the sweeps run.
  await db.insert(blockers).values([
    {
      projectId: shopify.id,
      taskId: pdp.id,
      reportedById: by("Ayan").id,
      assignedToId: by("Hozefa").id,
      category: "missing_access",
      ownerSide: "internal",
      description: "Need Shopify collaborator access to the live theme.",
      isUrgent: true,
      slaDueAt: addBusinessHours(new Date(Date.now() - 3 * 864e5), 4),
    },
    {
      projectId: shopify.id,
      taskId: null,
      reportedById: by("Ayan").id,
      assignedToId: by("Saqlain").id,
      category: "waiting_on_client",
      ownerSide: "client",
      description: "Client has not supplied product photography for 40 PDPs.",
      slaDueAt: addBusinessHours(new Date(Date.now() - 2 * 864e5), 8),
    },
  ]);

  console.log(`  users:    ${team.length}`);
  console.log(`  clients:  2`);
  console.log(`  projects: 2`);
  console.log(`  tasks:    ${taskRows.length}`);
  console.log(`\nSign in with any address below, password: ${DEV_PASSWORD}`);
  for (const u of team) console.log(`  ${u.email.padEnd(24)} ${u.globalRole}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
