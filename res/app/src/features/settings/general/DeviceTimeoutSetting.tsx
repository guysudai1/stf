import {useEffect, useState, type FormEvent} from 'react'
import {Button, Group, NumberInput} from '@mantine/core'
import {notifications} from '@mantine/notifications'
import {IconClock} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {setSetting, useSetting} from '@/core/settings'
import {useSocketEvent} from '@/core/socket'
import {SettingRow} from '../SettingRow'

const settingKey = 'deviceTimeout'
const minimumSeconds = 1
const maximumSeconds = 86400

type Draft = number | string

function isBlank(value: Draft | null | undefined): value is '' | null | undefined {
  return value === null || value === undefined || value === ''
}

function isValidSeconds(value: Draft | null | undefined): boolean {
  return isBlank(value) || typeof value === 'number' && Number.isInteger(value) &&
    value >= minimumSeconds && value <= maximumSeconds
}

function millisecondsToSeconds(value: number | null | undefined): Draft {
  if (isBlank(value)) {
    return ''
  }
  const seconds = value / 1000
  return isValidSeconds(seconds) ? seconds : ''
}

export function DeviceTimeoutSetting() {
  const {t} = useTranslation()
  const [stored] = useSetting<number | null>(settingKey, null)
  const [seconds, setSeconds] = useState<Draft>(() => millisecondsToSeconds(stored))
  const valid = isValidSeconds(seconds)

  useEffect(() => setSeconds(millisecondsToSeconds(stored)), [stored])
  useSocketEvent('user.settings.update.error', (data: {error?: string}) => {
    notifications.show({color: 'red', message: data?.error ?? t('Error')})
  })

  function save(event: FormEvent) {
    event.preventDefault()
    if (valid) {
      setSetting(settingKey, isBlank(seconds) ? null : Number(seconds) * 1000)
    }
  }

  function reset() {
    setSeconds('')
    setSetting(settingKey, null)
  }

  return (
    <SettingRow
      icon={<IconClock size={20} />}
      label={t('Device timeout')}
      description={t('Leave blank or reset to use the provider timeout. This applies to newly acquired devices.')}
      className='stf-device-timeout'
    >
      <form onSubmit={save}>
        <Group gap='xs' align='flex-start' wrap='nowrap'>
          <NumberInput
            data-testid='device-timeout-input'
            aria-label={t('Timeout (seconds)')}
            title={t('Timeout for newly acquired devices')}
            placeholder={t('Timeout (seconds)')}
            min={minimumSeconds}
            max={maximumSeconds}
            step={1}
            allowDecimal
            allowNegative
            clampBehavior='none'
            hideControls
            inputMode='numeric'
            value={seconds}
            onChange={setSeconds}
            error={valid ? undefined : t('Enter a whole number from 1 to 86400 seconds.')}
            w={160}
          />
          <Button type='submit' disabled={!valid}>{t('Save')}</Button>
          <Button type='button' variant='default' data-testid='device-timeout-reset' onClick={reset}>
            {t('Reset')}
          </Button>
        </Group>
      </form>
    </SettingRow>
  )
}
