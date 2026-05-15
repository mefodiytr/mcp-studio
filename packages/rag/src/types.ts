import { z } from 'zod';

/**
 * **M7 RAG** — core types shared by the document repository, the vector
 * store, the embedding provider, and the chat-turn retrieval pass. Lives in
 * `packages/rag` so the main-process pipeline + future renderer-side
 * consumers (e.g. m7-followup PDF viewer side panel) share one schema.
 *
 * `Document` and `Chunk` are persisted shapes (round-tripped through
 * `better-sqlite3` rows). `RetrievedChunk` is the runtime shape returned by
 * `VectorStore.search` + `retrieveForTurn` — carries enough info for the
 * chat-turn injection (text + citation metadata) plus the score.
 *
 * `EmbeddingProvider` is the main-process counterpart of M5's renderer-side
 * `LlmProvider`: a separate interface because embedding is its own concern
 * (no streaming, batched input, model dimension is fixed at provider-init
 * time). v1 has two impls — `createOpenAiEmbedder` + `createOllamaEmbedder`
 * (in `apps/desktop/src/main/rag/embedding-provider.ts`); the interface
 * lives here so the package is self-contained.
 */

/** Supported document MIME types in v1. Extending the union = adding a chunker
 *  to `src/chunking.ts`; everything else flows through unchanged. */
export const documentMimeTypeSchema = z.enum([
  'text/markdown',
  'application/pdf',
  'text/plain',
]);
export type DocumentMimeType = z.infer<typeof documentMimeTypeSchema>;

/** Source of a document. v1 only supports `'upload'` (operator picks a file).
 *  Future kinds (m7-followup): `'auto-watcher'` (a watched directory; the
 *  pipeline re-indexes on file change), `'plugin-contributed'` (a plugin
 *  registers documents it wants in the corpus). */
export const documentSourceKindSchema = z.enum(['upload']);
export type DocumentSourceKind = z.infer<typeof documentSourceKindSchema>;

/** Per-document scope tag — promt22 D7 nuance. Empty `profileIds` =
 *  workspace-wide; populated = restricted to the listed profile ids. The
 *  retrieval pass filters by `(profileIds.includes(activeProfile) ||
 *  profileIds.length === 0)`. */
export const documentScopeSchema = z.object({
  profileIds: z.array(z.string()),
});
export type DocumentScope = z.infer<typeof documentScopeSchema>;

export const documentSchema = z.object({
  id: z.string(),
  /** Operator-readable title (defaults to the file's basename). */
  title: z.string(),
  /** Absolute filesystem path to the source file. v1 expects the file to
   *  still exist when citations are clicked; m7-followups track a "copy to
   *  app-managed storage" option. */
  path: z.string(),
  mimeType: documentMimeTypeSchema,
  /** Embedding model used at index time. Mismatch on retrieval = re-index
   *  guard fires (D2 nuance). */
  embeddingModel: z.string(),
  /** Embedding dimension count at index time. Mismatch = re-index guard. */
  embeddingDimension: z.number().int().positive(),
  /** UNIX-ms of the indexing operation. */
  indexedAt: z.number().int().nonnegative(),
  sourceKind: documentSourceKindSchema,
  scope: documentScopeSchema,
  /** Cached chunk count — saves a `COUNT(*)` join on every library list. */
  chunkCount: z.number().int().nonnegative(),
  /** Original file size in bytes. */
  byteSize: z.number().int().nonnegative(),
});
export type Document = z.infer<typeof documentSchema>;

export const chunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  /** 0-based position within the document. */
  ord: z.number().int().nonnegative(),
  text: z.string(),
  /** PDF page number (1-based; absent for non-PDF chunks). */
  page: z.number().int().positive().optional(),
  /** Markdown section path (e.g. "Setup > Wiring > AHU-1"; absent for non-MD). */
  section: z.string().optional(),
  /** Source-file character range — used for citation hover preview rendering
   *  + future m7-followup in-app viewer scroll-to-anchor. */
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});
export type Chunk = z.infer<typeof chunkSchema>;

/** A chunk + its similarity score, returned by `VectorStore.search` and
 *  `retrieveForTurn`. Carries the doc title for citation marker rendering. */
export interface RetrievedChunk {
  chunk: Chunk;
  document: Pick<Document, 'id' | 'title' | 'mimeType' | 'path'>;
  /** Cosine similarity in [-1, 1]; higher is more similar. The retrieval pass
   *  filters by a similarity threshold (default 0.30) before returning K. */
  score: number;
}

/** Vector-store trait — the seam between the sqlite-vec impl (v1) and the
 *  contingency LanceDB impl. Internal to `packages/rag`; consumers go
 *  through `DocumentRepository` (which composes the vector store). */
export interface VectorStore {
  /** Insert or replace the embedding for one chunk. */
  upsert(chunkId: string, embedding: Float32Array): void;
  /** Top-K cosine search restricted to chunks belonging to documents whose
   *  scope matches the filter. */
  search(
    embedding: Float32Array,
    opts: { k: number; scopeFilter: ScopeFilter },
  ): { chunkId: string; score: number }[];
  /** Drop the embedding for one chunk (cascade on document delete). */
  delete(chunkId: string): void;
  /** Drop every embedding. Used during the D2-nuance re-index flow. */
  clear(): void;
  /** Total embeddings stored. */
  size(): number;
}

/** Scope filter passed to `VectorStore.search`. The implementation runs this
 *  as a SQL `WHERE` clause against the joined `documents` table. */
export interface ScopeFilter {
  /** Restrict to documents tagged for this profile (or workspace-wide).
   *  Absent = workspace-wide only. */
  activeProfileId?: string;
}

/** Main-process embedding-provider interface. Implementations: OpenAI's
 *  `text-embedding-3-small` (cloud, 1536 dims) + Ollama's `nomic-embed-text`
 *  (local, 768 dims) by default. The dimension is fixed for an instance —
 *  switching models requires a fresh instance + re-index (D2 nuance). */
export interface EmbeddingProvider {
  /** Stable identifier — used for the per-document `embeddingModel` field
   *  and re-index guard. Format: `'<provider>:<modelId>'` e.g.
   *  `'openai:text-embedding-3-small'`. */
  readonly modelId: string;
  /** Fixed dimension. Stored on Document rows; mismatch on retrieval blocks. */
  readonly dimension: number;
  /** Embed a batch of texts. Order-preserving: output[i] is the embedding of
   *  input[i]. Implementations should batch to the provider's max request
   *  size + retry on transient failures (rate limits, brief network errors).
   *  Throws on non-recoverable failures (auth, malformed input). */
  embed(texts: readonly string[], opts?: { signal?: AbortSignal }): Promise<Float32Array[]>;
}
