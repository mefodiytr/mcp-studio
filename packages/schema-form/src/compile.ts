import { z } from 'zod';

import type { CompiledForm, FieldNode, JsonSchema, NamedField } from './types';

type SchemaObject = { [key: string]: unknown };

interface CompileResult {
  field: FieldNode;
  validator: z.ZodTypeAny;
}

function isObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSchemaObject(schema: JsonSchema): SchemaObject | undefined {
  return isObject(schema) ? schema : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function meta(s: SchemaObject): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  const title = str(s['title']);
  const description = str(s['description']);
  if (title !== undefined) out.title = title;
  if (description !== undefined) out.description = description;
  return out;
}

function withDefault(zod: z.ZodTypeAny, s: SchemaObject): z.ZodTypeAny {
  return 'default' in s ? zod.default(s['default'] as never) : zod;
}

function jsonField(
  reason: string,
  defaultValue?: unknown,
  m: { title?: string; description?: string } = {},
): CompileResult {
  return {
    field: { kind: 'json', reason, ...(defaultValue !== undefined ? { default: defaultValue } : {}), ...m },
    validator: z.unknown(),
  };
}

function resolveRef(ref: string, root: SchemaObject): JsonSchema | undefined {
  if (!ref.startsWith('#')) return undefined;
  const pointer = ref.slice(1);
  if (pointer === '' || pointer === '/') return root;
  const parts = pointer
    .replace(/^\//, '')
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return undefined;
  }
  return node as JsonSchema;
}

// ── leaf compilers ────────────────────────────────────────────────────────────

