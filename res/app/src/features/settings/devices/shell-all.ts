import type {ShellAllResponse, ShellAllResult} from '@/core/devices-api'

export function shellStatus(result: ShellAllResult): 'ok' | 'failed' | 'timed out' {
  if (result.success === null) {
    return 'timed out'
  }
  return result.success ? 'ok' : 'failed'
}

function csvCell(value: string | undefined): string {
  return '"' + (value ?? '').replace(/"/g, '""') + '"'
}

export function shellAllCsv(response: ShellAllResponse): string {
  const command = response.command
  const rows = [
    ['command', 'serial', 'status', 'output']
    , ...response.results.map((result) => [command, result.serial, shellStatus(result), result.data || result.error])
    , ...response.skipped.map((skip) => [command, skip.serial, 'skipped', skip.reason])
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadCsv(csv: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}))
  link.download = 'shell-all-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}
