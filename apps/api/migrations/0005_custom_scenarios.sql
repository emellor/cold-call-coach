-- "Add new" (M7): prospects written by Claude from the rep's description sit
-- beside the ones upserted from scenarios/*.json. `source` tells them apart,
-- and `description` keeps the rep's words. Only a custom prospect can be
-- removed, and removing one only archives it: the picker stops showing her,
-- while calls made with her keep their history, which joins on this table.
ALTER TABLE scenarios
  ADD COLUMN source      text        NOT NULL DEFAULT 'file' CHECK (source IN ('file', 'custom')),
  ADD COLUMN description text,
  ADD COLUMN created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN archived_at timestamptz;
