// A structured-output format built from a zod schema, for `messages.parse`.
// The SDK's own helper (betaZodOutputFormat, 0.128) keeps only a handful of
// keywords and folds the rest, `enum` included, into the description, which
// would leave the judge's stage and fact keys as hints rather than
// constraints. This keeps zod's JSON Schema intact apart from what the API
// needs: no `$schema`, and every object closed with additionalProperties: false.
import { z } from 'zod';

type Json = Record<string, unknown>;

function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (node === null || typeof node !== 'object') return node;
  const out: Json = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, closeObjects(value)]),
  );
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Json {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
  }) as Json;
  return closeObjects(json) as Json;
}

/** `{ type: 'json_schema', schema, parse }`: what `messages.parse` needs to fill `parsed_output`. */
export function structuredFormat<S extends z.ZodType>(schema: S) {
  return {
    type: 'json_schema' as const,
    schema: strictJsonSchema(schema),
    parse: (content: string): z.infer<S> => schema.parse(JSON.parse(content)),
  };
}
