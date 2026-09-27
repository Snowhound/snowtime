-- An entry's ticket key, such as NBW-412: one per entry, so reports by ticket add up to the
-- total (docs/architecture.md, "Ticket keys"). The app checks its format.
ALTER TABLE time_entry ADD COLUMN ticket text;
--> statement-breakpoint
CREATE INDEX time_entry_organization_id_ticket_idx ON time_entry (organization_id, ticket);
--> statement-breakpoint
-- Moves the key at the start of each description into the ticket, with the rules of
-- detectTicket (src/lib/tickets.ts) for a description saved without one: a key, optionally in
-- brackets, then a separator (: | , / – — -), white space, or the end. Keys later in the text
-- and pasted links stay as they are. White space is what JavaScript's \s matches. The
-- updated_at trigger records the change.
WITH
  ws(chars) AS (
    SELECT char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198,
      8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
  ),
  -- k: where the key starts, after an opening bracket.
  opened AS (
    SELECT id, description AS d, CASE WHEN substr(description, 1, 1) = '[' THEN 2 ELSE 1 END AS k
    FROM time_entry
    WHERE ticket IS NULL AND (description GLOB '[A-Z]*' OR description GLOB '[[][A-Z]*')
  ),
  dashed AS (
    SELECT id, d, k, instr(substr(d, k), '-') AS dash FROM opened
  ),
  -- The letter and one to nine letters or digits before the dash, and what follows it.
  prefixed AS (
    SELECT id, d, k, dash, substr(d, k + dash) AS after
    FROM dashed
    WHERE dash BETWEEN 3 AND 11
      AND substr(d, k, dash - 1) NOT GLOB '*[^A-Z0-9]*'
      AND substr(d, k, dash - 1) NOT IN ('UTF', 'ISO', 'SHA', 'COVID')
  ),
  -- n: the number's digits, one to seven, not starting with 0.
  numbered AS (
    SELECT id, d, k, dash, n, CASE WHEN substr(rest, 1, 1) = ']' THEN substr(rest, 2) ELSE rest END AS r
    FROM (
      SELECT id, d, k, dash, length(after) - length(ltrim(after, '0123456789')) AS n,
        substr(after, length(after) - length(ltrim(after, '0123456789')) + 1) AS rest, after
      FROM prefixed
    )
    WHERE n BETWEEN 1 AND 7 AND substr(after, 1, 1) <> '0'
  ),
  -- t: the rest after white space, where a separator would be.
  spaced AS (
    SELECT numbered.*, ltrim(r, ws.chars) AS t, ws.chars AS chars FROM numbered, ws
  ),
  moved AS (
    SELECT id,
      substr(d, k, dash + n) AS ticket,
      trim(
        CASE WHEN t <> '' AND instr(':|,/–—-', substr(t, 1, 1)) > 0 THEN substr(t, 2) ELSE r END,
        chars
      ) AS description
    FROM spaced
    WHERE r = ''
      OR instr(chars, substr(r, 1, 1)) > 0
      OR (t <> '' AND instr(':|,/–—-', substr(t, 1, 1)) > 0)
  )
UPDATE time_entry SET ticket = moved.ticket, description = moved.description
FROM moved WHERE time_entry.id = moved.id;
