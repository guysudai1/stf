const SEPARATOR = '=====STF-PACKAGES====='

export interface PackageRow {
  path: string
  name: string
  uid: string
  versionCode?: number
  targetSdk?: number
  versionName?: string
  firstInstallTime?: string
  lastUpdateTime?: string
}

type Details = Partial<Pick<PackageRow, 'versionCode' | 'targetSdk' | 'versionName' | 'firstInstallTime' | 'lastUpdateTime'>>

const DETAIL_FIELDS: [keyof Details, RegExp, (value: string) => number | string][] = [
  ['versionCode', /versionCode=(\d+)/, Number]
  , ['targetSdk', /targetSdk=(\d+)/, Number]
  , ['versionName', /versionName=(.*)/, String]
  , ['firstInstallTime', /firstInstallTime=(.*)/, String]
  , ['lastUpdateTime', /lastUpdateTime=(.*)/, String]
]

export function command(includeSystem: boolean): string {
  return 'pm list packages -f -U' + (includeSystem ? '' : ' -3') +
    '; echo ' + SEPARATOR +
    '; dumpsys package packages | grep -E ' +
    '"^  Package \\[|versionCode=|versionName=|firstInstallTime=|lastUpdateTime="'
}

function parseDetails(text: string): Map<string, Details> {
  const details = new Map<string, Details>()
  let current: Record<string, number | string> | null = null

  for (const line of text.split('\n')) {
    const header = /^\s*Package \[([^\]]+)\]/.exec(line)
    if (header) {
      const name = header[1] as string
      if (details.has(name)) {
        current = null
      }
      else {
        const block: Details = {}
        details.set(name, block)
        current = block
      }
      continue
    }
    if (!current) {
      continue
    }
    for (const [field, pattern, convert] of DETAIL_FIELDS) {
      const match = pattern.exec(line)
      if (match && typeof current[field] === 'undefined') {
        current[field] = convert((match[1] as string).trim())
      }
    }
  }
  return details
}

export function parse(text: string): PackageRow[] {
  const parts = text.split(SEPARATOR)
  const details = parseDetails(parts[1] || '')
  const rows: PackageRow[] = []

  for (const line of (parts[0] as string).split('\n')) {
    const match = /^package:(.+)=([^=\s]+)\s+uid:(\d+)/.exec(line.trim())
    if (match) {
      const name = match[2] as string
      rows.push({path: match[1] as string, name, uid: match[3] as string, ...details.get(name)})
    }
  }
  return rows
}

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
