// Only called by the disposable CI database step. Never run on Pilot or existing rows.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { MARKER } = require('../../../infra/staging/showroom-policy.cjs');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/vantara_showroom' || url.hash ||
      url.search !== '?schema=public') throw new Error('CI_TARGET_REJECTED');
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    const password = randomBytes(32).toString('hex');
    await admin.$transaction(async tx => {
      for (const model of Prisma.dmmf.datamodel.models) {
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        if (await tx[delegate].count() !== 0) throw new Error('CI_TARGET_NOT_EMPTY');
      }
      await tx.$executeRawUnsafe("SET LOCAL log_statement = 'none'");
      await tx.$executeRawUnsafe("SET LOCAL log_min_error_statement = 'panic'");
      await tx.$executeRawUnsafe('SET LOCAL log_min_duration_statement = -1');
      await tx.$executeRawUnsafe(`CREATE ROLE vantara_showroom_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      await tx.$executeRawUnsafe(`COMMENT ON DATABASE vantara_showroom IS '${MARKER}'`);
      await tx.$executeRawUnsafe('REVOKE ALL ON DATABASE vantara_showroom FROM PUBLIC');
      await tx.$executeRawUnsafe('GRANT CONNECT ON DATABASE vantara_showroom TO vantara_showroom_runtime');
      await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO vantara_showroom_runtime');
      for (const model of Prisma.dmmf.datamodel.models) {
        await tx.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${model.dbName}" TO vantara_showroom_runtime`);
      }
    }, { timeout: 30000 });
    url.username = 'vantara_showroom_runtime';
    url.password = password;
    const env = { ...process.env, SHOWROOM_CI_DB: url.toString(), NODE_ENV: 'test' };
    for (const key of Object.keys(env)) {
      if (/^(PG|PRISMA_|PILOT01_|STRIPE_|CONNECT_GUEST_)/.test(key) || key === 'DATABASE_URL') delete env[key];
    }
    const result = spawnSync('pnpm', ['--filter', '@vantara/api', 'exec', 'jest', '--runInBand',
      '--runTestsByPath', 'src/security/showroom.integration.spec.ts'], { env, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('CI_TEST_FAILED');
  } finally {
    await admin.$disconnect();
  }
}

void main().catch(() => {
  console.error('SHOWROOM_CI_FAILED');
  process.exitCode = 1;
});
