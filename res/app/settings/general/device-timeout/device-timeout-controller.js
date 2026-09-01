/**
* Copyright © 2026 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function DeviceTimeoutCtrl($scope, SettingsService) {
  var settingKey = 'deviceTimeout'
  var millisecondsPerSecond = 1000
  var minimumSeconds = 1
  var maximumSeconds = 86400

  $scope.deviceTimeoutError = false

  function isBlank(value) {
    return value === null || typeof value === 'undefined' || value === ''
  }

  function isValidSeconds(value) {
    return isBlank(value) ||
      typeof value === 'number' &&
      isFinite(value) &&
      Math.floor(value) === value &&
      value >= minimumSeconds &&
      value <= maximumSeconds
  }

  function millisecondsToSeconds(value) {
    if (isBlank(value)) {
      return ''
    }

    var seconds = value / millisecondsPerSecond
    return isValidSeconds(seconds) ? seconds : ''
  }

  $scope.canSaveDeviceTimeout = function() {
    return isValidSeconds($scope.deviceTimeoutSeconds)
  }

  $scope.saveDeviceTimeout = function() {
    if (!$scope.canSaveDeviceTimeout()) {
      $scope.deviceTimeoutError = true
      return
    }

    $scope.deviceTimeoutError = false
    if (isBlank($scope.deviceTimeoutSeconds)) {
      SettingsService.set(settingKey, null)
    }
    else {
      SettingsService.set(
        settingKey
      , $scope.deviceTimeoutSeconds * millisecondsPerSecond
      )
    }
  }

  $scope.resetDeviceTimeout = function() {
    $scope.deviceTimeoutSeconds = ''
    $scope.deviceTimeoutError = false
    SettingsService.set(settingKey, null)
  }

  $scope.$watch(
    function() {
      return SettingsService.get(settingKey)
    }
  , function(newValue) {
    $scope.deviceTimeoutSeconds = millisecondsToSeconds(newValue)
    $scope.deviceTimeoutError = false
  })

  $scope.$watch('deviceTimeoutSeconds', function(newValue) {
    $scope.deviceTimeoutError = !isValidSeconds(newValue)
  })
}
