import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  padding: '2.5rem 3rem',
  lineHeight: 1.55,
  color: '#e5e5e5',
  background: '#0a0a0a',
  minHeight: '100vh',
  margin: 0,
};

export function App() {
  const versions = window.studio?.versions;

  return (
    <main style={shellStyle}>
      <h1 style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>MCP Studio</h1>
      <p style={{ margin: '0 0 1.5rem', color: '#a3a3a3' }}>
        Milestone 1 — Foundation. The Electron + Vite + React + TypeScript shell is up.
      </p>
      {versions ? (
        <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#a3a3a3' }}>
          <li>Electron {versions['electron']}</li>
          <li>Chromium {versions['chrome']}</li>
          <li>Node {versions['node']}</li>
        </ul>
      ) : (
        <p style={{ color: '#f59e0b' }}>Preload bridge not detected — not running inside Electron?</p>
      )}
    </main>
  );
}
