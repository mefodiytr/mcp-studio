import { useMemo, useState, type ReactNode } from 'react';
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
  type FieldValues,
  type Resolver,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { compileSchema, defaultValueFor } from '../compile';
import type { CompiledForm, FieldNode, JsonSchema } from '../types';

// Classes kept aligned with the app's shadcn `Input`/`Button` so the form looks
// at home; the package does not import the app's components.
const inputClass =
  'flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive';
const groupClass = 'flex flex-col gap-3 rounded-md border border-dashed p-3';
const labelClass = 'text-sm font-medium';
const descClass = 'text-xs text-muted-foreground';
const errorClass = 'text-xs text-destructive';
const buttonClass =
  'inline-flex h-8 items-center justify-center rounded-md border bg-transparent px-3 text-xs font-medium hover:bg-accent disabled:opacity-50';
const submitClass =
  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50';

function joinPath(parent: string, key: string | number): string {
  return parent === '' ? String(key) : `${parent}.${key}`;
}

function fieldTitle(field: FieldNode): string | undefined {
  return 'title' in field ? field.title : undefined;
}

function fieldDescription(field: FieldNode): string | undefined {
  return field.description;
}

export interface SchemaFormProps {
  /** A raw JSON Schema (compiled internally) — or a pre-compiled form. */
  schema?: JsonSchema;
  compiled?: CompiledForm;
  /** Receives the validated form value. For a non-object root schema, the value
   *  is the leaf itself (unwrapped). */
  onSubmit: (value: unknown) => void | Promise<void>;
  submitLabel?: string;
  /** Disable the form (e.g. while a call is in flight). */
  busy?: boolean;
}

export function SchemaForm({ schema, compiled, onSubmit, submitLabel = 'Submit', busy = false }: SchemaFormProps) {
  const form = useMemo<CompiledForm>(() => compiled ?? compileSchema(schema ?? {}), [compiled, schema]);
  const rootIsObject = form.field.kind === 'object';

  const validator: z.ZodTypeAny = rootIsObject ? form.validator : z.object({ value: form.validator });
  const methods = useForm<FieldValues>({
    defaultValues: (rootIsObject ? form.defaultValue : { value: form.defaultValue }) as FieldValues,
    resolver: zodResolver(validator) as unknown as Resolver<FieldValues>,
  });

  const handle: SubmitHandler<FieldValues> = (value) => onSubmit(rootIsObject ? value : value['value']);

  return (
    <FormProvider {...methods}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void methods.handleSubmit(handle)(event)}>
        {rootIsObject ? (
          <ObjectFields field={form.field as Extract<FieldNode, { kind: 'object' }>} path="" />
        ) : (
          <FieldRow name="value" field={form.field} required path="value" />
        )}
        <div>
          <button type="submit" disabled={busy} className={submitClass}>
            {submitLabel}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}

function ObjectFields({ field, path }: { field: Extract<FieldNode, { kind: 'object' }>; path: string }) {
  if (field.fields.length === 0) {
    return <p className={descClass}>This tool takes no arguments.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {field.fields.map((named) => (
        <FieldRow
          key={joinPath(path, named.name)}
          name={named.name}
          field={named.field}
          required={named.required}
          path={joinPath(path, named.name)}
        />
      ))}
    </div>
  );
}

