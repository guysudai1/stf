import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'
import cookieutil from '../../util/cookieutil.js'

var require = createRequire(import.meta.url)

var command = 'auth-guest'

var describe = 'Start a nickname-only guest auth unit.'

var builder = function(yargs: Argv) {
  var y = yargs
    .env('STF_AUTH_GUEST')
    .strict()
    .option('app-url', {
      alias: 'a'
    , describe: 'URL to the app unit.'
    , type: 'string'
    , demand: true
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7120
    })
    .option('secret', {
      alias: 's'
    , describe: 'The secret to use for auth JSON Web Tokens. Anyone who ' +
        'knows this token can freely enter the system if they want, so keep ' +
        'it safe.'
    , type: 'string'
    , default: process.env.SECRET
    , demand: true
    })
    .option('ssid', {
      alias: 'i'
    , describe: 'The name of the session ID cookie.'
    , type: 'string'
    , default: process.env.SSID || 'ssid'
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_AUTH_GUEST_` (e.g. ' +
      '`STF_AUTH_GUEST_SECRET`).')

  return cookieutil.addCookieOptions(y)
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/auth/guest.js').default({
    port: argv.port
  , secret: argv.secret
  , ssid: argv.ssid
  , appUrl: argv.appUrl
  , cookieSameSite: argv.cookieSameSite
  , cookieSecure: cookieutil.resolveCookieSecure(argv.cookieSecure)
  })
}

export {command, describe, builder, handler}
