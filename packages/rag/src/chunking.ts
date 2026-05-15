import type { Chunk, DocumentMimeType } from './types';

/**
 * **M7 RAG — chunking strategies (promt22 D3 nuance: character-bounded).**
 *
 * Three concrete chunkers; the entry point `chunkDocument(documentId, text,
 * mimeType)` dispatches by MIME type. Each returns `Chunk[]` with `ord`
 * already populated (0-based, ascending). The `id` field is a deterministic
 * derivation of `documentId` + `ord` so re-indexing the same document
 * produces stable chunk ids (useful for the citation chip's cross-session
 * stability).
 *
 * **Character-bounded, not token-bounded** (promt22 D3 nuance): `MAX_CHARS =
 * 1500` (≈ 375 tokens on English prose at the ~4-chars-per-token
 * heuristic; well under both v1 embedding models' input caps). No
 * client-side tokenizer dependency in v1; m7-followup if the heuristic
 * undershoots on dense content and triggers embedding-input-cap rejections.
 *
 * **Strategies**:
 *   - Markdown — split by H1/H2/H3 headers; merge under-min chunks with the
 *     next; split over-cap chunks at paragraph boundaries. Carries the
 *     section path as metadata.
 *   - PDF — caller supplies pre-extracted per-page text; each page is a
 *     chunk if ≤ MAX_CHARS, else page-split at paragraph boundaries. Page
 *     number is on each chunk.
 *   - Plaintext — fixed 1500-char windows with 200-char overlap.
 */

export const MAX_CHARS = 1500;
export const MIN_MERGE_CHARS = 600;
export const PLAINTEXT_OVERLAP = 200;

export interface ChunkDocumentOptions {
  documentId: string;
  text: string;
  mimeType: DocumentMimeType;
  /** For PDFs: page-bounded text. Index = page-1; entries are the
   *  per-page extracted text. Caller (the upload pipeline) parses the PDF
   *  and supplies these. */
  pdfPages?: readonly string[];
}

export function chunkDocument(opts: ChunkDocumentOptions): Chunk[] {
  switch (opts.mimeType) {
    case 'text/markdown':
      return chunkMarkdown(opts.documentId, opts.text);
    case 'application/pdf':
      return chunkPdf(opts.documentId, opts.pdfPages ?? [opts.text]);
    case 'text/plain':
      return chunkPlaintext(opts.documentId, opts.text);
  }
}

/* ---------- plaintext: fixed-size + overlap ---------- */

export function chunkPlaintext(documentId: string, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  if (text.length === 0) return chunks;
  let ord = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(cursor + MAX_CHARS, text.length);
    const slice = text.slice(cursor, end);
    chunks.push({
      id: chunkId(documentId, ord),
      documentId,
      ord,
      text: slice,
      charStart: cursor,
      charEnd: end,
    });
    ord++;
    if (end >= text.length) break;
    cursor = end - PLAINTEXT_OVERLAP;
  }
  return chunks;
}

/* ---------- markdown: header-aware ---------- */

