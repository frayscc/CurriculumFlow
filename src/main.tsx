import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './pages/App';
import { initializeServerSync } from './db/serverSync';
import './style.css';
import './accounts.css';
import { setAuth, type AuthState } from './auth';
import { selectAccountDatabase } from './db/schema';
import { LoginPage } from './pages/AccountPage';

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

async function boot() {
  const root = document.getElementById('root')!;
  root.innerHTML = '<main class="workspace"><p>正在连接数据存储…</p></main>';
  if (window.location.protocol !== 'file:') {
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store' });
      if (response.headers.get('content-type')?.includes('application/json') && response.ok) {
        const state = await response.json() as AuthState;
        setAuth(state);
        if (!state.user) { ReactDOM.createRoot(root).render(<LoginPage state={state} />); return; }
        selectAccountDatabase(state.user.id);
      } else if (response.status !== 404 && !response.ok) throw new Error('账号服务暂不可用');
    } catch {
      root.innerHTML = '<main class="workspace"><p>无法连接账号服务，请检查服务器后刷新重试。</p></main>'; return;
    }
  }
  await initializeServerSync();
  ReactDOM.createRoot(root).render(
    <React.StrictMode><Router><App /></Router></React.StrictMode>,
  );
}

void boot();
