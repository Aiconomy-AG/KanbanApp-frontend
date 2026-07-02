import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  apiRequest,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from './lib/api'

const ACTIVE_BOARD_KEY = 'kanban_active_board_id'

const createEmptyTicketDraft = () => ({
  title: '',
  description: '',
  priority: 'medium',
})

function App() {
  const [token, setToken] = useState(getStoredToken())
  const [user, setUser] = useState(null)
  const [boards, setBoards] = useState([])
  const [activeBoardId, setActiveBoardId] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_BOARD_KEY)
    return stored ? Number(stored) : null
  })
  const [loading, setLoading] = useState(Boolean(token))
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({
    username: '',
    password: '',
  })
  const [ticketForm, setTicketForm] = useState(createEmptyTicketDraft())
  const [ticketColumnId, setTicketColumnId] = useState('')
  const [editingTicketId, setEditingTicketId] = useState(null)
  const [editingTicketForm, setEditingTicketForm] = useState(createEmptyTicketDraft())
  const [draggingTicketId, setDraggingTicketId] = useState(null)
  const [draggingColumnId, setDraggingColumnId] = useState(null)
  const [dragOverColumnId, setDragOverColumnId] = useState(null)
  const [editingColumnId, setEditingColumnId] = useState(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [showNewColumnForm, setShowNewColumnForm] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [showCreateBoardForm, setShowCreateBoardForm] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [trelloStatus, setTrelloStatus] = useState({ connected: false, links: [] })
  const [trelloApiKey, setTrelloApiKey] = useState('')
  const [showTrelloLinkModal, setShowTrelloLinkModal] = useState(false)
  const [trelloBoardOptions, setTrelloBoardOptions] = useState([])
  const [selectedTrelloBoardId, setSelectedTrelloBoardId] = useState('')
  const [trelloListOptions, setTrelloListOptions] = useState([])
  const [columnMappings, setColumnMappings] = useState({})
  const [mappingColumnId, setMappingColumnId] = useState(null)
  const [mappingListId, setMappingListId] = useState('')
  const [mappingCreateName, setMappingCreateName] = useState('')
  const [toasts, setToasts] = useState([])
  const [pollSince, setPollSince] = useState(() => new Date().toISOString())

  const board = useMemo(
    () => boards.find((item) => item.id === activeBoardId) ?? null,
    [boards, activeBoardId],
  )

  const boardTrelloLink = board?.trello_link ?? null
  const unmappedColumns = useMemo(
    () => (board?.columns ?? []).filter((column) => boardTrelloLink && !column.trello_list_id),
    [board, boardTrelloLink],
  )

  function showToast(message) {
    const id = Date.now()
    setToasts((current) => [...current, { id, message }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 3500)
  }

  function selectBoard(boardId) {
    setActiveBoardId(boardId)
    localStorage.setItem(ACTIVE_BOARD_KEY, String(boardId))
  }

  function upsertBoard(updatedBoard) {
    setBoards((current) => {
      const exists = current.some((item) => item.id === updatedBoard.id)

      if (!exists) {
        return [...current, updatedBoard]
      }

      return current.map((item) => (item.id === updatedBoard.id ? updatedBoard : item))
    })
  }

  async function loadBoards(nextToken = token, preferredBoardId = activeBoardId) {
    if (!nextToken) {
      return []
    }

    const [me, boardsResponse] = await Promise.all([
      apiRequest('/api/me', { token: nextToken }),
      apiRequest('/api/boards', { token: nextToken }),
    ])

    const nextBoards = boardsResponse.boards ?? []
    const nextActiveId = nextBoards.some((item) => item.id === preferredBoardId)
      ? preferredBoardId
      : nextBoards[0]?.id ?? null

    setUser(me.user)
    setBoards(nextBoards)

    if (nextActiveId) {
      selectBoard(nextActiveId)
    } else {
      setActiveBoardId(null)
      localStorage.removeItem(ACTIVE_BOARD_KEY)
    }

    const activeBoard = nextBoards.find((item) => item.id === nextActiveId) ?? null

    if (activeBoard?.columns?.length) {
      setTicketColumnId((current) => {
        const hasCurrent = activeBoard.columns.some((column) => String(column.id) === current)

        return hasCurrent ? current : String(activeBoard.columns[0].id)
      })
    }

    return nextBoards
  }

  async function loadTrelloStatus(nextToken = token) {
    if (!nextToken) {
      return
    }

    try {
      const [config, status] = await Promise.all([
        apiRequest('/api/trello/config', { token: nextToken }),
        apiRequest('/api/trello/status', { token: nextToken }),
      ])
      setTrelloApiKey(config.api_key ?? '')
      setTrelloStatus(status)
    } catch {
      // Trello not configured yet.
    }
  }

  async function handleConnectTrello() {
    if (!token) {
      return
    }

    if (!trelloApiKey) {
      await loadTrelloStatus(token)
    }

    if (!trelloApiKey) {
      setError('Trello API key is not configured on the server.')
      return
    }

    const returnUrl = `${window.location.origin}/trello/callback`
    const url = new URL('https://trello.com/1/authorize')
    url.searchParams.set('expiration', 'never')
    url.searchParams.set('name', 'KanbanApp')
    url.searchParams.set('scope', 'read,write')
    url.searchParams.set('response_type', 'token')
    url.searchParams.set('key', trelloApiKey)
    url.searchParams.set('return_url', returnUrl)
    window.location.href = url.toString()
  }

  async function handleDisconnectTrello() {
    if (!token) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest('/api/trello/disconnect', { method: 'POST', token })
      setTrelloStatus({ connected: false, links: [] })
      await reloadBoards()
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function openTrelloLinkWizard() {
    if (!token || !board) {
      return
    }

    setMutating(true)
    setError('')

    try {
      const response = await apiRequest('/api/trello/boards', { token })
      setTrelloBoardOptions(response.boards ?? [])
      setSelectedTrelloBoardId(response.boards?.[0]?.id ?? '')
      const initialMappings = {}
      for (const column of board.columns ?? []) {
        initialMappings[column.id] = { trello_list_id: '', create_name: '' }
      }
      setColumnMappings(initialMappings)
      setShowTrelloLinkModal(true)
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function loadTrelloListsForBoard(trelloBoardId) {
    if (!token || !trelloBoardId) {
      return
    }

    const response = await apiRequest(`/api/trello/boards/${trelloBoardId}/lists`, { token })
    setTrelloListOptions(response.lists ?? [])
  }

  async function handleLinkBoardSubmit(event) {
    event.preventDefault()

    if (!token || !board || !selectedTrelloBoardId) {
      return
    }

    setMutating(true)
    setError('')

    try {
      const response = await apiRequest(`/api/boards/${board.id}/trello/link`, {
        method: 'POST',
        token,
        body: {
          trello_board_id: selectedTrelloBoardId,
          columns: (board.columns ?? []).map((column) => ({
            column_id: column.id,
            trello_list_id: columnMappings[column.id]?.trello_list_id || null,
            create_name: columnMappings[column.id]?.create_name || null,
          })),
        },
      })

      upsertBoard(response.board)
      await loadTrelloStatus()
      setShowTrelloLinkModal(false)
      showToast('Board linked to Trello')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleUnlinkBoard() {
    if (!token || !board || !window.confirm('Unlink this board from Trello?')) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/boards/${board.id}/trello/link`, { method: 'DELETE', token })
      await reloadBoards()
      await loadTrelloStatus()
      showToast('Board unlinked from Trello')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleSyncModeChange(syncMode) {
    if (!token || !board) {
      return
    }

    try {
      const response = await apiRequest(`/api/boards/${board.id}/trello/sync-mode`, {
        method: 'PATCH',
        token,
        body: { sync_mode: syncMode },
      })
      upsertBoard({ ...board, trello_link: response.link })
      await loadTrelloStatus()
    } catch (exception) {
      setError(exception.message)
    }
  }

  async function handleManualTrelloSync() {
    if (!token || !board) {
      return
    }

    setMutating(true)
    setError('')

    try {
      const response = await apiRequest(`/api/boards/${board.id}/trello/sync`, {
        method: 'POST',
        token,
      })
      upsertBoard(response.board)
      const total =
        (response.result?.pushed ?? 0) +
        (response.result?.pulled ?? 0)
      showToast(total > 0 ? `Synced ${total} changes` : 'Trello synced')
      setPollSince(new Date().toISOString())
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleMapColumnSubmit(event) {
    event.preventDefault()

    if (!token || !board || !mappingColumnId) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/boards/${board.id}/columns/${mappingColumnId}/trello/map`, {
        method: 'POST',
        token,
        body: {
          trello_list_id: mappingListId || null,
          create_name: mappingCreateName.trim() || null,
        },
      })
      await reloadBoards()
      setMappingColumnId(null)
      setMappingListId('')
      setMappingCreateName('')
      showToast('Column mapped to Trello')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  useEffect(() => {
    if (!token) {
      return
    }

    let alive = true

    async function loadSession() {
      setLoading(true)
      setError('')

      try {
        if (!alive) {
          return
        }

        await loadBoards(token)
        await loadTrelloStatus(token)
      } catch (exception) {
        clearStoredToken()
        setToken(null)
        setUser(null)
        setBoards([])
        setActiveBoardId(null)
        localStorage.removeItem(ACTIVE_BOARD_KEY)
        setTicketForm(createEmptyTicketDraft())
        setTicketColumnId('')
        setError(exception.message)
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    }

    loadSession()

    return () => {
      alive = false
    }
  }, [token])

  useEffect(() => {
    if (window.location.pathname !== '/trello/callback' || !token) {
      return
    }

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const params = new URLSearchParams(hash)
    const trelloToken = params.get('token')

    if (!trelloToken) {
      return
    }

    async function completeConnect() {
      try {
        await apiRequest('/api/trello/connect', {
          method: 'POST',
          token,
          body: { token: trelloToken },
        })
        await loadTrelloStatus(token)
        showToast('Connected to Trello')
      } catch (exception) {
        setError(exception.message)
      } finally {
        window.history.replaceState({}, '', '/')
      }
    }

    void completeConnect()
  }, [token])

  useEffect(() => {
    if (!token || !board || !boardTrelloLink || boardTrelloLink.sync_mode !== 'auto') {
      return
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await apiRequest(
          `/api/boards/${board.id}/trello/changes?since=${encodeURIComponent(pollSince)}`,
          { token },
        )

        if (response.changes > 0) {
          await reloadBoards()
          showToast('Trello synced')
          setPollSince(new Date().toISOString())
        }
      } catch {
        // Ignore polling errors.
      }
    }, 12000)

    return () => window.clearInterval(interval)
  }, [token, board, boardTrelloLink, pollSince])

  useEffect(() => {
    if (!showTrelloLinkModal || !selectedTrelloBoardId) {
      return
    }

    void loadTrelloListsForBoard(selectedTrelloBoardId)
  }, [showTrelloLinkModal, selectedTrelloBoardId])

  const editingTicket = useMemo(() => {
    if (!board || !editingTicketId) {
      return null
    }

    for (const column of board.columns ?? []) {
      const match = column.tickets?.find((ticket) => ticket.id === editingTicketId)

      if (match) {
        return match
      }
    }

    return null
  }, [board, editingTicketId])

  function closeTicketEditor() {
    setEditingTicketId(null)
  }

  useEffect(() => {
    if (!editingTicket) {
      setEditingTicketForm(createEmptyTicketDraft())
      return
    }

    setEditingTicketForm({
      title: editingTicket.title ?? '',
      description: editingTicket.description ?? '',
      priority: editingTicket.priority ?? 'medium',
    })
  }, [editingTicket])

  function applyAuthBoard(response) {
    if (!response.board) {
      return
    }

    setBoards([response.board])
    selectBoard(response.board.id)

    if (response.board.columns?.length) {
      setTicketColumnId(String(response.board.columns[0].id))
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setError('')

    try {
      const response = await apiRequest('/api/login', {
        method: 'POST',
        body: loginForm,
      })

      setStoredToken(response.token)
      setToken(response.token)
      setUser(response.user)
      applyAuthBoard(response)
      await loadTrelloStatus(response.token)
    } catch (exception) {
      setError(exception.message)
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault()
    setError('')

    try {
      const response = await apiRequest('/api/register', {
        method: 'POST',
        body: registerForm,
      })

      setStoredToken(response.token)
      setToken(response.token)
      setUser(response.user)
      applyAuthBoard(response)
      await loadTrelloStatus(response.token)
    } catch (exception) {
      setError(exception.message)
    }
  }

  async function handleLogout() {
    if (!token) {
      return
    }

    try {
      await apiRequest('/api/logout', { method: 'POST', token })
    } finally {
      clearStoredToken()
      setToken(null)
      setUser(null)
      setBoards([])
      setActiveBoardId(null)
      localStorage.removeItem(ACTIVE_BOARD_KEY)
      setTicketForm(createEmptyTicketDraft())
      setTicketColumnId('')
      setEditingTicketId(null)
      setDraggingTicketId(null)
      setDraggingColumnId(null)
      setDragOverColumnId(null)
      setEditingColumnId(null)
      setShowNewColumnForm(false)
      setShowCreateBoardForm(false)
      setError('')
    }
  }

  async function reloadBoards() {
    if (!token) {
      return
    }

    setMutating(true)

    try {
      await loadBoards(token, activeBoardId)
    } finally {
      setMutating(false)
    }
  }

  async function handleCreateBoardSubmit(event) {
    event.preventDefault()

    if (!token || !newBoardName.trim()) {
      return
    }

    setMutating(true)
    setError('')

    try {
      const response = await apiRequest('/api/boards', {
        method: 'POST',
        token,
        body: { name: newBoardName.trim() },
      })

      upsertBoard(response.board)
      selectBoard(response.board.id)
      setNewBoardName('')
      setShowCreateBoardForm(false)

      if (response.board.columns?.length) {
        setTicketColumnId(String(response.board.columns[0].id))
      }
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleDeleteBoard() {
    if (!token || !board || boards.length <= 1) {
      return
    }

    if (!window.confirm(`Delete board "${board.name}"? All columns and tickets will be removed.`)) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/boards/${board.id}`, {
        method: 'DELETE',
        token,
      })

      const remainingBoards = boards.filter((item) => item.id !== board.id)
      setBoards(remainingBoards)

      if (remainingBoards.length) {
        selectBoard(remainingBoards[0].id)
      } else {
        setActiveBoardId(null)
        localStorage.removeItem(ACTIVE_BOARD_KEY)
      }
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleCreateTicketSubmit(event) {
    event.preventDefault()

    if (!token || !board || !ticketColumnId) {
      return
    }

    if (!ticketForm.title.trim()) {
      setError('Ticket title is required.')
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest('/api/tickets', {
        method: 'POST',
        token,
        body: {
          board_id: board.id,
          column_id: Number(ticketColumnId),
          title: ticketForm.title.trim(),
          description: ticketForm.description.trim() || null,
          priority: ticketForm.priority,
        },
      })

      setTicketForm(createEmptyTicketDraft())
      await reloadBoards()
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleSaveTicket(event) {
    event.preventDefault()

    if (!token || !editingTicketId) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/tickets/${editingTicketId}`, {
        method: 'PATCH',
        token,
        body: editingTicketForm,
      })

      setEditingTicketId(null)
      setEditingTicketForm(createEmptyTicketDraft())
      await reloadBoards()
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleDeleteTicket(ticketId) {
    if (!token || !window.confirm('Delete this ticket?')) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/tickets/${ticketId}`, {
        method: 'DELETE',
        token,
      })

      if (editingTicketId === ticketId) {
        setEditingTicketId(null)
        setEditingTicketForm(createEmptyTicketDraft())
      }

      await reloadBoards()
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function moveTicket(ticketId, columnId) {
    if (!token || !board) {
      return
    }

    const sourceColumn = board.columns.find((column) =>
      column.tickets?.some((ticket) => ticket.id === ticketId),
    )

    if (!sourceColumn || sourceColumn.id === columnId) {
      return
    }

    const previousBoard = board

    upsertBoard({
      ...board,
      columns: (() => {
        let movedTicket = null

        const nextColumns = board.columns.map((column) => {
          const tickets = column.tickets ?? []
          const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId)

          if (ticketIndex === -1) {
            return column
          }

          movedTicket = tickets[ticketIndex]

          return {
            ...column,
            tickets: tickets.filter((ticket) => ticket.id !== ticketId),
          }
        })

        if (!movedTicket) {
          return board.columns
        }

        return nextColumns.map((column) =>
          column.id === columnId
            ? { ...column, tickets: [...(column.tickets ?? []), movedTicket] }
            : column,
        )
      })(),
    })

    setError('')

    try {
      await apiRequest(`/api/tickets/${ticketId}/move`, {
        method: 'PATCH',
        token,
        body: { column_id: columnId },
      })
    } catch (exception) {
      upsertBoard(previousBoard)
      setError(exception.message)
    }
  }

  async function reorderColumns(sourceColumnId, targetColumnId) {
    if (!token || !board || sourceColumnId === targetColumnId) {
      return
    }

    const columnIds = board.columns.map((column) => column.id)
    const sourceIndex = columnIds.indexOf(sourceColumnId)
    const targetIndex = columnIds.indexOf(targetColumnId)

    if (sourceIndex === -1 || targetIndex === -1) {
      return
    }

    const nextColumnIds = [...columnIds]
    nextColumnIds.splice(sourceIndex, 1)
    nextColumnIds.splice(targetIndex, 0, sourceColumnId)

    const columnMap = Object.fromEntries(board.columns.map((column) => [column.id, column]))
    const previousBoard = board

    upsertBoard({
      ...board,
      columns: nextColumnIds.map((id) => columnMap[id]),
    })

    setError('')

    try {
      const response = await apiRequest(`/api/boards/${board.id}/columns/reorder`, {
        method: 'PATCH',
        token,
        body: { column_ids: nextColumnIds },
      })

      upsertBoard(response.board)
    } catch (exception) {
      upsertBoard(previousBoard)
      setError(exception.message)
    }
  }

  function startEditingColumn(column) {
    setEditingColumnId(column.id)
    setEditingColumnName(column.name)
  }

  async function saveColumnName(columnId) {
    if (!token || !board) {
      return
    }

    const name = editingColumnName.trim()

    if (!name) {
      setEditingColumnId(null)
      return
    }

    const currentColumn = board.columns.find((column) => column.id === columnId)

    if (!currentColumn || currentColumn.name === name) {
      setEditingColumnId(null)
      return
    }

    setError('')

    try {
      const response = await apiRequest(`/api/boards/${board.id}/columns/${columnId}`, {
        method: 'PATCH',
        token,
        body: { name },
      })

      upsertBoard({
        ...board,
        columns: board.columns.map((column) =>
          column.id === columnId ? { ...column, name: response.column.name } : column,
        ),
      })
      setEditingColumnId(null)
    } catch (exception) {
      setError(exception.message)
    }
  }

  async function handleAddColumnSubmit(event) {
    event.preventDefault()

    if (!token || !board || !newColumnName.trim()) {
      return
    }

    setMutating(true)
    setError('')

    try {
      const response = await apiRequest(`/api/boards/${board.id}/columns`, {
        method: 'POST',
        token,
        body: { name: newColumnName.trim() },
      })

      upsertBoard({
        ...board,
        columns: [...board.columns, { ...response.column, tickets: [] }],
      })
      setNewColumnName('')
      setShowNewColumnForm(false)
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  async function handleDeleteColumn(column) {
    if (!token || !board || board.columns.length <= 1) {
      return
    }

    const otherColumns = board.columns.filter((item) => item.id !== column.id)
    const ticketCount = column.tickets?.length ?? 0
    let targetColumnId = null

    if (ticketCount > 0) {
      targetColumnId = otherColumns[0]?.id ?? null

      if (!targetColumnId) {
        return
      }

      const confirmed = window.confirm(
        `Delete column "${column.name}"? Its ${ticketCount} ticket(s) will move to "${otherColumns[0].name}".`,
      )

      if (!confirmed) {
        return
      }
    } else if (!window.confirm(`Delete column "${column.name}"?`)) {
      return
    }

    setMutating(true)
    setError('')

    try {
      await apiRequest(`/api/boards/${board.id}/columns/${column.id}`, {
        method: 'DELETE',
        token,
        body: ticketCount > 0 ? { target_column_id: targetColumnId } : undefined,
      })

      await reloadBoards()
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMutating(false)
    }
  }

  function handleTicketDragStart(ticketId) {
    setDraggingTicketId(ticketId)
  }

  function handleTicketDragEnd() {
    setDraggingTicketId(null)
    setDragOverColumnId(null)
  }

  function handleColumnDragStart(columnId) {
    setDraggingColumnId(columnId)
  }

  function handleColumnDragEnd() {
    setDraggingColumnId(null)
    setDragOverColumnId(null)
  }

  function handleColumnAreaDrop(event, columnId) {
    event.preventDefault()

    if (draggingColumnId) {
      void reorderColumns(draggingColumnId, columnId)
      setDraggingColumnId(null)
      setDragOverColumnId(null)
      return
    }

    if (draggingTicketId) {
      void moveTicket(draggingTicketId, columnId)
      setDraggingTicketId(null)
      setDragOverColumnId(null)
    }
  }

  const boardBusy = loading || mutating
  const columns = board?.columns ?? []

  useEffect(() => {
    if (!columns.length) {
      return
    }

    const hasCurrentColumn = columns.some((column) => String(column.id) === ticketColumnId)

    if (!hasCurrentColumn) {
      setTicketColumnId(String(columns[0].id))
    }
  }, [columns, ticketColumnId])

  return (
    <main className="app-shell">
      <aside className="auth-panel">
        {error ? <div className="notice error">{error}</div> : null}

        {!token ? (
          <div className="auth-switcher">
            <button
              type="button"
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => setAuthMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'active' : ''}
              onClick={() => setAuthMode('register')}
            >
              Sign up
            </button>
          </div>
        ) : null}

        {!token && authMode === 'login' ? (
          <form className="card form-card" onSubmit={handleLoginSubmit}>
            <label>
              Username
              <input
                value={loginForm.username}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, username: event.target.value }))
                }
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
                autoComplete="current-password"
              />
            </label>
            <button className="primary" type="submit">
              Sign in
            </button>
          </form>
        ) : null}

        {!token && authMode === 'register' ? (
          <form className="card form-card" onSubmit={handleRegisterSubmit}>
            <label>
              Username
              <input
                value={registerForm.username}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, username: event.target.value }))
                }
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={registerForm.password}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, password: event.target.value }))
                }
                autoComplete="new-password"
              />
            </label>
            <button className="primary" type="submit">
              Create account
            </button>
          </form>
        ) : null}

        {token ? (
          <>
            <div className="card session-card">
              <div>
                <p className="eyebrow">Signed in as</p>
                <strong>{user?.username}</strong>
              </div>
              <button type="button" className="secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>

            <div className="card form-card trello-card">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Trello</p>
                  <strong>{trelloStatus.connected ? 'Connected' : 'Not connected'}</strong>
                </div>
              </div>
              {trelloStatus.connected ? (
                <button
                  type="button"
                  className="secondary destructive"
                  onClick={handleDisconnectTrello}
                  disabled={boardBusy}
                >
                  Disconnect Trello
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  onClick={handleConnectTrello}
                  disabled={boardBusy}
                >
                  Connect to Trello
                </button>
              )}
            </div>

            <form className="card form-card creator-panel" onSubmit={handleCreateTicketSubmit}>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Create ticket</p>
                  <strong>New ticket</strong>
                </div>
              </div>

              <label>
                Column
                <select
                  value={ticketColumnId}
                  onChange={(event) => setTicketColumnId(event.target.value)}
                  disabled={!columns.length}
                >
                  {columns.map((column) => (
                    <option key={column.id} value={String(column.id)}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Title
                <input
                  value={ticketForm.title}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Add a ticket"
                />
              </label>

              <label>
                Description
                <textarea
                  rows="3"
                  value={ticketForm.description}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Short description"
                />
              </label>

              <label>
                Priority
                <select
                  value={ticketForm.priority}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>

              <button className="primary" type="submit" disabled={boardBusy || !columns.length}>
                Add ticket
              </button>
            </form>

            {loading ? <p className="muted">Loading session from the API...</p> : null}
          </>
        ) : null}
      </aside>

      <section className="board-area">
        <header className="board-header card">
          <div className="board-header-main">
            <div>
              <p className="eyebrow">Board</p>
              <h2>{board?.name ?? 'No board loaded yet'}</h2>
            </div>

            {token && boards.length > 1 ? (
              <div className="board-selector">
                {boards.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === activeBoardId ? 'active' : ''}
                    onClick={() => selectBoard(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {token ? (
            <div className="board-header-actions">
              {showCreateBoardForm ? (
                <form className="inline-form" onSubmit={handleCreateBoardSubmit}>
                  <input
                    value={newBoardName}
                    onChange={(event) => setNewBoardName(event.target.value)}
                    placeholder="Board name"
                    autoFocus
                  />
                  <button className="primary" type="submit" disabled={boardBusy}>
                    Create
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setShowCreateBoardForm(false)
                      setNewBoardName('')
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowCreateBoardForm(true)}
                >
                  New board
                </button>
              )}

              {board && boards.length > 1 ? (
                <button
                  type="button"
                  className="secondary destructive"
                  onClick={handleDeleteBoard}
                  disabled={boardBusy}
                >
                  Delete board
                </button>
              ) : null}

              {board && trelloStatus.connected ? (
                boardTrelloLink ? (
                  <>
                    <label className="sync-toggle">
                      <span>Auto sync</span>
                      <input
                        type="checkbox"
                        checked={boardTrelloLink.sync_mode === 'auto'}
                        onChange={(event) =>
                          handleSyncModeChange(event.target.checked ? 'auto' : 'manual')
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleManualTrelloSync}
                      disabled={boardBusy}
                    >
                      Sync now
                    </button>
                    <button
                      type="button"
                      className="secondary destructive"
                      onClick={handleUnlinkBoard}
                      disabled={boardBusy}
                    >
                      Unlink Trello
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    onClick={openTrelloLinkWizard}
                    disabled={boardBusy}
                  >
                    Link to Trello
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </header>

        {token && board && unmappedColumns.length > 0 ? (
          <div className="card trello-banner">
            <p>
              {unmappedColumns.length} column(s) are not mapped to Trello lists and will not sync.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const column = unmappedColumns[0]
                setMappingColumnId(column.id)
                setMappingListId('')
                setMappingCreateName('')
                if (boardTrelloLink?.trello_board_id) {
                  void loadTrelloListsForBoard(boardTrelloLink.trello_board_id)
                }
              }}
            >
              Map column: {unmappedColumns[0].name}
            </button>
          </div>
        ) : null}

        {token && board ? (
          <div className="columns">
            {columns.map((column) => (
              <article
                className={`column card ${
                  dragOverColumnId === column.id ? 'drag-over' : ''
                } ${draggingColumnId === column.id ? 'is-dragging-column' : ''}`}
                key={column.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOverColumnId(column.id)
                }}
                onDragLeave={() => setDragOverColumnId(null)}
                onDrop={(event) => handleColumnAreaDrop(event, column.id)}
              >
                <div
                  className="column-head"
                  draggable
                  onDragStart={() => handleColumnDragStart(column.id)}
                  onDragEnd={handleColumnDragEnd}
                >
                  {editingColumnId === column.id ? (
                    <input
                      className="column-name-input"
                      value={editingColumnName}
                      onChange={(event) => setEditingColumnName(event.target.value)}
                      onBlur={() => saveColumnName(column.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveColumnName(column.id)
                        }

                        if (event.key === 'Escape') {
                          setEditingColumnId(null)
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="column-name-button"
                      onClick={() => startEditingColumn(column)}
                    >
                      {column.name}
                    </button>
                  )}

                  <div className="column-head-actions">
                    <span>{column.tickets?.length ?? 0}</span>
                    {columns.length > 1 ? (
                      <button
                        type="button"
                        className="secondary destructive column-delete"
                        onClick={() => handleDeleteColumn(column)}
                        disabled={boardBusy}
                        aria-label={`Delete column ${column.name}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="ticket-list">
                  {(column.tickets ?? []).map((ticket) => (
                    <article
                      className={`ticket ${draggingTicketId === ticket.id ? 'is-dragging' : ''}`}
                      key={ticket.id}
                      draggable
                      onDragStart={() => handleTicketDragStart(ticket.id)}
                      onDragEnd={handleTicketDragEnd}
                    >
                      <div className="ticket-top">
                        <strong>{ticket.title}</strong>
                        <span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span>
                      </div>
                      <p>{ticket.description || 'No description yet'}</p>
                      <div className="ticket-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEditingTicketId(ticket.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="secondary destructive"
                          onClick={() => handleDeleteTicket(ticket.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                  {!column.tickets?.length ? <p className="muted drop-hint">Drop a ticket here.</p> : null}
                </div>
              </article>
            ))}

            <article className="column card column-add">
              {showNewColumnForm ? (
                <form className="column-add-form" onSubmit={handleAddColumnSubmit}>
                  <label>
                    Column name
                    <input
                      value={newColumnName}
                      onChange={(event) => setNewColumnName(event.target.value)}
                      placeholder="New column"
                      autoFocus
                    />
                  </label>
                  <div className="form-actions">
                    <button className="primary" type="submit" disabled={boardBusy}>
                      Add
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setShowNewColumnForm(false)
                        setNewColumnName('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="secondary column-add-button"
                  onClick={() => setShowNewColumnForm(true)}
                >
                  + Add column
                </button>
              )}
            </article>
          </div>
        ) : (
          <div className="card empty-state">
            <p>Sign in or create an account to load the board from the Laravel API.</p>
            <p className="muted">
              Create boards, customize columns, and move tickets between them.
            </p>
          </div>
        )}
      </section>

      {editingTicket ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeTicketEditor}
        >
          <form
            className="modal card form-card"
            onSubmit={handleSaveTicket}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Editing ticket</p>
                <strong>{editingTicket.title}</strong>
              </div>
              <button type="button" className="secondary" onClick={closeTicketEditor}>
                Close
              </button>
            </div>

            <div className="modal-body">
              <label>
                Title
                <input
                  value={editingTicketForm.title}
                  onChange={(event) =>
                    setEditingTicketForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  rows="4"
                  value={editingTicketForm.description}
                  onChange={(event) =>
                    setEditingTicketForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Priority
                <select
                  value={editingTicketForm.priority}
                  onChange={(event) =>
                    setEditingTicketForm((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>

            <div className="modal-actions form-actions">
              <button type="button" className="secondary" onClick={closeTicketEditor}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={boardBusy}>
                Save ticket
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showTrelloLinkModal && board ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowTrelloLinkModal(false)}>
          <form
            className="modal card form-card"
            onSubmit={handleLinkBoardSubmit}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Link board</p>
                <strong>Connect to Trello</strong>
              </div>
              <button type="button" className="secondary" onClick={() => setShowTrelloLinkModal(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <label>
                Trello board
                <select
                  value={selectedTrelloBoardId}
                  onChange={(event) => setSelectedTrelloBoardId(event.target.value)}
                >
                  {trelloBoardOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {(board.columns ?? []).map((column) => (
                <div key={column.id} className="mapping-row">
                  <strong>{column.name}</strong>
                  <select
                    value={columnMappings[column.id]?.trello_list_id ?? ''}
                    onChange={(event) =>
                      setColumnMappings((current) => ({
                        ...current,
                        [column.id]: {
                          ...current[column.id],
                          trello_list_id: event.target.value,
                          create_name: '',
                        },
                      }))
                    }
                  >
                    <option value="">Create new list...</option>
                    {trelloListOptions.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                  {!columnMappings[column.id]?.trello_list_id ? (
                    <input
                      placeholder={`New list name for ${column.name}`}
                      value={columnMappings[column.id]?.create_name ?? ''}
                      onChange={(event) =>
                        setColumnMappings((current) => ({
                          ...current,
                          [column.id]: {
                            ...current[column.id],
                            create_name: event.target.value,
                          },
                        }))
                      }
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="modal-actions form-actions">
              <button type="button" className="secondary" onClick={() => setShowTrelloLinkModal(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={boardBusy}>
                Link board
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {mappingColumnId ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setMappingColumnId(null)}>
          <form
            className="modal card form-card"
            onSubmit={handleMapColumnSubmit}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Map column</p>
                <strong>Link column to Trello list</strong>
              </div>
              <button type="button" className="secondary" onClick={() => setMappingColumnId(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <label>
                Trello list
                <select value={mappingListId} onChange={(event) => setMappingListId(event.target.value)}>
                  <option value="">Create new list...</option>
                  {trelloListOptions.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              {!mappingListId ? (
                <label>
                  New list name
                  <input
                    value={mappingCreateName}
                    onChange={(event) => setMappingCreateName(event.target.value)}
                    placeholder="List name on Trello"
                  />
                </label>
              ) : null}
            </div>
            <div className="modal-actions form-actions">
              <button type="button" className="secondary" onClick={() => setMappingColumnId(null)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={boardBusy}>
                Save mapping
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  )
}

export default App
