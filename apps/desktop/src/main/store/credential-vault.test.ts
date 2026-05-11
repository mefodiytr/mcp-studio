import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
