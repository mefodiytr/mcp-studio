import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialVault, createCredentialVaultStore, hintFor, type SecretCipher } from './credential-vault';

// A reversible "cipher" for tests (UTF-8 bytes, no real encryption). The real
// safeStorage-backed cipher is exercised at runtime / e2e.
const reversibleCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(plaintext, 'utf8'),
  decrypt: (ciphertext) => ciphertext.toString('utf8'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpstudio-vault-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeVault(): CredentialVault {
  return new CredentialVault(createCredentialVaultStore(dir), reversibleCipher);
}

describe('hintFor', () => {
  it('shows the last four characters, masking shorter secrets entirely', () => {
    expect(hintFor('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('••••7890');
    expect(hintFor('1234')).toBe('••••');
    expect(hintFor('xy')).toBe('••••');
  });
});

describe('CredentialVault', () => {
  it('stores secrets without plaintext on disk, returns only a hint, round-trips internally', () => {
    const vault = makeVault();
    const secret = 'super-secret-token-7890';
    expect(vault.setSecret('profile-1', secret)).toBe('••••7890');

    const raw = readFileSync(join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain('••••7890');

    expect(vault.getSecret('profile-1')).toBe(secret);
    expect(vault.getHint('profile-1')).toBe('••••7890');
    expect(vault.hasSecret('profile-1')).toBe(true);
    expect(vault.getSecret('missing')).toBeUndefined();
    expect(vault.hasSecret('missing')).toBe(false);
  });

  it('purges a secret and persists across vault instances', () => {
    const first = makeVault();
    first.setSecret('a', 'token-aaaa');
    first.setSecret('b', 'token-bbbb');

    const second = makeVault(); // fresh vault reading the same file
    expect(second.getSecret('a')).toBe('token-aaaa');
    expect(second.getHint('b')).toBe('••••bbbb');

    second.deleteSecret('a');
    expect(second.hasSecret('a')).toBe(false);

    const third = makeVault();
    expect(third.hasSecret('a')).toBe(false);
    expect(third.getSecret('b')).toBe('token-bbbb');
    expect(existsSync(join(dir, 'credentials.json'))).toBe(true);
  });
});

describe('CredentialVault — OAuth artifacts', () => {
  const artifacts = {
    tokens: { access_token: 'at-secret', token_type: 'Bearer', refresh_token: 'rt-secret', expires_in: 3600 },
    tokensSavedAt: 1_700_000_000_000,
    clientInfo: { client_id: 'cid', client_secret: 'cs-secret' },
  };

  it('stores OAuth artifacts encrypted (no token/secret material in plaintext) and round-trips', () => {
    const vault = makeVault();
    expect(vault.getOAuthArtifacts('p')).toEqual({});
    expect(vault.hasOAuthArtifacts('p')).toBe(false);

    vault.setOAuthArtifacts('p', artifacts);
    const raw = readFileSync(join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain('at-secret');
    expect(raw).not.toContain('rt-secret');
    expect(raw).not.toContain('cs-secret');

    expect(vault.hasOAuthArtifacts('p')).toBe(true);
    expect(vault.getOAuthArtifacts('p')).toEqual(artifacts);

    const reopened = makeVault();
    expect(reopened.getOAuthArtifacts('p').tokens?.access_token).toBe('at-secret');
    reopened.deleteOAuthArtifacts('p');
    expect(makeVault().hasOAuthArtifacts('p')).toBe(false);
  });

  it('migrates a v1 credentials.json that has no `oauth` map', () => {
    const v1 = {
      schemaVersion: 1,
      secrets: { p: { enc: Buffer.from('tok', 'utf8').toString('base64'), hint: '••••' } },
    };
    writeFileSync(join(dir, 'credentials.json'), `${JSON.stringify(v1, null, 2)}\n`);

    const vault = makeVault(); // loads + migrates
    expect(vault.getSecret('p')).toBe('tok');
    expect(vault.hasOAuthArtifacts('p')).toBe(false);
    vault.setOAuthArtifacts('p', { tokens: { access_token: 'x', token_type: 'Bearer' } });
    expect(vault.getOAuthArtifacts('p').tokens?.access_token).toBe('x');

    const onDisk = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8')) as Record<string, unknown>;
    expect(onDisk['schemaVersion']).toBe(3);
    expect(onDisk['oauth']).toBeDefined();
    expect(onDisk['llmKeys']).toBeDefined();
  });
});

describe('CredentialVault — LLM keys (M5 D4)', () => {
  it('stores LLM keys encrypted by provider, returning the hint', () => {
    const vault = makeVault();
    const key = 'sk-ant-aaa-1234567890abcdef';
    expect(vault.setLlmKey('anthropic', key)).toBe('••••cdef');

    const raw = readFileSync(join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain(key);
    expect(raw).toContain('••••cdef');

    expect(vault.hasLlmKey('anthropic')).toBe(true);
    expect(vault.getLlmKey('anthropic')).toBe(key);
    expect(vault.getLlmKeyHint('anthropic')).toBe('••••cdef');
    expect(vault.hasLlmKey('openai')).toBe(false);
  });

  it('persists across vault re-opens, supports delete', () => {
    const first = makeVault();
    first.setLlmKey('anthropic', 'sk-ant-aaa');
    const second = makeVault();
    expect(second.getLlmKey('anthropic')).toBe('sk-ant-aaa');
    second.deleteLlmKey('anthropic');
    expect(makeVault().hasLlmKey('anthropic')).toBe(false);
  });

  it('migrates a v2 credentials.json that has no `llmKeys` map', () => {
    const v2 = {
      schemaVersion: 2,
      secrets: { p: { enc: Buffer.from('tok', 'utf8').toString('base64'), hint: '••••' } },
      oauth: {},
    };
    writeFileSync(join(dir, 'credentials.json'), `${JSON.stringify(v2, null, 2)}\n`);

    const vault = makeVault();
    expect(vault.getSecret('p')).toBe('tok');
    expect(vault.hasLlmKey('anthropic')).toBe(false);
    vault.setLlmKey('anthropic', 'sk-fresh');
    expect(vault.getLlmKey('anthropic')).toBe('sk-fresh');
  });
});
