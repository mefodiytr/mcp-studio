import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compileSchema, type JsonSchema } from '../src/index';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

function loadFixtures(subdir: string): { name: string; schema: JsonSchema }[] {
  const dir = join(fixturesDir, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f, schema: JSON.parse(readFileSync(join(dir, f), 'utf8')) as JsonSchema }));
}

function loadFixture(relPath: string): JsonSchema {
  return JSON.parse(readFileSync(join(fixturesDir, relPath), 'utf8')) as JsonSchema;
}

describe('compileSchema — fixture corpus (snapshots)', () => {
  for (const { name, schema } of [...loadFixtures('real-world-schemas'), ...loadFixtures('edge-cases')]) {
    it(name, () => {
      const compiled = compileSchema(schema);
      expect(compiled.field).toMatchSnapshot();
      expect(compiled.validator).toBeInstanceOf(z.ZodType);
      // safeParse must not throw on the generated default value, whatever it is.
      expect(typeof compiled.validator.safeParse(compiled.defaultValue).success).toBe('boolean');
    });
  }
});

describe('compileSchema — validation behaviour on real schemas', () => {
  it('echo: requires a string `message`', () => {
    const { validator } = compileSchema(loadFixture('real-world-schemas/server-everything-echo.json'));
    expect(validator.safeParse({ message: 'hi' }).success).toBe(true);
    expect(validator.safeParse({}).success).toBe(false);
    expect(validator.safeParse({ message: 5 }).success).toBe(false);
  });

  it('add-numbers: two required numbers', () => {
    const { validator } = compileSchema(loadFixture('real-world-schemas/server-everything-add-numbers.json'));
    expect(validator.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(validator.safeParse({ a: 1 }).success).toBe(false);
    expect(validator.safeParse({ a: '1', b: 2 }).success).toBe(false);
  });

  it('long-running: number defaults are applied', () => {
    const compiled = compileSchema(loadFixture('real-world-schemas/server-everything-long-running.json'));
    expect(compiled.defaultValue).toEqual({ duration: 10, steps: 5 });
    expect(compiled.validator.parse({})).toEqual({ duration: 10, steps: 5 });
  });

  it('annotated message: enum + boolean default', () => {
    const compiled = compileSchema(loadFixture('real-world-schemas/server-everything-annotated-message.json'));
    expect(compiled.defaultValue).toEqual({ messageType: undefined, includeImage: false });
    expect(compiled.validator.safeParse({ messageType: 'error' }).success).toBe(true);
    expect(compiled.validator.safeParse({ messageType: 'nope' }).success).toBe(false);
  });

  it('filesystem edit_file: nested object array', () => {
    const { field, validator } = compileSchema(loadFixture('real-world-schemas/filesystem-edit-file.json'));
    expect(field.kind).toBe('object');
    if (field.kind === 'object') {
      const edits = field.fields.find((f) => f.name === 'edits')?.field;
      expect(edits?.kind).toBe('array');
      if (edits?.kind === 'array') expect(edits.item.kind).toBe('object');
    }
    expect(validator.safeParse({ path: '/x', edits: [{ oldText: 'a', newText: 'b' }] }).success).toBe(true);
    expect(validator.safeParse({ path: '/x', edits: [{ oldText: 'a' }] }).success).toBe(false);
  });

  it('niagaramcp readBql: integer with bounds + default + title', () => {
    const compiled = compileSchema(loadFixture('real-world-schemas/niagaramcp-read-bql.json'));
    expect(compiled.field).toMatchObject({ kind: 'object', title: 'readBql' });
    expect(compiled.validator.safeParse({ ord: 'station:|slot:/', bql: 'select *' }).success).toBe(true);
    expect(compiled.validator.parse({ ord: 'x', bql: 'y' })).toMatchObject({ limit: 100 });
    expect(compiled.validator.safeParse({ ord: 'x', bql: 'y', limit: 0 }).success).toBe(false);
    expect(compiled.validator.safeParse({ ord: 'x', bql: 'y', limit: 1.5 }).success).toBe(false);
  });

  it('discriminated oneOf: variants stay distinct', () => {
    const { field, validator } = compileSchema(loadFixture('edge-cases/discriminated-oneof.json'));
    expect(field.kind).toBe('union');
    if (field.kind === 'union') expect(field.discriminator).toBe('kind');
    expect(validator.safeParse({ kind: 'text', text: 'hi' }).success).toBe(true);
    expect(validator.safeParse({ kind: 'image', url: 'https://x.test/i.png' }).success).toBe(true);
    expect(validator.safeParse({ kind: 'text', url: 'x' }).success).toBe(false);
    expect(validator.safeParse({ kind: 'other' }).success).toBe(false);
  });

  it('additionalProperties: true → passthrough', () => {
    const { validator } = compileSchema(loadFixture('edge-cases/additional-properties.json'));
    const out = validator.safeParse({ a: 'x', extra: 1 });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data).toEqual({ a: 'x', extra: 1 });
  });

  it('$ref into $defs resolves', () => {
    const { field } = compileSchema(loadFixture('edge-cases/defs-ref.json'));
    expect(field.kind).toBe('object');
    if (field.kind === 'object') {
      expect(field.fields.find((f) => f.name === 'point')?.field.kind).toBe('object');
    }
  });

  it('nullable: type ["string","null"] → optional & nullable', () => {
    const { validator } = compileSchema(loadFixture('edge-cases/nullable.json'));
    expect(validator.safeParse({ note: 'x' }).success).toBe(true);
    expect(validator.safeParse({ note: null }).success).toBe(true);
    expect(validator.safeParse({}).success).toBe(true);
    expect(validator.safeParse({ note: 5 }).success).toBe(false);
  });
});

