-- "Practise this call": the prospect written from a demo's brief, added to the
-- picker so the rep can practise the call they have just read. The id of that
-- custom scenario is kept on the demo, so a second press links to her rather
-- than paying to write her again. No foreign key: scenarios are keyed by
-- (id, version), and archiving her from the picker leaves the demo as it is.
ALTER TABLE demos ADD COLUMN practice_scenario_id text;
