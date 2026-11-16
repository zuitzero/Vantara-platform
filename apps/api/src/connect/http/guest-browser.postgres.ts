import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { fork, spawnSync, ChildProcess } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import { AuthService } from '../../auth/auth.service';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { securityMiddleware } from '../../security/cloud-security';
import { GuestHttpService } from './guest-http.service';
import { configureGuestHttp, digest, GUEST_COOKIE } from './guest-http.security';
import { PostgresGuestAccessRepository } from '../persistence/guest-access.repository';
import { GUEST_PROTOCOL } from '../protocol/guest-access.contracts';

class AcceptanceCheck extends Error {}

function check(value: unknown, label: string): asserts value {
  if (!value) throw new AcceptanceCheck(label);
}

export function guestBrowserTests(database: () => PrismaClient) {
  describe('CONNECT-SEC-04 Chromium HTTPS acceptance', () => {
    let app: NestExpressApplication;
    let next: ChildProcess;
    let nextPort: number;
    let browser: any;
    let origin: string;
    let foreign: string;
    let foreignServer: ReturnType<typeof createServer>;
    let tmp: string;
    const savedEnv = { ...process.env };
    const logs: string[] = [];
    const secrets: string[] = [];
    const contexts: any[] = [];
    const opaque = () => randomBytes(32).toString('base64url');
    let stage = 'setup';

    beforeAll(async () => {
      check(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux', 'BROWSER_RUNNER_REJECTED');
      const certPath = process.env.CONNECT_SEC03_TLS_CERT!;
      const tls = { key: readFileSync(process.env.CONNECT_SEC03_TLS_KEY!), cert: readFileSync(certPath) };
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService).useValue(database()).compile();
      app = module.createNestApplication<NestExpressApplication>({ rawBody: true, httpsOptions: tls });
      app.useLogger({
        log: (...values: unknown[]) => logs.push(values.map(String).join(' ')),
        error: (...values: unknown[]) => logs.push(values.map(String).join(' ')),
        warn: (...values: unknown[]) => logs.push(values.map(String).join(' ')),
      });
      app.use((req: any, res: any, proceed: () => void) => {
        // Keep URL/Referer evidence in memory. Never capture request bodies or cookies.
        logs.push(req.originalUrl, req.headers.referer ?? '');
        const web = ['/', '/onboarding', '/connect'].includes(req.path) || req.path.startsWith('/_next/static/');
        if (!web) return proceed();
        if (req.path === '/connect' && req.originalUrl !== '/connect') return res.status(400).end();
        if (!nextPort) return res.status(503).end();
        const upstream = request({
          hostname: '127.0.0.1', port: nextPort, path: req.originalUrl, method: req.method,
          headers: { host: req.headers.host },
        }, reply => {
          res.writeHead(reply.statusCode!, reply.headers);
          reply.pipe(res);
        });
        upstream.on('error', () => res.status(503).end());
        upstream.end();
      });
      configureGuestHttp(app);
      app.use(securityMiddleware);
      app.setGlobalPrefix('api');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      origin = await app.getUrl();

      // Next dev sends React Flight debugging frames over its HMR WebSocket.
      // Only this disposable, same-origin path reaches the loopback Next listener.
      app.getHttpServer().on('upgrade', (incoming: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
        if (!incoming.url?.startsWith('/_next/hmr')) return;
        if (!nextPort || !/^\/_next\/hmr\?id=[A-Za-z0-9_-]{1,100}$/.test(incoming.url) ||
            incoming.headers.host !== new URL(origin).host || incoming.headers.origin !== origin ||
            incoming.headers.upgrade?.toLowerCase() !== 'websocket') {
          socket.destroy();
          return;
        }
        const upstream = request({
          hostname: '127.0.0.1', port: nextPort, path: incoming.url,
          headers: {
            host: incoming.headers.host,
            origin: incoming.headers.origin,
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-key': incoming.headers['sec-websocket-key'],
            'sec-websocket-version': incoming.headers['sec-websocket-version'],
          },
        });
        upstream.once('upgrade', (reply, peer, upstreamHead) => {
          const accept = reply.headers['sec-websocket-accept'];
          if (reply.statusCode !== 101 || typeof accept !== 'string') {
            peer.destroy();
            socket.destroy();
            return;
          }
          const close = () => { peer.destroy(); socket.destroy(); };
          socket.once('close', close).once('error', close);
          peer.once('close', close).once('error', close);
          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
          if (upstreamHead.length) socket.write(upstreamHead);
          if (head.length) peer.write(head);
          socket.pipe(peer).pipe(socket);
        });
        upstream.once('response', reply => { reply.resume(); socket.destroy(); });
        upstream.once('error', () => socket.destroy());
        upstream.end();
      });

      foreignServer = createServer(tls, (req, res) => {
        logs.push(req.url ?? '', req.headers.referer ?? '');
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.end('<!doctype html><title>Second origin</title><p>Second origin</p>');
      });
      await new Promise<void>(done => foreignServer.listen(0, '127.0.0.1', done));
      foreign = 'https://localhost:' + (foreignServer.address() as AddressInfo).port;

      Object.assign(process.env, {
        NODE_ENV: 'test', VANTARA_ENV: 'local', WEB_ORIGIN: origin,
        CONNECT_GUEST_HTTP: 'synthetic-https-only',
        CONNECT_GUEST_POLICY_ACK: 'candidate-v1-synthetic-only',
      });
      stage = 'next';
      next = fork(resolve('../web/scripts/connect-browser-next.cjs'), [], {
        env: {
          PATH: process.env.PATH, GITHUB_ACTIONS: 'true', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
          WEB_ORIGIN: origin, VANTARA_ENV: 'local', CONNECT_GUEST_HTTP: 'synthetic-https-only',
          CONNECT_GUEST_POLICY_ACK: 'candidate-v1-synthetic-only',
          CONNECT_GUEST_SHELL: 'synthetic-https-only', API_INTERNAL_URL: origin, NEXT_PUBLIC_REALTIME_URL: origin,
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      nextPort = await new Promise<number>((accept, reject) => {
        next.once('message', message => typeof message === 'number' ? accept(message) : reject(new Error('NEXT_PORT')));
        next.once('exit', () => reject(new Error('NEXT_EXIT')));
        next.once('error', () => reject(new Error('NEXT_START')));
      });
      stage = 'trust';
      tmp = mkdtempSync(join(tmpdir(), 'connect-browser-'));
      const nss = join(tmp, 'pki/nssdb');
      mkdirSync(nss, { recursive: true });
      for (const args of [['-N', '--empty-password'], ['-A', '-t', 'C,,', '-n', 'Synthetic Connect', '-i', certPath]]) {
        check(spawnSync('certutil', ['-d', 'sql:' + nss, ...args], { stdio: 'ignore' }).status === 0, 'BROWSER_CERT_TRUST');
      }
      stage = 'chromium';
      const { chromium } = require(process.env.CONNECT_SEC04_PLAYWRIGHT!);
      // Trust only the generated certificate in a temporary NSS database. Keep TLS and CSP enabled.
      browser = await chromium.launch({
        env: { PATH: process.env.PATH, XDG_DATA_HOME: tmp, XDG_CONFIG_HOME: tmp },
        ignoreDefaultArgs: ['--disable-back-forward-cache'],
      });
    }, 90000);

    afterEach(async () => {
      await Promise.all(contexts.splice(0).map(context => context.close()));
      check(!secrets.some(secret => logs.some(line => line.includes(secret))), 'BROWSER_SECRET_IN_SERVER_LOG');
    });
    afterAll(async () => {
      await browser?.close();
      next?.kill();
      foreignServer?.close();
      await app?.close();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
      process.env = savedEnv;
    });

    async function page(mobile = false) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        ...(mobile ? { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } : {}),
      });
      contexts.push(context);
      const tab = await context.newPage();
      tab.setDefaultTimeout(6500);
      return { context, tab };
    }

    async function issue(side = 'a') {
      const result = await app.get(GuestHttpService).issue('cs02-' + side, 'cs02-res-' + side);
      secrets.push(result.code);
      return result.code;
    }

    function acceptance(label: string, test: () => Promise<void>) {
      it(label, async () => {
        try { await test(); } catch (error) {
          // Playwright errors can contain credentials and URLs. Only our fixed checks are safe.
          const code = error instanceof AcceptanceCheck ? ' (' + error.message + ')' : '';
          throw new Error('BROWSER_ACCEPTANCE_FAILED at ' + stage + code);
        }
      }, 60000);
    }

    async function open(tab: any, code: string) {
      await tab.goto(origin + '/connect#code=' + code);
      await tab.getByRole('button', { name: 'Open my stay' }).waitFor();
      check(tab.url() === origin + '/connect', 'FRAGMENT_RETAINED');
      await tab.getByRole('button', { name: 'Open my stay' }).click();
    }

    acceptance('signs in a hotel staff user on mobile, syncs persisted unread and revokes their session', async () => {
      const checkpoint = (label: string) => {
        stage = label;
        console.info('STAFF_CHROMIUM ' + label);
      };
      checkpoint('staff fixture');
      const password = opaque();
      const salt = randomBytes(16).toString('hex');
      const fingerprint = createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex');
      const user = await database().user.create({ data: {
        name: 'Synthetic concierge', email: 'concierge@example.invalid', passwordHash: `scrypt:${salt}:${fingerprint}`,
        memberships: { create: { tenantId: 'cs02-a', role: 'HOTEL_STAFF' } },
      } });
      secrets.push(password);
      try {
        checkpoint('staff fixture auth and scope');
        const auth = app.get(AuthService);
        const proof = await auth.login({ email: user.email, password });
        secrets.push(proof.token);
        try {
          const workspace = await auth.getWorkspace(proof.token);
          check(workspace.membership.role === 'HOTEL_STAFF' && workspace.tenant.id === 'cs02-a', 'FIXTURE_SCOPE');
        } finally { await auth.logout(proof.token); }

        checkpoint('staff GET onboarding');
        const { tab, context } = await page(true);
        await context.route((url: URL) => url.origin !== origin, (route: any) => route.abort());
        const bootstrap = { scriptOk: 0, scriptDenied: 0, scriptFailed: 0, clientErrors: 0, chunkErrors: 0, sessionRequests: 0, hmrFrames: 0 };
        tab.on('response', (reply: any) => {
          if (reply.request().resourceType() !== 'script') return;
          if (reply.ok()) bootstrap.scriptOk++;
          else bootstrap.scriptDenied++;
        });
        tab.on('requestfailed', (request: any) => {
          if (request.resourceType() === 'script') bootstrap.scriptFailed++;
        });
        tab.on('request', (request: any) => {
          if (request.url() === origin + '/api/auth/me') bootstrap.sessionRequests++;
        });
        tab.on('websocket', (socket: any) => {
          if (new URL(socket.url()).pathname === '/_next/hmr') socket.on('framereceived', () => bootstrap.hmrFrames++);
        });
        tab.on('pageerror', (error: Error) => {
          bootstrap.clientErrors++;
          if (/chunk|dynamically imported module/i.test(error.message)) bootstrap.chunkErrors++;
        });
        const response = (path: string, method: string) => (res: any) =>
          res.url() === origin + path && res.request().method() === method;
        const onboardingAuth = tab.waitForResponse(response('/api/auth/me', 'GET')).catch(() => null);
        const onboarding = await tab.goto(origin + '/onboarding', { waitUntil: 'domcontentloaded' });
        check(onboarding?.status() === 200, 'ONBOARDING_HTTP_' + onboarding?.status());
        checkpoint('staff onboarding anonymous auth/me');
        const anonymous = await onboardingAuth;
        if (!anonymous) {
          const boot = await tab.evaluate(() => ({
            scripts: [...document.scripts].filter(script => script.src).length,
            loading: document.body.textContent?.includes('Loading authenticated setup') ?? false,
            expectedPage: document.querySelector('h1')?.textContent === 'Open your hotel workspace',
          }));
          throw new AcceptanceCheck('ANONYMOUS_RESPONSE_MISSING ' + JSON.stringify({ ...bootstrap, ...boot }));
        }
        check(anonymous.status() === 401, 'ANONYMOUS_HTTP_' + anonymous.status());
        check(bootstrap.hmrFrames > 0, 'NEXT_REACT_FLIGHT_WEBSOCKET_MISSING');

        checkpoint('staff email input');
        await tab.getByLabel('Email', { exact: true }).fill(user.email);
        checkpoint('staff password input');
        await tab.getByLabel('Password', { exact: true }).fill(password);
        checkpoint('staff submit and POST login');
        const observe = (path: string, method: string) => tab.waitForResponse(response(path, method), { timeout: 15000 }).catch(() => null);
        const login = observe('/api/auth/login', 'POST');
        const home = observe('/', 'GET');
        const session = observe('/api/auth/me', 'GET');
        await tab.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
        const signedIn = await login;
        check(signedIn, 'LOGIN_RESPONSE_MISSING');
        check(signedIn.status() === 201, 'LOGIN_HTTP_' + signedIn.status());

        checkpoint('staff Set-Cookie attributes');
        const header = await new Promise<string | null>((done) => {
          const timer = setTimeout(() => done(null), 5000);
          signedIn.headerValue('set-cookie').then((value: string | null) => {
            clearTimeout(timer);
            done(value);
          }, () => { clearTimeout(timer); done(null); });
        }) ?? '';
        check(/; HttpOnly(?:;|$)/i.test(header) && /; SameSite=Lax(?:;|$)/i.test(header) &&
          /; Path=\/(?:;|$)/i.test(header) && !/; Domain=/i.test(header), 'STAFF_COOKIE_ATTRIBUTES');
        const cookie = (await context.cookies(origin)).find((row: any) => row.name === 'vantara_session');
        if (cookie) secrets.push(cookie.value);
        check(cookie?.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/', 'STAFF_COOKIE_NOT_STORED');

        checkpoint('staff navigation to workspace');
        const workspacePage = await home;
        check(workspacePage, 'WORKSPACE_RESPONSE_MISSING');
        check(workspacePage.status() === 200, 'WORKSPACE_HTTP_' + workspacePage.status());
        checkpoint('staff workspace auth/me');
        const authenticated = await session;
        check(authenticated, 'SESSION_RESPONSE_MISSING');
        check(authenticated.status() === 200, 'SESSION_HTTP_' + authenticated.status());
        checkpoint('staff Command Center render');
        await tab.getByRole('heading', { name: /Synthetic/ }).waitFor({ timeout: 15000 });
        check(tab.url() === origin + '/', 'WORKSPACE_DESTINATION');

        // Inspect a completed request in the mounted document. An observation at
        // response headers can belong to a fetch cancelled during document navigation.
        checkpoint('staff authenticated role and tenant');
        const scope = await tab.evaluate(async () => {
          const response = await fetch('/api/auth/me', {
            credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(5000),
          });
          const body = response.ok ? await response.json() : null;
          return { status: response.status, staff: body?.membership?.role === 'HOTEL_STAFF', hotelA: body?.tenant?.id === 'cs02-a' };
        });
        check(scope.status === 200 && scope.staff && scope.hotelA, 'BROWSER_SESSION_SCOPE_' + scope.status);
        const nav = tab.getByRole('navigation', { name: 'Hotel modules' });
        check(!(await nav.getByText('Billing').count()), 'STAFF_BILLING_VISIBLE');
        check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'STAFF_MOBILE_OVERFLOW');

        checkpoint('persisted unread and request navigation');
        const item = await database().guestRequest.create({ data: {
          tenantId: 'cs02-a', propertyId: 'cs02-a-property', guestId: 'cs02-a-guest',
          title: 'Synthetic queue item', message: 'Example front desk handoff', category: 'FRONT_DESK',
        } });
        await database().notification.create({ data: {
          tenantId: 'cs02-a', audience: 'HOTEL', severity: 'INFO', channel: 'IN_APP', type: 'guest_request.created',
          title: 'Synthetic handoff', message: 'Open the queue', metadata: { requestId: item.id },
        } });
        await tab.getByRole('button', { name: 'Notifications' }).click();
        await tab.getByRole('button', { name: /Synthetic handoff/ }).click();
        await tab.getByRole('heading', { name: 'Synthetic queue item' }).waitFor();
        await tab.getByRole('button', { name: 'Notifications' }).click();
        await tab.getByText('No unread notifications.').waitFor();

        checkpoint('staff logout and back');
        await tab.getByRole('button', { name: 'Sign out', exact: true }).click();
        await tab.getByRole('heading', { name: 'Open your hotel workspace' }).waitFor();
        await tab.goto(origin + '/');
        await tab.getByText('Sign in to Vantara', { exact: true }).waitFor();
        check((await database().session.count({ where: { userId: user.id } })) === 0, 'STAFF_SESSION_NOT_REVOKED');
      } finally {
        await database().user.delete({ where: { id: user.id } });
      }
    });

    acceptance('walks the real two-hotel front desk, request and room turnover lifecycle', async () => {
      stage = 'operations fixtures';
      const password = opaque();
      const salt = randomBytes(16).toString('hex');
      const fingerprint = createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex');
      const passwordHash = `scrypt:${salt}:${fingerprint}`;
      const operationalUsers = [];
      secrets.push(password);
      const db = database();
      for (const side of ['a', 'b', 'maintenance']) {
        const user = await db.user.create({ data: {
          name: `Synthetic operations ${side}`, email: `operations-${side}@example.invalid`, passwordHash,
          memberships: { create: { tenantId: side === 'b' ? 'cs02-b' : 'cs02-a', role: side === 'maintenance' ? 'HOTEL_STAFF' : 'HOTEL_ADMIN' } },
        }, include: { memberships: true } });
        operationalUsers.push(user);
      }
      try {
        const [admin, other, technician] = operationalUsers;
        const now = Date.now();
        await db.subscription.create({ data: {
          tenantId: 'cs02-a', plan: 'LOBBY', status: 'TRIALING',
          trialStartedAt: new Date(now), trialEndsAt: new Date(now + 86400000),
        } });
        const housekeeping = await db.operationalStaff.create({ data: {
          tenantId: 'cs02-a', membershipId: admin.memberships[0].id, department: 'HOUSEKEEPING',
        } });
        const maintenance = await db.operationalStaff.create({ data: {
          tenantId: 'cs02-a', membershipId: technician.memberships[0].id, department: 'MAINTENANCE',
        } });
        const left = await page(), right = await page();
        for (const { context } of [left, right]) {
          await context.route((url: URL) => url.origin !== origin, (route: any) => route.abort());
        }
        const call = async (tab: any, path: string, expected = 200, method = 'GET', data?: unknown) => {
          const result = await tab.request.fetch(origin + '/api/' + path, {
            method, data, timeout: 5000, headers: { Origin: origin },
          });
          check(result.status() === expected, 'OPERATIONS_HTTP_' + path.split('/')[0] + '_' + result.status());
          return result.json();
        };
        stage = 'separate authenticated operations sessions';
        for (const [fixture, user] of [[left, admin], [right, other]] as const) {
          await call(fixture.tab, 'auth/login', 201, 'POST', { email: user.email, password });
          const cookie = (await fixture.context.cookies(origin)).find((row: any) => row.name === 'vantara_session');
          check(cookie?.httpOnly, 'OPERATIONS_COOKIE');
          secrets.push(cookie.value);
        }
        const a = left.tab, b = right.tab;
        check((await call(a, 'auth/me')).tenant.id === 'cs02-a' && (await call(b, 'auth/me')).tenant.id === 'cs02-b', 'OPERATIONS_SESSION_SCOPE');
        await call(b, 'auth/tenant/cs02-a', 401, 'POST');

        stage = 'inventory guest and reservation';
        const room = await call(a, 'rooms/properties/cs02-a-property', 201, 'POST', { number: '502', roomTypeId: 'cs02-a-type' });
        const guest = await call(a, 'guests', 201, 'POST', { firstName: 'Synthetic', lastName: 'Turnover', propertyId: 'cs02-a-property' });
        await call(b, 'guests/' + guest.id, 404);
        const stay = await call(a, 'reservations', 201, 'POST', {
          guestId: guest.id, propertyId: 'cs02-a-property', roomTypeId: 'cs02-a-type',
          checkIn: new Date(now - 3600000).toISOString(), checkOut: new Date(now + 86400000).toISOString(),
        });
        await call(b, 'reservations/' + stay.id, 404);
        await call(b, `reservations/${stay.id}/room`, 404, 'PATCH', { roomId: 'cs02-b-room' });
        await call(a, `reservations/${stay.id}/room`, 400, 'PATCH', { roomId: 'cs02-b-room' });
        await call(a, `reservations/${stay.id}/room`, 200, 'PATCH', { roomId: room.id });
        const status = (value: string, expected = 200) => call(a, `reservations/${stay.id}/status`, expected, 'PATCH', { status: value });
        await status('CONFIRMED');
        await call(a, `rooms/${room.id}/readiness`, 200, 'PATCH', { readinessStatus: 'OUT_OF_SERVICE' });
        await status('CHECKED_IN', 400);
        await call(a, `rooms/${room.id}/readiness`, 200, 'PATCH', { readinessStatus: 'READY' });
        await status('CHECKED_IN');
        const roomState = async () => (await call(a, 'rooms')).find((row: any) => row.id === room.id);
        const checkedIn = await roomState();
        check(checkedIn.occupancyStatus === 'OCCUPIED' && checkedIn.readinessStatus === 'READY', 'CHECK_IN_ROOM_STATE');

        stage = 'request lifecycle and hotel isolation';
        const request = await call(a, `requests/guests/${guest.id}`, 201, 'POST', {
          title: 'Synthetic towels', message: 'Two towels for the test stay', category: 'HOUSEKEEPING',
        });
        await call(b, 'requests/' + request.id, 404);
        await call(b, 'requests/' + request.id, 404, 'PATCH', { status: 'COMPLETED' });
        check((await call(b, 'notifications/unread')).every((row: any) => row.metadata?.requestId !== request.id), 'OPERATIONS_NOTIFICATION_SCOPE');
        for (const value of ['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED']) {
          await call(a, 'requests/' + request.id, 200, 'PATCH', { status: value });
        }
        const completed = await call(a, 'requests/' + request.id);
        const repeated = await call(a, 'requests/' + request.id, 200, 'PATCH', { status: 'COMPLETED' });
        check(completed.completedAt && repeated.completedAt === completed.completedAt, 'COMPLETED_TIME_CHANGED');
        await call(a, 'requests/' + request.id, 400, 'PATCH', { status: 'CREATED' });

        stage = 'checkout housekeeping and maintenance';
        await status('CHECKED_OUT');
        const dirty = await roomState();
        check(dirty.occupancyStatus === 'VACANT' && dirty.readinessStatus === 'CLEANING', 'CHECK_OUT_ROOM_STATE');
        const tasks = await call(a, 'housekeeping');
        const turnover = tasks.filter((item: any) => item.roomId === room.id && item.blocksRoom);
        check(turnover.length === 1 && tasks.some((item: any) => item.title === 'Synthetic towels' && !item.blocksRoom), 'CHECKOUT_WORK_LINK');
        await call(b, 'housekeeping/' + turnover[0].id, 404, 'PATCH', { status: 'COMPLETED' });
        await call(a, 'housekeeping/' + turnover[0].id, 200, 'PATCH', { assignedStaffId: housekeeping.id });
        for (const value of ['IN_PROGRESS', 'COMPLETED']) {
          await call(a, 'housekeeping/' + turnover[0].id, 200, 'PATCH', { status: value });
        }
        check((await roomState()).readinessStatus === 'READY', 'HOUSEKEEPING_READY_STATE');
        const repair = await call(a, 'maintenance', 201, 'POST', {
          roomId: room.id, title: 'Synthetic repair', description: 'Verify room readiness',
          blocksRoom: true, assignedStaffId: maintenance.id,
        });
        check((await roomState()).readinessStatus === 'MAINTENANCE', 'MAINTENANCE_ROOM_STATE');
        await call(b, 'maintenance/' + repair.id, 404, 'PATCH', { status: 'RESOLVED' });
        for (const value of ['IN_PROGRESS', 'RESOLVED']) {
          await call(a, 'maintenance/' + repair.id, 200, 'PATCH', { status: value });
        }
        const ready = await roomState();
        check(ready.readinessStatus === 'READY' && ready.occupancyStatus === 'VACANT', 'MAINTENANCE_READY_STATE');

        stage = 'operations dashboard and browser navigation';
        await a.goto(origin + '/', { waitUntil: 'domcontentloaded' });
        await a.getByRole('heading', { name: 'Stay pipeline' }).waitFor();
        await a.getByRole('heading', { name: 'Room readiness' }).waitFor();
        const modules = a.getByRole('navigation', { name: 'Hotel modules' });
        await a.getByRole('button', { name: 'Open rooms' }).click();
        await a.getByText('502', { exact: true }).waitFor();
        await modules.getByRole('button', { name: /Guests/ }).click();
        await a.getByText('Synthetic Turnover', { exact: true }).waitFor();

        stage = 'CRM tenant scope, profile retry and durable notes';
        await call(b, `guests/${guest.id}/crm`, 404);
        await call(b, `guests/${guest.id}/crm/notes`, 404, 'POST', { body: 'A foreign note must never persist' });
        await a.setViewportSize({ width: 360, height: 780 });
        const crmPath = '/api/guests/' + guest.id + '/crm';
        await a.route((url: URL) => url.pathname === crmPath, (route: any) => route.fulfill({ status: 503 }), { times: 1 });
        await modules.getByRole('button', { name: /CRM/ }).click();
        await a.getByRole('button', { name: /Synthetic Turnover/i }).click();
        const profile = a.locator('.crm-profile');
        await profile.getByRole('button', { name: 'Retry profile' }).click();
        await profile.getByRole('heading', { name: 'Synthetic Turnover' }).waitFor();
        await profile.getByLabel('Guest tags').fill('Synthetic return stay');
        await profile.getByLabel('Guest preferences').fill('arrival=quiet');
        await profile.getByRole('button', { name: 'Save guest memory' }).click();
        await profile.getByLabel('New CRM note').fill('Synthetic arrival follow-up');
        await profile.getByRole('button', { name: 'Add note' }).click();
        await profile.getByText('Synthetic arrival follow-up', { exact: true }).waitFor();
        const crm = await call(a, `guests/${guest.id}/crm`);
        check(crm.tags.some((tag: any) => tag.label === 'Synthetic return stay') &&
          crm.preferences.some((preference: any) => preference.key === 'arrival' && preference.value === 'quiet') &&
          crm.notes.some((note: any) => note.body === 'Synthetic arrival follow-up'), 'CRM_CHANGES_NOT_PERSISTED');

        stage = 'CRM guest switch discards unsaved former profile state';
        await profile.getByLabel('New CRM note').fill('Unsubmitted draft from the prior guest');
        await a.getByRole('button', { name: /SYNTHETIC SYNTHETIC/i }).click();
        await profile.getByRole('heading', { name: 'SYNTHETIC SYNTHETIC', exact: true }).waitFor();
        check(await profile.getByLabel('New CRM note').inputValue() === '', 'CRM_DRAFT_CROSSED_GUESTS');
        check(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'CRM_MOBILE_OVERFLOW');
        await b.goto(origin + '/', { waitUntil: 'domcontentloaded' });
        await b.getByRole('navigation', { name: 'Hotel modules' }).getByRole('button', { name: /Rooms/ }).click();
        await b.getByText('101', { exact: true }).waitFor();
        check(!(await b.getByText('502', { exact: true }).count()), 'OPERATIONS_BROWSER_TENANT_SCOPE');
      } finally {
        await db.housekeepingTask.updateMany({ where: { tenantId: 'cs02-a' }, data: { assignedStaffId: null } });
        await db.maintenanceTicket.updateMany({ where: { tenantId: 'cs02-a' }, data: { assignedStaffId: null } });
        await db.operationalStaff.deleteMany({ where: { membershipId: { in: operationalUsers.flatMap(user => user.memberships.map(membership => membership.id)) } } });
        await db.user.deleteMany({ where: { id: { in: operationalUsers.map(user => user.id) } } });
      }
    });

    acceptance('cleans the fragment before fetch and enforces CSP, cookie, navigation and retry behavior on mobile', async () => {
      stage = 'mobile landing';
      const { tab, context } = await page(true);
      await tab.goto(foreign);
      const code = await issue();
      const requests: string[] = [];
      tab.on('request', (req: any) => requests.push(req.url()));
      await tab.addInitScript(() => {
        const send = window.fetch;
        window.fetch = (...args) => {
          if (location.hash || location.search) throw new Error('UNCLEAN_FETCH');
          return send(...args);
        };
      });
      const response = await tab.goto(origin + '/connect#code=' + code);
      const csp = response.headers()['content-security-policy'];
      const nonce = csp?.match(/script-src 'nonce-([^']+)'/)?.[1];
      check(nonce && !/unsafe-inline|unsafe-eval/.test(csp), 'CSP_POLICY');
      await tab.getByRole('button', { name: 'Open my stay' }).waitFor();
      check(tab.url() === origin + '/connect' && requests.length === 1, 'PRE_CONFIRM_NETWORK');
      stage = 'CSP';
      check(await tab.evaluate(async () => {
        const blocked = new Promise<boolean>(resolve => {
          addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 1000);
        });
        const script = document.createElement('script');
        script.textContent = 'document.body.dataset.untrusted = "ran"';
        document.head.append(script);
        return await blocked && !document.body.dataset.untrusted;
      }), 'CSP_SCRIPT_RAN');
      stage = 'exchange and cookie';
      const exchange = tab.waitForResponse((res: any) => res.url() === origin + '/api/guest-connect/session');
      await tab.getByRole('button', { name: 'Open my stay' }).click();
      const cookieHeader = await (await exchange).headerValue('set-cookie');
      await tab.getByText(/SYNTHETIC-a/).waitFor();
      const cookie = (await context.cookies(origin)).find((row: any) => row.name === GUEST_COOKIE);
      check(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/' && !/domain=/i.test(cookieHeader ?? ''), 'COOKIE_FLAGS');
      secrets.push(cookie.value);
      check((await context.cookies(foreign)).length === 0, 'FOREIGN_COOKIE');
      check(await tab.evaluate(() => !document.cookie.includes('__Host-vantara_guest') &&
        localStorage.length === 0 && sessionStorage.length === 0 &&
        document.referrer === '' && history.state === null &&
        document.documentElement.scrollWidth <= innerWidth), 'BROWSER_STORAGE_OR_LAYOUT');

      stage = 'idempotent browser retry';
      await tab.evaluate(() => {
        const realFetch = window.fetch;
        let lost = false;
        window.fetch = async (input, init) => {
          const response = await realFetch(input, init);
          if (!lost && input === '/api/guest-connect/requests' && response.ok) {
            lost = true;
            throw new Error('Simulated lost response');
          }
          return response;
        };
      });
      await tab.getByLabel('Title').fill('Synthetic towels');
      await tab.getByLabel('Details').fill('Two towels please');
      await tab.getByRole('button', { name: 'Send request' }).click();
      await tab.getByText(/Could not confirm your request/).waitFor();
      await tab.getByRole('button', { name: 'Retry same request' }).click();
      await tab.getByText('Request sent.').waitFor();
      check(await database().guestRequest.count() === 1, 'DUPLICATE_REQUEST');
      stage = 'back, forward and reload';
      await tab.goBack();
      check(tab.url() === foreign + '/', 'BACK_HISTORY');
      await tab.goForward();
      await tab.getByText(/SYNTHETIC-a/).waitFor();
      check(tab.url() === origin + '/connect', 'FORWARD_FRAGMENT');
      const reload = await tab.reload();
      await tab.getByText(/SYNTHETIC-a/).waitFor();
      check(!reload.headers()['content-security-policy'].includes(nonce), 'NONCE_REUSED');
      check(requests.every(url => !url.includes(code) && [origin, foreign].includes(new URL(url).origin)), 'FRAGMENT_NETWORK');
      check(!logs.some(line => line.includes(code)) && !logs.includes(origin + '/connect'), 'REFERER_OR_URL_LEAK');
    });

    acceptance('rejects replay, expired access and foreign scope while separate devices retain their own sessions', async () => {
      stage = 'separate devices';
      const first = await page(), second = await page(), other = await page(), expired = await page();
      const code = await issue();
      await open(first.tab, code);
      await first.tab.getByText(/SYNTHETIC-a/).waitFor();
      await open(second.tab, code);
      await second.tab.getByText(/This link could not be opened/).waitFor();
      await open(second.tab, await issue());
      await second.tab.getByText(/SYNTHETIC-a/).waitFor();
      await open(other.tab, await issue('b'));
      await other.tab.getByText(/SYNTHETIC-b/).waitFor();
      check(!(await other.tab.locator('#details').textContent()).includes('SYNTHETIC-a'), 'TENANT_STAY');
      stage = 'foreign scope and Origin';
      const tenantStatus = await first.tab.evaluate(async () => (await fetch('/api/guest-connect/stay', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vantara-Guest': '1' },
        body: JSON.stringify({ reservationId: 'cs02-res-b' }),
      })).status);
      check(tenantStatus === 400, 'CLIENT_SCOPE_ACCEPTED');
      await other.tab.goto(foreign);
      check(await other.tab.evaluate(async (target: string) => {
        try {
          await fetch(target + '/api/guest-connect/stay', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Vantara-Guest': '1' }, body: '{}',
          });
          return false;
        } catch { return true; }
      }, origin), 'FOREIGN_ORIGIN_ACCEPTED');
      stage = 'expiry and logout';
      const expiring = opaque();
      secrets.push(expiring);
      const repo = new PostgresGuestAccessRepository(database(), { ...GUEST_PROTOCOL, bootstrapTtlMs: 1000 });
      await repo.createBootstrap({ tenantId: 'cs02-a', reservationId: 'cs02-res-a', codeHash: digest(expiring) });
      await new Promise(resolve => setTimeout(resolve, 1100));
      await open(expired.tab, expiring);
      await expired.tab.getByText(/This link could not be opened/).waitFor();
      const staffValue = opaque();
      secrets.push(staffValue);
      await first.context.addCookies([{ name: 'vantara_session', value: staffValue, url: origin, httpOnly: true, secure: true }]);
      await first.tab.getByRole('button', { name: 'Sign out' }).click();
      await first.tab.getByText('Signed out.').waitFor();
      check(!(await first.context.cookies(origin)).some((row: any) => row.name === GUEST_COOKIE), 'LOGOUT_COOKIE');
      check((await first.context.cookies(origin)).some((row: any) => row.name === 'vantara_session' && row.value === staffValue), 'STAFF_COOKIE_TOUCHED');
      await first.tab.reload();
      await first.tab.getByText(/Guest access is unavailable/).waitFor();
      await second.tab.reload();
      await second.tab.getByText(/SYNTHETIC-a/).waitFor();
      const secondCookie = (await second.context.cookies(origin)).find((row: any) => row.name === GUEST_COOKIE);
      secrets.push(secondCookie.value);
      await app.get(GuestHttpService).logout(secondCookie.value);
      await second.tab.reload();
      await second.tab.getByText(/Guest access is unavailable/).waitFor();
    });
  });
}
