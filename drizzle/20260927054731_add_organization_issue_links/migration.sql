-- The organization's Issue links setting: an https:// URL with {key} where a ticket key goes,
-- such as https://acme.atlassian.net/browse/{key}, or NULL for plain ticket labels. An app
-- column Better Auth never reads or writes; the app checks the URL.
ALTER TABLE organization ADD COLUMN issue_links text;
