#!/bin/sh
# usage: PARITY_TARGET=old|new test/parity/e2e/run.sh [playwright args]
here="$(cd "$(dirname "$0")" && pwd)"
cd "${PARITY_PLAYWRIGHT_DIR:-$here/../../../../stf/test/playwright}" &&
  exec ./node_modules/.bin/playwright test -c "$here/playwright.config.mjs" "$@"
