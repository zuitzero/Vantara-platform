# Pilot 01 on the Mac mini

Use this runbook for the **existing** synthetic Pilot 01 database. The operations below check the current database and start local listeners. The browser rehearsal creates a demo session, link and request through the usual app. It requires an existing password and an unexpired CONFIRMED demo stay. If either prerequisite is missing, record it and review a database-specific recovery plan separately. Keep the current cluster and its data.

## Open clean shells and verify the existing listener

From the repository root, open a clean zsh in each terminal you use. This command preserves the working directory and selects Homebrew's Node 22 ahead of the general Homebrew bin directory. The general Node 26 installation on this Mac has had a missing dynamic library.

```sh
env -i PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/zsh -f
unsetopt XTRACE VERBOSE
command -v node
node --version
pnpm --version
git rev-parse HEAD
```

Expect Node `v22.x` and pnpm `10.15.0`. If Node fails to launch or reports a different major, repeat the clean-shell step before troubleshooting Postgres. If dependencies are missing on this checkout, use `pnpm install --frozen-lockfile` and `pnpm --filter @vantara/api exec prisma generate` with Node 22. Client generation writes generated code on disk.

```sh
/opt/homebrew/opt/postgresql@18/bin/postgres --version
lsof -nP -iTCP:55432 -iTCP:3000 -iTCP:3001 -sTCP:LISTEN -Fpcn
```

Inspect the owner of port 55432. It should be the known local `postgres` process on `127.0.0.1:55432`. To confirm its working directory, substitute the numeric PID from that listing in `lsof -a -p PID -d cwd -Fn` and compare it to the known isolated Pilot cluster on this Mac. A loopback address and a database marker cannot establish provenance on their own. A tunnel, unknown process or wrong directory means stop and inspect locally. If the listener is absent, locate the existing cluster and its operator-managed start procedure before proceeding. Starting the default Homebrew service can select a different cluster.

Terminal output from `lsof` above shows process names, addresses and PIDs, without full process arguments. For 3000 and 3001, confirm the previous processes in their own terminals before stopping anything. Use Ctrl+C in the terminal that started the known process. If the terminal is lost, confirm the PID and owner and use normal TERM for that specific process. Leave an unknown process alone.

## Terminal A · database check and API

Review ignored local dotenv files privately before starting a process, particularly Next's Web environment files. The normal rehearsal uses local transport, signup off, guest protocol flags empty, and no live credentials or provider integrations. Obtain the **existing** runtime URL from your local secret store. It must identify role `vantara_pilot01_demo`, database `vantara_pilot01` and port 55432, with host `127.0.0.1` and optional `schema=public`. The diagnostic also accepts `localhost` and normalizes it to IPv4, but use the literal IPv4 address in the runtime URL.

```sh
export NODE_ENV=development VANTARA_ENV=local PILOT01_DEMO=synthetic-local-only
export PORT=3001 WEB_ORIGIN=http://127.0.0.1:3000
export ALLOW_LOCAL_WORKSPACE_SIGNUP=false CONNECT_GUEST_HTTP= CONNECT_GUEST_POLICY_ACK=
read -rs 'DATABASE_URL?Existing Pilot runtime database URL: '
echo
export DATABASE_URL
read -rs 'PILOT01_PASSWORD?Existing demo login password to check (Return to skip): '
echo
export PILOT01_PASSWORD
pnpm --filter @vantara/api demo:check --database-only && (
  unset PILOT01_PASSWORD
  exec pnpm --filter @vantara/api dev
)
```

The check uses PostgreSQL `READ ONLY` and prints fixed labels. It verifies the live role, marker, PostgreSQL 18 and port, reads the legacy Connect generation column, and checks the two fixture memberships and current CONFIRMED stays. If supplied, it compares the existing password with the stored scrypt hash locally. This lookup creates no login session. The password comparison assumes the same existing Pilot password for both fixtures. When a check fails, leave the process stopped. After stopping the API, clear the terminal's secret variables with `unset DATABASE_URL PILOT01_PASSWORD`.

## Terminal B · Web

Use a fresh clean shell from the repository root. Keep the literal IPv4 host in every browser address so the Web origin and host-only cookie match the API WebSocket host.

```sh
export VANTARA_ENV=local WEB_ORIGIN=http://127.0.0.1:3000
export API_INTERNAL_URL=http://127.0.0.1:3001 NEXT_PUBLIC_API_URL=/api
export NEXT_PUBLIC_REALTIME_URL=http://127.0.0.1:3001
export CONNECT_GUEST_SHELL= CONNECT_GUEST_HTTP= CONNECT_GUEST_POLICY_ACK=
export NEXT_TELEMETRY_DISABLED=1
pnpm --filter @vantara/web dev --hostname 127.0.0.1 --port 3000
```

The normal Pilot API selects a loopback bind when started with the local Pilot flag above. The Web command supplies its loopback bind explicitly. Next development access logs omit the legacy Connect paths. Recheck the listeners with the constrained `lsof` command before opening a browser.

