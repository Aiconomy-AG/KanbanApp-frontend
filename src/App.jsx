import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  apiRequest,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from './lib/api'

const createEmptyTicketDraft = () => ({
  title: '',
  description: '',
  priority: 'medium',
})

function App() {
  const [token, setToken] = useState(getStoredToken())
  const [user, setUser] = useState(null)
  const [board, setBoard] = useState(null)
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
  const [dragOverColumnId, setDragOverColumnId] = useState(null)

  async function loadBoard(nextToken = token) {
    if (!nextToken) {
      return null
    }

    const [me, boardsResponse] = await Promise.all([
      apiRequest('/api/me', { token: nextToken }),
      apiRequest('/api/boards', { token: nextToken }),
    ])

    const nextBoard = boardsResponse.boards?.[0] ?? null

    setUser(me.user)
    setBoard(nextBoard)

    if (nextBoard?.columns?.length) {
      setTicketColumnId((current) => {
        const hasCurrent = nextBoard.columns.some((column) => String(column.id) === current)

        return hasCurrent ? current : String(nextBoard.columns[0].id)
      })
    }

    return nextBoard
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

        await loadBoard(token)
      } catch (exception) {
        clearStoredToken()
        setToken(null)
        setUser(null)
        setBoard(null)
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
      setBoard(response.board ?? null)
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
      setBoard(response.board ?? null)
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
      setBoard(null)
      setTicketForm(createEmptyTicketDraft())
      setTicketColumnId('')
      setEditingTicketId(null)
      setDraggingTicketId(null)
      setDragOverColumnId(null)
      setError('')
    }
  }

  async function reloadBoard() {
    if (!token) {
      return
    }

    setMutating(true)

    try {
      await loadBoard(token)
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
      await reloadBoard()
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
      await reloadBoard()
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

      await reloadBoard()
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

    setBoard((current) => {
      if (!current) {
        return current
      }

      let movedTicket = null

      const nextColumns = current.columns.map((column) => {
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
        return current
      }

      return {
        ...current,
        columns: nextColumns.map((column) =>
          column.id === columnId
            ? { ...column, tickets: [...(column.tickets ?? []), movedTicket] }
            : column,
        ),
      }
    })

    setError('')

    try {
      await apiRequest(`/api/tickets/${ticketId}/move`, {
        method: 'PATCH',
        token,
        body: { column_id: columnId },
      })
    } catch (exception) {
      setBoard(previousBoard)
      setError(exception.message)
    }
  }

  function handleDragStart(ticketId) {
    setDraggingTicketId(ticketId)
  }

  function handleDragEnd() {
    setDraggingTicketId(null)
    setDragOverColumnId(null)
  }

  function handleDrop(event, columnId) {
    event.preventDefault()

    if (!draggingTicketId) {
      return
    }

    void moveTicket(draggingTicketId, columnId)
    setDraggingTicketId(null)
    setDragOverColumnId(null)
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

              <button className="primary" type="submit" disabled={boardBusy}>
                Add ticket
              </button>
            </form>

            {loading ? <p className="muted">Loading session from the API...</p> : null}
          </>
        ) : null}
      </aside>

      <section className="board-area">
        <header className="board-header card">
          <div>
            <p className="eyebrow">Board</p>
            <h2>{board?.name ?? 'No board loaded yet'}</h2>
          </div>
        </header>

        {token && board ? (
          <div className="columns">
            {columns.map((column) => (
              <article
                className={`column card ${dragOverColumnId === column.id ? 'drag-over' : ''}`}
                key={column.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOverColumnId(column.id)
                }}
                onDragLeave={() => setDragOverColumnId(null)}
                onDrop={(event) => handleDrop(event, column.id)}
              >
                <div className="column-head">
                  <h3>{column.name}</h3>
                  <span>{column.tickets?.length ?? 0}</span>
                </div>

                <div className="ticket-list">
                  {(column.tickets ?? []).map((ticket) => (
                    <article
                      className={`ticket ${draggingTicketId === ticket.id ? 'is-dragging' : ''}`}
                      key={ticket.id}
                      draggable
                      onDragStart={() => handleDragStart(ticket.id)}
                      onDragEnd={handleDragEnd}
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
          </div>
        ) : (
          <div className="card empty-state">
            <p>Sign in or create an account to load the board from the Laravel API.</p>
            <p className="muted">
              Tickets can be created, edited, deleted, and moved between the five saved columns.
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