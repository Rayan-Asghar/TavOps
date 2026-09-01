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
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

/**
 * Hozefa, Hammad and Muzammil run the company between them, so they share one
 * `head` role rather than being split into PM / delivery lead / sales head.
 * Which of them owns a given piece of work is decided by their role ON THAT
 * PROJECT and by which team the person reporting it belongs to — not by a
 * global title that would be wrong half the time.
 */
export const globalRole = pgEnum("global_role", [
  "admin",
  "head",
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

/** Categories are the routing key, so they name who owns the fix, not just
 *  what went wrong. Splitting "missing access" from "missing asset" matters
 *  because the two go to different people. */
export const blockerCategory = pgEnum("blocker_category", [
  "missing_access",
  "unclear_requirement",
  "needs_decision",
  "waiting_on_client",
  "technical",
  "other",
  "missing_asset",
  "client_approval",
  "scope_conflict",
  "commercial_scope",
  "qa_issue",
  "dependency_dev",
  "production_incident",
]);

export const blockerSeverity = pgEnum("blocker_severity", [
  "low",
  "normal",
  "high",
  "critical",
]);

export const blockerStatus = pgEnum("blocker_status", [
  "open",
  "acknowledged",
  "resolved",
]);

/** Who has to act. `client` blockers stop the delivery clock and route to
 *  the sales owner rather than counting against the developer. */
export const ownerSide = pgEnum("owner_side", ["internal", "client"]);

export const reviewDecision = pgEnum("review_decision", [
  "approved",
  "revision_needed",
]);

/**
 * Where a change came from.
 *
 * `sheet` is dead — the client-sheet sync it belonged to was removed. Postgres
 * cannot drop a value from an enum in use, and recreating the type across three
 * columns costs more than one unused label. Do not write it.
 */
export const changeSource = pgEnum("change_source", [
  "sheet",
  "ui",
  "api",
  "system",
]);

/** `sync` is dead with the sheet sync; see the note on changeSource. */
export const auditActorType = pgEnum("audit_actor_type", [
  "user",
  "system",
  "sync",
]);

export const notificationKind = pgEnum("notification_kind", [
  "blocker_opened",
  "blocker_escalated",
  "blocker_resolved",
  "task_assigned",
  "task_needs_review",
  "task_stalled",
  "update_missing",
  // Dead with the sheet sync; see the note on changeSource. Never emitted.
  "sync_failed",
  "project_at_risk",
  "review_approved",
  "revision_requested",
  "feasibility_requested",
  "feasibility_answered",
  "followup_due",
  "timer_left_running",
]);

export const timerStatus = pgEnum("timer_status", [
  "running",
  "paused",
  "completed",
]);

/** Upwork-style proposal pipeline, in the order a deal actually moves. */
export const proposalStatus = pgEnum("proposal_status", [
  "sent",
  "viewed",
  "responded",
  "meeting",
  "qualified",
  "won",
  "lost",
]);

export const feasibilityStatus = pgEnum("feasibility_status", [
  "not_needed",
  "pending",
  "approved",
  "rejected",
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

/**
 * Teams are deliberately many-to-many.
 *
 * A developer can sit in more than one team and a lead runs several people, so
 * "who is this person's lead" has no single answer in general — it is resolved
 * per blocker, preferring the lead who is also on the project in question.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    leadId: uuid("lead_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** What this team does, used to break ties when someone has two leads. */
    discipline: varchar("discipline", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("teams_name_unique").on(t.name)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("team_members_unique").on(t.teamId, t.userId),
    index("team_members_user_idx").on(t.userId),
  ],
);

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
    /** Work dated on or before this is locked: developers cannot edit or delete
     *  a log that has already been billed. */
    invoicedThrough: date("invoiced_through"),
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
    /** The one note a work log carries. Internal, like everything here. */
    internalNotes: text("internal_notes").notNull(),
    /** Status the developer moved the task to with this entry, if any. */
    resultingStatus: taskStatus("resulting_status"),
    /** When the OS first recorded this entry, as opposed to the day the work
     *  happened. Compliance keys on this. */
    loggedAt: timestamp("logged_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Points at the head of the revision chain; these columns mirror it. */
    currentRevisionId: uuid("current_revision_id"),
    source: changeSource("source").default("ui").notNull(),
    /** Soft delete: the row stays for the audit trail and the revision chain. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("work_logs_project_idx").on(t.projectId),
    index("work_logs_task_idx").on(t.taskId),
    index("work_logs_user_date_idx").on(t.userId, t.workDate),
    index("work_logs_live_idx").on(t.projectId, t.deletedAt),
  ],
);

/**
 * Append-only history of every version of a work log.
 *
 * Version 1 is the original. Editing produces vN. Deleting produces a reversal
 * (hours 0, isReversal true), so a corrected entry keeps its own history rather
 * than being overwritten in place.
 */
export const worklogRevisions = pgTable(
  "worklog_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workLogId: uuid("work_log_id")
      .notNull()
      .references(() => workLogs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    workDate: date("work_date").notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    statusAfter: text("status_after"),
    internalNotes: text("internal_notes"),
    isReversal: boolean("is_reversal").default(false).notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    source: changeSource("source").default("ui").notNull(),
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("worklog_revisions_version_unique").on(t.workLogId, t.version),
    index("worklog_revisions_log_idx").on(t.workLogId, t.changedAt),
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
    severity: blockerSeverity("severity").default("normal").notNull(),
    /** For dependency_dev: the developer whose work this is waiting on. */
    blockedOnUserId: uuid("blocked_on_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Which rule picked the assignee, so "why did this come to me" is
     *  answerable without re-deriving the routing. */
    routingRule: varchar("routing_rule", { length: 60 }),
    /** Notified but not accountable; the SLA clock sits on the assignee only. */
    watcherIds: jsonb("watcher_ids").$type<string[]>().default([]).notNull(),
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

/**
 * One QA decision on one task.
 *
 * Kept as its own row rather than a status flag so revision rounds are
 * countable: a task approved first time and a task approved on the fourth
 * attempt look identical from `tasks.status` alone, and the difference is the
 * whole point of tracking QA.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Who submitted the work, so the round-trip is attributable both ways. */
    submittedById: uuid("submitted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decision: reviewDecision("decision").notNull(),
    comments: text("comments"),
    /** 1 for the first review of a task, 2 for the next, and so on. */
    round: integer("round").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("reviews_task_idx").on(t.taskId),
    index("reviews_project_idx").on(t.projectId),
    index("reviews_reviewer_idx").on(t.reviewerId, t.createdAt),
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
 * Audit — scoped to the data that actually warrants it
 * ------------------------------------------------------------------ */

export const timeSessions = pgTable(
  "time_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: timerStatus("status").default("running").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Null while paused. */
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    accumulatedSeconds: integer("accumulated_seconds").default(0).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    completionNote: text("completion_note"),
    /** Set when someone corrects a forgotten timer; the reason is mandatory. */
    adjustedSeconds: integer("adjusted_seconds"),
    adjustmentReason: text("adjustment_reason"),
    workLogId: uuid("work_log_id").references(() => workLogs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("time_sessions_user_idx").on(t.userId, t.status),
    index("time_sessions_task_idx").on(t.taskId),
  ],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    jobTitle: varchar("job_title", { length: 300 }).notNull(),
    jobUrl: text("job_url"),
    category: varchar("category", { length: 80 }),
    source: varchar("source", { length: 40 }).default("upwork").notNull(),
    budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    status: proposalStatus("status").default("sent").notNull(),

    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    meetingAt: timestamp("meeting_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    /** Routed to a lead when the rep cannot judge the technical scope alone. */
    feasibility: feasibilityStatus("feasibility").default("not_needed").notNull(),
    feasibilityAssignedToId: uuid("feasibility_assigned_to_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    feasibilityNote: text("feasibility_note"),

    followUpDueAt: timestamp("follow_up_due_at", { withTimezone: true }),
    wonValue: numeric("won_value", { precision: 12, scale: 2 }),
    /** The handoff: a won proposal points at the project it became. */
    wonProjectId: uuid("won_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("proposals_owner_idx").on(t.ownerId, t.sentAt),
    index("proposals_status_idx").on(t.status),
    index("proposals_followup_idx").on(t.followUpDueAt),
  ],
);

/**
 * Append-only. Written in the same transaction as the change it records, and
 * the migration REVOKEs UPDATE and DELETE from the app role — an audit trail
 * the application can rewrite is not an audit trail.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    actorType: auditActorType("actor_type").default("user").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: uuid("entity_id"),
    action: varchar("action", { length: 80 }).notNull(),
    /** DEPRECATED pair — dropped in the next migration once backfilled. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    source: changeSource("source").default("ui").notNull(),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_actor_idx").on(t.actorId, t.ts),
    index("audit_log_project_idx").on(t.projectId, t.ts),
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

export const worklogRevisionsRelations = relations(
  worklogRevisions,
  ({ one }) => ({
    workLog: one(workLogs, {
      fields: [worklogRevisions.workLogId],
      references: [workLogs.id],
    }),
  }),
);

export const timeSessionsRelations = relations(timeSessions, ({ one }) => ({
  task: one(tasks, { fields: [timeSessions.taskId], references: [tasks.id] }),
  project: one(projects, {
    fields: [timeSessions.projectId],
    references: [projects.id],
  }),
  user: one(users, { fields: [timeSessions.userId], references: [users.id] }),
}));

export const proposalsRelations = relations(proposals, ({ one }) => ({
  owner: one(users, { fields: [proposals.ownerId], references: [users.id] }),
  client: one(clients, {
    fields: [proposals.clientId],
    references: [clients.id],
  }),
  wonProject: one(projects, {
    fields: [proposals.wonProjectId],
    references: [projects.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  task: one(tasks, { fields: [reviews.taskId], references: [tasks.id] }),
  project: one(projects, {
    fields: [reviews.projectId],
    references: [projects.id],
  }),
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  lead: one(users, { fields: [teams.leadId], references: [users.id] }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));
