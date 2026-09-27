-- Demo calls (M7): an expert rep, played by Claude, calls one of the prospects
-- and the agent writes the whole call, notes and audio, then posts it back.
-- "Generate" queues a batch. The agent claims one demo at a time and holds it
-- for 15 minutes, after which another claim may take it over; a demo that has
-- failed three times stays failed until the rep retries it.
CREATE TABLE demos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid        NOT NULL,
  position         integer     NOT NULL CHECK (position > 0),
  scenario_id      text        NOT NULL,
  scenario_version integer     CHECK (scenario_version > 0),
  angle            text        NOT NULL,
  status           text        NOT NULL DEFAULT 'queued'
                               CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  attempts         integer     NOT NULL DEFAULT 0,
  claimed_at       timestamptz,
  error            text,
  title            text,
  summary          text,
  lessons          jsonb,
  outcome          text        CHECK (outcome IN ('meeting_booked', 'hung_up_by_prospect',
                                                  'no_decision')),
  outcome_detail   text,
  duration_ms      integer,
  cost_usd         numeric(12, 6),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demos_waiting_idx ON demos (created_at, position)
  WHERE status IN ('queued', 'generating');

-- Each line of a demo, with its MP3. Twenty demos come to a few tens of megabytes.
CREATE TABLE demo_turns (
  demo_id   uuid    NOT NULL REFERENCES demos (id) ON DELETE CASCADE,
  idx       integer NOT NULL CHECK (idx >= 0),
  speaker   text    NOT NULL CHECK (speaker IN ('rep', 'prospect')),
  text      text    NOT NULL,
  technique text,
  note      text,
  interest  real,
  patience  real,
  audio     bytea,
  audio_ms  integer CHECK (audio_ms >= 0),
  PRIMARY KEY (demo_id, idx)
);
