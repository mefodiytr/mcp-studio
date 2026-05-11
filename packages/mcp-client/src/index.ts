export { Connection, PendingAuthError } from './connection';
export type { ConnectionOptions, MessageDirection, MessageTap, TransportConfig } from './connection';
export { StudioOAuthClientProvider } from './oauth';
export type { OAuthArtifacts, OAuthProviderConfig, OAuthProviderDeps } from './oauth';
export { McpError } from '@modelcontextprotocol/sdk/types.js';
export { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
export type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
export type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

// Re-export the SDK types consumers commonly need, so they can stay off the
// raw '@modelcontextprotocol/sdk/...' import paths.
export type {
  CallToolResult,
  GetPromptResult,
  Implementation,
  JSONRPCMessage,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
