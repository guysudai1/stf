/**
*  Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function GeneralCtrl($scope, AppState, ThemeService) {
  $scope.isAdmin = function() {
    return AppState.user.privilege === 'admin'
  }

  $scope.toggleTheme = ThemeService.toggle
}
