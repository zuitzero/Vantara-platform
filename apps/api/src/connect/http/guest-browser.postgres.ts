import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { fork, spawnSync, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { securityMiddleware } from '../../security/cloud-security';
import { GuestHttpService } from './guest-http.service';
import { configureGuestHttp, digest, GUEST_COOKIE } from './guest-http.security';
import { PostgresGuestAccessRepository } from '../persistence/guest-access.repository';
import { GUEST_PROTOCOL } from '../protocol/guest-access.contracts';

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
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
        if (req.path !== '/connect') return proceed();
        if (req.originalUrl !== '/connect') return res.status(400).end();
        if (!nextPort) return res.status(503).end();
        const upstream = request({
          hostname: '127.0.0.1', port: nextPort, path: '/connect', method: req.method,
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
          CONNECT_GUEST_SHELL: 'synthetic-https-only', API_INTERNAL_URL: origin,
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
        try { await test(); } catch {
          // Playwright errors can contain URL fragments, cookies and request data.
          throw new Error('BROWSER_ACCEPTANCE_FAILED at ' + stage);
        }
      }, 60000);
    }

    async function open(tab: any, code: string) {
      await tab.goto(origin + '/connect#code=' + code);
      await tab.getByRole('button', { name: 'Open my stay' }).waitFor();
      check(tab.url() === origin + '/connect', 'FRAGMENT_RETAINED');
      await tab.getByRole('button', { name: 'Open my stay' }).click();
    }

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
