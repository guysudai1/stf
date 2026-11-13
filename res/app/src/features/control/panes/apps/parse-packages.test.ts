import {describe, expect, it} from 'vitest'
import {command, parse, shellQuote} from './parse-packages'

const SEPARATOR = '=====STF-PACKAGES====='

describe('Package list parsing', () => {
  const output = [
    'package:/data/app/~~QJ1t==/com.example-jm44==/base.apk=com.example uid:10207'
    , 'package:/product/app/Chrome/Chrome.apk=com.android.chrome uid:10120'
    , 'package:/system/app/Bare/Bare.apk=com.example.bare uid:10001'
    , SEPARATOR
    , '  Package [com.example] (667df2d):'
    , '    versionCode=15 minSdk=21 targetSdk=34'
    , '    versionName=2.5.8'
    , '    lastUpdateTime=2026-10-23 22:28:11'
    , '      firstInstallTime=2026-10-20 09:00:00'
    , '  Package [com.android.chrome] (3dd09a0):'
    , '    versionCode=636771932 minSdk=29 targetSdk=34'
    , '    versionName=124.0.6367.219'
    , '  Package [com.android.chrome] (1a2b3c4):'
    , '    versionCode=1 minSdk=29 targetSdk=30'
    , '    versionName=1.0-factory'
  ].join('\n')

  const rows = parse(output)

  it('keeps the apk path even when it contains "="', () => {
    expect(rows[0]).toMatchObject({
      name: 'com.example'
      , path: '/data/app/~~QJ1t==/com.example-jm44==/base.apk'
      , uid: '10207'
      , versionName: '2.5.8'
      , versionCode: 15
      , targetSdk: 34
      , firstInstallTime: '2026-10-20 09:00:00'
      , lastUpdateTime: '2026-10-23 22:28:11'
    })
  })

  it('uses the active block of an updated system app, not the factory one', () => {
    expect(rows[1]?.versionName).toBe('124.0.6367.219')
    expect(rows[1]?.versionCode).toBe(636771932)
  })

  it('still lists a package that dumpsys has no details for', () => {
    expect(rows[2]).toEqual({
      name: 'com.example.bare'
      , path: '/system/app/Bare/Bare.apk'
      , uid: '10001'
    })
  })

  it('asks for third-party apps only unless system apps are included', () => {
    expect(command(false)).toContain('pm list packages -f -U -3;')
    expect(command(true)).toContain('pm list packages -f -U;')
  })
})

it('shellQuote keeps single quotes inside the argument', () => {
  expect(shellQuote("/data/app/a'b/base.apk")).toBe("'/data/app/a'\\''b/base.apk'")
})