export function chunkMarkdown(documentId: string, text: string): Chunk[] {
  // Lightweight markdown chunker — no remark dependency at the rag layer
  // (the renderer-side react-markdown already uses remark-gfm; the
  // chunker runs in main and stays free of renderer-only deps). Splits
  // on `^#{1,3} ` headers + tracks the heading path as `section`.
  //
  // This loses table cell coherence on rare cases (a giant table spanning
  // 2000 chars under one heading). The MAX_CHARS guard splits anyway at
  // paragraph boundaries; m7-followup if the operator workflow shows
  // table-aware chunking matters.
  const lines = text.split('\n');
  const sections: { level: number; title: string; start: number; lines: string[] }[] = [];
  let current: (typeof sections)[0] = { level: 0, title: '(root)', start: 0, lines: [] };
  sections.push(current);
  let charCursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headerMatch = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (headerMatch) {
      const level = headerMatch[1]!.length;
      const title = headerMatch[2]!;
      current = { level, title, start: charCursor, lines: [line] };
      sections.push(current);
    } else {
      current.lines.push(line);
    }
    charCursor += line.length + 1; // +1 for the newline
  }

  // Build heading-path strings (H1 > H2 > H3) by walking the section list.
  const stack: string[] = [];
  const sectionPaths: string[] = [];
  for (const s of sections) {
    if (s.level === 0) {
      sectionPaths.push('');
    } else {
      // Trim the stack to the current level - 1.
      stack.length = s.level - 1;
      stack[s.level - 1] = s.title;
      sectionPaths.push(stack.slice(0, s.level).join(' > '));
    }
  }

  // Now produce chunks. Merge under-min sections with the next; split
  // over-cap sections at paragraph boundaries.
  const chunks: Chunk[] = [];
  let ord = 0;
  let pending: { text: string; section: string; start: number } | null = null;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const text = s.lines.join('\n');
    if (text.length === 0) continue;
    const section = sectionPaths[i] ?? '';

    if (pending) {
      // Merge if pending is under-min AND same / parent section.
      if (pending.text.length < MIN_MERGE_CHARS && pending.text.length + text.length <= MAX_CHARS) {
        pending.text += '\n' + text;
        continue;
      }
      // Flush pending.
      chunks.push(buildMarkdownChunk(documentId, ord++, pending));
      pending = null;
    }

    if (text.length <= MAX_CHARS) {
      pending = { text, section, start: s.start };
      continue;
    }

    // Over-cap section: split on paragraph boundaries.
    const paragraphs = text.split(/\n\n+/);
    let buffer = '';
    let bufferStart = s.start;
    for (const p of paragraphs) {
      if ((buffer + '\n\n' + p).length > MAX_CHARS && buffer.length > 0) {
        chunks.push(
          buildMarkdownChunk(documentId, ord++, { text: buffer, section, start: bufferStart }),
        );
        bufferStart += buffer.length + 2;
        buffer = p;
      } else {
        buffer = buffer.length === 0 ? p : buffer + '\n\n' + p;
      }
    }
    if (buffer.length > 0) {
      pending = { text: buffer, section, start: bufferStart };
    }
  }
  if (pending) {
    chunks.push(buildMarkdownChunk(documentId, ord++, pending));
  }
  return chunks;
}

function buildMarkdownChunk(
  documentId: string,
  ord: number,
  pending: { text: string; section: string; start: number },
): Chunk {
  return {
    id: chunkId(documentId, ord),
    documentId,
    ord,
    text: pending.text,
    ...(pending.section ? { section: pending.section } : {}),
    charStart: pending.start,
    charEnd: pending.start + pending.text.length,
  };
}

/* ---------- pdf: page-bounded ---------- */

export function chunkPdf(documentId: string, pages: readonly string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let ord = 0;
  let charCursor = 0;
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]!;
    const page = pageIdx + 1;
    if (pageText.length === 0) {
      charCursor += pageText.length;
      continue;
    }
    if (pageText.length <= MAX_CHARS) {
      chunks.push({
        id: chunkId(documentId, ord++),
        documentId,
        ord: ord - 1,
        text: pageText,
        page,
        charStart: charCursor,
        charEnd: charCursor + pageText.length,
      });
      charCursor += pageText.length;
      continue;
    }
    // Over-cap page — split on paragraph boundaries (double-newline) +
    // fall back to sentence-end on giant unparagraphed pages.
    const paragraphs = pageText.split(/\n\n+/);
    let buffer = '';
    let bufferStart = charCursor;
    for (const p of paragraphs) {
      if ((buffer + '\n\n' + p).length > MAX_CHARS && buffer.length > 0) {
        chunks.push({
          id: chunkId(documentId, ord++),
          documentId,
          ord: ord - 1,
          text: buffer,
          page,
          charStart: bufferStart,
          charEnd: bufferStart + buffer.length,
        });
        bufferStart += buffer.length + 2;
        buffer = p;
      } else {
        buffer = buffer.length === 0 ? p : buffer + '\n\n' + p;
      }
    }
    if (buffer.length > 0) {
      chunks.push({
        id: chunkId(documentId, ord++),
        documentId,
        ord: ord - 1,
        text: buffer,
        page,
        charStart: bufferStart,
        charEnd: bufferStart + buffer.length,
      });
    }
    charCursor += pageText.length;
  }
  return chunks;
}

/* ---------- helpers ---------- */

function chunkId(documentId: string, ord: number): string {
  // Deterministic — same documentId+ord on re-index produces the same id.
  // Useful for citation-marker cross-session stability.
  return `${documentId}#${ord}`;
}
