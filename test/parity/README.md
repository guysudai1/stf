# Parity tests

The same contract tests run against two running STF servers.

| PARITY_TARGET | server | device | login |
|---|---|---|---|
| `old` (default) | http://127.0.0.1:7100 (fork, the specification) | emulator-5554 | guest |
| `new` | http://127.0.0.1:7200 (port) | emulator-5556 | guest, falling back to mock when `/auth/guest/` is absent |

Run (Node >= 22, no npm install; socket.io-client is loaded from the target's own repo; the old repo is expected next to this one, or set `PARITY_OLD_REPO`):

    PARITY_TARGET=old node --test --test-concurrency=1 'test/parity/api/*.test.mjs'
    PARITY_TARGET=new node --test --test-concurrency=1 'test/parity/api/*.test.mjs'
    PARITY_TARGET=old node --test test/parity/api/admin.test.mjs

The servers must already be running. Tests that hold the device take a cross-process lock, so files can run in parallel. Each test releases the devices it held.
Tests take a few minutes: device timeout tests wait for real timeouts, and the B1.3 test waits 90 s.
Never send `DELETE /users` without a body to a server: it selects every user.

## Browser parity tests (Playwright)

`test/parity/e2e/` runs the same behavioural specs against both UIs. Every selector and per-UI action (confirm dialog vs modal, hash routes `#!` vs `#`, tooltips, theme toggle, Apps pane, health level select) lives in `e2e/ui-map.mjs`; specs only call `ui.*`. Intended differences are tests named `(intended fix)` and assert the old behaviour on `old` and the new behaviour on `new`.

Playwright is taken from the old repo's `test/playwright/node_modules` (override with `PARITY_PLAYWRIGHT_DIR`); nothing is installed in this repo. Run from anywhere:

    PARITY_TARGET=old test/parity/e2e/run.sh
    PARITY_TARGET=new test/parity/e2e/run.sh
    PARITY_TARGET=new test/parity/e2e/run.sh ownership apps -g "force release"

`run.sh` only does `cd <old repo>/test/playwright && ./node_modules/.bin/playwright test -c test/parity/e2e/playwright.config.mjs "$@"`. Targets, ports and devices are the same as the API suite (old 7100/emulator-5554, new 7200/emulator-5556). Specs: guest, menu (header, logout, theme), timeout, shell-all, ownership, states, apps, keys, health.

Notes: every test logs in as a fresh guest (guests are admins) and the specs share one device, so they run serially (1 worker); do not run them in parallel with the API suite. Device tests start with a force release of any leftover owner, hold the device with a second browser user, and release it afterwards. The Provider ADB keys test adds one throwaway key (`parity-throwaway-*.adb_key`) and deletes exactly that file, also on failure. Shell commands are `echo` only.

## Test users

Every guest user a run creates (API `login`, raw auth POSTs, e2e `loginGuest` and page contexts) is recorded. At the end of the run exactly those users are bulk-deleted (`DELETE /api/v1/users`), after releasing any device they hold: API files on `beforeExit`, e2e in `globalTeardown` (list kept in `$TMPDIR/stf-parity-users-<target>-<pid>.txt`). A user cannot delete itself, so one janitor user per target remains after a run; its email is kept in `$TMPDIR/stf-parity-janitor-<target>.txt` and removed by the next run.
