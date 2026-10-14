// CI-only bootstrap: after existing migrations on a NEW disposable PostgreSQL service.
// Application/demo tooling never creates roles, grants privileges or marks databases.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DATABASE_MARKER, DATABASE_ROLE, emptyDatabase, dataModels } = require('./pilot01-safety.cjs');
async function main() {
  let admin;
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.GITHUB_ACTIONS !== 'true' || url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/vantara_pilot01' || url.hash || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error('CI_TARGET_REJECTED');
    admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const password = randomBytes(32).toString('hex');
    await admin.$transaction(async tx => {
      await emptyDatabase(tx);
      // Session-only log controls on the disposable CI service. Never log role SQL.
      await tx.$executeRawUnsafe("SET LOCAL log_statement = 'none'");
      await tx.$executeRawUnsafe("SET LOCAL log_min_error_statement = 'panic'");
      await tx.$executeRawUnsafe('SET LOCAL log_min_duration_statement = -1');
      // All identifiers are constants/schema-owned; password is generated hex.
      await tx.$executeRawUnsafe(`CREATE ROLE ${DATABASE_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      await tx.$executeRawUnsafe(`COMMENT ON DATABASE vantara_pilot01 IS '${DATABASE_MARKER}'`);
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE vantara_pilot01 TO ${DATABASE_ROLE}`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${DATABASE_ROLE}`);
      for (const model of Prisma.dmmf.datamodel.models) {
        const name = model.name[0].toLowerCase() + model.name.slice(1);
        const permissions = dataModels.has(name) ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT';
        await tx.$executeRawUnsafe(`GRANT ${permissions} ON TABLE "${model.dbName}" TO ${DATABASE_ROLE}`);
      }
    }, { timeout: 30000 });
    url.username = DATABASE_ROLE; url.password = password;
    const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test', PILOT01_DEMO: 'synthetic-local-only' };
    for (const key of Object.keys(env)) if (/^(PG|PRISMA_|STRIPE_)/.test(key)) delete env[key];
    const result = spawnSync('pnpm', ['--filter', '@vantara/api', 'test:pilot'], { env, stdio: 'inherit' });
    if (result.status !== 0 || result.error) throw new Error('CI_PILOT_FAILED');
  } catch {
    // Never print SQL/connection/error objects containing generated credentials.
    console.error('Pilot 01 CI bootstrap or regression failed; inspect sanitized test results.');
    process.exitCode = 1;
  } finally { try { await admin?.$disconnect(); } catch { process.exitCode = 1; } }
}
void main();
