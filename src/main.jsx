import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { getPlayLogSessionId } from './services/playLog'
import { _setSessionIdProvider as setEngineTraceSessionProvider, traceEngine } from './services/engineTrace'

// Wire engineTrace to reuse playLog's per-tab session id so both
// ring-buffers can be correlated when attached to a bug report (#27).
setEngineTraceSessionProvider(getPlayLogSessionId);
traceEngine('app:boot');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
