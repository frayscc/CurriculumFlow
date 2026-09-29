import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !value.tables || typeof value.tables !== 'object') return false;
  return Object.values(value.tables).every(Array.isArray);
}

export function createAppServer({ dataDir, staticDir, maxUploadBytes = 800 * 1024 * 1024 }) {
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

  const getState = database.prepare('SELECT revision, payload, updated_at FROM app_state WHERE id = 1');
  const getBlob = database.prepare('SELECT mime_type, size, data FROM file_blobs WHERE id = ?');
  const getBlobMetadata = database.prepare('SELECT id, mime_type AS type, size FROM file_blobs ORDER BY id');
  const putBlob = database.prepare(`
    INSERT INTO file_blobs (id, mime_type, size, data, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET mime_type = excluded.mime_type, size = excluded.size, data = excluded.data, updated_at = excluded.updated_at
  `);
  const putState = database.prepare(`
    INSERT INTO app_state (id, revision, payload, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at
  `);

  function serveStatic(request, response, pathname) {
    if (!staticDir || !existsSync(staticDir)) return json(response, 503, { error: '前端尚未构建' });
    const decoded = decodeURIComponent(pathname);
    const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    let filePath = resolve(staticDir, safePath || 'index.html');
    if (!filePath.startsWith(resolve(staticDir))) return json(response, 403, { error: '禁止访问' });
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
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const state = getState.get();
        if (!state) return response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        return json(response, 200, {
          revision: state.revision,
          updatedAt: state.updated_at,
          snapshot: JSON.parse(state.payload),
          blobs: getBlobMetadata.all(),
        });
      }
      if (request.method === 'PUT' && url.pathname === '/api/state') {
        const body = JSON.parse((await readBody(request, 64 * 1024 * 1024)).toString('utf8'));
        const current = getState.get();
        const currentRevision = current?.revision ?? 0;
        if (body.baseRevision !== currentRevision) return json(response, 409, { error: '服务器数据已更新，请刷新后重试', revision: currentRevision });
        if (!validateSnapshot(body.snapshot) || !Array.isArray(body.blobIds) || !body.blobIds.every(id => typeof id === 'string')) {
          return json(response, 400, { error: '数据格式无效' });
        }
        const missing = body.blobIds.filter(id => !getBlob.get(id));
        if (missing.length) return json(response, 400, { error: '存在尚未上传的附件', missing });
        const nextRevision = currentRevision + 1;
        const updatedAt = new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
          if (body.blobIds.length) {
            const placeholders = body.blobIds.map(() => '?').join(',');
            database.prepare(`DELETE FROM file_blobs WHERE id NOT IN (${placeholders})`).run(...body.blobIds);
          } else database.exec('DELETE FROM file_blobs');
          putState.run(nextRevision, JSON.stringify(body.snapshot), updatedAt);
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
        return json(response, 200, { revision: nextRevision, updatedAt });
      }
      const blobMatch = url.pathname.match(/^\/api\/blobs\/([A-Za-z0-9_-]+)$/);
      if (blobMatch && request.method === 'PUT') {
        const data = await readBody(request, maxUploadBytes);
        const type = String(request.headers['content-type'] || 'application/octet-stream').slice(0, 255);
        putBlob.run(blobMatch[1], type, data.length, data, new Date().toISOString());
        return json(response, 200, { id: blobMatch[1], size: data.length });
      }
      if (blobMatch && request.method === 'GET') {
        const blob = getBlob.get(blobMatch[1]);
        if (!blob) return json(response, 404, { error: '附件不存在' });
        response.writeHead(200, { 'Content-Type': blob.mime_type, 'Content-Length': blob.size, 'Cache-Control': 'private, max-age=3600' });
        return response.end(blob.data);
      }
      if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response, url.pathname);
      return json(response, 404, { error: '接口不存在' });
    } catch (error) {
      const status = error?.statusCode || (error instanceof SyntaxError ? 400 : 500);
      console.error(error);
      return json(response, status, { error: status === 500 ? '服务器内部错误' : error.message });
    }
  });

  server.on('close', () => database.close());
  return server;
}
