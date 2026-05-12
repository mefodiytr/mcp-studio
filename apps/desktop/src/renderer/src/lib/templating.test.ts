import { describe, expect, it, vi } from 'vitest';

import { expandTemplates, hasTemplates, type TemplateContext } from './templating';

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return { promptFor: () => Promise.reject(new Error('no prompt')), ...overrides };
}

describe('expandTemplates', () => {
  it('leaves values without tokens untouched (and non-strings)', async () => {
    expect(await expandTemplates('plain', ctx())).toBe('plain');
    expect(await expandTemplates(42, ctx())).toBe(42);
    expect(await expandTemplates({ a: 1, b: 'x' }, ctx())).toEqual({ a: 1, b: 'x' });
  });

  it('expands {{cwd}} (empty string when none is set)', async () => {
    expect(await expandTemplates('{{cwd}}', ctx())).toBe('');
    expect(await expandTemplates('{{cwd}}', ctx({ cwd: '/Drivers/RTU1' }))).toBe('/Drivers/RTU1');
    expect(await expandTemplates('slot:{{cwd}}/Out', ctx({ cwd: '/Drivers/RTU1' }))).toBe('slot:/Drivers/RTU1/Out');
  });

  it('expands {{now}} to an ISO timestamp and {{uuid}} to a fresh uuid', async () => {
    expect(await expandTemplates('{{now}}', ctx())).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const a = await expandTemplates('{{uuid}}', ctx());
    const b = await expandTemplates('{{uuid}}', ctx());
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('navigates {{lastResult.a.b}} and resolves a lone {{lastResult}} to the raw value', async () => {
    const lastResult = { content: [{ type: 'text', text: 'hi' }], n: 7 };
    expect(await expandTemplates('{{lastResult}}', ctx({ lastResult }))).toEqual(lastResult);
    expect(await expandTemplates('{{lastResult.n}}', ctx({ lastResult }))).toBe(7);
    expect(await expandTemplates('value={{lastResult.content.0.text}}', ctx({ lastResult }))).toBe('value=hi');
  });

  it('calls promptFor for {{prompt:Label}} and interpolates the answer', async () => {
    const promptFor = vi.fn<(label: string) => Promise<string>>().mockResolvedValue('Alice');
    expect(await expandTemplates('Hello {{prompt:Your name}}!', ctx({ promptFor }))).toBe('Hello Alice!');
    expect(promptFor).toHaveBeenCalledWith('Your name');
  });

  it('leaves an unknown token literal', async () => {
    expect(await expandTemplates('{{not_a_token}}', ctx())).toBe('{{not_a_token}}');
  });

  it('recurses into objects and arrays', async () => {
    const result = await expandTemplates({ a: '{{cwd}}/x', b: ['{{cwd}}', 7] }, ctx({ cwd: '/d' }));
    expect(result).toEqual({ a: '/d/x', b: ['/d', 7] });
  });
});

describe('hasTemplates', () => {
  it('detects {{…}} tokens anywhere in the value', () => {
    expect(hasTemplates('plain')).toBe(false);
    expect(hasTemplates('a {{cwd}} b')).toBe(true);
    expect(hasTemplates({ a: 1, b: '{{uuid}}' })).toBe(true);
    expect(hasTemplates(['x', { y: 'z' }])).toBe(false);
    expect(hasTemplates(42)).toBe(false);
  });
});
