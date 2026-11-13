import {SimpleGrid} from '@mantine/core'
import {usePlatform} from '@/ui/modes'
import {ArrangedBlocks} from '../../layout/ArrangedBlocks'
import type {PaneProps} from '../../types'
import {AppsCard} from './apps/AppsCard'
import {ClipboardCard} from './clipboard/ClipboardCard'
import {InstallCard} from './install/InstallCard'
import {NavigationCard} from './navigation/NavigationCard'
import {RemoteDebugCard} from './remote-debug/RemoteDebugCard'
import {ShellCard} from './shell/ShellCard'
import {IosDeviceHealth} from '@/ui/IosDeviceHealth'
import {IosControlsCard} from './ios-controls/IosControlsCard'

export default function DashboardPane({device, control}: PaneProps) {
  const [platform] = usePlatform()

  const blocks = device.platform === 'iOS' ? [
    {id: 'ios-health', node: <IosDeviceHealth device={device} />}
    , {id: 'ios-controls', node: <IosControlsCard control={control} device={device} />}
    , {id: 'clipboard', node: <ClipboardCard control={control} inputOnly />}
    , {id: 'install', node: <InstallCard control={control} />}
  ] : [
    {id: 'navigation', node: <NavigationCard device={device} control={control} />}
    , {id: 'clipboard', node: <ClipboardCard control={control} />}
    , {id: 'install', node: <InstallCard control={control} />}
    , ...(platform === 'native' ? [{id: 'shell', node: <ShellCard control={control} />}] : [])
    , {id: 'apps', node: <AppsCard control={control} />}
    , {id: 'remote-debug', node: <RemoteDebugCard device={device} control={control} />}
  ]

  return (
    <ArrangedBlocks paneId='dashboard' blocks={blocks}>
      {(nodes) => (
        <SimpleGrid type='container' cols={{base: 1, '720px': 2}} spacing='md' verticalSpacing='md'>
          {nodes}
        </SimpleGrid>
      )}
    </ArrangedBlocks>
  )
}
