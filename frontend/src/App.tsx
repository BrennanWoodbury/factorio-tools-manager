import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { ServerDetail } from './components/ServerDetail';
import { Toaster } from './ui';

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const r = await api.me();
      setAuthed(r.authenticated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthed(false);
      else setAuthed(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  if (authed === null) {
    return <div className="login-wrap muted">Loading…</div>;
  }
  if (!authed) {
    return (
      <>
        <Login onLoggedIn={() => setAuthed(true)} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <header className="app-header">
        <div
          className="brand"
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedId(null)}
        >
          <span style={{ fontSize: 22 }}>🏭</span>
          <h1>Factorio Server Manager</h1>
        </div>
        <button
          className="ghost"
          onClick={async () => {
            await api.logout();
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </header>
      <div className="container">
        {selectedId ? (
          <ServerDetail id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <Dashboard onOpen={setSelectedId} />
        )}
      </div>
      <Toaster />
    </>
  );
}
