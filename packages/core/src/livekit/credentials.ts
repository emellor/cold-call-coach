// A LiveKit key pair that can't be right, judged from its shape alone. LiveKit
// Cloud's API keys page invites two mistakes: its "Generate Token" menu item
// makes a room token that looks like a secret (the real secret is shown once,
// when a key is created), and the key and secret are easy to swap. Either one
// otherwise shows up only as LiveKit refusing every connection with a 401.

/** A JWT: three base64url parts, the first a JSON header ("eyJ" is `{"`). */
const JWT = /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/;

/** LiveKit Cloud key ids look like `APIaB3cD4eF5gH6`; secrets are far longer. */
const KEY_ID = /^API[A-Za-z0-9]{8,20}$/;

/**
 * Why this key and secret can't be a LiveKit key pair, as a sentence naming the
 * variables, or null when nothing is plainly wrong. A null says nothing about
 * whether LiveKit will accept the pair: only LiveKit can answer that.
 */
export function liveKitPairProblem(apiKey: string, apiSecret: string): string | null {
  if (JWT.test(apiSecret)) {
    return (
      'LIVEKIT_API_SECRET is a room token (from "Generate Token"), not the key\'s secret. ' +
      'LiveKit shows a secret only once, when the key is created: create a key and copy both values.'
    );
  }
  if (KEY_ID.test(apiSecret) && !KEY_ID.test(apiKey)) {
    return 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET look swapped: the key is the one that starts with "API".';
  }
  return null;
}
