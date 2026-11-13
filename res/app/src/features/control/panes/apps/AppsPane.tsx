import {useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent} from 'react'
import {ActionIcon, Alert, Badge, Box, Button, Checkbox, Code, Group, Stack, Table, Text, TextInput} from '@mantine/core'
import {useQuery} from '@tanstack/react-query'
import {IconApps, IconRefresh, IconSearch, IconSortAscending, IconSortDescending} from '@tabler/icons-react'
import {gettext, translate, useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'
import {shellQuote, type PackageRow} from './parse-packages'
import {packagesQuery} from './packages-query'
import classes from './AppsPane.module.css'

type Field = 'name' | 'versionName' | 'versionCode' | 'targetSdk' | 'firstInstallTime' | 'lastUpdateTime' | 'md5'

interface Row extends PackageRow {
  md5?: string
}

interface Column {
  field: Field
  title: string
  width: number
}

const MIN_WIDTH = 40
const TICK = 30 * 1000

const md5Cache = new Map<string, string>()

const md5Key = (serial: string, row: PackageRow) => `${serial}|${row.name}@${row.versionCode}`

function relativeTime(since: number, now: number, justNow: string): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000))
  if (seconds < 45) {
    return justNow
  }
  const formatter = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'})
  if (seconds < 3600) {
    return formatter.format(-Math.round(seconds / 60), 'minute')
  }
  if (seconds < 86400) {
    return formatter.format(-Math.round(seconds / 3600), 'hour')
  }
  return formatter.format(-Math.round(seconds / 86400), 'day')
}

const initialColumns: Column[] = [
  {field: 'name', title: gettext('App'), width: 320}
  , {field: 'versionName', title: gettext('Version'), width: 140}
  , {field: 'versionCode', title: gettext('Code'), width: 100}
  , {field: 'targetSdk', title: gettext('Target SDK'), width: 100}
  , {field: 'firstInstallTime', title: gettext('Installed'), width: 160}
  , {field: 'lastUpdateTime', title: gettext('Updated'), width: 160}
  , {field: 'md5', title: gettext('MD5'), width: 280}
]

