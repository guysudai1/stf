var packages = require('./parse-packages')

module.exports = function PackagesCtrl($scope) {
  $scope.packages = {
    rows: []
  , includeSystem: false
  , loading: false
  , error: null
  , search: ''
  , sort: 'name'
  , reverse: false
  }

  $scope.packageColumns = [
    {field: 'name', title: 'App', width: 320}
  , {field: 'versionName', title: 'Version', width: 140}
  , {field: 'versionCode', title: 'Code', width: 100}
  , {field: 'targetSdk', title: 'Target SDK', width: 100}
  , {field: 'firstInstallTime', title: 'Installed', width: 160}
  , {field: 'lastUpdateTime', title: 'Updated', width: 160}
  , {field: 'md5', title: 'MD5', width: 280}
  ]

  $scope.packageTableWidth = function() {
    return $scope.packageColumns.reduce(function(sum, column) {
      return sum + column.width
    }, 0)
  }

  $scope.loadPackages = function() {
    var state = $scope.packages
    if (!$scope.control) {
      return
    }
    state.loading = true
    state.error = null
    $scope.control.shell(packages.command(state.includeSystem))
      .then(function(result) {
        state.rows = packages.parse(result.data.join(''))
      })
      .catch(function(err) {
        state.error = (err && err.message) || 'Could not list packages'
      })
      .finally(function() {
        state.loading = false
        $scope.$digest()
      })
  }

  $scope.sortPackages = function(field) {
    var state = $scope.packages
    state.reverse = state.sort === field ? !state.reverse : false
    state.sort = field
  }

  // Hashing every APK up front would be slow, so MD5 is fetched per row.
  $scope.loadMd5 = function(row) {
    row.md5 = '…'
    $scope.control.shell('md5sum \'' + row.path + '\'')
      .then(function(result) {
        row.md5 = result.data.join('').split(/\s/)[0] || 'unavailable'
      })
      .catch(function() {
        row.md5 = 'unavailable'
      })
      .finally(function() {
        $scope.$digest()
      })
  }

  $scope.$watch('control', $scope.loadPackages)
}
