-- Better Auth finds an OAuth account by provider and provider account id at each sign-in.
CREATE INDEX account_provider_id_account_id_idx ON account (provider_id, account_id);
