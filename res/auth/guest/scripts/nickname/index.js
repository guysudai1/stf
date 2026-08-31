require('./nickname.css')

module.exports = angular.module('stf.nickname', [
  require('stf/util/common').name,
  require('stf/common-ui').name
])
  .config(function($routeProvider) {
    $routeProvider
      .when('/auth/guest/', {
        template: require('./nickname.pug')
      })
  })
  .controller('NicknameCtrl', require('./nickname-controller'))
