import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initDb, flushLocal } from './lib/db';
import { startSync } from './lib/sync';
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';
import './styles/features.css';
import './styles/motion.css';

const root = createRoot(document.getElementById('root')!);

initDb()
  .catch((err) => console.error('[liftlog] could not open local database', err))
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    void startSync();
  });

// Make sure pending local writes land before iOS suspends the page.
const flush = () => void flushLocal();
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
window.addEventListener('pagehide', flush);

// Offline support (production only — the dev server serves files differently).
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* e.g. sandboxed preview — app still works, just not offline-installable */
    });
  });
}
