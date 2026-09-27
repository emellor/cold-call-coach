-- Demo calls are written transcripts now: the API has Claude write each one in
-- a single request, with no simulated call and no audio. The voiced
-- simulator's columns go; rows it left behind are rewritten on retry.
ALTER TABLE demo_turns
  DROP COLUMN audio,
  DROP COLUMN audio_ms,
  DROP COLUMN interest,
  DROP COLUMN patience;

ALTER TABLE demos DROP COLUMN duration_ms;
