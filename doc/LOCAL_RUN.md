# Local STF with STFService.apk

This development setup runs the checked-out STF server with nickname-only
guest entry and the Android companion service on an emulator.

## Start the server

Install Node.js, Docker, ADB, RethinkDB support, and STF native dependencies.
From the `stf/` repository:

```bash
export PATH=/path/to/node/bin:/path/to/yarn/bin:$PATH
yarn install --ignore-optional --ignore-scripts
node_modules/.bin/bower install --allow-root
docker volume create stf-rethinkdb-data
docker run -d --name stf-rethinkdb \
  -p 28015:28015 -p 8080:8080 \
  -v stf-rethinkdb-data:/data \
  rethinkdb:2.4.2 rethinkdb --bind all --cache-size 512
./.github/scripts/start-stf.sh
```

The helper expects Docker access. After adding a user to the `docker` group,
start a new login session, or run a single command with `sg docker -c '...'`.
The RethinkDB container is stateful through the `stf-rethinkdb-data` volume;
reusing the container preserves the STF database between server restarts.

The helper waits for its internal services and serves the UI at
<http://127.0.0.1/> by default. This checkout uses `/auth/guest/`; enter a nickname
to create a local session. Set `STF_LOG_DIR` to choose the log directory.
Binding port 80 may require the usual host permission for privileged ports; use
`--port 7100` (or `STF_LOCAL_PORT=7100`) for an unprivileged development run.
The active nickname is shown in the STF header; select `Logout` there to clear
the guest session and return to nickname entry.

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
