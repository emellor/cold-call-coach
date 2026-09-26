-- One seeded user. calls.user_id references it from day one, so a real
-- multi-user product later is a data change, not a schema rewrite.
CREATE TABLE users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'me@localhost');
