import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './pages/App';
import { initializeServerSync } from './db/serverSync';
import './style.css';

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

async function boot() {
  const root = document.getElementById('root')!;
  root.innerHTML = '<main class="workspace"><p>正在连接数据存储…</p></main>';
  await initializeServerSync();
  ReactDOM.createRoot(root).render(
    <React.StrictMode><Router><App /></Router></React.StrictMode>,
  );
}

void boot();
