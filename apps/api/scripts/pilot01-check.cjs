// Read-only diagnostics for the existing Mac mini Pilot. Output uses fixed labels.
const { PrismaClient } = require('@prisma/client');
const { databaseConfiguration, ids, MARKER, matches } = require('./pilot01.cjs');
const { connectionSafety } = require('./pilot01-safety.cjs');

const API = 'http://127.0.0.1:3001';
const WEB = 'http://127.0.0.1:3000';

function macTarget(env) {
  const url = databaseConfiguration(env);
  if (env.VANTARA_ENV !== 'local' || url.hostname !== '127.0.0.1' || url.port !== '55432' || !url.password) {
    throw new Error('PILOT_MAC_TARGET_REJECTED');
  }
  url.searchParams.set('connect_timeout', '3');
  return url;
}

async function inspectDatabase(db, { port, address = '127.0.0.1', password }) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    await connectionSafety(tx);
    const [server] = await tx.$queryRaw`
      SELECT current_setting('server_version_num')::integer AS version,
        host(inet_server_addr()) AS address, inet_server_port() AS port
    `;
    if (server.version < 180000 || server.version >= 190000 ||
        server.address !== address || server.port !== port) {
      throw new Error('PILOT_SERVER_REJECTED');
    }
    // Legacy Connect issuance and reads use the generation column added in phase 2.
    await tx.guestConnectAccess.findFirst({ select: { generation: true } });
    const results = [];
    for (const side of ['a', 'b']) {
      const fixture = ids(side);
      const user = await tx.user.findUnique({
        where: { email: fixture.email },
        select: {
          id: true,
          ...(password ? { passwordHash: true } : {}),
          memberships: { select: { tenantId: true, role: true, tenant: { select: { type: true } } } },
        },
      });
      if (user?.id !== fixture.user || user.memberships.length !== 1 ||
          !user.memberships.some(m => m.tenantId === fixture.tenant &&
            m.role === 'HOTEL_ADMIN' && m.tenant.type === 'HOTEL')) {
        results.push('ACCOUNT_OR_MEMBERSHIP_MISSING');
        continue;
      }
      if (password && !matches(password, user.passwordHash)) {
        results.push('PASSWORD_MISMATCH');
        continue;
      }
      const stay = await tx.reservation.findFirst({
        where: { tenantId: fixture.tenant, notes: MARKER, status: 'CONFIRMED', checkOut: { gt: new Date() } },
        select: { id: true },
      });
      results.push(stay ? (password ? 'READY_PASSWORD_MATCH' : 'READY_PASSWORD_NOT_CHECKED') : 'NO_CURRENT_CONFIRMED_STAY');
    }
    return results;
  }, { timeout: 12000 });
}

async function checkHttp(origin) {
  let response;
  try {
    response = await fetch(origin + '/api/health', {
      redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    if ([502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      return 'UPSTREAM_UNAVAILABLE';
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return 'HEALTH_REJECTED';
    }
    const body = await response.json();
    if (body?.status !== 'ok' || body?.service !== 'vantara-api') return 'UNEXPECTED_HEALTH_RESPONSE';
  } catch {
    return response ? 'UNEXPECTED_HEALTH_RESPONSE' : 'LISTENER_UNREACHABLE';
  }
  try {
    const me = await fetch(origin + '/api/auth/me', {
      redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    await me.body?.cancel();
    return me.status === 401 ? 'HEALTH_OK_ANONYMOUS_DENIED' : 'UNEXPECTED_ANONYMOUS_SESSION';
  } catch {
    return 'SESSION_ENDPOINT_UNREACHABLE';
  }
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length > 3 || ![undefined, '--database-only', '--http-only'].includes(mode)) {
    console.error('Usage: demo:check [--database-only | --http-only]');
    process.exitCode = 1;
    return;
  }
  if (process.versions.node.split('.')[0] !== '22') {
    console.error('NODE22_REQUIRED: put the Homebrew node@22 bin directory first on PATH.');
    process.exitCode = 1;
    return;
  }
  console.log('Node 22: OK');
  if (mode !== '--http-only') {
    let db;
    try {
      const url = macTarget(process.env);
      const password = process.env.PILOT01_PASSWORD;
      if (password && (password.length < 16 || password.length > 128)) {
        throw new Error('PILOT_PASSWORD_FORMAT');
      }
      db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
      const results = await inspectDatabase(db, { port: 55432, password });
      console.log('PostgreSQL 18 / Pilot role and marker: OK');
      results.forEach((result, index) => console.log('Hotel ' + (index ? 'B' : 'A') + ': ' + result));
      if (results.some(result => !result.startsWith('READY_'))) process.exitCode = 1;
    } catch (error) {
      // Error objects may include connection strings or parameters.
      const code = error?.code ?? error?.errorCode;
      const reason = ['P1000', 'P1010'].includes(code) ? 'DB_AUTH_OR_ACCESS_REJECTED'
        : ['P1001', 'P1002'].includes(code) ? 'DB_UNREACHABLE'
        : ['P2021', 'P2022'].includes(code) ? 'DB_SCHEMA_INCOMPLETE'
        : code === 'P2010' && error?.meta?.code === '42501' ? 'DB_READ_PRIVILEGE_REJECTED'
        : ['DEMO_CONNECTION_REJECTED', 'PILOT_SERVER_REJECTED'].includes(error?.message) ? 'DB_IDENTITY_OR_ROLE_REJECTED'
        : ['DEMO_ENV_REQUIRED', 'DEMO_DATABASE_REQUIRED', 'DEMO_DATABASE_REJECTED',
            'DEMO_CONNECTION_OVERRIDE_REJECTED', 'DEMO_EXTERNAL_BILLING_FORBIDDEN',
            'PILOT_MAC_TARGET_REJECTED', 'PILOT_PASSWORD_FORMAT'].includes(error?.message)
          ? 'DB_LOCAL_CONFIGURATION_REJECTED' : 'DB_CHECK_FAILED';
      console.error(reason);
      process.exitCode = 1;
    } finally {
      try { await db?.$disconnect(); } catch { process.exitCode = 1; }
    }
  }
  if (mode !== '--database-only') {
    const results = await Promise.all([checkHttp(API), checkHttp(WEB)]);
    console.log('Direct API: ' + results[0]);
    console.log('Web proxy: ' + results[1]);
    if (results.some(result => result !== 'HEALTH_OK_ANONYMOUS_DENIED')) process.exitCode = 1;
  }
}

if (require.main === module) void main().catch(() => {
  console.error('PILOT_CHECK_FAILED');
  process.exitCode = 1;
});
module.exports = { inspectDatabase, macTarget, checkHttp };
