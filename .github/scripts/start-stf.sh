#!/usr/bin/env bash
#
# Start `stf local` in the background and block until it is actually serving.
# Everything it prints goes to $STF_LOG_DIR so CI can upload it, which is the
# only way a full Android matrix stays debuggable.
#
# usage: start-stf.sh [extra stf local args...]
#
set -euo pipefail

LOG_DIR="${STF_LOG_DIR:-stf-logs}"
PUBLIC_IP="${STF_PUBLIC_IP:-127.0.0.1}"
STF_PORT="${STF_PORT:-80}"
READY_TIMEOUT="${STF_READY_TIMEOUT:-180}"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stf-local.log"

echo "adb: $(command -v adb || echo 'NOT FOUND')"
adb devices || true

echo "starting stf local on $PUBLIC_IP (extra args: $*)"
nohup node lib/cli/index.js local \
  --public-ip "$PUBLIC_IP" \
  --auth-type guest \
  --port "$STF_PORT" \
  "$@" > "$LOG" 2>&1 &

STF_PID=$!
echo "$STF_PID" > "$LOG_DIR/stf.pid"
echo "stf local pid $STF_PID"

wait_for_port() {
  local port="$1"
  local label="$2"
  local waited=0

  while ! (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; do
    if ! kill -0 "$STF_PID" 2>/dev/null; then
      echo "::error::stf local died while waiting for $label (port $port)"
      tail -n 120 "$LOG" || true
      return 1
    fi
    if [ "$waited" -ge "$READY_TIMEOUT" ]; then
      echo "::error::timed out waiting for $label (port $port)"
      tail -n 120 "$LOG" || true
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "  $label ready on $port after ${waited}s"
}

# Ports from lib/cli/local/index.js: STF_PORT entry proxy, 7102 storage,
# 7105 app, 7106 api, 7110 websocket, 7120 auth.
wait_for_port 7120 auth
wait_for_port 7105 app
wait_for_port 7106 api
wait_for_port 7110 websocket
wait_for_port 7102 storage
wait_for_port "$STF_PORT" entry

echo "waiting for the nickname entry page to answer"
waited=0
until curl -fsS -o /dev/null "http://${PUBLIC_IP}:${STF_PORT}/auth/guest/"; do
  if [ "$waited" -ge "$READY_TIMEOUT" ]; then
    echo "::error::nickname entry page never answered"
    tail -n 120 "$LOG" || true
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done

echo "stf local is up: http://${PUBLIC_IP}:${STF_PORT}/"
