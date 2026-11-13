import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {Navigate} from 'react-router'
import {Alert, Badge, Button, Card, Center, Code, Group, Loader, Select, Table, Text, TextInput, ThemeIcon, Title} from '@mantine/core'
import {useDebouncedValue} from '@mantine/hooks'
import {IconHeartbeat, IconListDetails, IconRefresh, IconSearch} from '@tabler/icons-react'
import {isAdmin} from '@/core/app-state'
import {formatDate} from '@/core/date-format'
import {useTranslation} from '@/core/i18n'
import {useDevices} from '@/core/devices/store'
import {useSocketEvent} from '@/core/socket'
import {NothingToShow} from '@/ui/NothingToShow'
import {Page} from '@/ui/Page'
import {usePageTitle} from '@/ui/page-title'
import {WidgetCard} from '@/ui/WidgetCard'
import {
  deviceOptions
  , healthApi
  , matchesLive
  , prependLive
  , withKeys
  , type HealthLog
  , type HealthSummary
} from './health-logs'
import classes from './HealthLogsPage.module.css'

const statusColors: Record<HealthSummary['status'], string> = {
  healthy: 'green'
  , warning: 'yellow'
  , degraded: 'orange'
  , critical: 'red'
}

const severityColors: Record<string, string> = {
  info: 'gray'
  , important: 'blue'
  , warning: 'yellow'
  , error: 'red'
  , fatal: 'grape'
}

let liveCounter = 0

export default function HealthLogsPage() {
  return isAdmin() ? <HealthLogs /> : <Navigate to='/devices' replace />
}

function StatCard({label, note, children}: {label: string, note?: string, children: ReactNode}) {
  return (
    <Card padding='md' withBorder>
      <Text size='xs' c='dimmed' tt='uppercase'>{label}</Text>
      {children}
      {note && <Text size='xs' c='dimmed'>{note}</Text>}
    </Card>
  )
}

