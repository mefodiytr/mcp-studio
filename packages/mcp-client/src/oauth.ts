import { randomBytes } from 'node:crypto';

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

type StoredClientInformation = OAuthClientInformationMixed;

/** Everything an OAuth session needs persisted (per connection profile). The
 *  PKCE code verifier is *not* here — it's transient, kept in memory only. The
 *  discovered server metadata isn't here either — the SDK re-discovers each
 *  `auth()` call and exposes no provider hook to cache it. */
export interface OAuthArtifacts {
  tokens?: OAuthTokens;
  /** The dynamically-registered client (RFC 7591). Absent when a static
   *  `clientId` is configured instead, or before the first registration. */
  clientInfo?: StoredClientInformation;
}

export interface OAuthProviderConfig {
  /** `client_name` in the registration metadata. */
  clientName: string;
  /** The loopback callback URL the authorization server redirects to. */
  redirectUrl: string;
  /** Requested scope, if the server/operator wants one. */
  scope?: string;
  /** A pre-registered `client_id` for servers that don't support DCR. When set,
   *  it short-circuits `clientInformation()` and DCR is never attempted. */
  staticClientId?: string;
  /** A pre-registered `client_secret` (confidential client — uncommon for a
   *  desktop app, but supported if a server hands one out). Requires `staticClientId`. */
  staticClientSecret?: string;
}

export interface OAuthProviderDeps {
  /** Load this profile's persisted OAuth artifacts (empty object if none). */
  load: () => OAuthArtifacts;
  /** Persist this profile's OAuth artifacts. */
  save: (artifacts: OAuthArtifacts) => void | Promise<void>;
  /** Begin the authorization flow — open `url` in the user's browser (or, in
   *  test mode, drive it headlessly). */
  redirectToAuthorization: (url: URL) => void | Promise<void>;
}

/**
 * The SDK's `OAuthClientProvider`, backed by an injected key-value store and a
 * redirect hook — Electron-free, so the desktop app wires it to the credential
 * vault + the loopback listener and tests wire it to an in-memory store + a spy.
 */
export class StudioOAuthClientProvider implements OAuthClientProvider {
  private codeVerifierValue: string | undefined;

  constructor(
    private readonly config: OAuthProviderConfig,
    private readonly deps: OAuthProviderDeps,
  ) {}

  get redirectUrl(): string {
    return this.config.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName,
      redirect_uris: [this.config.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: this.config.staticClientSecret ? 'client_secret_post' : 'none',
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }

  state(): string {
    return randomBytes(16).toString('hex');
  }

  clientInformation(): StoredClientInformation | undefined {
    if (this.config.staticClientId) {
      return this.config.staticClientSecret
        ? { client_id: this.config.staticClientId, client_secret: this.config.staticClientSecret }
        : { client_id: this.config.staticClientId };
    }
    return this.deps.load().clientInfo;
  }

  async saveClientInformation(clientInformation: StoredClientInformation): Promise<void> {
    await this.deps.save({ ...this.deps.load(), clientInfo: clientInformation });
  }

  tokens(): OAuthTokens | undefined {
    return this.deps.load().tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.deps.save({ ...this.deps.load(), tokens });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.deps.redirectToAuthorization(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error('No PKCE code verifier saved for this session');
    return this.codeVerifierValue;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier' || scope === 'all') this.codeVerifierValue = undefined;
    if (scope === 'discovery') return; // not cached by us
    const current = this.deps.load();
    if (scope === 'tokens') await this.deps.save({ ...current, tokens: undefined });
    else if (scope === 'client') await this.deps.save({ ...current, clientInfo: undefined });
    else if (scope === 'all') await this.deps.save({});
  }
}
