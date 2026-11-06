module.exports = function HealthLogsCtrl($scope, $http, AppState, socket) {
  $scope.summary = null
  $scope.logs = []
  $scope.filters = {q: '', priority: ''}
  $scope.loading = true
  $scope.error = null

  function load() {
    $scope.loading = true
    $scope.error = null
    var params = []
    if ($scope.filters.q) {
      params.push('q=' + encodeURIComponent($scope.filters.q))
    }
    if ($scope.filters.priority) {
      params.push('priority=' + $scope.filters.priority)
    }
    return $http.get('/api/v1/health/logs?' + params.join('&'))
      .then(function(response) {
        $scope.logs = response.data.logs || []
        $scope.loading = false
      }).catch(function() {
        $scope.logs = []
        $scope.loading = false
        $scope.error = 'Unable to load health logs.'
      })
  }

  if (AppState.user.privilege !== 'admin') {
    $scope.loading = false
    return
  }

  function loadSummary() {
    $http.get('/api/v1/health/summary').then(function(response) {
      $scope.summary = response.data.summary
    }).catch(function() {
      $scope.error = 'Unable to load the health summary.'
    })
  }

  $scope.refresh = function() {
    loadSummary()
    load()
  }
  loadSummary()
  $scope.$watchGroup(['filters.q', 'filters.priority'], load)

  socket.scoped($scope).on('health.log', function(liveEntry) {
    if (!$scope.filters.q ||
        (liveEntry.message + ' ' + liveEntry.tag + ' ' +
          (liveEntry.serial || '')).toLowerCase().indexOf(
          $scope.filters.q.toLowerCase()) !== -1) {
      if (!$scope.filters.priority || liveEntry.priority >= Number($scope.filters.priority)) {
        $scope.$evalAsync(function() {
          $scope.logs.unshift(liveEntry)
          $scope.logs = $scope.logs.slice(0, 1000)
        })
      }
    }
  })
}
