#!/usr/bin/env node
/* global Buffer, console, process */
/**
 * **M7 C91 — sqlite-vec platform smoke test (promt22 D1 nuance HARD GATE).**
 *
 * Verifies that on the current platform:
 *   1. `better-sqlite3` compiles + loads its native binary.
 *   2. `sqlite-vec` loads as a runtime extension.
 *   3. The `vec0` virtual table accepts inserts + executes a basic ANN
 *      cosine query that returns the expected nearest neighbour.
 *
 * Exit 0 = smoke passed; the C91 commit may land + C92 (workspace-store
 * migration to sqlite) may proceed. Exit non-zero = smoke failed; C92 must
 * NOT commit until the contingency path is picked (LanceDB v1 vector store
 * OR defer the workspace-store migration to a later milestone).
 *
 * Runs locally (C91 author's machine — captured in the C91 commit message)
 * + via CI on the win-x64 + macos-arm64 + linux-x64 matrix (the existing
 * `package.yml` workflow gets a step that runs `pnpm --filter
 * @mcp-studio/rag smoke`).
 *
 * Standalone Node script (`.mjs`) so it's runnable without TypeScript +
 * without electron-rebuild plumbing on a fresh checkout — `node` straight
 * against the installed sqlite-vec.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIMENSION = 128; // Tiny, deterministic; the real workspace uses 1536 / 768.
const N_VECTORS = 50;

function fail(msg, err) {
  console.error(`[smoke FAIL] ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function ok(msg) {
  console.log(`[smoke ok ] ${msg}`);
}

let BetterSqlite3;
try {
  BetterSqlite3 = require('better-sqlite3');
  ok(`better-sqlite3 loaded (${BetterSqlite3.name ?? 'native module ready'})`);
} catch (err) {
  fail('better-sqlite3 require failed', err);
}

let sqliteVec;
try {
  sqliteVec = require('sqlite-vec');
  ok('sqlite-vec module imported');
} catch (err) {
  fail('sqlite-vec require failed', err);
}

let db;
try {
  db = new BetterSqlite3(':memory:');
  ok('in-memory sqlite database opened');
} catch (err) {
  fail('better-sqlite3 in-memory open failed', err);
}

try {
  sqliteVec.load(db);
  ok('sqlite-vec extension loaded into the database');
} catch (err) {
  fail(
    'sqlite-vec extension load failed (the native binary may be missing for this platform)',
    err,
  );
}

try {
  const versionRow = db.prepare('SELECT vec_version() AS v').get();
  ok(`sqlite-vec version ${versionRow.v}`);
} catch (err) {
  fail('vec_version() call failed', err);
}

try {
  db.exec(
    `CREATE VIRTUAL TABLE vec_test USING vec0(chunk_id TEXT PRIMARY KEY, embedding FLOAT[${DIMENSION}])`,
  );
  ok(`vec0 virtual table created (dimension ${DIMENSION})`);
} catch (err) {
  fail('vec0 virtual table create failed', err);
}

// Deterministic test vectors: unit basis vectors so cosine distance is
// trivially predictable. embedding_i is all zeros except for a 1 at
// position (i mod DIMENSION).
function makeVector(i) {
  const v = new Float32Array(DIMENSION);
  v[i % DIMENSION] = 1.0;
  return v;
}

function float32ToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

try {
  const insert = db.prepare(
    'INSERT INTO vec_test(chunk_id, embedding) VALUES(@chunkId, @embedding)',
  );
  const txn = db.transaction(() => {
    for (let i = 0; i < N_VECTORS; i++) {
      insert.run({ chunkId: `c${i}`, embedding: float32ToBuffer(makeVector(i)) });
    }
  });
  txn();
  ok(`${N_VECTORS} test vectors inserted`);
} catch (err) {
  fail('vector insert failed', err);
}

try {
  const probe = makeVector(7); // exact match for c7 (since 7 < DIMENSION)
  const rows = db
    .prepare(
      `SELECT chunk_id, vec_distance_cosine(embedding, @embedding) AS distance
       FROM vec_test
       ORDER BY distance ASC
       LIMIT 5`,
    )
    .all({ embedding: float32ToBuffer(probe) });
  if (rows.length === 0) fail('search returned no rows');
  if (rows[0].chunk_id !== 'c7') {
    fail(
      `search top-1 was '${rows[0].chunk_id}', expected 'c7' (the exact-match basis vector)`,
    );
  }
  // Cosine distance of identical unit vectors is 0; we tolerate float
  // jitter under 1e-5.
  if (Math.abs(rows[0].distance) > 1e-5) {
    fail(`search top-1 distance was ${rows[0].distance}, expected ~0`);
  }
  ok(`cosine search returned the expected nearest neighbour (c7, distance ${rows[0].distance})`);
} catch (err) {
  fail('cosine search failed', err);
}

try {
  db.close();
  ok('database closed cleanly');
} catch (err) {
  fail('database close failed', err);
}

console.log('\n[smoke PASS] sqlite-vec is functional on this platform.');
console.log(`platform: ${process.platform} ${process.arch}; node: ${process.version}`);
process.exit(0);
