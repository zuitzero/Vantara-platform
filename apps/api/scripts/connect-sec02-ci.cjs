// CI-only role bootstrap after migrations on a NEW disposable PostgreSQL18 database.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes, createHash } = require('node:crypto');
const { mkdtempSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROLE, MARKER } = require('./connect-sec02-target.cjs');
async function main() {
  let admin, tlsDir;
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.GITHUB_ACTIONS !== 'true' || url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/vantara_connect_sec02' || url.hash || [...url.searchParams].some(([k,v]) => k !== 'schema' || v !== 'public')) throw new Error();
    url.hostname = '127.0.0.1';
    admin = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    const password = randomBytes(32).toString('hex');
    await admin.$transaction(async tx => {
      for (const model of Prisma.dmmf.datamodel.models) if (await tx[model.name[0].toLowerCase() + model.name.slice(1)].count() !== 0) throw new Error();
      await tx.$executeRawUnsafe("SET LOCAL log_statement = 'none'");
      await tx.$executeRawUnsafe("SET LOCAL log_min_error_statement = 'panic'");
      await tx.$executeRawUnsafe('SET LOCAL log_min_duration_statement = -1');
      // Constant identifiers and random hex only; never emit role SQL or credentials.
      await tx.$executeRawUnsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      await tx.$executeRawUnsafe(`COMMENT ON DATABASE vantara_connect_sec02 IS '${MARKER}'`);
      await tx.$executeRawUnsafe('REVOKE ALL ON DATABASE vantara_connect_sec02 FROM PUBLIC');
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE vantara_connect_sec02 TO ${ROLE}`);
      await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
      for (const model of Prisma.dmmf.datamodel.models) await tx.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${model.dbName}" TO ${ROLE}`);
    }, { timeout: 30000 });
    url.username = ROLE; url.password = password;
    const env = { ...process.env, NODE_ENV: 'test', CONNECT_SEC02_DB_TEST: '1', CONNECT_SEC02_DATABASE_URL: url.toString() };
    for (const key of Object.keys(env)) if (/^(PG|PILOT01_|STRIPE_|PRISMA_)/.test(key) || key === 'DATABASE_URL') delete env[key];
    tlsDir = mkdtempSync(join(tmpdir(), 'vantara-guest-tls-'));
    const key = join(tlsDir, 'key.pem'), cert = join(tlsDir, 'cert.pem');
    const tls = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
    if (tls.status !== 0) throw new Error();
    chmodSync(key, 0o600);
    env.CONNECT_SEC03_TLS_KEY = key; env.CONNECT_SEC03_TLS_CERT = cert;
    const result = spawnSync('pnpm', ['--filter', '@vantara/api', 'test:connect-db'], { env, stdio: 'inherit' });
    if (result.status !== 0 || result.error) throw new Error();
    const snapshot = async () => {
      const rows = [];
      // Sort serialized rows: NotificationRead has a composite key, not an id column.
      for (const model of Prisma.dmmf.datamodel.models) rows.push((await admin[model.name[0].toLowerCase() + model.name.slice(1)].findMany()).map(row => JSON.stringify(row)).sort());
      return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    };
    const before = await snapshot();
    const migration = spawnSync('pnpm', ['--filter', '@vantara/api', 'exec', 'prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    if (migration.status !== 0 || await snapshot() !== before) throw new Error();
    console.log('CONNECT_SEC03_POPULATED_MIGRATION_NOOP_PASS');
  } catch { console.error('CONNECT_SEC02_CI_FAILED: inspect sanitized test evidence.'); process.exitCode = 1; }
  finally { if (tlsDir) rmSync(tlsDir, { recursive: true, force: true }); try { await admin?.$disconnect(); } catch { process.exitCode = 1; } }
}
void main();
