import {api} from '@/core/api'

export interface HealthLog {
  id?: string
  key: string
  timestamp: string
  priority: number
  tag: string
  pid: number
  message: string
  identifier: string
  serial?: string | null
  kind?: string | null
  severity: string
  levelLabel: string
  messageSummary: string
  details: string
}

export interface HealthSummary {
  status: 'healthy' | 'warning' | 'degraded' | 'critical'
  statusDescription: string
  devices: {total: number, present: number, ready: number}
  logs: {total: number, warning: number, error: number, fatal: number}
}

export interface HealthFilters {
  q: string
  priority: string
  serial: string
}

export const maxLogs = 1000

export const healthApi = {
  summary: () => api.get<{summary: HealthSummary}>('/api/v1/health/summary')
  , logs: (filters: HealthFilters) => {
    const params: string[] = []
    if (filters.q) {
      params.push('q=' + encodeURIComponent(filters.q))
    }
    if (filters.priority) {
      params.push('priority=' + filters.priority)
    }
    if (filters.serial) {
      params.push('serial=' + encodeURIComponent(filters.serial))
    }
    return api.get<{logs: Array<Omit<HealthLog, 'key'>>}>('/api/v1/health/logs?' + params.join('&'))
  }
}

export function withKeys(logs: Array<Omit<HealthLog, 'key'>>): HealthLog[] {
  return logs.map((log, index) => ({...log, key: log.id || `row-${index}`}))
}

export function matchesLive(entry: HealthLog, filters: HealthFilters): boolean {
  const text = `${entry.message} ${entry.tag} ${entry.identifier} ${entry.serial || ''}`.toLowerCase()
  if (filters.q && !text.includes(filters.q.toLowerCase())) {
    return false
  }
  if (filters.serial && entry.serial !== filters.serial) {
    return false
  }
  return !filters.priority || entry.priority >= Number(filters.priority)
}

export function prependLive(logs: HealthLog[], entry: HealthLog): HealthLog[] {
  return [entry, ...logs].slice(0, maxLogs)
}

export function deviceOptions(
  devices: Array<{serial: string, model?: string, name?: string}>
  , logs: Array<{serial?: string | null}>
  , selected: string
): Array<{value: string, label: string}> {
  const options = new Map<string, string>()
  for (const device of devices) {
    const model = device.model || device.name
    options.set(device.serial, model ? `${model} \u2014 ${device.serial}` : device.serial)
  }
  for (const serial of [...logs.map((log) => log.serial), selected]) {
    if (serial && !options.has(serial)) {
      options.set(serial, serial)
    }
  }
  return [...options].map(([value, label]) => ({value, label}))
    .sort((a, b) => a.label.localeCompare(b.label))
}