function compare(a: Row, b: Row, field: Field): number {
  const left = a[field]
  const right = b[field]
  if (left === right) {
    return 0
  }
  if (left === undefined) {
    return 1
  }
  if (right === undefined) {
    return -1
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  const leftText = String(left).toLowerCase()
  const rightText = String(right).toLowerCase()
  if (leftText === rightText) {
    return 0
  }
  return leftText < rightText ? -1 : 1
}

export default function AppsPane({device, control}: PaneProps) {
  const {t} = useTranslation()
  const serial = device.serial
  const [includeSystem, setIncludeSystem] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Field>('name')
  const [reverse, setReverse] = useState(false)
  const [columns, setColumns] = useState(initialColumns)
  const [now, setNow] = useState(Date.now)
  const [, refreshMd5] = useReducer((n: number) => n + 1, 0)
  const swallowClick = useRef(false)

  const packages = useQuery(packagesQuery(control, serial, includeSystem))

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK)
    return () => clearInterval(timer)
  }, [])

  const rows: Row[] = (packages.data ?? []).map(row => {
    const md5 = md5Cache.get(md5Key(serial, row))
    return md5 === undefined ? row : {...row, md5}
  })
  const loading = packages.isFetching
  const error = packages.error?.message ?? null

  function sortBy(field: Field) {
    if (swallowClick.current) {
      return
    }
    setReverse(sort === field ? !reverse : false)
    setSort(field)
  }

  function startResize(index: number, event: ReactMouseEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columns[index]?.width ?? MIN_WIDTH

    const move = (e: MouseEvent) => {
      const width = Math.max(MIN_WIDTH, startWidth + e.clientX - startX)
      setColumns(current => current.map((column, i) => i === index ? {...column, width} : column))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      swallowClick.current = true
      setTimeout(() => {
        swallowClick.current = false
      }, 0)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function loadMd5(row: Row) {
    const key = md5Key(serial, row)
    const settle = (md5: string) => {
      md5Cache.set(key, md5)
      refreshMd5()
    }
    settle('…')
    control.shell('md5sum ' + shellQuote(row.path))
      .then(result => settle(result.data.join('').split(/\s/)[0] || translate('unavailable')))
      .catch(() => settle(translate('unavailable')))
  }

  const needle = search.toLowerCase()
  const visible = rows
    .filter(row => row.name.toLowerCase().includes(needle))
    .sort((a, b) => (reverse ? -1 : 1) * compare(a, b, sort))
  const SortIcon = reverse ? IconSortDescending : IconSortAscending
  const activeSort = reverse ? 'descending' : 'ascending'
  const width = columns.reduce((sum, column) => sum + column.width, 0)

  return (
    <WidgetCard
      title={
        <Group gap='xs'>
          <span>{t('Installed apps')}</span>
          <Badge variant='light' aria-label={t('Matching apps')}>{visible.length}</Badge>
          {packages.dataUpdatedAt > 0 && (
            <Text size='sm' c='dimmed'>
              {t('Updated')} {relativeTime(packages.dataUpdatedAt, now, t('just now'))}
            </Text>
          )}
        </Group>
      }
      icon={IconApps}
      color='green'
      actions={
        <ActionIcon
          variant='subtle'
          aria-label={t('Refresh')}
          disabled={loading}
          loading={loading}
          onClick={() => packages.refetch()}
        >
          <IconRefresh size={18} />
        </ActionIcon>
      }
    >
      <Stack gap='sm'>
        <Group gap='md'>
          <TextInput
            size='xs'
            type='search'
            leftSection={<IconSearch size={14} />}
            aria-label={t('Filter packages')}
            placeholder={t('Filter packages')}
            value={search}
            onChange={event => setSearch(event.currentTarget.value)}
          />
          <Checkbox
            size='xs'
            label={t('Include system apps')}
            checked={includeSystem}
            onChange={event => setIncludeSystem(event.currentTarget.checked)}
          />
        </Group>
        {error && <Alert variant='light' color='red' p='xs'>{error}</Alert>}
        <Box className={classes.scroll}>
          <Table highlightOnHover verticalSpacing={6} className={classes.table} style={{width}}>
            <Table.Thead>
              <Table.Tr>
                {columns.map((column, index) => (
                  <Table.Th
                    key={column.field}
                    className={classes.th}
                    style={{width: column.width}}
                    aria-sort={sort === column.field ? activeSort : 'none'}
                    onClick={() => sortBy(column.field)}
                  >
                    <Group gap={4} wrap='nowrap'>
                      <span>{t(column.title)}</span>
                      {sort === column.field && <SortIcon size={14} />}
                    </Group>
                    <span
                      className={classes.handle}
                      data-testid={`resize-${column.field}`}
                      onMouseDown={event => startResize(index, event)}
                    />
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map(row => (
                <Table.Tr key={row.name}>
                  <Table.Td className={classes.cell}><Code title={row.path}>{row.name}</Code></Table.Td>
                  <Table.Td className={classes.cell} title={row.versionName}>{row.versionName}</Table.Td>
                  <Table.Td>{row.versionCode}</Table.Td>
                  <Table.Td>{row.targetSdk}</Table.Td>
                  <Table.Td className={classes.cell}>{row.firstInstallTime}</Table.Td>
                  <Table.Td className={classes.cell}>{row.lastUpdateTime}</Table.Td>
                  <Table.Td className={classes.cell}>
                    {row.md5 ?
                      <Code>{row.md5}</Code> :
                      <Button size='compact-xs' variant='default' onClick={() => loadMd5(row)}>{t('Get MD5')}</Button>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      </Stack>
    </WidgetCard>
  )
}
