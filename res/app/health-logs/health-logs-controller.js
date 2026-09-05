module.exports = function HealthLogsCtrl($scope, $http, AppState, socket) {
  $scope.summary = null
  $scope.logs = []
  $scope.filters = {q: '', priority: ''}
  $scope.loading = true

  function load() {
    var params = []
    if ($scope.filters.q) {
      params.push('q=' + encodeURIComponent($scope.filters.q))
    }
    if ($scope.filters.priority) {
      params.push('priority=' + $scope.filters.priority)
    }
    $http.get('/api/v1/health/summary').then(function(response) {
      $scope.summary = response.data.summary
    })
    return $http.get('/api/v1/health/logs?' + params.join('&'))
      .then(function(response) {
        $scope.logs = response.data.logs || []
        $scope.loading = false
      })
  }

  if (AppState.user.privilege !== 'admin' && AppState.user.privilege !== 'root') {
    $scope.loading = false
    return
  }

  $scope.refresh = load
  $scope.$watchGroup(['filters.q', 'filters.priority'], function() {
    if ($scope.refresh) {
      load()
    }
  })

  socket.scoped($scope).on('health.log', function(entry) {
    if (!$scope.filters.q ||
        (entry.message + ' ' + entry.tag).toLowerCase().indexOf(
          $scope.filters.q.toLowerCase()) !== -1) {
      if (!$scope.filters.priority || entry.priority >= Number($scope.filters.priority)) {
        $scope.$evalAsync(function() {
          var liveEntry = Object.assign({}, entry)
          liveEntry.timestamp = Number(entry.timestamp) * 1000
          $scope.logs.unshift(liveEntry)
          $scope.logs = $scope.logs.slice(0, 1000)
        })
      }
    }
  })

  load()
}
