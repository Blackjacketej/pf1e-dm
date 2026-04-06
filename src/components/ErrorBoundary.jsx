import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          backgroundColor: '#1a1a2e',
          color: '#ff6b6b',
          minHeight: '100vh',
          fontFamily: 'monospace',
        }}>
          <h2 style={{ color: '#ffd700', marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: '#d4c5a9', marginBottom: '16px' }}>
            The app hit an error. Try refreshing the page. If it persists, clear your browser
            data for this site (Settings &gt; Clear browsing data &gt; Cookies and site data).
          </p>
          <details style={{ marginBottom: '16px' }}>
            <summary style={{ cursor: 'pointer', color: '#ffd700' }}>Error details</summary>
            <pre style={{
              marginTop: '8px',
              padding: '12px',
              backgroundColor: '#0d1117',
              borderRadius: '6px',
              overflow: 'auto',
              fontSize: '12px',
              lineHeight: 1.5,
              color: '#ff6b6b',
            }}>
              {this.state.error?.toString()}
              {'\n\n'}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              backgroundColor: '#3a3a6e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              marginRight: '8px',
            }}
          >
            Refresh Page
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('pf-live-state');
              window.location.reload();
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#2a1a1a',
              border: '1px solid #ff6b6b',
              color: '#ff6b6b',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            Reset App State & Refresh
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
