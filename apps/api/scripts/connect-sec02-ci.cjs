// CI-only role bootstrap after migrations on a NEW disposable PostgreSQL18 database.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ROLE, MARKER } = require('./connect-sec02-target.cjs');
async function main() {
  let admin;
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
    const result = spawnSync('pnpm', ['--filter', '@vantara/api', 'test:connect-db'], { env, stdio: 'inherit' });
    if (result.status !== 0 || result.error) throw new Error();
  } catch { console.error('CONNECT_SEC02_CI_FAILED: inspect sanitized test evidence.'); process.exitCode = 1; }
  finally { try { await admin?.$disconnect(); } catch { process.exitCode = 1; } }
}
void main();
