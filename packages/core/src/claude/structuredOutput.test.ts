import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { strictJsonSchema, structuredFormat } from './structuredOutput.ts';

const Example = z.object({
  kind: z.enum(['a', 'b']).describe('Which kind'),
  label: z.literal('fixed'),
  score: z.int().min(1).max(5),
  tags: z.array(z.string().min(2)).max(3),
  when: z.iso.datetime(),
  nested: z.object({ note: z.string() }).nullable(),
});

describe('strictJsonSchema', () => {
  const schema = strictJsonSchema(Example);
  const properties = schema.properties as Record<string, Record<string, unknown>>;

  it('keeps enums and constants as constraints', () => {
    expect(properties.kind).toEqual({
      type: 'string',
      enum: ['a', 'b'],
      description: 'Which kind',
    });
    expect(properties.label?.const).toBe('fixed');
  });

  it('describes what the API cannot constrain instead of sending it', () => {
    expect(properties.score).not.toHaveProperty('minimum');
    expect(properties.score?.description).toBe('{minimum: 1, maximum: 5}');
    expect(properties.tags).not.toHaveProperty('maxItems');
    expect(String(properties.tags?.description)).toContain('maxItems: 3');
  });

  it('keeps supported string formats and closes every object', () => {
    expect(properties.when?.format).toBe('date-time');
    expect(schema).not.toHaveProperty('$schema');
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(properties.nested)).toContain('"additionalProperties":false');
  });
});

describe('structuredFormat', () => {
  it('parses and validates with the zod schema itself', () => {
    const format = structuredFormat(Example);
    const valid = {
      kind: 'a',
      label: 'fixed',
      score: 3,
      tags: ['xy'],
      when: '2026-09-26T10:00:00Z',
      nested: null,
    };
    expect(format.parse(JSON.stringify(valid))).toEqual(valid);
    expect(() => format.parse(JSON.stringify({ ...valid, score: 9 }))).toThrow();
  });
});
