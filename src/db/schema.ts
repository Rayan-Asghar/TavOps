import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const globalRole = pgEnum("global_role", [
  "admin",
  "pm",
  "delivery_lead",
  "sales",
  "developer",
  "collaborator",
]);

/** Lifecycle is where the project is in the pipeline. Deliberately kept
 *  separate from health — the original spec conflated them, which made
 *  "Active" and "At Risk" mutually exclusive when they are orthogonal. */
export const projectLifecycle = pgEnum("project_lifecycle", [
  "draft",
  "active",
  "completed",
  "archived",
]);

/** Health is derived by the risk sweep, never set by hand. */
export const projectHealth = pgEnum("project_health", [
  "on_track",
  "at_risk",
  "blocked",
]);

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
]);

export const projectRole = pgEnum("project_role", [
  "sales_owner",
  "pm",
  "tech_lead",
  "developer",
  "qa",
  "observer",
]);

export const blockerCategory = pgEnum("blocker_category", [
  "missing_access",
  "unclear_requirement",
  "needs_decision",
  "waiting_on_client",
  "technical",
  "other",
]);

export const blockerStatus = pgEnum("blocker_status", [
  "open",
  "acknowledged",
  "resolved",
]);

/** Who has to act. `client` blockers stop the delivery clock and route to
 *  the sales owner rather than counting against the developer. */
export const ownerSide = pgEnum("owner_side", ["internal", "client"]);

export const syncMode = pgEnum("sync_mode", ["append", "update"]);

export const syncStatus = pgEnum("sync_status", [
  "pending",
  "running",
  "success",
  "failed",
]);

export const notificationKind = pgEnum("notification_kind", [
  "blocker_opened",
  "blocker_escalated",
  "blocker_resolved",
  "task_assigned",
  "task_needs_review",
  "task_stalled",
  "update_missing",
  "sync_failed",
  "project_at_risk",
]);

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    globalRole: globalRole("global_role").notNull().default("developer"),
    skills: jsonb("skills").$type<string[]>().default([]).notNull(),
    weeklyCapacityHours: integer("weekly_capacity_hours").default(40).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /** Set for temp collaborators; access checks refuse them past this. */
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/** Split out from `users` on purpose: what you pay each person is the most
 *  damaging thing in this system to leak internally. Nothing joins this into
 *  a shared DTO — it is read only by explicit admin-scoped queries, and RLS
 *  is enabled on it as a backstop. */
export const userRates = pgTable("user_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  internalCostPerHour: numeric("internal_cost_per_hour", {
    precision: 10,
    scale: 2,
  }).notNull(),
  billableRatePerHour: numeric("billable_rate_per_hour", {
    precision: 10,
    scale: 2,
  }),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true })
    .defaultNow()
    .notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
});

