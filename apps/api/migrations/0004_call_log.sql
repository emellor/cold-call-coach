-- The call log (M4): the rest of PLAN.md §10's calls columns, plus turns,
-- events and reviews. The agent posts the whole log once the call is over and
-- the API replaces what it holds, so posting twice changes nothing.
ALTER TABLE calls
  ADD COLUMN duration_ms    integer CHECK (duration_ms >= 0),
  ADD COLUMN cost_usd       numeric(12, 6) CHECK (cost_usd >= 0),
  ADD COLUMN latency        jsonb,
  ADD COLUMN usage          jsonb,
  ADD COLUMN outcome_reason text,
  ADD COLUMN recording_path text;

CREATE TABLE turns (
  call_id     uuid    NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  idx         integer NOT NULL CHECK (idx >= 0),
  speaker     text    NOT NULL CHECK (speaker IN ('rep', 'prospect')),
  text        text    NOT NULL,
  start_ms    integer NOT NULL CHECK (start_ms >= 0),
  end_ms      integer NOT NULL CHECK (end_ms >= start_ms),
  words       jsonb,
  interrupted boolean NOT NULL DEFAULT false,
  state_after jsonb,
  PRIMARY KEY (call_id, idx)
);

CREATE TABLE events (
  id      bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid    NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  t_ms    integer NOT NULL CHECK (t_ms >= 0),
  kind    text    NOT NULL,
  payload jsonb   NOT NULL
);

CREATE INDEX events_call_idx ON events (call_id, t_ms);

CREATE TABLE reviews (
  call_id        uuid        PRIMARY KEY REFERENCES calls (id) ON DELETE CASCADE,
  status         text        NOT NULL
                             CHECK (status IN ('pending', 'running', 'ready', 'failed', 'skipped')),
  rubric_id      text,
  rubric_version integer,
  model          text,
  result         jsonb,
  error          text,
  cost_usd       numeric(12, 6) CHECK (cost_usd >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
