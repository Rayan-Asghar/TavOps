-- Revoking a session before its token expires.
--
-- Hand-written, following 0018-0021, and checked against the live database
-- first: users had no session_version column.
--
-- Sessions are JWTs with a twelve-hour life, which is fine for identity and
-- wrong for authority: deactivating somebody, or changing their password after
-- a laptop goes missing, used to take effect whenever their token happened to
-- expire. Bumping this column invalidates every token issued before the bump,
-- because the token carries the value it was minted with and getActor compares
-- the two.
--
-- An integer rather than a timestamp: the comparison is equality, not ordering,
-- so there is no clock skew to reason about and a replayed token claiming a
-- HIGHER version fails exactly as a stale one does.
--
-- DEFAULT 1, so every existing session is invalidated on the next request --
-- their tokens carry no version at all and cannot match. That is the correct
-- behaviour for a security change and worth the one re-login it costs.

ALTER TABLE "users"
    ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;
