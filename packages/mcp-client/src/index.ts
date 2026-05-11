export { Connection } from './connection';
export type { ConnectionOptions, MessageDirection, MessageTap, TransportConfig } from './connection';

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
