/**
 * Costs work logs that predate the costing layer, or that were logged while
 * their person had no rate on file.
 *
 * A script and not a migration, for two reasons. `drizzle-kit migrate` runs as
 * the owner and the costing needs application logic -- the resolver, and the
 * arithmetic it feeds. And this has to be RE-RUNNABLE: the common case is
 * "somebody finally entered rates for the four people who never had them", and
 * that is a second run over the same rows, not a schema change.
 *
 * Idempotent by construction: costing upserts on work_log_id, so a row costed
 * twice ends up in the state its current revision implies. Entries already
 * costed against their current revision are skipped rather than rewritten, so
 * a run over a mostly-costed table is cheap and leaves `costed_at` alone.
 *
 * Run with: pnpm tsx --env-file=.env.local scripts/backfill-costs.ts [--force]
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, withFinanceAccess } from "../src/db";
import { workLogCosts, workLogs } from "../src/db/schema";
import { costWorkLogInTx } from "../src/server/costing";

const BATCH = 200;
/** Re-cost everything, not only what is missing or stale. */
const FORCE = process.argv.includes("--force");

async function main() {
  console.log(`Backfilling work-log costs${FORCE ? " (forced)" : ""}...`);

  // "Needs costing" means: no cost row, or one anchored to a revision that is
  // no longer the head. The second case is an entry edited before this script
  // existed -- its stored cost describes a version of the entry nobody can see.
  const staleOrMissing = await withFinanceAccess(async (tx) => {
    const costed = tx
      .select({
        workLogId: workLogCosts.workLogId,
        revisionId: workLogCosts.revisionId,
      })
      .from(workLogCosts)
      .as("costed");

    return tx
      .select({
        id: workLogs.id,
        userId: workLogs.userId,
        workDate: workLogs.workDate,
        hours: workLogs.hours,
        billable: workLogs.billable,
        currentRevisionId: workLogs.currentRevisionId,
        costedRevisionId: costed.revisionId,
      })
      .from(workLogs)
      .leftJoin(costed, eq(costed.workLogId, workLogs.id))
      .where(
        and(
          isNull(workLogs.deletedAt),
          // No revision head means no chain to anchor a cost to. Seeded
          // fixtures are the only rows in that state.
          isNotNull(workLogs.currentRevisionId),
        ),
      );
  });

  const todo = staleOrMissing.filter(
    (r) =>
      FORCE ||
      r.costedRevisionId === null ||
      r.costedRevisionId !== r.currentRevisionId,
  );

  console.log(
    `  ${staleOrMissing.length} live entries, ${todo.length} to cost.`,
  );

  const tally = { rated: 0, unrated: 0, ambiguous: 0 };

  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      for (const row of slice) {
        const basis = await costWorkLogInTx(tx, {
          workLogId: row.id,
          revisionId: row.currentRevisionId!,
          userId: row.userId,
          workDate: row.workDate,
          hours: row.hours,
          billable: row.billable,
        });
        tally[basis] += 1;
      }
    });
    console.log(`  ...${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }

  console.log("\nDone.");
  console.log(`  rated:     ${tally.rated}`);
  console.log(`  unrated:   ${tally.unrated}  (no rate covers that work date)`);
  console.log(`  ambiguous: ${tally.ambiguous}  (overlapping rates -- fix those)`);
  if (tally.unrated > 0) {
    console.log(
      "\nEnter the missing rates, then run this again: unrated entries carry",
    );
    console.log("no amounts and Reports counts their hours as not costed.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
