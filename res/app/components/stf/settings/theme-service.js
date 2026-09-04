module.exports = function ThemeServiceFactory($rootScope, SettingsService) {
  SettingsService.bind($rootScope, {
    target: 'darkTheme',
    defaultValue: false
  })

  return {
    toggle: function() {
      $rootScope.darkTheme = !$rootScope.darkTheme
    }
  }
}
