// CI-only. The named PostgreSQL database is created empty in the disposable job.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { MARKER } = require('../../../infra/staging/showroom-policy.cjs');

const migrator = 'vantara_showroom_migrator';
const fixture = 'vantara_showroom_fixture';
const runtime = 'vantara_showroom_runtime';
const fixtureTables = ['tenants', 'properties', 'room_types', 'rooms', 'guests', 'users', 'memberships',
  'reservations', 'guest_requests', 'guest_connect_access'];
const runtimeRead = [...fixtureTables, 'sessions', 'subscriptions', 'guest_connect_bootstraps', 'guest_connect_sessions',
  'guest_connect_idempotency', 'notifications', 'notification_reads', 'housekeeping_tasks', 'maintenance_tickets', 'audit_logs'];
const runtimeInsert = ['sessions', 'guest_connect_access', 'guest_connect_bootstraps', 'guest_connect_sessions',
  'guest_connect_idempotency', 'guest_requests', 'housekeeping_tasks', 'notifications', 'notification_reads', 'audit_logs'];
const runtimeUpdate = ['guest_connect_access', 'guest_connect_bootstraps', 'guest_connect_sessions', 'guest_requests'];

function withRole(url, role, password) {
  const copy = new URL(url);
  copy.username = role;
  copy.password = password;
  return copy.toString();
}

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.GITHUB_ACTIONS !== 'true' || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/vantara_showroom' || url.hash || url.search !== '?schema=public') throw new Error('CI_TARGET_REJECTED');
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const passwords = new Map([migrator, fixture, runtime].map(role => [role, randomBytes(32).toString('hex')]));
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const name of Object.keys(env)) {
    if (/^(PG|PRISMA_|PILOT01_|STRIPE_|CONNECT_GUEST_)/.test(name) || name === 'DATABASE_URL') delete env[name];
  }

  try {
    await admin.$transaction(async tx => {
      const [db] = await tx.$queryRaw`
        SELECT current_database() AS name, current_setting('server_version_num')::integer AS version,
          (SELECT count(*)::integer FROM pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
            AND nspname NOT LIKE 'pg_%') AS extra_schemas,
          (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public') AS relations,
          shobj_description(d.oid, 'pg_database') AS marker
        FROM pg_database d WHERE d.datname = current_database()`;
      if (db.name !== 'vantara_showroom' || db.version < 180000 || db.version >= 190000 ||
          db.extra_schemas !== 0 || db.relations !== 0 || db.marker !== null) throw new Error('CI_TARGET_NOT_EMPTY');
      await tx.$executeRawUnsafe("SET LOCAL log_statement = 'none'");
      await tx.$executeRawUnsafe("SET LOCAL log_min_error_statement = 'panic'");
      await tx.$executeRawUnsafe('SET LOCAL log_min_duration_statement = -1');
      for (const [role, password] of passwords) {
        await tx.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      }
      await tx.$executeRawUnsafe(`ALTER DATABASE vantara_showroom OWNER TO ${migrator}`);
      await tx.$executeRawUnsafe('REVOKE ALL ON DATABASE vantara_showroom FROM PUBLIC');
      await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE vantara_showroom TO ${fixture}, ${runtime}`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${fixture}, ${runtime}`);
    });
    const migration = spawnSync('pnpm', ['--filter', '@vantara/api', 'exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...env, DATABASE_URL: withRole(url, migrator, passwords.get(migrator)) }, stdio: 'pipe',
    });
    if (migration.error || migration.status !== 0) throw new Error('CI_MIGRATOR_FAILED');
    console.log('SHOWROOM_ISOLATED_MIGRATION_PASS');

    await admin.$transaction(async tx => {
      for (const model of Prisma.dmmf.datamodel.models) {
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        if (await tx[delegate].count() !== 0) throw new Error('CI_TARGET_NOT_EMPTY');
      }
      const grant = (privileges, tables, role) => tx.$executeRawUnsafe(`GRANT ${privileges} ON ${tables.map(table => '"' + table + '"').join(', ')} TO ${role}`);
      await grant('SELECT, INSERT', fixtureTables, fixture);
      await grant('SELECT', runtimeRead, runtime);
      await grant('INSERT', runtimeInsert, runtime);
      await grant('UPDATE', runtimeUpdate, runtime);
      // PostgreSQL row locks need UPDATE on at least one column. Do not grant
      // role, tenant, assignment or password updates to the runtime.
      await grant('UPDATE ("createdAt")', ['tenants', 'memberships', 'sessions', 'reservations'], runtime);
      await grant('UPDATE ("readinessStatus", "updatedAt")', ['rooms'], runtime);
      await grant('DELETE', ['sessions'], runtime);
      await tx.$executeRawUnsafe(`COMMENT ON DATABASE vantara_showroom IS '${MARKER}'`);
    }, { timeout: 30000 });
    const result = spawnSync('pnpm', ['--filter', '@vantara/api', 'exec', 'jest', '--runInBand',
      '--runTestsByPath', 'src/security/showroom.integration.spec.ts'], {
      env: { ...env, SHOWROOM_CI_DB: withRole(url, runtime, passwords.get(runtime)),
        SHOWROOM_CI_FIXTURE_DB: withRole(url, fixture, passwords.get(fixture)) }, stdio: 'inherit',
    });
    if (result.error || result.status !== 0) throw new Error('CI_TEST_FAILED');
  } finally {
    await admin.$disconnect();
  }
}

void main().catch(error => {
  const code = ['CI_TARGET_REJECTED', 'CI_TARGET_NOT_EMPTY', 'CI_MIGRATOR_FAILED', 'CI_TEST_FAILED'].includes(error?.message) ? error.message : 'CI_SETUP_FAILED';
  console.error('SHOWROOM_CI_FAILED ' + code);
  process.exitCode = 1;
});
