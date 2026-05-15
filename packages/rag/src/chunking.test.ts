import { describe, expect, it } from 'vitest';

import {
  chunkDocument,
  chunkMarkdown,
  chunkPdf,
  chunkPlaintext,
  MAX_CHARS,
  PLAINTEXT_OVERLAP,
} from './chunking';

describe('chunkPlaintext (character-bounded, promt22 D3)', () => {
  it('returns no chunks for empty text', () => {
    expect(chunkPlaintext('d1', '')).toEqual([]);
  });

  it('returns one chunk for text under MAX_CHARS', () => {
    const text = 'hello world';
    const chunks = chunkPlaintext('d1', text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: 'd1#0',
      documentId: 'd1',
      ord: 0,
      text: 'hello world',
      charStart: 0,
      charEnd: 11,
    });
  });

  it('splits text > MAX_CHARS into fixed-size windows with PLAINTEXT_OVERLAP overlap', () => {
    const text = 'A'.repeat(MAX_CHARS * 3); // 4500 chars
    const chunks = chunkPlaintext('d1', text);
    // First chunk: 0..1500. Each next chunk starts at end-overlap, so the
    // step is (MAX_CHARS - PLAINTEXT_OVERLAP) = 1300 chars; total ≈ 4500
    // / 1300 + 1 = 4 chunks.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[0]!.charEnd).toBe(MAX_CHARS);
    expect(chunks[0]!.text).toHaveLength(MAX_CHARS);
    // Overlap: chunk[1] starts PLAINTEXT_OVERLAP chars before chunk[0] ends.
    expect(chunks[1]!.charStart).toBe(MAX_CHARS - PLAINTEXT_OVERLAP);
    // ords are 0-indexed and ascending.
    chunks.forEach((c, i) => expect(c.ord).toBe(i));
  });

  it('ids are deterministic across re-chunking the same input', () => {
    const text = 'A'.repeat(MAX_CHARS * 2);
    const first = chunkPlaintext('d1', text);
    const second = chunkPlaintext('d1', text);
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first.map((c) => c.id)).toEqual(['d1#0', 'd1#1', 'd1#2']);
  });
});

describe('chunkMarkdown (header-aware)', () => {
  it('splits on H1/H2/H3 headers; carries section path metadata', () => {
    // Sections are each long enough (≥ MIN_MERGE_CHARS = 600) to stand
    // alone so the merger doesn't fold them together — that way the
    // section path on each chunk reflects its own heading.
    const body = 'lorem ipsum dolor sit amet '.repeat(30); // ~810 chars
    const md = `# Setup\n\n${body}\n\n## Wiring\n\n${body}\n\n### AHU-1\n\n${body}\n\n## Calibration\n\n${body}\n`;
    const chunks = chunkMarkdown('d1', md);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const sections = chunks.map((c) => c.section).filter((s): s is string => s !== undefined);
    // The H3 AHU-1 section's path includes its full ancestry.
    expect(sections.some((s) => s.includes('AHU-1') && s.includes('Wiring') && s.includes('Setup'))).toBe(true);
    // The H2 Calibration section's path is "Setup > Calibration" (the
    // stack is trimmed from H3 back to H2 level).
    expect(sections.some((s) => s === 'Setup > Calibration')).toBe(true);
  });

  it('keeps each chunk under MAX_CHARS via paragraph splitting on over-cap sections', () => {
    const paragraph = 'lorem ipsum dolor sit amet '.repeat(50); // ~1350 chars
    const md = `# Big section\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n`;
    const chunks = chunkMarkdown('d1', md);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHARS + 100); // small slack on the boundary
    }
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('merges under-MIN_MERGE sections into the next', () => {
    const md = `## Tiny

short.

## Bigger

This section has more content that doesn't need to merge.
`;
    const chunks = chunkMarkdown('d1', md);
    // The "Tiny" section is too short to stand alone; should merge with
    // "Bigger" → fewer chunks than sections.
    expect(chunks.length).toBeLessThan(3);
  });

  it('returns nothing for empty markdown', () => {
    expect(chunkMarkdown('d1', '')).toEqual([]);
  });
});

describe('chunkPdf (page-bounded)', () => {
  it('produces one chunk per page when pages are under MAX_CHARS', () => {
    const pages = ['Page one body.', 'Page two body.', 'Page three body.'];
    const chunks = chunkPdf('d1', pages);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
    chunks.forEach((c, i) => {
      expect(c.text).toBe(pages[i]);
      expect(c.ord).toBe(i);
    });
  });

  it('splits over-MAX_CHARS pages at paragraph boundaries; preserves page metadata', () => {
    const paragraph = 'lorem ipsum dolor sit amet '.repeat(50); // ~1350 chars
    const bigPage = `${paragraph}\n\n${paragraph}\n\n${paragraph}`; // ≈ 4060 chars
    const chunks = chunkPdf('d1', ['small', bigPage]);
    // page 1: one chunk. page 2: at least two chunks (over MAX_CHARS).
    expect(chunks[0]!.page).toBe(1);
    const page2Chunks = chunks.filter((c) => c.page === 2);
    expect(page2Chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of page2Chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHARS + 100);
    }
  });

  it('skips empty pages', () => {
    const chunks = chunkPdf('d1', ['real content', '', 'more content']);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.page)).toEqual([1, 3]);
  });
});

describe('chunkDocument dispatch', () => {
  it('routes by MIME type', () => {
    expect(chunkDocument({ documentId: 'd', text: 'hello', mimeType: 'text/plain' })).toEqual(
      chunkPlaintext('d', 'hello'),
    );
    expect(
      chunkDocument({ documentId: 'd', text: '# Heading\n\ncontent', mimeType: 'text/markdown' }),
    ).toEqual(chunkMarkdown('d', '# Heading\n\ncontent'));
    expect(
      chunkDocument({
        documentId: 'd',
        text: 'fallback',
        mimeType: 'application/pdf',
        pdfPages: ['p1', 'p2'],
      }),
    ).toEqual(chunkPdf('d', ['p1', 'p2']));
  });

  it('PDF falls back to the full text as single page when pdfPages is absent', () => {
    const chunks = chunkDocument({
      documentId: 'd',
      text: 'extracted but no page split',
      mimeType: 'application/pdf',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.page).toBe(1);
    expect(chunks[0]!.text).toBe('extracted but no page split');
  });
});
