export { Connection } from './connection';
export type { TransportConfig, ConnectionOptions } from './connection';

// Re-export the SDK types consumers commonly need, so they can stay off the
// raw '@modelcontextprotocol/sdk/...' import paths.
export type {
  CallToolResult,
  GetPromptResult,
  Implementation,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
