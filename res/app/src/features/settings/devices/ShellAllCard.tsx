import {useState, type FormEvent} from 'react'
import {Badge, Button, Checkbox, Group, Text, TextInput} from '@mantine/core'
import {IconDownload, IconPlayerPlay, IconTerminal2} from '@tabler/icons-react'
import {ApiError} from '@/core/api'
import {devicesApi, type ShellAllResponse} from '@/core/devices-api'
import {gettext, useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'
import {downloadCsv, shellAllCsv, shellStatus} from './shell-all'
import classes from './DevicesSettings.module.css'

const statusLabels = {ok: gettext('ok'), failed: gettext('failed'), 'timed out': gettext('timed out')}

export function ShellAllCard() {
  const {t} = useTranslation()
  const [command, setCommand] = useState('')
  const [force, setForce] = useState(false)
  const [running, setRunning] = useState(false)
  const [response, setResponse] = useState<ShellAllResponse | null>(null)

  async function run(event: FormEvent) {
    event.preventDefault()
    if (!command || running) {
      return
    }
    setRunning(true)
    setResponse(null)
    try {
      const data = await devicesApi.runShell(command, force)
      setResponse({...data, command})
    }
    catch (error) {
      const description = error instanceof ApiError ? error.data?.description : undefined
      setResponse({description: description || t('Request failed'), results: [], skipped: []})
    }
    finally {
      setRunning(false)
    }
  }

  return (
    <WidgetCard className='stf-devices shell-all' icon={IconTerminal2} title={t('Run a shell command on all devices')}>
      <form className={classes.shellForm} onSubmit={run}>
        <TextInput
          className={classes.shellCommand}
          size='xs'
          aria-label={t('Run a shell command on all devices')}
          placeholder={t('e.g. getprop ro.product.model')}
          value={command}
          onChange={(event) => setCommand(event.currentTarget.value)}
        />
        <Checkbox
          size='xs'
          label={t('Include devices in use')}
          checked={force}
          onChange={(event) => setForce(event.currentTarget.checked)}
        />
        <Button
          type='submit'
          size='xs'
          disabled={!command || running}
          loading={running}
          leftSection={<IconPlayerPlay size={14} />}
        >
          {t('Run')}
        </Button>
      </form>
      {response && (
        <div className='shell-all-results'>
          <Group justify='space-between' mt='sm' mb='xs'>
            <Text size='sm' c='dimmed'>{response.description}</Text>
            {(response.results.length > 0 || response.skipped.length > 0) && (
              <Button
                size='compact-xs'
                variant='light'
                leftSection={<IconDownload size={14} />}
                onClick={() => downloadCsv(shellAllCsv(response))}
              >
                {t('Export CSV')}
              </Button>
            )}
          </Group>
          {response.results.map((result) => (
            <div key={result.serial} className='shell-all-result'>
              <Group gap='xs'>
                <Text fw={600} size='sm'>{result.serial}</Text>
                <Badge size='sm' variant='light' color={result.success ? 'green' : 'red'}>{t(statusLabels[shellStatus(result)])}</Badge>
              </Group>
              <pre className={classes.shellOutput}>{result.data || result.error}</pre>
            </div>
          ))}
          {response.skipped.map((skip) => (
            <Group key={skip.serial} gap='xs' mb='xs' className='shell-all-result'>
              <Text fw={600} size='sm'>{skip.serial}</Text>
              <Badge size='sm' variant='light' color='yellow'>{t('skipped')}: {skip.reason}</Badge>
            </Group>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}
