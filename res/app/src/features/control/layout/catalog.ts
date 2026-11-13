import {gettext} from '@/core/i18n'

// Block ids match the ids each pane passes to ArrangedBlocks.
const blockTitles: Record<string, Record<string, string>> = {
  dashboard: {
    'ios-health': gettext('iPhone status')
    , 'ios-controls': gettext('iPhone controls')
    , navigation: gettext('Navigation')
    , clipboard: gettext('Clipboard')
    , install: gettext('App Upload')
    , shell: gettext('Shell')
    , apps: gettext('Apps')
    , 'remote-debug': gettext('Remote debug')
  }
  , advanced: {
    'advanced-input': gettext('Advanced Input')
    , 'port-forwarding': gettext('Port Forwarding')
    , maintenance: gettext('Maintenance')
  }
  , automation: {
    'store-account': gettext('Store Account')
    , 'device-settings': gettext('Device Settings')
  }
  , info: {
    'ios-health': gettext('iPhone status')
    , physical: gettext('Physical Device')
    , battery: gettext('Battery')
    , display: gettext('Display')
    , network: gettext('Network')
    , sim: gettext('SIM')
    , hardware: gettext('Hardware')
    , platform: gettext('Platform')
    , cpu: gettext('CPU')
    , memory: gettext('Memory')
  }
}

export function blockTitle(paneId: string, id: string): string | undefined {
  return blockTitles[paneId]?.[id]
}
