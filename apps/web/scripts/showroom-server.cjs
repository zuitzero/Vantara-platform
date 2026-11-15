// Dedicated process entry for the closed synthetic Showroom mode.
const { createServer } = require('node:http');
const { join } = require('node:path');
const { admits, configuration, deny, HEADER } = require('../../../infra/staging/showroom-policy.cjs');

async function main() {
  const config = configuration(process.env);
  if (!config) throw new Error('SHOWROOM_MODE_REQUIRED');
  const dir = join(__dirname, '..');
  process.chdir(dir);
  // This is process-local, set only after opting into this raw request wrapper.
  globalThis[Symbol.for('vantara.showroom.raw-ingress')] = true;
  const app = require('next')({ dev: false, turbopack: true, dir, quiet: true });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    if (!admits(config, req, 'web')) return deny(res);
    // The ingress proof is never visible to Next's request processing.
    delete req.headers[HEADER];
    void handle(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else deny(res);
    });
  });
  server.on('error', () => {
    console.error('SHOWROOM_LISTENER_REJECTED');
    process.exit(1);
  });
  server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
    // Private test harness receives the ephemeral TCP port without logging it.
    if (process.send) process.send(server.address().port);
  });
}

main().catch(() => {
  console.error('SHOWROOM_WEB_STARTUP_REJECTED');
  process.exit(1);
});
