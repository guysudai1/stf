/**
* Copyright © 2019 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

const _ = require('lodash')

module.exports = function DevicesCtrl(
  $scope
, DevicesService
, SettingsService
, ItemsPerPageOptionsService
, GenericModalService
, CommonService
) {
  const devicesBySerial = {}
  const deviceFields =
    'model,' +
    'serial,' +
    'version,' +
    'display.height,' +
    'display.width,' +
    'manufacturer,' +
    'sdk,' +
    'abi,' +
    'cpuPlatform,' +
    'openGLESVersion,' +
    'marketName,' +
    'phone.imei,' +
    'provider.name,' +
    'group.originName'


  function publishDevice(device) {
    if (!device.model) {
      device.display = {}
    }
    else {
      device.displayStr = device.display.width + 'x' + device.display.height
    }
    for (var i in device) {
      if (device[i] === null) {
        device[i] = ''
      }
    }
    return device
  }

  function addDevice(device, timeStamp) {
    return CommonService.add(
      $scope.devices
    , devicesBySerial
    , device
    , 'serial'
    , timeStamp)
  }

  function updateDevice(device, timeStamp) {
    return CommonService.update(
      $scope.devices
    , devicesBySerial
    , device
    , 'serial'
    , timeStamp)
  }

  function deleteDevice(serial, timeStamp) {
    return CommonService.delete(
      $scope.devices
    , devicesBySerial
    , serial
    , timeStamp)
  }

  function initScope() {
    DevicesService.getOboeDevices('user', deviceFields, function(device) {
      addDevice(publishDevice(device), -1)
    })
    .done(function() {
      $scope.$digest()
    })
  }

  SettingsService.bind($scope, {
    target: 'removingFilters'
  , source: 'DevicesRemovingFilters'
  , defaultValue: {
      present: 'False'
    , booked: 'False'
    , annotated: 'False'
    , controlled: 'False'
    }
  })
  $scope.devices = []
  $scope.confirmRemove = {value: true}
  $scope.scopeDevicesCtrl = $scope
  $scope.itemsPerPageOptions = ItemsPerPageOptionsService
  SettingsService.bind($scope, {
    target: 'deviceItemsPerPage'
  , source: 'deviceItemsPerPage'
  , defaultValue: $scope.itemsPerPageOptions[2]
  })
  $scope.removingFilterOptions = ['True', 'False', 'Any']

  $scope.removeDevice = function(serial, askConfirmation) {
    if (askConfirmation) {
      GenericModalService.open({
        message: 'Really delete this device?'
      , type: 'Warning'
      , size: 'sm'
      , cancel: true
      })
      .then(function() {
        CommonService.errorWrapper(
          DevicesService.removeDevice
        , [serial, $scope.removingFilters]
        )
      })
    }
    else {
      CommonService.errorWrapper(
        DevicesService.removeDevice
      , [serial, $scope.removingFilters]
      )
    }
  }

  $scope.removeDevices = function(search, filteredDevices, askConfirmation) {
    function removeDevices() {
      CommonService.errorWrapper(
        DevicesService.removeDevices
      , search ?
          [$scope.removingFilters, filteredDevices.map(function(device) {
            return device.serial
          })
          .join()] :
          [$scope.removingFilters]
      )
    }

    if (askConfirmation) {
      GenericModalService.open({
        message: 'Really delete this selection of devices?'
      , type: 'Warning'
      , size: 'sm'
      , cancel: true
      })
      .then(function() {
        removeDevices()
      })
    }
    else {
      removeDevices()
    }
  }

  $scope.$on('user.settings.devices.created', function(event, message) {
    addDevice(publishDevice(message.device), message.timeStamp)
  })

  $scope.$on('user.settings.devices.deleted', function(event, message) {
    deleteDevice(message.device.serial, message.timeStamp)
  })

  $scope.$on('user.settings.devices.updated', function(event, message) {
    updateDevice(publishDevice(message.device), message.timeStamp)
  })

  $scope.shellAll = {command: '', force: false, running: false, response: null}

  $scope.shellStatus = function(result) {
    if (result.success === null) {
      return 'timed out'
    }
    return result.success ? 'ok' : 'failed'
  }

  $scope.runShellAll = function() {
    var command = $scope.shellAll.command
    $scope.shellAll.running = true
    $scope.shellAll.response = null
    DevicesService.runShell(command, $scope.shellAll.force)
      .then(function(response) {
        $scope.shellAll.response = response.data
        $scope.shellAll.response.command = command
      })
      .catch(function(response) {
        $scope.shellAll.response = {
          description: (response.data && response.data.description) || 'Request failed'
        , results: []
        , skipped: []
        }
      })
      .finally(function() {
        $scope.shellAll.running = false
      })
  }

  function csvCell(value) {
    return '"' + String(value === null || typeof value === 'undefined' ? '' : value)
      .replace(/"/g, '""') + '"'
  }

  $scope.exportShellAll = function() {
    var response = $scope.shellAll.response
    var rows = [['command', 'serial', 'status', 'output']]
      .concat(response.results.map(function(result) {
        return [response.command, result.serial, $scope.shellStatus(result),
          result.data || result.error]
      }))
      .concat(response.skipped.map(function(skip) {
        return [response.command, skip.serial, 'skipped', skip.reason]
      }))
    var csv = rows.map(function(row) {
      return row.map(csvCell).join(',')
    }).join('\r\n')

    var link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}))
    link.download = 'shell-all-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  initScope()
}
