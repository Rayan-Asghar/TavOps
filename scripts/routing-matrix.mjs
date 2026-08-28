/**
 * Prints the whole routing table.
 *
 * Routing is the part most likely to be argued about, so it should be possible
 * to see every outcome at once without starting a server or reading the code.
 *   npx tsx scripts/routing-matrix.mjs
 */
import {
  resolveBlockerRouting,
  CATEGORY_LABELS,
} from "../src/lib/blocker-routing.ts";

const NAMES = {
  hammad: "Hammad (PM)",
  hozefa: "Hozefa (Delivery Lead)",
  saqlain: "Saqlain (Sales Owner)",
  abdur: "Abdur (other dev)",
  ayan: "Ayan (reporter)",
};
const n = (id) => NAMES[id] ?? (id ?? "—");

const ctx = (category, extra = {}) => ({
  category,
  severity: "normal",
  reporterId: "ayan",
  project: { pmId: "hammad", deliveryLeadId: "hozefa", salesOwnerId: "saqlain" },
  projectRoles: {},
  ...extra,
});

console.log(
  "CATEGORY".padEnd(21),
  "ASSIGNEE".padEnd(24),
  "COPIED".padEnd(24),
  "SIDE".padEnd(9),
  "SLA",
);
console.log("-".repeat(88));
for (const c of Object.keys(CATEGORY_LABELS)) {
  const extra = c === "dependency_dev" ? { blockedOnUserId: "abdur" } : {};
  const r = resolveBlockerRouting(ctx(c, extra));
  console.log(
    c.padEnd(21),
    n(r.assigneeId).padEnd(24),
    (r.watcherIds.map(n).join(", ") || "—").padEnd(24),
    r.ownerSide.padEnd(9),
    r.slaHours + "h",
  );
}

console.log("\n--- severity drives the SLA ---");
for (const sev of ["low", "normal", "high", "critical"]) {
  const r = resolveBlockerRouting({ ...ctx("technical"), severity: sev });
  console.log("  technical /", sev.padEnd(9), "->", r.slaHours + "h");
}

console.log('\n--- a production incident is forced critical even if ticked "low" ---');
console.log(
  "  ->",
  resolveBlockerRouting({ ...ctx("production_incident"), severity: "low" })
    .slaHours + "h",
);

console.log("\n--- a project role beats the project default ---");
console.log(
  "  tech_lead=Abdur ->",
  n(
    resolveBlockerRouting({
      ...ctx("technical"),
      projectRoles: { tech_lead: "abdur" },
    }).assigneeId,
  ),
);

console.log("\n--- the reporter is never copied on their own report ---");
console.log(
  "  reporter=Hammad, copied =",
  resolveBlockerRouting({ ...ctx("technical"), reporterId: "hammad" })
    .watcherIds.map(n)
    .join(", ") || "(none)",
);

console.log("\n--- an unstaffed project routes to nobody rather than guessing ---");
console.log(
  "  ->",
  n(
    resolveBlockerRouting({
      ...ctx("technical"),
      project: { pmId: null, deliveryLeadId: null, salesOwnerId: null },
    }).assigneeId,
  ),
);
