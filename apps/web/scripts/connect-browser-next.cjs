// Child of the disposable HTTPS acceptance harness. Only Nest can reach this Next listener.
const { createServer } = require('node:http');
const { join } = require('node:path');

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CONNECT_GUEST_SHELL !== 'synthetic-https-only' || !process.send) throw new Error();
  const dir = join(__dirname, '..');
  process.chdir(dir);
  const app = require('next')({ dev: true, turbopack: true, dir, hostname: '127.0.0.1', quiet: true });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => { res.statusCode = 500; res.end(); });
  });
  server.listen(0, '127.0.0.1', () => process.send(server.address().port));
  process.on('disconnect', () => process.exit());
}
main().catch(() => process.exit(1));
