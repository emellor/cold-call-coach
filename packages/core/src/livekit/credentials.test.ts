import { describe, expect, it } from 'vitest';
import { liveKitPairProblem } from './credentials.ts';

// The shapes LiveKit Cloud hands out (made up, same form).
const keyId = 'APIaB3cD4eF5gH6';
const secret = 'kR3vQ9xZt2Lm8Pw4Yb6Nc1Hd7Jf5Sg0Ae2Uo4Ii6Kq';
const roomToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX0sImlzcyI6IkFQSSJ9.c2lnbmF0dXJlLWJ5dGVz';

describe('liveKitPairProblem', () => {
  it('accepts a key id with a secret, and anything a self-hosted server might use', () => {
    expect(liveKitPairProblem(keyId, secret)).toBeNull();
    expect(liveKitPairProblem('devkey', 'secret')).toBeNull();
  });

  it('spots a room token from "Generate Token" pasted as the secret, and says where the secret is', () => {
    expect(liveKitPairProblem(keyId, roomToken)).toMatch(
      /^LIVEKIT_API_SECRET is a room token \(from "Generate Token"\), not the key's secret\. .*shows a secret only once/,
    );
  });

  it('spots the key and the secret swapped', () => {
    expect(liveKitPairProblem(secret, keyId)).toMatch(/look swapped/);
    // Two key ids is not a swap it can recognise.
    expect(liveKitPairProblem(keyId, 'APIaaaaaaaaaaaa')).toBeNull();
  });
});
