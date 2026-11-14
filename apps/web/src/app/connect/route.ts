import { randomBytes } from 'node:crypto';
import { startGuestShell } from './shell-script';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
  const env = process.env;
  const origin = env.WEB_ORIGIN ?? '';
  const localHttps = /^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(origin);
  let host: string | undefined;
  if (localHttps) {
    try {
      const parsed = new URL(origin);
      if (parsed.origin === origin) host = parsed.host;
    } catch {
      // Malformed configuration leaves the route disabled.
    }
  }
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || env.VANTARA_ENV !== 'local' ||
      env.CONNECT_GUEST_SHELL !== 'synthetic-https-only' || env.CONNECT_GUEST_HTTP !== 'synthetic-https-only' ||
      env.CONNECT_GUEST_POLICY_ACK !== 'candidate-v1-synthetic-only' ||
      !host || request.headers.get('host') !== host) {
    return new Response('Not found.', { status: 404, headers });
  }
  if (request.url.includes('?')) return new Response('Open the original guest link.', { status: 400, headers });

  const nonce = randomBytes(24).toString('base64');
  // A Route Handler owns the whole document, including script order and CSP.
  // The only script is a self-contained function with no imports or guest data.
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<script nonce="${nonce}">(${startGuestShell.toString()})();</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vantara Connect</title><link rel="icon" href="data:,">
<style nonce="${nonce}">
:root { color-scheme: dark; font: 16px/1.5 system-ui, sans-serif; background: #101411; color: #edf3ed }
* { box-sizing: border-box }
main { max-width: 38rem; margin: auto; padding: 2rem 1rem }
h1, h2, p { margin: 0 0 1rem; overflow-wrap: anywhere }
section { background: #19201b; border: 1px solid #445148; border-radius: .75rem; padding: 1rem; margin-top: 1rem }
button, input, select, textarea { font: inherit; color: inherit; background: #26352b; border: 1px solid #778b7c; border-radius: .4rem; padding: .65rem; max-width: 100% }
button { cursor: pointer; min-height: 44px; margin: 0 .35rem .35rem 0 }
button:disabled { opacity: .65; cursor: wait }
form label { display: block; margin: .75rem 0 }
input, select, textarea { display: block; width: 100% }
textarea { min-height: 5rem }
li { overflow-wrap: anywhere; margin: .5rem 0 }
</style></head><body><main>
<h1>Vantara Connect</h1>
<p id="status" role="status">Preparing guest access…</p>
<noscript>Enable JavaScript to open guest access.</noscript>
<button id="confirm" type="button" hidden>Open my stay</button>
<button id="retry" type="button" hidden>Refresh stay</button>
<section id="stay" hidden aria-labelledby="stay-title">
<h2 id="stay-title">Your stay</h2><p id="details"></p>
<button id="logout" type="button">Sign out</button>
<form id="request">
<h2>Make a request</h2>
<label>Category <select name="category"><option value="FRONT_DESK">Front desk</option><option value="HOUSEKEEPING">Housekeeping</option><option value="MAINTENANCE">Maintenance</option><option value="OTHER">Other</option></select></label>
<label>Title <input name="title" required minlength="2" maxlength="120" autocomplete="off"></label>
<label>Details <textarea name="message" required minlength="2" maxlength="1000" autocomplete="off"></textarea></label>
<button id="send" type="submit">Send request</button>
</form>
<h2>Request history</h2><ul id="history"></ul>
</section></main></body></html>`, {
    headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
