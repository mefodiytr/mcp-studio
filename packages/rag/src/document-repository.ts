import type { Database } from 'better-sqlite3';

import type {
  Chunk,
  Document,
  DocumentScope,
  RetrievedChunk,
  ScopeFilter,
  VectorStore,
} from './types';

/**
 * **M7 RAG — DocumentRepository.** The seam between the upload pipeline +
 * the chat-turn retrieval pass. Owns the relational table reads/writes;
 * composes the `VectorStore` for embedding upserts + ANN searches.
 *
 * Operations:
 *   - `list()` — every document, newest-indexed first. Drives the library
 *     view.
 *   - `get(id)` — one document by id.
 *   - `listChunks(documentId)` — chunks for one document (ord-asc).
 *   - `save(doc, chunks, embeddings)` — upsert a document + its chunks +
 *     their embeddings inside a single transaction. The vector-store
 *     upserts run inside the same transaction so a crashed indexing
 *     pipeline leaves no half-indexed document.
 *   - `delete(id)` — cascades to chunks + embeddings.
 *   - `updateScope(id, scope)` — change a doc's scope tag (D7 single-doc).
 *   - `bulkUpdateScope(ids, scope)` — D7-nuance bulk action.
 *   - `searchSimilar(embedding, k, scopeFilter)` — top-K chunks similar to
 *     the embedding, scope-filtered, joined with their doc metadata for
 *     the citation-marker render.
 */
export interface DocumentRepository {
  list(): Document[];
  get(id: string): Document | null;
  listChunks(documentId: string): Chunk[];
  save(doc: Document, chunks: readonly Chunk[], embeddings: readonly Float32Array[]): void;
  delete(id: string): void;
  updateScope(id: string, scope: DocumentScope): void;
  bulkUpdateScope(ids: readonly string[], scope: DocumentScope): void;
  searchSimilar(
    embedding: Float32Array,
    opts: { k: number; scopeFilter: ScopeFilter },
  ): RetrievedChunk[];
  size(): number;
}

export function createDocumentRepository(db: Database, vectorStore: VectorStore): DocumentRepository {
  // Prepared statements. We define them once + reuse across calls.
  const insertDocument = db.prepare<DocumentRow>(`
    INSERT OR REPLACE INTO documents(
      id, title, path, mime_type, embedding_model, embedding_dimension,
      indexed_at, source_kind, scope_profile_ids, chunk_count, byte_size
    ) VALUES(
      @id, @title, @path, @mime_type, @embedding_model, @embedding_dimension,
      @indexed_at, @source_kind, @scope_profile_ids, @chunk_count, @byte_size
    )
  `);
  const deleteChunksForDocument = db.prepare<{ documentId: string }>(
    `DELETE FROM chunks WHERE document_id = @documentId`,
  );
  const insertChunk = db.prepare<ChunkRow>(`
    INSERT INTO chunks(id, document_id, ord, text, page, section, char_start, char_end)
    VALUES(@id, @document_id, @ord, @text, @page, @section, @char_start, @char_end)
  `);
  const deleteDocument = db.prepare<{ id: string }>(`DELETE FROM documents WHERE id = @id`);
  const selectAllDocuments = db.prepare<[], DocumentRow>(
    `SELECT * FROM documents ORDER BY indexed_at DESC`,
  );
  const selectDocumentById = db.prepare<{ id: string }, DocumentRow>(
    `SELECT * FROM documents WHERE id = @id`,
  );
  const selectChunksForDocument = db.prepare<{ documentId: string }, ChunkRow>(
    `SELECT * FROM chunks WHERE document_id = @documentId ORDER BY ord ASC`,
  );
  const updateScopeStmt = db.prepare<{ id: string; scope_profile_ids: string }>(
    `UPDATE documents SET scope_profile_ids = @scope_profile_ids WHERE id = @id`,
  );
  const selectChunkById = db.prepare<{ id: string }, ChunkRow>(
    `SELECT * FROM chunks WHERE id = @id`,
  );
  const selectDocumentByChunkId = db.prepare<
    { id: string },
    Pick<DocumentRow, 'id' | 'title' | 'mime_type' | 'path'>
  >(`
    SELECT d.id, d.title, d.mime_type, d.path
    FROM documents d JOIN chunks c ON c.document_id = d.id
    WHERE c.id = @id
  `);

  return {
    list() {
      return selectAllDocuments.all().map(rowToDocument);
    },
    get(id) {
      const row = selectDocumentById.get({ id });
      return row ? rowToDocument(row) : null;
    },
    listChunks(documentId) {
      return selectChunksForDocument.all({ documentId }).map(rowToChunk);
    },
    save(doc, chunks, embeddings) {
      if (chunks.length !== embeddings.length) {
        throw new Error(
          `DocumentRepository.save: chunks.length (${chunks.length}) !== embeddings.length (${embeddings.length})`,
        );
      }
      const txn = db.transaction(() => {
        // Read prior chunks BEFORE the document INSERT OR REPLACE — that
        // statement deletes the old row + the FK cascade clears chunks
        // (with `foreign_keys = ON`). If we read after the insert, the
        // SELECT returns zero rows + the vector-store side keeps stale
        // embeddings. Caught by the C91 unit test "save replaces prior
        // chunks on re-index (cascades through vector store)".
        const priorChunks = selectChunksForDocument.all({ documentId: doc.id });
        for (const prior of priorChunks) {
          vectorStore.delete(prior.id);
        }
        insertDocument.run(documentToRow({ ...doc, chunkCount: chunks.length }));
        // The INSERT OR REPLACE above cascaded chunks; this delete is a
        // belt-and-braces clear in case foreign_keys ever gets toggled
        // off in a future migration.
        deleteChunksForDocument.run({ documentId: doc.id });
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i]!;
          const e = embeddings[i]!;
          insertChunk.run(chunkToRow(c));
          vectorStore.upsert(c.id, e);
        }
      });
      txn();
    },
    delete(id) {
      const txn = db.transaction(() => {
        for (const c of selectChunksForDocument.all({ documentId: id })) {
          vectorStore.delete(c.id);
        }
        // The FK ON DELETE CASCADE drops chunks; deleteDocument is the
        // entry point.
        deleteDocument.run({ id });
      });
      txn();
    },
    updateScope(id, scope) {
      updateScopeStmt.run({
        id,
        scope_profile_ids: JSON.stringify(scope.profileIds),
      });
    },
    bulkUpdateScope(ids, scope) {
      const json = JSON.stringify(scope.profileIds);
      const txn = db.transaction(() => {
        for (const id of ids) {
          updateScopeStmt.run({ id, scope_profile_ids: json });
        }
      });
      txn();
    },
    searchSimilar(embedding, opts) {
      const hits = vectorStore.search(embedding, opts);
      const retrieved: RetrievedChunk[] = [];
      for (const hit of hits) {
        const chunkRow = selectChunkById.get({ id: hit.chunkId });
        const docRow = selectDocumentByChunkId.get({ id: hit.chunkId });
        if (!chunkRow || !docRow) continue;
        retrieved.push({
          chunk: rowToChunk(chunkRow),
          document: {
            id: docRow.id,
            title: docRow.title,
            mimeType: docRow.mime_type as Document['mimeType'],
            path: docRow.path,
          },
          score: hit.score,
        });
      }
      return retrieved;
    },
    size() {
      return vectorStore.size();
    },
  };
}

