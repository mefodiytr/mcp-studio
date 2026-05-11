import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './lib/i18n';
import './index.css';
import { App } from './app/App';
import { THEME_STORAGE_KEY } from './lib/theme';

// Resolve and apply the stored theme synchronously, before first paint, so the
// app never flashes the wrong colour scheme on startup.
const stored = localStorage.getItem(THEME_STORAGE_KEY);
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.classList.toggle(
  'dark',
  stored === 'dark' || (stored !== 'light' && prefersDark),
);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
