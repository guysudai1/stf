module.exports = angular.module('stf/settings', [
  require('stf/user').name,
  require('stf/socket').name
])
  .factory('SettingsService', require('./settings-service'))
  .factory('ThemeService', require('./theme-service'))
  .controller('ThemeCtrl', require('./theme-controller'))
