import React from 'react';
import './App.css';

export const App: React.FC = () => {
  return (
    <div className="app-container">
      <header className="header">
        <h1 className="brand-title">Bighabesha Shop 🇪🇹</h1>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>v1.0.0</span>
      </header>
      <main className="content-placeholder">
        <h2>Welcome to Bighabesha Shop</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
          Fast & secure Telegram Stars, Premium, and Gemini Pro subscriptions.
        </p>
        <button className="cta-btn" onClick={() => window.Telegram?.WebApp?.showAlert?.('Shop opening soon!')}>
          Browse Catalog
        </button>
      </main>
    </div>
  );
};

export default App;