## Terminal C · read-only HTTP check

```sh
pnpm --filter @vantara/api demo:check --http-only
```

This sends GETs to the direct API and through Next. Both must return HTTP 200 with `status: ok` and `service: vantara-api` at **`/api/health`**. Nest mounts `HealthController` under the `api` global prefix. The check then expects anonymous `/api/auth/me` to return 401. Health measures the live HTTP route. Database and password results come from the separate read-only check.

| Signal | What to check |
| --- | --- |
| `LISTENER_UNREACHABLE` | Check the owning terminal and listener on the relevant port. API startup opens Prisma, so run the database check if Nest exits before listening. |
| Direct API OK, Web proxy fails | Check Next is running on 3000 and restart it with the exact `API_INTERNAL_URL` above. |
| `DB_LOCAL_CONFIGURATION_REJECTED` or `DB_IDENTITY_OR_ROLE_REJECTED` | Verify the existing cluster, role, marker, port and clean-shell settings privately. Keep connection overrides unset. |
| `DB_UNREACHABLE`, `DB_AUTH_OR_ACCESS_REJECTED` or `DB_SCHEMA_INCOMPLETE` | Check the known runtime credential and target. Escalate schema or privilege issues for operator review. |
| `PASSWORD_MISMATCH`, `ACCOUNT_OR_MEMBERSHIP_MISSING` or `NO_CURRENT_CONFIRMED_STAY` | Confirm the original credential and fixture state. Recovery is a separate, explicitly reviewed operation. |
| Login returns 403 or WebSocket upgrade fails | Use the exact IPv4 Web origin above. Login uses the same-origin Next rewrite. Socket.IO connects to API port 3001 with the Web Origin and staff cookie. A persisted notification may arrive even if realtime fails. |
| Browser login returns 401 | Confirm which Hotel A/B email and existing password were supplied. Check the read-only credential result against the API terminal's target. |
| Login returns 201 then browser `/api/auth/me` returns 401 | Check the same profile and host on both calls, that cookies are permitted and that the local session cookie was accepted. Inspect cookie attributes and HTTP statuses only. Keep cookie values, sensitive requests, HAR exports and screenshots private. |

## Founder rehearsal · record each result

Use two isolated browser profiles for staff A and B and a separate signed-out guest context. Two incognito windows in one browser can share their cookie jar. Visit `http://127.0.0.1:3000/onboarding` and choose **Sign in** with the original accounts `admin-a@pilot01.example.invalid` and `admin-b@pilot01.example.invalid`. Use existing passwords.

1. In Hotel A, open an unexpired **CONFIRMED** demo reservation and choose **Generate Connect link**. Open the legacy link privately in the guest context. This action may copy the bearer to the clipboard. Clear it after use and keep the address out of logs, screenshots and recordings.
2. From the guest view send one **HOUSEKEEPING** request titled **DEMO towels** with synthetic details. In Hotel A confirm the persisted notification and the matching request. Record the realtime toast separately.
3. In Hotel A use **Accept → Start work → Complete**. Leave the guest tab visible and wait for polling, then expand **History** and confirm completion. The housekeeping task has its own status.
4. In Hotel B refresh Requests and Notifications. Hotel A's request and notification should be absent.
5. Revoke the test link by generating a replacement for the **same** reservation. Existing issuance rotates the stored bearer and invalidates the old link. Check the old guest tab becomes unavailable, then close the guest contexts and clear the clipboard. This is the revocation path available in the existing UI. The separate administrative DELETE route is covered by CI.

Record the commit, timestamp and timezone, then **PASS / FAIL / NOT RUN** for staff login, issuance, request/notification, toast, status/polling/history, Hotel B isolation and old-link invalidation. Record statuses only. The founder browser rehearsal is **NOT RUN** until performed and recorded.

## Automated evidence and separate experiment

API Security CI checks real Nest HTTP, the prefixed health contract, read-only diagnostics, legacy login and Connect behavior against disposable PostgreSQL 18. Web CI checks transport and route builds. These cover code and HTTP behavior, while the founder checklist records the manual browser experience.

For experimental CONNECT-SEC-04 browser proof, use the **Connect persistence, Nest HTTPS and Chromium on PostgreSQL** step of API Security CI on a PR. That step prepares its own disposable `vantara_connect_sec02` database and TLS certificate, opts into the shell inside the harness and runs Chromium with certificate verification. It is separate from the Pilot CI database and the Mac mini rehearsal. See [the browser harness](security/CONNECT_SEC_04_BROWSER.md) and [API Security CI workflow](../.github/workflows/api-security-ci.yml).

The repository is reported public in issue #57. The founder should confirm intended visibility and review Git history for secrets before external sharing or deployment. [DEMO-02 issue](https://github.com/zuitzero/Vantara-platform/issues/57)
