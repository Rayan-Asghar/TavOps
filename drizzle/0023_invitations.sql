-- Invitations: a link the admin sends, instead of a password they carry.
--
-- Creating a person today mints a 16-character password, shows it once, and
-- leaves an admin to get it to them by hand. That handover is the mechanism
-- that produced nine accounts sharing `tavren123`. Hardening the seed fixed the
-- seed; it did not touch the handover.
--
-- Hand-written, and diffed against the live database first: `drizzle-kit
-- generate` models neither the partial index below nor RLS, and this repo has
-- already produced one migration that re-dropped already-dropped columns.

-- Somebody who signs in with Google has no password, and a NOT NULL column
-- forces one to exist for no reason. `authorize()` must now refuse a null hash
-- AFTER its dummy compare, so a Google-only account is not distinguishable from
-- a wrong password by how long the answer takes.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint

-- Hashed at rest and shown exactly once, for the same reason the temp password
-- already is: a credential that can be read back later is a credential that
-- leaks later. The plaintext token exists only in the response that mints it.
ALTER TABLE "users" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint

-- Who sent it. ON DELETE SET NULL rather than CASCADE: removing the admin who
-- invited somebody must not remove the person they invited.
ALTER TABLE "users" ADD COLUMN "invited_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Partial, because the column is NULL for everybody who has accepted or was
-- never invited, and NULLs are distinct — a plain unique index would allow
-- unlimited NULLs but would also be a pointless full-table index. The lookup is
-- always "find the row for this one hash", so it wants to be unique and small.
CREATE UNIQUE INDEX "users_invite_token_unique"
    ON "users" ("invite_token_hash")
 WHERE "invite_token_hash" IS NOT NULL;
