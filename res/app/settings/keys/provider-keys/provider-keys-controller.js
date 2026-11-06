module.exports = function ProviderKeysCtrl($scope, $http, $filter, gettext, AppState) {
  $scope.isAdmin = AppState.user.privilege === 'admin'
  $scope.upload = {}

  function fail(response) {
    $scope.error = response.data && response.data.description || 'Request failed'
  }

  function load() {
    return $http.get('/api/v1/adbkeys').then(function(response) {
      $scope.configured = response.data.configured
      $scope.keys = response.data.keys
    }, fail)
  }

  $scope.readKey = function($files) {
    var file = $files[0]
    $scope.error = null
    if (!file) {
      return
    }
    var reader = new FileReader()
    reader.onload = function() {
      $scope.$apply(function() {
        $scope.upload.key = reader.result
        $scope.upload.fileName = file.name
        if (!$scope.upload.name) {
          $scope.upload.name = file.name.replace(/\.adb_key$/, '').replace(/[^\w.-]/g, '_')
        }
      })
    }
    reader.readAsText(file)
  }

  $scope.addKey = function() {
    $scope.error = null
    return $http.post('/api/v1/adbkeys', {name: $scope.upload.name, key: $scope.upload.key})
      .then(load, fail)
      .finally(function() {
        $scope.upload = {}
      })
  }

  $scope.removeKey = function(key) {
    if (confirm($filter('translate')(gettext('Delete this ADB key?')) + '\n' + key.name)) {
      $scope.error = null
      $http.delete('/api/v1/adbkeys/' + encodeURIComponent(key.name)).then(load, fail)
    }
  }

  if ($scope.isAdmin) {
    load()
  }
}
