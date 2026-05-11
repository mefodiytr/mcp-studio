import { join } from 'node:path';

import { JsonStore } from './json-store';

/**
 * Pluggable secret cipher. In production this is backed by Electron's
 * `safeStorage` (OS keychain where available); tests inject a reversible stub.
 */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export interface CredentialVaultData {
  schemaVersion: number;
  /** profileId → { enc: base64 of the encrypted secret, hint: "••••1234" }. */
  secrets: Record<string, { enc: string; hint: string }>;
}

const VAULT_VERSION = 1;

export function createCredentialVaultStore(userDataDir: string): JsonStore<CredentialVaultData> {
  return new JsonStore<CredentialVaultData>({
    filePath: join(userDataDir, 'credentials.json'),
    version: VAULT_VERSION,
    defaults: { schemaVersion: VAULT_VERSION, secrets: {} },
  });
}

/** A non-sensitive fingerprint: the last four characters; shorter secrets are
 *  masked entirely. */
export function hintFor(secret: string): string {
  return secret.length > 4 ? `••••${secret.slice(-4)}` : '••••';
}

/**
 * Stores per-profile auth secrets (Bearer tokens, custom-header values)
 * encrypted on disk. The renderer only ever sees the hint, never the secret;
 * `getSecret()` is main-process-only and used when establishing a connection.
 */
export class CredentialVault {
  constructor(
    private readonly store: JsonStore<CredentialVaultData>,
    private readonly cipher: SecretCipher,
  ) {}

  /** Encrypt and store a secret; returns its hint. */
  setSecret(profileId: string, secret: string): string {
    const enc = this.cipher.encrypt(secret).toString('base64');
    const hint = hintFor(secret);
    this.store.data.secrets[profileId] = { enc, hint };
    this.store.save();
    return hint;
  }

  /** Decrypt and return the secret. Main-process only — never exposed via IPC. */
  getSecret(profileId: string): string | undefined {
    const entry = this.store.data.secrets[profileId];
    if (!entry) return undefined;
    return this.cipher.decrypt(Buffer.from(entry.enc, 'base64'));
  }

  getHint(profileId: string): string | undefined {
    return this.store.data.secrets[profileId]?.hint;
  }

  hasSecret(profileId: string): boolean {
    return profileId in this.store.data.secrets;
  }

  deleteSecret(profileId: string): void {
    if (this.store.data.secrets[profileId]) {
      delete this.store.data.secrets[profileId];
      this.store.save();
    }
  }
}