describe('compileSchema — synthetic edge cases', () => {
  it('true schema → json escape hatch that accepts anything', () => {
    const c = compileSchema(true);
    expect(c.field.kind).toBe('json');
    expect(c.validator.safeParse({ whatever: 1 }).success).toBe(true);
  });

  it('false schema → never', () => {
    const c = compileSchema(false);
    expect(c.field.kind).toBe('json');
    expect(c.validator.safeParse('anything').success).toBe(false);
  });

  it('{} → json escape hatch', () => {
    expect(compileSchema({}).field.kind).toBe('json');
  });

  it('empty object schema → empty form', () => {
    const c = compileSchema({ type: 'object', properties: {} });
    expect(c.field).toMatchObject({ kind: 'object', fields: [] });
    expect(c.validator.safeParse({}).success).toBe(true);
  });

  it('object with additionalProperties: false → strips extras', () => {
    const c = compileSchema({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false });
    const out = c.validator.safeParse({ a: 'x', extra: 1 });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data).toEqual({ a: 'x' });
  });

  it('string formats and constraints', () => {
    const c = compileSchema({
      type: 'object',
      properties: {
        e: { type: 'string', format: 'email' },
        u: { type: 'string', format: 'uri' },
        id: { type: 'string', format: 'uuid' },
        code: { type: 'string', pattern: '^[A-Z]{3}$', minLength: 3, maxLength: 3 },
        bad: { type: 'string', pattern: '(' },
      },
    });
    const v = c.validator;
    expect(v.safeParse({ e: 'not-email' }).success).toBe(false);
    expect(v.safeParse({ e: 'a@b.co' }).success).toBe(true);
    expect(v.safeParse({ u: 'not a uri' }).success).toBe(false);
    expect(v.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(v.safeParse({ code: 'ABC' }).success).toBe(true);
    expect(v.safeParse({ code: 'abcd' }).success).toBe(false);
    expect(v.safeParse({ bad: 'anything goes' }).success).toBe(true); // invalid regex skipped
  });

  it('long string → multiline string field', () => {
    expect(compileSchema({ type: 'string', format: 'textarea' }).field).toMatchObject({
      kind: 'string',
      multiline: true,
    });
  });

  it('number constraints (integer, min/max, exclusive, multipleOf)', () => {
    const c = compileSchema({
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 0, maximum: 100, multipleOf: 5 },
        x: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
      },
    });
    const v = c.validator;
    expect(v.safeParse({ n: 10 }).success).toBe(true);
    expect(v.safeParse({ n: 10.5 }).success).toBe(false);
    expect(v.safeParse({ n: 7 }).success).toBe(false);
    expect(v.safeParse({ n: 105 }).success).toBe(false);
    expect(v.safeParse({ x: 0 }).success).toBe(false);
    expect(v.safeParse({ x: 0.5 }).success).toBe(true);
  });

  it('array with item + size constraints + default', () => {
    const c = compileSchema({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, default: ['a'] });
    expect(c.field.kind).toBe('array');
    expect(c.defaultValue).toEqual(['a']);
    expect(c.validator.safeParse([]).success).toBe(false);
    expect(c.validator.safeParse(['a', 'b']).success).toBe(true);
    expect(c.validator.safeParse(['a', 'b', 'c', 'd']).success).toBe(false);
  });

  it('array with no `items` → array of anything', () => {
    const c = compileSchema({ type: 'array' });
    expect(c.field.kind).toBe('array');
    expect(c.validator.safeParse([1, 'x', true]).success).toBe(true);
  });

  it('tuple array schema → json escape hatch', () => {
    expect(compileSchema({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] }).field.kind).toBe('json');
  });

  it('enum: single value, all-string, mixed', () => {
    expect(compileSchema({ enum: ['only'] }).validator.safeParse('only').success).toBe(true);
    expect(compileSchema({ enum: ['only'] }).validator.safeParse('nope').success).toBe(false);
    expect(compileSchema({ enum: ['a', 'b'] }).validator.safeParse('b').success).toBe(true);
    const mixed = compileSchema({ enum: ['a', 1, true] });
    expect(mixed.validator.safeParse(1).success).toBe(true);
    expect(mixed.validator.safeParse('a').success).toBe(true);
    expect(mixed.validator.safeParse(2).success).toBe(false);
  });

  it('const: primitive vs non-primitive', () => {
    const prim = compileSchema({ const: 'fixed' });
    expect(prim.field).toMatchObject({ kind: 'const', value: 'fixed' });
    expect(prim.validator.safeParse('fixed').success).toBe(true);
    expect(prim.validator.safeParse('other').success).toBe(false);
    expect(compileSchema({ const: { a: 1 } }).field.kind).toBe('json');
  });

  it('allOf: merges object members', () => {
    const c = compileSchema({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    });
    expect(c.field.kind).toBe('object');
    expect(c.validator.safeParse({ a: 'x', b: 1 }).success).toBe(true);
    expect(c.validator.safeParse({ a: 'x' }).success).toBe(false);
  });

  it('allOf: intersects non-object members', () => {
    const c = compileSchema({ allOf: [{ type: 'string', minLength: 3 }, { type: 'string', maxLength: 5 }] });
    expect(c.validator.safeParse('abcd').success).toBe(true);
    expect(c.validator.safeParse('ab').success).toBe(false);
    expect(c.validator.safeParse('abcdef').success).toBe(false);
  });

  it('allOf: [] → empty object', () => {
    expect(compileSchema({ allOf: [] }).field).toMatchObject({ kind: 'object', fields: [] });
  });

  it('non-discriminated oneOf → plain union', () => {
    const c = compileSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    expect(c.field.kind).toBe('union');
    if (c.field.kind === 'union') expect(c.field.discriminator).toBeUndefined();
    expect(c.validator.safeParse('x').success).toBe(true);
    expect(c.validator.safeParse(1).success).toBe(true);
    expect(c.validator.safeParse(true).success).toBe(false);
  });

  it('anyOf with a single variant', () => {
    const c = compileSchema({ anyOf: [{ type: 'string' }] });
    expect(c.field.kind).toBe('union');
    expect(c.validator.safeParse('x').success).toBe(true);
  });

  it('oneOf: [] → unknown', () => {
    expect(compileSchema({ oneOf: [] }).validator.safeParse('anything').success).toBe(true);
  });

  it('multi-typed value → json escape hatch', () => {
    expect(compileSchema({ type: ['string', 'number'] }).field.kind).toBe('json');
  });

  it('type ["null"] → null', () => {
    expect(compileSchema({ type: ['null'] }).validator.safeParse(null).success).toBe(true);
  });

  it('type "null" → null', () => {
    const c = compileSchema({ type: 'null' });
    expect(c.validator.safeParse(null).success).toBe(true);
    expect(c.validator.safeParse(0).success).toBe(false);
  });

  it('unsupported type → json escape hatch', () => {
    expect(compileSchema({ type: 'weird-thing' }).field.kind).toBe('json');
  });

  it('recursive $ref → escape hatch where the cycle closes', () => {
    const c = compileSchema({
      type: 'object',
      properties: { name: { type: 'string' }, child: { $ref: '#' } },
      required: ['name'],
    });
    expect(c.field.kind).toBe('object');
    if (c.field.kind !== 'object') return;
    const child = c.field.fields.find((f) => f.name === 'child')?.field;
    expect(child?.kind).toBe('object'); // one level of recursion expands…
    if (child?.kind !== 'object') return;
    expect(child.fields.find((f) => f.name === 'child')?.field.kind).toBe('json'); // …then stops.
  });

  it('unresolved / external $ref → escape hatch', () => {
    expect(compileSchema({ $ref: '#/$defs/missing' }).field.kind).toBe('json');
    expect(compileSchema({ $ref: 'https://example.com/schema.json' }).field.kind).toBe('json');
  });

  it('null literal in a schema position is not crashy', () => {
    // e.g. `items: null` — not a valid sub-schema; falls back.
    expect(compileSchema({ type: 'array', items: null as unknown as JsonSchema }).field.kind).toBe('array');
  });
});
