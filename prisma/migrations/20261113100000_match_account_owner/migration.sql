-- A seller without a CAC registration can still be paid when the bank confirms the payout account is in their own name.
-- The new value is used by the next migration (Postgres does not let a value be used in the migration that adds it).
ALTER TYPE "MatchMethod" ADD VALUE IF NOT EXISTS 'ACCOUNT_OWNER';
