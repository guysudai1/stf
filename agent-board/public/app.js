(() => {
  'use strict'

  const COLUMNS = ['queued', 'active', 'blocked', 'completed']
  const STATUS_LABELS = { queued: 'Queued', active: 'In motion', blocked: 'Attention', completed: 'Done' }
  const EMPTY_COPY = {
    queued: ['Nothing waiting', 'Add a mission to keep the crew moving.'],
    active: ['No active missions', 'Claimed work will appear here.'],
    blocked: ['Clear skies', 'Missions needing a nudge will appear here.'],
    completed: ['Nothing shipped yet', 'Completed missions will land here.']
  }
  const state = {
    missions: [],
    agents: [],
    filter: 'all',
    query: '',
    sse: null,
    pollTimer: null,
    reconnectTimer: null,
    pending: new Set(),
    lastUpdated: null
  }

  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))

  function collection(payload, keys) {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== 'object') return []
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key]
    }
    if (payload.data && Array.isArray(payload.data)) return payload.data
    return []
  }

  function value(raw, keys, fallback = '') {
    for (const key of keys) {
      if (raw && raw[key] !== undefined && raw[key] !== null) return raw[key]
    }
    return fallback
  }

  function normalizeStatus(status) {
    const normalized = String(status || '').toLowerCase().replace(/[- ]/g, '_')
    if (['active', 'assigned', 'claimed', 'running', 'in_progress', 'processing'].includes(normalized)) return 'active'
    if (['blocked', 'failed', 'error', 'paused', 'needs_attention'].includes(normalized)) return 'blocked'
    if (['completed', 'complete', 'done', 'success', 'succeeded', 'shipped', 'closed'].includes(normalized)) return 'completed'
    return 'queued'
  }

  function normalizeMission(raw, index) {
    const originalStatus = value(raw, ['status', 'state'], 'queued')
    return {
      ...raw,
      id: String(value(raw, ['id', 'missionId', '_id'], `mission-${index}`)),
      title: String(value(raw, ['title', 'name'], 'Untitled mission')),
    description: String(value(raw, ['description', 'prompt', 'brief', 'details'], '')),
      priority: String(value(raw, ['priority', 'urgency'], 'medium')).toLowerCase(),
      status: normalizeStatus(originalStatus),
      statusLabel: String(originalStatus).replace(/_/g, ' '),
      agentId: value(raw, ['agentId', 'agent_id', 'assignedAgentId', 'assigned_to'], ''),
      agentName: value(raw, ['agentName', 'agent_name', 'assignee'], ''),
      createdAt: value(raw, ['createdAt', 'created_at', 'created', 'updatedAt', 'updated_at'], ''),
      updatedAt: value(raw, ['updatedAt', 'updated_at', 'createdAt', 'created_at'], ''),
      retryCount: Number(value(raw, ['retryCount', 'retry_count', 'retries'], 0)) || 0
    }
  }

  function normalizeAgent(raw, index) {
    const originalStatus = String(value(raw, ['status', 'state'], 'offline')).toLowerCase()
    let status = 'offline'
    if (['online', 'idle', 'available', 'ready'].includes(originalStatus)) status = 'idle'
    if (['busy', 'working', 'active', 'running', 'assigned'].includes(originalStatus)) status = 'working'
    if (['away', 'paused'].includes(originalStatus)) status = 'away'
    return {
      ...raw,
      id: String(value(raw, ['id', 'agentId', '_id'], `agent-${index}`)),
      name: String(value(raw, ['name', 'displayName', 'agentName'], `Agent ${index + 1}`)),
      status,
      statusLabel: status === 'working' ? 'Working' : status === 'idle' ? 'Available' : status === 'away' ? 'Away' : 'Offline',
      task: String(value(raw, ['missionTitle', 'currentMission', 'task'], 'Ready for a mission'))
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    })
    if (!response.ok) {
      let detail = ''
      try { detail = (await response.json()).message || '' } catch (error) { /* non-JSON error */ }
      throw new Error(detail || `Request failed (${response.status})`)
    }
    if (response.status === 204) return null
    return response.json()
  }

  async function refreshAll({ silent = false } = {}) {
    if (!silent) $('#board-section').setAttribute('aria-busy', 'true')
    const results = await Promise.allSettled([
      request('/api/missions'),
      request('/api/agents'),
      request('/api/integrations')
    ])
    let failed = 0
    if (results[0].status === 'fulfilled') state.missions = collection(results[0].value, ['missions', 'items']).map(normalizeMission)
    else failed += 1
    if (results[1].status === 'fulfilled') state.agents = collection(results[1].value, ['agents', 'items']).map(normalizeAgent)
    else failed += 1
    if (results[2].status === 'fulfilled') updateSimplexStatus(results[2].value.simplex)
    else failed += 1
    state.lastUpdated = new Date()
    render()
    if (!silent) $('#board-section').setAttribute('aria-busy', 'false')
    if (failed === 2) throw new Error('Missions and agents could not be loaded')
    if (failed === 1 && !silent) showToast('Some board data could not be refreshed', true)
  }

  function updateSimplexStatus(simplex) {
    const status = $('#simplex-status')
    if (!status || !simplex) return
    status.classList.remove('is-live', 'is-polling', 'is-error')
    const label = $('.connection-label', status)
    if (simplex.status === 'connected') {
      status.classList.add('is-live')
      label.textContent = `SimpleX · ${simplex.contact || 'connected'}`
    } else if (simplex.status === 'disabled') {
      label.textContent = 'SimpleX disabled'
    } else {
      status.classList.add('is-error')
      label.textContent = `SimpleX · ${simplex.status}`
    }
  }

  function filteredMissions() {
    const query = state.query.trim().toLowerCase()
    return state.missions.filter((mission) => {
      const matchesFilter = state.filter === 'all' || mission.status === state.filter
      const haystack = `${mission.title} ${mission.description} ${mission.agentName}`.toLowerCase()
      return matchesFilter && (!query || haystack.includes(query))
    })
  }

  function render() {
    const visible = filteredMissions()
    const counts = { queued: 0, active: 0, blocked: 0, completed: 0 }
    visible.forEach((mission) => { counts[mission.status] += 1 })
    COLUMNS.forEach((column) => {
      $(`[data-count-for="${column}"]`).textContent = counts[column]
      const stack = $(`[data-stack-for="${column}"]`)
      stack.replaceChildren()
      const missions = visible.filter((mission) => mission.status === column).sort(sortMissions)
      if (!missions.length) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.innerHTML = `<div><strong>${EMPTY_COPY[column][0]}</strong>${EMPTY_COPY[column][1]}</div>`
        stack.append(empty)
      } else missions.forEach((mission) => stack.append(createMissionCard(mission)))
    })
    $('#stat-active').textContent = state.missions.filter((mission) => mission.status === 'active').length
    $('#stat-queued').textContent = state.missions.filter((mission) => mission.status === 'queued').length
    $('#stat-completed').textContent = state.missions.filter((mission) => mission.status === 'completed').length
    const available = state.agents.filter((agent) => agent.status === 'idle').length
    $('#stat-agents').textContent = available
    $('#stat-agents-footnote').textContent = `${state.agents.length} total · ${available} available`
    $('#agent-count').textContent = state.agents.length
    renderAgents()
    if (state.lastUpdated) $('#last-updated').textContent = `Last synced ${formatTime(state.lastUpdated.toISOString())}`
  }

  function sortMissions(a, b) {
    const priority = { high: 0, medium: 1, low: 2 }
    const priorityDelta = (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1)
    if (priorityDelta) return priorityDelta
    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  }

  function createMissionCard(mission) {
    const card = document.createElement('article')
    card.className = 'mission-card'
    card.dataset.missionId = mission.id
    const top = document.createElement('div')
    top.className = 'card-topline'
    const priority = document.createElement('span')
    priority.className = `priority priority-${['high', 'medium', 'low'].includes(mission.priority) ? mission.priority : 'medium'}`
    priority.textContent = mission.priority
    const status = document.createElement('span')
    status.className = 'card-status'
    status.textContent = STATUS_LABELS[mission.status]
    top.append(priority, status)
    const title = document.createElement('h4')
    title.textContent = mission.title
    card.append(top, title)
    if (mission.description) {
      const description = document.createElement('p')
      description.className = 'mission-description'
      description.textContent = mission.description
      card.append(description)
    }
    const footer = document.createElement('div')
    footer.className = 'card-footer'
    const agent = document.createElement('span')
    agent.className = 'card-agent'
    const avatar = document.createElement('span')
    avatar.className = `avatar${mission.status === 'active' ? ' avatar-mint' : ''}`
    const assignedName = mission.agentName || findAgentName(mission.agentId) || (mission.status === 'queued' ? 'Unassigned' : 'Agent crew')
    avatar.textContent = initials(assignedName)
    const agentLabel = document.createElement('span')
    agentLabel.textContent = assignedName
    agent.append(avatar, agentLabel)
    const time = document.createElement('span')
    time.className = 'card-time'
    time.textContent = formatTime(mission.updatedAt || mission.createdAt)
    footer.append(agent, time)
    card.append(footer)
    const actions = document.createElement('div')
    actions.className = 'card-actions'
    if (mission.status === 'queued') actions.append(actionButton('Claim', 'claim', mission))
    if (mission.status === 'blocked') actions.append(actionButton('Retry mission', 'retry', mission, true))
    if (actions.childElementCount) card.append(actions)
    return card
  }

  function actionButton(label, action, mission, retry = false) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `card-action${retry ? ' card-action-retry' : ''}`
    button.textContent = label
    button.dataset.action = action
    button.dataset.missionId = mission.id
    button.disabled = state.pending.has(`${action}:${mission.id}`)
    button.addEventListener('click', () => mutateMission(mission, action, button))
    return button
  }

  function renderAgents() {
    const list = $('#agent-list')
    list.replaceChildren()
    if (!state.agents.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      empty.textContent = 'No agents have checked in yet.'
      list.append(empty)
      return
    }
    state.agents.slice().sort((a, b) => ({ working: 0, idle: 1, away: 2, offline: 3 }[a.status] - { working: 0, idle: 1, away: 2, offline: 3 }[b.status])).forEach((agent) => {
      const item = document.createElement('div')
      item.className = `agent-item is-${agent.status}`
      const avatar = document.createElement('span')
      avatar.className = `agent-avatar ${agent.status === 'working' ? 'agent-avatar-mint' : agent.status === 'away' ? 'agent-avatar-coral' : ''}`
      avatar.textContent = initials(agent.name)
      const detail = document.createElement('div')
      const name = document.createElement('div')
      name.className = 'agent-name'
      name.textContent = agent.name
      const task = document.createElement('div')
      task.className = 'agent-task'
      task.textContent = agent.status === 'working' ? agent.task : agent.status === 'idle' ? 'Ready for a mission' : agent.statusLabel
      detail.append(name, task)
      const side = document.createElement('div')
      const status = document.createElement('div')
      status.className = 'agent-status'
      status.textContent = agent.statusLabel
      side.append(status)
      if (agent.status === 'working') {
        const stop = document.createElement('button')
        stop.type = 'button'
        stop.className = 'stop-agent'
        stop.textContent = 'Stop'
        stop.dataset.agentId = agent.id
        stop.addEventListener('click', () => stopAgent(agent, stop))
        side.append(stop)
      }
      item.append(avatar, detail, side)
      list.append(item)
    })
  }

  async function mutateMission(mission, action, button) {
    const key = `${action}:${mission.id}`
    state.pending.add(key)
    button.disabled = true
    try {
      if (action === 'claim') await request(`/api/missions/${encodeURIComponent(mission.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'claimed' }) })
      else await request(`/api/missions/${encodeURIComponent(mission.id)}/retry`, { method: 'POST', body: JSON.stringify({}) })
      showToast(action === 'claim' ? 'Mission claimed by the crew' : 'Mission sent back to the queue')
      await refreshAll({ silent: true })
    } catch (error) {
      showToast(error.message, true)
      button.disabled = false
    } finally {
      state.pending.delete(key)
    }
  }

  async function stopAgent(agent, button) {
    button.disabled = true
    try {
      await request(`/api/agents/${encodeURIComponent(agent.id)}/stop`, { method: 'POST', body: JSON.stringify({}) })
      showToast(`${agent.name} was asked to stop`)
      await refreshAll({ silent: true })
    } catch (error) {
      showToast(error.message, true)
      button.disabled = false
    }
  }

  async function createMission(event) {
    event.preventDefault()
    const form = event.currentTarget
    const error = $('#form-error')
    error.hidden = true
    const data = new FormData(form)
    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      await request('/api/missions', {
        method: 'POST',
        body: JSON.stringify({ title: data.get('title').trim(), prompt: data.get('description').trim() || data.get('title').trim(), priority: data.get('priority'), status: 'queued' })
      })
      form.reset()
      $('#mission-dialog').close()
      showToast('Mission added to the queue')
      await refreshAll({ silent: true })
    } catch (requestError) {
      error.textContent = requestError.message
      error.hidden = false
    } finally {
      submit.disabled = false
    }
  }

  function connectSse() {
    if (!window.EventSource) return startPolling()
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
    if (state.sse) state.sse.close()
    state.sse = new EventSource('/api/events')
    state.sse.onopen = () => { setConnection('live'); stopPolling(); $('#sync-copy').textContent = 'Live with the crew' }
    state.sse.onmessage = handleSseEvent
    state.sse.addEventListener('mission', handleSseEvent)
    state.sse.addEventListener('agent', handleSseEvent)
    state.sse.onerror = () => {
      if (!state.sse) return
      state.sse.close()
      state.sse = null
      setConnection('polling')
      $('#sync-copy').textContent = 'Using a steady polling connection'
      startPolling()
      state.reconnectTimer = setTimeout(connectSse, 30000)
    }
  }

  function handleSseEvent(event) {
    let payload = null
    try { payload = JSON.parse(event.data) } catch (error) { /* event is a refresh signal */ }
    const missions = collection(payload, ['missions', 'mission'])
    const agents = collection(payload, ['agents', 'agent'])
    if (missions.length) state.missions = missions.map(normalizeMission)
    if (agents.length) state.agents = agents.map(normalizeAgent)
    if (missions.length || agents.length) { state.lastUpdated = new Date(); render() }
    else refreshAll({ silent: true }).catch(() => setConnection('error'))
  }

  function startPolling() {
    if (state.pollTimer) return
    refreshAll({ silent: true }).catch(() => setConnection('error'))
    state.pollTimer = setInterval(() => refreshAll({ silent: true }).catch(() => setConnection('error')), 10000)
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer)
    state.pollTimer = null
  }

  function setConnection(mode) {
    const status = $('#connection-status')
    status.classList.remove('is-live', 'is-polling', 'is-error')
    if (mode === 'live') { status.classList.add('is-live'); $('.connection-label', status).textContent = 'Live updates' }
    else if (mode === 'polling') { status.classList.add('is-polling'); $('.connection-label', status).textContent = 'Polling fallback' }
    else if (mode === 'error') { status.classList.add('is-error'); $('.connection-label', status).textContent = 'Sync unavailable' }
    else $('.connection-label', status).textContent = 'Connecting…'
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div')
    toast.className = `toast${isError ? ' is-error' : ''}`
    toast.textContent = message
    $('#toast-region').append(toast)
    setTimeout(() => toast.remove(), 4200)
  }

  function findAgentName(id) {
    const agent = state.agents.find((candidate) => String(candidate.id) === String(id))
    return agent ? agent.name : ''
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'
  }

  function formatTime(valueToFormat) {
    if (!valueToFormat) return '—'
    const date = new Date(valueToFormat)
    if (Number.isNaN(date.getTime())) return '—'
    const seconds = Math.round((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return 'now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function openDialog() {
    const dialog = $('#mission-dialog')
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    setTimeout(() => $('#mission-title').focus(), 0)
  }

  function closeDialog() {
    const dialog = $('#mission-dialog')
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  function bindEvents() {
    $('#open-mission-button').addEventListener('click', openDialog)
    $('#close-dialog-button').addEventListener('click', closeDialog)
    $('#cancel-dialog-button').addEventListener('click', closeDialog)
    $('#mission-form').addEventListener('submit', createMission)
    $('#refresh-button').addEventListener('click', () => {
      setConnection('connecting')
      refreshAll().then(() => showToast('Board refreshed')).catch((error) => showToast(error.message, true))
    })
    $('#mission-filter').addEventListener('change', (event) => { state.filter = event.target.value; render() })
    $('#mission-search').addEventListener('input', (event) => { state.query = event.target.value; render() })
    $('#mission-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeDialog() })
  }

  async function init() {
    bindEvents()
    setConnection('connecting')
    try { await refreshAll() } catch (error) { setConnection('error'); showToast(error.message, true) }
    connectSse()
  }

  init()
})()