function FieldRow({ name, field, required, path }: { name: string; field: FieldNode; required: boolean; path: string }) {
  // Inline checkboxes read better with the label beside the control.
  if (field.kind === 'boolean') {
    return (
      <div className="flex flex-col gap-1">
        <FieldEditor field={field} path={path} label={fieldTitle(field) ?? name} required={required} />
        {fieldDescription(field) && <p className={descClass}>{fieldDescription(field)}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <label className={labelClass} htmlFor={path}>
          {fieldTitle(field) ?? name}
          {required && <span className="text-destructive"> *</span>}
        </label>
        {fieldDescription(field) && <p className={descClass}>{fieldDescription(field)}</p>}
      </div>
      <FieldEditor field={field} path={path} required={required} />
    </div>
  );
}

function FieldEditor({
  field,
  path,
  required,
  label,
}: {
  field: FieldNode;
  path: string;
  required: boolean;
  label?: string;
}): ReactNode {
  switch (field.kind) {
    case 'object':
      return (
        <div className={groupClass}>
          <ObjectFields field={field} path={path} />
        </div>
      );
    case 'array':
      return <ArrayField field={field} path={path} />;
    case 'union':
      return <UnionField field={field} path={path} required={required} />;
    case 'const':
      return <span className={`${descClass} font-mono`}>{String(field.value)}</span>;
    case 'json':
      return <JsonField path={path} />;
    default:
      return (
        <Controller
          name={path}
          render={({ field: input, fieldState }) => (
            <>
              {field.kind === 'boolean' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id={path}
                    type="checkbox"
                    checked={Boolean(input.value)}
                    onChange={(event) => input.onChange(event.target.checked)}
                    onBlur={input.onBlur}
                  />
                  {label ?? path}
                </label>
              ) : field.kind === 'number' ? (
                <input
                  id={path}
                  type="number"
                  className={inputClass}
                  min={field.minimum}
                  max={field.maximum}
                  step={field.integer ? 1 : 'any'}
                  value={input.value ?? ''}
                  aria-invalid={fieldState.error ? true : undefined}
                  onBlur={input.onBlur}
                  onChange={(event) =>
                    input.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                  }
                />
              ) : field.kind === 'enum' ? (
                <select
                  id={path}
                  className={inputClass}
                  value={input.value === undefined ? '' : JSON.stringify(input.value)}
                  aria-invalid={fieldState.error ? true : undefined}
                  onBlur={input.onBlur}
                  onChange={(event) =>
                    input.onChange(event.target.value === '' ? undefined : (JSON.parse(event.target.value) as unknown))
                  }
                >
                  {!required && <option value="">— none —</option>}
                  {field.options.map((option) => (
                    <option key={String(option.value)} value={JSON.stringify(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.kind === 'string' && field.multiline ? (
                <textarea
                  id={path}
                  className={`${inputClass} h-24 resize-y`}
                  value={input.value ?? ''}
                  aria-invalid={fieldState.error ? true : undefined}
                  onBlur={input.onBlur}
                  onChange={(event) => input.onChange(event.target.value)}
                />
              ) : (
                <input
                  id={path}
                  type="text"
                  className={inputClass}
                  value={input.value ?? ''}
                  aria-invalid={fieldState.error ? true : undefined}
                  onBlur={input.onBlur}
                  onChange={(event) => input.onChange(event.target.value)}
                />
              )}
              {fieldState.error && <span className={errorClass}>{fieldState.error.message}</span>}
            </>
          )}
        />
      );
  }
}

function JsonField({ path }: { path: string }) {
  return (
    <Controller
      name={path}
      render={({ field: input, fieldState }) => (
        <JsonInput value={input.value} onChange={input.onChange} error={fieldState.error?.message} />
      )}
    />
  );
}

function JsonInput({
  value,
  onChange,
  error,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [parseError, setParseError] = useState<string | undefined>(undefined);
  return (
    <div className="flex flex-col gap-1">
      <textarea
        className={`${inputClass} h-32 resize-y font-mono`}
        placeholder="JSON value"
        value={text}
        aria-invalid={error || parseError ? true : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') {
            setParseError(undefined);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(next));
            setParseError(undefined);
          } catch (cause) {
            setParseError(cause instanceof Error ? cause.message : 'Invalid JSON');
          }
        }}
      />
      {(parseError ?? error) && <span className={errorClass}>{parseError ?? error}</span>}
    </div>
  );
}

function ArrayField({ field, path }: { field: Extract<FieldNode, { kind: 'array' }>; path: string }) {
  const { control } = useFormContext<FieldValues>();
  const { fields, append, remove } = useFieldArray<FieldValues>({ control, name: path });
  return (
    <div className={groupClass}>
      {fields.length === 0 && <p className={descClass}>No items.</p>}
      {fields.map((entry, index) => (
        <div key={entry.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <FieldEditor field={field.item} path={joinPath(path, index)} required />
          </div>
          <button type="button" className={buttonClass} onClick={() => remove(index)}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className={buttonClass} onClick={() => append(defaultValueFor(field.item) as FieldValues)}>
          Add item
        </button>
      </div>
    </div>
  );
}

function UnionField({
  field,
  path,
  required,
}: {
  field: Extract<FieldNode, { kind: 'union' }>;
  path: string;
  required: boolean;
}) {
  const { setValue } = useFormContext<FieldValues>();
  const [index, setIndex] = useState(0);
  const variant = field.variants[index] ?? field.variants[0];
  if (!variant) return <p className={descClass}>(empty union)</p>;
  return (
    <div className={groupClass}>
      <select
        className={inputClass}
        value={index}
        onChange={(event) => {
          const next = Number(event.target.value);
          setIndex(next);
          const variantField = field.variants[next];
          if (variantField) setValue(path, defaultValueFor(variantField.field) as never, { shouldValidate: true });
        }}
      >
        {field.variants.map((v, i) => (
          <option key={v.label} value={i}>
            {v.label}
          </option>
        ))}
      </select>
      <FieldEditor field={variant.field} path={path} required={required} />
    </div>
  );
}
