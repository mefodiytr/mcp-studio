import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openRagDb, type RagDb } from './db';
import { createDocumentRepository, type DocumentRepository } from './document-repository';
import type { Chunk, Document, VectorStore } from './types';

/**
 * Stub VectorStore for unit tests — captures upsert/delete/search calls in
 * an in-memory Map. The real sqlite-vec impl is exercised by the C91
 * platform-smoke. Repository transactions + the chunk-cascade behaviour
 * are independent of which VectorStore is wired in.
 */
function createStubVectorStore(): VectorStore & { state: Map<string, Float32Array> } {
  const state = new Map<string, Float32Array>();
  return {
    state,
    upsert(chunkId, embedding) {
      state.set(chunkId, embedding);
    },
    search(_embedding, _opts) {
      // Naive — return the latest-inserted chunk first with a fixed score
      // so the test can assert the relational join shape without depending
      // on real ANN behaviour.
      const entries = Array.from(state.keys());
      return entries.map((chunkId, i) => ({ chunkId, score: 1 - i * 0.1 }));
    },
    delete(chunkId) {
      state.delete(chunkId);
    },
    clear() {
      state.clear();
    },
    size() {
      return state.size;
    },
  };
}

const DIM = 4;

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc1',
    title: 'Test',
    path: '/tmp/test.md',
    mimeType: 'text/markdown',
    embeddingModel: 'test:test',
    embeddingDimension: DIM,
    indexedAt: 1_700_000_000_000,
    sourceKind: 'upload',
    scope: { profileIds: [] },
    chunkCount: 0,
    byteSize: 100,
    ...overrides,
  };
}

function makeChunk(documentId: string, ord: number, text = `chunk ${ord}`): Chunk {
  return {
    id: `${documentId}#${ord}`,
    documentId,
    ord,
    text,
    charStart: ord * 100,
    charEnd: ord * 100 + text.length,
  };
}

function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) arr[i] = (seed + i) * 0.1;
  return arr;
}

