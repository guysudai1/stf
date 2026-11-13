# STF guide for AI agents

You are looking at a Smartphone Test Farm (STF) server: a shared pool of real and emulated Android devices that people and programs reserve, control and release over HTTP. This guide is served by the server itself and describes how to drive it.

- App: {{APP_URL}}
- REST API: {{API_URL}} (swagger JSON at {{API_URL}}/swagger.json)
- Websocket: {{WEBSOCKET_URL}}
- Login: {{AUTH_URL}}

This copy of the guide is public. It contains no account, token or device data.

## Ground rules

- Devices are shared with humans. Someone may be using a device right now.
- On this server every user is an administrator, so the API will not stop you from doing damage. These rules are yours to keep.
- Prefer read-only calls. Look before you claim.
- Only claim a device you need, and always release what you claim, also when your task fails. Always send `timeout` when claiming, so a crash of yours frees the device on its own.
- Never take or force-release a device held by someone else unless the person who instructed you said so.
- Do not loop on the API. Poll no faster than once every few seconds. There is no rate limiting, only your manners.

## Authentication

Every API call needs `Authorization: Bearer <token>`. Replace `$TOKEN` below with yours.

Getting a token:

1. A human creates one in the web UI: Settings > Keys > Access Tokens. Ask for it if you do not have one.
2. Over HTTP you can bootstrap one yourself when the server uses guest login. First log in as a guest, which gives you a browser-style session cookie, then create a token with that session:

```sh
# 1. get cookies, including the XSRF-TOKEN cookie
curl -s -c jar.txt {{APP_URL}}/auth/guest/ -o /dev/null
XSRF=$(awk '$6=="XSRF-TOKEN"{print $7}' jar.txt)
# 2. log in with a nickname; the response holds a one-time redirect URL with a jwt
curl -s -b jar.txt -c jar.txt -H "X-XSRF-TOKEN: $XSRF" -H 'Content-Type: application/json' \
  -d '{"name":"my-agent"}' {{APP_URL}}/auth/api/v1/guest
# 3. open the "redirect" URL from the response once; it sets the app session cookie
curl -s -b jar.txt -c jar.txt -L -o /dev/null "<redirect from step 2>"
# 4. create an access token with the session (API calls accept the session cookie)
curl -s -b jar.txt -X POST "{{API_URL}}/user/accessTokens?title=my-agent"
```

The response of step 4 is `{"success":true,"token":{"id":"...","title":"my-agent"}}`; `token.id` is the bearer token. Guest users are removed after a while, and their tokens with them. Nicknames need not be unique; posting a different name with the same session cookie returns 409. Other login methods (LDAP, OAuth, SAML) need a human to log in and create the token.

Browser sessions use cookies plus an `X-XSRF-TOKEN` header on the login and app requests. `/api` calls with a Bearer token need neither.

Check that your token works (returns your profile; 401 means a bad token):

```sh
curl -s -H "Authorization: Bearer $TOKEN" {{API_URL}}/user
```

## Workflows

### 1. List devices and pick a free one

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  "{{API_URL}}/devices?fields=serial,present,ready,status,owner.email,model,platform,version"
```

The reply is `{"success":true,"devices":[...]}`. A device is free when `present` is true, `ready` is true, `status` is 3 (online) and `owner` is null. Anything else, skip it. Fields such as `model`, `version`, `sdk`, `abi`, `provider.name` help you choose one that fits your task.

### 2. Claim it

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"serial":"SERIAL","timeout":900000}' {{API_URL}}/user/devices
```

`timeout` is milliseconds of idleness after which the server releases the device. A 403 means it is already taken or not available: pick another device. A 404 means the serial does not exist. 504 means the device did not answer. Your claimed devices: `GET {{API_URL}}/user/devices`.

### 3. Remote ADB

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" {{API_URL}}/user/devices/SERIAL/remoteConnect
```

The reply has `remoteConnectUrl` (host:port). Then `adb connect <remoteConnectUrl>` and use adb as usual. The connection authorises the public ADB keys saved in your Settings; add yours with `POST {{API_URL}}/user/adbPublicKeys` (`{"publickey":"<contents of ~/.android/adbkey.pub or id_rsa.pub>"}`). Disconnect with `DELETE` on the same URL.

### 4. Run a shell command

REST has no shell call for a single device. A single device shell is available over the websocket and via adb after step 3 (`adb -s <host:port> shell <command>`). REST can run a command on all devices at once (admin):

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"getprop ro.build.version.release","timeout":10000}' {{API_URL}}/devices/shell
```

`timeout` is 1 to 60000 ms. The reply holds `results` (`serial`, `success`, `data`; `success` is null on timeout) and `skipped`. Devices in use by someone are skipped; `"force":true` runs on them too, so do not use it without permission. The CLI equivalent is `stf shell-all --url {{APP_URL}} --token $TOKEN <command>`.

### 5. Install an app

REST has no install call. Use adb after step 3: `adb -s <host:port> install app.apk`.

### 6. Release

```sh
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" {{API_URL}}/user/devices/SERIAL
```

Do this for every device you claimed, even after errors. If you also did step 3, the remote connection ends with the release.

### 7. Health (admin)

```sh
curl -s -H "Authorization: Bearer $TOKEN" {{API_URL}}/health/summary
curl -s -H "Authorization: Bearer $TOKEN" "{{API_URL}}/health/logs?q=offline&priority=4&serial=SERIAL&limit=50"
```

Logs filters: `q` (text), `priority` (1 to 7), `serial`, `limit` (1 to 1000); all optional.

### 8. Provider ADB keys (admin)

```sh
curl -s -H "Authorization: Bearer $TOKEN" {{API_URL}}/adbkeys
```

Lists key file names and fingerprints, never key contents. `POST {{API_URL}}/adbkeys` with `{"name":"...","key":"<PEM>"}` adds one, `DELETE {{API_URL}}/adbkeys/NAME` removes one. Do not change these unless asked: devices depend on them.

## Errors

All errors are JSON: `{"success":false,"description":"..."}`.

- 400: bad or missing parameter or body.
- 401: missing, malformed or unknown token (`Bad Credentials`, `Requires Authentication`).
- 403: the device is taken or unavailable (claim), not yours (release, remote connect), or the operation is admin-only for a non-admin user.
- 404: unknown device (any `/user/devices/...` call) or key.
- 409: conflict, for example the device reservation changed under you, a different guest name in the same session, or a key name that is already used.
- 503: no ADB keys folder is configured on the server (`/adbkeys`), or the server is busy: retry later.
- 504: the device did not answer in time. Check its state before retrying.

## Documentation

- Swagger JSON: {{API_URL}}/swagger.json (the interactive Swagger UI is served by the API unit directly at `/docs`, not through this address when a reverse proxy only forwards `/api`)
- Repository guide: doc/API.md in the STF source tree.

## Endpoints

Generated from the server's API definition: `METHOD path - summary`, `(admin)` where administrator rights are required, and required parameters in brackets. All paths start at {{APP_URL}}.

{{ENDPOINTS}}
