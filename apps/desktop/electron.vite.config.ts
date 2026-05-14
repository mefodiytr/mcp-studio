import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedAlias = { '@shared': resolve('src/shared') };

// The workspace package @mcp-studio/mcp-client (and, transitively, the ESM
// @modelcontextprotocol/sdk) must be bundled into the main process, not
// externalized — the main bundle is CJS and Electron's Node can't require() ESM.
//
// M5 C75 adds @mcp-studio/niagara/manifest + @mcp-studio/plugin-api to the
// same exclude list: main's safety-boundary annotation registry imports the
// plugin manifests directly (pure data, no React) so the AI-write predicate
// runs without a renderer round-trip. The manifest's transitive imports
// (zod, the type-only references) are bundled too.
const main = {
  resolve: { alias: sharedAlias },
  plugins: [
    externalizeDepsPlugin({
      exclude: ['@mcp-studio/mcp-client', '@mcp-studio/niagara', '@mcp-studio/plugin-api'],
    }),
  ],
};

export default defineConfig({
  main,
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src'),
      },
      // One instance of the context-bearing libraries across the host bundle
      // and the lazily-chunked in-box plugin views (which import React / React
      // Query via peerDeps) — a duplicate copy means broken hooks or "No
      // QueryClient set". (schema-form similarly brings react-hook-form etc.)
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@tanstack/react-query'],
    },
    build: {
      rollupOptions: {
        output: {
          // Hoist heavy third-party deps into shared chunks so the lazy
          // feature views stay small. The pattern is the same in every case:
          // force the split *before* a second consumer lands, so Rollup has
          // an explicit chunking instruction from day one rather than
          // re-planning when a second view lazily imports the same dep.
          //
          //   recharts            — Tool usage / Niagara History / Monitor /
          //                          Performance (M4).
          //   @anthropic-ai/sdk   — ChatView (M5 C71); a future scheduled-
          //                          flow / background-agent consumer (M6+)
          //                          becomes the second.
          //   react-markdown +    — ChatView (M5 C71) renders assistant
          //   remark-gfm            messages; a future contextual-help /
          //                          docs viewer is the natural second.
          //
          // The eager renderer drop from M4 (815 → 599 kB once recharts was
          // hinted) is the precedent: explicit hints let Rollup re-plan the
          // chunk graph more aggressively even when there's only one
          // consumer. Tracked for CodeMirror (next BqlView consumer) in
          // m4-followups.md.
          manualChunks: {
            recharts: ['recharts'],
            anthropic: ['@anthropic-ai/sdk'],
            markdown: ['react-markdown', 'remark-gfm'],
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
