-- One open timer per person, enforced by the database rather than by a check.
--
-- `startTimer` reads `activeSessionFor` and then inserts, which is a
-- read-then-write: two starts racing each other both pass the check. And
-- `activeSessionFor` selects with LIMIT 1 and no ORDER BY, so once a person has
-- two open rows, which one the app calls "your timer" is arbitrary — pausing
-- one and finishing the other would log the wrong duration.
--
-- Completed sessions are excluded: a person accumulates those forever, and it
-- is only the open ones that have to be unique.

-- Close any duplicates first, keeping the one most recently started. There are
-- none outside development, where the read-then-write has had the chance to lose.
UPDATE "time_sessions" t
   SET "status" = 'completed', "ended_at" = now()
 WHERE "status" <> 'completed'
   AND EXISTS (
     SELECT 1 FROM "time_sessions" other
      WHERE other."user_id" = t."user_id"
        AND other."status" <> 'completed'
        AND (other."started_at", other."id") > (t."started_at", t."id")
   );--> statement-breakpoint

CREATE UNIQUE INDEX "time_sessions_one_open_per_user"
    ON "time_sessions" USING btree ("user_id")
 WHERE "status" <> 'completed';
