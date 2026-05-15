import type { Database } from 'better-sqlite3';

import type { ScopeFilter, VectorStore } from './types';

/**
 * **M7 RAG — sqlite-vec-backed `VectorStore` impl.** Wraps the `vec0`
 * virtual table created in `db.ts` with the {@link VectorStore} interface.
 * Operations:
 *
 *   - `upsert(chunkId, embedding)` — `INSERT OR REPLACE` into vec_embeddings.
 *   - `search(embedding, {k, scopeFilter})` — `MATCH` against the vec0 table
 *     (sqlite-vec's KNN syntax) + an outer join to `documents` for the
 *     scope-filter `WHERE` clause + an ordering by distance. Cosine
 *     similarity is computed as `1 - vec_distance_cosine(...)` so the
 *     `score: number` field is "higher = more similar" (matches every
 *     other M5/M6 sort-by-score convention).
 *   - `delete(chunkId)` — single-row delete.
 *   - `clear()` — drop every embedding (used by the D2-nuance re-index flow).
 *   - `size()` — count.
 *
 * The trait separation in `types.ts` keeps the LanceDB contingency open: if
 * the C91 platform smoke fails on a target platform, a sibling
 * `lance-vector-store.ts` ships against the same interface + the
 * DocumentRepository swaps imports without touching the upload pipeline.
 */
export function createSqliteVectorStore(db: Database, dimension: number): VectorStore {
  // Pre-prepare statements — better-sqlite3's idiom for per-call overhead
  // reduction in tight loops (embedding upserts during indexing).
  const upsertStmt = db.prepare<{ chunkId: string; embedding: Buffer }>(
    `INSERT OR REPLACE INTO vec_embeddings(chunk_id, embedding) VALUES(@chunkId, @embedding)`,
  );
  const deleteStmt = db.prepare<{ chunkId: string }>(
    `DELETE FROM vec_embeddings WHERE chunk_id = @chunkId`,
  );
  const clearStmt = db.prepare(`DELETE FROM vec_embeddings`);
  const sizeStmt = db.prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM vec_embeddings`);

  return {
    upsert(chunkId, embedding) {
      assertDimension(embedding, dimension);
      upsertStmt.run({ chunkId, embedding: float32ToBuffer(embedding) });
    },
    search(embedding, opts) {
      assertDimension(embedding, dimension);
      const sql = buildSearchSql(opts.scopeFilter);
      const params: SearchSqlParams = {
        embedding: float32ToBuffer(embedding),
        k: opts.k,
      };
      if (opts.scopeFilter.activeProfileId !== undefined) {
        params.profile_predicate = `%"${opts.scopeFilter.activeProfileId.replace(/"/g, '""')}"%`;
      }
      const rows = db
        .prepare<SearchSqlParams, { chunk_id: string; distance: number }>(sql)
        .all(params);
      return rows.map((r) => ({ chunkId: r.chunk_id, score: 1 - r.distance }));
    },
    delete(chunkId) {
      deleteStmt.run({ chunkId });
    },
    clear() {
      clearStmt.run();
    },
    size() {
      const row = sizeStmt.get();
      return row?.c ?? 0;
    },
  };
}

interface SearchSqlParams {
  embedding: Buffer;
  k: number;
  profile_predicate?: string;
}

/**
 * Build the search SQL. The scope filter selects documents whose
 * `scope_profile_ids` JSON array either is empty (workspace-wide) OR
 * contains the active profile id. We match via a stringified LIKE since
 * sqlite-vec's vec0 doesn't (yet) compose cleanly with `json_each` — the
 * scope_profile_ids JSON is short (a few profile ids at most) and a
 * substring-match against a normalised JSON encoding is correct + fast at
 * the v1 corpus size.
 */
function buildSearchSql(scope: ScopeFilter): string {
  if (scope.activeProfileId === undefined) {
    return `
      SELECT v.chunk_id, vec_distance_cosine(v.embedding, @embedding) AS distance
      FROM vec_embeddings v
      JOIN chunks c ON c.id = v.chunk_id
      JOIN documents d ON d.id = c.document_id
      WHERE d.scope_profile_ids = '[]'
      ORDER BY distance ASC
      LIMIT @k
    `;
  }
  return `
    SELECT v.chunk_id, vec_distance_cosine(v.embedding, @embedding) AS distance
    FROM vec_embeddings v
    JOIN chunks c ON c.id = v.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE d.scope_profile_ids = '[]' OR d.scope_profile_ids LIKE @profile_predicate
    ORDER BY distance ASC
    LIMIT @k
  `;
}

function assertDimension(embedding: Float32Array, expected: number): void {
  if (embedding.length !== expected) {
    throw new Error(
      `vector-store: embedding length ${embedding.length} does not match configured dimension ${expected}`,
    );
  }
}

/** sqlite-vec accepts vectors as either a JSON string, a typed Float32Array
 *  serialised, or a binary blob with the little-endian float32 contents.
 *  The blob form is the most efficient for batch upserts (no JSON parse on
 *  the SQLite side); we encode here. */
function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
