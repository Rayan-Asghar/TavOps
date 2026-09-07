import { and, asc, count as countRows, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, taskTypes, tasks, users } from "@/db/schema";
import type { Scope } from "./reports";

/**
 * Tasks across every project at once.
 *
 * Tavren had no cross-project view of tasks at all: a task was reachable only
 * by opening the project it belonged to, so "what is assigned to me" and "what
 * is in review anywhere" had no screen. Every tool this app was measured
 * against opens on exactly that list.
 */

export type TaskFilters = {
  q: string;
  status: string | null;
  assigneeId: string | null;
  projectId: string | null;
  /** "open" hides done, which is what almost every visit wants. */
  openOnly: boolean;
};

export type TaskListRow = {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueDate: Date | null;
  estimatedHours: string | null;
  loggedHours: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  assigneeName: string | null;
  taskTypeName: string | null;
  billable: boolean | null;
};

function whereFor(scope: Scope, f: TaskFilters) {
  return and(
    scope === null ? sql`true` : inArray(tasks.projectId, scope),
    // Archived projects still hold their tasks for the audit trail; nobody
    // wants them in a working list.
    ne(projects.lifecycle, "archived"),
    f.openOnly ? ne(tasks.status, "done") : undefined,
    f.status ? eq(tasks.status, f.status as never) : undefined,
    f.assigneeId
      ? f.assigneeId === "none"
        ? isNull(tasks.assigneeId)
        : eq(tasks.assigneeId, f.assigneeId)
      : undefined,
    f.projectId ? eq(tasks.projectId, f.projectId) : undefined,
    f.q
      ? or(
          ilike(tasks.title, `%${f.q}%`),
          ilike(projects.code, `%${f.q}%`),
          ilike(projects.name, `%${f.q}%`),
        )
      : undefined,
  );
}

export async function taskList(
  scope: Scope,
  f: TaskFilters,
  page: { limit: number; offset: number; sort: string | null; desc: boolean },
): Promise<{ rows: TaskListRow[]; total: number }> {
  if (scope !== null && scope.length === 0) return { rows: [], total: 0 };

  const dir = page.desc ? desc : asc;
  const orderBy =
    page.sort === "due"
      ? // Nulls last: a task with no date is not more urgent than one due today,
        // which is what a plain ascending sort would imply.
        [sql`${tasks.dueDate} is null`, dir(tasks.dueDate)]
      : page.sort === "project"
        ? [dir(projects.code), asc(tasks.orderIndex)]
        : page.sort === "status"
          ? [dir(tasks.status), asc(tasks.dueDate)]
          : [asc(tasks.priority), sql`${tasks.dueDate} is null`, asc(tasks.dueDate)];

  const where = whereFor(scope, f);

  const [rows, total] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: sql<string>`${tasks.status}`,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        estimatedHours: tasks.estimatedHours,
        loggedHours: sql<string>`(
          select coalesce(sum(w.hours), 0)::text from work_logs w
           where w.task_id = tasks.id and w.deleted_at is null)`,
        projectId: tasks.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        clientName: clients.name,
        assigneeName: users.name,
        taskTypeName: taskTypes.name,
        billable: taskTypes.billable,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(taskTypes, eq(taskTypes.id, tasks.taskTypeId))
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ n: countRows() })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(where)
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  return { rows, total };
}

/** The people and projects worth offering as filters — only those that appear
 *  in the reader's own scope, so a filter never reveals a name they cannot
 *  otherwise see. */
export async function taskFilterOptions(scope: Scope) {
  if (scope !== null && scope.length === 0) {
    return { assignees: [], projects: [] };
  }
  const visible = scope === null ? sql`true` : inArray(tasks.projectId, scope);

  const [assignees, projectOpts] = await Promise.all([
    db
      .selectDistinct({ id: users.id, name: users.name })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.assigneeId))
      .where(visible)
      .orderBy(asc(users.name)),
    db
      .selectDistinct({ id: projects.id, code: projects.code, name: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(visible, ne(projects.lifecycle, "archived")))
      .orderBy(asc(projects.code)),
  ]);

  return { assignees, projects: projectOpts };
}
