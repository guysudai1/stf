import {expect} from 'chai'
import yargs from 'yargs'

import * as local from '../../lib/cli/local/index.js'
import * as provider from '../../lib/cli/provider/index.js'

function parse(module: any, args: (string | number)[]): any {
  let parsed: any
  yargs(args.map(String))
    .exitProcess(false)
    .fail((message: string, error: Error) => {
      throw error || new Error(message)
    })
    .command(module.command, module.describe, module.builder, (argv: any) => {
      parsed = argv
    })
    .parseSync()
  return parsed
}

function providerSerials(localArgs: string[]): (string | number)[] {
  const args = local.providerArgs(parse(local, ['local'].concat(localArgs)))
  return parse(provider, args).serial
}

function providerOpts(localArgs: string[]): any {
  return parse(provider, local.providerArgs(parse(local, ['local'].concat(localArgs))))
}

describe('stf local provider args', function() {
  it('should pass the serial filter through with default options', function() {
    expect(providerSerials(['emulator-5554'])).to.deep.equal(['emulator-5554'])
  })

  it('should keep the serial filter when cleanup folders are given', function() {
    const args = ['emulator-5554', 'emulator-5556', '--cleanup-folder', '/data/local/tmp']
    expect(providerSerials(args)).to.deep.equal(['emulator-5554', 'emulator-5556'])
  })

  it('should handle every device when no serial is given', function() {
    expect(providerSerials(['--no-screen-reset'])).to.deep.equal([])
  })

  it('should forward the remote ADB options only when a subnet is given', function() {
    expect(providerOpts(['--remote-adb-ports', '6000']).remoteAdbSubnet).to.equal(undefined)
    var parsed = providerOpts([
      '--remote-adb-subnet', '10.0.0.7/24', '--remote-adb-ports', '5555,6000'
    , '--remote-adb-scan-interval', '60'
    ])
    expect(parsed.remoteAdbSubnet).to.equal('10.0.0.0/24')
    expect(parsed.remoteAdbPorts).to.deep.equal([5555, 6000])
    expect(parsed.remoteAdbScanInterval).to.equal(60)
  })

  it('should keep the serial filter when remote ADB options are given', function() {
    var args = ['emulator-5554', '--remote-adb-subnet', '10.0.0.0/24']
    expect(providerSerials(args)).to.deep.equal(['emulator-5554'])
  })
})
