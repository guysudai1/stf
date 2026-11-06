var chai = require('chai')
var expect = chai.expect

var packages = require('../../res/app/control-panes/packages/parse-packages')

var SEPARATOR = '=====STF-PACKAGES====='

describe('Package list parsing', function() {
  var output = [
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

  var rows = packages.parse(output)

  it('keeps the apk path even when it contains "="', function() {
    expect(rows[0]).to.include({
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

  it('uses the active block of an updated system app, not the factory one', function() {
    expect(rows[1].versionName).to.equal('124.0.6367.219')
    expect(rows[1].versionCode).to.equal(636771932)
  })

  it('still lists a package that dumpsys has no details for', function() {
    expect(rows[2]).to.deep.equal({
      name: 'com.example.bare'
    , path: '/system/app/Bare/Bare.apk'
    , uid: '10001'
    })
  })

  it('asks for third-party apps only unless system apps are included', function() {
    expect(packages.command(false)).to.contain('pm list packages -f -U -3;')
    expect(packages.command(true)).to.contain('pm list packages -f -U;')
  })
})
