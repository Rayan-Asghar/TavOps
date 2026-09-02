-- A spreadsheet belongs to one owner, not one owner per tab.
--
-- Tabs are months now: Tavren creates "September 2026" beside "August 2026" in
-- the same file. Keying the destination on the tab as well would have let two
-- projects share a spreadsheet purely because they were connected in different
-- months, and each would then create the other's missing months.

DROP INDEX "sheet_connections_destination_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_connections_destination_unique" ON "sheet_connections" USING btree ("spreadsheet_id") WHERE "sheet_connections"."status" <> 'archived';