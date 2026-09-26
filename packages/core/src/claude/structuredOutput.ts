// A structured-output format built from a zod schema, for `messages.parse` or
// a streamed request. The SDK's own helper (betaZodOutputFormat, 0.128) keeps
// only a handful of keywords and folds the rest, `enum` included, into the
// description, which would leave enums as hints rather than constraints.
// This keeps what the API constrains on (types, enum, const, anyOf, $ref, the
// supported string formats) and, like the SDK, moves what it rejects (number
// and length bounds, patterns) into the description, where the model still
// reads it and the zod parse still enforces it.
import { z } from 'zod';

type Json = Record<string, unknown>;

/** Kept as-is at every level (everything else is described instead). */
const KEPT = new Set([
  'type',
  'properties',
  'required',
  'items',
  'anyOf',
  'allOf',
  'enum',
  'const',
  '$ref',
  '$defs',
  'description',
  'title',
]);
const FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (node === null || typeof node !== 'object') return node;
  const source = node as Json;
  const out: Json = {};
  const described: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === 'properties' || key === '$defs') {
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([name, schema]) => [name, strict(schema)]),
      );
    } else if (KEPT.has(key)) {
      out[key] = strict(value);
    } else if (key === 'format' && typeof value === 'string' && FORMATS.has(value)) {
      out[key] = value;
    } else if (key === 'minItems' && (value === 0 || value === 1)) {
      out[key] = value;
    } else if (key !== 'additionalProperties' && key !== '$schema') {
      described.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (described.length) {
    const note = `{${described.join(', ')}}`;
    out.description = typeof out.description === 'string' ? `${out.description}\n\n${note}` : note;
  }
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Json {
  return strict(
    z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }),
  ) as Json;
}

/** `{ type: 'json_schema', schema, parse }`: what `messages.parse` needs to fill `parsed_output`. */
export function structuredFormat<S extends z.ZodType>(schema: S) {
  return {
    type: 'json_schema' as const,
    schema: strictJsonSchema(schema),
    parse: (content: string): z.infer<S> => schema.parse(JSON.parse(content)),
  };
}
