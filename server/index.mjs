import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createAppServer } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const dataDir = resolve(process.env.DATA_DIR || '/data');
const staticDir = resolve(process.env.STATIC_DIR || join(here, '..', 'dist'));
const server = createAppServer({ dataDir, staticDir });

server.listen(port, '0.0.0.0', () => console.log(`CurriculumFlow 已启动：http://0.0.0.0:${port}`));

function shutdown() {
  server.close(error => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
