require('ng-file-upload')
require('./provider-keys.css')

module.exports = angular.module('stf.settings.keys.provider-keys', [
  'angularFileUpload',
  require('stf/app-state').name,
  require('stf/common-ui').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put(
      'settings/keys/provider-keys/provider-keys.pug', require('./provider-keys.pug')
    )
  }])
  .controller('ProviderKeysCtrl', require('./provider-keys-controller'))
