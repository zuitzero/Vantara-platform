// Serialized into the first inline script by the /connect Route Handler.
// Keep this function self-contained. Values from the API only reach text nodes.
export function startGuestShell() {
  function takeFragment() {
    const hash = location.hash;
    history.replaceState(null, '', '/connect');
    return /^#code=([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(hash)?.[1];
  }

  // This is synchronous and precedes DOM setup, fetch and every resource reference.
  const hadFragment = Boolean(location.hash);
  const trusted = location.protocol === 'https:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !location.search;
  let code: string | undefined;
  let cleaned = false;
  try {
    code = takeFragment();
    cleaned = true;
  } catch {
    // A browser that disallows history replacement must never send the fragment.
  }

  document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('status')!;
    const confirm = document.getElementById('confirm') as HTMLButtonElement;
    const retry = document.getElementById('retry') as HTMLButtonElement;
    const stay = document.getElementById('stay')!;
    const details = document.getElementById('details')!;
    const logout = document.getElementById('logout') as HTMLButtonElement;
    const form = document.getElementById('request') as HTMLFormElement;
    const send = document.getElementById('send') as HTMLButtonElement;
    const historyList = document.getElementById('history')!;
    const lifetime = new AbortController();
    let csrf: string | undefined;
    let pending: { key: string; payload: { title: string; message: string; category: string } } | undefined;
    let busy = false;

    function resetRequest(resetFields: boolean) {
      pending = undefined;
      if (resetFields) form.reset();
      send.textContent = 'Send request';
      for (const field of form.querySelectorAll('input, textarea, select')) {
        (field as HTMLInputElement).disabled = false;
      }
    }

    function clearStay() {
      csrf = undefined;
      resetRequest(true);
      stay.hidden = true;
      details.textContent = '';
      historyList.replaceChildren();
    }

    addEventListener('pagehide', () => {
      lifetime.abort();
      code = undefined;
      confirm.hidden = true;
      clearStay();
    });
    addEventListener('pageshow', (event) => {
      if (event.persisted) location.replace('/connect');
    });

    if (!trusted || !cleaned) {
      code = undefined;
      status.textContent = 'Open this link over local HTTPS.';
      return;
    }

    addEventListener('hashchange', () => {
      try {
        code = takeFragment();
        confirm.hidden = !code;
        if (code) status.textContent = 'Confirm to open your stay.';
      } catch {
        code = undefined;
        confirm.hidden = true;
        lifetime.abort();
        clearStay();
      }
    });

    async function post(path: 'session' | 'stay' | 'requests' | 'logout', body: object, headers = {}) {
      if (location.hash || location.search) throw new Error('Address changed.');
      return fetch('/api/guest-connect/' + path, {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'X-Vantara-Guest': '1', ...headers },
        body: JSON.stringify(body),
        signal: lifetime.signal,
      });
    }

    async function run(action: () => Promise<void>, failure: string) {
      if (busy || lifetime.signal.aborted) return;
      busy = true;
      for (const button of [confirm, retry, logout, send]) button.disabled = true;
      try {
        await action();
      } catch {
        if (!lifetime.signal.aborted) status.textContent = failure;
      } finally {
        busy = false;
        for (const button of [confirm, retry, logout, send]) button.disabled = false;
      }
    }

    async function refresh() {
      const response = await post('stay', {});
      if (lifetime.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          clearStay();
          status.textContent = 'Guest access is unavailable. Ask the front desk for a new link.';
          return;
        }
        throw new Error('Stay unavailable.');
      }
      const { reservation, requests, csrfToken } = await response.json();
      if (lifetime.signal.aborted) return;
      if (csrf && csrf !== csrfToken) resetRequest(true);
      csrf = csrfToken;
      details.textContent = reservation.property.name + ' · ' + reservation.confirmationCode +
        (reservation.room ? ' · Room ' + reservation.room.number : '');
      historyList.replaceChildren();
      for (const request of requests) {
        const item = document.createElement('li');
        item.textContent = request.title + ' · ' + request.status.replaceAll('_', ' ');
        historyList.append(item);
      }
      if (!requests.length) {
        const item = document.createElement('li');
        item.textContent = 'No requests yet.';
        historyList.append(item);
      }
      stay.hidden = false;
      status.textContent = 'Guest access is active.';
    }

    function refreshStay() {
      retry.hidden = false;
      void run(refresh, 'Could not refresh your stay. Try again.');
    }

    confirm.onclick = () => {
      if (!code) return;
      void run(async () => {
        const oneUseCode = code;
        code = undefined;
        confirm.hidden = true;
        clearStay();
        const response = await post('session', { code: oneUseCode });
        if (lifetime.signal.aborted) return;
        if (!response.ok) {
          status.textContent = 'This link could not be opened. Ask the front desk for a new link.';
          return;
        }
        retry.hidden = false;
        await refresh();
      }, 'Could not confirm guest access. Refresh your stay or ask for a new link.');
      retry.hidden = false;
    };
    retry.onclick = refreshStay;

    form.onsubmit = (event) => {
      event.preventDefault();
      if (!csrf) return;
      void run(async () => {
        if (!pending) {
          const data = new FormData(form);
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const key = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
          pending = { key, payload: {
            title: String(data.get('title')).trim(),
            message: String(data.get('message')).trim(),
            category: String(data.get('category')),
          } };
          for (const field of form.querySelectorAll('input, textarea, select')) {
            (field as HTMLInputElement).disabled = true;
          }
          send.textContent = 'Retry same request';
        }
        const response = await post('requests', pending.payload, {
          'X-Vantara-CSRF': csrf, 'Idempotency-Key': pending.key,
        });
        if (lifetime.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          clearStay();
          await refresh();
          if (!lifetime.signal.aborted && !stay.hidden) status.textContent = 'Request declined. Review the details and try again.';
          return;
        }
        if (response.status === 400 || response.status === 409 || response.status === 413) {
          resetRequest(false);
          status.textContent = 'Review your request and try again.';
          return;
        }
        if (!response.ok) throw new Error('Request unavailable.');
        resetRequest(true);
        await refresh();
        if (!lifetime.signal.aborted && !stay.hidden) status.textContent = 'Request sent.';
      }, 'Could not confirm your request. Retry the same request or check request history.');
    };

    logout.onclick = () => {
      if (!csrf) return;
      void run(async () => {
        const response = await post('logout', {}, { 'X-Vantara-CSRF': csrf });
        if (!response.ok) throw new Error('Sign-out unavailable.');
        if (lifetime.signal.aborted) return;
        code = undefined;
        confirm.hidden = true;
        clearStay();
        status.textContent = 'Signed out.';
      }, 'Could not sign out. Try again.');
    };

    if (code) {
      status.textContent = 'Confirm to open your stay.';
      confirm.hidden = false;
    } else if (hadFragment) {
      status.textContent = 'This link is invalid. Ask the front desk for a new link.';
      retry.hidden = false;
    } else {
      refreshStay();
    }
  });
}
