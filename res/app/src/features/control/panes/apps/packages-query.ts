import {queryOptions} from '@tanstack/react-query'
import type {Control} from '@/core/control'
import {translate} from '@/core/i18n'
import {command, parse} from './parse-packages'

export function packagesQuery(control: Control, serial: string, includeSystem: boolean) {
  return queryOptions({
    queryKey: ['device-packages', serial, includeSystem]
    , queryFn: async() => {
      try {
        const result = await control.shell(command(includeSystem))
        return parse(result.data.join(''))
      }
      catch (err) {
        throw new Error((err instanceof Error && err.message) || translate('Could not list packages'))
      }
    }
    , staleTime: 0
    , gcTime: 30 * 60 * 1000
    , refetchOnWindowFocus: false
    , retry: false
  })
}
