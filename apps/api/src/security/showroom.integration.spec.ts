import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type OutgoingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { configureGuestHttp } from '../connect/http/guest-http.security';
import { GUEST_PROTOCOL } from '../connect/protocol/guest-access.contracts';
import { PostgresGuestAccessRepository } from '../connect/persistence/guest-access.repository';
import { configuration, MARKER } from '../../../../infra/staging/showroom-policy.cjs';
import { securityMiddleware } from './cloud-security';
import { configureShowroomApi, verifyShowroomDatabase } from './showroom-security';

const { renderShowroom } = require('../../../../infra/staging/showroom-gateway.cjs');
const example = require('../../../../infra/staging/staging.example.json');
const integration = process.env.SHOWROOM_CI_DB ? describe : describe.skip;
const origin = example.publicOrigin as string;
const host = new URL(origin).host;
const key = randomBytes(32).toString('base64url');
const pathCanary = 'synthetic-' + randomBytes(32).toString('hex');
const payloadCanary = 'synthetic-' + randomBytes(24).toString('hex');
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }

function call(port: number, path: string, method = 'GET', headers: OutgoingHttpHeaders = {}, body?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', chunk => { text += chunk; });
      res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body: text }));
    });
    req.setTimeout(4000, () => req.destroy());
    req.on('error', () => fail(new Error('SHOWROOM_HTTP_FAILED')));
    req.end(body);
  });
}

function upgrade(port: number, requestOrigin = origin, proof?: string) {
  return new Promise<number>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/socket.io/?EIO=4&transport=websocket',
      headers: {
        Host: host, Origin: requestOrigin, Upgrade: 'websocket', Connection: 'Upgrade',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13',
        ...(proof ? { 'X-Vantara-Showroom-Ingress': proof } : {}),
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); done(res.statusCode!); });
    req.on('response', res => { res.resume(); done(res.statusCode!); });
    req.on('error', () => fail(new Error('SHOWROOM_UPGRADE_FAILED')));
    req.setTimeout(4000, () => req.destroy());
    req.end();
  });
}

async function waitPort() {
  const probe = createServer();
  await new Promise<void>((done, fail) => probe.once('error', fail).listen(0, '127.0.0.1', done));
  const address = probe.address();
  check(address && typeof address !== 'string', 'SHOWROOM_PORT_FAILED');
  await new Promise<void>(done => probe.close(() => done()));
  return address.port;
}

