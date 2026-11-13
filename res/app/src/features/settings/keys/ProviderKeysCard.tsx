import {useRef, useState, type ChangeEvent, type FormEvent} from 'react'
import {Alert, Badge, Button, Center, Group, Loader, Table, Text, TextInput} from '@mantine/core'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {IconPlus, IconServer, IconTrash, IconUpload} from '@tabler/icons-react'
import {api} from '@/core/api'
import {isAdmin} from '@/core/app-state'
import {formatDate} from '@/core/date-format'
import {useTranslation} from '@/core/i18n'
import {errorMessage, openConfirm} from '@/ui/modals'
import {NothingToShow} from '@/ui/NothingToShow'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from './Keys.module.css'

interface ProviderKey {
  name: string
  fingerprint: string | null
  size: number
  modified: string
  loaded: boolean
}

interface ProviderKeys {
  configured: boolean
  keys: ProviderKey[]
}

const providerKeysQueryKey = ['adbkeys']

export function keyNameFromFile(fileName: string): string {
  return fileName.replace(/\.adb_key$/, '').replace(/[^\w.-]/g, '_')
}

function ProviderKeysBody() {
  const {t} = useTranslation()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [key, setKey] = useState('')
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const provider = useQuery({
    queryKey: providerKeysQueryKey
    , queryFn: () => api.get<ProviderKeys>('/api/v1/adbkeys')
    , staleTime: 0
  })

  function reload() {
    return queryClient.invalidateQueries({queryKey: providerKeysQueryKey})
  }

  function readKey(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    setError('')
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setKey(String(reader.result))
      setFileName(file.name)
      setName((current) => current || keyNameFromFile(file.name))
    }
    reader.readAsText(file)
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await api.post('/api/v1/adbkeys', {name, key})
      await reload()
    }
    catch (err) {
      setError(errorMessage(err) || t('Request failed'))
    }
    finally {
      setKey('')
      setFileName('')
      setName('')
      if (fileInput.current) {
        fileInput.current.value = ''
      }
    }
  }

  async function remove(target: ProviderKey) {
    if (!await openConfirm({title: t('Delete this ADB key?'), message: target.name, danger: true})) {
      return
    }
    setError('')
    try {
      await api.delete('/api/v1/adbkeys/' + encodeURIComponent(target.name))
      await reload()
    }
    catch (err) {
      setError(errorMessage(err) || t('Request failed'))
    }
  }

  const keyList = provider.data
  const loadError = provider.isError ? errorMessage(provider.error) : ''
  const shownError = error || loadError

  return (
    <>
      {provider.isPending && <Center py='lg'><Loader size='sm' /></Center>}
      {shownError && (
        <Alert variant='light' color='red' p='xs' mb='sm' className='provider-keys-error'>{shownError}</Alert>
      )}
      {keyList?.configured === false && (
        <Text c='dimmed' size='sm'>
          {t('Not configured: start STF with --adb-keys-dir pointing at the ADB_VENDOR_KEYS folder.')}
        </Text>
      )}
      {keyList?.configured && (
        <>
          <Text c='dimmed' size='sm' mb='sm'>
            {t('Private keys adb offers to devices that already trust another machine. Restart the adb server, then STF, to apply changes.')}
          </Text>
          <form className='provider-keys-upload' onSubmit={add}>
            <Group gap='xs' align='center' mb='sm'>
              <Button
                size='xs'
                variant='light'
                leftSection={<IconUpload size={14} />}
                onClick={() => fileInput.current?.click()}
              >
                {t('Choose key file')}
              </Button>
              <input ref={fileInput} type='file' hidden aria-label={t('Choose key file')} onChange={readKey} />
              <Text size='sm' c='dimmed' className='provider-keys-file'>{fileName}</Text>
              <TextInput
                size='xs'
                maxLength={64}
                placeholder={t('Key name')}
                aria-label={t('Key name')}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Button
                type='submit'
                size='xs'
                leftSection={<IconPlus size={14} />}
                disabled={!key || !name}
              >
                {t('Add key')}
              </Button>
            </Group>
          </form>
          {!keyList.keys.length && (
            <NothingToShow icon={<IconServer size={30} />} message={t('No provider ADB keys')} />
          )}
          {keyList.keys.length > 0 && (
            <Table.ScrollContainer minWidth={760} type='native'>
              <Table className='provider-keys-table' verticalSpacing={6} highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('Name')}</Table.Th>
                    <Table.Th>{t('Fingerprint')}</Table.Th>
                    <Table.Th>{t('Size')}</Table.Th>
                    <Table.Th>{t('Modified')}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {keyList.keys.map((item) => (
                    <Table.Tr key={item.name}>
                      <Table.Td className='selectable'>
                        <Group gap='xs' wrap='nowrap'>
                          <span>{item.name}</span>
                          {!item.loaded && <Badge color='yellow' variant='light' styles={{root: {maxWidth: 'none'}, label: {overflow: 'visible'}}}>{t('ignored by adb')}</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td className={`selectable ${classes.fingerprint} ${classes.nowrap}`}>{item.fingerprint || '-'}</Table.Td>
                      <Table.Td className={classes.nowrap}>{item.size} B</Table.Td>
                      <Table.Td className={classes.nowrap}>{formatDate(item.modified, 'yyyy-MM-dd HH:mm')}</Table.Td>
                      <Table.Td ta='right'>
                        <Button
                          size='xs'
                          variant='light'
                          color='red'
                          leftSection={<IconTrash size={14} />}
                          onClick={() => remove(item)}
                        >
                          {t('Delete')}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}
    </>
  )
}

export function ProviderKeysCard() {
  const {t} = useTranslation()

  if (!isAdmin()) {
    return null
  }

  return (
    <div style={{gridColumn: '1 / -1'}}>
      <WidgetCard className='stf-keys stf-provider-keys' icon={IconServer} title={t('Provider ADB Keys')}>
        <ProviderKeysBody />
      </WidgetCard>
    </div>
  )
}
