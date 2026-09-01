var path = require('path')
var boardModule = require('./server')

var port = Number(process.env.AGENT_BOARD_PORT || 7130)
var filePath = process.env.AGENT_BOARD_FILE ||
  path.join(process.cwd(), '.stf-agent-board', 'missions.json')
var workers = Number(process.env.AGENT_BOARD_WORKERS || 1)
var board = boardModule.createAgentBoard({filePath: filePath, workers: workers})

board.start().then(function() {
  board.server.listen(port, '127.0.0.1', function() {
    console.log('Agent board listening on http://127.0.0.1:' + port)
    console.log('Mission store: ' + filePath)
  })
}).catch(function(err) {
  console.error(err.stack || err)
  process.exitCode = 1
})

function shutdown() {
  board.close().then(function() {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
