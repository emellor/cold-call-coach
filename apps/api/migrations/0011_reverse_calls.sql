-- Reverse calls: the rep plays the prospect, and Sam, Claude as an expert rep,
-- makes the call to her. A call's mode may now be 'reverse'. Its place in the
-- reviews table holds notes on Sam's lines instead of a scorecard, in `notes`,
-- so `result` keeps meaning the rep's review.
ALTER TABLE calls DROP CONSTRAINT calls_mode_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_mode_check CHECK (mode IN ('coached', 'exam', 'reverse'));

ALTER TABLE reviews ADD COLUMN notes jsonb;
