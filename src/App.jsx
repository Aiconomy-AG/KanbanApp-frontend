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

  const board = useMemo(
    () => boards.find((item) => item.id === activeBoardId) ?? null,
    [boards, activeBoardId],
  )

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
            </div>
          ) : null}
        </header>

        {token && board ? (
          <div
            className="columns"
            style={{
              gridTemplateColumns: `repeat(${columns.length + 1}, minmax(240px, 1fr))`,
            }}
          >
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
    </main>
  )
}

export default App
