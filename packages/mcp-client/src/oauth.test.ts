import { describe, expect, it, vi } from 'vitest';

import { StudioOAuthClientProvider, type OAuthArtifacts, type OAuthProviderConfig } from './oauth';

function makeProvider(configOverrides: Partial<OAuthProviderConfig> = {}) {
  let store: OAuthArtifacts = {};
  const redirectToAuthorization = vi.fn<(url: URL) => void>();
  const provider = new StudioOAuthClientProvider(
    {
      clientName: 'MCP Studio',
      redirectUrl: 'http://127.0.0.1:51234/callback',
      ...configOverrides,
    },
    {
      load: () => store,
      save: (artifacts) => {
        store = artifacts;
      },
      redirectToAuthorization,
    },
  );
  return { provider, redirectToAuthorization, peek: () => store };
}

describe('StudioOAuthClientProvider', () => {
  it('exposes the redirect URL and a public-client registration metadata', () => {
    const { provider } = makeProvider({ scope: 'mcp:read' });
    expect(provider.redirectUrl).toBe('http://127.0.0.1:51234/callback');
    const md = provider.clientMetadata;
    expect(md.client_name).toBe('MCP Studio');
    expect(md.redirect_uris).toEqual(['http://127.0.0.1:51234/callback']);
    expect(md.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(md.token_endpoint_auth_method).toBe('none');
    expect(md.scope).toBe('mcp:read');
  });

  it('uses client_secret_post when a static secret is configured', () => {
    const { provider } = makeProvider({ staticClientId: 'abc', staticClientSecret: 'shh' });
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe('client_secret_post');
    expect(provider.clientInformation()).toEqual({ client_id: 'abc', client_secret: 'shh' });
  });

  it('returns the static client id (and never the stored DCR info) when configured', async () => {
    const { provider } = makeProvider({ staticClientId: 'static-id' });
    await provider.saveClientInformation({ client_id: 'dcr-id' });
    expect(provider.clientInformation()).toEqual({ client_id: 'static-id' });
  });

  it('round-trips tokens and DCR client information through the store', async () => {
    const { provider, peek } = makeProvider();
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toBeUndefined();

    await provider.saveClientInformation({ client_id: 'dcr-id', client_secret: 'sek' });
    await provider.saveTokens({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt', expires_in: 3600 });

    expect(provider.clientInformation()).toEqual({ client_id: 'dcr-id', client_secret: 'sek' });
    expect(provider.tokens()).toEqual({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt', expires_in: 3600 });
    // The two artifacts coexist in one stored blob.
    expect(peek().clientInfo).toBeDefined();
    expect(peek().tokens).toBeDefined();
  });

  it('keeps the PKCE verifier in memory only', () => {
    const { provider, peek } = makeProvider();
    expect(() => provider.codeVerifier()).toThrow(/code verifier/i);
    provider.saveCodeVerifier('v-e-r-i-f-i-e-r');
    expect(provider.codeVerifier()).toBe('v-e-r-i-f-i-e-r');
    expect(JSON.stringify(peek())).not.toContain('v-e-r-i-f-i-e-r');
  });

  it('delegates the authorization redirect to the injected hook', async () => {
    const { provider, redirectToAuthorization } = makeProvider();
    const url = new URL('https://auth.example/authorize?client_id=x');
    await provider.redirectToAuthorization(url);
    expect(redirectToAuthorization).toHaveBeenCalledWith(url);
  });

  it('invalidates the right credentials per scope', async () => {
    const seed = async (): Promise<ReturnType<typeof makeProvider>> => {
      const ctx = makeProvider();
      await ctx.provider.saveClientInformation({ client_id: 'c' });
      await ctx.provider.saveTokens({ access_token: 'a', token_type: 'Bearer' });
      ctx.provider.saveCodeVerifier('v');
      return ctx;
    };

    let ctx = await seed();
    await ctx.provider.invalidateCredentials('tokens');
    expect(ctx.provider.tokens()).toBeUndefined();
    expect(ctx.provider.clientInformation()).toEqual({ client_id: 'c' });
    expect(ctx.provider.codeVerifier()).toBe('v');

    ctx = await seed();
    await ctx.provider.invalidateCredentials('client');
    expect(ctx.provider.clientInformation()).toBeUndefined();
    expect(ctx.provider.tokens()).toEqual({ access_token: 'a', token_type: 'Bearer' });

    ctx = await seed();
    await ctx.provider.invalidateCredentials('verifier');
    expect(() => ctx.provider.codeVerifier()).toThrow();
    expect(ctx.provider.tokens()).toBeDefined();

    ctx = await seed();
    await ctx.provider.invalidateCredentials('discovery'); // no-op for us
    expect(ctx.provider.tokens()).toBeDefined();
    expect(ctx.provider.clientInformation()).toBeDefined();

    ctx = await seed();
    await ctx.provider.invalidateCredentials('all');
    expect(ctx.provider.tokens()).toBeUndefined();
    expect(ctx.provider.clientInformation()).toBeUndefined();
    expect(() => ctx.provider.codeVerifier()).toThrow();
  });

  it('generates a fresh non-empty state parameter each call', () => {
    const { provider } = makeProvider();
    const a = provider.state();
    const b = provider.state();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