function compileString(s: SchemaObject): CompileResult {
  const format = str(s['format']);
  const minLength = num(s['minLength']);
  const maxLength = num(s['maxLength']);
  const pattern = str(s['pattern']);
  const field: FieldNode = {
    kind: 'string',
    ...meta(s),
    ...(typeof s['default'] === 'string' ? { default: s['default'] } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(maxLength === undefined && (format === 'textarea' || (minLength ?? 0) > 200) ? { multiline: true } : {}),
  };
  let zod = z.string();
  if (minLength !== undefined) zod = zod.min(minLength);
  if (maxLength !== undefined) zod = zod.max(maxLength);
  if (pattern !== undefined) {
    try {
      zod = zod.regex(new RegExp(pattern));
    } catch {
      /* invalid regex — ignore the constraint */
    }
  }
  if (format === 'email') zod = zod.email();
  else if (format === 'uri' || format === 'url') zod = zod.url();
  else if (format === 'uuid') zod = zod.uuid();
  return { field, validator: withDefault(zod, s) };
}

function compileNumber(s: SchemaObject, integer: boolean): CompileResult {
  const minimum = num(s['minimum']);
  const maximum = num(s['maximum']);
  const exclusiveMinimum = num(s['exclusiveMinimum']);
  const exclusiveMaximum = num(s['exclusiveMaximum']);
  const multipleOf = num(s['multipleOf']);
  const field: FieldNode = {
    kind: 'number',
    integer,
    ...meta(s),
    ...(typeof s['default'] === 'number' ? { default: s['default'] } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(exclusiveMinimum !== undefined ? { exclusiveMinimum } : {}),
    ...(exclusiveMaximum !== undefined ? { exclusiveMaximum } : {}),
    ...(multipleOf !== undefined ? { multipleOf } : {}),
  };
  let zod = z.number();
  if (integer) zod = zod.int();
  if (minimum !== undefined) zod = zod.min(minimum);
  if (maximum !== undefined) zod = zod.max(maximum);
  if (exclusiveMinimum !== undefined) zod = zod.gt(exclusiveMinimum);
  if (exclusiveMaximum !== undefined) zod = zod.lt(exclusiveMaximum);
  if (multipleOf !== undefined) zod = zod.multipleOf(multipleOf);
  return { field, validator: withDefault(zod, s) };
}

function compileBoolean(s: SchemaObject): CompileResult {
  return {
    field: { kind: 'boolean', ...meta(s), ...(typeof s['default'] === 'boolean' ? { default: s['default'] } : {}) },
    validator: withDefault(z.boolean(), s),
  };
}

function compileEnum(values: unknown[], s: SchemaObject): CompileResult {
  const field: FieldNode = {
    kind: 'enum',
    options: values.map((v) => ({ value: v, label: String(v) })),
    ...meta(s),
    ...('default' in s ? { default: s['default'] } : {}),
  };
  let zod: z.ZodTypeAny;
  if (values.length === 1) {
    zod = z.literal(values[0] as z.Primitive);
  } else if (values.every((v) => typeof v === 'string')) {
    zod = z.enum(values as [string, ...string[]]);
  } else {
    const literals: z.ZodTypeAny[] = values.map((v) => z.literal(v as z.Primitive));
    zod = z.union(literals as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  return { field, validator: withDefault(zod, s) };
}

function compileConst(value: unknown, s: SchemaObject): CompileResult {
  if (isObject(value) || Array.isArray(value)) return jsonField('const is a non-primitive value', value, meta(s));
  return {
    field: { kind: 'const', value, ...meta(s) },
    validator: withDefault(z.literal(value as z.Primitive), s),
  };
}

// ── composite compilers ──────────────────────────────────────────────────────

function compileArray(s: SchemaObject, root: SchemaObject, seen: Set<string>): CompileResult {
  const itemsSchema = s['items'];
  if (Array.isArray(itemsSchema)) return jsonField('tuple array schema', s['default'], meta(s));
  const item = compileInner((itemsSchema as JsonSchema | undefined) ?? true, root, seen);
  const minItems = num(s['minItems']);
  const maxItems = num(s['maxItems']);
  const field: FieldNode = {
    kind: 'array',
    item: item.field,
    ...meta(s),
    ...(Array.isArray(s['default']) ? { default: s['default'] as unknown[] } : {}),
    ...(minItems !== undefined ? { minItems } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
  };
  let zod = z.array(item.validator);
  if (minItems !== undefined) zod = zod.min(minItems);
  if (maxItems !== undefined) zod = zod.max(maxItems);
  return { field, validator: withDefault(zod, s) };
}

function compileObject(s: SchemaObject, root: SchemaObject, seen: Set<string>): CompileResult {
  const properties = isObject(s['properties']) ? s['properties'] : {};
  const requiredList = Array.isArray(s['required'])
    ? (s['required'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const required = new Set(requiredList);
  const fields: NamedField[] = [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, propSchema] of Object.entries(properties)) {
    const compiled = compileInner(propSchema as JsonSchema, root, seen);
    fields.push({ name, required: required.has(name), field: compiled.field });
    const hasDefault = isObject(propSchema) && 'default' in propSchema;
    // const-typed properties (likely discriminators) must stay present.
    const keepRequired = required.has(name) || hasDefault || compiled.field.kind === 'const';
    shape[name] = keepRequired ? compiled.validator : compiled.validator.optional();
  }
  const allowsAdditional = s['additionalProperties'] !== false;
  const objectZod = z.object(shape);
  const validator = withDefault(allowsAdditional ? objectZod.passthrough() : objectZod, s);
  return { field: { kind: 'object', fields, allowsAdditional, ...meta(s) }, validator };
}

function discriminatorOf(variants: SchemaObject[]): string | undefined {
  if (variants.length < 2) return undefined;
  const first = variants[0];
  if (!first || !isObject(first['properties'])) return undefined;
  for (const key of Object.keys(first['properties'])) {
    const literals = variants.map((variant) => {
      const props = isObject(variant['properties']) ? variant['properties'] : undefined;
      const prop = props ? props[key] : undefined;
      if (!isObject(prop)) return undefined;
      if ('const' in prop && typeof prop['const'] === 'string') return prop['const'];
      if (Array.isArray(prop['enum']) && prop['enum'].length === 1 && typeof prop['enum'][0] === 'string') {
        return prop['enum'][0];
      }
      return undefined;
    });
    if (literals.every((l): l is string => typeof l === 'string') && new Set(literals).size === literals.length) {
      return key;
    }
  }
  return undefined;
}

function compileUnion(rawVariants: JsonSchema[], s: SchemaObject, root: SchemaObject, seen: Set<string>): CompileResult {
  const compiled = rawVariants.map((variant) => compileInner(variant, root, seen));
  const objectSchemas = rawVariants.map(asSchemaObject).filter((v): v is SchemaObject => v !== undefined);
  const discriminator =
    objectSchemas.length === rawVariants.length ? discriminatorOf(objectSchemas) : undefined;

  const field: FieldNode = {
    kind: 'union',
    variants: compiled.map((c, i) => ({
      label: c.field.kind === 'object' && c.field.title ? c.field.title : `Option ${i + 1}`,
      field: c.field,
    })),
    ...meta(s),
    ...(discriminator !== undefined ? { discriminator } : {}),
  };

  let validator: z.ZodTypeAny;
  if (compiled.length === 0) {
    validator = z.unknown();
  } else if (compiled.length === 1) {
    validator = compiled[0]!.validator;
  } else {
    const members = compiled.map((c) => c.validator) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];
    validator = z.union(members);
    if (discriminator) {
      const objectZods = compiled
        .map((c) => c.validator)
        .filter((zz): zz is z.ZodObject<z.ZodRawShape> => zz instanceof z.ZodObject);
      if (objectZods.length === compiled.length) {
        try {
          validator = z.discriminatedUnion(
            discriminator,
            objectZods as [z.ZodObject<z.ZodRawShape>, z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]],
          );
        } catch {
          /* not a clean discriminated union — keep the plain union */
        }
      }
    }
  }
  return { field, validator: withDefault(validator, s) };
}

function compileAllOf(members: JsonSchema[], s: SchemaObject, root: SchemaObject, seen: Set<string>): CompileResult {
  const objects = members.map(asSchemaObject).filter((m): m is SchemaObject => m !== undefined);
  const allObjectish =
    objects.length === members.length &&
    objects.every((m) => m['type'] === 'object' || isObject(m['properties']) || (m['type'] === undefined && !('$ref' in m)));
  if (allObjectish) {
    const mergedProps: SchemaObject = {};
    const mergedRequired: string[] = [];
    for (const m of objects) {
      if (isObject(m['properties'])) Object.assign(mergedProps, m['properties']);
      if (Array.isArray(m['required'])) {
        for (const r of m['required']) if (typeof r === 'string') mergedRequired.push(r);
      }
    }
    return compileObject(
      {
        type: 'object',
        properties: mergedProps,
        required: mergedRequired,
        ...meta(s),
        ...('default' in s ? { default: s['default'] } : {}),
      },
      root,
      seen,
    );
  }
  // Reached only when some member is not an object-ish schema (so members.length ≥ 1).
  const compiled = members.map((m) => compileInner(m, root, seen));
  let validator: z.ZodTypeAny = compiled[0]!.validator;
  for (let i = 1; i < compiled.length; i += 1) validator = z.intersection(validator, compiled[i]!.validator);
  return { field: compiled[0]!.field, validator: withDefault(validator, s) };
}

function compileTypeArray(types: string[], s: SchemaObject, root: SchemaObject, seen: Set<string>): CompileResult {
  const nonNull = types.filter((t) => t !== 'null');
  const nullable = types.includes('null');
  if (nonNull.length === 0) return { field: { kind: 'const', value: null, ...meta(s) }, validator: z.null() };
  if (nonNull.length === 1) {
    const inner = compileInner({ ...s, type: nonNull[0] }, root, seen);
    return nullable ? { field: inner.field, validator: inner.validator.nullable() } : inner;
  }
  return jsonField(`multi-typed value (${types.join(' | ')})`, s['default'], meta(s));
}

// ── dispatch ──────────────────────────────────────────────────────────────────

function compileInner(schema: JsonSchema, root: SchemaObject, seen: Set<string>): CompileResult {
  if (schema === true) return jsonField('schema accepts any value');
  if (schema === false) return { field: { kind: 'json', reason: 'schema rejects all values' }, validator: z.never() };
  const s = asSchemaObject(schema);
  if (!s) return jsonField('not a schema object');

  if (typeof s['$ref'] === 'string') {
    const ref = s['$ref'];
    if (seen.has(ref)) return jsonField(`recursive $ref ${ref}`, undefined, meta(s));
    const target = resolveRef(ref, root);
    if (target === undefined) return jsonField(`unresolved $ref ${ref}`, undefined, meta(s));
    return compileInner(target, root, new Set([...seen, ref]));
  }

  if ('const' in s) return compileConst(s['const'], s);
  if (Array.isArray(s['enum']) && s['enum'].length > 0) return compileEnum(s['enum'], s);

  const unionVariants = (
    Array.isArray(s['oneOf']) ? s['oneOf'] : Array.isArray(s['anyOf']) ? s['anyOf'] : undefined
  ) as JsonSchema[] | undefined;
  if (unionVariants) return compileUnion(unionVariants, s, root, seen);
  if (Array.isArray(s['allOf'])) return compileAllOf(s['allOf'] as JsonSchema[], s, root, seen);

  const type = s['type'];
  if (Array.isArray(type)) {
    return compileTypeArray(
      (type as unknown[]).filter((t): t is string => typeof t === 'string'),
      s,
      root,
      seen,
    );
  }
  if (type === 'object' || (type === undefined && (isObject(s['properties']) || 'additionalProperties' in s))) {
    return compileObject(s, root, seen);
  }
  if (type === 'array') return compileArray(s, root, seen);
  if (type === 'string') return compileString(s);
  if (type === 'integer' || type === 'number') return compileNumber(s, type === 'integer');
  if (type === 'boolean') return compileBoolean(s);
  if (type === 'null') return { field: { kind: 'const', value: null, ...meta(s) }, validator: z.null() };

  return jsonField(
    type === undefined ? 'schema has no type and no recognisable structure' : `unsupported type ${String(type)}`,
    s['default'],
    meta(s),
  );
}

// ── defaults ──────────────────────────────────────────────────────────────────

/** The value to seed a field (or a fresh array item) with. */
export function defaultValueFor(field: FieldNode): unknown {
  switch (field.kind) {
    case 'string':
    case 'number':
    case 'enum':
    case 'json':
      return field.default;
    case 'boolean':
      return field.default ?? false;
    case 'const':
      return field.value;
    case 'array':
      return field.default ?? [];
    case 'union':
      return field.variants.length > 0 ? defaultValueFor(field.variants[0]!.field) : undefined;
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const f of field.fields) out[f.name] = defaultValueFor(f.field);
      return out;
    }
  }
}

/**
 * Compile a JSON Schema into a renderable field tree, a zod validator, and a
 * default value. Never throws — any sub-schema we don't understand becomes a
 * raw-JSON escape-hatch field validated with `z.unknown()`.
 */
export function compileSchema(schema: JsonSchema): CompiledForm {
  const root = asSchemaObject(schema) ?? {};
  const { field, validator } = compileInner(schema, root, new Set<string>());
  return { field, validator, defaultValue: defaultValueFor(field) };
}
