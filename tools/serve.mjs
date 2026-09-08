// Minimal static server for local development — no dependencies, so `npm start`
// works on a fresh clone with nothing installed.
//
//   node tools/serve.mjs [port]
//
// Serving over http://localhost is what lets the service worker register and
// ES modules load; opening index.html from the filesystem does neither.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Resolve inside ROOT only — a crafted path must not escape the project.
    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (filePath !== ROOT.replace(/[/\\]$/, '') && !filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      return send(res, 403, 'Forbidden');
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, `Not found: ${pathname}`);

    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      // No caching in development, so an edit always shows up on reload.
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  } catch (err) {
    send(res, 500, `Server error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  LogicQuot running at  http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try:  npm start -- 8081\n`);
    process.exit(1);
  }
  throw err;
});
