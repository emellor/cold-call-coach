-- Scenario specs, upserted from scenarios/*.json on every API boot. A call
-- records the (scenario_id, scenario_version) it was made with, so a change
-- that should not rewrite the history of earlier calls bumps the file's version.
CREATE TABLE scenarios (
  id         text        NOT NULL,
  version    integer     NOT NULL CHECK (version > 0),
  title      text        NOT NULL,
  difficulty text        NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  spec       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
