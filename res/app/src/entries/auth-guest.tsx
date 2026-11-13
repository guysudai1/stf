import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {AuthProviders} from '@/ui/AuthProviders'
import {GuestForm} from '@/features/auth/GuestForm'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProviders>
      <GuestForm />
    </AuthProviders>
  </StrictMode>
)
