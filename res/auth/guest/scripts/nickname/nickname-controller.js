/**
* Copyright © 2026 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function NicknameCtrl($window, $scope, $http) {
  $window.angular.version = {}
  $scope.error = null

  $scope.submit = function() {
    $scope.error = null
    $http.post('/auth/api/v1/guest', {
      name: $scope.nickname
    })
      .then(function(response) {
        location.replace(response.data.redirect)
      })
      .catch(function(response) {
        $scope.error = response.data && response.data.error === 'ValidationError'
          ? 'invalid'
          : 'server'
      })
  }
}
