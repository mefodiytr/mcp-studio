import type { ZodTypeAny } from 'zod';

/** A JSON Schema document (or a sub-schema). JSON Schema also allows the
 *  literals `true` (accepts anything) and `false` (accepts nothing). */
export type JsonSchema = boolean | { [key: string]: unknown };

/** A node in the renderable field tree produced by {@link compileSchema}. */
export type FieldNode =
  | {
      kind: 'string';
      title?: string;
      description?: string;
      default?: string;
      /** JSON Schema `format` hint (`date`, `date-time`, `uri`, `email`, …). */
      format?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      /** Long strings (no `maxLength`, or a hint) — render as a textarea. */
      multiline?: boolean;
    }
  | {
      kind: 'number';
      title?: string;
      description?: string;
      default?: number;
      integer: boolean;
      minimum?: number;
      maximum?: number;
      exclusiveMinimum?: number;
      exclusiveMaximum?: number;
      multipleOf?: number;
    }
  | { kind: 'boolean'; title?: string; description?: string; default?: boolean }
  | {
      kind: 'enum';
      title?: string;
      description?: string;
      default?: unknown;
      options: { value: unknown; label: string }[];
    }
  | { kind: 'const'; title?: string; description?: string; value: unknown }
  | {
      kind: 'object';
      title?: string;
      description?: string;
      fields: NamedField[];
      /** `additionalProperties` is permissive — the renderer may offer a JSON
       *  escape hatch for extra keys. */
      allowsAdditional: boolean;
    }
  | {
      kind: 'array';
      title?: string;
      description?: string;
      default?: unknown[];
      item: FieldNode;
      minItems?: number;
      maxItems?: number;
    }
  | {
      kind: 'union';
      title?: string;
      description?: string;
      /** Property name discriminating the variants, when there is one. */
      discriminator?: string;
      variants: { label: string; field: FieldNode }[];
    }
  | {
      kind: 'json';
      title?: string;
      description?: string;
      default?: unknown;
      /** Why we fell back to a raw-JSON editor for this sub-schema. */
      reason: string;
    };

export interface NamedField {
  name: string;
  required: boolean;
  field: FieldNode;
}

export interface CompiledForm {
  /** The root field (typically an object). */
  field: FieldNode;
  /** Validates a candidate form value. */
  validator: ZodTypeAny;
  /** Default value to seed the form with (from `default` keywords). */
  defaultValue: unknown;
}
