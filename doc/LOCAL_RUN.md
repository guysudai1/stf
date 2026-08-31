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

The helper waits for its internal services and serves the UI at
<http://127.0.0.1:7100/>. This checkout uses `/auth/guest/`; enter a nickname
to create a local session. Set `STF_LOG_DIR` to choose the log directory.

Local runs preserve device state between Usage sessions. In particular, APKs
installed during a session remain installed after releasing the device. This
is the local command's default (`--no-cleanup`). Use `--cleanup` explicitly
when a disposable device reset is required; that mode removes packages added
after the provider starts when the device is released.

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

## Verify

```bash
curl --fail http://127.0.0.1:7100/auth/guest/
"$ADB" -s "$SERIAL" shell getprop sys.boot_completed
"$ADB" -s "$SERIAL" shell dumpsys activity services jp.co.cyberagent.stf
tail -f "$STF_LOG_DIR/stf-local.log"
```

The server log should contain `Found device` and `Registered device` for the
selected serial. A successful APK install or open ADB forward alone does not
prove STF registration.

## Verified workspace setup

On 2026-09-01, this procedure was verified with RethinkDB 2.4.2, the checked-
out STF source, emulator `emulator-5554`, and the vendored artifact
`vendor/STFService/STFService.apk`. The guest endpoint returned HTTP 200, the
emulator registered, and the companion service was foregrounded with both
ADB forwards active.