/* ---------- row <-> domain conversions ---------- */

interface DocumentRow {
  id: string;
  title: string;
  path: string;
  mime_type: string;
  embedding_model: string;
  embedding_dimension: number;
  indexed_at: number;
  source_kind: string;
  scope_profile_ids: string;
  chunk_count: number;
  byte_size: number;
}

interface ChunkRow {
  id: string;
  document_id: string;
  ord: number;
  text: string;
  page: number | null;
  section: string | null;
  char_start: number;
  char_end: number;
}

function rowToDocument(r: DocumentRow): Document {
  return {
    id: r.id,
    title: r.title,
    path: r.path,
    mimeType: r.mime_type as Document['mimeType'],
    embeddingModel: r.embedding_model,
    embeddingDimension: r.embedding_dimension,
    indexedAt: r.indexed_at,
    sourceKind: r.source_kind as Document['sourceKind'],
    scope: { profileIds: JSON.parse(r.scope_profile_ids) as string[] },
    chunkCount: r.chunk_count,
    byteSize: r.byte_size,
  };
}

function documentToRow(d: Document): DocumentRow {
  return {
    id: d.id,
    title: d.title,
    path: d.path,
    mime_type: d.mimeType,
    embedding_model: d.embeddingModel,
    embedding_dimension: d.embeddingDimension,
    indexed_at: d.indexedAt,
    source_kind: d.sourceKind,
    scope_profile_ids: JSON.stringify(d.scope.profileIds),
    chunk_count: d.chunkCount,
    byte_size: d.byteSize,
  };
}

function rowToChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    documentId: r.document_id,
    ord: r.ord,
    text: r.text,
    ...(r.page !== null ? { page: r.page } : {}),
    ...(r.section !== null ? { section: r.section } : {}),
    charStart: r.char_start,
    charEnd: r.char_end,
  };
}

function chunkToRow(c: Chunk): ChunkRow {
  return {
    id: c.id,
    document_id: c.documentId,
    ord: c.ord,
    text: c.text,
    page: c.page ?? null,
    section: c.section ?? null,
    char_start: c.charStart,
    char_end: c.charEnd,
  };
}
