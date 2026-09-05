require('./health-logs.css')

module.exports = angular.module('ui-health-logs', [])
  .config(['$routeProvider', function($routeProvider) {
    $routeProvider.when('/health-logs', {
      template: require('./health-logs.pug'),
      controller: 'HealthLogsCtrl'
    })
  }])
  .controller('HealthLogsCtrl', require('./health-logs-controller'))
