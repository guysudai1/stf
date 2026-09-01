/**
* Copyright © 2026 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = angular.module('stf.settings.general.device-timeout', [
  require('stf/settings').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put(
      'settings/general/device-timeout/device-timeout.pug'
    , require('./device-timeout.pug')
    )
  }])
  .controller('DeviceTimeoutCtrl', require('./device-timeout-controller'))