integration('Showroom real Nginx, Next, Nest and disposable PostgreSQL', () => {
  let db: PrismaClient;
  let api: NestExpressApplication;
  let next: ChildProcess;
  let nginx: ChildProcess;
  let apiPort: number, webPort: number, gatewayPort: number;
  let dir: string;
  let requestA: string, requestB: string;
  let guestCookie: string;
  const previous = { ...process.env };
  const logs: string[] = [];
  const secrets = [key, pathCanary, payloadCanary];
  const password = randomBytes(24).toString('base64url');
  const proof = { 'X-Vantara-Showroom-Ingress': key };
  secrets.push(password);
  const forwarded = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': host, 'X-Forwarded-For': '127.0.0.1' };

  beforeAll(async () => {
    const url = new URL(process.env.SHOWROOM_CI_DB!);
    check(process.env.GITHUB_ACTIONS === 'true' && url.protocol === 'postgresql:' &&
      url.hostname === '127.0.0.1' && url.pathname === '/vantara_showroom' &&
      url.username === 'vantara_showroom_runtime' && url.search === '?schema=public' && !url.hash,
    'SHOWROOM_CI_TARGET_REJECTED');
    db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    await verifyShowroomDatabase(db);
    check(await db.tenant.count() === 0, 'SHOWROOM_FIXTURES_NOT_EMPTY');

    for (const side of ['a', 'b']) {
      const tenant = await db.tenant.create({ data: { name: 'SYNTHETIC', slug: 'cs05-' + side, type: 'HOTEL' } });
      const property = await db.property.create({ data: { tenantId: tenant.id, name: 'SYNTHETIC' } });
      const guest = await db.guest.create({ data: { tenantId: tenant.id, propertyId: property.id, firstName: 'SYNTHETIC', lastName: side } });
      const salt = randomBytes(16).toString('hex');
      await db.user.create({ data: {
        email: side + '@example.invalid', name: 'SYNTHETIC',
        passwordHash: 'scrypt:' + salt + ':' + createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex'),
        memberships: { create: { tenantId: tenant.id, role: 'HOTEL_ADMIN' } },
      } });
      const item = await db.guestRequest.create({ data: {
        tenantId: tenant.id, propertyId: property.id, guestId: guest.id, title: 'SYNTHETIC ' + side,
        message: 'SYNTHETIC only', category: 'OTHER',
      } });
      if (side === 'b') { requestB = item.id; continue; }
      requestA = item.id;
      const type = await db.roomType.create({ data: { propertyId: property.id, name: 'SYNTHETIC', code: 'DEMO' } });
      const stay = await db.reservation.create({ data: {
        tenantId: tenant.id, guestId: guest.id, propertyId: property.id, roomTypeId: type.id,
        confirmationCode: 'SYNTHETIC-A', status: 'CONFIRMED', checkIn: new Date(Date.now() - 1000),
        checkOut: new Date(Date.now() + 86400000),
      } });
      await db.guestConnectAccess.create({ data: {
        tenantId: tenant.id, reservationId: stay.id, tokenHash: digest(pathCanary), expiresAt: stay.checkOut,
      } });
      // Mint only in the isolated test repository. The hosted HTTP adapter stays off.
      const repository = new PostgresGuestAccessRepository(db, GUEST_PROTOCOL);
      const code = randomBytes(32).toString('base64url'), guestSecret = randomBytes(32).toString('base64url');
      secrets.push(code, guestSecret);
      await repository.createBootstrap({ tenantId: tenant.id, reservationId: stay.id, codeHash: digest(code) });
      await repository.exchangeOnce({ codeHash: digest(code), freshSessionHash: digest(guestSecret) });
      guestCookie = '__Host-vantara_guest=' + guestSecret;
    }

    Object.assign(process.env, {
      NODE_ENV: 'production', VANTARA_ENV: 'staging', WEB_ORIGIN: origin,
      SHOWROOM_MODE: 'cloud-05a', SHOWROOM_DATA_MARKER: MARKER, SHOWROOM_INGRESS_KEY: key,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    api = module.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
    configureShowroomApi(api, configuration(process.env)!);
    configureGuestHttp(api);
    api.use(securityMiddleware);
    api.setGlobalPrefix('api');
    api.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await api.listen(0, '127.0.0.1');
    const address = api.getHttpServer().address();
    check(address && typeof address !== 'string', 'SHOWROOM_API_PORT_FAILED');
    apiPort = address.port;

    next = fork(resolve('../web/scripts/showroom-server.cjs'), [], {
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', VANTARA_ENV: 'staging', WEB_ORIGIN: origin,
        SHOWROOM_MODE: 'cloud-05a', SHOWROOM_DATA_MARKER: MARKER, SHOWROOM_INGRESS_KEY: key,
        API_INTERNAL_URL: example.apiUpstream, PORT: '0', NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    capture(next);
    webPort = await new Promise<number>((done, fail) => {
      next.once('message', value => typeof value === 'number' ? done(value) : fail(new Error('SHOWROOM_NEXT_PORT')));
      next.once('exit', () => fail(new Error('SHOWROOM_NEXT_START_FAILED')));
      next.once('error', () => fail(new Error('SHOWROOM_NEXT_START_FAILED')));
    });

    dir = await mkdtemp(join(tmpdir(), 'showroom-ci-'));
    gatewayPort = await waitPort();
    const nginxConfig = renderShowroom(example).replaceAll('listen 8080', 'listen 127.0.0.1:' + gatewayPort)
      .replaceAll(example.webUpstream, 'http://127.0.0.1:' + webPort)
      .replaceAll(example.apiUpstream, 'http://127.0.0.1:' + apiPort);
    await writeFile(join(dir, 'nginx.conf'), nginxConfig);
    // An absent private include prevents startup. A wrong proof reaches a closed origin.
    nginx = runNginx();
    const [missingExit] = await once(nginx, 'exit');
    check(missingExit !== 0, 'GATEWAY_STARTED_WITHOUT_INCLUDE');
    await startGateway(randomBytes(32).toString('base64url'), 404);
    await stop(nginx);
    await startGateway(key, 200);
  }, 45000);

  function capture(child: ChildProcess) {
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => logs.push(String(chunk)));
  }

  function runNginx() {
    const child = spawn(process.env.NGINX_BIN || 'nginx', ['-p', dir + '/', '-c', 'nginx.conf', '-g', 'daemon off;'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    capture(child);
    return child;
  }

  async function startGateway(credential: string, status: number) {
    secrets.push(credential);
    await writeFile(join(dir, 'showroom-ingress.inc'),
      'proxy_set_header X-Vantara-Showroom-Ingress "' + credential + '";\n', { mode: 0o600 });
    nginx = runNginx();
    for (let attempt = 0; attempt < 80; attempt++) {
      if (nginx.exitCode !== null) break;
      const response = await call(gatewayPort, '/api/health').catch(() => null);
      if (response?.status === status) return;
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('SHOWROOM_GATEWAY_START_FAILED');
  }

  async function stop(child: ChildProcess | undefined) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }

  afterAll(async () => {
    try {
      await stop(nginx);
      await stop(next);
      await api?.close();
      await db?.$disconnect();
      if (dir) logs.push(await readFile(join(dir, 'access.log'), 'utf8').catch(() => ''));
      const observed = logs.join('');
      check(!secrets.some(secret => observed.includes(secret)), 'SHOWROOM_LOG_CANARY_LEAK');
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
      process.env = previous;
    }
  });

  it('requires gateway proof on both origins and permits only intended routes', async () => {
    check((await call(gatewayPort, '/')).status === 200, 'SHOWROOM_WEB_DENIED');
    check((await call(gatewayPort, '/onboarding')).status === 200, 'SHOWROOM_SIGNIN_PAGE_DENIED');
    check((await call(gatewayPort, '/connect')).status === 404, 'SHOWROOM_GUEST_SHELL_OPEN');
    check((await call(gatewayPort, '/api/health', 'GET', { 'X-Vantara-Showroom-Ingress': payloadCanary })).status === 200, 'GATEWAY_DID_NOT_REPLACE_PROOF');
    check((await call(gatewayPort, '/api/health', 'GET', { Host: 'alternate.example.invalid', ...proof })).status === 404, 'ALTERNATE_HOST_ACCEPTED');
    check((await call(apiPort, '/api/health', 'GET', forwarded)).status === 404, 'DIRECT_API_ACCEPTED');
    check((await call(webPort, '/', 'GET', { ...forwarded, 'X-Vantara-Showroom-Ingress': payloadCanary })).status === 404, 'DIRECT_WEB_ACCEPTED');
    check((await call(webPort, '/api/health', 'GET', proof)).status === 404, 'WEB_PROXY_BYPASS');
    const page = await call(gatewayPort, '/');
    const asset = page.body.match(/\/_next\/static\/[^"' ]+\.js/)?.[0];
    check(asset && (await call(gatewayPort, asset)).status === 200, 'SHOWROOM_NEXT_ASSET_DENIED');
  });

  it('rejects legacy, encoded, malformed and unknown targets without redirect or reflection', async () => {
    const paths = [
      '/connect/' + pathCanary, '/connect/%2f' + pathCanary, '/connect?code=' + pathCanary,
      '/api/connect/' + pathCanary, '/api/connect/' + pathCanary + '/requests',
      '/api/%63onnect/' + pathCanary, '/api//health', '/api/x/../health', '/api/health/',
      '/api/%68ealth', '/api/%ZZhealth', '/api/health?' + pathCanary, '/api/billing/webhooks/stripe',
      '/api/onboarding/workspace', '/api/guest-connect/session', '/api/guests', '/unknown',
      '/api/connect-admin/reservations/' + requestA + '/access',
      '/api/connect-admin/reservations/' + requestA + '/bootstrap',
    ];
    for (const [index, path] of paths.entries()) {
      for (const [port, headers] of [[gatewayPort, {}], [apiPort, proof], [webPort, proof]] as const) {
        const method = [4, 11, 12, 13, 16, 17].includes(index) ? 'POST' : 'GET';
        const result = await call(port, path, method, { ...headers, Referer: payloadCanary });
        check([400, 404].includes(result.status) && !result.headers.location &&
          !result.body.includes(pathCanary) && !result.body.includes(payloadCanary), 'SHOWROOM_ROUTE_REFLECTION_' + index);
      }
    }
    check((await call(gatewayPort, paths[16], 'DELETE')).status === 404, 'LEGACY_REVOKE_OPEN');
    check((await call(gatewayPort, '/api/health', 'POST')).status === 404, 'METHOD_NOT_ENFORCED');
  });

  it('keeps real staff auth and tenant scope, with no guest-to-staff authority', async () => {
    const login = async (side: string) => {
      const result = await call(gatewayPort, '/api/auth/login', 'POST',
        { Origin: origin, 'Content-Type': 'application/json' },
        JSON.stringify({ email: side + '@example.invalid', password }));
      const cookie = result.headers['set-cookie']?.[0];
      check(result.status === 201 && cookie && /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie) && !/Domain=/i.test(cookie),
        'SHOWROOM_STAFF_COOKIE');
      const pair = cookie.split(';')[0];
      secrets.push(pair.split('=')[1]);
      return pair;
    };
    const staffA = await login('a'), staffB = await login('b');
    for (const [cookie, allowed, foreign] of [[staffA, requestA, requestB], [staffB, requestB, requestA]]) {
      check((await call(gatewayPort, '/api/requests/' + allowed, 'GET', { Cookie: cookie })).status === 200, 'OWN_REQUEST_DENIED');
      check((await call(gatewayPort, '/api/requests/' + foreign, 'GET', { Cookie: cookie })).status === 404, 'FOREIGN_REQUEST_READ');
      check((await call(gatewayPort, '/api/requests/' + foreign, 'PATCH',
        { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
        '{"status":"COMPLETED"}')).status === 404, 'FOREIGN_REQUEST_MUTATION');
    }
    check((await call(gatewayPort, '/api/requests', 'GET', { Cookie: guestCookie })).status === 401, 'GUEST_COOKIE_ACCEPTED_AS_STAFF');
    check((await call(gatewayPort, '/api/auth/logout', 'POST', { Cookie: staffA, Origin: 'https://foreign.example.invalid' })).status === 403, 'ORIGIN_GUARD_BYPASSED');
    check((await call(gatewayPort, '/api/guest-connect/stay', 'GET', { Cookie: staffA })).status === 404, 'GUEST_MODE_ACTIVATED');
  });

  it('guards a real Engine.IO Upgrade at both gateway and origin', async () => {
    check(await upgrade(gatewayPort) === 101, 'SHOWROOM_UPGRADE_DENIED');
    check(await upgrade(gatewayPort, 'https://foreign.example.invalid') === 404, 'FOREIGN_UPGRADE_ACCEPTED');
    check(await upgrade(apiPort) !== 101, 'DIRECT_UPGRADE_ACCEPTED');
    check(await upgrade(apiPort, 'https://foreign.example.invalid', key) !== 101, 'ORIGIN_UPGRADE_GUARD_BYPASSED');
  });
});