function HealthLogs() {
  const {t} = useTranslation()
  const [summary, setSummary] = useState<HealthSummary | null>(null)
  const [logs, setLogs] = useState<HealthLog[]>([])
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('')
  const [serial, setSerial] = useState('')
  const {devices} = useDevices()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'summary' | 'logs' | null>(null)
  const [q] = useDebouncedValue(search, 300)
  const latest = useRef(0)

  usePageTitle(t('Health & Logs'))

  const loadSummary = useCallback(() => {
    healthApi.summary()
      .then((data) => setSummary(data.summary))
      .catch(() => setError('summary'))
  }, [])

  const loadLogs = useCallback(() => {
    const request = ++latest.current
    setLoading(true)
    setError(null)
    healthApi.logs({q, priority, serial})
      .then((data) => {
        if (request === latest.current) {
          setLogs(withKeys(data.logs || []))
          setLoading(false)
        }
      })
      .catch(() => {
        if (request === latest.current) {
          setLogs([])
          setLoading(false)
          setError('logs')
        }
      })
  }, [q, priority, serial])

  useEffect(loadSummary, [loadSummary])
  useEffect(loadLogs, [loadLogs])

  useSocketEvent('health.log', (entry: Omit<HealthLog, 'key'>) => {
    const live = {...entry, key: `live-${++liveCounter}`}
    if (matchesLive(live, {q, priority, serial})) {
      setLogs((current) => prependLive(current, live))
    }
  })

  function refresh() {
    loadSummary()
    loadLogs()
  }

  const filtered = Boolean(q || priority || serial)

  return (
    <Page className='stf-health-logs' innerClassName={classes.inner} maxWidth={1440}>
      <Group gap='md' wrap='nowrap'>
        <ThemeIcon size={44} radius='md' variant='light'>
          <IconHeartbeat size={26} />
        </ThemeIcon>
        <Title order={2}>{t('Health & Logs')}</Title>
      </Group>

      {summary && (
        <div className={`health-summary ${classes.summary}`}>
          <StatCard label={t('Status')} note={summary.statusDescription}>
            <Text fw={700} size='xl' tt='capitalize' c={statusColors[summary.status]} className={`health-status ${summary.status}`}>
              {summary.status}
            </Text>
          </StatCard>
          <StatCard label={t('Devices')}>
            <Text fw={700} size='xl'>
              {t('{{present}} / {{total}} present', {present: summary.devices.present, total: summary.devices.total})}
            </Text>
          </StatCard>
          <StatCard label={t('Last 24 hours')}>
            <Text fw={700} size='xl'>{t('{{count}} events', {count: summary.logs.total})}</Text>
          </StatCard>
          <StatCard label={t('Errors / Fatal')}>
            <Text fw={700} size='xl'>{summary.logs.error} / {summary.logs.fatal}</Text>
          </StatCard>
        </div>
      )}

      <WidgetCard className='stf-health-card' icon={IconListDetails} title={t('Logs')} flush>
        <div className={`health-filters ${classes.filters}`}>
          <TextInput
            size='xs'
            leftSection={<IconSearch size={14} />}
            className={classes.search}
            aria-label={t('Search tag, source, or message')}
            placeholder={t('Search tag, source, or message')}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <Select
            size='xs'
            className={classes.level}
            aria-label={t('Level')}
            allowDeselect={false}
            value={priority}
            onChange={(value) => setPriority(value || '')}
            data={[
              {value: '', label: t('All levels')}
              , {value: '5', label: t('Warning and above')}
              , {value: '6', label: t('Error and above')}
              , {value: '7', label: t('Fatal only')}
            ]}
          />
          <Select
            size='xs'
            className={classes.device}
            aria-label={t('Device')}
            placeholder={t('All devices')}
            searchable
            clearable
            nothingFoundMessage={t('No matching devices')}
            value={serial || null}
            onChange={(value) => setSerial(value || '')}
            data={deviceOptions(devices, logs, serial)}
          />
          <Button size='xs' variant='default' leftSection={<IconRefresh size={14} />} onClick={refresh}>
            {t('Refresh')}
          </Button>
        </div>

        {error && (
          <Alert m='md' variant='light' color='red' className='health-error'>
            {error === 'logs' ? t('Unable to load health logs.') : t('Unable to load the health summary.')}
          </Alert>
        )}

        {logs.length > 0 && (
          <Table.ScrollContainer minWidth={760} type='native'>
            <Table highlightOnHover verticalSpacing={6} className='health-log-table'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Time')}</Table.Th>
                  <Table.Th>{t('Level')}</Table.Th>
                  <Table.Th>{t('Source')}</Table.Th>
                  <Table.Th>{t('Device')}</Table.Th>
                  <Table.Th>{t('Message')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {logs.map((entry) => (
                  <Table.Tr key={entry.key} className={`health-row-${entry.severity}`}>
                    <Table.Td className={classes.time}>{formatDate(entry.timestamp, 'yyyy-MM-dd HH:mm:ss')}</Table.Td>
                    <Table.Td className={classes.nowrap}>
                      <Badge variant='light' styles={{root: {maxWidth: 'none'}, label: {overflow: 'visible'}}} color={severityColors[entry.severity] || 'gray'}>{entry.levelLabel}</Badge>
                    </Table.Td>
                    <Table.Td>{entry.tag}</Table.Td>
                    <Table.Td className={classes.nowrap}>{entry.serial ? (
                      <Code
                        component='button'
                        className={classes.chip}
                        title={t('Filter by this device')}
                        onClick={() => setSerial(entry.serial || '')}
                      >
                        {entry.serial}
                      </Code>
                    ) : '-'}</Table.Td>
                    <Table.Td>
                      <div className={classes.summaryLine}>{entry.messageSummary || entry.message}</div>
                      {entry.details && (
                        <details className={classes.details}>
                          <summary>{t('Stack/details')}</summary>
                          <pre>{entry.details}</pre>
                        </details>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {loading && !logs.length && <Center py='xl'><Loader size='sm' /></Center>}
        {!logs.length && !loading && (
          <NothingToShow
            message={filtered ? t('No matching health events.') : t('No health events in the last 24 hours.')}
          />
        )}
      </WidgetCard>
    </Page>
  )
}