/* ------------------------------------------------------------------ *
 * Clients & Projects
 * ------------------------------------------------------------------ */

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 120 }),
  primaryContactName: varchar("primary_contact_name", { length: 160 }),
  primaryContactEmail: varchar("primary_contact_email", { length: 255 }),
  source: varchar("source", { length: 60 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    lifecycle: projectLifecycle("lifecycle").default("draft").notNull(),
    health: projectHealth("health").default("on_track").notNull(),
    projectType: varchar("project_type", { length: 80 }),
    salesOwnerId: uuid("sales_owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pmId: uuid("pm_id").references(() => users.id, { onDelete: "set null" }),
    deliveryLeadId: uuid("delivery_lead_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: timestamp("start_date", { withTimezone: true }),
    /** Internal target, always earlier than the client-facing date. */
    internalDueDate: timestamp("internal_due_date", { withTimezone: true }),
    clientDueDate: timestamp("client_due_date", { withTimezone: true }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("projects_code_unique").on(t.code),
    index("projects_lifecycle_idx").on(t.lifecycle),
    index("projects_client_idx").on(t.clientId),
  ],
);

/** Money lives here, never on `projects`. Same reasoning as user_rates. */
export const projectFinancials = pgTable("project_financials", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  contractValue: numeric("contract_value", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  platformFeePct: numeric("platform_fee_pct", { precision: 5, scale: 2 }),
  budgetedHours: numeric("budgeted_hours", { precision: 8, scale: 2 }),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Temp access for contractors; the access check treats past-dated as gone. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("project_members_unique").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Work
 * ------------------------------------------------------------------ */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: taskStatus("status").default("todo").notNull(),
    estimatedHours: numeric("estimated_hours", { precision: 6, scale: 2 }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    priority: integer("priority").default(3).notNull(),
    orderIndex: integer("order_index").default(0).notNull(),
    /** Drives the "needs update" sweep without scanning work_logs. */
    lastUpdateAt: timestamp("last_update_at", { withTimezone: true }),
    /** Row in the client's sheet this task maps to, in update-mode syncs. */
    sheetRowRef: varchar("sheet_row_ref", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_status_idx").on(t.status),
  ],
);

/** taskId is nullable on purpose — client calls, scoping meetings and
 *  internal reviews are real billable work that belongs to no task. The
 *  original data model had no home for those hours. */
export const workLogs = pgTable(
  "work_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workDate: timestamp("work_date", { withTimezone: true })
      .defaultNow()
      .notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    notes: text("notes").notNull(),
    /** Status the developer moved the task to with this entry, if any. */
    resultingStatus: taskStatus("resulting_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("work_logs_project_idx").on(t.projectId),
    index("work_logs_task_idx").on(t.taskId),
    index("work_logs_user_date_idx").on(t.userId, t.workDate),
  ],
);

export const blockers = pgTable(
  "blockers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    reportedById: uuid("reported_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Whoever has to act. Client-side blockers route to the sales owner. */
    assignedToId: uuid("assigned_to_id").references(() => users.id, {
      onDelete: "set null",
    }),
    category: blockerCategory("category").notNull(),
    ownerSide: ownerSide("owner_side").default("internal").notNull(),
    status: blockerStatus("status").default("open").notNull(),
    description: text("description").notNull(),
    isUrgent: boolean("is_urgent").default(false).notNull(),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    escalationLevel: integer("escalation_level").default(0).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("blockers_project_idx").on(t.projectId),
    index("blockers_status_idx").on(t.status),
    index("blockers_assigned_idx").on(t.assignedToId),
  ],
);

/* ------------------------------------------------------------------ *
 * Inbox
 * ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    body: text("body"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    blockerId: uuid("blocker_id").references(() => blockers.id, {
      onDelete: "cascade",
    }),
    /** Actionable items stay in the inbox until dealt with, not just read. */
    isActionable: boolean("is_actionable").default(false).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    /** Collapses repeat sweeps into one row instead of nagging daily. */
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.resolvedAt),
    uniqueIndex("notifications_dedupe_unique").on(t.userId, t.dedupeKey),
  ],
);

/* ------------------------------------------------------------------ *
 * Google Sheets sync
 * ------------------------------------------------------------------ */

export const sheetMappings = pgTable(
  "sheet_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    spreadsheetId: varchar("spreadsheet_id", { length: 120 }).notNull(),
    sheetName: varchar("sheet_name", { length: 120 }).default("Sheet1").notNull(),
    mode: syncMode("mode").default("append").notNull(),
    /** Tavren field -> column letter, e.g. { taskTitle: "B", hours: "D" } */
    columnMap: jsonb("column_map").$type<Record<string, string>>().notNull(),
    headerRow: integer("header_row").default(1).notNull(),
    /** Tavren is authoritative for mapped columns; anything else in the sheet
     *  is left untouched so a client's own notes are never overwritten. */
    isEnabled: boolean("is_enabled").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("sheet_mappings_project_unique").on(t.projectId)],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mappingId: uuid("mapping_id")
      .notNull()
      .references(() => sheetMappings.id, { onDelete: "cascade" }),
    workLogId: uuid("work_log_id").references(() => workLogs.id, {
      onDelete: "cascade",
    }),
    status: syncStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastError: text("last_error"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("sync_jobs_status_idx").on(t.status, t.nextAttemptAt),
    index("sync_jobs_mapping_idx").on(t.mappingId),
  ],
);

/* ------------------------------------------------------------------ *
 * Audit — scoped to the data that actually warrants it
 * ------------------------------------------------------------------ */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many, one }) => ({
  memberships: many(projectMembers),
  tasks: many(tasks),
  workLogs: many(workLogs),
  notifications: many(notifications),
  rate: one(userRates),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  pm: one(users, { fields: [projects.pmId], references: [users.id] }),
  deliveryLead: one(users, {
    fields: [projects.deliveryLeadId],
    references: [users.id],
  }),
  salesOwner: one(users, {
    fields: [projects.salesOwnerId],
    references: [users.id],
  }),
  members: many(projectMembers),
  tasks: many(tasks),
  workLogs: many(workLogs),
  blockers: many(blockers),
  financials: one(projectFinancials),
  sheetMapping: one(sheetMappings),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
  }),
  workLogs: many(workLogs),
  blockers: many(blockers),
}));

export const workLogsRelations = relations(workLogs, ({ one }) => ({
  project: one(projects, {
    fields: [workLogs.projectId],
    references: [projects.id],
  }),
  task: one(tasks, { fields: [workLogs.taskId], references: [tasks.id] }),
  user: one(users, { fields: [workLogs.userId], references: [users.id] }),
}));

export const blockersRelations = relations(blockers, ({ one }) => ({
  project: one(projects, {
    fields: [blockers.projectId],
    references: [projects.id],
  }),
  task: one(tasks, { fields: [blockers.taskId], references: [tasks.id] }),
  reportedBy: one(users, {
    fields: [blockers.reportedById],
    references: [users.id],
  }),
  assignedTo: one(users, {
    fields: [blockers.assignedToId],
    references: [users.id],
  }),
}));

export const sheetMappingsRelations = relations(
  sheetMappings,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [sheetMappings.projectId],
      references: [projects.id],
    }),
    jobs: many(syncJobs),
  }),
);

export const syncJobsRelations = relations(syncJobs, ({ one }) => ({
  mapping: one(sheetMappings, {
    fields: [syncJobs.mappingId],
    references: [sheetMappings.id],
  }),
  workLog: one(workLogs, {
    fields: [syncJobs.workLogId],
    references: [workLogs.id],
  }),
}));
