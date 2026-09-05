# Local STF with STFService.apk

This development setup runs the checked-out STF server with nickname-only
guest entry and the Android companion service on an emulator.

## Mandatory Docker Compose workflow

This checkout **must be run with Docker Compose**. Do not start the local STF
server with `stf local`, `npm run local`, or the legacy standalone RethinkDB
commands; those paths do not provide the required Docker ADB and RethinkDB
networking.

From this `stf/` repository, install Docker Engine with the Compose plugin and
make sure the Docker daemon is running. Docker access may be granted through
the `docker` group, but start a new login session after changing group
membership.

The Compose file builds the checked-out STF image and a small ADB relay image,
then starts three services:

- `rethinkdb` stores STF state on the persistent `rethinkdb-data` volume.
- `adb` runs the ADB server on the host network, connects to the local emulator
  or USB devices, and exposes the host ADB server to STF.
- `stf` runs on the host network so it can use the host ADB server and connects
  to RethinkDB at the fixed Compose address `172.18.0.2`.

Start the emulator or connect the Android device first. For an emulator, verify
that it has finished booting before handing ADB port 5037 to Compose:

```bash
adb -s emulator-5554 get-state
adb -s emulator-5554 shell getprop sys.boot_completed
adb kill-server
```

Start STF from the repository directory:

```bash
cd /path/to/stf
docker compose up -d --build
docker compose ps
```

The first build can take several minutes. Subsequent starts can use
`docker compose up -d`; use `--build` after changing STF source or either
Dockerfile. Open <http://127.0.0.1:7100/auth/guest/>, enter a nickname, and
select the device from the list. The dark-theme control is available from the
header and the Settings page.

Verify the ADB and STF layers independently:

```bash
docker compose exec adb adb -P 5037 devices -l
docker compose logs --tail=200 stf | \
  grep -E 'Found device|Registered device|Fully operational'
curl --fail http://127.0.0.1:7100/auth/guest/
```

For `emulator-5554`, the logs should contain `Found device`, `Registered
device`, and `Fully operational`. A device listed by the host ADB command alone
does not prove that STF has registered it.

Stop the stack without deleting the database:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete the
persistent RethinkDB data volume.

Both `adb` and `stf` use host networking. This is required for the local
emulator workflow, but it places STF's service ports directly on the host. Keep
this Compose setup on a trusted machine or restrict access with the host
firewall. No separate Docker bridge-to-host UFW relay rule is needed.

## Discover Wi-Fi ADB devices

The provider can probe one IPv4 subnet for ADB-over-TCP endpoints, connect its
configured ADB server to responsive ports, and repeat the scan. For example:

```bash
stf local \
  --remote-adb-subnet 192.168.1.0/24 \
  --remote-adb-ports 5555,9999 \
  --remote-adb-scan-interval 300
```

The same settings are available as `STF_LOCAL_REMOTE_ADB_SUBNET`,
`STF_LOCAL_REMOTE_ADB_PORTS`, and `STF_LOCAL_REMOTE_ADB_SCAN_INTERVAL` (or
the corresponding `STF_PROVIDER_*` variables for a standalone provider).
For a standalone provider, pass the same flags to `stf provider` together with
its usual `--connect-sub`, `--connect-push`, and `--storage-url` settings.
Ports are deduplicated, ordinary network and broadcast addresses are skipped,
and a scan is limited to 4,096 address-port combinations. A configured subnet
implicitly enables `--allow-remote`; this is logged by the provider because it
changes which ADB devices STF accepts.

The provider/container must have a route to the Wi-Fi subnet and TCP access to
each selected port. With Docker, use the appropriate host/network mode and
firewall rules; a container-local route or an ADB server in another network is
not sufficient. ADB-over-TCP is unauthenticated on many devices, so never
expose these ports to an untrusted network.

Local runs preserve device state between Usage sessions. Device cleanup is not
part of the provider or device lifecycle, so APKs and other device changes
remain installed after releasing and reclaiming a device.

To run the persistent APK regression against a real emulator, set the serial,
APK path, and package name before running the device Playwright suite:

```bash
STF_DEVICE_SERIAL=emulator-5554 \
STF_PERSISTENCE_APK=/path/to/test.apk \
STF_PERSISTENCE_PACKAGE=com.example.test \
npm --prefix test/playwright run test:device
```

## Install and start the companion