describe('DocumentRepository', () => {
  let rag: RagDb;
  let repo: DocumentRepository;
  let store: ReturnType<typeof createStubVectorStore>;

  beforeEach(() => {
    rag = openRagDb({ path: ':memory:', skipExtension: true, dimension: DIM });
    store = createStubVectorStore();
    repo = createDocumentRepository(rag.db, store);
  });

  afterEach(() => {
    rag.close();
  });

  it('save then get round-trips a document + its chunks + embeddings', () => {
    const doc = makeDoc();
    const chunks = [makeChunk('doc1', 0, 'hello'), makeChunk('doc1', 1, 'world')];
    const embeddings = [makeEmbedding(0), makeEmbedding(1)];
    repo.save(doc, chunks, embeddings);

    const got = repo.get('doc1');
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ id: 'doc1', title: 'Test', chunkCount: 2 });
    expect(repo.listChunks('doc1')).toEqual(chunks);
    expect(store.state.size).toBe(2);
    expect(store.state.get('doc1#0')).toEqual(embeddings[0]);
  });

  it('save replaces prior chunks on re-index (cascades through vector store)', () => {
    repo.save(
      makeDoc(),
      [makeChunk('doc1', 0), makeChunk('doc1', 1), makeChunk('doc1', 2)],
      [makeEmbedding(0), makeEmbedding(1), makeEmbedding(2)],
    );
    expect(store.state.size).toBe(3);

    // Re-save with fewer chunks — the prior ones must be dropped from
    // BOTH the relational table AND the vector store.
    repo.save(makeDoc({ chunkCount: 1 }), [makeChunk('doc1', 0)], [makeEmbedding(99)]);
    expect(repo.listChunks('doc1')).toHaveLength(1);
    expect(store.state.size).toBe(1);
    expect(store.state.get('doc1#0')).toEqual(makeEmbedding(99));
  });

  it('list returns documents newest-indexed first', () => {
    repo.save(makeDoc({ id: 'a', indexedAt: 1000, chunkCount: 0 }), [], []);
    repo.save(makeDoc({ id: 'b', indexedAt: 3000, chunkCount: 0 }), [], []);
    repo.save(makeDoc({ id: 'c', indexedAt: 2000, chunkCount: 0 }), [], []);
    expect(repo.list().map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('delete cascades chunks + embeddings; get returns null', () => {
    repo.save(
      makeDoc(),
      [makeChunk('doc1', 0), makeChunk('doc1', 1)],
      [makeEmbedding(0), makeEmbedding(1)],
    );
    repo.delete('doc1');
    expect(repo.get('doc1')).toBeNull();
    expect(repo.listChunks('doc1')).toEqual([]);
    expect(store.state.size).toBe(0);
  });

  it('updateScope writes the new scope; round-trips through get', () => {
    repo.save(makeDoc({ scope: { profileIds: [] } }), [], []);
    repo.updateScope('doc1', { profileIds: ['p1', 'p2'] });
    expect(repo.get('doc1')?.scope.profileIds).toEqual(['p1', 'p2']);
  });

  it('bulkUpdateScope (promt22 D7 nuance) updates N documents atomically', () => {
    repo.save(makeDoc({ id: 'a' }), [], []);
    repo.save(makeDoc({ id: 'b' }), [], []);
    repo.save(makeDoc({ id: 'c' }), [], []);
    repo.bulkUpdateScope(['a', 'b'], { profileIds: ['p1'] });
    expect(repo.get('a')?.scope.profileIds).toEqual(['p1']);
    expect(repo.get('b')?.scope.profileIds).toEqual(['p1']);
    // 'c' was not in the bulk list — stays workspace-wide.
    expect(repo.get('c')?.scope.profileIds).toEqual([]);
  });

  it('save throws when chunks.length !== embeddings.length', () => {
    expect(() =>
      repo.save(makeDoc(), [makeChunk('doc1', 0), makeChunk('doc1', 1)], [makeEmbedding(0)]),
    ).toThrow(/chunks\.length .* !== embeddings\.length/);
  });

  it('chunks ord is preserved on listChunks (ascending)', () => {
    repo.save(
      makeDoc(),
      [makeChunk('doc1', 2), makeChunk('doc1', 0), makeChunk('doc1', 1)], // inserted out-of-order
      [makeEmbedding(2), makeEmbedding(0), makeEmbedding(1)],
    );
    expect(repo.listChunks('doc1').map((c) => c.ord)).toEqual([0, 1, 2]);
  });

  it('searchSimilar joins chunks + documents and returns RetrievedChunk shape', () => {
    repo.save(
      makeDoc({ id: 'doc1', title: 'Doc One' }),
      [makeChunk('doc1', 0, 'first')],
      [makeEmbedding(0)],
    );
    const out = repo.searchSimilar(makeEmbedding(0), { k: 1, scopeFilter: {} });
    // The stub VectorStore returns latest-inserted; we just verify the
    // join shape.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      chunk: { id: 'doc1#0', text: 'first' },
      document: { id: 'doc1', title: 'Doc One', mimeType: 'text/markdown' },
      score: expect.any(Number) as number,
    });
  });

  it('size proxies to the underlying VectorStore', () => {
    expect(repo.size()).toBe(0);
    repo.save(makeDoc(), [makeChunk('doc1', 0)], [makeEmbedding(0)]);
    expect(repo.size()).toBe(1);
  });
});

describe('openRagDb', () => {
  it('records embedding_dimension on first open; reads it back on subsequent open', () => {
    const path = ':memory:';
    // Re-using :memory: across opens doesn't share state — but openRagDb
    // with the same in-memory DB connection is rare; the dimension-read-
    // back test runs end-to-end against a real file in C91's smoke.
    const rag = openRagDb({ path, skipExtension: true, dimension: 1536 });
    expect(rag.dimension).toBe(1536);
    rag.close();
  });

  it('throws RagDbDimensionMismatchError when the caller passes a dimension different from the stored value', () => {
    // Use a real file-backed in-memory shared cache so the second open
    // sees the first open's writes.
    const path = `file:rag-dim-test?mode=memory&cache=shared`;
    const rag1 = openRagDb({ path, skipExtension: true, dimension: 1536 });
    expect(() => openRagDb({ path, skipExtension: true, dimension: 768 })).toThrow(
      /embedding-dimension mismatch — stored 1536, requested 768/,
    );
    rag1.close();
  });

  it('throws when neither stored dimension nor opts.dimension is supplied on first open', () => {
    expect(() => openRagDb({ path: ':memory:', skipExtension: true })).toThrow(
      /no _meta\.embedding_dimension recorded/,
    );
  });
});
