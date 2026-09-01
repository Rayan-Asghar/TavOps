-- Retires audit_log.detail in favour of before/after.
--
-- `detail` was a single opaque blob; before/after lets /audit render the fields
-- that actually moved instead of two JSON objects to eyeball. Every call site
-- now goes through server/audit.ts and writes the pair.
--
-- Backfill first and unconditionally: on this database the two remaining rows
-- were already copied across, but a deploy from an older snapshot may not be,
-- and dropping a column with unmigrated data in it is not recoverable.
UPDATE "audit_log" SET "after" = "detail"
 WHERE "detail" IS NOT NULL AND "after" IS NULL AND "before" IS NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "detail";