With an online emulator or device selected as `SERIAL`:

```bash
export ANDROID_HOME=/path/to/android-sdk
export ADB="$ANDROID_HOME/platform-tools/adb"
export SERIAL=emulator-5554
"$ADB" -s "$SERIAL" devices
"$ADB" -s "$SERIAL" install -r -t path/to/STFService.apk
"$ADB" -s "$SERIAL" shell am start-foreground-service --user 0 \
  -a jp.co.cyberagent.stf.ACTION_START \
  -n jp.co.cyberagent.stf/.Service
"$ADB" -s "$SERIAL" forward tcp:1100 localabstract:stfservice
```

In a dedicated terminal, start the ADB agent and then forward its socket:

```bash
APK=$("$ADB" -s "$SERIAL" shell pm path jp.co.cyberagent.stf |
  tr -d '\r' | awk -F: '{print $2}')
"$ADB" -s "$SERIAL" shell \
  "export CLASSPATH=$APK; exec app_process /system/bin jp.co.cyberagent.stf.Agent"
```

```bash
"$ADB" -s "$SERIAL" forward tcp:1090 localabstract:stfagent
```

The agent should report `Listening on @stfagent`. Recent Android versions may
reject the older `am startservice` command as a background-service start.

The companion has three separate readiness checks: the service must be
foregrounded, its `stfservice` socket must be forwarded on port 1100, and the
agent must be running with its `stfagent` socket forwarded on port 1090. A
successful APK install or a successful forward by itself does not prove that
the STF provider can operate the device.

## Verify

```bash
curl --fail http://127.0.0.1/auth/guest/
"$ADB" -s "$SERIAL" shell getprop sys.boot_completed
"$ADB" -s "$SERIAL" shell dumpsys activity services jp.co.cyberagent.stf
tail -f "$STF_LOG_DIR/stf-local.log"
```

The server log should contain `Found device` and `Registered device` for the
selected serial. A successful APK install or open ADB forward alone does not
prove STF registration.

For a complete readiness check, verify all of the following independently:

```bash
"$ADB" devices
"$ADB" -s "$SERIAL" get-state
"$ADB" -s "$SERIAL" shell getprop sys.boot_completed
"$ADB" -s "$SERIAL" shell dumpsys activity services jp.co.cyberagent.stf
curl --fail http://127.0.0.1/auth/guest/
```

The expected results are an online device, `device`, `1`, a running
`jp.co.cyberagent.stf/.Service`, and HTTP 200. Provider logs then need to show
both `Found device` and `Registered device`.

## Guest sessions and device state

The local guest flow is nickname-only. The nickname is shown in the STF header
after login, and `Logout` clears the signed guest session and returns to
`/auth/guest/`. Logout does not release or reset the emulator.

Device cleanup on release has been removed. Releasing a Usage session does not
uninstall APKs, clear configured folders, reset Bluetooth, or remove Bluetooth
bonds. This is intentional for the local workflow; direct uninstall or device
reset commands remain explicit user actions.

To prove APK persistence through STF rather than through a direct ADB install,
run the permanent Playwright regression with a compatible APK and its actual
package ID:

```bash
STF_DEVICE_SERIAL=emulator-5554 \
STF_PERSISTENCE_APK=/path/to/test.apk \
STF_PERSISTENCE_PACKAGE=com.example.test \
npm --prefix test/playwright run test:device -- --grep device_persistence
```

The check uploads and installs the APK through STF, releases the device,
claims it again, and verifies `pm path` still returns an installed `base.apk`.
Do not use `STFService.apk` as the persistence fixture because STFService is a
required companion package and is intentionally preserved by device setup.

## Public HTTP port

The local public frontend listens on HTTP port 80 by default. The internal
units remain on their separate development ports. Port 80 is privileged on
Linux, so an unprivileged development run can use `--port 7100` or
`STF_LOCAL_PORT=7100`; the CI helper sets its own port explicitly.

This setup does not provide HTTPS. Port 443 requires a TLS-terminating reverse
proxy or a separately configured certificate/key pair.

## Verified workspace setup

On 2026-09-01, this procedure was verified with RethinkDB 2.4.2, the checked-
out STF source, emulator `emulator-5554`, and the vendored artifact
`vendor/STFService/STFService.apk`. The guest endpoint returned HTTP 200, the
emulator registered, and the companion service was foregrounded with both
ADB forwards active.
