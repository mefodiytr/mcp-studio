import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { compileSchema, type JsonSchema } from '../src/index';
import { SchemaForm } from '../src/react';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

function loadFixture(rel: string): JsonSchema {
  return JSON.parse(readFileSync(join(fixturesDir, rel), 'utf8')) as JsonSchema;
}

const noop = (): void => undefined;

describe('SchemaForm — renders the fixture corpus without crashing', () => {
  const cases: { name: string; rel: string }[] = [
    { name: 'echo', rel: 'real-world-schemas/server-everything-echo.json' },
    { name: 'add', rel: 'real-world-schemas/server-everything-add-numbers.json' },
    { name: 'long-running', rel: 'real-world-schemas/server-everything-long-running.json' },
    { name: 'annotated', rel: 'real-world-schemas/server-everything-annotated-message.json' },
    { name: 'filesystem edit_file', rel: 'real-world-schemas/filesystem-edit-file.json' },
    { name: 'niagaramcp readBql', rel: 'real-world-schemas/niagaramcp-read-bql.json' },
    { name: 'additionalProperties', rel: 'edge-cases/additional-properties.json' },
    { name: 'discriminated oneOf', rel: 'edge-cases/discriminated-oneof.json' },
    { name: '$ref into $defs', rel: 'edge-cases/defs-ref.json' },
    { name: 'nullable', rel: 'edge-cases/nullable.json' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const html = renderToString(<SchemaForm schema={loadFixture(c.rel)} onSubmit={noop} />);
      expect(html).toContain('<form');
      expect(html).toContain('type="submit"');
    });
  }
});

describe('SchemaForm — specifics', () => {
  it('renders the echo schema field and the submit label', () => {
    const html = renderToString(
      <SchemaForm schema={loadFixture('real-world-schemas/server-everything-echo.json')} onSubmit={noop} submitLabel="Call" />,
    );
    expect(html).toContain('message');
    expect(html).toContain('Call');
  });

  it('a {} schema renders the JSON escape hatch', () => {
    const html = renderToString(<SchemaForm schema={{}} onSubmit={noop} />);
    expect(html).toContain('JSON value');
  });

  it('seeds number defaults from the schema', () => {
    const html = renderToString(
      <SchemaForm
        compiled={compileSchema(loadFixture('real-world-schemas/server-everything-long-running.json'))}
        onSubmit={noop}
      />,
    );
    expect(html).toContain('value="10"');
    expect(html).toContain('value="5"');
  });

  it('renders a checkbox for boolean fields', () => {
    const html = renderToString(
      <SchemaForm schema={loadFixture('real-world-schemas/server-everything-annotated-message.json')} onSubmit={noop} />,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('includeImage');
  });

  it('renders an empty-form message for a no-arg object schema', () => {
    const html = renderToString(<SchemaForm schema={{ type: 'object', properties: {} }} onSubmit={noop} />);
    expect(html).toContain('takes no arguments');
  });
});
