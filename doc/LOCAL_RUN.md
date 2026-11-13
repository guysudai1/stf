# Running STF locally

For development and quick tests. For real deployments see the [Compose setup guide](../docker/compose/README.md).

## Build and run

Requirements are listed in the [README](../README.md#requirements). With RethinkDB running (`rethinkdb`):

```bash
npm ci
node build.mts build     # compile, translations, frontend bundle
stf local                # or: npm run local
```

`npm run local` first runs `node build.mts compile translate-compile`. `node build.mts compile` alone is enough to run the backend. STF is served on <http://localhost:7100>; add `--public-ip <ip>` to reach it from other machines.

The server also serves a guide for AI agents at <http://localhost:7100/agents.md> (and `/llms.txt`).

## Login

`stf local` uses `--auth-type guest` by default: the login page asks only for a nickname and every user is an administrator. Use `--auth-type mock|ldap|oauth2|saml2|openid` for the other methods. The guest auth unit can also be run on its own with `stf auth-guest`.

## ADB keys

Pass `--adb-keys-dir <folder>` to `stf local` or `stf api` to let administrators list, add and delete the provider's ADB private keys from Settings > Keys (or `/api/v1/adbkeys`, see [API.md](API.md)). Point the adb server at the same folder with the `ADB_VENDOR_KEYS` environment variable so it loads the keys:

```bash
ADB_VENDOR_KEYS=/path/to/keys adb start-server
stf local --adb-keys-dir /path/to/keys
```

## Remote ADB devices

The provider can scan a subnet for devices listening for ADB over TCP:

| Option | Meaning | Default |
|---|---|---|
| `--remote-adb-subnet` | IPv4 CIDR to scan (enables the scanner) | none |
| `--remote-adb-ports` | Comma-separated ports | `5555` |
| `--remote-adb-scan-interval` | Seconds between scans | `300` |

```bash
stf local --remote-adb-subnet 192.168.1.0/24 --remote-adb-ports 5555,5556
```

## Running a command on all devices

```bash
stf shell-all --token <admin-access-token> getprop ro.build.version.release
```

See `stf shell-all --help` (`--url`, `--force`, `--timeout`).

## Tests

```bash
npm run test:unit
npm run test:component
```

Parity tests against a running server are described in [test/parity/README.md](../test/parity/README.md).
