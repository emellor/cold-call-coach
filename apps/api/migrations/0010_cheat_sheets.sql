-- Cheat sheets: the page of notes a rep keeps in front of them on a real call,
-- written by Claude from the rep's profile of the person they're about to call.
-- Stored whole, as the page shows it, and never rewritten.
CREATE TABLE cheat_sheets (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  brief      text           NOT NULL,
  title      text           NOT NULL,
  sheet      jsonb          NOT NULL,
  model      text,
  cost_usd   numeric(12, 6),
  created_at timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX cheat_sheets_created_idx ON cheat_sheets (created_at);
