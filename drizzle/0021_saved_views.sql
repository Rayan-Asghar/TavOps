-- A saved view is a saved link.
--
-- Hand-written, following 0018-0020, and checked against the live database
-- first: no saved_views table existed.
--
-- Every list in this app keeps its filters in the query string, deliberately,
-- so that a filtered screen is shareable and stays server-rendered. That one
-- decision is what makes this table almost nothing: a view is a name, a path
-- and a query string. There is no filter DSL to design, no serialisation
-- format to version, and no risk of a saved view meaning something different
-- from the URL it was saved from -- because it IS that URL.
--
-- `is_shared` rather than an owner/visibility matrix: this is an internal tool
-- of about twenty people, and the only two states anybody has asked for are
-- "mine" and "the team's". A permission model nobody needs is a permission
-- model nobody maintains.

CREATE TABLE "saved_views" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"     uuid NOT NULL,
    "name"        varchar(80) NOT NULL,
    -- Split from the query so a view can be listed against the screen it
    -- belongs to without parsing a URL to find out which screen that is.
    "path"        varchar(120) NOT NULL,
    "query"       text NOT NULL,
    "is_shared"   boolean DEFAULT false NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Listing is always "this person's views for this screen".
CREATE INDEX "saved_views_user_path_idx"
    ON "saved_views" USING btree ("user_id","path","order_index");--> statement-breakpoint

-- One name per person per screen: saving twice under the same name corrects
-- the view rather than leaving two entries that look identical in the list.
CREATE UNIQUE INDEX "saved_views_user_path_name_unique"
    ON "saved_views" USING btree ("user_id","path","name");--> statement-breakpoint

-- Shared views are listed to everyone, so they need their own lookup.
CREATE INDEX "saved_views_shared_idx"
    ON "saved_views" USING btree ("path","order_index") WHERE "is_shared";
