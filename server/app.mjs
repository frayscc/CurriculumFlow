import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccess } from './access.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function json(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createAppServer({ dataDir, staticDir, maxUploadBytes = 800 * 1024 * 1024, setupToken }) {
  mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(join(dataDir, 'curriculumflow.db'));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_blobs (
      id TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const access = createAccess(database, dataDir, setupToken);
  const getBlob = database.prepare('SELECT mime_type, size, data FROM file_blobs WHERE id = ?');
  const putBlob = database.prepare(`
    INSERT INTO file_blobs (id, mime_type, size, data, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET mime_type = excluded.mime_type, size = excluded.size, data = excluded.data, updated_at = excluded.updated_at
  `);

  function serveStatic(request, response, pathname) {
    if (!staticDir || !existsSync(staticDir)) return json(response, 503, { error: '前端尚未构建' });
    const decoded = decodeURIComponent(pathname);
    const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    let filePath = resolve(staticDir, safePath || 'index.html');
    if (filePath !== resolve(staticDir) && !filePath.startsWith(`${resolve(staticDir)}${sep}`)) return json(response, 403, { error: '禁止访问' });
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(staticDir, 'index.html');
    const headers = {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') return response.end();
    createReadStream(filePath).pipe(response);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        database.prepare('SELECT 1').get();
        return json(response, 200, { status: 'ok', storage: 'sqlite' });
      }
      if (url.pathname.startsWith('/api/')) {
        const body = async () => {
          if (!request.headers['content-type']?.includes('application/json')) throw Object.assign(new Error('须使用 JSON 请求'), { statusCode: 415 });
          const value = JSON.parse((await readBody(request, url.pathname === '/api/state' ? 64 * 1024 * 1024 : 1024 * 1024)).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('请求格式无效'), { statusCode: 400 });
          return value;
        };
        if (await access.handle(request, response, url, body, json)) return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        return json(response, 200, access.getState(access.actor(request)));
      }
      if (request.method === 'PUT' && url.pathname === '/api/state') {
        if (!request.headers['content-type']?.includes('application/json')) return json(response, 415, { error: '须使用 JSON 请求' });
        const body = JSON.parse((await readBody(request, 64 * 1024 * 1024)).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(response, 400, { error: '请求格式无效' });
        return json(response, 200, access.putState(access.actor(request), body));
      }
      const blobMatch = url.pathname.match(/^\/api\/blobs\/([A-Za-z0-9_-]+)$/);
      if (blobMatch && request.method === 'PUT') {
        access.blobAllowed(access.actor(request), blobMatch[1], true);
        const data = await readBody(request, maxUploadBytes);
        const type = String(request.headers['content-type'] || 'application/octet-stream').slice(0, 255);
        putBlob.run(blobMatch[1], type, data.length, data, new Date().toISOString());
        return json(response, 200, { id: blobMatch[1], size: data.length });
      }
      if (blobMatch && request.method === 'GET') {
        if (!access.blobAllowed(access.actor(request), blobMatch[1])) return json(response, 403, { error: '无权访问附件' });
        const blob = getBlob.get(blobMatch[1]);
        if (!blob) return json(response, 404, { error: '附件不存在' });
        response.writeHead(200, { 'Content-Type': blob.mime_type, 'Content-Length': blob.size, 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' });
        return response.end(blob.data);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: '接口不存在' });
      if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response, url.pathname);
      return json(response, 404, { error: '接口不存在' });
    } catch (error) {
      const status = error?.statusCode || (error instanceof SyntaxError ? 400 : 500);
      if (status >= 500) console.error(error);
      return json(response, status, { error: status === 500 ? '服务器内部错误' : error.message });
    }
  });

  server.on('close', () => database.close());
  return server;
}
