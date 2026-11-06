// Drag the right edge of a <th resizable-column='column'> to set column.width.
module.exports = function ResizableColumnDirective() {
  var MIN_WIDTH = 40

  return {
    restrict: 'A'
  , scope: {
      column: '=resizableColumn'
    }
  , link: function(scope, element) {
      var th = element[0]
      var handle = document.createElement('span')
      var resized = false

      handle.className = 'column-resize-handle'
      th.appendChild(handle)

      handle.addEventListener('mousedown', function(event) {
        var startX = event.pageX
        var startWidth = th.offsetWidth

        function move(e) {
          scope.$apply(function() {
            scope.column.width = Math.max(MIN_WIDTH, startWidth + e.pageX - startX)
          })
        }

        function up() {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
        }

        resized = true
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
        event.preventDefault()
      })

      // The mouseup that ends a drag also clicks the header; don't let it sort.
      th.addEventListener('click', function(event) {
        if (resized) {
          resized = false
          event.stopImmediatePropagation()
        }
      }, true)
    }
  }
}
