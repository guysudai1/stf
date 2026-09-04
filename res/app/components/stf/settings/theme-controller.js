module.exports = function ThemeCtrl($scope, ThemeService) {
  $scope.toggleTheme = ThemeService.toggle
}
