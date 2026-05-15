/**
 * @mcp-studio/rag — public exports.
 *
 * Main-process consumption (the embedding/indexing pipeline + the chat-turn
 * retrieval pass live in `apps/desktop/src/main/rag/`). The renderer talks
 * to it via the `rag:*` IPC channels (C96+).
 *
 * Three groups:
 *   - **Types** — `Document` / `Chunk` / `EmbeddingProvider` /
 *     `VectorStore` / `RetrievedChunk` (round-tripped between main + the
 *     renderer via IPC; safe to import from both sides as type-only).
 *   - **DB / vector store** — `openRagDb` / `createSqliteVectorStore` /
 *     `createDocumentRepository`. Native-module heavy; main-only.
 *   - **Chunking** — pure functions; safe everywhere.
 */

export type {
  Chunk,
  Document,
  DocumentMimeType,
  DocumentScope,
  DocumentSourceKind,
  EmbeddingProvider,
  RetrievedChunk,
  ScopeFilter,
  VectorStore,
} from './types';
export {
  documentMimeTypeSchema,
  documentScopeSchema,
  documentSourceKindSchema,
  documentSchema,
  chunkSchema,
} from './types';

export {
  openRagDb,
  RagDbDimensionMismatchError,
  type OpenRagDbOptions,
  type RagDb,
} from './db';

export { createSqliteVectorStore } from './vector-store';

export {
  createDocumentRepository,
  type DocumentRepository,
} from './document-repository';

export {
  MAX_CHARS,
  MIN_MERGE_CHARS,
  PLAINTEXT_OVERLAP,
  chunkDocument,
  chunkMarkdown,
  chunkPdf,
  chunkPlaintext,
  type ChunkDocumentOptions,
} from './chunking';
