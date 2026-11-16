import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { fork, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, request, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { configureShowroomApi, verifyShowroomDatabase, verifyShowroomOperator } from './showroom-security';

const { renderShowroom } = require('../../../../infra/staging/showroom-gateway.cjs');
const example = require('../../../../infra/staging/staging.example.json');
const integration = process.env.SHOWROOM_CI_DB ? describe : describe.skip;
let origin = example.publicOrigin as string;
let host = new URL(origin).host;
let gatewayPort: number;
let certificate: Buffer;
const key = randomBytes(32).toString('base64url');
const pathCanary = 'synthetic-' + randomBytes(32).toString('hex');
const payloadCanary = 'synthetic-' + randomBytes(24).toString('hex');
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }

function call(port: number, path: string, method = 'GET', headers: OutgoingHttpHeaders = {}, body?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const transport = port === gatewayPort ? httpsRequest : request;
    const req = transport({ host: '127.0.0.1', port, ca: certificate, servername: new URL(origin).hostname, path, method, headers: { Host: host, ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', chunk => { text += chunk; });
      res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body: text }));
    });
    req.setTimeout(4000, () => req.destroy());
    req.on('error', (error: NodeJS.ErrnoException) => {
      const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNKNOWN';
      fail(new Error('SHOWROOM_HTTP_FAILED ' + code));
    });
    req.end(body);
  });
}

