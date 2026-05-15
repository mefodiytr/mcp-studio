import { createRequire } from 'node:module';

import type { Database } from 'better-sqlite3';

/**
 * **M7 RAG — sqlite-vec DB layer.** Opens (or creates) the RAG database at
 * `<userDataDir>/rag.db` via `better-sqlite3`, loads the sqlite-vec extension
 * (`db.loadExtension`), and applies the idempotent schema migrator.
 *
 * Why `better-sqlite3` (not `node:sqlite` or `node-sqlite3`):
 *  - Synchronous API — the embedding/indexing pipeline is naturally batched
 *    (chunks → embed → upsert); avoids callback/promise sprinkle inside a
 *    transaction.
 *  - Mature `loadExtension` support (sqlite-vec is loaded as a runtime
 *    extension; `Database.prepare('SELECT load_extension(...)')` works but
 *    is awkward — the helper method is the canonical path).
 *  - Native-module foothold M7's C92 amortises onto: once `electron-rebuild`
 *    produces the per-platform binaries, the workspace-store migration
 *    (C92) reuses the same dependency.
 *
 * **Extension loading.** `sqlite-vec` ships per-platform binaries under
 * `node_modules/sqlite-vec/vec0.<ext>`. The package exports a helper that
 * picks the right binary for the runtime platform; we use that to avoid
 * hard-coding paths. The helper is a CommonJS import; we bridge via
 * `createRequire` because this package is ESM.
 *
 * **Schema** (idempotent — re-running the migrator on an existing DB is a
 * no-op):
 *   - `documents` — one row per uploaded document. Carries the scope tag
 *     (workspace-wide vs profile-restricted) as JSON-encoded `profile_ids`.
 *   - `chunks` — one row per chunk. Foreign key to documents (cascade
 *     delete).
 *   - `vec0` virtual table `vec_embeddings(chunk_id, embedding)` — the ANN
 *     index. Keyed on chunk_id (BIGINT mapped from the chunks.id pkey hash).
 *   - `_meta` — schema-version row + the embedding-dimension assertion
 *     (D2 nuance: dimension is stored on each document row, but `_meta`
 *     records the workspace's active dimension to fast-path mismatch checks
 *     before a search).
 */

const SCHEMA_VERSION = 1;

export interface OpenRagDbOptions {
  /** Filesystem path. Use `':memory:'` for tests. */
  path: string;
  /** Skip loading the sqlite-vec extension. Used by unit tests that
   *  exercise the schema layer without the native ANN index (the
   *  extension binary may not be available in the test environment;
   *  C91's platform-smoke is the integration check). */
  skipExtension?: boolean;
  /** Embedding dimension this workspace is configured for. Persisted into
   *  `_meta` on first open + checked on subsequent opens (mismatch =
   *  refuse to load until re-index OR caller passes `dimension` matching
   *  the stored value). Required when `skipExtension: false`. */
  dimension?: number;
}

export interface RagDb {
  db: Database;
  /** The dimension the vec0 table is configured for. Resolved from
   *  `_meta` on existing DBs; from `opts.dimension` on new DBs. */
  dimension: number;
  close(): void;
}

export function openRagDb(opts: OpenRagDbOptions): RagDb {
  // Import inside the function so the package's TypeScript surface (types.ts
  // + the chunking helpers) can be consumed without pulling better-sqlite3
  // into renderer-side test runners that don't have the native module
  // built.
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new BetterSqlite3(opts.path);
  // Tune for the embedding-pipeline workload: WAL mode = concurrent reads
  // during indexing; foreign-key enforcement on so cascade deletes work.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (!opts.skipExtension) {
    const sqliteVec = require('sqlite-vec') as { load(db: Database): void };
    sqliteVec.load(db);
  }

  const dimension = applyMigrations(db, { skipExtension: opts.skipExtension ?? false, dimension: opts.dimension });

  return {
    db,
    dimension,
    close() {
      db.close();
    },
  };
}

/** Idempotent — safe to re-run on an existing DB. Records the current
 *  schema version in `_meta` + creates tables only when missing. The
 *  `dimension` value is set on first run from `opts.dimension`; subsequent
 *  runs read it back. Mismatch with a caller-supplied `opts.dimension`
 *  throws — the caller (workspace settings UI) handles the re-index flow
 *  per D2 nuance before re-opening with the new dimension. */
function applyMigrations(
  db: Database,
  opts: { skipExtension: boolean; dimension?: number },
): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      source_kind TEXT NOT NULL,
      scope_profile_ids TEXT NOT NULL DEFAULT '[]',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      byte_size INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_documents_indexed_at ON documents(indexed_at DESC);
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL,
      page INTEGER,
      section TEXT,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id, ord);
  `);

  // Resolve dimension.
  const existingDimRow = db
    .prepare<[], { value: string }>(`SELECT value FROM _meta WHERE key = 'embedding_dimension'`)
    .get();
  let dimension: number;
  if (existingDimRow) {
    dimension = parseInt(existingDimRow.value, 10);
    if (opts.dimension !== undefined && opts.dimension !== dimension) {
      throw new RagDbDimensionMismatchError(dimension, opts.dimension);
    }
  } else {
    if (opts.dimension === undefined) {
      throw new Error(
        'rag.db: no _meta.embedding_dimension recorded and opts.dimension not supplied — pass the active embedding dimension to seed the DB on first open',
      );
    }
    dimension = opts.dimension;
    db.prepare(`INSERT INTO _meta(key, value) VALUES('embedding_dimension', ?), ('schema_version', ?)`).run(
      String(dimension),
      String(SCHEMA_VERSION),
    );
  }

  // Create the vec0 virtual table when the extension is loaded. Tests that
  // skip the extension exercise only the relational schema; the vector
  // store impl checks for the table's existence before issuing ANN
  // queries.
  if (!opts.skipExtension) {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${dimension}]
      );`,
    );
  }

  return dimension;
}

/** Thrown when the caller-supplied dimension disagrees with the dimension
 *  recorded in `_meta` from a prior open. The settings UI catches this +
 *  prompts the operator with the D2-nuance re-index dialog. */
export class RagDbDimensionMismatchError extends Error {
  constructor(public readonly stored: number, public readonly requested: number) {
    super(
      `rag.db: embedding-dimension mismatch — stored ${stored}, requested ${requested}. ` +
        `Switching providers / models requires re-indexing all documents (D2 nuance).`,
    );
    this.name = 'RagDbDimensionMismatchError';
  }
}
