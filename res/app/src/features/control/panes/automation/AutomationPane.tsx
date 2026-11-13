import {SimpleGrid} from '@mantine/core'
import {ArrangedBlocks} from '../../layout/ArrangedBlocks'
import type {PaneProps} from '../../types'
import {DeviceSettingsCard} from './DeviceSettingsCard'
import {StoreAccountCard} from './StoreAccountCard'

export default function AutomationPane({control}: PaneProps) {
  const blocks = [
    {id: 'store-account', node: <StoreAccountCard control={control} />}
    , {id: 'device-settings', node: <DeviceSettingsCard control={control} />}
  ]
  return (
    <ArrangedBlocks paneId='automation' blocks={blocks}>
      {(nodes) => (
        <SimpleGrid minColWidth='min(380px, 100%)' autoFlow='auto-fit' spacing='md' className='stf-automation'>
          {nodes}
        </SimpleGrid>
      )}
    </ArrangedBlocks>
  )
}
