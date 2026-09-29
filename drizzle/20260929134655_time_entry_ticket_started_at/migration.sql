-- The Entries card and its count narrowed to one ticket read that ticket's entries in the
-- range. With started_at after the ticket, the index serves both, so a year's read of one
-- ticket touches its rows only rather than every entry of the year.
CREATE INDEX time_entry_organization_id_ticket_started_at_idx ON time_entry (organization_id, ticket, started_at);
--> statement-breakpoint
DROP INDEX time_entry_organization_id_ticket_idx;
