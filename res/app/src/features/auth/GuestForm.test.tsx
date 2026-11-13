import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {GuestForm} from './GuestForm'
import {api, ApiError} from '@/core/api'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})
  , gettext: (text: string) => text, translate: (text: string) => text}))
Object.defineProperty(window, 'matchMedia', {
  value: () => ({matches: false, addEventListener: () => undefined
    , removeEventListener: () => undefined, addListener: () => undefined
    , removeListener: () => undefined})
})

const post = vi.spyOn(api, 'post')

function renderForm() {
  render(<MantineProvider><GuestForm /></MantineProvider>)
  return screen.getByPlaceholderText('Nickname')
}

function submit(value: string) {
  fireEvent.change(renderForm(), {target: {value}})
  fireEvent.click(screen.getByRole('button', {name: 'Continue'}))
}

describe('GuestForm', () => {
  afterEach(cleanup)

  beforeEach(() => {
    post.mockReset()
  })

  it('posts the nickname to the guest endpoint', async() => {
    post.mockRejectedValue(new ApiError(500, 'Error', {error: 'ServerError'}))
    submit('alice')
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/api/v1/guest', {name: 'alice'}))
  })

  it('shows the validation message for a ValidationError', async() => {
    post.mockRejectedValue(new ApiError(400, 'Bad Request', {error: 'ValidationError'}))
    submit('   ')
    expect(await screen.findByText('Please enter a valid nickname')).toBeTruthy()
  })

  it('shows the server error for any other failure', async() => {
    post.mockRejectedValue(new ApiError(409, 'Conflict', {error: 'NicknameAlreadySet'}))
    submit('alice')
    expect(await screen.findByText('Server error. Check log output.')).toBeTruthy()
  })

  it('warns when the field was touched and left empty', () => {
    fireEvent.blur(renderForm())
    expect(screen.getByText('Please enter a nickname')).toBeTruthy()
  })
})
