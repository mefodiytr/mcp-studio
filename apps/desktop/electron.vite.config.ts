import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedAlias = { '@shared': resolve('src/shared') };

// The workspace package @mcp-studio/mcp-client (and, transitively, the ESM
// @modelcontextprotocol/sdk) must be bundled into the main process, not
// externalized — the main bundle is CJS and Electron's Node can't require() ESM.
const main = {
  resolve: { alias: sharedAlias },
  plugins: [externalizeDepsPlugin({ exclude: ['@mcp-studio/mcp-client'] })],
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
    },
    plugins: [react(), tailwindcss()],
  },
});
