import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { APIConnectionError, APIStatusError, APITimeoutError } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import { describeClaudeFailure, describeVoiceFailure } from './failures.ts';

const apiError = (status: number) =>
  APIError.generate(status, { error: { type: 'x', message: 'raw' } }, 'raw', new Headers());

describe('describeClaudeFailure', () => {
  it('names the fix for the failures the rep can do something about', () => {
    expect(describeClaudeFailure(apiError(401))).toBe(
      "Claude rejected the agent's key: check ANTHROPIC_API_KEY.",
    );
    expect(describeClaudeFailure(apiError(429))).toBe('Claude is rate-limiting this key.');
    expect(describeClaudeFailure(apiError(529))).toBe('Claude is overloaded right now.');
    expect(describeClaudeFailure(apiError(400))).toBe('Claude failed (400).');
    expect(describeClaudeFailure(new APIUserAbortError())).toBe('Claude took too long to answer.');
    expect(describeClaudeFailure(new Error('socket hang up'))).toBe('Claude could not be reached.');
  });
});

describe('describeVoiceFailure', () => {
  it('turns a rejected key into the variable to check', () => {
    expect(
      describeVoiceFailure(
        'stt',
        new Error('Deepgram WebSocket connection rejected with status 403'),
      ),
    ).toBe("Hearing you (Deepgram) rejected the agent's key: check DEEPGRAM_API_KEY.");
    expect(describeVoiceFailure('tts', new Error('401 Unauthorized'))).toBe(
      "Her voice (Cartesia) rejected the agent's key: check CARTESIA_API_KEY.",
    );
  });

  it('reads the status LiveKit attaches, whatever the message says', () => {
    const rejected = new APIStatusError({ message: 'API error.', options: { statusCode: 401 } });
    expect(describeVoiceFailure('tts', rejected)).toBe(
      "Her voice (Cartesia) rejected the agent's key: check CARTESIA_API_KEY.",
    );
    const limited = new APIStatusError({ message: 'API error.', options: { statusCode: 429 } });
    expect(describeVoiceFailure('stt', limited)).toBe(
      'Hearing you (Deepgram) is rate-limiting this key.',
    );
  });

  it('says a provider could not be reached when its socket never opened', () => {
    // Cartesia's plugin reports a failed connection with the bare message "Error".
    expect(describeVoiceFailure('tts', new APIConnectionError({ message: 'Error' }))).toBe(
      'Her voice (Cartesia) could not be reached.',
    );
    expect(describeVoiceFailure('stt', new APITimeoutError({}))).toBe(
      'Hearing you (Deepgram) timed out.',
    );
  });

  it('says what failed otherwise, in the provider’s words', () => {
    expect(describeVoiceFailure('tts', new Error('429 Too Many Requests'))).toBe(
      'Her voice (Cartesia) is rate-limiting this key.',
    );
    expect(describeVoiceFailure('stt', new Error('connection reset'))).toBe(
      'Hearing you (Deepgram) failed: connection reset',
    );
    expect(describeVoiceFailure('stt', new Error(''))).toBe(
      'Hearing you (Deepgram) failed: no reason given',
    );
  });
});
