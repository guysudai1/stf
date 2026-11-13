import {useState, type FormEvent} from 'react'
import {Alert, Center, Button, Image, Paper, Stack, TextInput, Title} from '@mantine/core'
import {IconAlertCircle, IconUser} from '@tabler/icons-react'
import {api, ApiError} from '@/core/api'
import {useTranslation} from '@/core/i18n'
import classes from './SignInForm.module.css'

type GuestError = 'invalid' | 'server' | null

export function GuestForm() {
  const {t} = useTranslation()
  const [nickname, setNickname] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<GuestError>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await api.post<{redirect: string}>('/auth/api/v1/guest', {name: nickname})
      window.location.replace(response.redirect)
    }
    catch (caught) {
      const code = caught instanceof ApiError ? caught.data?.error : null
      setError(code === 'ValidationError' ? 'invalid' : 'server')
      setSubmitting(false)
    }
  }

  return (
    <Center className={classes.page}>
      <Paper className={classes.card} shadow='xl' p='xl' withBorder>
        <Stack align='center' gap='xs' mb='lg'>
          <Image src='/static/logo/exports/STF-512.png' w={88} h={88} alt='STF' />
          <Title order={2}>{t('Smartphone Test Farm')}</Title>
        </Stack>
        <form name='nicknameForm' noValidate onSubmit={submit}>
          <Stack>
            {error && (
              <Alert color='red' variant='light' icon={<IconAlertCircle size={18} />}
                className='alert alert-danger'>
                {error === 'invalid' ?
                  t('Please enter a valid nickname') :
                  t('Server error. Check log output.')}
              </Alert>
            )}
            <TextInput
              name='nickname'
              placeholder={t('Nickname')}
              aria-label={t('Nickname')}
              leftSection={<IconUser size={16} />}
              value={nickname}
              onChange={(event) => setNickname(event.currentTarget.value)}
              onBlur={() => setTouched(true)}
              error={touched && !nickname ? t('Please enter a nickname') : null}
              maxLength={64}
              autoComplete='nickname'
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              required
              size='md'
            />
            <Button type='submit' size='md' variant='filled' fullWidth loading={submitting}>
              {t('Continue')}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
