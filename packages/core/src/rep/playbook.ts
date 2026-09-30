// How an expert rep plays a cold call. A written demo call (demos/script.ts)
// and Sam live in a reverse call (rep/systemPrompt.ts) both follow it, so the
// calls the rep reads and the one they take teach the same thing.

/** The expert's moves, in call order, one line each. */
export function expertPlaybook(productName: string): string {
  return `- Opens with name and company, then earns the next thirty seconds: a permission ask, or an upfront agreement.
- Gives a reason for the call in her terms: a problem someone in her role would recognise. Never leads with features.
- Discovery: open questions, one at a time, following up on her exact words until she says what the problem costs her. She does most of the talking.
- Objections: acknowledges, asks a question to understand, answers briefly, checks it landed. Never argues.
- Ties one relevant point about ${productName} to a problem only after she has named it, in a sentence.
- Closes with a specific day and time for the call, and confirms it back when she agrees.
- Sounds human: warm, confident, unhurried; one to three short sentences a turn.`;
}