function upgrade(port: number, requestOrigin = origin, proof?: string) {
  return new Promise<number>((done, fail) => {
    const transport = port === gatewayPort ? httpsRequest : request;
    const req = transport({ host: '127.0.0.1', port, ca: certificate, servername: new URL(origin).hostname, path: '/socket.io/?EIO=4&transport=websocket',
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
  let apiPort: number, webPort: number;
  let dir: string;
  let requestA: string, requestB: string;
  let guestCookie: string;
  let operatorPair: string, proofStay: string, foreignStay: string;
  const staff = new Map<string, string>();
  const previous = { ...process.env };
  const logs: string[] = [];
  const secrets = [key, pathCanary, payloadCanary];
  const password = randomBytes(24).toString('base64url');
  const proof = { 'X-Vantara-Showroom-Ingress': key };
  secrets.push(password);
  const forwarded = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '127.0.0.1' };

  beforeAll(async () => {
    const url = new URL(process.env.SHOWROOM_CI_DB!);
    check(process.env.GITHUB_ACTIONS === 'true' && url.protocol === 'postgresql:' &&
      url.hostname === '127.0.0.1' && url.pathname === '/vantara_showroom' &&
      url.username === 'vantara_showroom_runtime' && url.search === '?schema=public' && !url.hash,
    'SHOWROOM_CI_TARGET_REJECTED');
    db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    await verifyShowroomDatabase(db);
    check(await db.tenant.count() === 0, 'SHOWROOM_FIXTURES_NOT_EMPTY');

    const fixture = new URL(process.env.SHOWROOM_CI_FIXTURE_DB!);
    check(fixture.origin === url.origin && fixture.host === url.host && fixture.protocol === url.protocol &&
      fixture.pathname === url.pathname && fixture.search === url.search && !fixture.hash &&
      fixture.username === 'vantara_showroom_fixture', 'FIXTURE_ROLE_TARGET');
    const seed = new PrismaClient({ datasources: { db: { url: fixture.toString() } }, log: [] });
    try {
      for (const side of ['a', 'b']) {
        const tenant = await seed.tenant.create({ data: { name: 'SYNTHETIC', slug: 'cs05-' + side, type: 'HOTEL' } });
        const property = await seed.property.create({ data: { tenantId: tenant.id, name: 'SYNTHETIC' } });
        const guest = await seed.guest.create({ data: { tenantId: tenant.id, propertyId: property.id, firstName: 'SYNTHETIC', lastName: side } });
        const salt = randomBytes(16).toString('hex');
        await seed.user.create({ data: {
          email: side + '@example.invalid', name: 'SYNTHETIC',
          passwordHash: 'scrypt:' + salt + ':' + createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex'),
          memberships: { create: { tenantId: tenant.id, role: 'HOTEL_ADMIN' } },
        } });
        const item = await seed.guestRequest.create({ data: {
          tenantId: tenant.id, propertyId: property.id, guestId: guest.id, title: 'SYNTHETIC ' + side,
          message: 'SYNTHETIC only', category: 'OTHER',
        } });
        if (side === 'a') {
          requestA = item.id;
          const operator = await seed.user.create({ data: {
            email: 'operator@example.invalid', name: 'SYNTHETIC OPERATOR',
            passwordHash: 'scrypt:' + salt + ':' + createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex'),
            memberships: { create: { tenantId: tenant.id, role: 'HOTEL_STAFF' } },
          } });
          operatorPair = tenant.id + ':' + operator.id;
        } else requestB = item.id;
        const type = await seed.roomType.create({ data: { propertyId: property.id, name: 'SYNTHETIC', code: 'DEMO' } });
        const stay = await seed.reservation.create({ data: {
          tenantId: tenant.id, guestId: guest.id, propertyId: property.id, roomTypeId: type.id,
          confirmationCode: 'SYNTHETIC-' + side, status: 'CONFIRMED', checkIn: new Date(Date.now() - 1000),
          checkOut: new Date(Date.now() + 86400000),
        } });
        if (side === 'b') { foreignStay = stay.id; continue; }
        const room = await seed.room.create({ data: { propertyId: property.id, roomTypeId: type.id, number: '101' } });
        proofStay = (await seed.reservation.create({ data: {
          tenantId: tenant.id, guestId: guest.id, propertyId: property.id, roomTypeId: type.id,
          roomId: room.id, confirmationCode: 'SYNTHETIC-PROOF-A', status: 'CONFIRMED', checkIn: stay.checkIn, checkOut: stay.checkOut,
        } })).id;
        await seed.guestConnectAccess.create({ data: {
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

    } finally { await seed.$disconnect(); }

    const hostname = new URL(example.publicOrigin).hostname;
    dir = await mkdtemp(join(tmpdir(), 'showroom-ci-'));
    gatewayPort = await waitPort();
    origin = example.publicOrigin + ':' + gatewayPort;
    host = new URL(origin).host;
    const cert = join(dir, 'gateway.crt'), keyFile = join(dir, 'gateway.key');
    const createdKey = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyFile, '-out', cert, '-days', '1', '-subj', '/CN=' + hostname,
      '-addext', 'subjectAltName=DNS:' + hostname + ',IP:127.0.0.1'], { stdio: 'ignore' });
    check(createdKey.status === 0, 'DISPOSABLE_TLS_SETUP_FAILED');
    certificate = await readFile(cert);

    Object.assign(process.env, {
      NODE_ENV: 'production', VANTARA_ENV: 'staging', WEB_ORIGIN: origin,
      SHOWROOM_MODE: 'cloud-05a', SHOWROOM_DATA_MARKER: MARKER, SHOWROOM_INGRESS_KEY: key,
      SHOWROOM_GUEST_MODE: 'disposable-proof', SHOWROOM_REPLICAS: '1', SHOWROOM_GUEST_OPERATOR: operatorPair,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    api = module.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
    const config = configuration(process.env)!;
    verifyShowroomOperator(config);
    configureShowroomApi(api, config);
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
        SHOWROOM_GUEST_MODE: 'disposable-proof', SHOWROOM_REPLICAS: '1',
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

    const gatewayConfig = {
      ...example, publicOrigin: origin, apiEnvironment: { ...example.apiEnvironment, WEB_ORIGIN: origin },
      webEnvironment: { ...example.webEnvironment, WEB_ORIGIN: origin },
    };
    const nginxConfig = renderShowroom(gatewayConfig, { guestProof: true })
      .replace('http {', 'http {\n ssl_certificate ' + cert + ';\n ssl_certificate_key ' + keyFile + ';')
      .replaceAll('listen 8080', 'listen 127.0.0.1:' + gatewayPort + ' ssl')
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
    const validate = spawn(process.env.NGINX_BIN || 'nginx', ['-t', '-p', dir + '/', '-c', 'nginx.conf'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const diagnostic: Buffer[] = [];
    validate.stderr!.on('data', data => diagnostic.push(data));
    const [syntaxExit] = await once(validate, 'close');
    if (syntaxExit !== 0) {
      let summary = Buffer.concat(diagnostic).toString().replaceAll(dir, '<fixture-dir>').trim();
      for (const secret of secrets) summary = summary.replaceAll(secret, '<redacted>');
      throw new Error('SHOWROOM_NGINX_CONFIG ' + (summary || 'no diagnostic'));
    }
    nginx = runNginx();
    let observed: number | undefined;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (nginx.exitCode !== null) break;
      const response = await call(gatewayPort, '/api/health').catch(() => null);
      observed = response?.status;
      if (observed === status) return;
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('SHOWROOM_GATEWAY_START_FAILED expected=' + status + ' status=' + observed + ' exit=' + nginx.exitCode);
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

  it('denies runtime DDL, elevated roles, identity editing and billing access', async () => {
    const [row] = await db.$queryRaw<{ safe: boolean }[]>`
      SELECT NOT has_schema_privilege('public', 'CREATE')
        AND NOT has_column_privilege('memberships', 'role', 'UPDATE')
        AND NOT has_column_privilege('users', 'passwordHash', 'UPDATE')
        AND NOT has_table_privilege('users', 'INSERT')
        AND NOT has_table_privilege('stripe_webhook_events', 'SELECT')
        AND NOT has_table_privilege('_prisma_migrations', 'SELECT')
        AND NOT pg_has_role('vantara_showroom_migrator', 'MEMBER')
        AND NOT pg_has_role('vantara_showroom_fixture', 'MEMBER') AS safe`;
    check(row?.safe, 'RUNTIME_ROLE_CAN_ESCALATE');
  });

  it('requires gateway proof on both origins and permits only intended routes', async () => {
    check((await call(gatewayPort, '/')).status === 200, 'SHOWROOM_WEB_DENIED');
    check((await call(gatewayPort, '/onboarding')).status === 200, 'SHOWROOM_SIGNIN_PAGE_DENIED');
    const shell = await call(gatewayPort, '/connect');
    check(shell.status === 200 && shell.headers['content-security-policy'] &&
      shell.body.includes('two fresh towels') && !shell.body.includes('name="message"'), 'SHOWROOM_GUEST_SHELL_POLICY');
    check((await call(webPort, '/connect', 'GET', forwarded)).status === 404, 'DIRECT_GUEST_SHELL_OPEN');
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

  async function login(side: string) {
    const cached = staff.get(side);
    if (cached) return cached;
    const result = await call(gatewayPort, '/api/auth/login', 'POST',
      { Origin: origin, 'Content-Type': 'application/json' },
      JSON.stringify({ email: side + '@example.invalid', password }));
    const cookie = result.headers['set-cookie']?.[0];
    check(result.status === 201 && cookie && /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie) && !/Domain=/i.test(cookie),
      'SHOWROOM_STAFF_COOKIE');
    const pair = cookie.split(';')[0];
    secrets.push(pair.split('=')[1]);
    staff.set(side, pair);
    return pair;
  }

  it('keeps real staff auth and tenant scope, with no guest-to-staff authority', async () => {
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

  it('runs a fixed-path invitation, preset request, reissue and revocation through the real gateway', async () => {
    const common = { Origin: origin, 'Content-Type': 'application/json', 'X-Vantara-Guest': '1' };
    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      await new Promise(done => setTimeout(done, 110)); // Keep routine requests within the actual ingress budget.
      return call(gatewayPort, '/api/' + path, 'POST', { ...common, ...headers }, JSON.stringify(body));
    };
    const operator = { Cookie: await login('operator') }, admin = { Cookie: await login('a') };
    const issue = 'showroom-admission/issue', revoke = 'showroom-admission/revoke';
    const data = { reservationId: proofStay };
    const read = 'guest-connect/stay', exchange = 'guest-connect/session';
    const captureInvite = (response: { status: number; body: string }) => {
      check(response.status === 200, 'INVITE_ISSUE_' + response.status);
      const code = JSON.parse(response.body).code;
      check(/^[A-Za-z0-9_-]{43}$/.test(code), 'INVITE_CODE_SHAPE');
      secrets.push(code);
      return { code };
    };
    check((await post(issue, data, admin)).status === 403, 'GENERAL_ADMIN_GOT_INVITE_GRANT');
    check((await post(issue, { reservationId: foreignStay }, operator)).status === 401, 'FOREIGN_RESERVATION_INVITE');
    check((await post(issue, { ...data, tenantId: 'foreign' }, operator)).status === 400, 'BODY_TENANT_ACCEPTED');
    check((await post(issue, data, { ...operator, Origin: 'https://foreign.example.invalid' })).status === 403, 'OPERATOR_ORIGIN_BYPASS');
    check((await post(read, {}, { Cookie: guestCookie })).status === 401, 'LEGACY_GUEST_COOKIE_ACCEPTED');
    check((await call(apiPort, '/api/' + issue, 'POST', { ...common, ...operator }, JSON.stringify(data))).status === 404, 'DIRECT_ADMISSION_OPEN');
    const code = captureInvite(await post(issue, data, operator));
    const session = await post(exchange, code);
    const cookie = session.headers['set-cookie']?.[0];
    check(session.status === 200 && cookie && cookie.startsWith('__Host-vantara_guest=') &&
      /; Secure; HttpOnly; SameSite=Lax;/.test(cookie) && !/Domain=/i.test(cookie), 'GUEST_PROOF_COOKIE');
    const guest = { Cookie: cookie.split(';')[0] };
    const csrf = JSON.parse(session.body).csrfToken;
    secrets.push(guest.Cookie.split('=')[1], csrf);
    check((await post(exchange, code)).status === 401, 'SHOWROOM_EXCHANGE_REPLAY');
    check((await post(read, {}, { Cookie: guest.Cookie + '; ' + guest.Cookie })).status === 403, 'DUPLICATE_GUEST_COOKIE');
    check((await post(read, {}, guest)).body.includes('SYNTHETIC-PROOF-A'), 'WRONG_STAY_SCOPE');
    const submit = 'guest-connect/requests';
    const idempotencyKey = randomBytes(32).toString('base64url');
    const csrfHeaders = { ...guest, 'X-Vantara-CSRF': csrf, 'Idempotency-Key': idempotencyKey };
    secrets.push(idempotencyKey);
    check((await post(submit, { preset: 'TOWELS' }, guest)).status === 403, 'SHOWROOM_CSRF_BYPASS');
    check((await post(submit, { preset: 'TOWELS', message: payloadCanary }, csrfHeaders)).status === 401, 'SHOWROOM_FREE_TEXT_ACCEPTED');
    const first = await post(submit, { preset: 'TOWELS' }, csrfHeaders);
    const replay = await post(submit, { preset: 'TOWELS' }, csrfHeaders);
    check(first.status === 200 && replay.status === 200 && JSON.parse(first.body).id === JSON.parse(replay.body).id, 'SHOWROOM_IDEMPOTENCY');
    const newer = captureInvite(await post(issue, data, operator));
    check((await post(read, {}, guest)).status === 401, 'REISSUE_LEFT_SESSION_ACTIVE');
    check((await post(revoke, data, operator)).status === 200, 'SHOWROOM_REVOKE');
    check((await post(exchange, newer)).status === 401, 'REVOKED_INVITE_EXCHANGED');
  });

  it('guards a real Engine.IO Upgrade at both gateway and origin', async () => {
    check(await upgrade(gatewayPort) === 101, 'SHOWROOM_UPGRADE_DENIED');
    check(await upgrade(gatewayPort, 'https://foreign.example.invalid') === 404, 'FOREIGN_UPGRADE_ACCEPTED');
    check(await upgrade(apiPort) !== 101, 'DIRECT_UPGRADE_ACCEPTED');
    check(await upgrade(apiPort, 'https://foreign.example.invalid', key) !== 101, 'ORIGIN_UPGRADE_GUARD_BYPASSED');
  });
  it('runs the HTTPS fragment admission in Chromium without leaking the code to HTTP', async () => {
    let checkpoint = 'bootstrap';
    let browser: any;
    try {
      check(process.env.SHOWROOM_PLAYWRIGHT, 'SHOWROOM_CHROMIUM_MISSING');
      const { chromium } = require(process.env.SHOWROOM_PLAYWRIGHT);
      const nss = join(dir, 'pki', 'nssdb');
      await mkdir(nss, { recursive: true });
      for (const args of [['-N', '--empty-password'], ['-A', '-t', 'C,,', '-n', 'Disposable Showroom', '-i', join(dir, 'gateway.crt')]]) {
        check(spawnSync('certutil', ['-d', 'sql:' + nss, ...args], { stdio: 'ignore' }).status === 0, 'SHOWROOM_BROWSER_CERT');
      }
      const headers = { Cookie: await login('operator'), Origin: origin,
        'X-Vantara-Guest': '1', 'Content-Type': 'application/json' };
      const issue = () => call(gatewayPort, '/api/showroom-admission/issue', 'POST', headers, JSON.stringify({ reservationId: proofStay }));
      const issued = await issue();
      check(issued.status === 200, 'BROWSER_INVITE_REJECTED');
      const { code } = JSON.parse(issued.body);
      secrets.push(code);
      const hostname = new URL(origin).hostname;
      browser = await chromium.launch({
        args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + hostname + ' 127.0.0.1'],
        env: { PATH: process.env.PATH, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir },
      });
      const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await context.route((url: URL) => url.origin !== origin, (route: any) => route.abort());
      const tab = await context.newPage();
      tab.setDefaultTimeout(6000);
      const seen: { url: string; referer: string }[] = [];
      tab.on('request', (req: any) => seen.push({ url: req.url(), referer: req.headers().referer ?? '' }));
      checkpoint = 'fragment and CSP';
      const page = await tab.goto(origin + '/connect#code=' + code);
      const csp = page.headers()['content-security-policy'] ?? '';
      check(page.status() === 200 && csp.includes("connect-src 'self'") &&
        csp.includes("form-action 'none'") && !csp.includes("'unsafe-inline'"), 'SHOWROOM_BROWSER_CSP');
      const confirm = tab.getByRole('button', { name: 'Open my stay' });
      await confirm.waitFor();
      check(tab.url() === origin + '/connect' && seen.length === 1, 'SHOWROOM_BOOTSTRAP_BEFORE_CONFIRMATION');

      checkpoint = 'exchange and preset';
      await confirm.click();
      await tab.getByText(/SYNTHETIC-PROOF-A/).waitFor();
      const cookies = await context.cookies(origin);
      const guest = cookies.find((entry: any) => entry.name === '__Host-vantara_guest');
      if (guest) secrets.push(guest.value);
      check(guest?.secure && guest.httpOnly && guest.sameSite === 'Lax' && guest.domain === hostname &&
        !cookies.some((entry: any) => entry.name === 'vantara_session'), 'SHOWROOM_BROWSER_COOKIE');
      await tab.getByRole('button', { name: 'Send request' }).click();
      await tab.getByText('Request sent.', { exact: true }).waitFor();
      check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'SHOWROOM_MOBILE_WIDTH');

      checkpoint = 'reissue and replay';
      const renewed = await issue();
      check(renewed.status === 200, 'BROWSER_REISSUE_FAILED');
      secrets.push(JSON.parse(renewed.body).code);
      await tab.reload();
      await tab.getByText(/Guest access is unavailable/).waitFor();
      await tab.goto(origin + '/connect#code=' + code);
      await confirm.click();
      await tab.getByText(/This link could not be opened/).waitFor();
      check(seen.every(entry => !entry.url.includes(code) && !entry.referer.includes(code)), 'SHOWROOM_BROWSER_LEAK');
    } catch {
      // Browser errors may contain capability URLs or response details.
      throw new Error('SHOWROOM_CHROMIUM_FAILED at ' + checkpoint);
    } finally { await browser?.close(); }
  }, 30000);

  it('isolates authenticated staff WSS audiences and rejects a revoked session on reconnect', async () => {
    const { io } = require(require.resolve('socket.io-client', { paths: [resolve('../web')] }));
    const connect = (cookie: string) => io('https://127.0.0.1:' + gatewayPort + '/realtime', {
      path: '/socket.io', transports: ['websocket'], reconnection: false,
      ca: certificate, forceNew: true, extraHeaders: { Origin: origin, Host: host, Cookie: cookie },
    });
    const staffA = await login('a'), staffB = await login('b');
    const a = connect(staffA), b = connect(staffB);
    const notifications = api.get(NotificationsService);
    const gateway = api.get(NotificationsGateway);
    const tenantA = (await db.tenant.findUniqueOrThrow({ where: { slug: 'cs05-a' } })).id;
    const room = `tenant:${tenantA}:audience:HOTEL`;
    let foreign = 0;
    b.on('notification', () => foreign++);
    const waitForEvent = (client: any, event: string) => new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('WSS_' + event.toUpperCase() + '_MISSING')), 3000);
      client.once(event, () => { clearTimeout(timer); done(); });
    });
    try {
      await Promise.all([waitForEvent(a, 'connect'), waitForEvent(b, 'connect')]);
      for (let tries = 0; tries < 40 && !(await gateway.server.in(room).fetchSockets()).length; tries++) {
        await new Promise(done => setTimeout(done, 50));
      }
      check((await gateway.server.in(room).fetchSockets()).length === 1, 'WSS_TENANT_MEMBERSHIP');
      const ambiguous = connect(staffA + '; ' + staffA);
      try { await waitForEvent(ambiguous, 'disconnect'); }
      finally { ambiguous.disconnect(); }
      const event = { tenantId: tenantA, audience: 'HOTEL', severity: 'INFO', type: 'synthetic.wss',
        title: 'SYNTHETIC', message: 'SYNTHETIC' } as const;
      const delivered = waitForEvent(a, 'notification');
      await notifications.publish(event);
      await delivered;
      const logout = await call(gatewayPort, '/api/auth/logout', 'POST', { Cookie: staffA, Origin: origin });
      check(logout.status === 201, 'WSS_REVOKE_HTTP');
      const disconnected = waitForEvent(a, 'disconnect');
      await notifications.publish(event);
      await disconnected;
      const denied = connect(staffA);
      try {
        await waitForEvent(denied, 'disconnect');
        check((await gateway.server.in(room).fetchSockets()).length === 0, 'WSS_REVOKED_REJOINED');
      } finally { denied.disconnect(); }
      check(foreign === 0, 'WSS_FOREIGN_DELIVERY');
    } finally { a.disconnect(); b.disconnect(); }
  });

});
