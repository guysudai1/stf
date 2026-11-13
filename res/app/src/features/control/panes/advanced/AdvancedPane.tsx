import {SimpleGrid} from '@mantine/core'
import {ArrangedBlocks} from '../../layout/ArrangedBlocks'
import type {PaneProps} from '../../types'
import {AdvancedInputCard} from './AdvancedInputCard'
import {MaintenanceCard} from './MaintenanceCard'
import {PortForwardingCard} from './PortForwardingCard'

export default function AdvancedPane({device, control}: PaneProps) {
  const blocks = [
    {id: 'advanced-input', node: <AdvancedInputCard control={control} />}
    , {id: 'port-forwarding', node: <PortForwardingCard device={device} control={control} />}
    , {id: 'maintenance', node: <MaintenanceCard control={control} />}
  ]
  return (
    <ArrangedBlocks paneId='advanced' blocks={blocks}>
      {(nodes) => (
        <SimpleGrid minColWidth='min(380px, 100%)' autoFlow='auto-fit' spacing='md' className='stf-advanced'>
          {nodes}
        </SimpleGrid>
      )}
    </ArrangedBlocks>
  )
}
