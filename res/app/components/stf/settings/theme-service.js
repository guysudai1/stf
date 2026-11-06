module.exports = function ThemeServiceFactory($rootScope, SettingsService) {
  SettingsService.bind($rootScope, {
    target: 'darkTheme',
    // follows the OS preference until the user toggles
    defaultValue: !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  return {
    toggle: function() {
      $rootScope.darkTheme = !$rootScope.darkTheme
    }
  }
}
