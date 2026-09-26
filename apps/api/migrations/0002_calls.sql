-- One row per dialled call. The remaining PLAN.md §10 columns (duration, cost,
-- latency, recording) arrive with the call log in M4.
CREATE TABLE calls (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id),
  scenario_id      text        NOT NULL,
  scenario_version integer     NOT NULL,
  mode             text        NOT NULL CHECK (mode IN ('coached', 'exam')),
  status           text        NOT NULL DEFAULT 'ringing'
                               CHECK (status IN ('ringing', 'connected', 'ended')),
  outcome          text        CHECK (outcome IN ('meeting_booked', 'hung_up_by_prospect',
                                                  'ended_by_rep', 'timeout', 'error')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  connected_at     timestamptz,
  ended_at         timestamptz
);

CREATE INDEX calls_user_started_idx ON calls (user_id, started_at DESC);
