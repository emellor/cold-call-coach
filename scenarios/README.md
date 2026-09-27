# Scenarios

Everything the prospect is, and everything a call is scored against, is data in this
folder: versioned JSON validated by zod schemas in `packages/contracts`
(PLAN.md §6.1 and §8.5). The API upserts the files into the `scenarios` table on boot,
keyed by `(id, version)`.

## Files

- **`product.json`**: what you sell (`name`, `oneLiner`, `valuePoints`, `idealCustomer`,
  `callGoal`, `keyterms`). It goes to the judge and the review, **never to the
  prospect**: she doesn't know what you sell until you tell her. `keyterms` bias
  Deepgram's transcription.
- **`<scenario-id>.json`**: one prospect.
  - `id`, `version`, `title`, `difficulty`, `locale`.
  - `prospect`: name, role, company, company facts, personality, speaking style,
    opening line, the private `hidden` facts (pains, current solution, decision process,
    timing) and the `objections` she raises.
  - `voice`: the Cartesia voice id and speed.
  - `state`: the hidden-state starting values and thresholds (`interest`, `patience`,
    `patienceDecayPerTurn`, `hangUpAt`, `meetingAt`).
  - `winCondition` and the `rubricId` the call is scored with.
- **`rubrics/cold-call-v1.json`**: the post-call rubric. Opener, reason for call,
  discovery, objections, next step and delivery, each scored 1–5 with anchors for 1, 3
  and 5.

## Rules

- **Bump `version` when you change a scenario.** Calls record the version they were made
  against, so old reviews stay explainable.
- **Hidden pains should connect to the product's value**, so good discovery questions can
  uncover them.
- **All v1 prospects are women**: their prompts are written that way. Pick female Cartesia
  voices to match.
