// CI-only: no caller-provided endpoint, URL, credentials or certificate overrides.
const { PrismaClient, Prisma } = require('@prisma/client');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const engine = 'c2990dca591cba766e3b7ef5d9e8a84796e47ab7';
function check(ok, code) { if (!ok) throw new Error(code); }
function command(binary, args, env = process.env) {
  const result = spawnSync(binary, args, { env, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  check(!result.error && result.status === 0, 'TLS_FIXTURE_COMMAND_FAILED');
  return result.stdout.trim();
}
async function main() {
  check(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux' &&
    Prisma.prismaVersion.client === '6.19.3' && Prisma.prismaVersion.engine === engine &&
    !Object.keys(process.env).some(name => /^(DATABASE_URL|PRISMA_QUERY_ENGINE|PRISMA_CLIENT_ENGINE|PGSSL)/.test(name)),
  'TLS_ENGINE_OR_ENV_REJECTED');
  const dir = mkdtempSync(join(tmpdir(), 'vantara-tls-'));
  const password = randomBytes(32).toString('hex');
  const name = 'vantara-tls-' + randomBytes(8).toString('hex');
  const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password };
  let created = false;
  try {
    command('python3', [resolve('infra/staging/proof/tls-fixtures.py'), dir]);
    command('docker', ['create', '--name', name, '--publish', '127.0.0.1::5432',
      '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=synthetic_tls', '--user', 'root',
      'postgres:18-alpine', 'sh', '-c',
      'chown -R postgres:postgres /tls && chmod 600 /tls/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c log_statement=none -c log_min_error_statement=panic'], dockerEnv);
    created = true;
    const copy = label => command('docker', ['cp', join(dir, label) + '/.', name + ':/tls']);
    copy('valid');
    command('docker', ['start', name]);
    const port = () => command('docker', ['port', name, '5432/tcp']).split(':').at(-1);
    async function ready() {
      for (let i = 0; i < 60; i++) {
        const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'synthetic_tls'], { stdio: 'ignore', timeout: 5000 });
        if (result.status === 0) return;
        await sleep(500);
      }
      throw new Error('TLS_FIXTURE_NOT_READY');
    }
    await ready();
    function client(ca, hostname = 'localhost') {
      const url = new URL('postgresql://localhost/synthetic_tls');
      url.hostname = hostname; url.port = port(); url.username = 'postgres'; url.password = password;
      url.search = new URLSearchParams({ sslmode: 'require', sslaccept: 'strict', sslcert: join(dir, ca, 'ca.crt'),
        connect_timeout: '3', connection_limit: '1' }).toString();
      return new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    }
    async function succeeds(db) {
      const [row] = await db.$queryRawUnsafe('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
      check(row?.ssl === true, 'TLS_NOT_NEGOTIATED');
    }
    async function probe(id, ca, positive, hostname) {
      const db = client(ca, hostname);
      let ok = false;
      try { await succeeds(db); ok = true; } catch { /* Never emit native errors or URLs. */ }
      finally { await db.$disconnect(); }
      check(ok === positive, id + '_FAIL');
      console.log(id + ' PASS');
    }
    await probe('TLS01_CA_SAN', 'valid', true);
    await probe('TLS02_WRONG_CA', 'wrong', false);
    await probe('TLS03_WRONG_SAN', 'valid', false, '127.0.0.1');
    for (const [label, id] of [['expired-ca', 'TLS04_EXPIRED_CA'], ['expired-leaf', 'TLS05_EXPIRED_LEAF']]) {
      command('docker', ['stop', name]); copy(label); command('docker', ['start', name]); await ready();
      await probe(id, label, false);
    }
    command('docker', ['stop', name]); copy('valid'); command('docker', ['start', name]); await ready();
    // Existing client must reconnect after rotation; old trust must fail.
    const old = client('valid');
    await succeeds(old);
    await old.$disconnect();
    command('docker', ['stop', name]); copy('rotated'); command('docker', ['start', name]); await ready();
    let oldAccepted = false;
    try { await succeeds(old); oldAccepted = true; } catch {} finally { await old.$disconnect(); }
    check(!oldAccepted, 'TLS06_OLD_CA_ACCEPTED');
    console.log('TLS06_OLD_CA_RECONNECT PASS');
    await probe('TLS07_ROTATED_CA_RECONNECT', 'rotated', true);
    command('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'synthetic_tls', '-c', "ALTER SYSTEM SET ssl = 'off'"]);
    command('docker', ['restart', name]); await ready();
    await probe('TLS08_PLAINTEXT_ONLY', 'rotated', false);
    console.log('TLS_ENGINE ' + Prisma.prismaVersion.client + ' ' + engine);
    console.log('TLS_CA_SHA256 ' + createHash('sha256').update(readFileSync(join(dir, 'rotated/ca.crt'))).digest('hex'));
  } finally {
    if (created) command('docker', ['rm', '-f', '-v', name]);
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('PRISMA_TLS_PROOF FAIL'); process.exitCode = 1; });
