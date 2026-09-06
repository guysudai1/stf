module.exports = function HealthLogsCtrl($scope, $http, AppState, socket) {
  $scope.summary = null
  $scope.logs = []
  $scope.filters = {q: '', priority: ''}
  $scope.loading = true
  $scope.error = null

  function present(entry) {
    var priority = Number(entry.priority)
    var levels = {
      1: ['debug', 'Debug']
    , 2: ['verbose', 'Verbose']
    , 3: ['info', 'Info']
    , 4: ['important', 'Important']
    , 5: ['warning', 'Warning']
    , 6: ['error', 'Error']
    , 7: ['fatal', 'Fatal']
    }
    var level = levels[priority] || ['unknown', 'Unknown']
    var message = String(entry.message || '')
    var newline = message.search(/\r?\n/)

    return Object.assign({}, entry, {
      priority: priority
    , severity: level[0]
    , levelLabel: level[1]
    , messageSummary: newline === -1 ? message : message.slice(0, newline)
    , details: newline === -1 ? '' : message.slice(newline).replace(/^\r?\n/, '')
    })
  }

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
    $http.get('/api/v1/health/summary').then(function(response) {
      $scope.summary = response.data.summary
    }).catch(function() {
      $scope.error = 'Unable to load the health summary.'
    })
    return $http.get('/api/v1/health/logs?' + params.join('&'))
      .then(function(response) {
        $scope.logs = (response.data.logs || []).map(present)
        $scope.loading = false
      }).catch(function() {
        $scope.logs = []
        $scope.loading = false
        $scope.error = 'Unable to load health logs.'
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
    var liveEntry = present(entry)
    if (!$scope.filters.q ||
        (liveEntry.message + ' ' + liveEntry.tag + ' ' +
          (liveEntry.serial || '')).toLowerCase().indexOf(
          $scope.filters.q.toLowerCase()) !== -1) {
      if (!$scope.filters.priority || liveEntry.priority >= Number($scope.filters.priority)) {
        $scope.$evalAsync(function() {
          liveEntry.timestamp = Number(entry.timestamp) * 1000
          $scope.logs.unshift(liveEntry)
          $scope.logs = $scope.logs.slice(0, 1000)
        })
      }
    }
  })
}
