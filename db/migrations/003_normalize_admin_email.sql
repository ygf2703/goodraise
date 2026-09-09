-- Account identity has always been case-insensitive in the application.
-- Preserve account UUIDs/passwords/sessions; refuse ambiguous legacy identities.
SET LOCAL lock_timeout = '5s';
LOCK TABLE goodraise.admin_users IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim(email)) FROM goodraise.admin_users
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Account email normalization found case/whitespace collisions. Resolve the duplicate accounts explicitly before retrying; no accounts were merged.';
  END IF;
END $$;

UPDATE goodraise.admin_users
SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));

ALTER TABLE goodraise.admin_users
  ADD CONSTRAINT admin_users_email_normalized CHECK (email = lower(btrim(email)));
