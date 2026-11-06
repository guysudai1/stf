require('./packages.css')

module.exports = angular.module('stf.packages', [])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/packages/packages.pug',
      require('./packages.pug')
    )
  }])
  .controller('PackagesCtrl', require('./packages-controller'))
  .directive('resizableColumn', require('./resizable-column-directive'))
