import { describe, expect, it } from 'vitest';

import { generateBearerToken, pickBootstrapMode } from './bootstrap';

describe('pickBootstrapMode', () => {
  it('picks provisionMcpUser when present (the production path)', () => {
    expect(pickBootstrapMode(['listChildren', 'provisionMcpUser', 'setupTestUser'])).toEqual({
      kind: 'production',
      toolName: 'provisionMcpUser',
    });
  });

  it('picks rotateMcpToken when provisionMcpUser is absent but rotateMcpToken is present', () => {
    expect(pickBootstrapMode(['rotateMcpToken', 'setupTestUser'])).toEqual({
      kind: 'production',
      toolName: 'rotateMcpToken',
    });
  });

  it('falls back to the test-gated setupTestUser', () => {
    expect(pickBootstrapMode(['listChildren', 'setupTestUser'])).toEqual({
      kind: 'test',
      toolName: 'setupTestUser',
    });
  });

  it('returns unavailable when none of the bootstrap tools are advertised', () => {
    expect(pickBootstrapMode(['listChildren', 'getSlots'])).toEqual({ kind: 'unavailable' });
    expect(pickBootstrapMode([])).toEqual({ kind: 'unavailable' });
  });
});

describe('generateBearerToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateBearerToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two calls return different tokens (cryptographic randomness)', () => {
    expect(generateBearerToken()).not.toBe(generateBearerToken());
  });
});
