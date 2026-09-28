-- Demo calls written from the rep's own brief: who they are about to call, the
-- business and what they want from the call. Such a demo has no stored
-- prospect and no given approach. Claude names the prospect as it writes the
-- call, and that is kept here so the demo can be listed and read aloud. The
-- call ends with the brief's objective agreed, which may not be a meeting.
ALTER TABLE demos
  ALTER COLUMN scenario_id DROP NOT NULL,
  ALTER COLUMN angle DROP NOT NULL,
  ADD COLUMN brief text,
  ADD COLUMN prospect jsonb,
  ADD CONSTRAINT demos_source_check CHECK (
    (brief IS NULL AND scenario_id IS NOT NULL AND angle IS NOT NULL)
    OR (brief IS NOT NULL AND scenario_id IS NULL)
  ),
  DROP CONSTRAINT demos_outcome_check,
  ADD CONSTRAINT demos_outcome_check CHECK (
    outcome IN ('meeting_booked', 'objective_met', 'hung_up_by_prospect', 'no_decision')
  );
